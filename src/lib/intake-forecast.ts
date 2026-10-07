/**
 * Forecast maths for the new intake questionnaire.
 *
 * Pure functions, separated from the form, because these numbers are shown to
 * the customer as their plan's revenue and then drive what the AI recommends.
 * A quiet arithmetic slip here produces a plausible-looking plan built on a
 * wrong target, which is the hardest kind of bug to notice.
 *
 * EVERY FUNCTION BELOW IS PINNED TO THE MOCKUP'S OWN NUMBERS in the tests, so
 * the implementation is checked against the intended design rather than against
 * my reading of it. Worked through from the screens:
 *
 *   Live Webinar: 3,000 audience, 12% registered, 30% showed, 4% bought,
 *   $5,000 average price -> $21,600 a run, monthly over 12 months -> $259,200.
 *   The mockup shows $259,200. Same for the gap-to-goal bar:
 *   458,600 (yours) + 160,000 (recommended) = 618,600, and
 *   750,000 - 618,600 = 131,400, which is the "Gap to goal" figure shown.
 */

/* ------------------------------------------------------------------ *
 * Products
 * ------------------------------------------------------------------ */

/**
 * What one product is expected to produce over the plan period.
 *
 * `averagePrice` is deliberately the REAL average after discounts, not the list
 * price — the form says so, because planning off list price overstates every
 * downstream figure.
 */
export function productGoal(
  averagePrice: number | null | undefined,
  unitsInPeriod: number | null | undefined
): number {
  const price = finite(averagePrice);
  const units = finite(unitsInPeriod);
  if (price <= 0 || units <= 0) return 0;
  return price * units;
}

/** Sum of every product's goal — the "Products total" row. */
export function productsTotal(
  products: readonly { averagePrice: number | null; unitsInPeriod: number | null }[]
): number {
  return products.reduce((sum, p) => sum + productGoal(p.averagePrice, p.unitsInPeriod), 0);
}

/* ------------------------------------------------------------------ *
 * Revenue goal
 * ------------------------------------------------------------------ */

/** Default growth used for the suggested stretch figure. */
export const SUGGESTED_GROWTH_RATE = 0.3;

/**
 * The "Suggested stretch (+30%)" figure beside last year's revenue.
 *
 * Returns null with no prior revenue rather than 0: a brand-new business has no
 * baseline to grow from, and suggesting "$0" would be worse than suggesting
 * nothing.
 */
export function suggestedStretch(
  priorPeriodRevenue: number | null | undefined,
  rate: number = SUGGESTED_GROWTH_RATE
): number | null {
  const prior = finite(priorPeriodRevenue);
  if (prior <= 0) return null;
  return Math.round(prior * (1 + rate));
}

/**
 * Last-12-months revenue scaled to the planning period (REQ-7.2).
 *
 * THIS MATTERS MORE THAN IT LOOKS. The reference figures above the goal field
 * are what people anchor on. On a 6-month plan, showing the unprorated
 * $450,000 annual figure invites a goal roughly double what the user means —
 * and nothing downstream would flag it, because an ambitious goal is
 * legitimate. So $450,000 over 12 months shows as $225,000 on a 6-month plan.
 *
 * Returns null rather than 0 with no prior revenue: a brand-new business has no
 * baseline, and "$0" reads as a measurement rather than an absence.
 */
export function proratedPriorRevenue(
  lastTwelveMonths: number | null | undefined,
  periodMonths: number | null | undefined
): number | null {
  const annual = finite(lastTwelveMonths);
  const months = finite(periodMonths);

  if (annual <= 0 || months <= 0) return null;
  return Math.round((annual / 12) * months);
}

/**
 * The suggested stretch for the chosen period: prorated last-12 x 1.3.
 *
 * Worked through from the requirement: $450,000 last-12 on a 6-month plan
 * prorates to $225,000, and the stretch shows as $292,500.
 */
export function proratedStretch(
  lastTwelveMonths: number | null | undefined,
  periodMonths: number | null | undefined,
  rate: number = SUGGESTED_GROWTH_RATE
): number | null {
  const prorated = proratedPriorRevenue(lastTwelveMonths, periodMonths);
  if (prorated === null) return null;
  return Math.round(prorated * (1 + rate));
}

/** Growth implied by a goal against last period, as a percentage. */
export function impliedGrowthPercent(
  goal: number | null | undefined,
  priorPeriodRevenue: number | null | undefined
): number | null {
  const g = finite(goal);
  const prior = finite(priorPeriodRevenue);
  if (prior <= 0 || g <= 0) return null;
  return Math.round((g / prior - 1) * 100);
}

/**
 * Above this implied growth, the form warns — without blocking.
 *
 * Chosen as well clear of the 30% suggestion so an ordinary ambitious target
 * passes quietly; a warning on every slightly-above-average goal would be
 * noise, and users would stop reading it.
 */
export const GROWTH_WARNING_THRESHOLD_PERCENT = 50;

export interface GoalAssessment {
  growthPercent: number | null;
  /** True when the goal is far enough above trend to be worth noting. */
  warn: boolean;
  /** The sentence shown under the field, or null when nothing needs saying. */
  message: string | null;
}

/**
 * Comment on an entered goal.
 *
 * NEVER blocks and never rewrites the number. The copy says "You can keep your
 * number; your plan will show what it takes to get there" — the point is to
 * inform, because a stretch target entered deliberately is a legitimate choice.
 */
export function assessGoal(
  goal: number | null | undefined,
  priorPeriodRevenue: number | null | undefined
): GoalAssessment {
  const growthPercent = impliedGrowthPercent(goal, priorPeriodRevenue);

  if (growthPercent === null) {
    return { growthPercent: null, warn: false, message: null };
  }
  if (growthPercent <= GROWTH_WARNING_THRESHOLD_PERCENT) {
    return { growthPercent, warn: false, message: null };
  }

  return {
    growthPercent,
    warn: true,
    message:
      `That's a ${growthPercent}% jump from last year. Most businesses plan about ` +
      `${Math.round(SUGGESTED_GROWTH_RATE * 100)}% growth. You can keep your number; ` +
      `your plan will show what it takes to get there.`,
  };
}

/**
 * Assess a goal for the CHOSEN PERIOD rather than against the annual figure.
 *
 * REQ-7.3's 1.5x threshold has to be measured against the prorated baseline, or
 * every short plan trips the warning: a sensible 6-month goal of $225,000 is
 * only half the annual $450,000, while a 6-month goal of $400,000 is a genuine
 * stretch — and comparing both to $450,000 gets each one backwards.
 */
export function assessGoalForPeriod(
  goal: number | null | undefined,
  lastTwelveMonths: number | null | undefined,
  periodMonths: number | null | undefined
): GoalAssessment {
  return assessGoal(goal, proratedPriorRevenue(lastTwelveMonths, periodMonths));
}

/* ------------------------------------------------------------------ *
 * Initiative funnels
 * ------------------------------------------------------------------ */

/**
 * One conversion step in an initiative's funnel.
 *
 * Stage LABELS differ by initiative — a webinar runs
 * registered -> showed up -> bought, while a podcast guest spot runs
 * opted in -> booked a call -> bought — but the arithmetic is identical: a
 * chain of percentages applied to an audience. Modelling it generically is what
 * lets one tested function serve every initiative in the library.
 */
export interface FunnelStage {
  key: string;
  label: string;
  /** Percent, 0-100, as typed. Null when the user skipped it. */
  percent: number | null;
}

export interface InitiativeFunnel {
  audienceReached: number | null;
  stages: readonly FunnelStage[];
  averagePrice: number | null;
}

/** People remaining after each stage, for showing the funnel back to the user. */
export function funnelSteps(
  funnel: InitiativeFunnel
): { key: string; label: string; people: number }[] {
  let people = Math.max(0, finite(funnel.audienceReached));
  const out: { key: string; label: string; people: number }[] = [];
  for (const stage of funnel.stages) {
    const pct = stage.percent === null ? 0 : finite(stage.percent);
    people = people * (pct / 100);
    out.push({ key: stage.key, label: stage.label, people });
  }
  return out;
}

/**
 * Revenue from ONE run of an initiative.
 *
 * Returns null — not 0 — when the inputs are incomplete, so the caller can say
 * "we'll use benchmarks for this" rather than displaying a confident $0. A
 * forecast of zero and an absent forecast mean very different things to someone
 * deciding whether to run a campaign.
 */
export function forecastPerRun(funnel: InitiativeFunnel): number | null {
  const audience = finite(funnel.audienceReached);
  const price = finite(funnel.averagePrice);

  if (audience <= 0 || price <= 0) return null;
  if (funnel.stages.length === 0) return null;
  // Any skipped stage makes the chain unusable; benchmarks fill it instead.
  if (funnel.stages.some((s) => s.percent === null || !Number.isFinite(s.percent))) {
    return null;
  }

  const buyers = funnel.stages.reduce(
    (people, stage) => people * (finite(stage.percent) / 100),
    audience
  );

  return buyers * price;
}

/* ------------------------------------------------------------------ *
 * Cadence
 * ------------------------------------------------------------------ */

export type InitiativeCadence = "once" | "repeat" | "always-on";
export type RepeatFrequency = "weekly" | "monthly" | "quarterly";

/**
 * How many times an initiative runs across the plan.
 *
 * "Always on" counts as monthly: it produces continuously, and the funnel
 * figures users enter are per-month in practice. Treating it as a single run
 * would understate an evergreen initiative twelvefold.
 */
export function runsInPeriod(
  cadence: InitiativeCadence,
  frequency: RepeatFrequency | null,
  horizonMonths: number
): number {
  const months = Math.max(0, Math.floor(finite(horizonMonths)));
  if (months === 0) return 0;

  switch (cadence) {
    case "once":
      return 1;
    case "always-on":
      return months;
    case "repeat":
      switch (frequency) {
        case "weekly":
          // 52 weeks over 12 months, scaled to the horizon and rounded down:
          // a partial run produces no revenue.
          return Math.floor((52 / 12) * months);
        case "quarterly":
          return Math.floor(months / 3);
        case "monthly":
        default:
          return months;
      }
  }
}

/**
 * Total forecast for an initiative across the plan period.
 *
 * Null propagates from `forecastPerRun`: an initiative with incomplete inputs
 * has no forecast of its own and must be filled from benchmarks, not counted
 * as zero.
 */
export function forecastForInitiative(args: {
  funnel: InitiativeFunnel;
  cadence: InitiativeCadence;
  frequency: RepeatFrequency | null;
  horizonMonths: number;
}): number | null {
  const perRun = forecastPerRun(args.funnel);
  if (perRun === null) return null;
  const runs = runsInPeriod(args.cadence, args.frequency, args.horizonMonths);
  return perRun * runs;
}

/* ------------------------------------------------------------------ *
 * Gap to goal
 * ------------------------------------------------------------------ */

export interface GoalGap {
  /** Forecast from initiatives the user entered themselves. */
  yoursTotal: number;
  /** Forecast from recommendations they have accepted. */
  recommendedTotal: number;
  /** Both combined. */
  plannedTotal: number;
  /** Still needed to reach the goal. 0 once covered. */
  gap: number;
  /** Above the goal. 0 until covered. */
  surplus: number;
  covered: boolean;
  /** Share of the goal covered, 0-100 and capped, for the bar. */
  percent: number;
  /** Yours as a share of the goal, for the bar's first segment. */
  yoursPercent: number;
  /** Accepted recommendations as a share, for the second segment. */
  recommendedPercent: number;
}

/**
 * The gap-to-goal bar on the output screen.
 *
 * Segments are returned separately because the bar shows "Your initiatives" and
 * "Recommended" in different shades, and the copy says it updates as
 * recommendations are accepted or dismissed — so the split has to survive into
 * the UI rather than being summed away here.
 */
export function goalGap(args: {
  goal: number | null | undefined;
  yours: readonly (number | null)[];
  recommended: readonly (number | null)[];
}): GoalGap {
  const goal = finite(args.goal);
  // Nulls are unforecast initiatives, which contribute nothing until filled.
  const yoursTotal = sumDefined(args.yours);
  const recommendedTotal = sumDefined(args.recommended);
  const plannedTotal = yoursTotal + recommendedTotal;

  if (goal <= 0) {
    return {
      yoursTotal, recommendedTotal, plannedTotal,
      gap: 0, surplus: 0, covered: false,
      percent: 0, yoursPercent: 0, recommendedPercent: 0,
    };
  }

  const covered = plannedTotal >= goal;
  const pct = (v: number) => Math.max(0, Math.min(100, (v / goal) * 100));

  return {
    yoursTotal,
    recommendedTotal,
    plannedTotal,
    gap: covered ? 0 : goal - plannedTotal,
    surplus: covered ? plannedTotal - goal : 0,
    covered,
    percent: Math.round(pct(plannedTotal)),
    yoursPercent: pct(yoursTotal),
    // Clamped against what's left so the two segments can never exceed the bar.
    recommendedPercent: Math.min(pct(recommendedTotal), 100 - pct(yoursTotal)),
  };
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function finite(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return Number.isFinite(n) ? n : 0;
}

function sumDefined(values: readonly (number | null)[]): number {
  return values.reduce<number>((sum, v) => sum + (v === null ? 0 : finite(v)), 0);
}
