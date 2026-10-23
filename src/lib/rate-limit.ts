/**
 * A small fixed-window rate limiter held in memory.
 *
 * PER INSTANCE. Each server instance (each Vercel function instance) keeps its
 * own counters, and they reset on a cold start. That makes this abuse
 * DAMPENING, not a hard global quota: a determined attacker spread across
 * instances gets a multiple of the limit. For signup that is acceptable, since
 * Supabase applies its own limits behind it. A shared store (Upstash, a
 * database table) is the upgrade if a hard limit is ever needed.
 *
 * Pure apart from the Map it is given, so tests pass their own clock.
 */

export interface RateLimitRule {
  /** Maximum hits allowed inside one window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Hits left in the current window after this one (0 when refused). */
  remaining: number;
  /** Milliseconds until the current window resets. */
  retryAfterMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/** Above this many keys, expired buckets are swept so memory stays bounded. */
const SWEEP_THRESHOLD = 5_000;

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly rule: RateLimitRule) {}

  /**
   * Record one hit for `key` and say whether it is within the limit.
   *
   * A refused hit is NOT counted, so a client that keeps retrying is let back
   * in as soon as the window it started ends, rather than being pushed further
   * out by every refused attempt.
   */
  hit(key: string, now: number = Date.now()): RateLimitResult {
    if (this.buckets.size > SWEEP_THRESHOLD) this.sweep(now);

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.rule.windowMs };
      this.buckets.set(key, bucket);
    }

    if (bucket.count >= this.rule.limit) {
      return { allowed: false, remaining: 0, retryAfterMs: bucket.resetAt - now };
    }

    bucket.count += 1;
    return {
      allowed: true,
      remaining: this.rule.limit - bucket.count,
      retryAfterMs: bucket.resetAt - now,
    };
  }

  /** Number of keys currently held. For tests. */
  size(): number {
    return this.buckets.size;
  }

  private sweep(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

/**
 * The caller's IP: the FIRST hop of x-forwarded-for, which on Vercel is the
 * client address the edge saw. Falls back to x-real-ip, then "unknown" so a
 * missing header shares one bucket rather than escaping the limit.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = headers.get("x-real-ip")?.trim();
  return real || "unknown";
}
