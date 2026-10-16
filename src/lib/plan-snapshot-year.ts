/**
 * Which plan year does a snapshot belong to?
 *
 * Restore has to attach the snapshot's initiatives to an `annual_plans` row,
 * and until now it took whichever row happened to be the company's most
 * recent. That is wrong in two different ways:
 *
 *   - DELETE THE YEAR AND RESTORE BECOMES IMPOSSIBLE. With no `annual_plans`
 *     row at all the route refused with "No active annual plan to restore
 *     into", which is precisely the situation someone restoring from history is
 *     usually in — they deleted the plan and want it back.
 *
 *   - THE WRONG YEAR. With a 2027 plan present, restoring a 2026 snapshot
 *     filed every 2026 initiative under 2027, silently moving a year's work.
 *
 * The snapshot already carries everything needed to answer the question, so it
 * is answered from the snapshot rather than from whatever the database happens
 * to contain now.
 *
 * No database, no React.
 */

/** The parts of a snapshot payload this needs. Everything is optional. */
export interface SnapshotYearSource {
  annualPlan?: { year?: unknown } | null;
  initiatives?: { activation_date?: unknown; event_date?: unknown }[] | null;
}

function toYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value > 2000 && value < 3000 ? value : null;
  }
  if (typeof value === "string") {
    // Both a bare year and a date string start with four digits.
    const match = value.match(/^(\d{4})/);
    if (!match) return null;
    const year = Number(match[1]);
    return year > 2000 && year < 3000 ? year : null;
  }
  return null;
}

/**
 * The year this snapshot describes.
 *
 * Resolution order:
 *   1. The snapshot's own `annualPlan.year` — recorded at capture time and
 *      therefore the authoritative answer.
 *   2. The most common year across its initiatives' dates. A snapshot taken
 *      before `annualPlan` was included still has dated initiatives, and the
 *      MODE rather than the first value because a plan can spill into the
 *      following year — one initiative dated January must not drag the whole
 *      restore into the wrong year.
 *   3. `fallbackYear`, for a snapshot carrying neither.
 *
 * `event_date` is preferred over `activation_date` per initiative, matching
 * how the plan builder files work: an initiative prepared in December and run
 * in January belongs to January's plan.
 */
export function snapshotPlanYear(
  snapshot: SnapshotYearSource | null | undefined,
  fallbackYear: number
): number {
  const stated = toYear(snapshot?.annualPlan?.year);
  if (stated !== null) return stated;

  const counts = new Map<number, number>();
  for (const initiative of snapshot?.initiatives ?? []) {
    const year = toYear(initiative?.event_date) ?? toYear(initiative?.activation_date);
    if (year !== null) counts.set(year, (counts.get(year) ?? 0) + 1);
  }

  let best: number | null = null;
  let bestCount = 0;
  for (const [year, count] of counts) {
    // Ties break to the EARLIER year: a plan that straddles a boundary is
    // named for the year it started in.
    if (count > bestCount || (count === bestCount && best !== null && year < best)) {
      best = year;
      bestCount = count;
    }
  }

  return best ?? fallbackYear;
}

/**
 * The targets to give a plan row recreated from a snapshot.
 *
 * Separate from the year so the route can use it both when creating a missing
 * plan and when updating an existing one, rather than building the same object
 * twice and letting the two drift.
 */
export function snapshotPlanTargets(snapshot: SnapshotYearSource | null | undefined): {
  baseline_revenue: number;
  stretch_revenue: number;
  operating_budget: number;
} {
  const plan = (snapshot?.annualPlan ?? {}) as Record<string, unknown>;

  const num = (value: unknown): number => {
    const parsed = Number(value);
    // Negative targets are meaningless and would render as a negative goal.
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };

  return {
    baseline_revenue: num(plan.baseline_revenue),
    stretch_revenue: num(plan.stretch_revenue),
    operating_budget: num(plan.operating_budget),
  };
}
