/**
 * Dashboard presentation logic for initiatives.
 *
 * Pure functions, no React and no database, because this decides what MONEY is
 * shown on a card. Net, ROI and pace must not appear on an initiative that has
 * not run — a Draft showing "Net $0" reads as a loss rather than as nothing
 * having happened yet, which is the specific failure the card redesign exists
 * to fix.
 *
 * THE FOUR STATES ARE DERIVED, NOT STORED. The `initiatives.status` column holds
 * the existing six values (planned, in_progress, launched, completed, paused,
 * retired) and there is no migration here. Draft and Scheduled are both
 * `planned`; what separates them is whether an exact `event_date` has been set.
 * That distinction already exists in the product — the add-initiative panel has
 * an `eventDateMode` of 'exact' or 'month' — so "has it been given real dates"
 * is a question the data can already answer. `activation_date` is NOT NULL so it
 * cannot serve; `event_date` is nullable and is exactly the right signal.
 */

/** The four states the dashboard presents. */
export type DashboardStatus = "draft" | "scheduled" | "live" | "complete";

/** Shape needed to classify an initiative. Matches the Initiative type's fields. */
export interface ClassifiableInitiative {
  status: string;
  eventDate?: Date | string | null;
}

/**
 * Which of the four dashboard states is this initiative in?
 *
 * `paused` and `retired` map to complete: both mean "not active work", and the
 * alternative is a fifth card layout for states that are rare and terminal.
 */
export function dashboardStatus(initiative: ClassifiableInitiative): DashboardStatus {
  const status = initiative.status;

  if (status === "completed" || status === "retired" || status === "paused") {
    return "complete";
  }
  if (status === "in_progress" || status === "launched") {
    return "live";
  }
  // planned, or anything unrecognised: scheduled once it has a real date.
  return initiative.eventDate ? "scheduled" : "draft";
}

/**
 * What a card or row may display for a given state.
 *
 * Returned as data rather than branched in JSX so the card and the list view
 * cannot disagree about what Live means, and so the rules are directly testable.
 */
export interface StatusDisplay {
  /** Projected revenue, range, spend budget, projected ROI, % of baseline. */
  showProjections: boolean;
  /** Earned vs projected, progress bar, pace label. */
  showActuals: boolean;
  /** Net and ROI computed from real money. Never on draft or scheduled. */
  showNetAndRoi: boolean;
  /** Exact dates plus a countdown. */
  showExactDates: boolean;
  /** Footer call to action. */
  footerLabel: string;
  /** Pill text, excluding any day count the caller appends. */
  pillLabel: string;
}

export function statusDisplay(status: DashboardStatus): StatusDisplay {
  switch (status) {
    case "draft":
      return {
        showProjections: true,
        showActuals: false,
        // Nothing has been spent or earned, so a Net of $0 would be a statement
        // about performance that has not happened.
        showNetAndRoi: false,
        showExactDates: false,
        footerLabel: "Schedule this initiative",
        pillLabel: "Draft",
      };
    case "scheduled":
      return {
        showProjections: true,
        showActuals: false,
        showNetAndRoi: false,
        showExactDates: true,
        footerLabel: "Open initiative",
        pillLabel: "Scheduled",
      };
    case "live":
      return {
        showProjections: false,
        showActuals: true,
        // First point at which real money exists on both sides.
        showNetAndRoi: true,
        showExactDates: true,
        footerLabel: "Log revenue",
        pillLabel: "Live",
      };
    case "complete":
      return {
        showProjections: false,
        showActuals: true,
        showNetAndRoi: true,
        showExactDates: true,
        footerLabel: "Run it again",
        pillLabel: "Complete",
      };
  }
}

/**
 * Pace against where this initiative should be by now.
 *
 * Measured against ELAPSED time in the run window, not against the final
 * target: on day 2 of 21 a "behind" label would be meaningless. Within 10% of
 * the expected figure counts as on pace, so ordinary noise does not read as
 * failure.
 */
export type Pace = "ahead" | "on" | "behind" | "unknown";

export function pacePosition(args: {
  earned: number;
  projected: number;
  /** 0 to 1, how far through the run window. */
  elapsedFraction: number;
}): Pace {
  if (!Number.isFinite(args.projected) || args.projected <= 0) return "unknown";
  if (!Number.isFinite(args.elapsedFraction) || args.elapsedFraction <= 0) return "unknown";

  const expected = args.projected * Math.min(1, args.elapsedFraction);
  if (expected <= 0) return "unknown";

  const ratio = args.earned / expected;
  if (ratio >= 1.1) return "ahead";
  if (ratio >= 0.9) return "on";
  return "behind";
}

export function paceLabel(pace: Pace): string {
  switch (pace) {
    case "ahead": return "Ahead of pace";
    case "on": return "On pace";
    case "behind": return "Behind pace";
    case "unknown": return "";
  }
}

/**
 * Return on investment as a multiple.
 *
 * Null rather than 0 or Infinity when there is no spend: "0x ROI" claims a
 * measured result, and Infinity cannot be rendered. The caller shows a dash.
 */
export function roi(revenue: number, spend: number): number | null {
  if (!Number.isFinite(revenue) || !Number.isFinite(spend)) return null;
  if (spend <= 0) return null;
  return revenue / spend;
}

export function formatRoi(value: number | null): string {
  if (value === null) return "—";
  // One decimal below 10x, whole numbers above, where precision stops mattering.
  return value < 10 ? `${value.toFixed(1)}x` : `${Math.round(value)}x`;
}

/** What share of the baseline goal this initiative's projection covers, 0-100. */
export function percentOfBaseline(projected: number, baselineGoal: number): number {
  if (!Number.isFinite(projected) || !Number.isFinite(baselineGoal)) return 0;
  if (baselineGoal <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((projected / baselineGoal) * 100)));
}

/** Progress as a capped percentage, for the bars. */
export function progressPercent(value: number, target: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

/**
 * Days until a date, from `now`. Negative once past.
 *
 * Both sides are normalised to UTC midnight because these are DATE-only values
 * from Postgres; comparing them against a local timestamp makes the answer
 * wrong by a day for anyone west of UTC.
 */
export function daysUntil(date: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!date) return null;
  const target = typeof date === "string" ? new Date(date) : date;
  if (!(target instanceof Date) || isNaN(target.getTime())) return null;

  const t = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const n = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((t - n) / 86_400_000);
}

/** "starts in 12 days" / "starts tomorrow" / "starts today". */
export function countdownLabel(date: Date | string | null | undefined, now: Date = new Date()): string {
  const days = daysUntil(date, now);
  if (days === null) return "";
  if (days < 0) return "";
  if (days === 0) return "starts today";
  if (days === 1) return "starts tomorrow";
  return `starts in ${days} days`;
}

/**
 * "day 9 of 21" for a running initiative.
 *
 * Returns null without both endpoints, or before the window opens — a day count
 * on something that has not started is nonsense.
 */
export function runDayLabel(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  now: Date = new Date()
): string | null {
  const startDays = daysUntil(start, now);
  const endDays = daysUntil(end, now);
  if (startDays === null || endDays === null) return null;

  const total = endDays - startDays;
  if (total <= 0) return null;

  const elapsed = -startDays;
  if (elapsed < 0) return null;

  return `day ${Math.min(elapsed + 1, total + 1)} of ${total + 1}`;
}

/** How far through a run window, 0 to 1. Used by pacePosition. */
export function elapsedFraction(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
  now: Date = new Date()
): number {
  const startDays = daysUntil(start, now);
  const endDays = daysUntil(end, now);
  if (startDays === null || endDays === null) return 0;

  const total = endDays - startDays;
  if (total <= 0) return startDays <= 0 ? 1 : 0;

  const elapsed = -startDays;
  if (elapsed <= 0) return 0;
  return Math.min(1, elapsed / total);
}

/**
 * Where a final figure landed against the Good/Better/Best scenarios.
 * Shown on complete cards, where the comparison is the point.
 */
export function scenarioLanding(
  actual: number,
  scenarios: { good: number; better: number; best: number }
): "below good" | "good" | "better" | "best" | "above best" | "unknown" {
  const { good, better, best } = scenarios;
  if (![good, better, best].every(Number.isFinite)) return "unknown";
  if (good <= 0 && better <= 0 && best <= 0) return "unknown";

  if (actual >= best) return actual > best ? "above best" : "best";
  if (actual >= better) return "better";
  if (actual >= good) return "good";
  return "below good";
}

export function scenarioLandingLabel(
  landing: ReturnType<typeof scenarioLanding>
): string {
  switch (landing) {
    case "above best": return "Beat your best case";
    case "best": return "Hit your best case";
    case "better": return "Hit your better case";
    case "good": return "Hit your good case";
    case "below good": return "Below your good case";
    case "unknown": return "";
  }
}

/** Sort comparator: launch date ascending, undated last. */
export function byLaunchDate<T extends { activationDate?: Date | string | null; eventDate?: Date | string | null }>(
  a: T,
  b: T
): number {
  const pick = (x: T) => x.eventDate ?? x.activationDate ?? null;
  const av = pick(a);
  const bv = pick(b);
  if (!av && !bv) return 0;
  // Undated sinks to the bottom rather than to 1970.
  if (!av) return 1;
  if (!bv) return -1;
  return new Date(av).getTime() - new Date(bv).getTime();
}
