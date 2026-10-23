"use client";

import * as React from "react";
import { DictationTextarea } from "@/components/ui/dictation-textarea";
import { FIELD_COPY } from "@/lib/intake/schema";
import type { FieldErrors, IntakeAnswers } from "@/lib/intake/validation";
import { trackIntakeEvent, voiceUsed } from "@/lib/intake/events";
import type { PlanPath } from "@/lib/intake/flow";
import { Field } from "../fields/field";

/**
 * Screen 6 — wins and struggles.
 *
 * Two optional free-text answers, stored on `planning_inputs`:
 *   what_worked_notes  "What has driven real sales for you?"
 *   what_failed_notes  "What have you tried that didn't work?"
 *
 * Both reach the recommendation prompt (/api/intake/recommend). Nothing is
 * required — a user with no history still has a usable plan, while a user
 * forced to invent an answer poisons the recommendations.
 *
 * This screen used to pick initiatives from the library and write 'worked' /
 * 'failed' `intake_initiatives` rows. It no longer creates them. Rows saved
 * before the change stay in the draft's initiatives array untouched (so the
 * draft save re-writes them as before) and a legacy 'failed' row still
 * excludes its initiative from the recommendations.
 */
export function ScreenWins({
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
        htmlFor="what_worked_notes"
        label={FIELD_COPY.what_worked_notes.label}
        error={errors.what_worked_notes}
      >
        <DictationTextarea
          id="what_worked_notes"
          value={asString(answers.what_worked_notes) ?? ""}
          onValueChange={(value) => setAnswer("what_worked_notes", value)}
          placeholder="Our webinars convert best when we run them right after a podcast appearance."
          rows={4}
          onFocus={() => void trackIntakeEvent(voiceUsed("wins", "what_worked_notes", path))}
        />
      </Field>

      <Field
        htmlFor="what_failed_notes"
        label={FIELD_COPY.what_failed_notes.label}
        error={errors.what_failed_notes}
      >
        <DictationTextarea
          id="what_failed_notes"
          value={asString(answers.what_failed_notes) ?? ""}
          onValueChange={(value) => setAnswer("what_failed_notes", value)}
          placeholder="Cold Facebook ads to a webinar — we got sign-ups but nobody showed up."
          rows={4}
          onFocus={() => void trackIntakeEvent(voiceUsed("wins", "what_failed_notes", path))}
        />
      </Field>
    </>
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
