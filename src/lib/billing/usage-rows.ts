import { checkLimit, LIMIT_KEYS } from "./limits";

/**
 * The rows of the Settings usage panel, built from the same rules the server
 * enforces with.
 *
 * Two kinds of limit, shown differently:
 *   - PERIOD limits (AI uses, regenerations, exports) come from
 *     `usage_counters` for the current billing period and reset.
 *   - LIVE limits (initiatives, products, team) are what the account holds
 *     right now. They never reset; deleting frees a slot. Initiatives are
 *     counted per plan year, the same scope `checkLiveLimit` uses.
 *
 * Pure so it can be tested without a database.
 */

export type UsageScope = "period" | "total" | "plan_year";

export interface UsageRow {
  key: string;
  label: string;
  limit: number;
  used: number;
  remaining: number | null;
  unlimited: boolean;
  notIncluded: boolean;
  /** Holding more than the plan allows (downgraded, or created before enforcement). */
  overLimit: boolean;
  scope: UsageScope;
  /** Only for initiatives: the plan year counted. */
  planYear: number | null;
}

/**
 * "Current" plan year for the initiatives row.
 *
 * The SAME rule the year picker uses by default (usePlanYears): the plan
 * covering this calendar year if there is one, else the next one ahead, else
 * the latest. So the panel counts the plan a customer lands on.
 * Null when the company has no plan years at all.
 */
export function pickCurrentPlanYear(years: readonly number[], currentYear: number): number | null {
  if (years.length === 0) return null;
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  if (sorted.includes(currentYear)) return currentYear;
  const ahead = sorted.filter((y) => y >= currentYear);
  if (ahead.length > 0) return ahead[0];
  return sorted[sorted.length - 1];
}

export function buildUsageRows(args: {
  planLimits: readonly { key: string; label: string; value: number | null }[];
  /** usage_counters.used for this billing period, by limit key. */
  periodUsed: ReadonlyMap<string, number>;
  live: {
    /** Initiatives in `year`'s plan. `year` null = no plan yet (count 0). */
    initiatives: { year: number | null; count: number };
    products: number;
    users: number;
  };
}): UsageRow[] {
  return args.planLimits.map((l) => {
    let used: number;
    let scope: UsageScope = "period";
    let planYear: number | null = null;
    let label = l.label;

    if (l.key === LIMIT_KEYS.MAX_INITIATIVES) {
      used = args.live.initiatives.count;
      scope = "plan_year";
      planYear = args.live.initiatives.year;
      if (planYear !== null) label = `Initiatives in your ${planYear} plan`;
    } else if (l.key === LIMIT_KEYS.MAX_PRODUCTS) {
      used = args.live.products;
      scope = "total";
    } else if (l.key === LIMIT_KEYS.MAX_USERS) {
      used = args.live.users;
      scope = "total";
    } else {
      used = args.periodUsed.get(l.key) ?? 0;
    }

    const check = checkLimit(l.value, used);
    return {
      key: l.key,
      label,
      limit: check.limit,
      used: check.used,
      remaining: check.remaining,
      unlimited: check.unlimited,
      notIncluded: check.notIncluded,
      overLimit: !check.unlimited && !check.notIncluded && check.used > check.limit,
      scope,
      planYear,
    };
  });
}
