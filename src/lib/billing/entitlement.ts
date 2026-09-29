/**
 * Entitlement: may this company use the product, and how much?
 *
 * Pure functions — no database, no Stripe. Callers fetch state and pass it in.
 * Isolated because this is the single decision that gates paid features, and
 * getting it wrong either gives away the product or locks out paying customers.
 *
 * PRECEDENCE, highest first. Order matters more than any individual rule:
 *   1. Billing disabled globally  -> everyone has full access (today's behaviour)
 *   2. Comped                     -> full plan access, no Stripe involvement
 *   3. Active / trialing          -> full plan access
 *   4. past_due within grace      -> access continues, warning shown
 *   5. Everything else            -> restricted
 */

/** Stripe subscription statuses, plus the local-only ones we set ourselves. */
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused"
  | "trial"
  | null;

export interface BillingSettings {
  stripeEnabled: boolean;
  trialEnabled: boolean;
  trialDays: number;
  dunningGraceDays: number;
}

export interface SubscriptionState {
  status: SubscriptionStatus;
  isComped: boolean;
  compedUntil: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  pastDueSince: string | null;
  cancelAtPeriodEnd: boolean;
}

export type AccessReason =
  | "billing_disabled"
  | "comped"
  | "active"
  | "trialing"
  | "grace_period"
  | "comp_expired"
  | "trial_expired"
  | "past_due_expired"
  | "canceled"
  | "no_subscription"
  | "incomplete";

export interface AccessDecision {
  /** May the company use paid features at all? */
  allowed: boolean;
  reason: AccessReason;
  /** True when access continues but the user should be nudged (grace, trial ending). */
  warn: boolean;
  /** Days left in the current trial or grace window, when one applies. */
  daysRemaining: number | null;
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function daysBetween(fromMs: number, toMs: number): number {
  return Math.ceil((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

/**
 * Decide whether a company may use paid features.
 *
 * `now` is injectable so tests are deterministic and so a caller can evaluate
 * "would this be allowed tomorrow" without clock tricks.
 */
export function evaluateAccess(
  settings: BillingSettings,
  sub: SubscriptionState | null,
  now: number = Date.now()
): AccessDecision {
  // 1. Billing switched off: the app runs exactly as it did before Stripe. This
  //    check is FIRST and unconditional — flipping the master switch off must
  //    restore open access immediately, whatever state a subscription is in.
  if (!settings.stripeEnabled) {
    return { allowed: true, reason: "billing_disabled", warn: false, daysRemaining: null };
  }

  if (!sub) {
    return { allowed: false, reason: "no_subscription", warn: false, daysRemaining: null };
  }

  // 2. Comped: full access with no payment. Checked before status because a
  //    comped account may have no Stripe subscription at all, so its status is
  //    meaningless.
  if (sub.isComped) {
    const until = parseTime(sub.compedUntil);
    if (until === null) {
      // Indefinite comp.
      return { allowed: true, reason: "comped", warn: false, daysRemaining: null };
    }
    if (until > now) {
      const left = daysBetween(now, until);
      return {
        allowed: true,
        reason: "comped",
        // Nudge in the final week so an expiring comp is not a surprise.
        warn: left <= 7,
        daysRemaining: left,
      };
    }
    // Comp has lapsed: fall through to normal subscription evaluation rather
    // than denying outright — they may have since subscribed properly.
    if (sub.status !== "active" && sub.status !== "trialing") {
      return { allowed: false, reason: "comp_expired", warn: false, daysRemaining: 0 };
    }
  }

  // 3. Trial. Both Stripe's 'trialing' and the pre-existing local 'trial' value
  //    are honoured, because accounts created before Stripe carry the latter.
  if (sub.status === "trialing" || sub.status === "trial") {
    const ends = parseTime(sub.trialEndsAt);
    // No end date recorded: treat as an open trial rather than locking someone
    // out over missing data. Operator error must not look like non-payment.
    if (ends === null) {
      return { allowed: true, reason: "trialing", warn: false, daysRemaining: null };
    }
    if (ends > now) {
      const left = daysBetween(now, ends);
      return { allowed: true, reason: "trialing", warn: left <= 3, daysRemaining: left };
    }
    return { allowed: false, reason: "trial_expired", warn: false, daysRemaining: 0 };
  }

  if (sub.status === "active") {
    const periodEnd = parseTime(sub.currentPeriodEnd);
    const left = periodEnd ? daysBetween(now, periodEnd) : null;
    return {
      allowed: true,
      reason: "active",
      // Cancelling-at-period-end still has access, but should be told it is ending.
      warn: sub.cancelAtPeriodEnd,
      daysRemaining: left,
    };
  }

  // 4. past_due: a failed payment, most often an expired card, which Stripe
  //    retries automatically. Keep access for the grace window rather than
  //    locking a paying customer out over a transient failure.
  if (sub.status === "past_due" || sub.status === "unpaid") {
    const since = parseTime(sub.pastDueSince);
    if (since === null) {
      // Missing timestamp: grant the benefit of the doubt for one cycle, warn.
      return {
        allowed: true,
        reason: "grace_period",
        warn: true,
        daysRemaining: settings.dunningGraceDays,
      };
    }
    const graceEnds = since + settings.dunningGraceDays * 24 * 60 * 60 * 1000;
    if (graceEnds > now) {
      return {
        allowed: true,
        reason: "grace_period",
        warn: true,
        daysRemaining: daysBetween(now, graceEnds),
      };
    }
    return { allowed: false, reason: "past_due_expired", warn: false, daysRemaining: 0 };
  }

  // 5. Anything else is denied, but named so the UI can explain it.
  if (sub.status === "canceled" || sub.status === "paused") {
    return { allowed: false, reason: "canceled", warn: false, daysRemaining: null };
  }

  // incomplete / incomplete_expired: checkout was started but never finished.
  return { allowed: false, reason: "incomplete", warn: false, daysRemaining: null };
}
