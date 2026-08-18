import { eq } from 'drizzle-orm';

import { db } from '@/server/db/client';
import { users, passwordResetTokens } from '@/server/db/schema';
import { issueToken } from '@/server/auth/tokens';
import { forgotPasswordSchema } from '@/lib/validation';
import { clientIp, handleApiError, json, parseJson, rateLimited } from '@/lib/api';
import { LIMITS, rateLimit } from '@/lib/rate-limit';
import { sendEmail } from '@/server/email/send';
import { passwordResetEmail } from '@/server/email/templates';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

const TTL_MINUTES = 30;

export async function POST(request: Request) {
  try {
    const limit = rateLimit(`forgot:${clientIp(request)}`, LIMITS.passwordReset);
    if (!limit.ok) throw rateLimited('Too many reset requests. Try again later.');

    const { email } = await parseJson(request, forgotPasswordSchema);

    const [user] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user) {
      const { token, tokenHash } = issueToken();

      await db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + TTL_MINUTES * 60 * 1000),
      });

      const url = `${env().APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
      const mail = passwordResetEmail({ name: user.name, url, ttlMinutes: TTL_MINUTES });

      await sendEmail({ to: email, ...mail });

      // Development aid: without a Resend key there is no other way to complete
      // the flow locally. Never logged in production.
      if (env().NODE_ENV !== 'production') {
        console.info(`[auth] password reset link for ${email}: ${url}`);
      }
    }

    // Always the same response, whether or not the account exists — otherwise
    // this endpoint becomes a registered-email oracle.
    return json({
      ok: true,
      message: 'If an account exists for that email, a reset link is on its way.',
    });
  } catch (error) {
    return handleApiError(error);
  }
}
