/**
 * Plan limit evaluation.
 *
 * Pure functions. `plan_limits.limit_value` uses the convention already seeded in
 * migration 004:
 *   -1 = unlimited
 *    0 = disabled (feature not available on this plan)
 *   >0 = capped at that number per billing period
 *
 * MID-CYCLE PLAN CHANGES (the behaviour behind "if a user upgrades mid-month"):
 * the CAP comes from the plan in force right now, while USAGE keeps accumulating
 * in the same billing period. Upgrading raises the ceiling immediately; it does
 * not forgive what has already been consumed. Someone who has used 5 of 5 on
 * Starter and upgrades to Pro's 20 gets 15 more, not a fresh 20.
 *
 * That is deliberate, and the alternative is exploitable: if an upgrade reset the
 * counter, a customer could upgrade and downgrade repeatedly to mint unlimited
 * usage of a feature that costs real money per call.
 */

/** Limit keys seeded in migration 004. */
export const LIMIT_KEYS = {
  MAX_USERS: "max_users",
  MAX_INITIATIVES: "max_initiatives",
  PLAN_REGENERATIONS: "plan_regenerations",
  AI_USES_MONTH: "ai_uses_month",
  MAX_PRODUCTS: "max_products",
  CSV_EXPORTS_MONTH: "csv_exports_month",
} as const;

export const UNLIMITED = -1;

export interface LimitCheck {
  allowed: boolean;
  limit: number;
  used: number;
  /** null when unlimited. */
  remaining: number | null;
  unlimited: boolean;
  /** True when the plan does not include this feature at all (limit 0). */
  notIncluded: boolean;
}

/**
 * Check one limit.
 *
 * A MISSING limit row is treated as unlimited, not as zero. Denying on absent
 * configuration would break the product every time a new limit key is added
 * before every plan has been given a value — failing open here is the lesser
 * harm, and the caller logs it.
 */
export function checkLimit(
  limitValue: number | null | undefined,
  used: number,
  requested = 1
): LimitCheck {
  const usedSafe = Number.isFinite(used) && used > 0 ? Math.floor(used) : 0;

  if (limitValue === null || limitValue === undefined || limitValue === UNLIMITED) {
    return {
      allowed: true,
      limit: UNLIMITED,
      used: usedSafe,
      remaining: null,
      unlimited: true,
      notIncluded: false,
    };
  }

  const limit = Math.floor(limitValue);

  if (limit <= 0) {
    return {
      allowed: false,
      limit: 0,
      used: usedSafe,
      remaining: 0,
      unlimited: false,
      notIncluded: true,
    };
  }

  const remaining = Math.max(0, limit - usedSafe);
  return {
    allowed: remaining >= requested,
    limit,
    used: usedSafe,
    remaining,
    unlimited: false,
    notIncluded: false,
  };
}

/**
 * The billing period a usage counter should be keyed to.
 *
 * Prefers the subscription's real Stripe period, so a customer billed on the
 * 12th gets their allowance renewed on the 12th rather than on the 1st.
 *
 * Falls back to a calendar month for comped accounts and anyone without a Stripe
 * subscription — they still need counters, or limits could not be enforced on
 * them at all.
 */
export function resolveUsagePeriod(
  currentPeriodStart: string | null,
  currentPeriodEnd: string | null,
  now: number = Date.now()
): { periodStart: string; periodEnd: string } {
  const start = currentPeriodStart ? new Date(currentPeriodStart).getTime() : NaN;
  const end = currentPeriodEnd ? new Date(currentPeriodEnd).getTime() : NaN;

  // Use Stripe's window only if it is valid AND actually contains `now`. A stale
  // period (e.g. a lapsed subscription) would otherwise key usage to a window
  // that never resets.
  if (Number.isFinite(start) && Number.isFinite(end) && start <= now && now < end) {
    return {
      periodStart: new Date(start).toISOString(),
      periodEnd: new Date(end).toISOString(),
    };
  }

  const d = new Date(now);
  return {
    periodStart: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString(),
    periodEnd: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString(),
  };
}

/**
 * Whether moving between two plans is an upgrade, a downgrade, or neither.
 *
 * Compared on PRICE rather than on limits: a plan can raise one limit while
 * lowering another, so limits give no total ordering, whereas what the customer
 * pays is unambiguous and is also what Stripe prorates against.
 */
export type PlanChangeKind = "upgrade" | "downgrade" | "same" | "cycle_change";

export function classifyPlanChange(
  current: { planId: string; cycle: string; price: number },
  target: { planId: string; cycle: string; price: number }
): PlanChangeKind {
  if (current.planId === target.planId && current.cycle === target.cycle) return "same";

  // Same plan, different cycle (monthly <-> annual). Treated separately because
  // the amounts are not comparable: an annual price always looks like a huge
  // "upgrade" against a monthly one.
  if (current.planId === target.planId) return "cycle_change";

  if (target.price > current.price) return "upgrade";
  if (target.price < current.price) return "downgrade";
  return "same";
}

/**
 * When a plan change should take effect.
 *
 * Upgrades apply immediately: the customer pays the prorated difference and gets
 * the higher limits now — making them wait for something they have just paid for
 * would be indefensible.
 *
 * Downgrades apply at period end: they have already paid for the current period,
 * so removing access early would be taking away purchased value, and refunding
 * the difference invites abuse.
 *
 * A cycle change applies immediately, which is how Stripe proration handles it
 * naturally (monthly -> annual credits the unused monthly remainder).
 */
export function changeTiming(kind: PlanChangeKind): "immediate" | "period_end" | "none" {
  switch (kind) {
    case "upgrade":
    case "cycle_change":
      return "immediate";
    case "downgrade":
      return "period_end";
    case "same":
      return "none";
  }
}
