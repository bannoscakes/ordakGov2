/**
 * Structural security guard for `app/routes/api.*` and `app/routes/apps.proxy.*`
 *
 * Every Remix route file under `app/routes/` is exposed by Remix at its
 * URL path — nothing in the framework prevents the storefront or an
 * anonymous attacker from POSTing directly to a bare `/api/*` URL even
 * when the merchant is meant to reach it via a wrapper at
 * `/apps/<proxy-prefix>/...`.
 *
 * The audit-finding cluster F1, F2, F3, F4a, F4b all stem from the same
 * hidden assumption that the `apps.proxy.*` wrapper is the only caller.
 * This test asserts the assumption explicitly: every `api.*.tsx` and
 * `apps.proxy.*.tsx` route file must invoke ONE of:
 *
 *   - authenticate.admin(...)             // Shopify embedded admin session
 *   - authenticate.public.appProxy(...)   // Shopify App Proxy signature
 *   - authenticate.webhook(...)           // Shopify webhook HMAC
 *   - appProxyAction(...)                 // shorthand wrapper around appProxy
 *   - authenticateProxyOrInternal(...)    // accepts upstream-validated calls
 *                                         // from appProxyAction OR runs the
 *                                         // real proxy auth on direct hits
 *
 * If a new file fails this check, fix the route — don't add it to
 * EXEMPT_FILES unless you have a written reason.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROUTES_DIR = join(process.cwd(), "app", "routes");

const AUTH_PATTERNS: RegExp[] = [
  /authenticate\.admin\s*\(/,
  /authenticate\.public\.appProxy\s*\(/,
  /authenticate\.webhook\s*\(/,
  /appProxyAction\s*\(/,
  /authenticateProxyOrInternal\s*\(/,
];

// Deliberate exemptions. ADD A COMMENT explaining why each entry is here.
const EXEMPT_FILES = new Set<string>([
  // Shopify's CarrierService callback is unsigned by platform design —
  // the rate request is forwarded to our endpoint without HMAC. The audit
  // (2026-05-09) explicitly refuted F8 "carrier service header trust" at
  // confidence 9: response data (zone names, base prices, slot times) is
  // substantially equivalent to what the anonymous storefront cart already
  // exposes. The route validates `body.origin` belongs to a known shop and
  // applies the merchant's pricing rules — that's the security boundary.
  "api.carrier-service.rates.tsx",
]);

function hasAuthGate(source: string): boolean {
  return AUTH_PATTERNS.some((re) => re.test(source));
}

describe("api.* route auth guard", () => {
  const apiFiles = readdirSync(ROUTES_DIR)
    .filter((f) => f.startsWith("api.") && f.endsWith(".tsx"))
    .filter((f) => !EXEMPT_FILES.has(f));

  it("at least one api.* route exists (sanity check)", () => {
    expect(apiFiles.length).toBeGreaterThan(0);
  });

  for (const file of apiFiles) {
    it(`${file} invokes an auth gate`, () => {
      const source = readFileSync(join(ROUTES_DIR, file), "utf8");
      const message =
        `app/routes/${file} must call authenticate.admin / ` +
        `authenticate.public.appProxy / authenticate.webhook, or import ` +
        `appProxyAction. Add one of these auth gates, or add the file to ` +
        `EXEMPT_FILES with a comment explaining why.`;
      expect(hasAuthGate(source), message).toBe(true);
    });
  }
});

describe("apps.proxy.* wrapper auth guard", () => {
  const proxyFiles = readdirSync(ROUTES_DIR).filter(
    (f) => f.startsWith("apps.proxy.") && f.endsWith(".tsx"),
  );

  it("at least one apps.proxy.* wrapper exists (sanity check)", () => {
    expect(proxyFiles.length).toBeGreaterThan(0);
  });

  for (const file of proxyFiles) {
    it(`${file} uses appProxyAction or authenticate.public.appProxy`, () => {
      const source = readFileSync(join(ROUTES_DIR, file), "utf8");
      const message =
        `app/routes/${file} must use appProxyAction or ` +
        `authenticate.public.appProxy. Bare apps.proxy.* wrappers without ` +
        `proxy auth let unauthenticated callers reach the inner action.`;
      expect(hasAuthGate(source), message).toBe(true);
    });
  }
});
