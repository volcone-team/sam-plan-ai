"use client";

import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { DictationTextarea } from "@/components/ui/dictation-textarea";
import { Field } from "../fields/field";
import { CardSelect, PillSelect } from "../fields/choice";
import {
  BUSINESS_STAGE_OPTIONS,
  FIELD_COPY,
  INDUSTRY_OPTIONS,
  INDUSTRY_OTHER,
  SALES_MODEL_OPTIONS,
} from "@/lib/intake/schema";
import type { IntakeAnswers, FieldErrors } from "@/lib/intake/validation";
import { trackIntakeEvent, voiceUsed } from "@/lib/intake/events";
import type { PlanPath } from "@/lib/intake/flow";

/**
 * Screen 1 — your business (REQ-4.1 to REQ-4.6).
 *
 * The industry dropdown is the load-bearing field: its value is matched
 * verbatim against the Initiative Library's "Ideal Industries" column, so the
 * options come from `schema.ts` rather than being written out here where they
 * could drift from the library.
 */
export function ScreenBusiness({
  answers,
  setAnswer,
  errors,
  path,
}: {
  answers: IntakeAnswers;
  setAnswer: (field: string, value: unknown) => void;
  errors: FieldErrors;
  path: PlanPath | null;
}) {
  const industry = asString(answers.industry);

  return (
    <>
      <Field
        htmlFor="industry"
        label={FIELD_COPY.industry.label}
        required
        error={errors.industry}
      >
        <Select
          id="industry"
          value={industry ?? ""}
          onChange={(e) => setAnswer("industry", e.target.value || null)}
          error={Boolean(errors.industry)}
        >
          <option value="">Choose one…</option>
          {INDUSTRY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      {/*
        Revealed by "Other". Required once shown, because the generator has
        nothing to filter the library on otherwise.
      */}
      {industry === INDUSTRY_OTHER && (
        <Field
          htmlFor="industry_other"
          label={FIELD_COPY.industry_other.label}
          required
          error={errors.industry_other}
        >
          <Input
            id="industry_other"
            value={asString(answers.industry_other) ?? ""}
            onChange={(e) => setAnswer("industry_other", e.target.value)}
            placeholder="Tell us in a few words"
            error={Boolean(errors.industry_other)}
          />
        </Field>
      )}

      <Field
        htmlFor="business_description"
        label={FIELD_COPY.business_description.label}
        error={errors.business_description}
      >
        <DictationTextarea
          id="business_description"
          value={asString(answers.business_description) ?? ""}
          onValueChange={(value) => setAnswer("business_description", value)}
          placeholder={FIELD_COPY.business_description.placeholder}
          rows={3}
          // Fired on focus rather than on each keystroke: the question is
          // whether the mic gets used at all, not how much was dictated.
          onFocus={() =>
            void trackIntakeEvent(voiceUsed("business", "business_description", path))
          }
        />
      </Field>

      <Field label={FIELD_COPY.purchase_mode.label} error={errors.purchase_mode}>
        <PillSelect
          name="purchase_mode"
          options={SALES_MODEL_OPTIONS}
          value={asString(answers.purchase_mode)}
          onChange={(value) => setAnswer("purchase_mode", value)}
        />
      </Field>

      <Field
        htmlFor="prior_period_revenue"
        label={FIELD_COPY.prior_period_revenue.label}
        required
        error={errors.prior_period_revenue}
      >
        <NumberInput
          id="prior_period_revenue"
          value={asNumber(answers.prior_period_revenue)}
          onValueChange={(value) => setAnswer("prior_period_revenue", value)}
          placeholder="450,000"
          error={Boolean(errors.prior_period_revenue)}
        />
      </Field>

      {/*
        Stage sets how many initiatives get recommended (REQ-13.13). Nothing is
        pre-selected and no dollar thresholds are shown: revenue bands differ
        too much by industry for a cut-off to mean anything, so the user picks.
      */}
      <Field
        label={FIELD_COPY.growth_stage.label}
        required
        error={errors.growth_stage}
      >
        <CardSelect
          name="growth_stage"
          options={BUSINESS_STAGE_OPTIONS}
          value={asString(answers.growth_stage)}
          onChange={(value) => setAnswer("growth_stage", value)}
          columns={3}
          error={Boolean(errors.growth_stage)}
        />
      </Field>
    </>
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
