import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Email transport selection.
 *
 * This is the logic that decides whether a share invitation can reach an
 * arbitrary recipient at all, and it is driven purely by which variables happen
 * to be set in a deployment — the exact kind of thing that silently regresses.
 *
 * `env()` caches its parse, so every case resets the module registry to get a
 * fresh read rather than the first case's result.
 */
const BASE = {
  AUTH_SECRET: 'test-secret-at-least-32-characters-long!!',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  OPENAI_API_KEY: 'test-openai-key',
};

const EMAIL_KEYS = [
  'EMAIL_FROM',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_HOST',
  'SMTP_PORT',
  'RESEND_API_KEY',
] as const;

async function loadWith(overrides: Record<string, string>) {
  vi.resetModules();
  Object.assign(process.env, BASE);
  // Cleared explicitly: a developer's real .env would otherwise leak in and
  // make these assertions depend on the machine they run on.
  for (const key of EMAIL_KEYS) delete process.env[key];
  Object.assign(process.env, overrides);
  return import('./env');
}

beforeEach(() => {
  vi.resetModules();
});

describe('emailTransport', () => {
  it('is disabled when nothing is configured', async () => {
    const { emailTransport, isEmailEnabled } = await loadWith({});
    expect(emailTransport()).toBeNull();
    expect(isEmailEnabled()).toBe(false);
  });

  it('selects SMTP when credentials are present', async () => {
    const { emailTransport, isEmailEnabled } = await loadWith({
      EMAIL_FROM: 'PDF Intelligence <you@gmail.com>',
      SMTP_USER: 'you@gmail.com',
      SMTP_PASS: 'abcdefghijklmnop',
    });
    expect(emailTransport()).toBe('smtp');
    expect(isEmailEnabled()).toBe(true);
  });

  it('defaults to Gmail submission over implicit TLS', async () => {
    const { env } = await loadWith({
      EMAIL_FROM: 'you@gmail.com',
      SMTP_USER: 'you@gmail.com',
      SMTP_PASS: 'abcdefghijklmnop',
    });
    expect(env().SMTP_HOST).toBe('smtp.gmail.com');
    // Numeric, not the string from process.env — `secure` is chosen by ===.
    expect(env().SMTP_PORT).toBe(465);
  });

  it('falls back to Resend when SMTP is not configured', async () => {
    const { emailTransport } = await loadWith({
      EMAIL_FROM: 'PDF Intelligence <onboarding@resend.dev>',
      RESEND_API_KEY: 're_test_key',
    });
    expect(emailTransport()).toBe('resend');
  });

  it('prefers SMTP over Resend when both are configured', async () => {
    // The deployment this fix was written for: leftover Resend credentials that
    // can only reach the account owner, alongside working SMTP.
    const { emailTransport } = await loadWith({
      EMAIL_FROM: 'you@gmail.com',
      SMTP_USER: 'you@gmail.com',
      SMTP_PASS: 'abcdefghijklmnop',
      RESEND_API_KEY: 're_test_key',
    });
    expect(emailTransport()).toBe('smtp');
  });

  it('stays disabled without a sender identity', async () => {
    // A message with no From is undeliverable, so half-configured is off.
    const { emailTransport } = await loadWith({
      SMTP_USER: 'you@gmail.com',
      SMTP_PASS: 'abcdefghijklmnop',
    });
    expect(emailTransport()).toBeNull();
  });

  it('ignores a user without a password', async () => {
    const { emailTransport } = await loadWith({
      EMAIL_FROM: 'you@gmail.com',
      SMTP_USER: 'you@gmail.com',
    });
    expect(emailTransport()).toBeNull();
  });
});
