"use client";

import { Info } from "lucide-react";
import { NumberInput } from "@/components/ui/number-input";
import { formatMoney } from "@/lib/format-money";
import { forecastPerRun } from "@/lib/intake-forecast";
import {
  AUDIENCE_LABEL,
  AVERAGE_PRICE_LABEL,
  FUNNEL_SKIP_HELPER,
  funnelFieldsFor,
  toInitiativeFunnel,
  type FunnelAnswers,
  type StageKey,
} from "@/lib/intake/funnel";
import type { FieldErrors } from "@/lib/intake/validation";
import { Field } from "./field";

/**
 * The five funnel inputs for one initiative (REQ-8.10, REQ-8.11).
 *
 * ALL FIVE ARE OPTIONAL. The helper says benchmarks fill anything skipped, and
 * nothing here blocks — a user who half-remembers last year's webinar should
 * give what they have rather than abandon the field.
 *
 * Stage labels come from `funnelFieldsFor`, which varies the WORDING per
 * initiative while the arithmetic stays identical. A webinar asks "% who showed
 * up", a podcast "% who booked a call", and both run through the same tested
 * `forecastPerRun`.
 *
 * The live figure is deliberately absent until all five are in. A partial
 * funnel produces NO forecast rather than a low one — showing "$0" while
 * someone is still typing tells them the initiative is worthless, when in fact
 * we simply do not know yet.
 */

export interface FunnelFieldsProps {
  /** Unique per instance: screen 5 stacks several of these. */
  idPrefix: string;
  /** Library key, which selects the stage wording. */
  initiativeKey: string | null;
  answers: FunnelAnswers;
  onChange: (answers: FunnelAnswers) => void;
  errors?: FieldErrors;
}

export function FunnelFields({
  idPrefix,
  initiativeKey,
  answers,
  onChange,
  errors = {},
}: FunnelFieldsProps) {
  const fields = funnelFieldsFor(initiativeKey);

  // Null until every input is present, by design. See the note above.
  const perRun = forecastPerRun(toInitiativeFunnel(initiativeKey, answers));

  const setPercent = (key: StageKey, value: number | null) => {
    onChange({ ...answers, percents: { ...answers.percents, [key]: value } });
  };

  return (
    <div className="space-y-5 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] p-4">
      <p className="flex items-start gap-2 text-xs text-[hsl(var(--foreground-muted))]">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {FUNNEL_SKIP_HELPER}
      </p>

      <Field
        htmlFor={`${idPrefix}-audience`}
        label={AUDIENCE_LABEL}
        error={errors.audience_reached}
      >
        <NumberInput
          id={`${idPrefix}-audience`}
          value={answers.audienceReached}
          onValueChange={(value) => onChange({ ...answers, audienceReached: value })}
          placeholder="3,000"
          error={Boolean(errors.audience_reached)}
          className="sm:max-w-[12rem]"
        />
      </Field>

      {/*
        Order matters and is not cosmetic: each percentage applies to the people
        remaining after the previous step, so the visual sequence has to match
        the arithmetic in `forecastPerRun`.
      */}
      <div className="grid gap-4 sm:grid-cols-3">
        {fields.map((field) => (
          <Field
            key={field.key}
            htmlFor={`${idPrefix}-${field.key}`}
            label={field.label}
            error={errors[`funnel.${field.key}`]}
          >
            <NumberInput
              id={`${idPrefix}-${field.key}`}
              value={answers.percents[field.key] ?? null}
              onValueChange={(value) => setPercent(field.key, value)}
              placeholder="0"
              error={Boolean(errors[`funnel.${field.key}`])}
              aria-label={field.label}
            />
          </Field>
        ))}
      </div>

      <Field
        htmlFor={`${idPrefix}-price`}
        label={AVERAGE_PRICE_LABEL}
        error={errors.average_price}
      >
        <NumberInput
          id={`${idPrefix}-price`}
          value={answers.averagePrice}
          onValueChange={(value) => onChange({ ...answers, averagePrice: value })}
          placeholder="5,000"
          error={Boolean(errors.average_price)}
          className="sm:max-w-[12rem]"
        />
      </Field>

      {perRun !== null && (
        <div
          className="flex items-baseline justify-between border-t border-border pt-3"
          // polite so the figure is announced as it settles, not mid-keystroke.
          aria-live="polite"
        >
          <span className="text-sm text-[hsl(var(--foreground-muted))]">
            That works out to
          </span>
          <span className="text-base font-semibold tabular-nums text-foreground">
            {formatMoney(perRun)} per run
          </span>
        </div>
      )}
    </div>
  );
}
