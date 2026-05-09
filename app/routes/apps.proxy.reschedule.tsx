import type { ActionFunctionArgs } from "@remix-run/node";
import { appProxyAction } from "../utils/app-proxy.server";
import { action as rescheduleAction } from "./api.reschedule";

// Storefront route: POST /apps/ordak-go/reschedule → forwarded by Shopify
// App Proxy → here. appProxyAction validates the proxy signature, applies
// rate limiting, and pins shopDomain to session.shop before delegating to
// api.reschedule's inner action (which also re-authenticates as
// defense-in-depth — the bare /api/reschedule URL returns 401 to direct
// hits).
export async function action(args: ActionFunctionArgs) {
  return appProxyAction(args, rescheduleAction);
}
