-- Defense-in-depth RLS hardening on the two tables containing secrets/tokens.
--
-- WebhookDestination.secret is the HMAC-signing secret per outbound destination.
-- Session.accessToken is the Shopify Admin API OAuth token per shop.
--
-- The app connects via Prisma using the `postgres` role (DATABASE_URL pooler
-- connection). That role has BYPASSRLS by default in Supabase, so enabling
-- RLS without policies is transparent for normal app traffic. The `anon` and
-- `authenticated` roles — used by Supabase client SDKs — are denied entirely.
-- This app does not use those SDKs, but enabling RLS removes a foot-gun if the
-- anon key is ever exposed publicly.
--
-- Audit reference: 2026-05-11 — Supabase advisor flagged both tables as
-- `sensitive_columns_exposed` and `rls_disabled_in_public`. PR follows the
-- audit's MEDIUM finding.
--
-- Rollback (if app traffic breaks against expectations):
--   ALTER TABLE "WebhookDestination" DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE "Session" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "WebhookDestination" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
