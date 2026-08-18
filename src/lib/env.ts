import { z } from 'zod';

/**
 * Server-side environment validation.
 *
 * This module must NEVER be imported from a Client Component. It intentionally
 * reads secrets (LLM keys, service-role keys, DB credentials). Importing it into
 * client code would be a build-time leak, so `server-only` is imported first to
 * make that a hard compile error rather than a silent security bug.
 */
import 'server-only';

const urlish = z
  .string()
  .min(1)
  .refine((v) => /^https?:\/\//.test(v), 'must be an http(s) URL');

const serverEnvSchema = z.object({
  // --- Database -------------------------------------------------------------
  /** Pooled connection (Supabase pgBouncer, port 6543) used by the running app. */
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Direct connection (port 5432). Required for drizzle-kit migrations/DDL. */
  DIRECT_URL: z.string().min(1).optional(),

  // --- Auth -----------------------------------------------------------------
  /**
   * Server-side pepper mixed into session/share token hashes. Rotating this
   * invalidates every session and share link, which is the desired blast radius
   * for a suspected leak.
   */
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),

  // --- Storage --------------------------------------------------------------
  SUPABASE_URL: urlish,
  /** Service-role key. Server-only: bypasses RLS, must never reach the browser. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default('pdfs'),

  // --- AI -------------------------------------------------------------------
  /**
   * OpenAI key. Server-only; powers summaries, chat, and embeddings.
   *
   * Gemini was the original choice for its free tier, but that tier caps
   * `generate_content` at 20 requests per day per model — one ingest plus a
   * short conversation exhausts it, so a deployed demo starts returning 429
   * almost immediately.
   */
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  OPENAI_CHAT_MODEL: z.string().min(1).default('gpt-4.1-mini'),
  OPENAI_FAST_MODEL: z.string().min(1).default('gpt-4.1-nano'),
  /**
   * Must support a 768-dimension output to match the `vector(768)` columns.
   * The text-embedding-3-* models do, via Matryoshka truncation.
   */
  OPENAI_EMBEDDING_MODEL: z.string().min(1).default('text-embedding-3-small'),

  // --- App ------------------------------------------------------------------
  APP_URL: urlish.default('http://localhost:3000'),

  // --- Email (optional; sharing degrades gracefully without it) -------------
  /**
   * Sender identity, e.g. `PDF Intelligence <you@gmail.com>`. Required by both
   * transports below — a message with no From is undeliverable.
   */
  EMAIL_FROM: z.string().min(1).optional(),

  /*
   * Transport A — SMTP (preferred).
   *
   * Chosen because it can deliver to ARBITRARY recipients with no domain
   * purchase. Resend's shared `onboarding@resend.dev` sender is sandboxed: with
   * no verified domain it rejects every recipient except the Resend account
   * owner's own address, which makes real invite emails impossible. A Gmail App
   * Password has no such restriction (~500 recipients/day).
   *
   * Host and port default to Gmail's submission endpoint so a working setup
   * needs only SMTP_USER and SMTP_PASS.
   */
  SMTP_HOST: z.string().min(1).default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_USER: z.string().min(1).optional(),
  /** Gmail App Password (16 chars), NOT the account password. */
  SMTP_PASS: z.string().min(1).optional(),

  /* Transport B — Resend. Used only when SMTP is not configured. */
  RESEND_API_KEY: z.string().min(1).optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function loadEnv(): ServerEnv {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid or missing environment variables:\n${issues}\n\n` +
        'Copy .env.example to .env.local and fill in the values.',
    );
  }

  return parsed.data;
}

let cached: ServerEnv | null = null;

/**
 * Lazily validated env accessor.
 *
 * Lazy rather than eager so that `next build` can statically analyse pages
 * without every secret being present in CI. The first runtime read fails loudly
 * and with a complete list of what is missing.
 */
export function env(): ServerEnv {
  cached ??= loadEnv();
  return cached;
}

export type EmailTransport = 'smtp' | 'resend';

/**
 * Which delivery transport is configured, if any.
 *
 * SMTP wins when both are present: it is the one that can reach arbitrary
 * recipients, so a deployment carrying leftover Resend credentials still gets
 * the working path.
 */
export function emailTransport(): EmailTransport | null {
  const e = env();
  if (!e.EMAIL_FROM) return null;
  if (e.SMTP_USER && e.SMTP_PASS) return 'smtp';
  if (e.RESEND_API_KEY) return 'resend';
  return null;
}

/** True when email delivery is configured; callers no-op cleanly otherwise. */
export function isEmailEnabled(): boolean {
  return emailTransport() !== null;
}
