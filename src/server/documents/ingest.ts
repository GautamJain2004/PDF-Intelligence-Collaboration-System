import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { documents, documentChunks } from '@/server/db/schema';
import { downloadObject, removeObject } from '@/server/storage/supabase';
import { validatePdfBytes } from '@/server/pdf/validate';
import { extractPdfText, MAX_PAGES } from '@/server/pdf/extract';
import { chunkPages } from '@/server/pdf/chunk';
import { embedDocuments, embedDocumentDescriptor } from '@/server/ai/embed';
import { summarizeDocument } from '@/server/ai/summarize';

/**
 * Ingest pipeline: storage object -> searchable, summarised document.
 *
 *   download -> validate bytes -> extract per-page text -> clean -> chunk
 *            -> embed chunks -> summarise -> embed descriptor -> ready
 *
 * Design notes:
 *
 * - **Status is persisted, not held in memory.** The client polls, so a
 *   serverless invocation dying mid-way leaves an accurate `processing` or
 *   `failed` row rather than a document stuck in limbo with no explanation.
 *
 * - **Idempotent.** Existing chunks are deleted before insert, so the retry
 *   button is safe to press repeatedly and cannot produce duplicates.
 *
 * - **Errors are classified.** Failures carry a message written for the
 *   document's owner ("this PDF is scanned images"), not a stack trace.
 *
 * Trade-off: this runs inline in a request rather than on a job queue. A queue
 * (Inngest, QStash) is the production answer and would remove the function
 * timeout ceiling entirely; at assignment scale it is a whole extra service to
 * deploy and monitor for the same user-visible behaviour. The page cap and the
 * retry path exist because of this choice.
 */

/** User-facing failure, safe to display verbatim. */
export class IngestError extends Error {
  constructor(
    message: string,
    /** When false, retrying the same file cannot succeed. */
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'IngestError';
  }
}

async function markFailed(documentId: string, message: string) {
  await db
    .update(documents)
    .set({ status: 'failed', error: message, updatedAt: new Date() })
    .where(eq(documents.id, documentId));
}

export type IngestResult = {
  pageCount: number;
  chunkCount: number;
  summary: string;
  truncated: boolean;
};

/**
 * Runs the full pipeline for one document.
 *
 * Throws `IngestError` with a user-safe message on failure, having already
 * recorded that message on the row.
 */
export async function ingestDocument(documentId: string): Promise<IngestResult> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) throw new IngestError('Document not found.', false);

  await db
    .update(documents)
    .set({ status: 'processing', error: null, updatedAt: new Date() })
    .where(eq(documents.id, documentId));

  try {
    // --- 1. Fetch and validate the actual bytes ---------------------------
    // The client's declared filename, size, and MIME type were only ever
    // hints. This is where the file is genuinely verified to be a PDF.
    const buffer = await downloadObject(doc.storagePath);

    const validation = validatePdfBytes(buffer);
    if (!validation.ok) {
      // A file that is not a PDF has no business occupying storage.
      await removeObject(doc.storagePath);
      throw new IngestError(validation.reason, false);
    }

    // --- 2. Extract text --------------------------------------------------
    let extraction;
    try {
      extraction = await extractPdfText(buffer);
    } catch (error) {
      console.error(`[ingest] extraction failed for ${documentId}:`, error);
      throw new IngestError(
        'This PDF could not be read. It may be password-protected or damaged.',
        false,
      );
    }

    if (extraction.isScanned || extraction.pages.length === 0) {
      throw new IngestError(
        'No text could be extracted — this PDF appears to contain scanned images rather than selectable text. ' +
          'Text recognition (OCR) is not supported, so summaries and chat are unavailable for this file.',
        false,
      );
    }

    // --- 3. Chunk ---------------------------------------------------------
    const chunks = chunkPages(extraction.pages);
    if (chunks.length === 0) {
      throw new IngestError('This PDF contains no readable text content.', false);
    }

    // --- 4. Embed and store chunks ---------------------------------------
    const embeddings = await embedDocuments(chunks.map((c) => c.content));

    await db.transaction(async (tx) => {
      // Idempotency: a retry must replace prior chunks, never append to them.
      await tx.delete(documentChunks).where(eq(documentChunks.documentId, documentId));

      await tx.insert(documentChunks).values(
        chunks.map((chunk, i) => ({
          documentId,
          chunkIndex: chunk.chunkIndex,
          pageFrom: chunk.pageFrom,
          pageTo: chunk.pageTo,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          embedding: embeddings[i]!,
        })),
      );
    });

    // --- 5. Summarise -----------------------------------------------------
    const { summary } = await summarizeDocument(doc.filename, extraction.pages);

    // --- 6. Document-level embedding for semantic dashboard search --------
    // Non-fatal: search degrades to filename matching if this call fails,
    // which is far better than failing an otherwise successful ingest.
    let docEmbedding: number[] | null = null;
    try {
      docEmbedding = await embedDocumentDescriptor(doc.filename, summary);
    } catch (error) {
      console.error(`[ingest] descriptor embedding failed for ${documentId}:`, error);
    }

    await db
      .update(documents)
      .set({
        status: 'ready',
        error: null,
        summary,
        docEmbedding,
        pageCount: extraction.totalPages,
        byteSize: buffer.byteLength,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));

    return {
      pageCount: extraction.totalPages,
      chunkCount: chunks.length,
      summary,
      truncated: extraction.truncated,
    };
  } catch (error) {
    const message =
      error instanceof IngestError
        ? error.message
        : 'Processing failed unexpectedly. You can try again.';

    if (!(error instanceof IngestError)) {
      // Unexpected errors get logged in full; the user sees the generic text.
      console.error(`[ingest] unexpected failure for ${documentId}:`, error);
    }

    await markFailed(documentId, message);

    throw error instanceof IngestError ? error : new IngestError(message);
  }
}

/** Advisory note shown when a document exceeded the page cap. */
export function truncationNotice(pageCount: number): string {
  return `Only the first ${MAX_PAGES} of ${pageCount} pages were processed. Summaries and chat cover that portion of the document.`;
}
