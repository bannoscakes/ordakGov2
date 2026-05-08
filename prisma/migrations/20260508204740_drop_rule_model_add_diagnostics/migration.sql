-- 1.5.D — drop the unused Rule abstraction and add the cart-block diagnostics flag.
--
-- Rule was a generic shop-scoped table covering cutoff/lead_time/blackout/capacity.
-- Confirmed 0 runtime references (slot loader, eligibility API, carrier-service,
-- Functions all ignore it). Per-slot cutoff shipped in 1.5.A; per-Location blackout
-- dates and lead time will land in 1.5.B and 1.5.C against Location columns.
-- The 2 legacy Rule rows on ordakgo-v3 are dev-store dead data.
--
-- diagnosticsExpressButtonsVisible is set true by the cart-block storefront
-- when it detects visible express checkout buttons (Shop Pay / Apple Pay /
-- Buy-it-now). Drives the dashboard warning Banner.

DROP TABLE "Rule";

ALTER TABLE "Shop" ADD COLUMN "diagnosticsExpressButtonsVisible" BOOLEAN NOT NULL DEFAULT false;
