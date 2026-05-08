/**
 * POST /api/storefront/diagnostics
 *
 * Receives passive diagnostic signals from the cart-block running on the
 * storefront. Authentication is via Shopify's App Proxy signature (handled
 * upstream in apps.proxy.diagnostics.tsx — never call this internal route
 * directly from the storefront).
 *
 * Today the only signal is `expressButtonsVisible` — the cart-block detects
 * Shop Pay / Apple Pay / Buy-it-now buttons in the DOM and reports their
 * visibility once per page load. The dashboard reads `Shop.diagnosticsExpressButtonsVisible`
 * to surface a Banner pointing the merchant at the hide-express-buttons toggle
 * on the cart-scheduler-embed app embed.
 */

import { json, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { logger } from "../utils/logger.server";

interface RequestBody {
  shopifyDomain: string;
  expressButtonsVisible?: boolean;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = (await request.json()) as RequestBody;

  if (!body.shopifyDomain) {
    return json({ error: "shopifyDomain required" }, { status: 400 });
  }

  if (typeof body.expressButtonsVisible !== "boolean") {
    return json({ error: "expressButtonsVisible (boolean) required" }, { status: 400 });
  }

  try {
    const updated = await prisma.shop.update({
      where: { shopifyDomain: body.shopifyDomain },
      data: { diagnosticsExpressButtonsVisible: body.expressButtonsVisible },
      select: { id: true, diagnosticsExpressButtonsVisible: true },
    });
    return json({ ok: true, expressButtonsVisible: updated.diagnosticsExpressButtonsVisible });
  } catch (error) {
    logger.error("storefront.diagnostics update failed", error, {
      shop: body.shopifyDomain,
    });
    return json({ error: "Internal server error" }, { status: 500 });
  }
}
