import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { logger } from "./logger.server";
import {
  checkRateLimit,
  getClientIp,
  logRateLimitHit,
  rateLimitKey,
} from "./rate-limit.server";

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

  const ip = getClientIp(args.request);
  const key = rateLimitKey(session.shop, ip);
  const limit = checkRateLimit(key);
  if (!limit.ok) {
    logRateLimitHit(key, limit.retryAfterSeconds, args.request.url);
    return json(
      { error: "Too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  // A malformed/non-JSON body is silently downgraded to an empty object so
  // the downstream handler's Zod validation can produce a normal 400. Log
  // it so a future serializer regression in the cart-block doesn't debug
  // as a generic "Invalid input" in production.
  const original = await args.request
    .clone()
    .json()
    .catch((err: unknown) => {
      logger.warn("appProxyAction: request body was not valid JSON", {
        url: args.request.url,
        shop: session.shop,
        contentType: args.request.headers.get("content-type"),
        error: err instanceof Error ? err.message : String(err),
      });
      return {} as Record<string, unknown>;
    });

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
