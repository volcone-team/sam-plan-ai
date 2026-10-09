/**
 * Turning a saved intake initiative into the revenue figures `initiatives` and
 * `annual_plans` actually store.
 *
 * WHY THIS EXISTS. The build route created initiatives with no revenue at all,
 * so a plan arrived on the dashboard structurally complete and financially
 * empty: every card read "$0 / $0", "Does your plan add up?" totalled $0, and
 * the goal tiles said "No target set for this year yet". The forecast was
 * computed on the recommendations screen, shown to the user, and then thrown
 * away at the commit point.
 *
 * There is also a vocabulary mismatch to absorb. `intake_initiatives.cadence`
 * stores 'always_on' (underscore, matching its CHECK constraint) while
 * `intake-forecast.ts` models 'always-on' (hyphen). Passing the stored value
 * straight in falls through to the `once` branch, so an evergreen initiative
 * would be counted a single time instead of once a month — understating it by
 * the length of the plan.
 *
 * Pure so the arithmetic is testable without a database.
 */

import {
  forecastForInitiative,
  type InitiativeCadence,
  type FunnelStage,
  type RepeatFrequency,
} from "@/lib/intake-forecast";

/** The three scenarios `initiatives` stores. */
export interface RevenueScenarios {
  good: number;
  better: number;
  best: number;
}

/**
 * Scenario spread around the forecast.
 *
 * The same ±30% the generator prompt uses, so an intake-built plan and an
 * AI-generated one present comparable numbers. `better` is the forecast itself:
 * the user's own funnel figures are the "lands as planned" case, which is
 * exactly what the dashboard's "Better" column claims to mean.
 */
export const GOOD_MULTIPLIER = 0.7;
export const BEST_MULTIPLIER = 1.3;

/**
 * `intake_initiatives.cadence` -> the forecast model's cadence.
 *
 * Unknown or absent cadence becomes 'once'. That is the conservative reading: a
 * card where the question was skipped should not be credited with twelve runs.
 */
export function toCadence(value: unknown): InitiativeCadence {
  switch (value) {
    case "repeat":
      return "repeat";
    case "always_on":
    case "always-on":
      return "always-on";
    default:
      return "once";
  }
}

/** `intake_initiatives.repeat_frequency` -> the forecast model's frequency. */
export function toFrequency(value: unknown): RepeatFrequency | null {
  switch (value) {
    case "weekly":
    case "monthly":
    case "quarterly":
      return value;
    default:
      return null;
  }
}

/**
 * Read the JSONB funnel stages back into the forecast model's shape.
 *
 * A malformed or missing array yields no stages, which makes `forecastPerRun`
 * return null rather than a confident zero — the distinction the whole forecast
 * module is careful about.
 */
export function toFunnelStages(value: unknown): FunnelStage[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry): FunnelStage[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const key = typeof row.key === "string" ? row.key : null;
    if (!key) return [];

    const percent =
      typeof row.percent === "number" && Number.isFinite(row.percent)
        ? row.percent
        : null;

    return [
      {
        key,
        label: typeof row.label === "string" ? row.label : key,
        percent,
      },
    ];
  });
}

/**
 * Total forecast for one stored initiative over the plan period, or null when
 * its funnel is incomplete.
 *
 * Null is deliberately preserved rather than coerced to 0: the caller decides
 * whether to fall back to a benchmark, and writing 0 would state as fact that
 * the initiative produces nothing.
 */
export function forecastForStoredInitiative(
  row: Record<string, unknown>,
  horizonMonths: number
): number | null {
  return forecastForInitiative({
    funnel: {
      audienceReached: num(row.audience_reached),
      stages: toFunnelStages(row.funnel_stages),
      averagePrice: num(row.average_price),
    },
    cadence: toCadence(row.cadence),
    frequency: toFrequency(row.repeat_frequency),
    horizonMonths,
  });
}

/**
 * Spread a forecast into the three scenarios.
 *
 * Rounded to whole currency: the column is NUMERIC(12,2) and fractions of a
 * cent in a projection are noise.
 */
export function scenariosFor(forecast: number | null): RevenueScenarios {
  if (forecast === null || !Number.isFinite(forecast) || forecast <= 0) {
    return { good: 0, better: 0, best: 0 };
  }

  return {
    good: Math.round(forecast * GOOD_MULTIPLIER),
    better: Math.round(forecast),
    best: Math.round(forecast * BEST_MULTIPLIER),
  };
}

/**
 * The annual plan's targets.
 *
 * Baseline is what the user ASKED for — their revenue goal — not what we
 * forecast. Those are different claims, and overwriting the goal with the
 * forecast would hide the very gap the recommendations screen exists to show.
 *
 * Stretch is the goal at the best-case multiplier, floored at the goal itself
 * so stretch is never below baseline.
 */
export function planTargets(revenueGoal: number | null): {
  baseline: number;
  stretch: number;
} {
  const goal = num(revenueGoal) ?? 0;
  if (goal <= 0) return { baseline: 0, stretch: 0 };

  return {
    baseline: Math.round(goal),
    stretch: Math.round(goal * BEST_MULTIPLIER),
  };
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
