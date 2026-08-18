import { requireDocumentOwner } from '@/server/auth/access';
import { ingestDocument, IngestError, truncationNotice } from '@/server/documents/ingest';
import { statObject } from '@/server/storage/supabase';
import { ApiError, handleApiError, json } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * Function time budget.
 *
 * Extraction, embedding, and summarisation of a large PDF genuinely take tens
 * of seconds. 60s is the Vercel Hobby ceiling; the page cap in the extractor is
 * sized to stay inside it.
 */
export const maxDuration = 60;

/**
 * Processes an uploaded document.
 *
 * Owner-only, and doubles as the retry endpoint — ingest is idempotent, so a
 * failed document can simply be re-submitted.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { document } = await requireDocumentOwner(id);

    // Confirm the client actually completed the upload before doing work.
    const stat = await statObject(document.storagePath);
    if (!stat || stat.size === 0) {
      throw new ApiError(
        409,
        'The file has not finished uploading yet. Please try again in a moment.',
      );
    }

    const result = await ingestDocument(id);

    return json({
      status: 'ready',
      pageCount: result.pageCount,
      chunkCount: result.chunkCount,
      summary: result.summary,
      notice: result.truncated ? truncationNotice(result.pageCount) : null,
    });
  } catch (error) {
    if (error instanceof IngestError) {
      // The row is already marked failed with this message; surface it as-is so
      // the user sees a real explanation rather than a generic 500.
      return json(
        { error: error.message, retryable: error.retryable, status: 'failed' },
        { status: 422 },
      );
    }
    return handleApiError(error);
  }
}
