/**
 * Plan-change decisions, extracted as pure functions so they can be tested.
 *
 * WHY THIS FILE EXISTS. Three real bugs shipped in the change-plan and checkout
 * routes — a duplicate subscription, a downgrade that failed once a schedule
 * existed, and an upgrade that silently reverted at period end — and none were
 * caught before a human hit them. The reason is that the logic lived inline in
 * route handlers, tangled with Stripe and Supabase calls, so nothing about it
 * could be asserted without real network access.
 *
 * The decisions are now separated from the I/O. The routes still perform the
 * calls, but WHAT to do is decided here, where it is cheap to test exhaustively.
 */

export type SubscriptionStatusLike =
  | "active" | "trialing" | "past_due" | "unpaid"
  | "canceled" | "incomplete" | "incomplete_expired" | "paused"
  | string | null;

/** Statuses that mean "this customer is already subscribed — do not sell again". */
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);

export function isLiveSubscription(status: SubscriptionStatusLike): boolean {
  return typeof status === "string" && LIVE_STATUSES.has(status);
}

/**
 * Should a new Checkout session be allowed?
 *
 * Takes BOTH what our database believes and what Stripe reports, because they
 * disagree whenever a webhook is missed — and that disagreement is exactly how a
 * customer ended up paying twice. Stripe wins: it is the authority on what
 * exists.
 */
export function canStartCheckout(args: {
  dbStatus: SubscriptionStatusLike;
  dbHasSubscriptionId: boolean;
  dbModeMatches: boolean;
  /** Statuses of subscriptions Stripe reports for this customer. */
  stripeStatuses: readonly SubscriptionStatusLike[];
}): { allowed: boolean; reason: "ok" | "already_subscribed_db" | "already_subscribed_stripe" } {
  if (args.dbHasSubscriptionId && args.dbModeMatches && isLiveSubscription(args.dbStatus)) {
    return { allowed: false, reason: "already_subscribed_db" };
  }
  // The guard that was missing: our row can say "none" while Stripe has one.
  if (args.stripeStatuses.some(isLiveSubscription)) {
    return { allowed: false, reason: "already_subscribed_stripe" };
  }
  return { allowed: true, reason: "ok" };
}

/**
 * What must happen to an existing schedule before a plan change is applied.
 *
 * A subscription can be attached to AT MOST ONE schedule, which drove two of the
 * three bugs:
 *   - creating a second schedule fails outright ("already attached to a
 *     schedule"), so a customer could not revise a pending downgrade;
 *   - leaving a schedule attached during an upgrade means Stripe reverts to the
 *     scheduled phase at period end, silently undoing what they just paid for.
 */
export type ScheduleAction = "release" | "reuse" | "create" | "none";

export function scheduleActionFor(args: {
  timing: "immediate" | "period_end" | "none";
  hasSchedule: boolean;
  /** Status of the attached schedule, when there is one. */
  scheduleStatus?: string | null;
}): ScheduleAction {
  if (args.timing === "none") return "none";

  if (args.timing === "immediate") {
    // Detach so the upgrade is not reverted later. `release` keeps the
    // subscription alive; `cancel` would end it.
    return args.hasSchedule ? "release" : "none";
  }

  // period_end (a downgrade)
  if (!args.hasSchedule) return "create";
  // A released or cancelled schedule can no longer be edited.
  if (args.scheduleStatus === "released" || args.scheduleStatus === "canceled") {
    return "create";
  }
  return "reuse";
}

export interface Phase {
  start_date: number;
  end_date?: number | null;
}

/**
 * Pick the phase that contains `now`.
 *
 * NOT simply phases[0]: on a reused schedule the first phase may have already
 * elapsed, and rewriting from an elapsed phase produces a schedule that Stripe
 * rejects or that applies at the wrong moment.
 */
export function findCurrentPhase<T extends Phase>(
  phases: readonly T[],
  nowSeconds: number
): T | null {
  if (phases.length === 0) return null;
  const match = phases.find(
    (p) => p.start_date <= nowSeconds && (!p.end_date || p.end_date > nowSeconds)
  );
  return match ?? phases[phases.length - 1];
}

/**
 * What a plan change will do, phrased for the customer BEFORE they commit.
 *
 * WHY THIS IS NEEDED. An upgrade is applied immediately with
 * `proration_behavior: 'always_invoice'`, so pressing the button charges a card
 * right away — with no Stripe Checkout page in between, because there is no new
 * subscription to create. A real charge with no confirmation step is the kind of
 * thing customers reasonably call a billing error, even when the amount is
 * correct.
 *
 * Kept pure and separate from the dialog so the WORDING for each case can be
 * asserted in tests: this text is the only thing standing between a customer and
 * an unexpected charge, and "downgrade" phrasing shown for an upgrade would be
 * actively harmful.
 */
export interface PlanChangePreview {
  /** Dialog heading. */
  title: string;
  /** What will happen, in plain terms. */
  body: string;
  /** Label for the confirm button. */
  confirmLabel: string;
  /** True when money moves as soon as they confirm. */
  chargesNow: boolean;
  /** 'warn' for an immediate charge, 'info' for a deferred change. */
  tone: "warn" | "info";
}

function money(amountMinor: number | null | undefined): string {
  if (typeof amountMinor !== "number" || !Number.isFinite(amountMinor)) return "";
  return `$${(amountMinor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function describePlanChange(args: {
  kind: "upgrade" | "downgrade" | "cycle_change" | "same";
  currentPlanName: string;
  targetPlanName: string;
  /** Target price in minor units, for the cycle being bought. */
  targetAmountMinor?: number | null;
  targetCycle: "monthly" | "annual";
  /** ISO date the current period ends, for deferred changes. */
  periodEnd?: string | null;
}): PlanChangePreview {
  const per = args.targetCycle === "annual" ? "year" : "month";
  const price = money(args.targetAmountMinor);
  const endDate = args.periodEnd
    ? new Date(args.periodEnd).toLocaleDateString("en-US", { dateStyle: "medium" })
    : null;

  if (args.kind === "upgrade") {
    return {
      title: `Upgrade to ${args.targetPlanName}?`,
      // States plainly that a card is charged now, and that the amount is
      // prorated rather than the full price — otherwise the figure on the
      // invoice looks wrong.
      body:
        `Your plan changes immediately and your card is charged today. ` +
        `You'll pay the difference for the rest of your current period, then ` +
        `${price ? `${price} per ${per}` : `the ${args.targetPlanName} rate`} from your next renewal. ` +
        `Your new limits apply straight away.`,
      confirmLabel: `Upgrade and pay now`,
      chargesNow: true,
      tone: "warn",
    };
  }

  if (args.kind === "downgrade") {
    return {
      title: `Switch to ${args.targetPlanName}?`,
      body:
        `You keep ${args.currentPlanName} and its limits until ` +
        `${endDate ?? "the end of your current period"}, which you have already paid for. ` +
        `${args.targetPlanName} starts after that` +
        `${price ? ` at ${price} per ${per}` : ""}. No charge today, and you can change back ` +
        `before then.`,
      confirmLabel: `Schedule downgrade`,
      chargesNow: false,
      tone: "info",
    };
  }

  if (args.kind === "cycle_change") {
    return {
      title:
        args.targetCycle === "annual"
          ? `Switch to annual billing?`
          : `Switch to monthly billing?`,
      body:
        `Your billing changes immediately and your card is charged today. ` +
        `Any unused time on your current cycle is credited against ` +
        `${price ? `the ${price} total` : "the new amount"}.`,
      confirmLabel: `Switch and pay now`,
      chargesNow: true,
      tone: "warn",
    };
  }

  return {
    title: `No change`,
    body: `You are already on ${args.currentPlanName} billed ${args.targetCycle}.`,
    confirmLabel: `Close`,
    chargesNow: false,
    tone: "info",
  };
}
