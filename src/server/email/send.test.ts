import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Share invitations are sent from a single app-owned mailbox on behalf of
 * whichever user shared the document. Reply-To is therefore the only header
 * carrying the real correspondent — if it is dropped, replies silently reach
 * the deployment operator instead of the sharer, which no test of the share
 * route itself would catch.
 */

const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' });

vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail, verify: vi.fn() }) },
}));

const BASE = {
  AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  OPENAI_API_KEY: 'test-openai-key',
  EMAIL_FROM: 'PDF Intelligence <app@gmail.com>',
  SMTP_USER: 'app@gmail.com',
  SMTP_PASS: 'abcdefghijklmnop',
};

async function loadSend() {
  vi.resetModules();
  Object.assign(process.env, BASE);
  delete process.env.RESEND_API_KEY;
  return import('./send');
}

beforeEach(() => {
  sendMail.mockClear();
});

describe('sendEmail', () => {
  it('routes replies to the sharer, not the sending mailbox', async () => {
    const { sendEmail } = await loadSend();

    const result = await sendEmail({
      to: 'invitee@example.com',
      replyTo: 'sharer@example.com',
      subject: 'Alice shared "contract.pdf" with you',
      html: '<p>hi</p>',
      text: 'hi',
    });

    expect(result.sent).toBe(true);

    const sent = sendMail.mock.calls[0][0];
    expect(sent.replyTo).toBe('sharer@example.com');
    // From stays the authenticated mailbox — Gmail rewrites it regardless.
    expect(sent.from).toBe('PDF Intelligence <app@gmail.com>');
    expect(sent.to).toBe('invitee@example.com');
  });

  it('omits Reply-To entirely for system mail such as password resets', async () => {
    const { sendEmail } = await loadSend();

    await sendEmail({
      to: 'user@example.com',
      subject: 'Reset your password',
      html: '<p>reset</p>',
      text: 'reset',
    });

    // Absent rather than undefined: a stray header invites replies to a mailbox
    // nobody reads.
    expect(sendMail.mock.calls[0][0]).not.toHaveProperty('replyTo');
  });

  it('reports an auth failure as fixable rather than generic', async () => {
    const { sendEmail } = await loadSend();

    sendMail.mockRejectedValueOnce(
      Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), {
        code: 'EAUTH',
      }),
    );

    const result = await sendEmail({
      to: 'invitee@example.com',
      subject: 's',
      html: 'h',
      text: 't',
    });

    expect(result.sent).toBe(false);
    if (result.sent) return;
    expect(result.reason).toBe('auth-failed');
    expect(result.message).toMatch(/App Password/i);
  });
});
