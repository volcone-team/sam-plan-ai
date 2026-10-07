"use client";

import { Field } from "../fields/field";
import { CardSelect } from "../fields/choice";
import {
  FIELD_COPY,
  INITIATIVE_TOOLTIP,
  PLAN_PATH_OPTIONS,
} from "@/lib/intake/schema";
import type { PlanPath } from "@/lib/intake/flow";
import type { FieldErrors } from "@/lib/intake/validation";

/**
 * Screen 0 — your starting point (REQ-3.1).
 *
 * The single most consequential answer in the intake: it decides whether screen
 * 5 exists at all and which variant of the recommendations screen the user
 * sees. Three cards with sub-labels rather than a dropdown, because the user is
 * choosing how much work they are taking on and needs that spelled out.
 */
export function ScreenStart({
  value,
  onChange,
  errors,
}: {
  value: PlanPath | null;
  onChange: (path: PlanPath) => void;
  errors: FieldErrors;
}) {
  return (
    <Field
      label={FIELD_COPY.intake_path.label}
      required
      error={errors.intake_path}
      // REQ-3.2 — "initiative" is jargon until it is explained.
      tooltip={INITIATIVE_TOOLTIP}
    >
      <CardSelect
        name="intake_path"
        options={PLAN_PATH_OPTIONS}
        value={value}
        onChange={onChange}
        columns={3}
        error={Boolean(errors.intake_path)}
      />
    </Field>
  );
}
