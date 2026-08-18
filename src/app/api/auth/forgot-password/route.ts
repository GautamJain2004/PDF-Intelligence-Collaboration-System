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

      const result = await sendEmail({ to: email, ...mail });

      /*
       * Operator visibility.
       *
       * The response to the client is deliberately identical whether or not the
       * account exists, so a delivery failure is invisible from the outside.
       * Without a server-side signal an operator has no way to tell "no such
       * account" from "the email provider rejected it", so failures are logged
       * loudly here.
       */
      if (!result.sent) {
        console.error(
          `[auth] password reset email NOT delivered to ${email} (${result.reason}): ${result.message}`,
        );
      }

      /*
       * Development escape hatch.
       *
       * Printed to the server console only — never returned in the response.
       * Putting a reset link in the HTTP body would turn this endpoint into an
       * account-takeover primitive for anyone who could reach it, which is far
       * too dangerous to gate on NODE_ENV alone.
       */
      if (env().NODE_ENV !== 'production') {
        const banner = '='.repeat(78);
        console.info(
          `\n${banner}\n` +
            `PASSWORD RESET LINK (development only)\n` +
            `  account : ${email}\n` +
            `  expires : ${TTL_MINUTES} minutes, single use\n` +
            `  email   : ${result.sent ? 'delivered' : `not delivered (${result.reason})`}\n` +
            `\n  ${url}\n` +
            `${banner}\n`,
        );
      }
    } else if (env().NODE_ENV !== 'production') {
      // Also worth knowing locally: the address simply has no account.
      console.info(`[auth] password reset requested for unknown address: ${email}`);
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
