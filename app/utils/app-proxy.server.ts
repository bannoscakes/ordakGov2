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

export type ProxySession = { shop: string };

/**
 * Process-scoped map of replayed-Request → validated-Session that
 * `appProxyAction` populates before invoking an inner `api.*` action.
 *
 * Without this, the inner action's `authenticateProxyOrInternal()` call
 * would have to re-run Shopify's HMAC check on the replayed Request — but
 * the replayed body is no longer the body Shopify signed (this wrapper
 * pins `shopDomain`), so Shopify's verifier rejects it and returns null.
 * The cart-block storefront calls then 401 across the board (the bug
 * introduced by the F1/F2/F3 security release).
 *
 * The map is keyed on the actual Request reference (not URL or headers),
 * so a separate inbound HTTP request — even one with an identical URL —
 * never collides. WeakMap also lets the entry be garbage-collected once
 * the inner handler returns, avoiding a leak.
 */
const internalSessions = new WeakMap<Request, ProxySession>();

/**
 * Inner-route auth check that respects upstream `appProxyAction`
 * validation.
 *
 * Returns a session if either:
 *   1. The Request was set up by `appProxyAction` (already authenticated
 *      upstream — the wrapper pinned shop on the body and registered the
 *      session here), OR
 *   2. The Request is a direct external hit and Shopify's HMAC validates.
 *
 * Returns `null` otherwise — caller MUST 401. This keeps the F1/F2/F3
 * defence-in-depth: a curl to `/api/eligibility/check` with no proxy
 * signature isn't in the WeakMap and isn't HMAC-valid, so it 401s exactly
 * like the security audit intended.
 */
export async function authenticateProxyOrInternal(
  request: Request,
): Promise<ProxySession | null> {
  const internal = internalSessions.get(request);
  if (internal) return internal;
  const { session } = await authenticate.public.appProxy(request);
  return session ? { shop: session.shop } : null;
}

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

  // Pin the validated session to the replayed Request so the inner
  // handler's authenticateProxyOrInternal() short-circuits to the
  // already-validated identity. Without this, the inner re-auth would
  // fail because the replayed body no longer matches the signed body.
  internalSessions.set(replayed, { shop: session.shop });

  return handler({ ...args, request: replayed });
}
