"use client";

import { DictationTextarea } from "@/components/ui/dictation-textarea";
import {
  CUSTOMER_INDUSTRY_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
  FIELD_COPY,
  showsCustomerIndustries,
} from "@/lib/intake/schema";
import type { FieldErrors, IntakeAnswers } from "@/lib/intake/validation";
import { trackIntakeEvent, voiceUsed } from "@/lib/intake/events";
import type { PlanPath } from "@/lib/intake/flow";
import { Field } from "../fields/field";
import { ChipMultiSelect, PillSelect } from "../fields/choice";

/**
 * Screen 7 — who you sell to (REQ-10.1 to REQ-10.4).
 *
 * The two long-text answers are the only REQUIRED free text in the intake.
 * They go into the generator prompt more or less verbatim, and the difference
 * between a plan built on "coaches and consultants doing $300,000 to $3
 * million" and one built on nothing is the difference between useful and
 * generic — which is why these two block and the business description on
 * screen 1 does not.
 */
export function ScreenCustomer({
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
  const sellsTo = asString(answers.sells_to);

  return (
    <>
      <Field label={FIELD_COPY.sells_to.label} required error={errors.sells_to}>
        <PillSelect
          name="sells_to"
          options={CUSTOMER_TYPE_OPTIONS}
          value={sellsTo}
          onChange={(value) =>
            setAnswer("sells_to", value)
          }
          error={Boolean(errors.sells_to)}
        />
      </Field>

      {/*
        REQ-1.4 / REQ-10.2 — only meaningful when they sell to businesses.
        Optional even when shown: someone selling across the board has no single
        answer, which is what "Any industry" is for.
      */}
      {showsCustomerIndustries(sellsTo) && (
        <Field
          label={FIELD_COPY.customer_industries.label}
          error={errors.customer_industries}
        >
          <ChipMultiSelect
            name="customer_industries"
            options={CUSTOMER_INDUSTRY_OPTIONS}
            value={toStringArray(answers.customer_industries)}
            onChange={(value) => setAnswer("customer_industries", value)}
          />
        </Field>
      )}

      <Field
        htmlFor="ideal_customer_description"
        label={FIELD_COPY.ideal_customer.label}
        required
        error={errors.ideal_customer_description}
      >
        <DictationTextarea
          id="ideal_customer_description"
          value={asString(answers.ideal_customer_description) ?? ""}
          onValueChange={(value) => setAnswer("ideal_customer_description", value)}
          placeholder={FIELD_COPY.ideal_customer.placeholder}
          rows={3}
          error={Boolean(errors.ideal_customer_description)}
          onFocus={() =>
            void trackIntakeEvent(voiceUsed("customer", "ideal_customer", path))
          }
        />
      </Field>

      <Field
        htmlFor="problem_solved"
        label={FIELD_COPY.problem_solved.label}
        required
        error={errors.problem_solved}
      >
        <DictationTextarea
          id="problem_solved"
          value={asString(answers.problem_solved) ?? ""}
          onValueChange={(value) => setAnswer("problem_solved", value)}
          placeholder="They're stuck trading hours for dollars and can't scale past referrals."
          rows={3}
          error={Boolean(errors.problem_solved)}
          onFocus={() =>
            void trackIntakeEvent(voiceUsed("customer", "problem_solved", path))
          }
        />
      </Field>
    </>
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
