import { describe, expect, it } from 'vitest';

import { loginSchema, passwordSchema, signupSchema, resetPasswordSchema } from './validation';

/** Fails only the class under test, so each case isolates one rule. */
const STRONG = 'Sunflower9!';

function reject(password: string): string {
  const result = passwordSchema.safeParse(password);
  expect(result.success).toBe(false);
  return result.error!.issues.map((i) => i.message).join(' ');
}

describe('passwordSchema', () => {
  it('accepts a password drawing on all four classes', () => {
    expect(passwordSchema.safeParse(STRONG).success).toBe(true);
  });

  it('requires an uppercase letter', () => {
    expect(reject('sunflower9!')).toContain('an uppercase letter');
  });

  it('requires a lowercase letter', () => {
    expect(reject('SUNFLOWER9!')).toContain('a lowercase letter');
  });

  it('requires a number', () => {
    expect(reject('Sunflowers!')).toContain('a number');
  });

  it('requires a special character', () => {
    expect(reject('Sunflower99')).toContain('a special character');
  });

  it('names every missing class in a single message', () => {
    const message = reject('sunflowers');
    expect(message).toContain('an uppercase letter');
    expect(message).toContain('a number');
    expect(message).toContain('a special character');
    // Read as prose rather than a bare list.
    expect(message).toContain(' and ');
  });

  it('still enforces the length bounds', () => {
    expect(reject('Ab1!')).toContain('at least 8 characters');
    expect(reject(`${'Aa1!'.repeat(40)}`)).toContain('at most 128 characters');
  });

  it('counts symbols outside ASCII punctuation as special', () => {
    // The rule is "not alphanumeric", so this must not be rejected for lacking
    // a special character.
    expect(passwordSchema.safeParse('Sunflower9é').success).toBe(true);
  });

  it('applies to signup and password reset', () => {
    expect(
      signupSchema.safeParse({ name: 'Ada', email: 'a@b.co', password: 'weakpassword' })
        .success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token: 't', password: 'weakpassword' }).success,
    ).toBe(false);
  });
});

/**
 * The regression this guards is account lockout, not validation.
 *
 * Every account created before the complexity rules holds a valid hash of a
 * password those rules would now reject. If sign-in ever validated the
 * submitted plaintext, those users could never authenticate again — the check
 * would fail before the hash comparison ran.
 */
describe('loginSchema (existing accounts must keep working)', () => {
  it('accepts a weak legacy password', () => {
    const legacy = { email: 'ada@example.com', password: 'password' };
    expect(loginSchema.safeParse(legacy).success).toBe(true);
  });

  it('accepts passwords far below the new bar', () => {
    for (const password of ['abc', 'letmein', '12345678', 'x']) {
      expect(loginSchema.safeParse({ email: 'a@b.co', password }).success).toBe(true);
    }
  });

  it('still requires a password to be present', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});
