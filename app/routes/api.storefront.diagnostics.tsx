/**
 * POST /api/storefront/diagnostics
 *
 * Receives passive diagnostic signals from the cart-block running on the
 * storefront. Authentication is via Shopify's App Proxy signature (handled
 * upstream in apps.proxy.diagnostics.tsx — never call this internal route
 * directly from the storefront).
 *
 * Two signals today:
 *
 *   1. `expressButtonsVisible` — the cart-block detects Shop Pay / Apple Pay
 *      / Buy-it-now buttons in the DOM. The dashboard reads
 *      `Shop.diagnosticsExpressButtonsVisible` to warn the merchant.
 *
 *   2. `surface` — which surface the cart-block is running on,
 *      "cart-drawer" or "cart-page". Stamped into one of two
 *      `diagnosticsCart{Drawer,Page}SeenAt` timestamp columns so the
 *      dashboard can answer "is the cart-block actually rendering, and on
 *      which surface(s)?" without the merchant declaring anything. Both
 *      timestamps non-null means the merchant uses BOTH surfaces (e.g.
 *      drawer on mobile + cart page on desktop). Either timestamp older
 *      than ~7 days surfaces a stale warning. See
 *      `memory/cart_block_first_open_race.md` for the broader cart-block
 *      diagnostics design.
 *
 * Both signals are optional in the request body. Missing fields = no-op
 * (matches the "passive observation" model — never reject a partial report).
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

type Surface = "cart-drawer" | "cart-page";

interface RequestBody {
  // Kept for backward compat with appProxyAction's body replay (it injects
  // shopifyDomain from session.shop) — but ignored. The trusted shop
  // identity comes from `session.shop` resolved below.
  shopifyDomain?: string;
  expressButtonsVisible?: boolean;
  surface?: Surface;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  // F2 fix: this inner action is reachable directly at /api/storefront/diagnostics
  // because Remix exposes every file in app/routes/. Without the proxy
  // auth gate here, an attacker could POST {"shopifyDomain":"<victim>",
  // "expressButtonsVisible":true} and silence the merchant-facing
  // misconfig warning on a competitor shop. Re-authenticate so direct
  // hits 401, regardless of what the proxy wrapper did upstream.
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }
  const shopDomain = session.shop;

  const body = (await request.json().catch(() => ({}))) as Partial<RequestBody>;

  // Build the partial update. Each signal updates its own column. Reports
  // that include neither signal are accepted (and no-op) — preserves the
  // "passive observation" contract; we never reject a partial report.
  const updateData: {
    diagnosticsExpressButtonsVisible?: boolean;
    diagnosticsCartDrawerSeenAt?: Date;
    diagnosticsCartPageSeenAt?: Date;
  } = {};

  if (typeof body.expressButtonsVisible === "boolean") {
    updateData.diagnosticsExpressButtonsVisible = body.expressButtonsVisible;
  }

  if (body.surface === "cart-drawer") {
    updateData.diagnosticsCartDrawerSeenAt = new Date();
  } else if (body.surface === "cart-page") {
    updateData.diagnosticsCartPageSeenAt = new Date();
  }

  if (Object.keys(updateData).length === 0) {
    return json({ ok: true, noop: true });
  }

  try {
    const updated = await prisma.shop.update({
      where: { shopifyDomain: shopDomain },
      data: updateData,
      select: {
        diagnosticsExpressButtonsVisible: true,
        diagnosticsCartDrawerSeenAt: true,
        diagnosticsCartPageSeenAt: true,
      },
    });
    return json({
      ok: true,
      expressButtonsVisible: updated.diagnosticsExpressButtonsVisible,
      cartDrawerSeenAt: updated.diagnosticsCartDrawerSeenAt?.toISOString() ?? null,
      cartPageSeenAt: updated.diagnosticsCartPageSeenAt?.toISOString() ?? null,
    });
  } catch (error) {
    logger.error("storefront.diagnostics update failed", error, { shop: shopDomain });
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
