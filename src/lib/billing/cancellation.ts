/**
 * Cancellation flow decisions, extracted as pure functions so they can be tested.
 *
 * WHY THIS FILE EXISTS. Same reasoning as plan-change.ts: cancellation is the
 * one flow where wrong wording does real damage. A screen that says "you won't
 * be charged again" to someone with an unpaid invoice, or "access ends today"
 * to someone who has paid for another three weeks, is worse than no screen at
 * all — and none of that can be asserted if the strings are built inline in a
 * React component next to a Stripe call.
 *
 * The routes and the modal perform the I/O. WHAT to say, WHICH screens to show
 * and WHETHER cancelling is even possible are decided here.
 *
 * No database, no Stripe, no React.
 */

import { addMonthsClamped } from "@/lib/billing/month-math";

/* ------------------------------------------------------------------ *
 * Reasons
 * ------------------------------------------------------------------ */

/** The six options on step 1, in the order the mockup lists them. */
export type CancelReason =
  | "too_expensive"
  | "fell_behind"
  | "no_results"
  | "busy_season"
  | "missing_feature"
  | "closing_business";

/**
 * Stripe's own `cancellation_details.feedback` enum, verbatim from
 * stripe@22.6.2. Sending it costs nothing and makes churn visible in the Stripe
 * dashboard's own reporting, next to the revenue it affected.
 */
export type StripeFeedback =
  | "customer_service"
  | "low_quality"
  | "missing_features"
  | "other"
  | "switched_service"
  | "too_complex"
  | "too_expensive"
  | "unused";

/**
 * The save-offer screen a reason leads to (step 2 in the mockup).
 *
 * Named by what they DO rather than by the mockup's 2a-2f labels, which say
 * nothing at a call site. The mapping is noted on each reason below.
 */
export type OfferId =
  | "discount"       // 2a - next month free / 50% off for 2 months
  | "reset_call"     // 2b - free 15-minute plan reset call
  | "strategy_call"  // 2c - 1:1 strategy call + weekly ROS meeting
  | "pause"          // 2d - pause billing for 1-3 months
  | "feedback"       // 2e - what should SAM Plan do that it doesn't
  | "farewell";      // 2f - no offer, just a dignified goodbye

export interface ReasonSpec {
  id: CancelReason;
  /** Radio label on step 1. */
  label: string;
  /** What we tell Stripe. */
  stripeFeedback: StripeFeedback;
  /** Which step-2 screen this reason opens. */
  offer: OfferId;
  /**
   * True when the offer screen itself ends the flow, so there is no
   * "what you'd lose" step after it.
   *
   * Only the farewell screen does this: its primary button is "Cancel my
   * subscription", which is the commitment itself — which is also why that
   * screen reads "Step 2 of 2" in the mockup while its siblings read "of 3".
   * Nobody closing their business should be shown a retention screen.
   */
  offerIsTerminal: boolean;
}

/**
 * NOTE ON WORDING. These labels are transcribed from the mockup. One is a best
 * reading: the second option is partly obscured in the supplied image, so
 * "I feel behind and stopped" may need correcting to the client's exact copy.
 * Changing a label here is safe — the stored value is the `id`, never the text.
 */
export const CANCEL_REASONS: readonly ReasonSpec[] = [
  {
    id: "too_expensive",
    label: "It's too expensive right now",
    stripeFeedback: "too_expensive",
    offer: "discount",
    offerIsTerminal: false,
  },
  {
    id: "fell_behind",
    label: "I feel behind and stopped",
    // 'unused' rather than 'too_complex': they stopped keeping up, which is
    // Stripe's "I don't use the service enough", not "it was too hard".
    stripeFeedback: "unused",
    offer: "reset_call",
    offerIsTerminal: false,
  },
  {
    id: "no_results",
    label: "I'm not seeing results yet",
    stripeFeedback: "low_quality",
    offer: "strategy_call",
    offerIsTerminal: false,
  },
  {
    id: "busy_season",
    label: "It's my busy season. I need a break",
    stripeFeedback: "unused",
    offer: "pause",
    offerIsTerminal: false,
  },
  {
    id: "missing_feature",
    label: "It's missing something I need",
    stripeFeedback: "missing_features",
    offer: "feedback",
    offerIsTerminal: false,
  },
  {
    id: "closing_business",
    label: "I'm closing or changing my business",
    stripeFeedback: "other",
    offer: "farewell",
    offerIsTerminal: true,
  },
];

const REASONS_BY_ID = new Map(CANCEL_REASONS.map((r) => [r.id as string, r]));

/**
 * Which step-2 screens actually exist yet.
 *
 * PER-OFFER, NOT A SINGLE SWITCH. The six screens have wildly different costs:
 * the feedback form and the farewell are a form and some copy, while the
 * discount needs Stripe coupons and a redemption ledger, and the two call
 * offers need a booking URL that does not exist. A global "offers on" flag
 * would mean shipping the cheap two forced shipping the expensive four, or
 * showing a reason-specific screen that silently falls back to generic copy.
 *
 * A reason whose offer is absent from this set skips straight from step 1 to
 * the confirmation, and `screensFor` reports two steps instead of three — so
 * the step counter stays truthful as each screen lands.
 *
 * Add an id here in the same change that builds its screen.
 */
export const ENABLED_OFFERS: ReadonlySet<OfferId> = new Set<OfferId>([
  "discount",       // 2a
  "reset_call",     // 2b — further gated on a booking URL being configured
  "strategy_call",  // 2c — same
  "pause",          // 2d
  "feedback",       // 2e
  "farewell",       // 2f
]);

export function isOfferEnabled(
  offer: OfferId,
  enabled: ReadonlySet<OfferId> = ENABLED_OFFERS
): boolean {
  return enabled.has(offer);
}

/** The offer screen a reason leads to, or null if that screen is not built. */
export function offerFor(
  reason: CancelReason | null,
  enabled: ReadonlySet<OfferId> = ENABLED_OFFERS
): OfferId | null {
  if (!reason) return null;
  const spec = REASONS_BY_ID.get(reason);
  if (!spec) return null;
  return enabled.has(spec.offer) ? spec.offer : null;
}

/** Validate a reason arriving from the client. Never trust the request body. */
export function isCancelReason(value: unknown): value is CancelReason {
  return typeof value === "string" && REASONS_BY_ID.has(value);
}

export function reasonSpec(id: string): ReasonSpec | null {
  return REASONS_BY_ID.get(id) ?? null;
}

/**
 * What to send Stripe as `cancellation_details.feedback`.
 *
 * `namedAnotherTool` exists for the feedback screen (2e), which asks "switching
 * to another tool?". If they name one, that is a competitive loss and
 * 'switched_service' is the more useful signal than 'missing_features' — it is
 * the difference between "build this" and "we lost to someone who already has".
 */
export function stripeFeedbackFor(
  reason: CancelReason,
  opts?: { namedAnotherTool?: boolean }
): StripeFeedback {
  if (opts?.namedAnotherTool) return "switched_service";
  return REASONS_BY_ID.get(reason)!.stripeFeedback;
}

/* ------------------------------------------------------------------ *
 * Screens and step numbering
 * ------------------------------------------------------------------ */

/**
 * The screens in the flow, excluding the terminal confirmation.
 *
 * "done" is not a step: the mockup's screen 4 carries no "Step X of Y"
 * indicator because by then there is nothing left to decide.
 */
export type FlowScreen = "reason" | "offer" | "confirm";

/**
 * Which screens this journey will pass through, and therefore what the step
 * counter should say.
 *
 * NOT A CONSTANT "of 3". The count genuinely varies three ways: the farewell
 * branch has no confirm step, a reason whose offer screen is not built yet goes
 * straight to the confirmation, and both of those change as ENABLED_OFFERS
 * grows. Hardcoding "of 3" would promise a screen that never arrives.
 *
 * With no reason picked yet the answer is just ["reason"] — the flow cannot
 * know how long it is until the customer tells it, so step 1 shows no total.
 *
 * `enabledOffers` is injectable so tests can describe a phase without being
 * rewritten every time a real screen ships.
 */
export function screensFor(
  reason: CancelReason | null,
  opts?: { enabledOffers?: ReadonlySet<OfferId> }
): FlowScreen[] {
  if (!reason) return ["reason"];

  const spec = REASONS_BY_ID.get(reason);
  if (!spec) return ["reason"];

  const enabled = opts?.enabledOffers ?? ENABLED_OFFERS;
  if (!enabled.has(spec.offer)) return ["reason", "confirm"];

  /**
   * The farewell screen's own primary button is "Cancel my subscription", so it
   * IS the commitment. Following it with a retention screen would be asking
   * someone who has told us they are closing their business to reconsider,
   * twice. This is why the mockup labels it "Step 2 of 2".
   */
  if (spec.offerIsTerminal) return ["reason", "offer"];

  return ["reason", "offer", "confirm"];
}

/**
 * "Step 2 of 3", or null when the total is not yet knowable.
 *
 * Returns null rather than "Step 1 of ?" so the caller can render nothing: a
 * placeholder total is worse than no indicator.
 */
export function stepLabel(screens: readonly FlowScreen[], current: FlowScreen): string | null {
  const index = screens.indexOf(current);
  if (index < 0) return null;
  if (screens.length < 2) return null;
  return `Step ${index + 1} of ${screens.length}`;
}

/** The screen that follows `current`, or null when `current` is the last one. */
export function nextScreen(
  screens: readonly FlowScreen[],
  current: FlowScreen
): FlowScreen | null {
  const index = screens.indexOf(current);
  if (index < 0 || index === screens.length - 1) return null;
  return screens[index + 1];
}

/** The screen before `current`, or null when `current` is the first. */
export function previousScreen(
  screens: readonly FlowScreen[],
  current: FlowScreen
): FlowScreen | null {
  const index = screens.indexOf(current);
  if (index <= 0) return null;
  return screens[index - 1];
}

/* ------------------------------------------------------------------ *
 * Can this subscription be cancelled at all?
 * ------------------------------------------------------------------ */

/** The subscription facts the guards need. Mirrors /api/billing/me's shape. */
export interface CancellableSubscription {
  /** `stripe_status ?? status` — the resolved status every caller uses. */
  status: string | null;
  isComped: boolean;
  isPaused: boolean;
  cancelAtPeriodEnd: boolean;
  hasStripeSubscription: boolean;
  currentPeriodEnd: string | null;
}

export type CancelBlocker =
  | "no_subscription"
  | "paused"
  | "comped"
  | "already_canceled"
  | "already_ending"
  | "trialing"
  | "nothing_to_cancel";

export type CancelEligibility =
  | { allowed: true }
  | { allowed: false; blocker: CancelBlocker };

/**
 * May this customer cancel?
 *
 * ORDER MATTERS, and each position is deliberate:
 *
 *  1. No row at all — nothing exists to act on.
 *  2. Admin-paused FIRST among the real states, mirroring evaluateAccess, which
 *     puts the pause above everything but the master switch. An account an
 *     admin has suspended is not one the customer should be able to quietly
 *     close from under them.
 *  3. Comped before status, because a comped account may have no Stripe
 *     subscription at all and its status is therefore meaningless. Same reason
 *     change-plan returns `comped_account`.
 *  4. Already cancelled before "already ending", since a lapsed subscription is
 *     both and the first is the more accurate thing to say.
 *  5. A trial is called out separately from the generic no-Stripe case purely so
 *     the customer gets a sentence that matches their situation.
 */
export function canCancel(sub: CancellableSubscription | null): CancelEligibility {
  if (!sub) return { allowed: false, blocker: "no_subscription" };
  if (sub.isPaused) return { allowed: false, blocker: "paused" };
  if (sub.isComped) return { allowed: false, blocker: "comped" };

  if (sub.status === "canceled" || sub.status === "cancelled") {
    return { allowed: false, blocker: "already_canceled" };
  }

  if (!sub.hasStripeSubscription) {
    const trialing = sub.status === "trialing" || sub.status === "trial";
    return { allowed: false, blocker: trialing ? "trialing" : "nothing_to_cancel" };
  }

  if (sub.cancelAtPeriodEnd) return { allowed: false, blocker: "already_ending" };

  return { allowed: true };
}

/** Why the cancel button is unavailable, in words the customer can act on. */
export function explainBlocker(blocker: CancelBlocker): string {
  switch (blocker) {
    case "no_subscription":
      return "There is no subscription to cancel.";
    case "paused":
      // Does NOT invite them to cancel instead: a paused account is an admin
      // decision and pause_reason is not shown to customers by design.
      return "Your account is paused. Contact support to make changes to your subscription.";
    case "comped":
      return "Your access was granted directly rather than purchased, so there is no subscription to cancel.";
    case "already_canceled":
      return "Your subscription has already been cancelled.";
    case "already_ending":
      return "Your subscription is already set to end — no further action is needed.";
    case "trialing":
      return "You're on a free trial, so there's nothing to cancel. It will simply end on its own.";
    case "nothing_to_cancel":
      return "There is no active paid subscription on this account.";
  }
}

/* ------------------------------------------------------------------ *
 * Reactivation
 * ------------------------------------------------------------------ */

export type ReactivateKind = "resume" | "repurchase";

export type ReactivateEligibility =
  | { allowed: true; kind: ReactivateKind }
  | { allowed: false; blocker: "not_ending" | "paused" | "comped" | "no_subscription" };

/**
 * "Reactivate my plan" is TWO different operations behind one label, and which
 * one applies depends entirely on whether the paid period has lapsed yet:
 *
 *   resume     — still inside the paid period, Stripe status still 'active'.
 *                Clearing cancel_at_period_end is enough; no money moves.
 *   repurchase — the period has ended and Stripe has cancelled for real. A
 *                cancelled subscription is largely immutable, so this needs a
 *                fresh Checkout, not an update.
 *
 * Treating these as one action is how you end up calling update() on a dead
 * subscription and reporting a confusing Stripe error to someone who just wants
 * to come back.
 */
export function canReactivate(sub: CancellableSubscription | null): ReactivateEligibility {
  if (!sub) return { allowed: false, blocker: "no_subscription" };
  if (sub.isPaused) return { allowed: false, blocker: "paused" };
  if (sub.isComped) return { allowed: false, blocker: "comped" };

  if (sub.status === "canceled" || sub.status === "cancelled") {
    return { allowed: true, kind: "repurchase" };
  }

  if (sub.cancelAtPeriodEnd && sub.hasStripeSubscription) {
    return { allowed: true, kind: "resume" };
  }

  return { allowed: false, blocker: "not_ending" };
}

/* ------------------------------------------------------------------ *
 * Dates and the reactivation window
 * ------------------------------------------------------------------ */

/** How long after access ends a customer can come back to everything intact. */
export const REACTIVATION_WINDOW_DAYS = 90;

/**
 * Does anything actually delete the data when that window closes?
 *
 * FALSE, and it must stay false until a purge job exists.
 *
 * The mockup's step 3 reads "After that, it's permanently deleted" and step 4
 * offers a "Reactivate by" date. Nothing in this codebase deletes anything on a
 * schedule — there is one cron (initiative-reminders) and it does not touch
 * customer data. Rendering that sentence today would be telling customers their
 * data is destroyed when it is retained indefinitely, which is both a false
 * statement and, for anyone who reads it as a deletion request, a data
 * protection problem.
 *
 * Flip this to true in the same change that ships the purge job, and the copy
 * below starts telling the truth on its own.
 */
export const DATA_IS_PURGED_AFTER_WINDOW = false;

/** Date formatting shared with billing-panel and plan-change: "12 Nov 2026". */
export function formatAccessDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { dateStyle: "medium" });
}

/** `accessEndsAt` plus the reactivation window, as an ISO string. */
export function reactivateByIso(
  accessEndsAt: string | null,
  windowDays: number = REACTIVATION_WINDOW_DAYS
): string | null {
  if (!accessEndsAt) return null;
  const end = new Date(accessEndsAt).getTime();
  if (!Number.isFinite(end)) return null;
  return new Date(end + windowDays * 24 * 60 * 60 * 1000).toISOString();
}

/* ------------------------------------------------------------------ *
 * Copy for the confirmation screens
 * ------------------------------------------------------------------ */

export interface CancellationPreview {
  /** Heading on the "what you'd lose" screen. */
  title: string;
  /** When access actually stops. */
  accessLine: string;
  /** The reactivation promise, phrased to match what the product really does. */
  footnote: string;
  confirmLabel: string;
  keepLabel: string;
}

/**
 * Step 3: what changes if you cancel.
 *
 * The access line is the sentence that matters most. Cancelling at period end
 * does NOT remove access today — evaluateAccess keeps returning `active` with a
 * warn flag until the period lapses — and a customer who believes otherwise
 * either stops using something they paid for or contacts support.
 */
export function describeCancellation(args: {
  planName: string;
  accessEndsAt: string | null;
  windowDays?: number;
  purgesData?: boolean;
}): CancellationPreview {
  const windowDays = args.windowDays ?? REACTIVATION_WINDOW_DAYS;
  const purges = args.purgesData ?? DATA_IS_PURGED_AFTER_WINDOW;
  const endDate = formatAccessDate(args.accessEndsAt);

  return {
    title: "Here's what changes if you cancel",
    accessLine: endDate
      ? `Your access continues until ${endDate}. Nothing changes before then.`
      : // No period end recorded: promise only what is certainly true.
        "You keep access for the rest of the period you have already paid for.",
    footnote: purges
      ? `Reactivate within ${windowDays} days to get everything back. After that, it's permanently deleted.`
      : // Honest version: we keep it, and coming back restores it.
        "Your plan and history are kept, so reactivating puts everything back where you left it.",
    confirmLabel: "Cancel my subscription",
    keepLabel: "Keep my plan",
  };
}

/* ------------------------------------------------------------------ *
 * Step 2: the save-offer screens that exist
 * ------------------------------------------------------------------ */

export interface FeedbackOfferCopy {
  title: string;
  subtitle: string;
  missingLabel: string;
  missingPlaceholder: string;
  toolLabel: string;
  toolPlaceholder: string;
  notifyLabel: string;
  continueLabel: string;
  keepLabel: string;
}

/**
 * 2e — "It's missing something I need".
 *
 * Not a retention offer at all: there is nothing to give someone whose blocker
 * is an absent capability, and pretending otherwise with a discount would be
 * insulting. So the screen asks the one question that has value to both sides
 * and gets out of the way.
 *
 * The competitor field is the most commercially useful input in the whole flow
 * — it turns "build this" into "we lost to someone who already has it" — which
 * is why answering it changes what we report to Stripe. See stripeFeedbackFor.
 */
export function describeFeedbackOffer(): FeedbackOfferCopy {
  return {
    title: "What should SAM Plan do that it doesn't?",
    subtitle: "This goes straight to the product team. We read every one.",
    missingLabel: "What's missing?",
    missingPlaceholder: "e.g. an integration, a report or a type of initiative",
    toolLabel: "Switching to another tool? (optional)",
    toolPlaceholder: "Which one?",
    notifyLabel: "Email me if we build it",
    continueLabel: "Send, and continue",
    keepLabel: "Actually, I'll keep my plan",
  };
}

export interface FarewellOfferCopy {
  title: string;
  subtitle: string;
  calloutTitle: string;
  calloutBody: string;
  confirmLabel: string;
  keepLabel: string;
}

/**
 * 2f — "I'm closing or changing my business".
 *
 * The only branch with no save attempt, deliberately. Someone winding a
 * business down cannot be retained by a discount or a coaching call, and trying
 * is the kind of thing people remember badly. The screen's job is to leave the
 * door open for whatever they build next.
 *
 * The callout still has to be accurate about what happens to the data, so it
 * respects the same purge flag as every other screen rather than repeating the
 * mockup's deletion promise unconditionally.
 */
export function describeFarewellOffer(args: {
  accessEndsAt: string | null;
  windowDays?: number;
  purgesData?: boolean;
}): FarewellOfferCopy {
  const windowDays = args.windowDays ?? REACTIVATION_WINDOW_DAYS;
  const purges = args.purgesData ?? DATA_IS_PURGED_AFTER_WINDOW;
  const endDate = formatAccessDate(args.accessEndsAt);

  const accessSentence = endDate
    ? `Your access ends on ${endDate}.`
    : "Your access ends when your current period finishes.";

  return {
    title: "Thank you for building with us",
    subtitle:
      "Closing or changing a business is a big decision. We hope SAM Plan helped " +
      "along the way, and we'd love to see you again if you build something new.",
    calloutTitle: "Before you go",
    calloutBody: purges
      ? `${accessSentence} After that, your revenue plan and history are no longer ` +
        `available. If you start something new within ${windowDays} days, reactivate ` +
        `and it all comes back.`
      : // Honest version: nothing is destroyed, so coming back always works.
        `${accessSentence} Your revenue plan and history are kept, so if you start ` +
        `something new you can reactivate and pick up exactly where you left off.`,
    confirmLabel: "Cancel my subscription",
    keepLabel: "Keep my plan",
  };
}

/* ------------------------------------------------------------------ *
 * 2a — the discount offer
 * ------------------------------------------------------------------ */

export type DiscountOfferId =
  | "free_month"
  | "half_off_two_months"
  | "annual_month_free";

export type BillingCycle = "monthly" | "annual";

export interface DiscountOfferSpec {
  id: DiscountOfferId;
  /**
   * Billing cycles this offer may be granted on.
   *
   * THE MOST IMPORTANT FIELD HERE. A 100%-off-once coupon is "one month free"
   * on a monthly subscription and "one YEAR free" on an annual one — the same
   * coupon, two wildly different amounts, because Stripe discounts the next
   * invoice whatever period it covers. Pairing every offer with the cycles it
   * is safe on is what stops a monthly offer reaching an annual subscriber,
   * and both canOfferDiscount and the claim route check it.
   */
  cycles: readonly BillingCycle[];
  /** Card heading. */
  title: string;
  /** One line under it. */
  blurb: string;
  /** "Most Popular", or null. */
  badge: string | null;
  /** Button label when this card is the selected one. */
  claimLabel: string;
  /**
   * What they got, as a complete sentence for the success screen and email.
   *
   * On the spec rather than branched on `id` at the point of use, because it
   * was already being reconstructed in two places (the route's response and
   * describeOfferAccepted) and a third offer would have meant a third
   * divergent copy of the same conditional.
   */
  acceptedSummary: string;
  /**
   * How to introduce the date full price returns.
   *
   * Differs by cycle and is not cosmetic. A monthly customer skips a payment,
   * so "Billing resumes on X" is right. An annual customer is still charged at
   * renewal, only less — telling them billing "resumes" would imply no charge
   * is coming when one is.
   */
  resumePrefix: string;
  /**
   * Stripe coupon id, fixed rather than generated.
   *
   * A deterministic id makes granting the discount idempotent: the route
   * retrieves this id and only creates the coupon if it is absent, so there is
   * never a second "50% off" coupon drifting into existence with different
   * terms. It also means the terms of a live coupon are visible in the Stripe
   * dashboard under a name that says what it is.
   */
  couponId: string;
  percentOff: number;
  duration: "once" | "repeating";
  /** Required by Stripe when duration is 'repeating', null otherwise. */
  durationInMonths: number | null;
  /**
   * How many billing periods the discount covers. Drives the "billing resumes"
   * date, and is NOT always equal to durationInMonths — a 'once' coupon covers
   * exactly one invoice and has no month count at all.
   */
  periodsCovered: number;
}

/**
 * The two offers from the mockup.
 *
 * MONTHLY ONLY — see canOfferDiscount. A 100%-off-once coupon applied to an
 * annual subscription makes the next ANNUAL invoice free, which is a year of
 * the product given away by a button labelled "Next month free". That is the
 * single most expensive mistake available in this flow, so the guard lives in
 * code rather than in the hope that nobody on an annual plan ever cancels.
 */
export const DISCOUNT_OFFERS: readonly DiscountOfferSpec[] = [
  {
    id: "free_month",
    cycles: ["monthly"],
    title: "Next month free",
    blurb: "Skip your next payment and keep everything running.",
    badge: "Most Popular",
    claimLabel: "Claim my free month",
    acceptedSummary: "Your next month is free.",
    resumePrefix: "Billing resumes on",
    couponId: "sam_retention_free_month",
    percentOff: 100,
    duration: "once",
    durationInMonths: null,
    periodsCovered: 1,
  },
  {
    id: "half_off_two_months",
    cycles: ["monthly"],
    title: "50% off for 2 months",
    blurb: "Half price while you get your next initiative moving.",
    badge: null,
    claimLabel: "Claim 50% off",
    acceptedSummary: "Your next 2 months are half price.",
    resumePrefix: "Billing resumes on",
    couponId: "sam_retention_half_off_2mo",
    percentOff: 50,
    duration: "repeating",
    durationInMonths: 2,
    periodsCovered: 2,
  },
  /**
   * The annual equivalent of "next month free".
   *
   * EXPRESSED AS A PERCENTAGE, NOT A FIXED AMOUNT. One twelfth of the year is
   * 8.33%, which scales itself across every annual plan — $124 on a $1,490
   * plan, $416 on a $4,997 one. A fixed `amount_off` cannot do that: Stripe
   * ties it to one currency and one figure, so matching generosity across plans
   * would need a separate coupon per price, multiplying the coupons in
   * circulation for no benefit.
   *
   * 100% off was never an option here. On an annual invoice that is a free
   * year, which is the hazard the `cycles` field exists to prevent.
   *
   * The renewal is still CHARGED, just reduced, which is why its resumePrefix
   * differs from the monthly offers'. periodsCovered is 12 because the next
   * full-price invoice is a year after the discounted one.
   */
  {
    id: "annual_month_free",
    cycles: ["annual"],
    title: "A month on us",
    blurb: "We'll take a month off your next renewal and nothing else changes.",
    badge: null,
    claimLabel: "Claim my month on us",
    acceptedSummary: "We've taken a month off your next renewal.",
    resumePrefix: "Full price resumes on",
    couponId: "sam_retention_annual_month_free",
    // One twelfth. Slightly under the exact 8.333 so rounding never favours
    // the discount over the stated "a month".
    percentOff: 8.33,
    duration: "once",
    durationInMonths: null,
    periodsCovered: 12,
  },
];

const DISCOUNTS_BY_ID = new Map(DISCOUNT_OFFERS.map((o) => [o.id as string, o]));

export function isDiscountOfferId(value: unknown): value is DiscountOfferId {
  return typeof value === "string" && DISCOUNTS_BY_ID.has(value);
}

export function discountOffer(id: string): DiscountOfferSpec | null {
  return DISCOUNTS_BY_ID.get(id) ?? null;
}

/** The offers that may be granted on a given billing cycle. */
export function offersForCycle(billingCycle: string | null): DiscountOfferSpec[] {
  if (billingCycle !== "monthly" && billingCycle !== "annual") return [];
  return DISCOUNT_OFFERS.filter((o) => o.cycles.includes(billingCycle));
}

/** May this specific offer be granted on this cycle? The money guard. */
export function offerAppliesToCycle(
  offer: DiscountOfferSpec,
  billingCycle: string | null
): boolean {
  if (billingCycle !== "monthly" && billingCycle !== "annual") return false;
  return offer.cycles.includes(billingCycle);
}

/**
 * The card that starts selected, for this customer's cycle.
 *
 * Cycle-aware rather than simply DISCOUNT_OFFERS[0]: that first entry is
 * monthly-only, so an annual customer would have opened the screen with an
 * offer preselected that they are not allowed to claim.
 */
export function defaultDiscountOfferFor(
  billingCycle: string | null
): DiscountOfferSpec | null {
  return offersForCycle(billingCycle)[0] ?? null;
}

export type DiscountBlocker =
  | "not_eligible_to_cancel"
  | "no_offer_for_cycle"
  | "offer_wrong_cycle"
  | "already_discounted"
  | "already_redeemed"
  | "no_price";

export type DiscountEligibility =
  | { allowed: true }
  | { allowed: false; blocker: DiscountBlocker };

/**
 * May this customer be offered a discount?
 *
 * Every branch here prevents giving away money, so the order is from cheapest
 * check to most specific:
 *
 *  1. `cancelEligible` — the offer only makes sense for someone who could
 *     actually cancel. A comped account has nothing to discount, and an
 *     already-ending one should be sent to reactivate instead.
 *  2. THE CYCLE RULE, in two forms. Without a specific offer in hand the
 *     question is "does this cycle have any offer at all"; with one it is
 *     "may THIS offer be granted on this cycle". The second is the guard that
 *     matters: the client picks the offer id, so an annual subscriber posting
 *     `free_month` would otherwise receive a 100%-off coupon against an annual
 *     invoice — a free year.
 *  3. An existing Stripe discount is refused because applying ours would
 *     REPLACE it. Stripe's `discounts` array overwrites rather than appends, so
 *     a customer already on a better promotion would silently lose it — we
 *     would have made their bill worse with a button that said "save money".
 *  4. One per company, ever. The database UNIQUE is the real enforcement; this
 *     check exists so the screen is never shown with a button that cannot work.
 *  5. No known price means the footnote cannot say what billing returns to, and
 *     an offer whose terms we cannot state is not one to make.
 */
export function canOfferDiscount(args: {
  cancelEligible: boolean;
  billingCycle: string | null;
  hasExistingDiscount: boolean;
  alreadyRedeemed: boolean;
  priceMinor: number | null;
  /**
   * The offer being claimed, when one has been chosen.
   *
   * Omitted by the availability check that decides whether to SHOW the screen,
   * supplied by the route that decides whether to GRANT. Passing it switches
   * the cycle test from "any offer exists" to "this offer is allowed", which is
   * the difference between hiding a screen and giving away a year.
   */
  offer?: DiscountOfferSpec | null;
}): DiscountEligibility {
  if (!args.cancelEligible) {
    return { allowed: false, blocker: "not_eligible_to_cancel" };
  }

  if (args.offer) {
    if (!offerAppliesToCycle(args.offer, args.billingCycle)) {
      return { allowed: false, blocker: "offer_wrong_cycle" };
    }
  } else if (offersForCycle(args.billingCycle).length === 0) {
    return { allowed: false, blocker: "no_offer_for_cycle" };
  }
  if (args.hasExistingDiscount) {
    return { allowed: false, blocker: "already_discounted" };
  }
  if (args.alreadyRedeemed) {
    return { allowed: false, blocker: "already_redeemed" };
  }
  if (typeof args.priceMinor !== "number" || args.priceMinor <= 0) {
    return { allowed: false, blocker: "no_price" };
  }
  return { allowed: true };
}

/**
 * When full billing resumes, as an ISO string.
 *
 * Counts whole months forward from the end of the current period, because that
 * is the invoice the discount first lands on: a 'once' coupon covers the
 * invoice raised at `currentPeriodEnd`, so the first full-price charge is one
 * month after it.
 *
 * DAY-OF-MONTH IS CLAMPED. Naive month arithmetic turns 31 January plus one
 * month into 3 March, which would tell a customer billing resumes a week later
 * than it does. Stripe anchors to the billing cycle and clamps the same way.
 */
export function billingResumesOn(
  currentPeriodEnd: string | null,
  periodsCovered: number
): string | null {
  return addMonthsClamped(currentPeriodEnd, periodsCovered);
}

export interface DiscountOfferCopy {
  title: string;
  subtitle: string;
  /** "One-time offer. Billing returns to $49/mo afterward." */
  footnote: string;
  declineLabel: string;
  /** Optional notice, only rendered when one is configured. */
  notice: string | null;
}

/**
 * An extra note the mockup shows under the cards: "A free plan is coming in
 * January. If you'd rather wait for it, we'll let you know the day it opens."
 *
 * NULL, and it must stay null until both halves are true.
 *
 * It makes two promises — that a free plan ships, and that we will email them
 * when it does — and neither exists. Worse, it names a month, so it becomes
 * false by the calendar rather than by anything changing. Showing it to a
 * customer who then stays on the strength of it is the kind of thing that
 * turns a retained customer into an angry one.
 *
 * Set it when there is a free plan and something that notifies.
 */
export const DISCOUNT_NOTICE: string | null = null;

export function describeDiscountOffer(args: {
  priceMinor: number | null;
  currency?: string;
  /** Drives "/mo" versus "/yr" in the footnote. */
  billingCycle?: string | null;
  notice?: string | null;
}): DiscountOfferCopy {
  const currency = args.currency ?? "usd";
  const per = args.billingCycle === "annual" ? "yr" : "mo";
  const symbol = currency.toUpperCase() === "USD" ? "$" : "";
  const price =
    typeof args.priceMinor === "number" && Number.isFinite(args.priceMinor)
      ? `${symbol}${(args.priceMinor / 100).toLocaleString("en-US", {
          minimumFractionDigits: args.priceMinor % 100 === 0 ? 0 : 2,
          maximumFractionDigits: 2,
        })}`
      : null;

  return {
    title: "Let's make this easier on your budget",
    // "scorecards" in the mockup: no such feature exists, so this names the
    // things the product actually has.
    subtitle: "Pick one. Your plan, initiatives and history stay exactly where they are.",
    footnote: price
      ? `One-time offer. Billing returns to ${price}/${per} afterward.`
      : "One-time offer. Your normal billing resumes afterward.",
    declineLabel: "No thanks, continue to cancel",
    notice: args.notice ?? DISCOUNT_NOTICE,
  };
}

export interface OfferAcceptedCopy {
  title: string;
  /** What they just got, plus the email confirmation. */
  body: string;
  nextStepTitle: string;
  nextStepBody: string;
  /** Where the primary button goes, and what it says. */
  ctaLabel: string;
  ctaHref: string;
}

/**
 * The terminal screen after an offer is accepted.
 *
 * The summary is BUILT FROM THE APPLIED OFFER, not a fixed string. The mockup
 * carries a placeholder ("Your next month is free. Billing resumes on [DATE]")
 * which only describes one of the two offers; shown after the other it would be
 * plainly wrong about what the customer had just agreed to.
 *
 * The mockup's next step is "Close this week's scorecard". No scorecard exists
 * in the product, so this points at the dashboard, which does. Swap it when
 * there is something better to send them to.
 */
export function describeOfferAccepted(args: {
  offer: DiscountOfferSpec;
  billingResumesAt: string | null;
}): OfferAcceptedCopy {
  const resumes = formatAccessDate(args.billingResumesAt);

  // Both halves come from the spec, so a new offer brings its own wording
  // rather than needing another branch here.
  const what = args.offer.acceptedSummary;
  const when = resumes
    ? ` ${args.offer.resumePrefix} ${resumes}.`
    : " Your normal billing resumes after that.";

  return {
    title: "You're all set. Glad you're staying.",
    body: `${what}${when} We've emailed you the details.`,
    nextStepTitle: "Your next step",
    nextStepBody:
      "Pick up where you left off — check your plan for what's due this week and " +
      "get it current again.",
    ctaLabel: "Go to my plan",
    ctaHref: "/year-at-a-glance",
  };
}

/* ------------------------------------------------------------------ *
 * Offer payloads
 * ------------------------------------------------------------------ */

/** Caps, so a pasted essay cannot bloat the row or the Stripe comment. */
const MAX_MISSING_CHARS = 2000;
const MAX_TOOL_CHARS = 120;

export interface FeedbackOfferDetails {
  missing: string | null;
  competingTool: string | null;
  notifyIfBuilt: boolean;
}

/**
 * Normalise whatever the client sent for an offer screen into something safe to
 * store in `cancellation_feedback.details`.
 *
 * ALLOW-LIST, NOT SANITISE-IN-PLACE. The column is JSONB, so an unfiltered
 * spread of the request body would persist anything a caller felt like sending
 * — a convenient place to park junk that later shows up in an admin churn view.
 * Only the keys each screen actually collects survive, and a screen with no
 * payload (the farewell) returns an empty object rather than passing input
 * through.
 *
 * Empty strings become null. "" and "not answered" are the same fact, and
 * storing both makes every later query check for two things.
 */
export function sanitiseOfferDetails(
  offer: OfferId | null,
  raw: unknown
): Record<string, unknown> {
  if (offer !== "feedback") return {};

  /**
   * ONE SHAPE PER SCREEN, always.
   *
   * Non-object input is treated as "answered nothing" rather than returning an
   * empty object, so a feedback row always carries the same three keys. The
   * alternative stores two different shapes for the identical fact — the screen
   * was reached, nothing was typed — and every query over `details` then has to
   * cope with both.
   */
  const input: Record<string, unknown> =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const text = (value: unknown, max: number): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, max) : null;
  };

  const details: FeedbackOfferDetails = {
    missing: text(input.missing, MAX_MISSING_CHARS),
    competingTool: text(input.competingTool, MAX_TOOL_CHARS),
    // Strict: only a real boolean true opts them in. A truthy string from a
    // mis-serialised form must not be read as consent to be emailed.
    notifyIfBuilt: input.notifyIfBuilt === true,
  };

  return details as unknown as Record<string, unknown>;
}

/** Did the competitor field get an answer? Drives the Stripe feedback value. */
export function namedAnotherTool(details: Record<string, unknown>): boolean {
  return typeof details.competingTool === "string" && details.competingTool.trim() !== "";
}

export type OfferOutcome = "accepted" | "declined";

/**
 * Did the step-2 screen do its job?
 *
 * DERIVED, never sent by the client. The only thing the client is trusted for
 * is how far the customer got (`reachedOffer`), because that is the one fact
 * the server cannot see. Everything else follows:
 *
 *   accepted — they saw the offer and stayed. The screen worked.
 *   declined — they saw the offer and carried on cancelling.
 *   null     — they never reached it, so it has no outcome. Keeping this
 *              distinct from "declined" is the whole point: lumping together
 *              people who refused an offer with people who never saw one makes
 *              every offer look worse than it is.
 */
export function offerOutcomeFor(args: {
  reachedOffer: boolean;
  outcome: "cancelled" | "kept";
}): OfferOutcome | null {
  if (!args.reachedOffer) return null;
  return args.outcome === "kept" ? "accepted" : "declined";
}

export interface ConfirmationRow {
  label: string;
  value: string;
}

export interface CancellationConfirmation {
  title: string;
  /** "We've sent a confirmation to you@example.com. You won't be charged again." */
  body: string;
  rows: ConfirmationRow[];
  /** The "changed your mind?" line. */
  footnote: string;
}

/**
 * Step 4: cancellation confirmed.
 *
 * `finalCharge` is COMPUTED, not the mockup's flat "None". For an active
 * subscription nothing further is taken and "None" is correct — but a customer
 * cancelling while `past_due` has an invoice Stripe is still retrying, and
 * telling them they owe nothing would be wrong in the one direction that
 * generates a dispute.
 */
export function describeCancellationConfirmed(args: {
  email: string | null;
  status: string | null;
  accessEndsAt: string | null;
  windowDays?: number;
  purgesData?: boolean;
}): CancellationConfirmation {
  const windowDays = args.windowDays ?? REACTIVATION_WINDOW_DAYS;
  const purges = args.purgesData ?? DATA_IS_PURGED_AFTER_WINDOW;

  const owesMoney = args.status === "past_due" || args.status === "unpaid";
  const endDate = formatAccessDate(args.accessEndsAt);
  const reactivateBy = formatAccessDate(reactivateByIso(args.accessEndsAt, windowDays));

  const rows: ConfirmationRow[] = [
    { label: "Access until", value: endDate ?? "End of your current period" },
  ];

  // Only promised when it is actually enforced, for the same reason the
  // footnote above is conditional.
  if (purges && reactivateBy) {
    rows.push({ label: "Reactivate by", value: reactivateBy });
  }

  rows.push({
    label: "Final charge",
    value: owesMoney
      ? "Outstanding balance still due"
      : "None — you won't be charged again",
  });

  return {
    title: "Your subscription is cancelled",
    body: args.email
      ? `We've sent a confirmation to ${args.email}.${
          owesMoney
            ? " Your last unpaid invoice is still outstanding."
            : " You won't be charged again."
        }`
      : owesMoney
        ? "Your last unpaid invoice is still outstanding."
        : "You won't be charged again.",
    rows,
    footnote: purges
      ? `Changed your mind? Reactivate within ${windowDays} days and everything comes back where you left it.`
      : "Changed your mind? Reactivate any time from your settings and everything comes back where you left it.",
  };
}
