import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, getClientIp, rateLimitKey } from "../app/utils/rate-limit.server";

const KEY = "shop.example.com|198.51.100.4";

beforeEach(() => {
  for (let i = 0; i < 200; i++) checkRateLimit(`__warm__:${i}`, 0);
});

describe("checkRateLimit", () => {
  it("allows up to the configured max within a window", () => {
    const t0 = 1_000_000;
    const key = `${KEY}|${t0}`;
    for (let i = 0; i < 60; i++) {
      const r = checkRateLimit(key, t0 + i);
      expect(r.ok).toBe(true);
    }
    const blocked = checkRateLimit(key, t0 + 60);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const t0 = 2_000_000;
    const key = `${KEY}|${t0}`;
    for (let i = 0; i < 60; i++) checkRateLimit(key, t0 + i);
    expect(checkRateLimit(key, t0 + 100).ok).toBe(false);
    expect(checkRateLimit(key, t0 + 60_001).ok).toBe(true);
  });

  it("scopes counters by key (different shop or IP doesn't share)", () => {
    const t0 = 3_000_000;
    const a = `${KEY}|A|${t0}`;
    const b = `${KEY}|B|${t0}`;
    for (let i = 0; i < 60; i++) checkRateLimit(a, t0 + i);
    expect(checkRateLimit(a, t0 + 60).ok).toBe(false);
    expect(checkRateLimit(b, t0 + 60).ok).toBe(true);
  });
});

describe("getClientIp", () => {
  it("uses the first entry of x-forwarded-for", () => {
    const req = new Request("https://example.test/", {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.1" },
    });
    expect(getClientIp(req)).toBe("203.0.113.10");
  });

  it("falls back to 'unknown' when no header is present", () => {
    expect(getClientIp(new Request("https://example.test/"))).toBe("unknown");
  });

  it("strips IPv6 zone suffix", () => {
    const req = new Request("https://example.test/", {
      headers: { "x-forwarded-for": "fe80::1%eth0" },
    });
    expect(getClientIp(req)).toBe("fe80::1");
  });
});

describe("rateLimitKey", () => {
  it("composes a stable key", () => {
    expect(rateLimitKey("shop-1.myshopify.com", "1.2.3.4")).toBe("shop-1.myshopify.com|1.2.3.4");
  });
});
