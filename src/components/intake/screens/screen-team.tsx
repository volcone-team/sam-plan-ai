"use client";

import { NumberInput } from "@/components/ui/number-input";
import { Field } from "../fields/field";
import { PillSelect } from "../fields/choice";
import {
  FIELD_COPY,
  PLAN_OWNER_OPTIONS,
  WHO_CLOSES_OPTIONS,
} from "@/lib/intake/schema";
import type { IntakeAnswers, FieldErrors } from "@/lib/intake/validation";

/**
 * Screen 2 — team and capacity (REQ-5.1 to REQ-5.5).
 *
 * These answers are constraints, not preferences: budget and hours cap what can
 * be recommended (REQ-13.9), and "We don't do sales calls" excludes every
 * sales-call initiative outright (REQ-13.10). The subtitle says as much, since
 * a user who understates their capacity here gets a smaller plan.
 */
export function ScreenTeam({
  answers,
  setAnswer,
  errors,
}: {
  answers: IntakeAnswers;
  setAnswer: (field: string, value: unknown) => void;
  errors: FieldErrors;
}) {
  return (
    <>
      <Field
        htmlFor="team_size"
        label={FIELD_COPY.team_size.label}
        required
        error={errors.team_size}
      >
        <NumberInput
          id="team_size"
          value={asNumber(answers.team_size)}
          onValueChange={(value) => setAnswer("team_size", value)}
          placeholder="1"
          error={Boolean(errors.team_size)}
        />
      </Field>

      <Field label={FIELD_COPY.sales_owner.label} error={errors.sales_owner}>
        <PillSelect
          name="sales_owner"
          options={WHO_CLOSES_OPTIONS}
          value={asString(answers.sales_owner)}
          onChange={(value) => setAnswer("sales_owner", value)}
        />
      </Field>

      {/* Stored for v1.5 team invites; nothing reads it yet. */}
      <Field label={FIELD_COPY.plan_owner.label} error={errors.plan_owner}>
        <PillSelect
          name="plan_owner"
          options={PLAN_OWNER_OPTIONS}
          value={asString(answers.plan_owner)}
          onChange={(value) => setAnswer("plan_owner", value)}
        />
      </Field>

      {/* Paired: both are capacity figures, and both answers are short. */}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          htmlFor="weekly_hours"
          label={FIELD_COPY.weekly_hours.label}
          helper={FIELD_COPY.weekly_hours.helper}
          error={errors.weekly_hours}
        >
          <NumberInput
            id="weekly_hours"
            value={asNumber(answers.weekly_hours)}
            onValueChange={(value) => setAnswer("weekly_hours", value)}
            placeholder="20"
            error={Boolean(errors.weekly_hours)}
          />
        </Field>

        <Field
          htmlFor="monthly_marketing_budget"
          label={FIELD_COPY.monthly_marketing_budget.label}
          helper={FIELD_COPY.monthly_marketing_budget.helper}
          required
          error={errors.monthly_marketing_budget}
        >
          {/* $0 is a valid answer (REQ-5.5), so the placeholder shows it. */}
          <NumberInput
            id="monthly_marketing_budget"
            value={asNumber(answers.monthly_marketing_budget)}
            onValueChange={(value) => setAnswer("monthly_marketing_budget", value)}
            placeholder="0"
            error={Boolean(errors.monthly_marketing_budget)}
          />
        </Field>
      </div>
    </>
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
