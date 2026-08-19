import 'server-only';

import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';

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

/** How many cards a dashboard page holds. */
export const PAGE_SIZE = 12;

export type DocumentPage = {
  documents: DocumentListItem[];
  /** Matches across every page, so the UI can size the pager. */
  total: number;
};

export type StatusFilter = 'all' | 'ready' | 'processing' | 'failed';

/**
 * Library-wide totals for the dashboard rail.
 *
 * Deliberately separate from the paged list. Counting the rows on the current
 * page would make the rail lie the moment a second page exists — "2 documents"
 * next to a library of thirty — and the filter counts have to describe what
 * filtering would find, not what happens to be on screen.
 */
export type LibraryStats = Record<StatusFilter, number> & {
  pages: number;
  bytes: number;
};

export async function getLibraryStats(ownerId: string): Promise<LibraryStats> {
  const [row] = await db
    .select({
      all: count(),
      ready: sql<number>`count(*) FILTER (WHERE ${documents.status} = 'ready')::int`,
      // `uploading` is the same wait as `processing` from the user's side.
      processing: sql<number>`count(*) FILTER (WHERE ${documents.status} IN ('processing','uploading'))::int`,
      failed: sql<number>`count(*) FILTER (WHERE ${documents.status} = 'failed')::int`,
      pages: sql<number>`COALESCE(SUM(${documents.pageCount}), 0)::int`,
      bytes: sql<string>`COALESCE(SUM(${documents.byteSize}), 0)::bigint`,
    })
    .from(documents)
    .where(eq(documents.ownerId, ownerId));

  return {
    all: Number(row?.all ?? 0),
    ready: Number(row?.ready ?? 0),
    processing: Number(row?.processing ?? 0),
    failed: Number(row?.failed ?? 0),
    pages: Number(row?.pages ?? 0),
    // Summed bytes exceed a 32-bit int quickly, so Postgres returns text.
    bytes: Number(row?.bytes ?? 0),
  };
}

/** Statuses a filter selects, expanded because `uploading` is user-invisible. */
function statusesFor(filter: StatusFilter): DocumentListItem['status'][] | null {
  switch (filter) {
    case 'all':
      return null;
    case 'processing':
      return ['processing', 'uploading'];
    default:
      return [filter];
  }
}

/**
 * One page of a user's documents, newest first.
 *
 * Paged in SQL rather than trimmed in the client: a dashboard that fetches
 * every row to show twelve of them gets slower with every upload, and the
 * summaries make each row far from small.
 */
export async function listDocuments(
  ownerId: string,
  options: { status?: StatusFilter; limit?: number; offset?: number } = {},
): Promise<DocumentPage> {
  const { status = 'all', limit = PAGE_SIZE, offset = 0 } = options;
  const statuses = statusesFor(status);

  const where = statuses
    ? and(eq(documents.ownerId, ownerId), inArray(documents.status, statuses))
    : eq(documents.ownerId, ownerId);

  const [rows, [totals]] = await Promise.all([
    db
      .select(listColumns)
      .from(documents)
      .where(where)
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(documents).where(where),
  ]);

  return { documents: rows, total: Number(totals?.total ?? 0) };
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
  options: { limit?: number; offset?: number } = {},
): Promise<DocumentPage> {
  const { limit = PAGE_SIZE, offset = 0 } = options;
  const pattern = `%${query}%`;

  const where = and(
    eq(documents.ownerId, ownerId),
    sql`lower(${documents.filename}) LIKE lower(${pattern})`,
  );

  const [rows, [totals]] = await Promise.all([
    db
      .select(listColumns)
      .from(documents)
      .where(where)
      .orderBy(desc(documents.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(documents).where(where),
  ]);

  return { documents: rows, total: Number(totals?.total ?? 0) };
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
  total_matches: string;
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
  options: { limit?: number; offset?: number } = {},
): Promise<DocumentPage> {
  const { limit = PAGE_SIZE, offset = 0 } = options;
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
      END AS similarity,
      count(*) OVER () AS total_matches
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
    LIMIT ${limit} OFFSET ${offset}
  `);

  const list = rows as unknown as SemanticRow[];

  return {
    total: Number(list[0]?.total_matches ?? 0),
    documents: list.map((row) => ({
      id: row.id,
      filename: row.filename,
      status: row.status,
      summary: row.summary,
      error: row.error,
      pageCount: row.page_count,
      byteSize: Number(row.byte_size),
      createdAt: new Date(row.created_at),
      relevance: Number(row.similarity),
    })),
  };
}
