import { describe, it, expect } from "vitest";
import {
  evaluateBudget,
  sumTokens,
  effectiveCap,
  startOfUtcDayISO,
  DEFAULT_DAILY_TOKEN_CAP,
  MIN_HEADROOM_TOKENS,
} from "./chat-budget";
import {
  rateForModel,
  estimateCostUsd,
  isKnownModel,
  formatUsd,
  FALLBACK_RATE,
} from "./ai-pricing";

describe("evaluateBudget", () => {
  it("allows a company well under its cap", () => {
    const d = evaluateBudget({ usedToday: 1000, dailyCap: 200000 });
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(199000);
    expect(d.disabled).toBe(false);
  });

  it("refuses once the cap is spent", () => {
    const d = evaluateBudget({ usedToday: 200000, dailyCap: 200000 });
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBe(0);
  });

  /** Starting a call that cannot finish still costs money. */
  it("refuses when headroom is too small for a reply", () => {
    const d = evaluateBudget({ usedToday: 200000 - (MIN_HEADROOM_TOKENS - 1), dailyCap: 200000 });
    expect(d.allowed).toBe(false);
    expect(d.remaining).toBeGreaterThan(0);
  });

  it("allows exactly at the headroom boundary", () => {
    const d = evaluateBudget({ usedToday: 200000 - MIN_HEADROOM_TOKENS, dailyCap: 200000 });
    expect(d.allowed).toBe(true);
  });

  it("reports a zero cap as disabled, not merely exhausted", () => {
    const d = evaluateBudget({ usedToday: 0, dailyCap: 0 });
    expect(d.allowed).toBe(false);
    expect(d.disabled).toBe(true);
  });

  it("never reports negative remaining when usage overshoots", () => {
    const d = evaluateBudget({ usedToday: 500000, dailyCap: 200000 });
    expect(d.remaining).toBe(0);
    expect(d.allowed).toBe(false);
  });

  it("treats malformed usage and caps as safe values", () => {
    expect(evaluateBudget({ usedToday: NaN, dailyCap: 200000 }).usedToday).toBe(0);
    expect(evaluateBudget({ usedToday: -5, dailyCap: 200000 }).usedToday).toBe(0);
    expect(evaluateBudget({ usedToday: 0, dailyCap: NaN }).dailyCap).toBe(DEFAULT_DAILY_TOKEN_CAP);
  });
});

describe("sumTokens", () => {
  it("adds input and output across rows", () => {
    expect(
      sumTokens([
        { tokens_input: 100, tokens_output: 50 },
        { tokens_input: 200, tokens_output: 25 },
      ])
    ).toBe(375);
  });

  it("ignores nulls and malformed numbers", () => {
    expect(
      sumTokens([
        { tokens_input: null, tokens_output: null },
        { tokens_input: 100, tokens_output: null },
        { tokens_input: NaN, tokens_output: 10 },
        { tokens_input: -50, tokens_output: 5 },
      ])
    ).toBe(115);
  });

  it("returns 0 for no rows", () => {
    expect(sumTokens([])).toBe(0);
  });
});

describe("effectiveCap", () => {
  it("prefers a company override", () => {
    expect(effectiveCap(50000, 200000)).toBe(50000);
  });

  it("honours an override of zero (chat off for this company)", () => {
    expect(effectiveCap(0, 200000)).toBe(0);
  });

  it("falls back to the platform default, then the coded default", () => {
    expect(effectiveCap(null, 300000)).toBe(300000);
    expect(effectiveCap(null, null)).toBe(DEFAULT_DAILY_TOKEN_CAP);
  });

  it("rejects negative and malformed overrides", () => {
    expect(effectiveCap(-100, 200000)).toBe(200000);
    expect(effectiveCap(NaN, 200000)).toBe(200000);
  });
});

describe("startOfUtcDayISO", () => {
  it("returns midnight UTC for the given instant", () => {
    const iso = startOfUtcDayISO(Date.UTC(2026, 8, 29, 17, 45, 12));
    expect(iso).toBe("2026-09-29T00:00:00.000Z");
  });

  it("is stable regardless of time of day", () => {
    const early = startOfUtcDayISO(Date.UTC(2026, 8, 29, 0, 0, 1));
    const late = startOfUtcDayISO(Date.UTC(2026, 8, 29, 23, 59, 59));
    expect(early).toBe(late);
  });
});

describe("rateForModel", () => {
  it("matches dated model ids by prefix", () => {
    expect(rateForModel("claude-sonnet-4-5-20250929").outputPerMillion).toBe(15);
    expect(rateForModel("claude-opus-4-1-20250805").outputPerMillion).toBe(75);
  });

  it("prefers the longest matching prefix", () => {
    expect(rateForModel("claude-3-5-haiku-20241022").inputPerMillion).toBe(0.8);
    expect(rateForModel("claude-3-haiku-20240307").inputPerMillion).toBe(0.25);
  });

  it("is case-insensitive", () => {
    expect(rateForModel("CLAUDE-SONNET-4-5").inputPerMillion).toBe(3);
  });

  /** Unknown models must not appear free, or spend silently disappears. */
  it("falls back rather than returning zero for unknown models", () => {
    expect(rateForModel("some-future-model")).toEqual(FALLBACK_RATE);
    expect(rateForModel(null)).toEqual(FALLBACK_RATE);
    expect(isKnownModel("some-future-model")).toBe(false);
    expect(isKnownModel("claude-sonnet-4-5-20250929")).toBe(true);
  });
});

describe("estimateCostUsd", () => {
  it("prices input and output separately", () => {
    // 1M in @ $3 + 1M out @ $15 = $18
    expect(estimateCostUsd("claude-sonnet-4-5", 1_000_000, 1_000_000)).toBe(18);
  });

  it("handles realistic per-turn sizes", () => {
    // 8k in @ $3/M = $0.024; 500 out @ $15/M = $0.0075 → $0.0315
    expect(estimateCostUsd("claude-sonnet-4-5", 8000, 500)).toBeCloseTo(0.0315, 6);
  });

  it("treats null and malformed counts as zero", () => {
    expect(estimateCostUsd("claude-sonnet-4-5", null, null)).toBe(0);
    expect(estimateCostUsd("claude-sonnet-4-5", NaN, -100)).toBe(0);
  });
});

describe("formatUsd", () => {
  it("keeps extra precision for sub-cent amounts", () => {
    expect(formatUsd(0.0031)).toBe("$0.0031");
  });

  it("uses two decimals for normal amounts", () => {
    expect(formatUsd(12.3456)).toBe("$12.35");
    expect(formatUsd(0)).toBe("$0.00");
  });
});
