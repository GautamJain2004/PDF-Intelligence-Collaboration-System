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

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);

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
});

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export const createShareSchema = z.object({
  /** Omitted for an open link; present to email a specific invitee. */
  email: emailSchema.optional(),
  role: z.enum(['viewer', 'commenter']).default('commenter'),
  /** Optional link lifetime; null/omitted means it does not expire. */
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export const guestJoinSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Please enter a name so others know who commented.')
    .max(60, 'Name must be 60 characters or fewer.'),
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
