-- Keep these tables off the hosted data API.
--
-- Supabase (and any other PostgREST-backed host) exposes every table in the
-- `public` schema over HTTP, and grants its `anon` and `authenticated` roles
-- table privileges by default. Tables created by a raw SQL migration have row
-- level security switched OFF, so without this file the browser-facing
-- publishable key could read `users.password_hash`, rewrite it, and list
-- outstanding reset tokens.
--
-- This application does not use that API at all. It talks to Postgres directly
-- as the owning role, which bypasses RLS — so the safest configuration is to
-- deny the API roles everything and define no policies whatsoever.
--
-- Two independent locks, because either alone can be undone by accident:
--   1. RLS enabled with no policies  -> nothing matches, so nothing is visible.
--   2. Privileges revoked            -> the roles cannot reach the table at all.
--
-- Everything here is idempotent and is a no-op on a plain Postgres server that
-- has no such roles.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verification_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- Note: FORCE ROW LEVEL SECURITY is deliberately NOT set. The application
-- connects as the table owner, and forcing RLS would apply the deny-all rule to
-- the application itself.

DO $do$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
        api_role
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
        api_role
      );
      EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', api_role);
      -- Also cover tables added later by this project.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
        api_role
      );
    END IF;
  END LOOP;
END
$do$;
