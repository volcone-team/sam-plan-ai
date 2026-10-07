"use client";

import { DictationTextarea } from "@/components/ui/dictation-textarea";
import {
  FIELD_COPY,
  MAX_OBSTACLES,
  OBSTACLE_OPTIONS,
} from "@/lib/intake/schema";
import type { FieldErrors, IntakeAnswers } from "@/lib/intake/validation";
import { trackIntakeEvent, voiceUsed } from "@/lib/intake/events";
import type { PlanPath } from "@/lib/intake/flow";
import { Field } from "../fields/field";
import { ChipMultiSelect } from "../fields/choice";

/**
 * Screen 9 — what's held you back (REQ-12.1 to REQ-12.3).
 *
 * The cap of three is the point of the question. Someone who selects everything
 * has told us nothing about priority, and the generator needs to know which
 * constraint to plan around first — so unselected chips disable at the cap
 * rather than silently ignoring clicks.
 *
 * The primary button on this screen is path-dependent ("Check my plan" / "Fill
 * in my plan" / "Recommend my initiatives"). That lives in the shell, off
 * `finalButtonLabel`, so the three labels are not buried in a ternary here.
 */
export function ScreenObstacles({
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
  return (
    <>
      <Field
        label={FIELD_COPY.challenges.label}
        helper={FIELD_COPY.challenges.helper}
        helperItalic
        error={errors.challenges}
      >
        <ChipMultiSelect
          name="challenges"
          options={OBSTACLE_OPTIONS}
          value={toStringArray(answers.challenges)}
          onChange={(value) => setAnswer("challenges", value)}
          max={MAX_OBSTACLES}
          error={Boolean(errors.challenges)}
        />
      </Field>

      <Field
        htmlFor="challenge_notes"
        label={FIELD_COPY.challenge_notes.label}
        error={errors.challenge_notes}
      >
        <DictationTextarea
          id="challenge_notes"
          value={asString(answers.challenge_notes) ?? ""}
          onValueChange={(value) => setAnswer("challenge_notes", value)}
          placeholder="We get plenty of leads but only close about one in ten."
          rows={3}
          onFocus={() =>
            void trackIntakeEvent(voiceUsed("obstacles", "challenge_notes", path))
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
