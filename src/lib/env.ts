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
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1, 'Gemini API key is required'),
  /*
   * Defaults verified against a live key. Note that Google's model *listing*
   * endpoint is not a reliable guide to availability: `gemini-2.5-flash-lite`
   * is still listed but returns 404 ("no longer available to new users") on
   * generateContent. The 3.5 family is current and confirmed working.
   */
  GEMINI_CHAT_MODEL: z.string().min(1).default('gemini-3.5-flash'),
  GEMINI_FAST_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  GEMINI_EMBEDDING_MODEL: z.string().min(1).default('gemini-embedding-001'),

  // --- App ------------------------------------------------------------------
  APP_URL: urlish.default('http://localhost:3000'),

  // --- Email (optional; sharing degrades gracefully without it) -------------
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),

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

/** True when email delivery is configured; callers no-op cleanly otherwise. */
export function isEmailEnabled(): boolean {
  const e = env();
  return Boolean(e.RESEND_API_KEY && e.EMAIL_FROM);
}
