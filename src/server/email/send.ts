import 'server-only';

import { Resend } from 'resend';

import { env, isEmailEnabled } from '@/lib/env';

/**
 * Email delivery.
 *
 * Email is a notification layer, never a correctness dependency: sharing and
 * password reset both work when delivery is unconfigured or fails. Failures are
 * caught and reported rather than thrown, so a provider outage cannot break a
 * share operation that has already succeeded in the database.
 *
 * Delivery failures carry a human-readable explanation back to the caller. The
 * common one is Resend's sandbox restriction — without a verified sending
 * domain it refuses every recipient except the account owner's own address —
 * and a generic "could not send" leaves the user with no idea why or how to fix
 * it.
 */

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!isEmailEnabled()) return null;
  client ??= new Resend(env().RESEND_API_KEY!);
  return client;
}

export type SendFailureReason = 'not-configured' | 'sandbox-restricted' | 'failed';

export type SendResult =
  | { sent: true }
  | {
      sent: false;
      reason: SendFailureReason;
      /** Safe to show a signed-in owner; explains the failure and the fix. */
      message: string;
    };

/**
 * Turns a provider error into something actionable.
 *
 * Resend returns 403 with a message naming the account owner's address when no
 * domain is verified. That is a configuration state, not a transient fault, so
 * it gets its own reason and its own guidance.
 */
function interpretError(error: { name?: string; message?: string } | Error): {
  reason: SendFailureReason;
  message: string;
} {
  const raw = 'message' in error && error.message ? error.message : '';

  if (/only send testing emails to your own/i.test(raw) || /verify a domain/i.test(raw)) {
    return {
      reason: 'sandbox-restricted',
      message:
        'Your email provider is in sandbox mode and will only deliver to the ' +
        'account owner’s own address. Verify a sending domain to email anyone else. ' +
        'The share link below still works — send it manually in the meantime.',
    };
  }

  if (/invalid `?to`?/i.test(raw)) {
    return {
      reason: 'failed',
      message:
        'That recipient address was rejected by the email provider. The share ' +
        'link below still works — send it manually.',
    };
  }

  return {
    reason: 'failed',
    message:
      'The notification email could not be sent. The share link below still ' +
      'works — send it manually.',
  };
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const resend = getClient();

  if (!resend) {
    console.info(
      `[email] skipped "${params.subject}" -> ${params.to} ` +
        '(RESEND_API_KEY / EMAIL_FROM not set)',
    );
    return {
      sent: false,
      reason: 'not-configured',
      message:
        'Email delivery is not configured on this deployment. The share link ' +
        'below still works — send it manually.',
    };
  }

  try {
    const { error } = await resend.emails.send({
      from: env().EMAIL_FROM!,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });

    if (error) {
      const interpreted = interpretError(error);
      console.error(
        `[email] delivery failed (${interpreted.reason}) -> ${params.to}:`,
        error.message ?? error,
      );
      return { sent: false, ...interpreted };
    }

    return { sent: true };
  } catch (error) {
    const interpreted = interpretError(error as Error);
    console.error(`[email] threw -> ${params.to}:`, error);
    return { sent: false, ...interpreted };
  }
}
