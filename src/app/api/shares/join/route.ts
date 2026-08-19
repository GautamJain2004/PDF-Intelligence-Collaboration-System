import { z } from 'zod';

import { createGuestSession, getCurrentUser } from '@/server/auth/session';
import { resolveShareToken, touchShare } from '@/server/documents/shares';
import { resolveGuestIdentity } from '@/server/auth/guest-identity';
import { guestJoinSchema } from '@/lib/validation';
import { ApiError, clientIp, handleApiError, json, parseJson, rateLimited } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const joinSchema = guestJoinSchema.extend({
  token: z.string().min(1),
});

/**
 * Exchanges a share token for a scoped guest session.
 *
 * This is how an invited user gets access without an account: they supply a
 * display name, and we mint a cookie bound to that one share. The cookie is not
 * an application session — it grants access to a single document and nothing
 * else.
 *
 * Rate limited by IP because this endpoint is the only place a share token can
 * be tested, making it the natural target for brute force. (With 256-bit
 * tokens, guessing is infeasible regardless; this bounds the noise.)
 */
export async function POST(request: Request) {
  try {
    const limit = rateLimit(`join:${clientIp(request)}`, {
      limit: 20,
      windowMs: 10 * 60 * 1000,
    });
    if (!limit.ok) throw rateLimited('Too many attempts. Please try again shortly.');

    const { token, email, displayName, mode } = await parseJson(request, joinSchema);

    const share = await resolveShareToken(token);
    if (!share) {
      throw new ApiError(404, 'This link is invalid, has expired, or was revoked.');
    }

    /*
     * Resolved only AFTER the token checks out. Doing it first would let anyone
     * create identity rows — and probe which addresses already exist — without
     * holding a valid link.
     */
    const user = await getCurrentUser();

    /*
     * Intent, not the cookie, decides.
     *
     * A signed-in visitor who chose "continue as guest" gets a guest identity —
     * their typed name, their "(guest)" tag. Only an explicit account choice
     * (or an older client that sent no mode and no email) resolves through the
     * session. Reading the session first is what made a deliberate guest entry
     * silently reattach to the account.
     */
    const asAccount = mode === 'account' || (!mode && !email);

    if (user && asAccount) {
      await createGuestSession(share.shareId, user.name, null);
      await touchShare(share.shareId);

      return json({
        documentId: share.documentId,
        role: share.role,
        displayName: user.name,
        returning: true,
      });
    }

    if (!email) {
      throw new ApiError(400, 'Please enter your email to continue as a guest.');
    }

    const identity = await resolveGuestIdentity(email, displayName);

    const guest = await createGuestSession(
      share.shareId,
      identity.displayName,
      identity.id,
    );
    await touchShare(share.shareId);

    return json({
      documentId: share.documentId,
      role: share.role,
      displayName: guest.displayName,
      returning: identity.returning,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
