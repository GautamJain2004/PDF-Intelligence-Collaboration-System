-- Close PostgREST as a second, unauthorized door into the database.
--
-- WHY THIS EXISTS
--
-- Supabase automatically exposes every table in the `public` schema over
-- PostgREST at https://<ref>.supabase.co/rest/v1/<table>, authenticated with the
-- project's `anon` key. That key is *designed to be public* — it ships in
-- browser bundles — so it must be treated as known to everyone.
--
-- This application performs all authorization in its own server code and talks
-- to Postgres over a direct connection as the table owner. It never uses
-- PostgREST. But PostgREST does not care: with RLS disabled and default grants
-- in place, the anon key could read and write every table, completely bypassing
-- `requireDocumentAccess()` and every other check in the app.
--
-- Verified before this migration, using only the public anon key:
--   GET    /rest/v1/users     -> 200, returned email + argon2 password_hash
--   GET    /rest/v1/sessions  -> 200, returned session token_hash
--   GET    /rest/v1/documents -> 200, returned storage_path + summaries
--   PATCH  /rest/v1/users     -> 204 (writes permitted)
--   DELETE /rest/v1/users     -> 204 (deletes permitted)
--
-- THE FIX
--
-- 1. Enable RLS on every table with NO policies attached. For the `anon` and
--    `authenticated` roles this is a default-deny: no policy means no row is
--    ever visible or writable. The application is unaffected because it
--    connects as the table owner, and owners bypass RLS unless FORCE ROW LEVEL
--    SECURITY is set (it is not).
--
--    Deliberately no policies: this app's authorization model is far richer
--    than RLS can express (share tokens, guest sessions scoped to one share,
--    role-per-share). Duplicating it in SQL would mean two implementations that
--    must agree forever. One enforcement point in the server, plus a hard deny
--    at the database edge, is the honest design.
--
-- 2. Revoke privileges from `anon` and `authenticated` as defence in depth, so
--    the tables are inaccessible even if RLS were later disabled on one of them.
--
-- `service_role` is intentionally untouched: it bypasses RLS by design and is a
-- server-only secret used for Storage operations.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guest_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Defence in depth: strip the grants PostgREST relies on.
-- Wrapped so the migration still succeeds on a plain Postgres (local Docker,
-- CI) where the Supabase-specific roles do not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
  END IF;
END
$$;
