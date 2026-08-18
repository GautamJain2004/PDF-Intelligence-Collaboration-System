import { eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { createUserSession } from '@/server/auth/session';
import { loginSchema } from '@/lib/validation';
import { ApiError, clientIp, handleApiError, json, parseJson, rateLimited } from '@/lib/api';
import { LIMITS, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

/**
 * Decoy hash for the unknown-email path.
 *
 * Without it, a missing account returns before Argon2 runs and the response is
 * measurably faster than a wrong password — a timing oracle for enumerating
 * registered emails. Verifying against this throwaway hash makes both paths do
 * the same work. Built lazily once per instance.
 */
let decoyHash: Promise<string> | null = null;
function getDecoyHash() {
  decoyHash ??= hashPassword('decoy-password-not-a-real-credential');
  return decoyHash;
}

export async function POST(request: Request) {
  try {
    const limit = rateLimit(`login:${clientIp(request)}`, LIMITS.auth);
    if (!limit.ok) {
      throw rateLimited('Too many sign-in attempts. Please try again in a few minutes.');
    }

    const { email, password } = await parseJson(request, loginSchema);

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const valid = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyPassword(await getDecoyHash(), password);

    if (!user || !valid) {
      // Deliberately identical for "no such user" and "wrong password".
      throw new ApiError(401, 'Invalid email or password.');
    }

    await createUserSession(user.id, {
      userAgent: request.headers.get('user-agent'),
      ipAddress: clientIp(request),
    });

    return json({
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
