import 'server-only';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '@/lib/env';
import * as schema from './schema';

/**
 * Database client.
 *
 * Initialised lazily behind a Proxy rather than at module load. Two reasons:
 *
 * 1. `next build` imports every route module to analyse it. Connecting (or even
 *    reading DATABASE_URL) at import time would make the build require a live
 *    database and a full set of secrets, which CI should not need.
 * 2. Serverless invocations are short-lived but reused, so the connection is
 *    cached on `globalThis` — this avoids exhausting the connection pool across
 *    warm invocations and hot reloads in development.
 *
 * `prepare: false` is required by Supabase's transaction pooler (pgBouncer on
 * port 6543), which does not support prepared statements.
 */
type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __pdfiqSql?: ReturnType<typeof postgres>;
  __pdfiqDb?: DrizzleClient;
};

function connect(): DrizzleClient {
  if (globalForDb.__pdfiqDb) return globalForDb.__pdfiqDb;

  const config = env();

  const client =
    globalForDb.__pdfiqSql ??
    postgres(config.DATABASE_URL, {
      max: 1,
      connect_timeout: 15,
      /*
       * `prepare: false` is required by Supabase's transaction pooler
       * (pgBouncer, port 6543), which does not support prepared statements.
       */
      prepare: false,
      /*
       * Connection recycling.
       *
       * The pooler closes connections it considers idle, and a cached client
       * holding a dead socket surfaces as `read ECONNRESET` on the next query —
       * observed in practice against Supabase. Closing our own idle connections
       * first (and capping total lifetime) means we reconnect on our terms
       * rather than discovering the socket is gone mid-request.
       */
      idle_timeout: 10,
      max_lifetime: 60 * 10,
      /* Postgres NOTICE messages are noise in application logs. */
      onnotice: () => {},
      /*
       * Present so a pooler-initiated socket close is an observed event rather
       * than an unhandled one. postgres.js reconnects on the next query, so
       * there is nothing to repair here.
       */
      onclose: () => {},
    });

  const instance = drizzle(client, { schema });

  // Cache in every environment: serverless containers are reused between
  // invocations, so reconnecting per request would be wasteful and can exhaust
  // the pooler's client limit.
  globalForDb.__pdfiqSql = client;
  globalForDb.__pdfiqDb = instance;

  return instance;
}

/**
 * Drizzle client.
 *
 * A Proxy so `import { db }` is free at module load and the connection is only
 * established on first actual query.
 */
export const db = new Proxy({} as DrizzleClient, {
  get(_target, property, receiver) {
    return Reflect.get(connect(), property, receiver);
  },
  has(_target, property) {
    return Reflect.has(connect(), property);
  },
});

/** Raw postgres.js handle, for the rare query Drizzle cannot express. */
export function rawSql() {
  connect();
  return globalForDb.__pdfiqSql!;
}

export type Db = DrizzleClient;
