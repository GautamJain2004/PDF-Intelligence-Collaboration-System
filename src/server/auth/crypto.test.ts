import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Token hashing and share-token encryption.
 *
 * AUTH_SECRET must exist before these modules read env, so it is set here
 * rather than relying on a developer's local .env.
 */
beforeAll(() => {
  process.env.AUTH_SECRET ??= 'test-secret-at-least-32-characters-long!!';
  process.env.DATABASE_URL ??= 'postgresql://u:p@localhost:5432/db';
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
  process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= 'test-gemini-key';
});

describe('token hashing', () => {
  it('produces stable hashes and unique tokens', async () => {
    const { generateToken, hashToken, issueToken } = await import('./tokens');

    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));

    // 256 bits of entropy: collisions across a small sample are impossible.
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);

    // base64url only, so tokens are safe in a URL path without escaping.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);

    const issued = issueToken();
    expect(hashToken(issued.token)).toBe(issued.tokenHash);
    // The hash must not reveal the token.
    expect(issued.tokenHash).not.toContain(issued.token);
  });

  it('maps different tokens to different hashes', async () => {
    const { generateToken, hashToken } = await import('./tokens');
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });
});

describe('share token encryption', () => {
  it('round-trips a token', async () => {
    const { encryptToken, decryptToken } = await import('./crypto');
    const { generateToken } = await import('./tokens');

    const token = generateToken();
    expect(decryptToken(encryptToken(token))).toBe(token);
  });

  it('produces different ciphertext each time (random IV)', async () => {
    const { encryptToken, decryptToken } = await import('./crypto');

    const a = encryptToken('same-input');
    const b = encryptToken('same-input');

    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe('same-input');
    expect(decryptToken(b)).toBe('same-input');
  });

  it('rejects tampered ciphertext instead of returning garbage', async () => {
    const { encryptToken, decryptToken } = await import('./crypto');

    const payload = encryptToken('sensitive-token');
    const raw = Buffer.from(payload, 'base64');
    // Flip a bit in the ciphertext body; GCM's auth tag must catch it.
    raw[raw.length - 1] ^= 0xff;

    expect(decryptToken(raw.toString('base64'))).toBeNull();
  });

  it('returns null for malformed input rather than throwing', async () => {
    const { decryptToken } = await import('./crypto');

    expect(decryptToken('')).toBeNull();
    expect(decryptToken('not-base64-!!')).toBeNull();
    expect(decryptToken(Buffer.from('short').toString('base64'))).toBeNull();
  });

  it('does not leak the plaintext into the ciphertext', async () => {
    const { encryptToken } = await import('./crypto');
    const secret = 'a-very-recognisable-token-value';
    expect(encryptToken(secret)).not.toContain(secret);
  });
});
