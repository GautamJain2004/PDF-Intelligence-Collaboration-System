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
    const { document, userName, userEmail } = await requireDocumentOwner(id);

    const { email, role, expiresInDays } = await parseJson(request, createShareSchema);

    const share = await createShare({
      documentId: id,
      createdBy: document.ownerId,
      invitedEmail: email ?? null,
      role,
      expiresInDays: expiresInDays ?? null,
    });

    let emailDelivered: boolean | null = null;
    let emailMessage: string | null = null;

    if (email) {
      const mail = shareInviteEmail({
        sharerName: userName,
        filename: document.filename,
        url: share.url,
        canComment: role === 'commenter',
        summary: document.summary,
      });

      // Sent from the deployment's mailbox on this owner's behalf, so replies
      // are routed back to them rather than to whoever runs the deployment.
      const result = await sendEmail({ to: email, replyTo: userEmail, ...mail });
      emailDelivered = result.sent;
      // Surfaced to the owner so a delivery problem is explained, not just
      // reported. Only ever shown to the document's owner.
      emailMessage = result.sent ? null : result.message;
    }

    return json(
      {
        share: { id: share.id, url: share.url, role },
        emailDelivered,
        emailMessage,
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
