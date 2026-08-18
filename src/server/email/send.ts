import 'server-only';

import { Resend } from 'resend';

import { env, isEmailEnabled } from '@/lib/env';

/**
 * Email delivery.
 *
 * Email is a notification layer, never a correctness dependency: sharing and
 * password reset both work when delivery is unconfigured or fails. Failures are
 * logged and swallowed so a Resend outage cannot break a share operation that
 * has already succeeded in the database.
 *
 * Known limitation: on a Resend account without a verified sending domain,
 * delivery is restricted to the account owner's own address. Share links are
 * always shown in the UI for copying, so this degrades gracefully.
 */

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!isEmailEnabled()) return null;
  client ??= new Resend(env().RESEND_API_KEY!);
  return client;
}

export type SendResult =
  | { sent: true }
  | { sent: false; reason: 'not-configured' | 'failed' };

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const resend = getClient();

  if (!resend) {
    console.info(
      `[email] skipped "${params.subject}" -> ${params.to} (RESEND_API_KEY/EMAIL_FROM not set)`,
    );
    return { sent: false, reason: 'not-configured' };
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
      console.error('[email] delivery failed:', error);
      return { sent: false, reason: 'failed' };
    }
    return { sent: true };
  } catch (error) {
    console.error('[email] threw:', error);
    return { sent: false, reason: 'failed' };
  }
}
