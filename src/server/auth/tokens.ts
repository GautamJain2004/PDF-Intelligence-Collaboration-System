import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { env } from '@/lib/env';

/**
 * Opaque token generation and verification.
 *
 * Every long-lived secret in this app (session cookies, share links, guest
 * cookies, password-reset links) follows the same rule: the plaintext token is
 * returned to the caller exactly once, and only a keyed hash is persisted.
 * A database leak therefore yields no usable credentials.
 */

/** 256 bits of CSPRNG entropy — infeasible to enumerate or guess. */
const TOKEN_BYTES = 32;

/**
 * URL-safe random token.
 *
 * base64url rather than hex keeps share links short enough to paste into chat
 * without wrapping, at the same entropy.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Keyed (peppered) SHA-256 of a token.
 *
 * The AUTH_SECRET pepper means an attacker with only the database cannot
 * precompute or brute-force hashes offline. SHA-256 (not Argon2) is correct
 * here: these are 256-bit random tokens, not low-entropy user passwords, so
 * there is nothing to slow-hash against — and this runs on every request.
 */
export function hashToken(token: string): string {
  return createHash('sha256')
    .update(`${env().AUTH_SECRET}:${token}`)
    .digest('hex');
}

/** Issues a token alongside the hash to persist. */
export function issueToken(): { token: string; tokenHash: string } {
  const token = generateToken();
  return { token, tokenHash: hashToken(token) };
}
