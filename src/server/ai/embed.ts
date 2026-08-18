import 'server-only';

import { embed, embedMany } from 'ai';

import { embeddingModel } from './provider';
import { EMBEDDING_DIMENSIONS } from '@/server/db/schema';

/**
 * Embedding generation.
 *
 * Two details here materially affect retrieval quality:
 *
 * 1. **Asymmetric task types.** Gemini embeds differently depending on whether
 *    text is a stored passage (`RETRIEVAL_DOCUMENT`) or a search query
 *    (`RETRIEVAL_QUERY`). Using the matching type on each side measurably beats
 *    embedding both identically, because a question and the passage answering
 *    it are not the same kind of text.
 *
 * 2. **Manual normalisation.** gemini-embedding-001 only returns unit-length
 *    vectors at its native 3072 dimensions. We request 768 (pgvector's HNSW
 *    index refuses anything above 2000), and truncated outputs are NOT
 *    normalised, so cosine distance would be subtly wrong without this step.
 */

/** Gemini's batch ceiling per embed request. */
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
        'The GEMINI_EMBEDDING_MODEL and the vector column width must agree.',
    );
  }
  return vector;
}

const providerOptions = (taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY') => ({
  google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType },
});

/** Embeds a user's question for retrieval. */
export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: embeddingModel(),
    value: text,
    providerOptions: providerOptions('RETRIEVAL_QUERY'),
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
      providerOptions: providerOptions('RETRIEVAL_DOCUMENT'),
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
    providerOptions: providerOptions('RETRIEVAL_DOCUMENT'),
  });
  return normalize(assertDimensions(embedding));
}
