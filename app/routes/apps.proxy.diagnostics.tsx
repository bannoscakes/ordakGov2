import type { ActionFunctionArgs } from "@remix-run/node";
import { appProxyAction } from "../utils/app-proxy.server";
import { action as diagnosticsAction } from "./api.storefront.diagnostics";

// Storefront route: POST /apps/ordak-go/diagnostics → forwarded by Shopify
// App Proxy → here. appProxyAction validates the proxy signature and pins
// shopifyDomain to session.shop before delegating to the internal handler.
export async function action(args: ActionFunctionArgs) {
  return appProxyAction(args, diagnosticsAction);
}
