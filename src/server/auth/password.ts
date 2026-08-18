import 'server-only';

import { hash, verify } from '@node-rs/argon2';

import { MAX_PASSWORD_LENGTH } from '@/lib/validation';

/**
 * Password hashing with Argon2id.
 *
 * Argon2id is the OWASP-recommended default: it resists both GPU and
 * side-channel attacks, unlike bcrypt (GPU-friendly) or plain SHA (unusable for
 * passwords). Parameters follow the OWASP minimum of 19 MiB memory / 2
 * iterations, which costs roughly 50-100 ms per hash on typical serverless
 * hardware — slow enough to make offline cracking expensive, fast enough not to
 * hurt login latency.
 *
 * The salt is generated per-hash by the library and embedded in the returned
 * PHC string, so no separate salt column is needed.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Password exceeds maximum length');
  }
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed hash so that callers cannot
 * accidentally distinguish "corrupt record" from "wrong password" — both are
 * simply a failed login.
 */
export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  try {
    return await verify(storedHash, password, ARGON2_OPTIONS);
  } catch {
    return false;
  }
}
