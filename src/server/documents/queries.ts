import 'server-only';

import { and, desc, eq, sql } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { documents } from '@/server/db/schema';
import { embedQuery } from '@/server/ai/embed';

/**
 * Document read queries.
 *
 * Every function here takes an `ownerId` and filters on it in SQL. Scoping at
 * the query layer rather than filtering in the route means a forgotten check
 * cannot leak another user's documents.
 */

export type DocumentListItem = {
  id: string;
  filename: string;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  summary: string | null;
  error: string | null;
  pageCount: number | null;
  byteSize: number;
  createdAt: Date;
  /** Present only for semantic search results; 0-1, higher is more similar. */
  relevance?: number;
};

const listColumns = {
  id: documents.id,
  filename: documents.filename,
  status: documents.status,
  summary: documents.summary,
  error: documents.error,
  pageCount: documents.pageCount,
  byteSize: documents.byteSize,
  createdAt: documents.createdAt,
};

/** All of a user's documents, newest first. */
export async function listDocuments(ownerId: string): Promise<DocumentListItem[]> {
  return db
    .select(listColumns)
    .from(documents)
    .where(eq(documents.ownerId, ownerId))
    .orderBy(desc(documents.createdAt));
}

/**
 * Filename substring search.
 *
 * Case-insensitive and backed by the trigram index, so it stays fast without a
 * full table scan.
 */
export async function searchByFilename(
  ownerId: string,
  query: string,
): Promise<DocumentListItem[]> {
  const pattern = `%${query}%`;

  return db
    .select(listColumns)
    .from(documents)
    .where(
      and(
        eq(documents.ownerId, ownerId),
        sql`lower(${documents.filename}) LIKE lower(${pattern})`,
      ),
    )
    .orderBy(desc(documents.createdAt));
}

/**
 * Minimum cosine similarity for a semantic hit to count as relevant.
 *
 * Measured against the actual embedding model rather than guessed — similarity
 * distributions are provider-specific, and a threshold carried over from another
 * model silently breaks search in one direction or the other. Measured with
 * `scripts/calibrate-threshold.ts` against text-embedding-3-small at 768 dims:
 *
 *   related   ("employment contract", "notice period", …)   0.311 - 0.509
 *   unrelated ("pizza recipes", "weather forecast", …)      -0.021 - 0.205
 *
 * 0.26 sits at the midpoint of a 0.106-wide gap. For reference, Gemini's
 * gemini-embedding-001 needed 0.55 here and separated the same two sets by only
 * 0.053 — OpenAI discriminates about twice as cleanly on this data, so the
 * cutoff can sit centrally instead of being biased toward precision.
 *
 * Re-run the calibration script whenever the embedding model changes.
 */
const SEMANTIC_THRESHOLD = 0.26;

type SemanticRow = {
  id: string;
  filename: string;
  status: DocumentListItem['status'];
  summary: string | null;
  error: string | null;
  page_count: number | null;
  byte_size: string | number;
  created_at: Date;
  similarity: number;
};

/**
 * Semantic search over document summaries.
 *
 * Matches on what a document is *about*, so "employment contract" surfaces
 * `Agreement_v3.pdf` when its summary describes employment terms — something
 * filename matching can never do.
 *
 * Filename matches are unioned in and always rank first: when a user types an
 * exact filename they want that file, not its nearest semantic neighbour.
 */
export async function searchSemantic(
  ownerId: string,
  query: string,
): Promise<DocumentListItem[]> {
  const queryEmbedding = await embedQuery(query);
  const literal = `[${queryEmbedding.join(',')}]`;
  const pattern = `%${query}%`;

  const rows = await db.execute<SemanticRow>(sql`
    SELECT
      id, filename, status, summary, error, page_count, byte_size, created_at,
      CASE
        WHEN lower(filename) LIKE lower(${pattern}) THEN 1.0
        WHEN doc_embedding IS NULL THEN 0.0
        ELSE 1 - (doc_embedding <=> ${literal}::vector)
      END AS similarity
    FROM documents
    WHERE owner_id = ${ownerId}::uuid
      AND (
        lower(filename) LIKE lower(${pattern})
        OR (
          doc_embedding IS NOT NULL
          AND 1 - (doc_embedding <=> ${literal}::vector) > ${SEMANTIC_THRESHOLD}
        )
      )
    ORDER BY similarity DESC, created_at DESC
    LIMIT 50
  `);

  return (rows as unknown as SemanticRow[]).map((row) => ({
    id: row.id,
    filename: row.filename,
    status: row.status,
    summary: row.summary,
    error: row.error,
    pageCount: row.page_count,
    byteSize: Number(row.byte_size),
    createdAt: new Date(row.created_at),
    relevance: Number(row.similarity),
  }));
}

/** Lightweight status poll used while a document is processing. */
export async function getDocumentStatus(ownerId: string, documentId: string) {
  const [row] = await db
    .select({
      id: documents.id,
      status: documents.status,
      summary: documents.summary,
      error: documents.error,
      pageCount: documents.pageCount,
    })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.ownerId, ownerId)))
    .limit(1);

  return row ?? null;
}
