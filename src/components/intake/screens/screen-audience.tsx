"use client";

import {
  AUDIENCE_FIELDS,
  FIELD_COPY,
  OTHER_AUDIENCE_OPTIONS,
} from "@/lib/intake/schema";
import type { FieldErrors, IntakeAnswers } from "@/lib/intake/validation";
import { audienceValue } from "@/lib/intake/validation";
import { fieldSkipped, trackIntakeEvent } from "@/lib/intake/events";
import type { PlanPath } from "@/lib/intake/flow";
import { Field } from "../fields/field";
import { ChipMultiSelect } from "../fields/choice";
import { NotSureNumber } from "../fields/not-sure-number";

/**
 * Screen 8 — your audience today (REQ-11.1, REQ-11.2).
 *
 * Every figure here can be "Not sure", which stores NULL plus a flag rather
 * than 0 (REQ-2.6). This is the screen where that distinction does the most
 * work: a business with a genuinely empty email list needs list-building
 * initiatives, while one that simply does not know its list size needs a
 * benchmark. Collapsing both to 0 would give the first plan to both.
 */
export function ScreenAudience({
  answers,
  setAnswers,
  errors,
  path,
}: {
  answers: IntakeAnswers;
  setAnswers: (patch: IntakeAnswers) => void;
  errors: FieldErrors;
  path: PlanPath | null;
}) {
  return (
    <>
      <div className="space-y-5">
        {AUDIENCE_FIELDS.map((spec) => (
          <NotSureNumber
            key={spec.field}
            id={spec.field}
            label={spec.label}
            helper={spec.helper}
            helperItalic={Boolean(spec.helper)}
            value={asNumber(answers[spec.field])}
            notSure={answers[spec.unknownField] === true}
            onChange={(value, notSure) => {
              // One helper owns the null-versus-zero decision, so no screen
              // can get it locally wrong.
              const resolved = audienceValue(value, notSure);
              setAnswers({
                [spec.field]: resolved.value,
                [spec.unknownField]: resolved.unknown,
              });

              // REQ-14.1 — "Not sure" is the signal that a question is not
              // worth asking. Only the field name is recorded.
              if (notSure) {
                void trackIntakeEvent(fieldSkipped("audience", spec.field, path));
              }
            }}
            error={errors[spec.field]}
            placeholder="0"
          />
        ))}
      </div>

      {/*
        REQ-11.2 — this is what makes OPS initiatives recommendable. Someone
        with no list of their own but willing to borrow an audience can still
        run a podcast tour or a partner promotion.
      */}
      <Field
        label={FIELD_COPY.borrowed_audiences.label}
        error={errors.borrowed_audiences}
      >
        <ChipMultiSelect
          name="borrowed_audiences"
          options={OTHER_AUDIENCE_OPTIONS}
          value={toStringArray(answers.borrowed_audiences)}
          onChange={(value) => setAnswers({ borrowed_audiences: value })}
        />
      </Field>
    </>
  );
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
