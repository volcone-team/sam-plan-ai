import { describe, it, expect } from "vitest";
import { RateLimiter, clientIp } from "./rate-limit";

const WINDOW = 10 * 60 * 1000;

describe("RateLimiter", () => {
  it("allows up to the limit, then refuses", () => {
    const rl = new RateLimiter({ limit: 3, windowMs: WINDOW });
    const t = 1_000_000;
    expect(rl.hit("a", t)).toMatchObject({ allowed: true, remaining: 2 });
    expect(rl.hit("a", t + 1)).toMatchObject({ allowed: true, remaining: 1 });
    expect(rl.hit("a", t + 2)).toMatchObject({ allowed: true, remaining: 0 });
    const refused = rl.hit("a", t + 3);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(WINDOW - 3);
  });

  it("keeps keys independent", () => {
    const rl = new RateLimiter({ limit: 1, windowMs: WINDOW });
    expect(rl.hit("a", 0).allowed).toBe(true);
    expect(rl.hit("a", 1).allowed).toBe(false);
    expect(rl.hit("b", 1).allowed).toBe(true);
  });

  it("opens again when the window ends, and refused hits do not extend it", () => {
    const rl = new RateLimiter({ limit: 1, windowMs: WINDOW });
    expect(rl.hit("a", 0).allowed).toBe(true);
    for (let i = 1; i < 50; i++) expect(rl.hit("a", i * 1000).allowed).toBe(false);
    expect(rl.hit("a", WINDOW).allowed).toBe(true);
  });

  it("never allows more than the limit inside one window, for any hit pattern", () => {
    // Deterministic pseudo-random schedules across several limits.
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (const limit of [1, 3, 5]) {
      const rl = new RateLimiter({ limit, windowMs: WINDOW });
      let now = 0;
      let windowStart = 0;
      let allowedInWindow = 0;
      for (let i = 0; i < 500; i++) {
        now += Math.floor(rand() * 60_000);
        if (now >= windowStart + WINDOW) {
          windowStart = now;
          allowedInWindow = 0;
        }
        const r = rl.hit("k", now);
        if (r.allowed) {
          // A new bucket may start on this hit; resync our model with it.
          if (r.remaining === limit - 1) {
            windowStart = now;
            allowedInWindow = 0;
          }
          allowedInWindow += 1;
        }
        expect(allowedInWindow).toBeLessThanOrEqual(limit);
      }
    }
  });
});

describe("clientIp", () => {
  it("takes the first x-forwarded-for hop", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(new Headers())).toBe("unknown");
    expect(clientIp(new Headers({ "x-forwarded-for": " , " }))).toBe("unknown");
  });
});
