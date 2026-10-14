import { describe, it, expect } from "vitest";
import {
  CANCEL_REASONS,
  ENABLED_OFFERS,
  isOfferEnabled,
  offerFor,
  isCancelReason,
  reasonSpec,
  stripeFeedbackFor,
  screensFor,
  stepLabel,
  nextScreen,
  previousScreen,
  canCancel,
  canReactivate,
  explainBlocker,
  reactivateByIso,
  formatAccessDate,
  describeCancellation,
  describeCancellationConfirmed,
  describeFeedbackOffer,
  describeFarewellOffer,
  DISCOUNT_OFFERS,
  DISCOUNT_NOTICE,
  defaultDiscountOfferFor,
  offersForCycle,
  offerAppliesToCycle,
  discountOffer,
  isDiscountOfferId,
  canOfferDiscount,
  billingResumesOn,
  describeDiscountOffer,
  describeOfferAccepted,
  sanitiseOfferDetails,
  namedAnotherTool,
  offerOutcomeFor,
  REACTIVATION_WINDOW_DAYS,
  DATA_IS_PURGED_AFTER_WINDOW,
  type CancellableSubscription,
  type CancelReason,
  type OfferId,
} from "./cancellation";

/**
 * A subscription that CAN be cancelled: a normal paying customer, mid-period.
 * Every test starts from this and breaks one thing, so what each case is really
 * asserting stays visible.
 */
const payer: CancellableSubscription = {
  status: "active",
  isComped: false,
  isPaused: false,
  cancelAtPeriodEnd: false,
  hasStripeSubscription: true,
  currentPeriodEnd: "2026-11-12T00:00:00.000Z",
};

describe("the reason catalogue", () => {
  it("has the six options from the mockup, each with a distinct id", () => {
    expect(CANCEL_REASONS).toHaveLength(6);
    const ids = CANCEL_REASONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(6);
  });

  it("gives every reason a step-2 offer, so no branch is a dead end", () => {
    for (const r of CANCEL_REASONS) {
      expect(r.offer).toBeTruthy();
      expect(r.label.trim()).not.toBe("");
    }
  });

  it("maps every offer id exactly once — no two reasons share a screen", () => {
    const offers = CANCEL_REASONS.map((r) => r.offer);
    expect(new Set(offers).size).toBe(6);
  });

  /**
   * Closing the business is the ONLY terminal branch. If a second reason ever
   * becomes terminal that is a deliberate product decision, not a typo, and it
   * should have to break this test to land.
   */
  it("treats only closing_business as terminal", () => {
    const terminal = CANCEL_REASONS.filter((r) => r.offerIsTerminal).map((r) => r.id);
    expect(terminal).toEqual(["closing_business"]);
  });

  it("rejects anything that is not a known reason", () => {
    for (const bad of ["", "TOO_EXPENSIVE", "other", null, undefined, 7, {}]) {
      expect(isCancelReason(bad)).toBe(false);
    }
    expect(isCancelReason("too_expensive")).toBe(true);
    expect(reasonSpec("nope")).toBeNull();
  });
});

describe("stripeFeedbackFor", () => {
  it("only ever returns values from Stripe's enum", () => {
    // Verbatim from stripe@22.6.2. An invented value is rejected by the API at
    // the worst possible moment — mid-cancellation.
    const allowed = new Set([
      "customer_service", "low_quality", "missing_features", "other",
      "switched_service", "too_complex", "too_expensive", "unused",
    ]);
    for (const r of CANCEL_REASONS) {
      expect(allowed.has(stripeFeedbackFor(r.id))).toBe(true);
    }
  });

  it("reports a named competitor as switched_service, whatever the reason", () => {
    expect(stripeFeedbackFor("missing_feature")).toBe("missing_features");
    expect(stripeFeedbackFor("missing_feature", { namedAnotherTool: true })).toBe("switched_service");
    // The override is not specific to that one screen.
    expect(stripeFeedbackFor("too_expensive", { namedAnotherTool: true })).toBe("switched_service");
  });

  it("does not switch on a falsy flag", () => {
    expect(stripeFeedbackFor("too_expensive", { namedAnotherTool: false })).toBe("too_expensive");
    expect(stripeFeedbackFor("too_expensive", {})).toBe("too_expensive");
  });
});

/** Phases, described as sets so these tests do not move when a screen ships. */
const NO_OFFERS = new Set<OfferId>();
const ALL_OFFERS = new Set<OfferId>([
  "discount", "reset_call", "strategy_call", "pause", "feedback", "farewell",
]);

describe("ENABLED_OFFERS", () => {
  /**
   * Only the screens that are built. The two call offers must stay off: they
   * need a booking URL that does not exist yet, and turning one on without it
   * would show a step whose only button goes nowhere.
   */
  it("has every screen built", () => {
    expect([...ENABLED_OFFERS].sort()).toEqual([
      "discount", "farewell", "feedback", "pause", "reset_call", "strategy_call",
    ]);
  });

  it("reports enablement per offer", () => {
    for (const offer of [
      "discount", "pause", "feedback", "farewell", "reset_call", "strategy_call",
    ] as const) {
      expect(isOfferEnabled(offer)).toBe(true);
    }
  });

  /**
   * BUILT IS NOT THE SAME AS REACHABLE. Four of the six carry a second gate
   * applied by the caller: the discount and pause are monthly-only, and the two
   * call screens need a booking URL configured. ENABLED_OFFERS answers only
   * "does this screen exist"; the modal narrows the set per customer.
   */
  it("resolves every reason to its offer when nothing is narrowed", () => {
    expect(offerFor("too_expensive")).toBe("discount");
    expect(offerFor("fell_behind")).toBe("reset_call");
    expect(offerFor("no_results")).toBe("strategy_call");
    expect(offerFor("busy_season")).toBe("pause");
    expect(offerFor("missing_feature")).toBe("feedback");
    expect(offerFor("closing_business")).toBe("farewell");
    expect(offerFor(null)).toBeNull();
    expect(offerFor("made_up" as CancelReason)).toBeNull();
  });

  /** With no booking URL set, the two call branches drop to two steps. */
  it("drops the call screens when a booking URL is not configured", () => {
    const withoutCalls = new Set(ENABLED_OFFERS);
    withoutCalls.delete("reset_call");
    withoutCalls.delete("strategy_call");

    expect(offerFor("fell_behind", withoutCalls)).toBeNull();
    expect(offerFor("no_results", withoutCalls)).toBeNull();
    expect(screensFor("fell_behind", { enabledOffers: withoutCalls }))
      .toEqual(["reason", "confirm"]);
    // Unaffected branches stay three steps.
    expect(screensFor("busy_season", { enabledOffers: withoutCalls }))
      .toEqual(["reason", "offer", "confirm"]);
  });

  it("resolves every offer once the set is complete", () => {
    for (const r of CANCEL_REASONS) {
      expect(offerFor(r.id, ALL_OFFERS)).toBe(r.offer);
    }
  });
});

describe("screensFor — the step count is derived, never hardcoded", () => {
  it("shows one screen until a reason is chosen", () => {
    expect(screensFor(null)).toEqual(["reason"]);
    expect(screensFor(null, { enabledOffers: ALL_OFFERS })).toEqual(["reason"]);
  });

  /**
   * With no step-2 screen built, every branch is two screens and the counter
   * must say "of 2". Saying "of 3" would promise a screen that never arrives.
   */
  it("is reason -> confirm for every reason when no offer exists", () => {
    for (const r of CANCEL_REASONS) {
      expect(screensFor(r.id, { enabledOffers: NO_OFFERS })).toEqual(["reason", "confirm"]);
    }
  });

  /** Every branch now has a step 2; only the farewell skips the confirmation. */
  it("inserts the offer screen for every branch", () => {
    for (const r of [
      "too_expensive", "fell_behind", "no_results", "busy_season", "missing_feature",
    ] as const) {
      expect(screensFor(r)).toEqual(["reason", "offer", "confirm"]);
    }
    expect(screensFor("closing_business")).toEqual(["reason", "offer"]);
  });

  it("inserts the offer screen for every branch once all are built", () => {
    expect(screensFor("too_expensive", { enabledOffers: ALL_OFFERS }))
      .toEqual(["reason", "offer", "confirm"]);
    expect(screensFor("busy_season", { enabledOffers: ALL_OFFERS }))
      .toEqual(["reason", "offer", "confirm"]);
  });

  it("drops the confirm step for the terminal farewell branch", () => {
    expect(screensFor("closing_business", { enabledOffers: ALL_OFFERS }))
      .toEqual(["reason", "offer"]);
  });

  it("falls back to the first screen for an unknown reason", () => {
    expect(screensFor("made_up" as CancelReason, { enabledOffers: ALL_OFFERS })).toEqual(["reason"]);
  });

  /**
   * THE BUG THIS PREVENTS. A screen is chosen from the reason, but whether its
   * offer can be HONOURED is a separate question — an annual subscriber cannot
   * claim either discount, and someone who already used their one offer cannot
   * claim again. Both were shown the budget screen with two buttons that failed.
   *
   * The caller narrows the set it passes, so an unavailable offer disappears
   * from the journey and the step counter drops to two on its own.
   */
  it("skips an offer that is built but cannot be granted to this customer", () => {
    const withoutDiscount = new Set(ENABLED_OFFERS);
    withoutDiscount.delete("discount");

    expect(screensFor("too_expensive", { enabledOffers: withoutDiscount }))
      .toEqual(["reason", "confirm"]);
    expect(offerFor("too_expensive", withoutDiscount)).toBeNull();
    expect(stepLabel(screensFor("too_expensive", { enabledOffers: withoutDiscount }), "reason"))
      .toBe("Step 1 of 2");

    // The other branches are untouched by that narrowing.
    expect(screensFor("missing_feature", { enabledOffers: withoutDiscount }))
      .toEqual(["reason", "offer", "confirm"]);
    expect(screensFor("closing_business", { enabledOffers: withoutDiscount }))
      .toEqual(["reason", "offer"]);
  });
});

describe("stepLabel", () => {
  it("counts from one and uses the real total", () => {
    const three = screensFor("no_results", { enabledOffers: ALL_OFFERS });
    expect(stepLabel(three, "reason")).toBe("Step 1 of 3");
    expect(stepLabel(three, "offer")).toBe("Step 2 of 3");
    expect(stepLabel(three, "confirm")).toBe("Step 3 of 3");
  });

  /** The mockup's own inconsistency, and it is correct: 2f really is 2 of 2. */
  it("says 2 of 2 on the farewell branch", () => {
    const two = screensFor("closing_business");
    expect(stepLabel(two, "offer")).toBe("Step 2 of 2");
  });

  /** The feedback branch is the one three-step journey shipped in phase 2. */
  it("says 1-3 of 3 on the feedback branch", () => {
    const three = screensFor("missing_feature");
    expect(stepLabel(three, "reason")).toBe("Step 1 of 3");
    expect(stepLabel(three, "offer")).toBe("Step 2 of 3");
    expect(stepLabel(three, "confirm")).toBe("Step 3 of 3");
  });

  it("says 2 of 2 for a branch whose offer is unavailable", () => {
    // Expressed through a narrowed set rather than a particular reason, so this
    // keeps testing the mechanism as screens come and go.
    const two = screensFor("fell_behind", { enabledOffers: NO_OFFERS });
    expect(stepLabel(two, "reason")).toBe("Step 1 of 2");
    expect(stepLabel(two, "confirm")).toBe("Step 2 of 2");
  });

  /** The budget branch, now that its screen exists. */
  it("says 1-3 of 3 on the discount branch", () => {
    const three = screensFor("too_expensive");
    expect(stepLabel(three, "reason")).toBe("Step 1 of 3");
    expect(stepLabel(three, "offer")).toBe("Step 2 of 3");
    expect(stepLabel(three, "confirm")).toBe("Step 3 of 3");
  });

  it("renders nothing rather than a placeholder total", () => {
    // Before a reason is picked the length is unknowable; "Step 1 of ?" is
    // worse than no indicator at all.
    expect(stepLabel(screensFor(null), "reason")).toBeNull();
    // A journey without an offer screen has no step to label for it.
    expect(stepLabel(screensFor("fell_behind", { enabledOffers: NO_OFFERS }), "offer"))
      .toBeNull();
  });
});

describe("nextScreen / previousScreen", () => {
  const three = screensFor("fell_behind", { enabledOffers: ALL_OFFERS });

  it("walks forwards and stops at the end", () => {
    expect(nextScreen(three, "reason")).toBe("offer");
    expect(nextScreen(three, "offer")).toBe("confirm");
    expect(nextScreen(three, "confirm")).toBeNull();
  });

  it("walks backwards and stops at the start", () => {
    expect(previousScreen(three, "confirm")).toBe("offer");
    expect(previousScreen(three, "offer")).toBe("reason");
    expect(previousScreen(three, "reason")).toBeNull();
  });

  it("skips the offer screen when it is unavailable", () => {
    const two = screensFor("fell_behind", { enabledOffers: NO_OFFERS });
    expect(nextScreen(two, "reason")).toBe("confirm");
    expect(previousScreen(two, "confirm")).toBe("reason");
  });

  it("returns null for a screen not in this journey", () => {
    const two = screensFor("fell_behind", { enabledOffers: NO_OFFERS });
    expect(nextScreen(two, "offer")).toBeNull();
    expect(previousScreen(two, "offer")).toBeNull();
  });

  /** Back from the feedback form lands on the reason list, not the confirm. */
  it("walks the feedback branch in both directions", () => {
    const journey = screensFor("missing_feature");
    expect(nextScreen(journey, "reason")).toBe("offer");
    expect(nextScreen(journey, "offer")).toBe("confirm");
    expect(previousScreen(journey, "offer")).toBe("reason");
  });
});

describe("describeFeedbackOffer — 2e", () => {
  const copy = describeFeedbackOffer();

  it("asks the question and says where the answer goes", () => {
    expect(copy.title).toMatch(/what should sam plan do/i);
    expect(copy.subtitle).toMatch(/product team/i);
  });

  it("labels every field and both exits", () => {
    for (const value of Object.values(copy)) {
      expect(typeof value).toBe("string");
      expect(value.trim()).not.toBe("");
    }
    expect(copy.continueLabel).toBe("Send, and continue");
    expect(copy.keepLabel).toMatch(/keep my plan/i);
  });

  /** No offer is made here, so nothing should read like one. */
  it("promises nothing in exchange", () => {
    const all = Object.values(copy).join(" ");
    expect(all).not.toMatch(/free|discount|% off|pause/i);
  });
});

describe("describeFarewellOffer — 2f", () => {
  const ends = "2026-11-12T00:00:00.000Z";

  it("thanks them and names the date access ends", () => {
    const copy = describeFarewellOffer({ accessEndsAt: ends });
    expect(copy.title).toMatch(/thank you/i);
    expect(copy.calloutBody).toContain("Nov 12, 2026");
    expect(copy.confirmLabel).toBe("Cancel my subscription");
    expect(copy.keepLabel).toBe("Keep my plan");
  });

  /**
   * This branch exists BECAUSE there is no sensible offer for someone closing
   * a business. If retention language ever appears here it is a mistake.
   */
  it("makes no attempt to retain them", () => {
    const copy = describeFarewellOffer({ accessEndsAt: ends });
    const all = [copy.title, copy.subtitle, copy.calloutTitle, copy.calloutBody].join(" ");
    expect(all).not.toMatch(/free|discount|% off|stay|book a call/i);
  });

  it("does not claim data is deleted while nothing deletes it", () => {
    const copy = describeFarewellOffer({ accessEndsAt: ends });
    expect(copy.calloutBody).not.toMatch(/no longer available|delete/i);
    expect(copy.calloutBody).toMatch(/kept/i);
  });

  it("uses the mockup's wording once a purge job exists", () => {
    const copy = describeFarewellOffer({ accessEndsAt: ends, purgesData: true });
    expect(copy.calloutBody).toMatch(/no longer available/i);
    expect(copy.calloutBody).toMatch(/90 days/);
  });

  it("degrades to a date-free sentence when the period end is unknown", () => {
    const copy = describeFarewellOffer({ accessEndsAt: null });
    expect(copy.calloutBody).not.toMatch(/Invalid|null|undefined/);
    expect(copy.calloutBody).toMatch(/current period/i);
  });
});

describe("sanitiseOfferDetails", () => {
  it("keeps the three fields the feedback form collects", () => {
    expect(
      sanitiseOfferDetails("feedback", {
        missing: "  Zapier integration  ",
        competingTool: " Notion ",
        notifyIfBuilt: true,
      })
    ).toEqual({
      missing: "Zapier integration",
      competingTool: "Notion",
      notifyIfBuilt: true,
    });
  });

  /**
   * The column is JSONB, so an unfiltered spread would persist anything a
   * caller sent. Only the keys the screen collects may survive.
   */
  it("drops everything it was not asked for", () => {
    const out = sanitiseOfferDetails("feedback", {
      missing: "x",
      isAdmin: true,
      company_id: "00000000-0000-0000-0000-000000000000",
      nested: { evil: true },
    });
    expect(Object.keys(out).sort()).toEqual(["competingTool", "missing", "notifyIfBuilt"]);
  });

  it("treats blank and absent as the same thing — null", () => {
    expect(sanitiseOfferDetails("feedback", { missing: "   ", competingTool: "" }))
      .toEqual({ missing: null, competingTool: null, notifyIfBuilt: false });
    expect(sanitiseOfferDetails("feedback", {}))
      .toEqual({ missing: null, competingTool: null, notifyIfBuilt: false });
  });

  it("caps long input rather than rejecting it", () => {
    const out = sanitiseOfferDetails("feedback", {
      missing: "a".repeat(5000),
      competingTool: "b".repeat(500),
    });
    expect((out.missing as string).length).toBe(2000);
    expect((out.competingTool as string).length).toBe(120);
  });

  /** A truthy string from a mis-serialised form is not consent to be emailed. */
  it("only accepts a real boolean true as opt-in", () => {
    for (const value of ["true", 1, "on", {}, [], "yes"]) {
      expect(sanitiseOfferDetails("feedback", { notifyIfBuilt: value }).notifyIfBuilt).toBe(false);
    }
    expect(sanitiseOfferDetails("feedback", { notifyIfBuilt: true }).notifyIfBuilt).toBe(true);
  });

  it("returns nothing for screens that collect nothing", () => {
    expect(sanitiseOfferDetails("farewell", { missing: "x" })).toEqual({});
    expect(sanitiseOfferDetails("discount", { missing: "x" })).toEqual({});
    expect(sanitiseOfferDetails(null, { missing: "x" })).toEqual({});
  });

  it("survives junk in place of an object", () => {
    for (const bad of [null, undefined, "string", 7, [], true]) {
      expect(sanitiseOfferDetails("feedback", bad))
        .toEqual({ missing: null, competingTool: null, notifyIfBuilt: false });
    }
  });
});

describe("namedAnotherTool", () => {
  it("is true only for a non-blank competitor", () => {
    expect(namedAnotherTool({ competingTool: "Notion" })).toBe(true);
    expect(namedAnotherTool({ competingTool: "   " })).toBe(false);
    expect(namedAnotherTool({ competingTool: null })).toBe(false);
    expect(namedAnotherTool({})).toBe(false);
  });

  /** Ties the two together: naming a tool changes what Stripe is told. */
  it("drives the switched_service feedback value", () => {
    const details = sanitiseOfferDetails("feedback", { competingTool: "Notion" });
    expect(stripeFeedbackFor("missing_feature", { namedAnotherTool: namedAnotherTool(details) }))
      .toBe("switched_service");

    const blank = sanitiseOfferDetails("feedback", { competingTool: "" });
    expect(stripeFeedbackFor("missing_feature", { namedAnotherTool: namedAnotherTool(blank) }))
      .toBe("missing_features");
  });
});

describe("DISCOUNT_OFFERS — 2a", () => {
  it("has the two monthly offers from the mockup plus the annual equivalent", () => {
    expect(DISCOUNT_OFFERS.map((o) => o.id))
      .toEqual(["free_month", "half_off_two_months", "annual_month_free"]);
  });

  it("preselects the free month for a monthly customer, as the mockup does", () => {
    expect(defaultDiscountOfferFor("monthly")!.id).toBe("free_month");
    expect(defaultDiscountOfferFor("monthly")!.badge).toBe("Most Popular");
  });

  it("preselects the annual offer for an annual customer", () => {
    // NOT DISCOUNT_OFFERS[0], which is monthly-only — an annual customer would
    // have opened the screen with an offer they cannot claim already selected.
    expect(defaultDiscountOfferFor("annual")!.id).toBe("annual_month_free");
  });

  it("has no default for a cycle with no offers", () => {
    for (const cycle of [null, "", "quarterly"]) {
      expect(defaultDiscountOfferFor(cycle)).toBeNull();
    }
  });

  /**
   * THE FREE-YEAR HAZARD, stated as a test.
   *
   * `percent_off: 100` discounts the NEXT INVOICE whatever period it covers.
   * On a monthly subscription that is one month; on an annual one it is a whole
   * year — $1,490 or $4,997 of product, from a button labelled "Next month
   * free". No 100%-off offer may ever be annual-eligible.
   */
  it("never allows a 100%-off coupon on an annual cycle", () => {
    for (const o of DISCOUNT_OFFERS) {
      if (o.percentOff === 100) {
        expect(o.cycles).not.toContain("annual");
      }
    }
  });

  it("keeps the annual offer to roughly one twelfth, never more", () => {
    const annual = discountOffer("annual_month_free")!;
    expect(annual.cycles).toEqual(["annual"]);
    // One month of twelve is 8.333%. Over it would be giving away more than
    // the "a month on us" the screen promises.
    expect(annual.percentOff).toBeGreaterThan(0);
    expect(annual.percentOff).toBeLessThanOrEqual(100 / 12);
  });

  it("gives every offer at least one cycle it is valid on", () => {
    for (const o of DISCOUNT_OFFERS) {
      expect(o.cycles.length).toBeGreaterThan(0);
      for (const c of o.cycles) expect(["monthly", "annual"]).toContain(c);
    }
  });

  it("splits the catalogue by cycle", () => {
    expect(offersForCycle("monthly").map((o) => o.id))
      .toEqual(["free_month", "half_off_two_months"]);
    expect(offersForCycle("annual").map((o) => o.id))
      .toEqual(["annual_month_free"]);
    for (const cycle of [null, "", "weekly", "quarterly"]) {
      expect(offersForCycle(cycle)).toEqual([]);
    }
  });

  it("answers whether one offer suits one cycle", () => {
    const free = discountOffer("free_month")!;
    const annual = discountOffer("annual_month_free")!;
    expect(offerAppliesToCycle(free, "monthly")).toBe(true);
    expect(offerAppliesToCycle(free, "annual")).toBe(false);
    expect(offerAppliesToCycle(annual, "annual")).toBe(true);
    expect(offerAppliesToCycle(annual, "monthly")).toBe(false);
    expect(offerAppliesToCycle(free, null)).toBe(false);
  });

  it("carries its own success wording, so a new offer needs no new branch", () => {
    for (const o of DISCOUNT_OFFERS) {
      expect(o.acceptedSummary.trim()).not.toBe("");
      expect(o.resumePrefix.trim()).not.toBe("");
    }
    // A monthly customer skips a payment; an annual one is still charged, just
    // less. Saying billing "resumes" to the latter implies no charge is coming.
    expect(discountOffer("annual_month_free")!.resumePrefix).not.toMatch(/billing resumes/i);
  });

  it("encodes terms Stripe will accept", () => {
    for (const o of DISCOUNT_OFFERS) {
      expect(o.percentOff).toBeGreaterThan(0);
      expect(o.percentOff).toBeLessThanOrEqual(100);
      // Stripe REQUIRES duration_in_months for 'repeating' and rejects it for
      // 'once'. Getting this wrong fails at the moment of granting.
      if (o.duration === "repeating") {
        expect(o.durationInMonths).toBeGreaterThan(0);
      } else {
        expect(o.durationInMonths).toBeNull();
      }
      expect(o.periodsCovered).toBeGreaterThan(0);
    }
  });

  /**
   * Coupon ids are fixed so granting is idempotent — the route retrieves by id
   * and only creates when absent. Two offers sharing an id would mean one
   * silently granting the other's terms.
   */
  it("gives each offer its own stable coupon id", () => {
    const ids = DISCOUNT_OFFERS.map((o) => o.couponId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^sam_retention_/);
  });

  it("covers one period for a once coupon and two for the repeating one", () => {
    expect(discountOffer("free_month")!.periodsCovered).toBe(1);
    expect(discountOffer("half_off_two_months")!.periodsCovered).toBe(2);
  });

  it("rejects anything that is not a known offer", () => {
    for (const bad of ["", "FREE_MONTH", "free_year", null, 7, {}]) {
      expect(isDiscountOfferId(bad)).toBe(false);
    }
    expect(isDiscountOfferId("free_month")).toBe(true);
    expect(discountOffer("nope")).toBeNull();
  });
});

describe("canOfferDiscount — every branch here stops giving money away", () => {
  const ok = {
    cancelEligible: true,
    billingCycle: "monthly",
    hasExistingDiscount: false,
    alreadyRedeemed: false,
    priceMinor: 4900,
  };

  it("allows a monthly payer who has never taken an offer", () => {
    expect(canOfferDiscount(ok)).toEqual({ allowed: true });
  });

  it("refuses when the customer could not cancel anyway", () => {
    expect(canOfferDiscount({ ...ok, cancelEligible: false }))
      .toEqual({ allowed: false, blocker: "not_eligible_to_cancel" });
  });

  /** Annual now has an offer of its own, so the screen is available there too. */
  it("allows an annual subscriber, who has their own offer", () => {
    expect(canOfferDiscount({ ...ok, billingCycle: "annual" })).toEqual({ allowed: true });
  });

  it("refuses a cycle with no offers at all, rather than assuming monthly", () => {
    for (const cycle of [null, "", "quarterly", "weekly"]) {
      expect(canOfferDiscount({ ...ok, billingCycle: cycle }))
        .toEqual({ allowed: false, blocker: "no_offer_for_cycle" });
    }
  });

  /**
   * THE EXPENSIVE ONE, and the reason the offer is passed in at claim time.
   *
   * The client chooses the offer id. An annual subscriber posting `free_month`
   * would receive a 100%-off coupon against an annual invoice — a free year.
   * The availability check above cannot catch this, because annual IS eligible
   * for the screen; only checking the chosen offer against the cycle does.
   */
  it("refuses a monthly offer to an annual subscriber", () => {
    expect(
      canOfferDiscount({
        ...ok,
        billingCycle: "annual",
        offer: discountOffer("free_month"),
      })
    ).toEqual({ allowed: false, blocker: "offer_wrong_cycle" });

    expect(
      canOfferDiscount({
        ...ok,
        billingCycle: "annual",
        offer: discountOffer("half_off_two_months"),
      })
    ).toEqual({ allowed: false, blocker: "offer_wrong_cycle" });
  });

  it("refuses the annual offer to a monthly subscriber", () => {
    // The mirror case: 8.33% off a monthly invoice is not what any screen
    // promises, and would be a token discount granted in place of a real one.
    expect(
      canOfferDiscount({
        ...ok,
        billingCycle: "monthly",
        offer: discountOffer("annual_month_free"),
      })
    ).toEqual({ allowed: false, blocker: "offer_wrong_cycle" });
  });

  it("allows each offer on its own cycle", () => {
    expect(canOfferDiscount({ ...ok, offer: discountOffer("free_month") }))
      .toEqual({ allowed: true });
    expect(canOfferDiscount({ ...ok, offer: discountOffer("half_off_two_months") }))
      .toEqual({ allowed: true });
    expect(
      canOfferDiscount({
        ...ok,
        billingCycle: "annual",
        offer: discountOffer("annual_month_free"),
      })
    ).toEqual({ allowed: true });
  });

  /**
   * Stripe's `discounts` array OVERWRITES. Applying ours to someone already on
   * a better promotion would silently remove it — making their bill worse via a
   * button that offered to save them money.
   */
  it("refuses to overwrite an existing discount", () => {
    expect(canOfferDiscount({ ...ok, hasExistingDiscount: true }))
      .toEqual({ allowed: false, blocker: "already_discounted" });
  });

  it("refuses a second redemption", () => {
    expect(canOfferDiscount({ ...ok, alreadyRedeemed: true }))
      .toEqual({ allowed: false, blocker: "already_redeemed" });
  });

  it("refuses when the price is unknown or zero, so terms cannot be stated", () => {
    for (const priceMinor of [null, 0, -100]) {
      expect(canOfferDiscount({ ...ok, priceMinor }))
        .toEqual({ allowed: false, blocker: "no_price" });
    }
  });

  /** Cheapest-first ordering, so the most fundamental reason is reported. */
  it("reports ineligibility to cancel ahead of everything else", () => {
    expect(
      canOfferDiscount({
        cancelEligible: false,
        billingCycle: "annual",
        hasExistingDiscount: true,
        alreadyRedeemed: true,
        priceMinor: null,
      })
    ).toEqual({ allowed: false, blocker: "not_eligible_to_cancel" });
  });
});

describe("billingResumesOn", () => {
  it("adds one month for the free-month offer", () => {
    expect(billingResumesOn("2026-11-12T00:00:00.000Z", 1))
      .toBe("2026-12-12T00:00:00.000Z");
  });

  it("adds two months for the half-price offer", () => {
    expect(billingResumesOn("2026-11-12T00:00:00.000Z", 2))
      .toBe("2027-01-12T00:00:00.000Z");
  });

  it("crosses the year boundary", () => {
    expect(billingResumesOn("2026-12-20T00:00:00.000Z", 2))
      .toBe("2027-02-20T00:00:00.000Z");
  });

  /**
   * Naive month arithmetic makes 31 January plus one month into 3 March, which
   * would promise a customer a week more than they are getting. Stripe clamps
   * to the shorter month and so does this.
   */
  it("clamps the day to the end of a shorter month", () => {
    expect(billingResumesOn("2027-01-31T00:00:00.000Z", 1))
      .toBe("2027-02-28T00:00:00.000Z");
    expect(billingResumesOn("2026-01-31T00:00:00.000Z", 1))
      .toBe("2026-02-28T00:00:00.000Z");
    expect(billingResumesOn("2026-03-31T00:00:00.000Z", 1))
      .toBe("2026-04-30T00:00:00.000Z");
  });

  it("handles a leap year February", () => {
    expect(billingResumesOn("2028-01-31T00:00:00.000Z", 1))
      .toBe("2028-02-29T00:00:00.000Z");
  });

  it("returns null rather than Invalid Date for bad input", () => {
    expect(billingResumesOn(null, 1)).toBeNull();
    expect(billingResumesOn("not a date", 1)).toBeNull();
    expect(billingResumesOn("2026-11-12T00:00:00.000Z", -1)).toBeNull();
    expect(billingResumesOn("2026-11-12T00:00:00.000Z", Number.NaN)).toBeNull();
  });
});

describe("describeDiscountOffer", () => {
  it("states what billing returns to", () => {
    const copy = describeDiscountOffer({ priceMinor: 4900 });
    expect(copy.footnote).toBe("One-time offer. Billing returns to $49/mo afterward.");
    expect(copy.declineLabel).toBe("No thanks, continue to cancel");
  });

  it("shows cents only when there are cents", () => {
    expect(describeDiscountOffer({ priceMinor: 4950 }).footnote).toContain("$49.50/mo");
    expect(describeDiscountOffer({ priceMinor: 10000 }).footnote).toContain("$100/mo");
  });

  it("stays truthful with no price, rather than printing a blank amount", () => {
    const copy = describeDiscountOffer({ priceMinor: null });
    expect(copy.footnote).not.toMatch(/\$|null|undefined|NaN/);
    expect(copy.footnote).toMatch(/one-time offer/i);
  });

  /** An annual subscriber told "returns to $1,490/mo" would reasonably panic. */
  it("uses the right unit for the cycle", () => {
    expect(describeDiscountOffer({ priceMinor: 149000, billingCycle: "annual" }).footnote)
      .toContain("$1,490/yr");
    expect(describeDiscountOffer({ priceMinor: 4900, billingCycle: "monthly" }).footnote)
      .toContain("$49/mo");
    // Defaults to monthly when unspecified, matching the catalogue's majority.
    expect(describeDiscountOffer({ priceMinor: 4900 }).footnote).toContain("/mo");
  });

  /** No scorecards exist in the product, so the copy must not mention them. */
  it("does not promise features that do not exist", () => {
    const copy = describeDiscountOffer({ priceMinor: 4900 });
    expect(copy.subtitle).not.toMatch(/scorecard/i);
    expect(copy.subtitle).toMatch(/initiatives/i);
  });

  /**
   * The mockup's "a free plan is coming in January" makes two promises nothing
   * backs — a free plan, and a notification when it opens — and goes stale by
   * the calendar. It stays off until both exist.
   */
  it("hides the free-plan notice by default", () => {
    expect(DISCOUNT_NOTICE).toBeNull();
    expect(describeDiscountOffer({ priceMinor: 4900 }).notice).toBeNull();
  });

  it("renders a notice once one is configured", () => {
    expect(describeDiscountOffer({ priceMinor: 4900, notice: "A free plan opens in May." }).notice)
      .toBe("A free plan opens in May.");
  });
});

describe("describeOfferAccepted", () => {
  const resumes = "2026-12-12T00:00:00.000Z";

  it("describes the free month accurately", () => {
    const copy = describeOfferAccepted({
      offer: discountOffer("free_month")!,
      billingResumesAt: resumes,
    });
    expect(copy.title).toMatch(/glad you're staying/i);
    expect(copy.body).toContain("Your next month is free.");
    expect(copy.body).toContain("Dec 12, 2026");
    expect(copy.body).toMatch(/emailed you/i);
  });

  /**
   * The mockup's placeholder only describes the free month. Shown after the
   * other offer it would misstate what the customer just agreed to.
   */
  it("describes the half-price offer differently", () => {
    const copy = describeOfferAccepted({
      offer: discountOffer("half_off_two_months")!,
      billingResumesAt: resumes,
    });
    expect(copy.body).toContain("next 2 months are half price");
    expect(copy.body).not.toMatch(/free/i);
  });

  /**
   * The annual renewal is still charged, only reduced, so this must not say
   * billing "resumes" — that implies no charge is coming when one is.
   */
  it("tells an annual customer their renewal is reduced, not skipped", () => {
    const copy = describeOfferAccepted({
      offer: discountOffer("annual_month_free")!,
      billingResumesAt: "2027-11-12T00:00:00.000Z",
    });
    expect(copy.body).toContain("taken a month off your next renewal");
    expect(copy.body).toContain("Full price resumes on Nov 12, 2027");
    expect(copy.body).not.toMatch(/billing resumes/i);
  });

  it("stays readable with no resume date", () => {
    const copy = describeOfferAccepted({
      offer: discountOffer("free_month")!,
      billingResumesAt: null,
    });
    expect(copy.body).not.toMatch(/Invalid|null|undefined/);
    expect(copy.body).toMatch(/normal billing resumes/i);
  });

  /** Points somewhere real: there is no scorecard route in this app. */
  it("sends them to a page that exists", () => {
    const copy = describeOfferAccepted({
      offer: defaultDiscountOfferFor("monthly")!,
      billingResumesAt: resumes,
    });
    expect(copy.ctaHref).toBe("/year-at-a-glance");
    expect(copy.nextStepBody).not.toMatch(/scorecard/i);
  });
});

describe("offerOutcomeFor", () => {
  it("is accepted when the offer screen kept them", () => {
    expect(offerOutcomeFor({ reachedOffer: true, outcome: "kept" })).toBe("accepted");
  });

  it("is declined when they saw it and cancelled anyway", () => {
    expect(offerOutcomeFor({ reachedOffer: true, outcome: "cancelled" })).toBe("declined");
  });

  /**
   * THE DISTINCTION THAT MATTERS. Someone who backed out at step 1 never saw an
   * offer, so recording them as having declined one would make every offer look
   * worse than it is.
   */
  it("is null when they never reached the offer", () => {
    expect(offerOutcomeFor({ reachedOffer: false, outcome: "kept" })).toBeNull();
    expect(offerOutcomeFor({ reachedOffer: false, outcome: "cancelled" })).toBeNull();
  });
});

describe("canCancel", () => {
  it("allows a paying customer mid-period", () => {
    expect(canCancel(payer)).toEqual({ allowed: true });
  });

  it("refuses when there is no subscription row", () => {
    expect(canCancel(null)).toEqual({ allowed: false, blocker: "no_subscription" });
  });

  /**
   * A pause outranks everything, matching evaluateAccess. An account an admin
   * suspended must not be closable from under them by the customer.
   */
  it("puts an admin pause ahead of every other state", () => {
    expect(canCancel({ ...payer, isPaused: true }))
      .toEqual({ allowed: false, blocker: "paused" });
    // Even when other blockers also apply.
    expect(canCancel({ ...payer, isPaused: true, isComped: true, status: "canceled" }))
      .toEqual({ allowed: false, blocker: "paused" });
  });

  it("refuses a comped account, which may have no Stripe subscription at all", () => {
    expect(canCancel({ ...payer, isComped: true, hasStripeSubscription: false, status: null }))
      .toEqual({ allowed: false, blocker: "comped" });
  });

  it("reports an already-cancelled subscription as such, not as already-ending", () => {
    // A lapsed subscription is both; "already cancelled" is the truer sentence.
    expect(canCancel({ ...payer, status: "canceled", cancelAtPeriodEnd: true }))
      .toEqual({ allowed: false, blocker: "already_canceled" });
  });

  /** The legacy British spelling lives in subscriptions.status via mapStripeStatus. */
  it("recognises the local 'cancelled' spelling too", () => {
    expect(canCancel({ ...payer, status: "cancelled" }))
      .toEqual({ allowed: false, blocker: "already_canceled" });
  });

  it("refuses to cancel twice", () => {
    expect(canCancel({ ...payer, cancelAtPeriodEnd: true }))
      .toEqual({ allowed: false, blocker: "already_ending" });
  });

  it("tells a trial user there is nothing to cancel", () => {
    // Migration 023 gives a trial a plan_id and no Stripe subscription.
    for (const status of ["trial", "trialing"]) {
      expect(canCancel({ ...payer, status, hasStripeSubscription: false }))
        .toEqual({ allowed: false, blocker: "trialing" });
    }
  });

  it("separates a non-trial account with no Stripe subscription", () => {
    expect(canCancel({ ...payer, status: "incomplete", hasStripeSubscription: false }))
      .toEqual({ allowed: false, blocker: "nothing_to_cancel" });
  });

  it("has a sentence for every blocker", () => {
    const blockers = [
      "no_subscription", "paused", "comped", "already_canceled",
      "already_ending", "trialing", "nothing_to_cancel",
    ] as const;
    for (const b of blockers) {
      expect(explainBlocker(b).length).toBeGreaterThan(10);
    }
  });

  /**
   * The paused message must not mention the reason. pause_reason is an internal
   * admin note that can read "non-payment" or "contract dispute", and
   * /api/billing/me deliberately withholds it.
   */
  it("does not leak why an account was paused", () => {
    expect(explainBlocker("paused")).not.toMatch(/reason/i);
  });
});

describe("canReactivate — one label, two operations", () => {
  it("resumes a subscription still inside its paid period", () => {
    expect(canReactivate({ ...payer, cancelAtPeriodEnd: true }))
      .toEqual({ allowed: true, kind: "resume" });
  });

  /**
   * Once Stripe has actually cancelled, the subscription is largely immutable —
   * update() will not bring it back, so this has to become a fresh Checkout.
   */
  it("requires a repurchase once the period has lapsed", () => {
    expect(canReactivate({ ...payer, status: "canceled", cancelAtPeriodEnd: true }))
      .toEqual({ allowed: true, kind: "repurchase" });
    expect(canReactivate({ ...payer, status: "cancelled", hasStripeSubscription: false }))
      .toEqual({ allowed: true, kind: "repurchase" });
  });

  it("has nothing to do for a healthy subscription", () => {
    expect(canReactivate(payer)).toEqual({ allowed: false, blocker: "not_ending" });
  });

  it("refuses for paused and comped accounts, and when there is no row", () => {
    expect(canReactivate({ ...payer, isPaused: true, cancelAtPeriodEnd: true }))
      .toEqual({ allowed: false, blocker: "paused" });
    expect(canReactivate({ ...payer, isComped: true, cancelAtPeriodEnd: true }))
      .toEqual({ allowed: false, blocker: "comped" });
    expect(canReactivate(null)).toEqual({ allowed: false, blocker: "no_subscription" });
  });

  /** cancel_at_period_end with no Stripe subscription is not resumable. */
  it("does not offer a resume with no Stripe subscription behind it", () => {
    expect(canReactivate({ ...payer, cancelAtPeriodEnd: true, hasStripeSubscription: false }))
      .toEqual({ allowed: false, blocker: "not_ending" });
  });
});

describe("dates", () => {
  it("adds the window to the access end date", () => {
    const by = reactivateByIso("2026-11-12T00:00:00.000Z", 90);
    expect(by).toBe("2027-02-10T00:00:00.000Z");
  });

  it("defaults to the 90-day window", () => {
    expect(reactivateByIso("2026-11-12T00:00:00.000Z"))
      .toBe(reactivateByIso("2026-11-12T00:00:00.000Z", REACTIVATION_WINDOW_DAYS));
  });

  it("returns null for missing or unparseable dates rather than Invalid Date", () => {
    expect(reactivateByIso(null)).toBeNull();
    expect(reactivateByIso("not a date")).toBeNull();
    expect(formatAccessDate(null)).toBeNull();
    expect(formatAccessDate("")).toBeNull();
    expect(formatAccessDate("not a date")).toBeNull();
  });

  it("formats a date the same way the rest of the billing UI does", () => {
    expect(formatAccessDate("2026-11-12T00:00:00.000Z")).toBe("Nov 12, 2026");
  });
});

describe("describeCancellation", () => {
  it("says access continues, because it does", () => {
    // evaluateAccess keeps returning 'active' until the period lapses. A
    // customer who thinks access stopped today stops using what they paid for.
    const p = describeCancellation({ planName: "Pro", accessEndsAt: "2026-11-12T00:00:00.000Z" });
    expect(p.accessLine).toContain("Nov 12, 2026");
    expect(p.accessLine).toMatch(/continues until/i);
    expect(p.confirmLabel).toBe("Cancel my subscription");
    expect(p.keepLabel).toBe("Keep my plan");
  });

  it("promises only what is certain when there is no period end", () => {
    const p = describeCancellation({ planName: "Pro", accessEndsAt: null });
    expect(p.accessLine).not.toMatch(/Invalid|null|undefined/);
    expect(p.accessLine).toMatch(/already paid for/i);
  });

  /**
   * THE IMPORTANT ONE. No purge job exists, so the default copy must not claim
   * data is deleted. Flipping the flag is what makes that sentence appear.
   */
  it("does not claim data is deleted while nothing deletes it", () => {
    expect(DATA_IS_PURGED_AFTER_WINDOW).toBe(false);
    const honest = describeCancellation({ planName: "Pro", accessEndsAt: "2026-11-12T00:00:00.000Z" });
    expect(honest.footnote).not.toMatch(/delete/i);
    expect(honest.footnote).toMatch(/kept/i);
  });

  it("uses the mockup's wording once a purge job exists", () => {
    const purged = describeCancellation({
      planName: "Pro",
      accessEndsAt: "2026-11-12T00:00:00.000Z",
      purgesData: true,
    });
    expect(purged.footnote).toMatch(/90 days/);
    expect(purged.footnote).toMatch(/permanently deleted/i);
  });
});

describe("describeCancellationConfirmed", () => {
  const base = {
    email: "owner@example.com",
    status: "active",
    accessEndsAt: "2026-11-12T00:00:00.000Z",
  };

  it("confirms to the address it was sent to and promises no further charge", () => {
    const c = describeCancellationConfirmed(base);
    expect(c.title).toBe("Your subscription is cancelled");
    expect(c.body).toContain("owner@example.com");
    expect(c.body).toMatch(/won't be charged again/i);
    expect(c.rows[0]).toEqual({ label: "Access until", value: "Nov 12, 2026" });
  });

  /**
   * The mockup's flat "Final charge: None" is wrong for a past_due customer:
   * Stripe is still retrying that invoice. Telling them they owe nothing is the
   * one error in this flow that reliably becomes a dispute.
   */
  it("does not tell a past_due customer they owe nothing", () => {
    for (const status of ["past_due", "unpaid"]) {
      const c = describeCancellationConfirmed({ ...base, status });
      const finalCharge = c.rows.find((r) => r.label === "Final charge");
      expect(finalCharge?.value).toMatch(/outstanding/i);
      expect(finalCharge?.value).not.toMatch(/^None/);
      expect(c.body).toMatch(/outstanding/i);
    }
  });

  it("says None for a customer in good standing", () => {
    const c = describeCancellationConfirmed(base);
    expect(c.rows.find((r) => r.label === "Final charge")?.value).toMatch(/^None/);
  });

  it("omits the reactivate-by row while nothing expires", () => {
    const c = describeCancellationConfirmed(base);
    expect(c.rows.map((r) => r.label)).not.toContain("Reactivate by");
    expect(c.footnote).toMatch(/any time/i);
  });

  it("shows the reactivate-by date once the window is enforced", () => {
    const c = describeCancellationConfirmed({ ...base, purgesData: true });
    expect(c.rows.find((r) => r.label === "Reactivate by")?.value).toBe("Feb 10, 2027");
    expect(c.footnote).toMatch(/90 days/);
  });

  it("reads sensibly with no email on file", () => {
    const c = describeCancellationConfirmed({ ...base, email: null });
    expect(c.body).not.toMatch(/null|undefined/);
    expect(c.body).toMatch(/won't be charged again/i);
  });

  it("always states when access ends, even with no date", () => {
    const c = describeCancellationConfirmed({ ...base, accessEndsAt: null });
    const access = c.rows.find((r) => r.label === "Access until");
    expect(access?.value).toBe("End of your current period");
  });
});
