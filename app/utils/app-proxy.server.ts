import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

/**
 * Wraps an internal `api.*` action so it can be safely called from the
 * storefront through Shopify's app proxy.
 *
 * Authenticates the proxy signature, then replays the original POST body to
 * `handler` with `shopDomain` and `shopifyDomain` pinned to `session.shop` —
 * different api.* handlers read different field names (it's inconsistent
 * across the codebase), so we set both. The storefront cannot spoof which
 * shop it's acting as: any value it sent for those fields is overwritten.
 */
export async function appProxyAction(
  args: ActionFunctionArgs,
  handler: (args: ActionFunctionArgs) => Promise<Response>,
): Promise<Response> {
  const { session } = await authenticate.public.appProxy(args.request);
  if (!session) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  const original = await args.request
    .clone()
    .json()
    .catch(() => ({} as Record<string, unknown>));

  const replayed = new Request(args.request.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...original,
      shopDomain: session.shop,
      shopifyDomain: session.shop,
    }),
  });

  return handler({ ...args, request: replayed });
}
