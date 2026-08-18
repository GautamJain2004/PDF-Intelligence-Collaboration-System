import 'server-only';

import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';

import { env, emailTransport } from '@/lib/env';

/**
 * Email delivery.
 *
 * Email is a notification layer, never a correctness dependency: sharing and
 * password reset both work when delivery is unconfigured or fails. Failures are
 * caught and reported rather than thrown, so a provider outage cannot break a
 * share operation that has already succeeded in the database.
 *
 * Two transports are supported and chosen by configuration (see
 * `emailTransport`):
 *
 *   SMTP    — the default, because it can deliver to ARBITRARY recipients. A
 *             Gmail App Password needs no domain and no DNS, which is what
 *             makes "share this PDF with anyone" actually work.
 *
 *   Resend  — kept as a fallback for deployments that already have a verified
 *             sending domain. Without one, Resend's shared sandbox sender
 *             refuses every recipient except the account owner's own address,
 *             which is exactly the failure this module is careful to explain.
 *
 * Delivery failures carry a human-readable explanation back to the caller. A
 * generic "could not send" leaves the user with no idea why or how to fix it.
 */

let resendClient: Resend | null = null;
let smtpTransport: Transporter | null = null;

function getResend(): Resend {
  resendClient ??= new Resend(env().RESEND_API_KEY!);
  return resendClient;
}

/**
 * Lazily built SMTP transport.
 *
 * Deliberately unpooled: on serverless each invocation is a fresh, short-lived
 * process, so a connection pool would be torn down before it were ever reused
 * and only adds shutdown races. Timeouts are explicit so a network black-hole
 * fails in seconds rather than hanging the share request.
 */
function getSmtp(): Transporter {
  if (!smtpTransport) {
    const e = env();
    smtpTransport = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      // 465 is implicit TLS; 587 negotiates STARTTLS after connecting.
      secure: e.SMTP_PORT === 465,
      auth: { user: e.SMTP_USER!, pass: e.SMTP_PASS! },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return smtpTransport;
}

export type SendFailureReason =
  | 'not-configured'
  | 'sandbox-restricted'
  | 'auth-failed'
  | 'failed';

export type SendResult =
  | { sent: true }
  | {
      sent: false;
      reason: SendFailureReason;
      /** Safe to show a signed-in owner; explains the failure and the fix. */
      message: string;
    };

/** Trailing sentence shared by every failure path. */
const FALLBACK = 'The share link below still works — send it manually in the meantime.';

/**
 * Turns a provider error into something actionable.
 *
 * Each branch is a distinct configuration state with a distinct fix, so they
 * get distinct reasons rather than collapsing into one opaque failure.
 */
function interpretError(
  error: { name?: string; message?: string; code?: string; responseCode?: number } | Error,
): { reason: SendFailureReason; message: string } {
  const raw = 'message' in error && error.message ? error.message : '';
  const code = 'code' in error ? error.code : undefined;
  const responseCode = 'responseCode' in error ? error.responseCode : undefined;

  // Resend sandbox: 403 naming the account owner's address when no domain is
  // verified. A configuration state, not a transient fault.
  if (/only send testing emails to your own/i.test(raw) || /verify a domain/i.test(raw)) {
    return {
      reason: 'sandbox-restricted',
      message:
        'Your email provider is in sandbox mode and will only deliver to the ' +
        'account owner’s own address. Switch to SMTP (set SMTP_USER and ' +
        `SMTP_PASS) or verify a sending domain to email anyone else. ${FALLBACK}`,
    };
  }

  // SMTP rejected the credentials. Overwhelmingly this is a Gmail account
  // password used where an App Password is required.
  if (code === 'EAUTH' || responseCode === 535 || /invalid login|username and password not accepted/i.test(raw)) {
    return {
      reason: 'auth-failed',
      message:
        'The mail server rejected the login. For Gmail, SMTP_PASS must be a ' +
        '16-character App Password generated with 2-Step Verification on — not ' +
        `the account password. ${FALLBACK}`,
    };
  }

  if (code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ESOCKET') {
    return {
      reason: 'failed',
      message: `Could not reach the mail server (${code}). ${FALLBACK}`,
    };
  }

  if (/invalid `?to`?/i.test(raw) || responseCode === 550) {
    return {
      reason: 'failed',
      message: `That recipient address was rejected by the mail server. ${FALLBACK}`,
    };
  }

  return {
    reason: 'failed',
    message: `The notification email could not be sent. ${FALLBACK}`,
  };
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Where replies should go, when that is not the sending mailbox.
   *
   * Invitations are sent from one app-owned mailbox on behalf of whichever user
   * shared the document, so without this a recipient hitting Reply would write
   * to the deployment operator instead of the person who shared with them.
   * Providers rewrite From to the authenticated sender regardless, so Reply-To
   * is the header that can carry the real correspondent.
   */
  replyTo?: string;
}): Promise<SendResult> {
  const transport = emailTransport();

  if (!transport) {
    console.info(
      `[email] skipped "${params.subject}" -> ${params.to} ` +
        '(set EMAIL_FROM plus either SMTP_USER/SMTP_PASS or RESEND_API_KEY)',
    );
    return {
      sent: false,
      reason: 'not-configured',
      message: `Email delivery is not configured on this deployment. ${FALLBACK}`,
    };
  }

  try {
    if (transport === 'smtp') {
      await getSmtp().sendMail({
        from: env().EMAIL_FROM!,
        to: params.to,
        ...(params.replyTo ? { replyTo: params.replyTo } : {}),
        subject: params.subject,
        html: params.html,
        text: params.text,
      });
    } else {
      const { error } = await getResend().emails.send({
        from: env().EMAIL_FROM!,
        to: params.to,
        ...(params.replyTo ? { replyTo: params.replyTo } : {}),
        subject: params.subject,
        html: params.html,
        text: params.text,
      });

      // Resend reports failures in the body rather than by throwing.
      if (error) throw error;
    }

    console.info(`[email] sent via ${transport} -> ${params.to}: "${params.subject}"`);
    return { sent: true };
  } catch (error) {
    const interpreted = interpretError(error as Error);
    console.error(
      `[email] delivery failed via ${transport} (${interpreted.reason}) -> ${params.to}:`,
      (error as Error)?.message ?? error,
    );
    return { sent: false, ...interpreted };
  }
}

/**
 * Verifies the configured transport can authenticate, without sending anything.
 *
 * Used by the setup script so a misconfigured App Password is caught at config
 * time rather than discovered by an invite that silently never arrives.
 */
export async function verifyEmailTransport(): Promise<SendResult> {
  const transport = emailTransport();

  if (!transport) {
    return {
      sent: false,
      reason: 'not-configured',
      message: 'No email transport configured.',
    };
  }

  // Resend exposes no cheap credential check; SMTP does.
  if (transport === 'resend') return { sent: true };

  try {
    await getSmtp().verify();
    return { sent: true };
  } catch (error) {
    return { sent: false, ...interpretError(error as Error) };
  }
}
