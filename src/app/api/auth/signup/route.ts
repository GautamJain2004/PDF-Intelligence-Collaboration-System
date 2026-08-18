import { eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { users } from '@/server/db/schema';
import { hashPassword } from '@/server/auth/password';
import { createUserSession } from '@/server/auth/session';
import { signupSchema } from '@/lib/validation';
import { ApiError, clientIp, handleApiError, json, parseJson, rateLimited } from '@/lib/api';
import { LIMITS, rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const limit = rateLimit(`signup:${clientIp(request)}`, LIMITS.signup);
    if (!limit.ok) throw rateLimited('Too many sign-up attempts. Try again later.');

    const { name, email, password } = await parseJson(request, signupSchema);

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      // Account enumeration trade-off: signup genuinely needs to tell the user
      // their email is taken, otherwise the form is unusable. The sensitive
      // paths (login, password reset) stay generic.
      throw new ApiError(409, 'An account with this email already exists.', {
        email: 'An account with this email already exists.',
      });
    }

    const passwordHash = await hashPassword(password);

    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash })
      .returning({ id: users.id, name: users.name, email: users.email });

    await createUserSession(user.id, {
      userAgent: request.headers.get('user-agent'),
      ipAddress: clientIp(request),
    });

    return json({ user }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
