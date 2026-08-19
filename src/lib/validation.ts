import { z } from 'zod';

/**
 * Password bounds live here, not in the server-only hashing module, so that
 * client components can import this file without pulling secrets into the
 * browser bundle.
 */
export const MIN_PASSWORD_LENGTH = 8;
/** Bounded to avoid CPU exhaustion via a multi-megabyte "password". */
export const MAX_PASSWORD_LENGTH = 128;

/**
 * Shared request schemas.
 *
 * Defined once and used on both sides: the client gets instant feedback, the
 * server treats every input as hostile and re-validates. Client validation is
 * UX; these same schemas running server-side are the actual control.
 */

/** Hard ceiling on uploads, enforced before signing and again after upload. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_FILENAME_LENGTH = 255;

export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required.')
  .max(320, 'Email is too long.')
  .toLowerCase()
  .refine(
    (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v),
    'Enter a valid email address.',
  );

/**
 * Character classes a new password must draw from.
 *
 * "Special" is defined as anything outside the other three classes rather than
 * an explicit punctuation list, so accented letters, symbols and non-Latin
 * scripts all count instead of being silently rejected.
 */
const PASSWORD_CLASSES = [
  { label: 'a lowercase letter', pattern: /[a-z]/ },
  { label: 'an uppercase letter', pattern: /[A-Z]/ },
  { label: 'a number', pattern: /[0-9]/ },
  { label: 'a special character', pattern: /[^a-zA-Z0-9]/ },
] as const;

/** "a, b and c" — so the error names every missing class in one message. */
function listMissing(items: string[]): string {
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Shown under the password field so the rules are visible before submitting. */
export const PASSWORD_HINT =
  `At least ${MIN_PASSWORD_LENGTH} characters, including upper and lower case, ` +
  `a number, and a special character.`;

/**
 * Rules for choosing a NEW password — signup and reset only.
 *
 * Deliberately not used by `loginSchema`. Applying it there would lock out
 * every account created before these rules existed: their stored hash is still
 * valid, but the plaintext they type would fail validation before it was ever
 * compared. Complexity is a constraint on what may be *set*, never on what may
 * be *submitted for verification* — see the note on `loginSchema` below.
 */
export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`)
  .superRefine((value, ctx) => {
    const missing = PASSWORD_CLASSES.filter((c) => !c.pattern.test(value)).map(
      (c) => c.label,
    );
    if (missing.length === 0) return;

    ctx.addIssue({
      code: 'custom',
      message: `Password must include ${listMissing(missing)}.`,
    });
  });

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required.')
  .max(80, 'Name must be 80 characters or fewer.');

export const signupSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

/**
 * Sign-in accepts any non-empty password ON PURPOSE.
 *
 * Do not "tidy" this to reuse `passwordSchema`. Accounts created before the
 * complexity rules landed hold perfectly valid hashes of passwords that would
 * now fail those rules; validating the submitted plaintext would reject them
 * before it ever reached the hash comparison, locking out every existing user.
 *
 * It also leaks nothing: a rejection here would tell an attacker their guess
 * was malformed rather than merely wrong, which is a distinction the login
 * response is otherwise careful never to make.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required.'),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required.'),
  password: passwordSchema,
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const signUploadSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, 'Filename is required.')
    .max(MAX_FILENAME_LENGTH, 'Filename is too long.')
    .refine((v) => v.toLowerCase().endsWith('.pdf'), 'Only PDF files are supported.'),
  size: z
    .number()
    .int()
    .positive('File appears to be empty.')
    .max(MAX_UPLOAD_BYTES, 'PDF must be 25 MB or smaller.'),
  contentType: z
    .string()
    .refine((v) => v === 'application/pdf', 'Only PDF files are supported.'),
});

export const searchSchema = z.object({
  q: z.string().trim().max(200).optional().default(''),
  /** `semantic` embeds the query; `filename` is a plain substring match. */
  mode: z.enum(['filename', 'semantic']).optional().default('filename'),
  /** 1-based. Coerced because it arrives as a query string. */
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  status: z.enum(['all', 'ready', 'processing', 'failed']).optional().default('all'),
});

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export const createShareSchema = z.object({
  /** Omitted for an open link; present to email a specific invitee. */
  email: emailSchema.optional(),
  role: z.enum(['viewer', 'commenter']).default('commenter'),
});

export const guestJoinSchema = z.object({
  /**
   * Which button the visitor pressed. Sent explicitly because a live session no
   * longer implies intent: someone signed in may deliberately choose to take
   * part as a guest, and inferring from the cookie would override that.
   */
  mode: z.enum(['guest', 'account']).optional(),
  /**
   * Identifies a returning visitor so their name and comment attribution carry
   * across share links. Never verified and never a credential — access comes
   * from the share token alone.
   */
  email: emailSchema.optional(),
  /** Optional: a remembered name is reused, and a new one is derived from the address. */
  displayName: z
    .string()
    .trim()
    .min(1, 'Please enter a name so others know who commented.')
    .max(60, 'Name must be 60 characters or fewer.')
    .optional(),
});

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const MAX_COMMENT_LENGTH = 5000;

export const createCommentSchema = z.object({
  /** Untrusted HTML from the rich-text editor; sanitised server-side. */
  bodyHtml: z
    .string()
    .min(1, 'Comment cannot be empty.')
    .max(MAX_COMMENT_LENGTH, 'Comment is too long.'),
  parentId: z.string().uuid().nullable().optional(),
  pageNumber: z.number().int().min(1).max(10_000).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export const MAX_QUESTION_LENGTH = 2000;

export const chatSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, 'Ask a question about this document.')
    .max(MAX_QUESTION_LENGTH, 'Question is too long.'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateShareInput = z.infer<typeof createShareSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
