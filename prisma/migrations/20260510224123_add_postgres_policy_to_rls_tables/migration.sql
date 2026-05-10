-- Defense-in-depth follow-up to 20260510223042_enable_rls_on_secret_tables.
--
-- The previous migration enabled RLS on Session + WebhookDestination but
-- added no policies. Access works today because the app's `postgres` role
-- has BYPASSRLS by default in Supabase, which short-circuits RLS entirely.
--
-- This migration adds explicit pass-through policies so that:
--   1. The intent ("postgres role has full access") is visible in source.
--   2. Access continues to work even if BYPASSRLS is ever stripped from
--      the postgres role, or if a connection comes through a role that
--      lacks BYPASSRLS but is granted the `postgres` policy target.
--   3. `anon` and `authenticated` roles remain denied (no policy applies
--      to them, default deny holds).
--
-- Audit reference: 2026-05-11 validation review of PR #137 flagged the
-- implicit BYPASSRLS dependency as MEDIUM; this closes that gap.
--
-- Rollback:
--   DROP POLICY "allow_postgres_full_access" ON "Session";
--   DROP POLICY "allow_postgres_full_access" ON "WebhookDestination";

CREATE POLICY "allow_postgres_full_access" ON "Session"
  FOR ALL TO postgres USING (true) WITH CHECK (true);

CREATE POLICY "allow_postgres_full_access" ON "WebhookDestination"
  FOR ALL TO postgres USING (true) WITH CHECK (true);
