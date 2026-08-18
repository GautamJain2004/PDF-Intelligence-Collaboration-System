import { z } from 'zod';

import { createGuestSession } from '@/server/auth/session';
import { resolveShareToken, touchShare } from '@/server/documents/shares';
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

    const { token, displayName } = await parseJson(request, joinSchema);

    const share = await resolveShareToken(token);
    if (!share) {
      throw new ApiError(404, 'This link is invalid, has expired, or was revoked.');
    }

    const guest = await createGuestSession(share.shareId, displayName);
    await touchShare(share.shareId);

    return json({
      documentId: share.documentId,
      role: share.role,
      displayName: guest.displayName,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
