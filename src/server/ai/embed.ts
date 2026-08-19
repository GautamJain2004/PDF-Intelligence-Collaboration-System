import 'server-only';

import { embed, embedMany } from 'ai';

import { embeddingModel } from './provider';
import { EMBEDDING_DIMENSIONS } from '@/server/db/schema';

/**
 * Embedding generation.
 *
 * Uses `text-embedding-3-small` with an explicit `dimensions` request.
 *
 * **Why 768 and not the model's native 1536.** The `document_chunks.embedding`
 * and `documents.doc_embedding` columns are `vector(768)`, and pgvector's HNSW
 * index refuses anything above 2000 dimensions. text-embedding-3 models are
 * trained with Matryoshka representation learning, so a truncated prefix is
 * still a valid embedding rather than a lossy crop — asking for 768 keeps the
 * existing schema and indexes untouched, with a small and well-characterised
 * quality cost versus 1536.
 *
 * **Normalisation matters here.** OpenAI returns unit-length vectors at native
 * dimensionality, but a truncated output is NOT unit length. Cosine distance
 * would be subtly wrong without re-normalising, so every vector goes through
 * `normalize()` before it is stored or compared.
 *
 * **No task types.** Gemini distinguishes `RETRIEVAL_DOCUMENT` from
 * `RETRIEVAL_QUERY`, which measurably helps because a question and the passage
 * answering it are different kinds of text. OpenAI's embeddings are symmetric
 * and offer no equivalent, so that advantage is gone. The hybrid retrieval in
 * `retrieve.ts` compensates: the full-text half catches the exact-term matches
 * that symmetric dense retrieval is weakest on.
 *
 * **Switching embedding providers invalidates stored vectors.** Embeddings from
 * different models occupy different vector spaces; comparing a chunk vector
 * written by one provider against a query vector from another produces
 * meaningless similarity scores rather than an error. Any document embedded under a previous provider must be
 * re-ingested. See the README migration note.
 */

/** OpenAI accepts up to 2048 inputs per request; 100 keeps payloads modest. */
const MAX_BATCH = 100;

/** Scales a vector to unit length so cosine distance behaves as expected. */
export function normalize(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;

  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return vector;

  return vector.map((value) => value / magnitude);
}

function assertDimensions(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${vector.length}. ` +
        'The embedding model and the vector column width must agree.',
    );
  }
  return vector;
}

/** Requests the truncated width the schema expects. */
const providerOptions = {
  openai: { dimensions: EMBEDDING_DIMENSIONS },
};

/** Embeds a user's question for retrieval. */
export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: text,
    providerOptions,
  });
  return normalize(assertDimensions(embedding));
}

/**
 * Embeds document passages in batches.
 *
 * Batched because a 200-page PDF produces hundreds of chunks, and one request
 * per chunk would be both slow and a fast route to a rate limit.
 */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += MAX_BATCH) {
    const batch = texts.slice(i, i + MAX_BATCH);
    const { embeddings } = await embedMany({
      model: embeddingModel(),
      values: batch,
      providerOptions,
    });
    for (const embedding of embeddings) {
      results.push(normalize(assertDimensions(embedding)));
    }
  }

  return results;
}

/**
 * Embeds the document-level descriptor used by semantic dashboard search.
 *
 * Indexing "filename + summary" rather than raw first-page text is deliberate:
 * the summary is a dense, noise-free statement of what the document is about,
 * which is exactly what a query like "employment contract" should match.
 */
export async function embedDocumentDescriptor(
  filename: string,
  summary: string,
): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: `${filename}\n\n${summary}`,
    providerOptions,
  });
  return normalize(assertDimensions(embedding));
}
