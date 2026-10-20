import { describe, it, expect } from "vitest";
import {
  evaluateLiveLimit,
  initiativeUsageAfterWipe,
  liveLimitBody,
  liveLimitMessage,
  liveLimitStatus,
  productAdditions,
  type LiveLimitContext,
  type LiveLimitKey,
} from "./live-limits";

const starter: LiveLimitContext = {
  refusal: null,
  enforced: true,
  planName: "Starter",
  limits: { max_users: 1, max_initiatives: 1, max_products: 2 },
};

function ctxWith(limits: LiveLimitContext["limits"], over: Partial<LiveLimitContext> = {}): LiveLimitContext {
  return { refusal: null, enforced: true, planName: "Starter", limits, ...over };
}

describe("evaluateLiveLimit", () => {
  it("allows when under the limit", () => {
    const r = evaluateLiveLimit(starter, "max_products", 1, 1);
    expect(r).toMatchObject({ ok: true, code: "ok", limit: 2, used: 1, remaining: 1, message: "" });
  });

  it("refuses at the limit with a message naming the plan and the number", () => {
    const r = evaluateLiveLimit(starter, "max_products", 2, 1);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("limit_reached");
    expect(r.message).toBe("Your Starter plan allows 2 products. Upgrade to add more.");
  });

  it("refuses a batch that does not fit, saying how many do", () => {
    const r = evaluateLiveLimit(ctxWith({ max_products: 5 }), "max_products", 3, 4);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(2);
    expect(r.message).toContain("only 2 more can be added");
  });

  it("an account already over its limit keeps working but cannot add", () => {
    // b20d0efd: 3 products on a 2-product plan.
    expect(evaluateLiveLimit(starter, "max_products", 3, 0).ok).toBe(true);
    const r = evaluateLiveLimit(starter, "max_products", 3, 1);
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it("treats -1 and a missing row as unlimited", () => {
    expect(evaluateLiveLimit(ctxWith({ max_products: -1 }), "max_products", 500, 10)).toMatchObject({
      ok: true, limit: null, remaining: null,
    });
    expect(evaluateLiveLimit(ctxWith({}), "max_products", 500, 10)).toMatchObject({
      ok: true, limit: null,
    });
  });

  it("treats 0 as not included", () => {
    const r = evaluateLiveLimit(ctxWith({ max_products: 0 }), "max_products", 0, 1);
    expect(r).toMatchObject({ ok: false, code: "not_included", limit: 0 });
    expect(r.message).toBe("Products are not included in your Starter plan. Upgrade to add them.");
    // Adding nothing is still fine.
    expect(evaluateLiveLimit(ctxWith({ max_products: 0 }), "max_products", 3, 0).ok).toBe(true);
  });

  it("enforces nothing when billing is off or there is no plan", () => {
    const off = ctxWith({ max_products: 1 }, { enforced: false });
    expect(evaluateLiveLimit(off, "max_products", 99, 99)).toMatchObject({ ok: true, limit: null });
  });

  it("refuses with the access reason when access itself is refused", () => {
    const refused = ctxWith({}, {
      enforced: false,
      refusal: { code: "trial_expired", message: "Your free trial has ended. Choose a plan to continue." },
    });
    const r = evaluateLiveLimit(refused, "max_users", 0, 1);
    expect(r).toMatchObject({ ok: false, code: "trial_expired" });
  });

  it("names the plan year for initiatives", () => {
    const r = evaluateLiveLimit(starter, "max_initiatives", 1, 1, { year: 2026 });
    expect(r.message).toBe("Your Starter plan allows 1 initiative in your 2026 plan. Upgrade to add more.");
  });

  /**
   * The create-member limit: max_users counts every profile, so a limit of 1
   * is the owner alone and the first invite is refused.
   */
  it("max_users 1 means the owner only", () => {
    expect(evaluateLiveLimit(starter, "max_users", 1, 1)).toMatchObject({
      ok: false,
      code: "limit_reached",
      message: "Your Starter plan allows 1 user. Upgrade to add more team members.",
    });
    // b20d0efd: 4 profiles on a 1-user plan, still blocked, nothing removed.
    expect(evaluateLiveLimit(starter, "max_users", 4, 1).ok).toBe(false);
    expect(evaluateLiveLimit(ctxWith({ max_users: 3 }), "max_users", 2, 1).ok).toBe(true);
  });

  it("matches the rule on seeded random inputs", () => {
    // Small deterministic LCG so a failure reproduces.
    let seed = 20261012;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const keys: LiveLimitKey[] = ["max_initiatives", "max_products", "max_users"];
    for (let i = 0; i < 2000; i++) {
      const key = keys[next(3)];
      const raw = next(8) - 1; // -1 .. 6
      const missing = next(10) === 0;
      const used = next(10);
      const adding = next(5);
      const ctx = ctxWith(missing ? {} : { [key]: raw });
      const r = evaluateLiveLimit(ctx, key, used, adding);

      const unlimited = missing || raw === -1;
      const expected = adding === 0 || unlimited || (raw > 0 && used + adding <= raw);
      expect(r.ok, JSON.stringify({ key, raw, missing, used, adding })).toBe(expected);
      if (!r.ok) expect(r.message).not.toBe("");
    }
  });
});

describe("liveLimitMessage", () => {
  it("falls back to 'Your plan' without a plan name", () => {
    expect(
      liveLimitMessage({ key: "max_products", planName: null, limit: 1, used: 1, adding: 1, notIncluded: false })
    ).toBe("Your plan allows 1 product. Upgrade to add more.");
  });
});

describe("liveLimitStatus / liveLimitBody", () => {
  it("answers 402 for limit_reached and 403 for not_included", () => {
    expect(liveLimitStatus("limit_reached")).toBe(402);
    expect(liveLimitStatus("not_included")).toBe(403);
    expect(liveLimitStatus("trial_expired")).toBe(402);
  });

  it("puts the words in `error` and the code in `code`", () => {
    const body = liveLimitBody(evaluateLiveLimit(starter, "max_products", 2, 1));
    expect(body).toMatchObject({
      code: "limit_reached",
      error: "Your Starter plan allows 2 products. Upgrade to add more.",
      message: "Your Starter plan allows 2 products. Upgrade to add more.",
      limitKey: "max_products",
      limit: 2,
      used: 2,
      adding: 1,
      upgradeUrl: "/settings?tab=subscription",
    });
  });
});

describe("productAdditions", () => {
  const existing = [
    { name: "Executive Coaching", is_active: true },
    { name: "Course", is_active: true },
    { name: "Old Workshop", is_active: false },
  ];

  it("does not count products reused by name, ignoring case and spaces", () => {
    expect(productAdditions(["executive coaching ", " COURSE"], existing)).toEqual({
      created: 0, reactivated: 0, adding: 0,
    });
  });

  it("counts genuinely new names once each", () => {
    expect(productAdditions(["Retreat", "retreat", "Membership", "Course"], existing)).toEqual({
      created: 2, reactivated: 0, adding: 2,
    });
  });

  it("counts an inactive product the build switches back on", () => {
    expect(productAdditions(["Old workshop"], existing)).toEqual({ created: 0, reactivated: 1, adding: 1 });
    // Restore matches by name without reactivating.
    expect(productAdditions(["Old workshop"], existing, { reactivates: false }).adding).toBe(0);
  });

  it("skips unnamed cards, which the build never inserts", () => {
    expect(productAdditions([null, "", "   ", undefined], existing).adding).toBe(0);
  });
});

describe("initiativeUsageAfterWipe (intake build count math)", () => {
  it("counts the rebuilt year from zero, then adds the new rows", () => {
    // 2026 holds 2 today and is rebuilt with 1: 0 + 1, so a 1-initiative plan fits.
    const usage = initiativeUsageAfterWipe({
      wipeYear: 2026,
      existingByYear: new Map([[2026, 2]]),
      newByYear: new Map([[2026, 1]]),
    });
    expect(usage).toEqual([{ year: 2026, used: 0, adding: 1 }]);
    expect(evaluateLiveLimit(starter, "max_initiatives", usage[0].used, usage[0].adding).ok).toBe(true);
  });

  it("keeps what is in other years the plan spills into", () => {
    const usage = initiativeUsageAfterWipe({
      wipeYear: 2026,
      existingByYear: new Map([[2026, 4], [2027, 1]]),
      newByYear: new Map([[2027, 1], [2026, 3]]),
    });
    expect(usage).toEqual([
      { year: 2026, used: 0, adding: 3 },
      { year: 2027, used: 1, adding: 1 },
    ]);
    // 2027 already holds 1 on a 1-initiative plan: refused, before any wipe.
    expect(evaluateLiveLimit(starter, "max_initiatives", 1, 1, { year: 2027 }).ok).toBe(false);
  });

  it("a first build of a year with no plan starts from zero", () => {
    expect(
      initiativeUsageAfterWipe({ wipeYear: 2026, existingByYear: new Map(), newByYear: new Map([[2026, 2]]) })
    ).toEqual([{ year: 2026, used: 0, adding: 2 }]);
  });
});
