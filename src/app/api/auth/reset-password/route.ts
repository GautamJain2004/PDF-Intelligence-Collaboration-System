import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { users, passwordResetTokens } from '@/server/db/schema';
import { hashToken } from '@/server/auth/tokens';
import { hashPassword } from '@/server/auth/password';
import { createUserSession, destroyAllUserSessions } from '@/server/auth/session';
import { resetPasswordSchema } from '@/lib/validation';
import { ApiError, clientIp, handleApiError, json, parseJson, rateLimited } from '@/lib/api';
import { LIMITS, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const limit = rateLimit(`reset:${clientIp(request)}`, LIMITS.passwordReset);
    if (!limit.ok) throw rateLimited('Too many attempts. Try again later.');

    const { token, password } = await parseJson(request, resetPasswordSchema);

    // Validity is decided in SQL: unexpired, unused, and matching the hash.
    const [row] = await db
      .select({ id: passwordResetTokens.id, userId: passwordResetTokens.userId })
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hashToken(token)),
          gt(passwordResetTokens.expiresAt, new Date()),
          isNull(passwordResetTokens.usedAt),
        ),
      )
      .limit(1);

    if (!row) {
      throw new ApiError(400, 'This reset link is invalid or has expired.');
    }

    const passwordHash = await hashPassword(password);

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: new Date() })
        .where(eq(users.id, row.userId));

      // Single use: burn the token inside the same transaction so a replay
      // cannot slip through concurrently.
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.id));
    });

    // A reset is the remedy for a compromised account, so every existing
    // session must die — including any the attacker holds.
    await destroyAllUserSessions(row.userId);

    await createUserSession(row.userId, {
      userAgent: request.headers.get('user-agent'),
      ipAddress: clientIp(request),
    });

    return json({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
