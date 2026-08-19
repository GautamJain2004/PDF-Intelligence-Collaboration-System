import { requireDocumentAccess, viewerIdentity } from '@/server/auth/access';
import { deleteOwnComment } from '@/server/comments/queries';
import { handleApiError, json, notFound } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * Deletes a comment.
 *
 * Authors may delete their own comments; nobody may delete anyone else's. The
 * authorship predicate is part of the UPDATE's WHERE clause, so a request for
 * someone else's comment simply affects zero rows and returns 404 — there is no
 * separate check that could drift out of sync with the write.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  try {
    const { id, commentId } = await params;
    const access = await requireDocumentAccess(id);

    const deleted = await deleteOwnComment(commentId, id, viewerIdentity(access));
    if (!deleted) throw notFound('Comment not found.');

    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
