"use client";

import { TrendingUp, AlertTriangle } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";
import { formatMoney } from "@/lib/format-money";
import {
  assessGoalForPeriod,
  proratedPriorRevenue,
  stretchForGoal,
} from "@/lib/intake-forecast";
import { DEFAULT_PLANNING_PERIOD, FIELD_COPY } from "@/lib/intake/schema";
import type { IntakeAnswers, FieldErrors } from "@/lib/intake/validation";
import { Field } from "../fields/field";

/**
 * Screen 4 — revenue goal (REQ-7.1 to REQ-7.4).
 *
 * Prior revenue is shown PRORATED to the planning period: on a 6-month plan,
 * $450,000 of last-12 revenue shows as $225,000. Showing the annual figure
 * instead would invite a goal roughly double what the user intends.
 *
 * The stretch card is the goal the user types + 30% (stretchForGoal), the same
 * figure the plan build stores as the stretch target. It is not derived from
 * prior revenue.
 *
 * The warning above 1.5x NEVER blocks and never rewrites the number. It
 * informs, because a deliberate stretch target is the user's call.
 */
export function ScreenGoal({
  answers,
  setAnswer,
  errors,
}: {
  answers: IntakeAnswers;
  setAnswer: (field: string, value: unknown) => void;
  errors: FieldErrors;
}) {
  const periodMonths = asNumber(answers.horizon_months) ?? DEFAULT_PLANNING_PERIOD;
  const lastTwelve = asNumber(answers.prior_period_revenue);
  const goal = asNumber(answers.revenue_goal);

  const prorated = proratedPriorRevenue(lastTwelve, periodMonths);
  // Stretch is this period's goal + 30% (the client's rule), not last year's
  // revenue + 30%. It is the figure the plan build stores as the stretch target.
  const stretch = stretchForGoal(goal);
  const assessment = assessGoalForPeriod(goal, lastTwelve, periodMonths);

  return (
    <>
      {/*
        Reference only. Deliberately not buttons that fill the field: the spec
        says the goal is not pre-filled. The stretch card follows the goal as
        it is typed, and says what it will show until there is one.
      */}
      {(prorated !== null || goal !== null) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {prorated !== null && (
            <ReferenceFigure
              label={`Last 12 months, over ${periodMonths} months`}
              value={prorated}
            />
          )}
          <ReferenceFigure
            label="Stretch goal (your goal +30%)"
            value={stretch}
            emptyText="Enter your goal below"
            highlight
          />
        </div>
      )}

      <Field
        htmlFor="revenue_goal"
        label={FIELD_COPY.revenue_goal.label}
        required
        error={errors.revenue_goal}
      >
        <NumberInput
          id="revenue_goal"
          value={goal}
          onValueChange={(value) => setAnswer("revenue_goal", value)}
          placeholder={prorated !== null ? String(prorated) : "750,000"}
          error={Boolean(errors.revenue_goal)}
        />
      </Field>

      {/*
        Advisory, not a validation error — hence the warning colour rather than
        the destructive one, and no effect on whether Next is enabled.
      */}
      {assessment.warn && assessment.message && (
        <p
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--warning)_/_0.4)] bg-[hsl(var(--warning)_/_0.08)] px-3 py-2.5 text-sm text-foreground"
          // polite, not assertive: it should not interrupt while they type.
          aria-live="polite"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]"
            aria-hidden="true"
          />
          <span>{assessment.message}</span>
        </p>
      )}
    </>
  );
}

function ReferenceFigure({
  label,
  value,
  emptyText,
  highlight,
}: {
  label: string;
  /** Null shows `emptyText` instead of a figure. */
  value: number | null;
  emptyText?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? "rounded-[var(--radius-lg)] border border-[hsl(var(--primary)_/_0.3)] bg-[hsl(var(--primary)_/_0.06)] px-4 py-3"
          : "rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3"
      }
    >
      <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--foreground-muted))]">
        {highlight && <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />}
        {label}
      </p>
      {/* Full comma-separated figures, never abbreviated (REQ-2.1). */}
      {value !== null ? (
        <p
          className="mt-1 text-lg font-semibold tabular-nums text-foreground"
          // The stretch card updates as the goal is typed.
          aria-live={highlight ? "polite" : undefined}
        >
          {formatMoney(value)}
        </p>
      ) : (
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">{emptyText}</p>
      )}
    </div>
  );
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
