import { describe, it, expect, beforeAll } from "vitest";
import {
  generateCode,
  normalizeCode,
  isValidCodeFormat,
  hashCode,
  safeEqualHex,
  matchStoredCode,
  codeExpiryISO,
  recentSendCutoffISO,
  CODE_LENGTH,
  CODE_TTL_SECONDS,
  MAX_ATTEMPTS,
  RECENT_SEND_WINDOW_SECONDS,
  type StoredCode,
} from "./two-factor-code";

beforeAll(() => {
  process.env.TWO_FACTOR_SECRET = "test-secret-for-unit-tests";
});

/** Build a stored row, defaulting to "live and unused". */
async function row(code: string, overrides: Partial<StoredCode> = {}): Promise<StoredCode> {
  return {
    id: overrides.id ?? `row-${code}`,
    code_hash: overrides.code_hash ?? (await hashCode(code)),
    expires_at: overrides.expires_at ?? new Date(Date.now() + 60_000).toISOString(),
    attempts: overrides.attempts ?? 0,
    consumed_at: overrides.consumed_at ?? null,
  };
}

describe("generateCode", () => {
  it("returns exactly CODE_LENGTH digits", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(/^\d+$/.test(code)).toBe(true);
    }
  });

  it("honours a custom length", () => {
    expect(generateCode(4)).toHaveLength(4);
  });

  it("does not return the same code twice in a row", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateCode()));
    // 200 draws from 10^8 colliding would mean the RNG is broken.
    expect(codes.size).toBe(200);
  });

  it("covers all ten digits roughly evenly (no modulo bias)", () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 500; i++) {
      for (const ch of generateCode()) counts[Number(ch)]++;
    }
    // 4000 digits over 10 buckets: 400 expected each. A `% 10` bias would push
    // digits 0-5 well above 6-9; this bound is loose enough not to flake.
    for (const count of counts) {
      expect(count).toBeGreaterThan(250);
      expect(count).toBeLessThan(550);
    }
  });
});

describe("normalizeCode / isValidCodeFormat", () => {
  it("strips spaces and dashes", () => {
    expect(normalizeCode("1234 5678")).toBe("12345678");
    expect(normalizeCode("1234-5678")).toBe("12345678");
    expect(normalizeCode(" 12 34-56 78 ")).toBe("12345678");
  });

  it("returns empty string for non-strings", () => {
    expect(normalizeCode(null)).toBe("");
    expect(normalizeCode(undefined)).toBe("");
    expect(normalizeCode(12345678)).toBe("");
    expect(normalizeCode({})).toBe("");
  });

  it("accepts only exactly-8-digit strings", () => {
    expect(isValidCodeFormat("12345678")).toBe(true);
    expect(isValidCodeFormat("1234567")).toBe(false);
    expect(isValidCodeFormat("123456789")).toBe(false);
    expect(isValidCodeFormat("1234567a")).toBe(false);
    expect(isValidCodeFormat("")).toBe(false);
  });
});

describe("hashCode", () => {
  it("is deterministic for the same code", async () => {
    expect(await hashCode("12345678")).toBe(await hashCode("12345678"));
  });

  it("differs for different codes", async () => {
    expect(await hashCode("12345678")).not.toBe(await hashCode("12345679"));
  });

  it("never contains the plaintext code", async () => {
    expect(await hashCode("12345678")).not.toContain("12345678");
  });

  it("depends on the secret, so a leaked hash is useless without it", async () => {
    const withFirst = await hashCode("12345678");
    process.env.TWO_FACTOR_SECRET = "a-different-secret";
    const withSecond = await hashCode("12345678");
    process.env.TWO_FACTOR_SECRET = "test-secret-for-unit-tests";
    expect(withFirst).not.toBe(withSecond);
  });

  it("throws when the secret is missing", async () => {
    const saved = process.env.TWO_FACTOR_SECRET;
    delete process.env.TWO_FACTOR_SECRET;
    await expect(hashCode("12345678")).rejects.toThrow(/TWO_FACTOR_SECRET/);
    process.env.TWO_FACTOR_SECRET = saved;
  });
});

describe("safeEqualHex", () => {
  it("matches identical strings and rejects differences", () => {
    expect(safeEqualHex("abcd", "abcd")).toBe(true);
    expect(safeEqualHex("abcd", "abce")).toBe(false);
    expect(safeEqualHex("abcd", "abcde")).toBe(false);
    expect(safeEqualHex("", "")).toBe(true);
  });
});

describe("matchStoredCode", () => {
  it("matches a live code", async () => {
    const rows = [await row("11112222")];
    const result = await matchStoredCode("11112222", rows);
    expect(result.outcome).toBe("match");
  });

  it("rejects a code that was never issued", async () => {
    const rows = [await row("11112222")];
    expect((await matchStoredCode("99998888", rows)).outcome).toBe("no_match");
  });

  it("rejects an expired code", async () => {
    const rows = [
      await row("11112222", { expires_at: new Date(Date.now() - 1000).toISOString() }),
    ];
    expect((await matchStoredCode("11112222", rows)).outcome).toBe("expired");
  });

  it("rejects a consumed code, so it cannot be replayed", async () => {
    const rows = [await row("11112222", { consumed_at: new Date().toISOString() })];
    expect((await matchStoredCode("11112222", rows)).outcome).toBe("already_used");
  });

  it("rejects a code whose attempt budget is spent", async () => {
    const rows = [await row("11112222", { attempts: MAX_ATTEMPTS })];
    expect((await matchStoredCode("11112222", rows)).outcome).toBe("attempts_exceeded");
  });

  it("accepts a code one attempt below the cap", async () => {
    const rows = [await row("11112222", { attempts: MAX_ATTEMPTS - 1 })];
    expect((await matchStoredCode("11112222", rows)).outcome).toBe("match");
  });

  it("handles an empty candidate list", async () => {
    expect((await matchStoredCode("11112222", [])).outcome).toBe("no_match");
  });

  /**
   * The regression this whole change exists to prevent: two environments
   * sharing one database each hold their own live code, and BOTH must verify.
   */
  it("accepts either of two concurrently-live codes", async () => {
    const rows = [await row("11112222", { id: "local" }), await row("33334444", { id: "live" })];

    const first = await matchStoredCode("11112222", rows);
    expect(first.outcome).toBe("match");
    if (first.outcome === "match") expect(first.row.id).toBe("local");

    const second = await matchStoredCode("33334444", rows);
    expect(second.outcome).toBe("match");
    if (second.outcome === "match") expect(second.row.id).toBe("live");
  });

  it("still matches a live code when a stale one exists for the same user", async () => {
    const rows = [
      await row("11112222", { id: "stale", expires_at: new Date(Date.now() - 1000).toISOString() }),
      await row("33334444", { id: "fresh" }),
    ];
    const result = await matchStoredCode("33334444", rows);
    expect(result.outcome).toBe("match");
    if (result.outcome === "match") expect(result.row.id).toBe("fresh");
  });

  it("prefers a live duplicate over an expired one with the same digits", async () => {
    const rows = [
      await row("11112222", { id: "old", expires_at: new Date(Date.now() - 1000).toISOString() }),
      await row("11112222", { id: "new" }),
    ];
    const result = await matchStoredCode("11112222", rows);
    expect(result.outcome).toBe("match");
    if (result.outcome === "match") expect(result.row.id).toBe("new");
  });

  it("reports the most specific near-miss when nothing is live", async () => {
    const rows = [
      await row("11112222", { id: "used", consumed_at: new Date().toISOString() }),
      await row("11112222", { id: "burnt", attempts: MAX_ATTEMPTS }),
    ];
    // attempts_exceeded outranks already_used: the cap is the actionable signal.
    expect((await matchStoredCode("11112222", rows)).outcome).toBe("attempts_exceeded");
  });
});

describe("timestamp helpers", () => {
  it("sets expiry CODE_TTL_SECONDS ahead of now", () => {
    const now = Date.now();
    const delta = new Date(codeExpiryISO(now)).getTime() - now;
    expect(delta).toBe(CODE_TTL_SECONDS * 1000);
  });

  it("sets the send cutoff one window behind now", () => {
    const now = Date.now();
    const delta = now - new Date(recentSendCutoffISO(now)).getTime();
    expect(delta).toBe(RECENT_SEND_WINDOW_SECONDS * 1000);
  });
});
