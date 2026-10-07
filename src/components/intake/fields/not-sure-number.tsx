"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { NumberInput } from "@/components/ui/number-input";
import { NOT_SURE_LABEL } from "@/lib/intake/schema";
import { Field } from "./field";

/**
 * An integer field paired with a "Not sure" checkbox (REQ-11.1).
 *
 * The checkbox stores NULL plus an explicit unknown flag, never 0. A zero tells
 * the generator the business genuinely has no email list and it plans
 * accordingly; "Not sure" tells it to use benchmarks instead. Those produce
 * very different plans, and the difference is invisible if both arrive as 0.
 *
 * Ticking the box CLEARS the input rather than disabling it with the value
 * intact. Leaving a half-typed figure next to an unknown flag would store two
 * contradictory answers, and the user has just overridden themselves.
 */

export interface NotSureNumberProps {
  id: string;
  label: string;
  helper?: string;
  helperItalic?: boolean;
  value: number | null;
  notSure: boolean;
  onChange: (value: number | null, notSure: boolean) => void;
  error?: string;
  placeholder?: string;
}

export function NotSureNumber({
  id,
  label,
  helper,
  helperItalic,
  value,
  notSure,
  onChange,
  error,
  placeholder,
}: NotSureNumberProps) {
  const checkboxId = `${id}-not-sure`;

  return (
    <Field
      htmlFor={id}
      label={label}
      helper={helper}
      helperItalic={helperItalic}
      error={error}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <NumberInput
          id={id}
          value={notSure ? null : value}
          onValueChange={(next) => onChange(next, false)}
          disabled={notSure}
          placeholder={notSure ? NOT_SURE_LABEL : placeholder}
          error={Boolean(error)}
          className={cn("sm:max-w-xs", notSure && "opacity-50")}
        />

        <label
          htmlFor={checkboxId}
          className="inline-flex cursor-pointer items-center gap-2 text-sm text-[hsl(var(--foreground-muted))]"
        >
          <input
            type="checkbox"
            id={checkboxId}
            checked={notSure}
            onChange={(e) =>
              // Ticking discards the typed figure; unticking returns an empty
              // field rather than resurrecting a number the user abandoned.
              onChange(null, e.target.checked)
            }
            className="h-4 w-4 cursor-pointer rounded border-input accent-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
          {NOT_SURE_LABEL}
        </label>
      </div>
    </Field>
  );
}
