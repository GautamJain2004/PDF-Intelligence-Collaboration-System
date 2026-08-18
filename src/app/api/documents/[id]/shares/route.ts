import { requireDocumentOwner } from '@/server/auth/access';
import { createShare, listShares } from '@/server/documents/shares';
import { createShareSchema } from '@/lib/validation';
import { handleApiError, json, parseJson } from '@/lib/api';
import { sendEmail } from '@/server/email/send';
import { shareInviteEmail } from '@/server/email/templates';

export const runtime = 'nodejs';

/** Lists active share links for a document. Owner-only. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireDocumentOwner(id);

    return json({ shares: await listShares(id) });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Creates a share link, optionally emailing an invitee.
 *
 * Email delivery is best-effort and reported back rather than awaited as a
 * success condition: the link is already valid, so a mail failure must not fail
 * the request. The response says whether the mail went out so the UI can tell
 * the user to copy the link manually.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { document, userName } = await requireDocumentOwner(id);

    const { email, role, expiresInDays } = await parseJson(request, createShareSchema);

    const share = await createShare({
      documentId: id,
      createdBy: document.ownerId,
      invitedEmail: email ?? null,
      role,
      expiresInDays: expiresInDays ?? null,
    });

    let emailDelivered: boolean | null = null;

    if (email) {
      const mail = shareInviteEmail({
        sharerName: userName,
        filename: document.filename,
        url: share.url,
        canComment: role === 'commenter',
        summary: document.summary,
      });

      const result = await sendEmail({ to: email, ...mail });
      emailDelivered = result.sent;
    }

    return json({ share: { id: share.id, url: share.url, role }, emailDelivered }, {
      status: 201,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
