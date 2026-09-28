/**
 * Top performers ranking.
 *
 * Initiatives are scoped by `annual_plan_id`, so last year's initiatives are
 * different *rows* from this year's and there is no cross-year identity key
 * other than the name. That shapes the two things this module does:
 *
 *  1. `rankTopPerformers` ranks initiatives by the actual revenue they earned
 *     in a given calendar year, summed from `results` rows grouped by
 *     `initiative_id`. No cross-year matching is involved - each initiative is
 *     scored against its own results.
 *
 *  2. `findPerformerByName` maps a *current* initiative onto that ranking by
 *     name, compared as `name.trim().toLowerCase()`. This is what powers the
 *     "#N last year" badge and the "· $XXXK last year" subtitle on a card.
 *     Consequence worth knowing: an initiative that was renamed between plan
 *     years will NOT match, and simply shows no badge. Two initiatives sharing
 *     a name in the same year collapse onto whichever ranked higher.
 *
 * Kept free of React and of any service calls so it can be unit tested with
 * plain data.
 */

/** Minimal shape needed from an initiative - anything wider is accepted. */
export interface RankableInitiative {
  id: string;
  name: string;
}

/** Minimal shape needed from a weekly result row. */
export interface RankableResult {
  initiativeId?: string | null;
  weekStartDate: Date | string;
  actualRevenue?: number | null;
}

export interface RankedPerformer {
  initiativeId: string;
  name: string;
  /** Actual revenue earned in the ranked year. Always > 0. */
  revenue: number;
  /** 1-based position. Sequential, so ties still read as #1, #2, #3. */
  rank: number;
  /** Bar width relative to the #1 performer, 0-100. The #1 row is always 100. */
  barPercent: number;
}

export interface RankTopPerformersOptions {
  /** Calendar year the results must fall in. */
  year: number;
  /** How many performers to return. Defaults to 3. */
  limit?: number;
}

/** The comparison key used for all cross-year name matching. */
export function normalizeInitiativeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Calendar year of a date-only value. Date-only columns arrive as `YYYY-MM-DD`
 * and are parsed by the services with `new Date(...)`, i.e. UTC midnight, so the
 * year is read back with UTC getters (or straight off the string) to avoid a
 * Jan 1 / Dec 31 slip in non-UTC timezones.
 */
function calendarYearOf(value: Date | string): number | null {
  if (typeof value === 'string') {
    const match = /^(\d{4})-\d{2}-\d{2}/.exec(value);
    if (match) return Number(match[1]);
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear();
  }
  return isNaN(value.getTime()) ? null : value.getUTCFullYear();
}

/**
 * Rank initiatives by the revenue they actually earned in `options.year`.
 *
 * Initiatives with no results, or whose results net to zero or less, are
 * excluded - a "top performer" with $0 is not a performer. Ties are broken by
 * name (case-insensitive, ascending) purely so the output is deterministic.
 */
export function rankTopPerformers(
  initiatives: readonly RankableInitiative[],
  results: readonly RankableResult[],
  options: RankTopPerformersOptions,
): RankedPerformer[] {
  const { year, limit = 3 } = options;
  if (limit <= 0) return [];

  const byId = new Map<string, RankableInitiative>();
  for (const initiative of initiatives) {
    if (initiative?.id) byId.set(initiative.id, initiative);
  }
  if (byId.size === 0) return [];

  // Same reduce-into-a-Map shape used for per-initiative actuals elsewhere.
  const revenueById = new Map<string, number>();
  for (const result of results) {
    const key = result.initiativeId || '';
    if (!key || !byId.has(key)) continue;
    if (calendarYearOf(result.weekStartDate) !== year) continue;
    revenueById.set(key, (revenueById.get(key) || 0) + (result.actualRevenue || 0));
  }

  const scored = [...revenueById.entries()]
    .filter(([, revenue]) => revenue > 0)
    .map(([initiativeId, revenue]) => ({
      initiativeId,
      name: byId.get(initiativeId)!.name,
      revenue,
    }))
    .sort((a, b) => {
      if (b.revenue !== a.revenue) return b.revenue - a.revenue;
      return normalizeInitiativeName(a.name).localeCompare(normalizeInitiativeName(b.name));
    })
    .slice(0, limit);

  const top = scored[0]?.revenue || 0;

  return scored.map((entry, index) => ({
    ...entry,
    rank: index + 1,
    barPercent: top > 0 ? clampPercent((entry.revenue / top) * 100) : 0,
  }));
}

/**
 * Look a current initiative up in a ranking by name. See the module comment:
 * matching is on the trimmed, lowercased name, so a renamed initiative will not
 * match and gets no "last year" treatment.
 */
export function findPerformerByName(
  ranked: readonly RankedPerformer[],
  name: string,
): RankedPerformer | undefined {
  const key = normalizeInitiativeName(name);
  if (!key) return undefined;
  return ranked.find(performer => normalizeInitiativeName(performer.name) === key);
}

/** Bar widths are always renderable: no NaN, no negatives, never past 100%. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/**
 * Progress as a percentage of a target, safe for the zero-target case that is
 * the norm before a plan has any actuals logged.
 */
export function progressPercent(value: number, target: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return 0;
  return clampPercent((value / target) * 100);
}
