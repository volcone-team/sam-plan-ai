"use client";

import { TrendingUp, AlertTriangle } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";
import { formatMoney } from "@/lib/format-money";
import {
  assessGoalForPeriod,
  proratedPriorRevenue,
  proratedStretch,
} from "@/lib/intake-forecast";
import { DEFAULT_PLANNING_PERIOD, FIELD_COPY } from "@/lib/intake/schema";
import type { IntakeAnswers, FieldErrors } from "@/lib/intake/validation";
import { Field } from "../fields/field";

/**
 * Screen 4 — revenue goal (REQ-7.1 to REQ-7.4).
 *
 * The two reference figures are PRORATED to the planning period. On a 6-month
 * plan, $450,000 of last-12 revenue shows as $225,000 and the stretch as
 * $292,500. Showing the annual figure instead would invite a goal roughly
 * double what the user intends, and nothing downstream would catch it — an
 * ambitious goal is a legitimate choice.
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
  const stretch = proratedStretch(lastTwelve, periodMonths);
  const assessment = assessGoalForPeriod(goal, lastTwelve, periodMonths);

  return (
    <>
      {/*
        Reference only. Deliberately not buttons that fill the field: the spec
        says the goal is not pre-filled, and a one-tap stretch target would make
        the suggestion the default answer.
      */}
      {prorated !== null && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ReferenceFigure
            label={`Last 12 months, over ${periodMonths} months`}
            value={prorated}
          />
          {stretch !== null && (
            <ReferenceFigure
              label="Suggested stretch (+30%)"
              value={stretch}
              highlight
            />
          )}
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
          placeholder={stretch !== null ? String(stretch) : "750,000"}
          error={Boolean(errors.revenue_goal)}
          className="sm:max-w-xs"
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
  highlight,
}: {
  label: string;
  value: number;
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
      <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
        {formatMoney(value)}
      </p>
    </div>
  );
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
