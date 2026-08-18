import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

import { env } from '@/lib/env';

/**
 * Reversible encryption for share tokens.
 *
 * Session and password-reset tokens are stored as one-way hashes, because
 * nothing ever needs to read them back. Share links are different: an owner
 * expects to reopen the share dialog and copy the same link again. Hashing
 * alone would make that impossible, and the usual workaround — keeping the
 * plaintext token in a column — means a single SQL injection or leaked backup
 * hands the attacker working links to every shared document.
 *
 * So share tokens are stored twice:
 *  - `token_hash`   — keyed SHA-256, for indexed constant-time lookup.
 *  - `token_encrypted` — AES-256-GCM, so the owner can redisplay the link.
 *
 * The encryption key derives from AUTH_SECRET, which lives in the environment
 * and never in the database. A database-only compromise therefore yields
 * ciphertext, not links. GCM is authenticated, so tampered ciphertext fails to
 * decrypt rather than silently returning garbage.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12; // 96 bits, the standard nonce size for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Static salt.
 *
 * Safe here because the input (AUTH_SECRET) is high-entropy, not a password.
 * The salt exists to domain-separate this key from any other use of the secret,
 * so it does not need to be unpredictable.
 */
const KEY_SALT = 'pdfiq-share-token-encryption-v1';

let cachedKey: Buffer | null = null;

function key(): Buffer {
  // scrypt is deliberate but only paid once per process, not per operation.
  cachedKey ??= scryptSync(env().AUTH_SECRET, KEY_SALT, KEY_LENGTH);
  return cachedKey;
}

/**
 * Encrypts a token.
 *
 * Output is `base64(iv || authTag || ciphertext)` — a fresh random IV per call,
 * so encrypting the same token twice never produces the same ciphertext.
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

/**
 * Decrypts a token, returning null if the payload is malformed or tampered
 * with. Callers treat null as "link unavailable" rather than crashing — a
 * corrupt row should not break the whole share list.
 */
export function decryptToken(payload: string): string | null {
  try {
    const raw = Buffer.from(payload, 'base64');
    if (raw.length <= IV_LENGTH + AUTH_TAG_LENGTH) return null;

    const iv = raw.subarray(0, IV_LENGTH);
    const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(ALGORITHM, key(), iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    // Wrong key (AUTH_SECRET rotated) or tampered ciphertext.
    return null;
  }
}
