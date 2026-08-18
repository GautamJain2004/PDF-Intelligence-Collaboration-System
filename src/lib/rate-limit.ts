/**
 * Fixed-window rate limiter backed by an in-process Map.
 *
 * Trade-off, stated plainly: this is per-instance, so on a horizontally scaled
 * deployment each instance keeps its own counters and the effective limit is
 * (limit x instances). It is not a defence against a distributed attacker.
 *
 * It IS effective against the realistic threats here — credential stuffing from
 * a single source, and a logged-in user hammering the (metered, paid) LLM
 * endpoints. Swapping in Upstash Redis is a drop-in change to this one module
 * if the app ever needs cross-instance accuracy; that dependency is not worth
 * adding at this scale.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Bounds memory if an attacker cycles keys; oldest entries are dropped first. */
const MAX_BUCKETS = 10_000;

function sweep(now: number) {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still oversized after removing expired entries: drop the oldest.
  if (buckets.size >= MAX_BUCKETS) {
    const excess = buckets.size - MAX_BUCKETS + 1;
    let i = 0;
    for (const key of buckets.keys()) {
      if (i++ >= excess) break;
      buckets.delete(key);
    }
  }
}

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets; suitable for a Retry-After header. */
  retryAfter: number;
};

export function rateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }

  existing.count += 1;
  const ok = existing.count <= limit;

  return {
    ok,
    remaining: Math.max(0, limit - existing.count),
    retryAfter: ok ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  };
}

/**
 * Tuned per endpoint class rather than one global number, because the cost and
 * abuse profile differ wildly between logging in and streaming an LLM answer.
 */
export const LIMITS = {
  /** Credential endpoints: strict, keyed by IP. */
  auth: { limit: 10, windowMs: 15 * 60 * 1000 },
  /** Account creation: slow enough to make bulk signup tedious. */
  signup: { limit: 5, windowMs: 60 * 60 * 1000 },
  /** Password reset requests: prevents using us as an email cannon. */
  passwordReset: { limit: 4, windowMs: 60 * 60 * 1000 },
  /** LLM calls cost money and quota — the tightest per-actor budget. */
  chat: { limit: 30, windowMs: 10 * 60 * 1000 },
  /** Uploads trigger the whole embed + summarise pipeline. */
  upload: { limit: 20, windowMs: 60 * 60 * 1000 },
  /** Comments: generous, just enough to stop flooding. */
  comment: { limit: 40, windowMs: 10 * 60 * 1000 },
  /** Semantic search embeds the query, so it is metered too. */
  search: { limit: 60, windowMs: 10 * 60 * 1000 },
} as const;
