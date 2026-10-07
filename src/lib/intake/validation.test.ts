import { describe, it, expect } from "vitest";
import {
  validateScreen,
  validateProducts,
  validateInitiatives,
  funnelErrors,
  toNumberOrNull,
  toTextOrNull,
  audienceValue,
  isAnswered,
  percentError,
  moneyError,
  type IntakeAnswers,
  type ProductRow,
  type InitiativeRow,
} from "./validation";
import { screensFor } from "./flow";
import { REQUIRED_FIELDS, MAX_OBSTACLES, SOMETHING_ELSE_KEY } from "./schema";

/**
 * Two properties carry most of the risk and are tested hardest below:
 *
 *   1. Only required fields block. An over-eager check strands users on a
 *      screen they cannot answer, and they never reach a plan.
 *   2. Empty is null, not zero. A 0 tells the generator the business really has
 *      no audience, and it plans accordingly — a wrong plan that looks right.
 */

/* ------------------------------------------------------------------ *
 * Coercion
 * ------------------------------------------------------------------ */

describe("toNumberOrNull", () => {
  it("keeps a real zero as zero", () => {
    expect(toNumberOrNull(0)).toBe(0);
    expect(toNumberOrNull("0")).toBe(0);
  });

  // The whole point: Number("") is 0, which would silently answer the question.
  it("turns empty into null, never zero", () => {
    expect(toNumberOrNull("")).toBeNull();
    expect(toNumberOrNull("   ")).toBeNull();
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
  });

  it("strips the commas NumberInput renders", () => {
    expect(toNumberOrNull("1,000,000")).toBe(1_000_000);
    expect(toNumberOrNull("$750,000")).toBe(750_000);
  });

  it("returns null for junk rather than NaN", () => {
    expect(toNumberOrNull("abc")).toBeNull();
    expect(toNumberOrNull(NaN)).toBeNull();
    expect(toNumberOrNull({})).toBeNull();
  });
});

describe("audienceValue", () => {
  /** REQ-2.6 — "Not sure" stores null plus the flag, never 0. */
  it("stores null and the flag when Not sure is ticked", () => {
    expect(audienceValue("5000", true)).toEqual({ value: null, unknown: true });
  });

  it("discards a typed figure once Not sure is ticked", () => {
    // Two contradictory answers in one row is worse than losing the number.
    expect(audienceValue("12345", true).value).toBeNull();
  });

  it("keeps a real zero when Not sure is not ticked", () => {
    expect(audienceValue("0", false)).toEqual({ value: 0, unknown: false });
  });

  it("stores null without the flag when simply skipped", () => {
    expect(audienceValue("", false)).toEqual({ value: null, unknown: false });
  });
});

describe("toTextOrNull", () => {
  it("treats whitespace as unanswered", () => {
    expect(toTextOrNull("   ")).toBeNull();
    expect(toTextOrNull("")).toBeNull();
  });

  it("trims a real answer", () => {
    expect(toTextOrNull("  coaching  ")).toBe("coaching");
  });
});

describe("isAnswered", () => {
  it("counts zero and false as answers", () => {
    expect(isAnswered(0)).toBe(true);
    expect(isAnswered(false)).toBe(true);
  });

  it("does not count blanks or empty arrays", () => {
    expect(isAnswered("")).toBe(false);
    expect(isAnswered("  ")).toBe(false);
    expect(isAnswered([])).toBe(false);
    expect(isAnswered(null)).toBe(false);
  });
});

describe("percentError", () => {
  it("accepts 0 and 100 and everything between", () => {
    expect(percentError(0)).toBeNull();
    expect(percentError(100)).toBeNull();
    expect(percentError(12.5)).toBeNull();
  });

  it("rejects out-of-range values", () => {
    expect(percentError(-1)).not.toBeNull();
    expect(percentError(101)).not.toBeNull();
  });

  // Every funnel percentage is optional.
  it("accepts a blank", () => {
    expect(percentError("")).toBeNull();
    expect(percentError(null)).toBeNull();
  });
});

describe("moneyError", () => {
  it("allows zero", () => {
    expect(moneyError(0)).toBeNull();
  });

  it("rejects negatives", () => {
    expect(moneyError(-5)).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Required vs optional
 * ------------------------------------------------------------------ */

describe("only required fields block", () => {
  /**
   * The sweep that matters: an empty draft must produce errors for exactly the
   * fields listed in the required map, and nothing else.
   */
  for (const screen of screensFor("know_most")) {
    it(`${screen}: an empty screen errors on exactly its required fields`, () => {
      const res = validateScreen({ screen, answers: {} });
      const required = [...REQUIRED_FIELDS[screen]].sort();
      const errored = Object.keys(res.errors).sort();
      expect(errored).toEqual(required);
    });
  }

  it("lets the fully optional screens advance untouched", () => {
    for (const screen of ["wins", "audience", "obstacles"] as const) {
      expect(validateScreen({ screen, answers: {} }).valid).toBe(true);
    }
  });
});

describe("start screen", () => {
  it("blocks without a path and passes with one", () => {
    expect(validateScreen({ screen: "start", answers: {} }).valid).toBe(false);
    expect(
      validateScreen({ screen: "start", answers: { intake_path: "know_some" } }).valid
    ).toBe(true);
  });
});

describe("business screen", () => {
  const complete: IntakeAnswers = {
    industry: "Coaching & Consulting",
    prior_period_revenue: 450000,
    growth_stage: "momentum",
  };

  it("passes with the three required answers", () => {
    expect(validateScreen({ screen: "business", answers: complete }).valid).toBe(true);
  });

  it("does not require the description or sales model", () => {
    const res = validateScreen({ screen: "business", answers: complete });
    expect(res.errors.business_description).toBeUndefined();
    expect(res.errors.purchase_mode).toBeUndefined();
  });

  /**
   * "Other" with no text leaves the generator nothing to filter the library on,
   * so it is not a complete answer.
   */
  it("requires the free text when Other is chosen", () => {
    const res = validateScreen({
      screen: "business",
      answers: { ...complete, industry: "Other" },
    });
    expect(res.errors.industry_other).toBeDefined();
    expect(res.valid).toBe(false);
  });

  it("accepts Other once named", () => {
    const res = validateScreen({
      screen: "business",
      answers: { ...complete, industry: "Other", industry_other: "Marine logistics" },
    });
    expect(res.valid).toBe(true);
  });

  it("accepts zero revenue from a brand-new business", () => {
    const res = validateScreen({
      screen: "business",
      answers: { ...complete, prior_period_revenue: 0 },
    });
    expect(res.valid).toBe(true);
  });

  it("rejects negative revenue", () => {
    const res = validateScreen({
      screen: "business",
      answers: { ...complete, prior_period_revenue: -1000 },
    });
    expect(res.errors.prior_period_revenue).toBeDefined();
  });
});

describe("team screen", () => {
  const complete: IntakeAnswers = { team_size: 3, monthly_marketing_budget: 2000 };

  it("passes with team size and budget", () => {
    expect(validateScreen({ screen: "team", answers: complete }).valid).toBe(true);
  });

  // REQ-5.5 says $0 is allowed explicitly.
  it("accepts a zero budget", () => {
    const res = validateScreen({
      screen: "team",
      answers: { ...complete, monthly_marketing_budget: 0 },
    });
    expect(res.valid).toBe(true);
  });

  // The owner counts, so 0 people is a wrong answer rather than a skipped one.
  it("rejects a team of zero", () => {
    const res = validateScreen({ screen: "team", answers: { ...complete, team_size: 0 } });
    expect(res.errors.team_size).toBeDefined();
  });

  it("does not require hours", () => {
    expect(validateScreen({ screen: "team", answers: complete }).errors.weekly_hours)
      .toBeUndefined();
  });

  it("rejects more hours than a week contains", () => {
    const res = validateScreen({
      screen: "team",
      answers: { ...complete, weekly_hours: 200 },
    });
    expect(res.errors.weekly_hours).toBeDefined();
  });
});

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

describe("products screen", () => {
  const periods: IntakeAnswers = { horizon_months: 12, plan_start_month: "2026-11-01" };
  const product: ProductRow = {
    name: "Coaching program",
    average_price: 5000,
    units_in_period: 20,
  };
  const today = new Date(Date.UTC(2026, 9, 7)); // Oct 7, 2026

  it("passes with the period selectors and one complete product", () => {
    expect(validateProducts(periods, [product], today).valid).toBe(true);
  });

  it("blocks with no products at all", () => {
    const res = validateProducts(periods, [], today);
    expect(res.formError).toBeDefined();
    expect(res.valid).toBe(false);
  });

  it("rejects a horizon the column would reject too", () => {
    const res = validateProducts({ ...periods, horizon_months: 24 }, [product], today);
    expect(res.errors.horizon_months).toBeDefined();
  });

  /**
   * REQ-6.2. A plan starting last month would have the generator sequencing
   * tasks into dates that have already passed.
   */
  it("rejects a start month in the past", () => {
    const res = validateProducts(
      { ...periods, plan_start_month: "2026-09-01" },
      [product],
      today
    );
    expect(res.errors.plan_start_month).toBeDefined();
  });

  it("accepts the current month and future months", () => {
    expect(
      validateProducts({ ...periods, plan_start_month: "2026-10-01" }, [product], today).valid
    ).toBe(true);
    expect(
      validateProducts({ ...periods, plan_start_month: "2027-03-01" }, [product], today).valid
    ).toBe(true);
  });

  it("reports errors against the row that has them", () => {
    const res = validateProducts(periods, [product, { name: "Incomplete" }], today);
    expect(res.rowErrors[0]).toBeUndefined();
    expect(res.rowErrors[1]).toBeDefined();
    expect(res.rowErrors[1].average_price).toBeDefined();
    expect(res.rowErrors[1].units_in_period).toBeDefined();
  });

  it("does not require type, tier, pricing model or delivery", () => {
    const res = validateProducts(periods, [product], today);
    expect(res.rowErrors[0]).toBeUndefined();
  });

  // A zero price makes the product goal zero, understating the whole plan.
  it("rejects a zero or negative average price", () => {
    expect(
      validateProducts(periods, [{ ...product, average_price: 0 }], today).rowErrors[0]
        .average_price
    ).toBeDefined();
    expect(
      validateProducts(periods, [{ ...product, average_price: -10 }], today).rowErrors[0]
        .average_price
    ).toBeDefined();
  });

  it("rejects fractional or zero units", () => {
    expect(
      validateProducts(periods, [{ ...product, units_in_period: 2.5 }], today).rowErrors[0]
        .units_in_period
    ).toBeDefined();
    expect(
      validateProducts(periods, [{ ...product, units_in_period: 0 }], today).rowErrors[0]
        .units_in_period
    ).toBeDefined();
  });

  // REQ-6.6: Recurring reveals the interval, so a blank one was ignored.
  it("requires the interval once Recurring is chosen", () => {
    const res = validateProducts(
      periods,
      [{ ...product, payment_type: "recurring" }],
      today
    );
    expect(res.rowErrors[0].recurring_interval).toBeDefined();
  });

  it("accepts Recurring with an interval", () => {
    const res = validateProducts(
      periods,
      [{ ...product, payment_type: "recurring", recurring_interval: "month" }],
      today
    );
    expect(res.valid).toBe(true);
  });

  it("does not ask for an interval on a one-time product", () => {
    const res = validateProducts(
      periods,
      [{ ...product, payment_type: "one_time" }],
      today
    );
    expect(res.valid).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Goal
 * ------------------------------------------------------------------ */

describe("goal screen", () => {
  it("requires a goal above zero", () => {
    expect(validateScreen({ screen: "goal", answers: {} }).valid).toBe(false);
    expect(validateScreen({ screen: "goal", answers: { revenue_goal: 0 } }).valid).toBe(false);
    expect(validateScreen({ screen: "goal", answers: { revenue_goal: 750000 } }).valid).toBe(true);
  });

  /**
   * REQ-7.4. The stretch warning is advisory; a user who means to triple their
   * revenue is allowed to say so, and blocking here would override a
   * deliberate choice.
   */
  it("never blocks an ambitious goal", () => {
    const res = validateScreen({
      screen: "goal",
      answers: { revenue_goal: 5_000_000, prior_period_revenue: 100_000 },
    });
    expect(res.valid).toBe(true);
  });

  it("never blocks a goal below the products total", () => {
    const res = validateScreen({
      screen: "goal",
      answers: { revenue_goal: 50_000, products_total: 500_000 },
    });
    expect(res.valid).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Initiatives
 * ------------------------------------------------------------------ */

describe("initiatives screen", () => {
  const initiative: InitiativeRow = {
    initiative_key: "live_webinar_own",
    product_ids: ["p1"],
  };

  it("passes with one complete initiative", () => {
    expect(validateInitiatives([initiative]).valid).toBe(true);
  });

  it("blocks with none", () => {
    expect(validateInitiatives([]).formError).toBeDefined();
  });

  it("requires a type and at least one product", () => {
    const res = validateInitiatives([{}]);
    expect(res.rowErrors[0].initiative_key).toBeDefined();
    expect(res.rowErrors[0].product_ids).toBeDefined();
  });

  it("treats an empty product array as unanswered", () => {
    const res = validateInitiatives([{ ...initiative, product_ids: [] }]);
    expect(res.rowErrors[0].product_ids).toBeDefined();
  });

  // Dates are optional per REQ-8.7 — the calendar can set them later.
  it("does not require cadence or dates", () => {
    expect(validateInitiatives([initiative]).rowErrors[0]).toBeUndefined();
  });

  it("requires the frequency once On repeat is chosen", () => {
    const res = validateInitiatives([{ ...initiative, cadence: "repeat" }]);
    expect(res.rowErrors[0].repeat_frequency).toBeDefined();
  });

  it("accepts On repeat with a frequency", () => {
    const res = validateInitiatives([
      { ...initiative, cadence: "repeat", repeat_frequency: "monthly" },
    ]);
    expect(res.valid).toBe(true);
  });

  it("does not ask for a frequency on Once or Always on", () => {
    expect(validateInitiatives([{ ...initiative, cadence: "once" }]).valid).toBe(true);
    expect(validateInitiatives([{ ...initiative, cadence: "always_on" }]).valid).toBe(true);
  });

  // REQ-8.1 — "Something else" is a placeholder until it is named, and naming
  // it is what flags the library gap for review.
  it("requires the text behind Something else", () => {
    const res = validateInitiatives([
      { initiative_key: SOMETHING_ELSE_KEY, product_ids: ["p1"] },
    ]);
    expect(res.rowErrors[0].custom_label).toBeDefined();
  });

  it("accepts Something else once named", () => {
    const res = validateInitiatives([
      {
        initiative_key: SOMETHING_ELSE_KEY,
        product_ids: ["p1"],
        custom_label: "Direct mail campaign",
      },
    ]);
    expect(res.valid).toBe(true);
  });
});

describe("funnel validation", () => {
  // REQ-8.10: all five are optional.
  it("accepts a completely empty funnel", () => {
    expect(funnelErrors({})).toEqual({});
  });

  it("accepts a fully filled funnel", () => {
    const errors = funnelErrors({
      audience_reached: 3000,
      average_price: 5000,
      funnel_stages: [
        { key: "signed_up", percent: 12 },
        { key: "showed", percent: 30 },
        { key: "bought", percent: 4 },
      ],
    });
    expect(errors).toEqual({});
  });

  it("accepts a partially filled funnel without complaint", () => {
    const errors = funnelErrors({
      audience_reached: 3000,
      funnel_stages: [
        { key: "signed_up", percent: 12 },
        { key: "showed", percent: null },
      ],
    });
    expect(errors).toEqual({});
  });

  it("flags an out-of-range percentage against its own stage", () => {
    const errors = funnelErrors({
      funnel_stages: [
        { key: "signed_up", percent: 12 },
        { key: "showed", percent: 150 },
      ],
    });
    expect(errors["funnel.showed"]).toBeDefined();
    expect(errors["funnel.signed_up"]).toBeUndefined();
  });

  it("rejects a negative audience or price", () => {
    expect(funnelErrors({ audience_reached: -5 }).audience_reached).toBeDefined();
    expect(funnelErrors({ average_price: -5 }).average_price).toBeDefined();
  });

  it("ignores malformed stage entries rather than throwing", () => {
    expect(() =>
      funnelErrors({ funnel_stages: [null, "nonsense", { percent: 10 }] })
    ).not.toThrow();
  });

  it("ignores a non-array funnel_stages", () => {
    expect(funnelErrors({ funnel_stages: "oops" })).toEqual({});
  });
});

/* ------------------------------------------------------------------ *
 * Wins, customer, audience, obstacles
 * ------------------------------------------------------------------ */

describe("wins screen", () => {
  it("requires nothing", () => {
    expect(validateScreen({ screen: "wins", answers: {} }).valid).toBe(true);
  });

  /**
   * The same initiative cannot be both a win and a flop: REQ-13.8 would exclude
   * it while the wins list recommends it, so the generator gets contradictory
   * guidance.
   */
  it("rejects an initiative listed as both a win and a flop", () => {
    const res = validateScreen({
      screen: "wins",
      answers: {
        worked_initiatives: ["live_webinar_own", "email_campaign"],
        didnt_work: ["email_campaign"],
      },
    });
    expect(res.errors.didnt_work).toBeDefined();
  });

  it("accepts disjoint win and flop lists", () => {
    const res = validateScreen({
      screen: "wins",
      answers: {
        worked_initiatives: ["live_webinar_own"],
        didnt_work: ["paid_ads_meta"],
      },
    });
    expect(res.valid).toBe(true);
  });
});

describe("customer screen", () => {
  const complete: IntakeAnswers = {
    sells_to: "businesses",
    ideal_customer: "Coaches doing $300,000 to $3 million",
    problem_solved: "They need more clients without more ad spend",
  };

  it("requires both long-text answers", () => {
    const res = validateScreen({ screen: "customer", answers: { sells_to: "businesses" } });
    expect(res.errors.ideal_customer).toBeDefined();
    expect(res.errors.problem_solved).toBeDefined();
  });

  it("treats whitespace-only text as unanswered", () => {
    const res = validateScreen({
      screen: "customer",
      answers: { ...complete, ideal_customer: "    " },
    });
    expect(res.errors.ideal_customer).toBeDefined();
  });

  /**
   * REQ-10.2's industries field is revealed for Businesses but still optional:
   * someone selling across the board has no single answer to give.
   */
  it("does not require customer industries even when revealed", () => {
    expect(validateScreen({ screen: "customer", answers: complete }).valid).toBe(true);
  });
});

describe("audience screen", () => {
  it("passes with nothing filled in", () => {
    expect(validateScreen({ screen: "audience", answers: {} }).valid).toBe(true);
  });

  it("passes with every figure at zero", () => {
    const res = validateScreen({
      screen: "audience",
      answers: {
        email_list_size: 0,
        social_following: 0,
        monthly_visitors: 0,
        past_customers: 0,
        monthly_leads: 0,
      },
    });
    expect(res.valid).toBe(true);
  });

  it("rejects a negative figure", () => {
    const res = validateScreen({
      screen: "audience",
      answers: { email_list_size: -100 },
    });
    expect(res.errors.email_list_size).toBeDefined();
  });
});

describe("obstacles screen", () => {
  it("passes with none selected", () => {
    expect(validateScreen({ screen: "obstacles", answers: {} }).valid).toBe(true);
  });

  it(`accepts up to ${MAX_OBSTACLES}`, () => {
    const res = validateScreen({
      screen: "obstacles",
      answers: { challenges: ["need_leads", "limited_time", "limited_budget"] },
    });
    expect(res.valid).toBe(true);
  });

  // REQ-12.1 — the cap is re-checked here as well as in the UI.
  it("rejects more than the cap", () => {
    const res = validateScreen({
      screen: "obstacles",
      answers: {
        challenges: ["need_leads", "limited_time", "limited_budget", "team_capacity"],
      },
    });
    expect(res.errors.challenges).toBeDefined();
    expect(res.valid).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Whole-flow sweep
 * ------------------------------------------------------------------ */

describe("every screen on every path is validatable", () => {
  for (const path of ["know_most", "know_some", "recommend_all"] as const) {
    it(`${path}: no screen throws and none is unadvanceable`, () => {
      for (const screen of screensFor(path)) {
        expect(() => validateScreen({ screen, answers: {} })).not.toThrow();
      }
    });
  }

  // Path C omits this screen entirely, so its minimum-one rule never applies.
  it("never asks Path C for an initiative", () => {
    expect(screensFor("recommend_all")).not.toContain("initiatives");
  });
});
