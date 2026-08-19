import { eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { documents } from '@/server/db/schema';
import {
  canComment,
  requireDocumentAccess,
  requireDocumentOwner,
  viewerName,
} from '@/server/auth/access';
import { removeObject } from '@/server/storage/supabase';
import { handleApiError, json } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * Document metadata and processing status.
 *
 * Readable by anyone with access (owner or invited guest) — the viewer polls
 * this while a document is still processing.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireDocumentAccess(id);
    const doc = access.document;

    return json({
      document: {
        id: doc.id,
        filename: doc.filename,
        status: doc.status,
        summary: doc.summary,
        error: doc.error,
        pageCount: doc.pageCount,
        byteSize: doc.byteSize,
        createdAt: doc.createdAt,
      },
      access: {
        kind: access.kind,
        canComment: canComment(access),
        displayName: viewerName(access),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Deletes a document.
 *
 * Owner-only. Chunks, shares, guest sessions, comments, and chat messages are
 * removed by ON DELETE CASCADE, so there is no orphan cleanup to forget.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { document } = await requireDocumentOwner(id);

    await db.delete(documents).where(eq(documents.id, id));

    // After the row is gone: a failed object delete leaves a harmless orphan,
    // whereas deleting the object first could strand a live row without a file.
    await removeObject(document.storagePath);

    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
