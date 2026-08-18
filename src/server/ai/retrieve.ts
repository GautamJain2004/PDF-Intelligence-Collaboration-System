import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { embedQuery } from './embed';
import { estimateTokens } from '@/server/pdf/chunk';

/**
 * Retrieval for grounded question answering.
 *
 * This is the module that keeps the app from stuffing an entire PDF into every
 * request. For each question we fetch a handful of relevant chunks and send
 * only those, so cost and latency stay flat regardless of document length.
 *
 * Retrieval is hybrid — dense vectors plus Postgres full-text — because the two
 * fail in opposite directions:
 *
 *  - Dense vectors capture meaning ("who pays for shipping?" matches a
 *    "delivery costs shall be borne by..." clause) but are weak on rare exact
 *    tokens: names, clause numbers, figures, defined terms.
 *  - Full-text nails those exact tokens but misses paraphrase entirely.
 *
 * Results are fused with Reciprocal Rank Fusion, which combines rankings
 * without needing the two scoring scales to be comparable — cosine distance and
 * ts_rank are not, and normalising them against each other is guesswork.
 */

export type RetrievedChunk = {
  id: string;
  chunkIndex: number;
  pageFrom: number;
  pageTo: number;
  content: string;
  /** Fused relevance score; higher is better. Not a probability. */
  score: number;
};

/** Candidates pulled from each retriever before fusion. */
const CANDIDATES_PER_RETRIEVER = 20;

/** Chunks sent to the model after fusion. */
const DEFAULT_TOP_K = 8;

/**
 * Hard ceiling on context tokens.
 *
 * Even with a large context window, more context is not better: irrelevant
 * chunks dilute attention and invite the model to answer from the wrong part of
 * the document. This bound also keeps per-question cost predictable.
 */
const MAX_CONTEXT_TOKENS = 6000;

/**
 * RRF damping constant. The standard value from the original paper; it stops
 * a single retriever's top hit from dominating the fused ranking outright.
 */
const RRF_K = 60;

type CandidateRow = {
  id: string;
  chunk_index: number;
  page_from: number;
  page_to: number;
  content: string;
  rank: number;
};

/**
 * Dense retrieval over the HNSW index.
 *
 * `<=>` is pgvector's cosine distance operator and is what the index is built
 * for; using a different operator here would silently fall back to a
 * sequential scan.
 */
async function vectorSearch(
  documentId: string,
  queryEmbedding: number[],
): Promise<CandidateRow[]> {
  const literal = `[${queryEmbedding.join(',')}]`;

  const rows = await db.execute<CandidateRow>(sql`
    SELECT
      id,
      chunk_index,
      page_from,
      page_to,
      content,
      ROW_NUMBER() OVER (ORDER BY embedding <=> ${literal}::vector) AS rank
    FROM document_chunks
    WHERE document_id = ${documentId}::uuid
      AND embedding IS NOT NULL
    ORDER BY embedding <=> ${literal}::vector
    LIMIT ${CANDIDATES_PER_RETRIEVER}
  `);

  return rows as unknown as CandidateRow[];
}

/**
 * Lexical retrieval.
 *
 * `websearch_to_tsquery` is used rather than `plainto_tsquery` because it
 * tolerates arbitrary user punctuation and quoted phrases without throwing —
 * important when the input is a free-text question typed by a user.
 */
async function keywordSearch(
  documentId: string,
  query: string,
): Promise<CandidateRow[]> {
  const rows = await db.execute<CandidateRow>(sql`
    WITH q AS (SELECT websearch_to_tsquery('english', ${query}) AS tsq)
    SELECT
      id,
      chunk_index,
      page_from,
      page_to,
      content,
      ROW_NUMBER() OVER (
        ORDER BY ts_rank_cd(to_tsvector('english', content), q.tsq) DESC
      ) AS rank
    FROM document_chunks, q
    WHERE document_id = ${documentId}::uuid
      AND q.tsq IS NOT NULL
      AND to_tsvector('english', content) @@ q.tsq
    ORDER BY ts_rank_cd(to_tsvector('english', content), q.tsq) DESC
    LIMIT ${CANDIDATES_PER_RETRIEVER}
  `);

  return rows as unknown as CandidateRow[];
}

/**
 * Reciprocal Rank Fusion.
 *
 * score(d) = sum over retrievers of 1 / (k + rank_r(d))
 *
 * Rank-based rather than score-based, so the two retrievers' incomparable
 * scoring scales never need to be reconciled. A chunk both retrievers rank
 * highly beats one that only a single retriever loves — which is exactly the
 * behaviour we want.
 */
function fuse(lists: CandidateRow[][]): Map<string, { row: CandidateRow; score: number }> {
  const fused = new Map<string, { row: CandidateRow; score: number }>();

  for (const list of lists) {
    for (const row of list) {
      const rank = Number(row.rank);
      const contribution = 1 / (RRF_K + rank);
      const existing = fused.get(row.id);

      if (existing) {
        existing.score += contribution;
      } else {
        fused.set(row.id, { row, score: contribution });
      }
    }
  }

  return fused;
}

/**
 * Retrieves the most relevant chunks for a question.
 *
 * The query text passed here should already be the rewritten, standalone form —
 * see `QUERY_REWRITE_SYSTEM_PROMPT`. Passing a raw follow-up ("what about it?")
 * retrieves poorly.
 */
export async function retrieveChunks(
  documentId: string,
  query: string,
  { topK = DEFAULT_TOP_K }: { topK?: number } = {},
): Promise<RetrievedChunk[]> {
  const queryEmbedding = await embedQuery(query);

  // Run both retrievers concurrently; the keyword side is allowed to fail
  // (malformed tsquery, unusual input) without taking down the answer.
  const [vectorRows, keywordRows] = await Promise.all([
    vectorSearch(documentId, queryEmbedding),
    keywordSearch(documentId, query).catch((error) => {
      console.error('[retrieve] keyword search failed, continuing dense-only:', error);
      return [] as CandidateRow[];
    }),
  ]);

  const fused = fuse([vectorRows, keywordRows]);

  const ranked = [...fused.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  /*
   * Re-order the selected chunks into document order before sending them.
   * Relevance order scrambles the narrative; presenting excerpts in the order
   * they appear helps the model follow cross-references between them.
   */
  ranked.sort((a, b) => a.row.chunk_index - b.row.chunk_index);

  const selected: RetrievedChunk[] = [];
  let tokens = 0;

  for (const { row, score } of ranked) {
    const chunkTokens = estimateTokens(row.content);
    if (tokens + chunkTokens > MAX_CONTEXT_TOKENS && selected.length > 0) break;

    selected.push({
      id: row.id,
      chunkIndex: Number(row.chunk_index),
      pageFrom: Number(row.page_from),
      pageTo: Number(row.page_to),
      content: row.content,
      score,
    });
    tokens += chunkTokens;
  }

  return selected;
}
