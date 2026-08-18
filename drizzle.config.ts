import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// drizzle-kit runs outside Next.js, so .env.local is not loaded automatically.
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

/**
 * Migrations run over a DIRECT connection (port 5432), not the transaction
 * pooler: pgBouncer cannot execute the DDL and advisory locks migrations need.
 */
// `generate` only diffs the schema file and never connects, so a placeholder
// keeps migration authoring possible without credentials. `migrate`/`push` do
// connect and will fail loudly against the placeholder, which is the intent.
const url =
  process.env.DIRECT_URL ??
  process.env.DATABASE_URL ??
  'postgresql://placeholder:placeholder@localhost:5432/placeholder';

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
