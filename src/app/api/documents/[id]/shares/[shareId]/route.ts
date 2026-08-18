import { requireDocumentOwner } from '@/server/auth/access';
import { revokeShare } from '@/server/documents/shares';
import { handleApiError, json, notFound } from '@/lib/api';

export const runtime = 'nodejs';

/**
 * Revokes a share link.
 *
 * Takes effect immediately — access checks re-read the revocation flag on every
 * request, so a guest who already holds a cookie is cut off on their next
 * action rather than when their cookie eventually expires.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  try {
    const { id, shareId } = await params;
    await requireDocumentOwner(id);

    const revoked = await revokeShare(shareId, id);
    if (!revoked) throw notFound('That share link no longer exists.');

    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
