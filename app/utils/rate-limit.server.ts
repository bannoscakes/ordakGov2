import { logger } from "./logger.server";

/**
 * Per-shop+IP fixed-window rate limit for storefront-facing proxy endpoints.
 *
 * State is in-memory per Fluid Compute instance. Different instances have
 * independent counters; the total cap a real attacker hits is roughly
 * (limit × instance count). For v1 Phase 2 this is acceptable — abusive
 * traffic from a single IP gets throttled within a single instance, and
 * cross-instance fanout still capped well below what a scraper needs to be
 * effective. Move to Redis if we ever need cluster-wide accounting.
 */

const WINDOW_MS = 60_000;

const DEFAULT_MAX = 60;

const envMax = Number.parseInt(process.env.RATE_LIMIT_MAX_PER_MINUTE ?? "", 10);
const MAX_PER_WINDOW =
  Number.isFinite(envMax) && envMax > 0 ? envMax : DEFAULT_MAX;

type Counter = { count: number; windowStartMs: number };
const counters = new Map<string, Counter>();

let lastSweepMs = 0;

function maybeSweep(now: number) {
  if (now - lastSweepMs < WINDOW_MS) return;
  lastSweepMs = now;
  for (const [key, c] of counters) {
    if (now - c.windowStartMs > WINDOW_MS * 2) counters.delete(key);
  }
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number };

export function checkRateLimit(key: string, now: number = Date.now()): RateLimitResult {
  maybeSweep(now);

  const existing = counters.get(key);
  if (!existing || now - existing.windowStartMs >= WINDOW_MS) {
    counters.set(key, { count: 1, windowStartMs: now });
    return { ok: true, remaining: MAX_PER_WINDOW - 1 };
  }

  if (existing.count >= MAX_PER_WINDOW) {
    const retryAfterMs = WINDOW_MS - (now - existing.windowStartMs);
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }

  existing.count += 1;
  return { ok: true, remaining: MAX_PER_WINDOW - existing.count };
}

/**
 * Pull the client IP from the request. Vercel populates `x-forwarded-for`
 * with the originating client; the first entry is the real IP. We strip
 * IPv6 zone suffixes and avoid trusting `x-real-ip` (set by some proxies but
 * not by Vercel, so trusting it would let a hop forge the source).
 */
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first.split("%")[0] ?? first;
  }
  return "unknown";
}

export function rateLimitKey(shopDomain: string, ip: string): string {
  return `${shopDomain}|${ip}`;
}

export function logRateLimitHit(key: string, retryAfterSeconds: number, url: string) {
  logger.warn("rate_limit.exceeded", { key, retryAfterSeconds, url });
}
