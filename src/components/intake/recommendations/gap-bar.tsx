"use client";

import { formatMoney } from "@/lib/format-money";
import type { GoalGap } from "@/lib/intake-forecast";
import { GAP_BAR_HELPER } from "@/lib/intake/schema";

/**
 * The gap-to-goal bar (REQ-13.2, REQ-13.3).
 *
 * Two segments in different shades, because the copy promises it updates as
 * recommendations are accepted or dismissed — so the user has to be able to see
 * which part is theirs and which part is ours. `goalGap` returns the two
 * percentages separately for exactly this reason rather than summing them.
 *
 * Every figure is full comma-separated currency (REQ-2.1). An abbreviated
 * "$131.4K" on the number the whole screen exists to communicate would be a
 * strange place to save eight characters.
 */
export function GapBar({ gap, goal }: { gap: GoalGap; goal: number }) {
  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-border p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-xs text-[hsl(var(--foreground-muted))]">Your goal</p>
          <p className="text-xl font-bold tabular-nums text-foreground">
            {formatMoney(goal)}
          </p>
        </div>

        <div className="text-right">
          <p className="text-xs text-[hsl(var(--foreground-muted))]">
            {gap.covered ? "Above goal by" : "Gap to goal"}
          </p>
          <p
            className={
              gap.covered
                ? "text-xl font-bold tabular-nums text-[hsl(var(--success,var(--primary)))]"
                : "text-xl font-bold tabular-nums text-foreground"
            }
            // polite so the recalculation is announced on accept or dismiss,
            // which is the behaviour REQ-13.3 asks for.
            aria-live="polite"
          >
            {formatMoney(gap.covered ? gap.surplus : gap.gap)}
          </p>
        </div>
      </div>

      <div
        role="progressbar"
        aria-valuenow={gap.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${gap.percent}% of your goal covered`}
        className="flex h-3 w-full overflow-hidden rounded-full bg-[hsl(var(--background-muted))]"
      >
        <div
          className="h-full bg-[hsl(var(--primary))] transition-all duration-300 ease-out"
          style={{ width: `${gap.yoursPercent}%` }}
        />
        {/* Lighter shade: these are not committed until "Build my plan". */}
        <div
          className="h-full bg-[hsl(var(--primary)_/_0.45)] transition-all duration-300 ease-out"
          style={{ width: `${gap.recommendedPercent}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
        <Legend
          swatch="bg-[hsl(var(--primary))]"
          label="Your initiatives"
          value={gap.yoursTotal}
        />
        <Legend
          swatch="bg-[hsl(var(--primary)_/_0.45)]"
          label="Recommended"
          value={gap.recommendedTotal}
        />
      </div>

      <p className="text-xs italic text-[hsl(var(--foreground-muted))]">
        {GAP_BAR_HELPER}
      </p>
    </div>
  );
}

function Legend({
  swatch,
  label,
  value,
}: {
  swatch: string;
  label: string;
  value: number;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[hsl(var(--foreground-muted))]">
      <span className={`h-2 w-2 rounded-full ${swatch}`} aria-hidden="true" />
      {label}
      <span className="font-medium tabular-nums text-foreground">
        {formatMoney(value)}
      </span>
    </span>
  );
}
