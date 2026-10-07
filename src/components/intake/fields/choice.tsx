"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Option } from "@/lib/intake/schema";

/**
 * The selection controls the intake uses: card select, pill select and chips.
 *
 * All three are built on real radio/checkbox inputs rather than clickable divs.
 * A div with an onClick is invisible to keyboard and screen-reader users, and
 * this is the only way through the product — getting it wrong would lock people
 * out of the app entirely rather than degrade one screen.
 *
 * The native input is visually hidden but still focusable, so arrow-key
 * navigation within a radio group and the spacebar toggle on a checkbox come
 * for free, and the focus ring is driven off `peer-focus-visible`.
 */

/* ------------------------------------------------------------------ *
 * Card select — screen 0's paths, screen 1's stages
 * ------------------------------------------------------------------ */

export interface CardSelectProps<V extends string> {
  name: string;
  options: readonly Option<V>[];
  /**
   * Loosely typed on purpose: the draft holds answers as `unknown`, so a screen
   * would otherwise have to cast on every field. An unrecognised value simply
   * selects nothing, which is the right outcome for stale stored data.
   */
  value: string | null;
  onChange: (value: V) => void;
  /** One per row on narrow screens; this sets the wide-screen columns. */
  columns?: 1 | 2 | 3;
  error?: boolean;
}

/**
 * Large cards with a title and explanatory sub-label.
 *
 * Used where the choice carries consequences the user needs explained — the
 * three paths change the whole flow, and the three stages change how many
 * initiatives get recommended.
 */
export function CardSelect<V extends string>({
  name,
  options,
  value,
  onChange,
  columns = 3,
  error,
}: CardSelectProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-invalid={error || undefined}
      className={cn(
        "grid gap-3",
        columns === 1 && "sm:grid-cols-1",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-3"
      )}
    >
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const selected = value === option.value;

        return (
          <label
            key={option.value}
            htmlFor={id}
            className={cn(
              "relative flex cursor-pointer flex-col gap-1.5 rounded-[var(--radius-lg)] border p-4",
              "transition-colors duration-[var(--duration-default)]",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
              selected
                ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.06)]"
                : "border-input hover:border-[hsl(var(--primary)_/_0.4)] hover:bg-[hsl(var(--background-muted))]",
              error && !selected && "border-[hsl(var(--invalid-border))]"
            )}
          >
            <input
              type="radio"
              id={id}
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />

            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold text-foreground">
                {option.label}
              </span>
              {selected && (
                <Check
                  className="h-4 w-4 shrink-0 text-[hsl(var(--primary))]"
                  aria-hidden="true"
                />
              )}
            </div>

            {option.subLabel && (
              <span className="text-xs leading-relaxed text-[hsl(var(--foreground-muted))]">
                {option.subLabel}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Pill select — single choice from a short list
 * ------------------------------------------------------------------ */

export interface PillSelectProps<V extends string> {
  name: string;
  options: readonly Option<V>[];
  /** See `CardSelectProps.value`. */
  value: string | null;
  onChange: (value: V) => void;
  error?: boolean;
}

/**
 * Inline pills for a single choice.
 *
 * Preferred over a dropdown wherever the options fit on screen: seeing all four
 * answers at once is faster than opening a select, and these lists are short by
 * design.
 */
export function PillSelect<V extends string>({
  name,
  options,
  value,
  onChange,
  error,
}: PillSelectProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-invalid={error || undefined}
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => {
        const id = `${name}-${option.value}`;
        const selected = value === option.value;

        return (
          <label
            key={option.value}
            htmlFor={id}
            title={option.subLabel}
            className={cn(
              "cursor-pointer rounded-full border px-3.5 py-2 text-sm",
              "transition-colors duration-[var(--duration-default)]",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
              selected
                ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] font-medium text-[hsl(var(--primary-foreground))]"
                : "border-input text-foreground hover:border-[hsl(var(--primary)_/_0.4)] hover:bg-[hsl(var(--background-muted))]",
              error && !selected && "border-[hsl(var(--invalid-border))]"
            )}
          >
            <input
              type="radio"
              id={id}
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
            {option.subLabel && (
              <span
                className={cn(
                  "ml-1.5 text-xs",
                  selected
                    ? "text-[hsl(var(--primary-foreground)_/_0.8)]"
                    : "text-[hsl(var(--foreground-muted))]"
                )}
              >
                {option.subLabel}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chip multi-select — obstacles, audiences, customer industries
 * ------------------------------------------------------------------ */

export interface ChipMultiSelectProps {
  name: string;
  options: readonly Option[];
  value: readonly string[];
  onChange: (value: string[]) => void;
  /** Hard cap, e.g. 3 obstacles (REQ-12.1). */
  max?: number;
  error?: boolean;
}

/**
 * Multi-select chips with an optional cap.
 *
 * At the cap, unselected chips are DISABLED rather than silently ignoring
 * clicks. A control that looks available and does nothing reads as a bug; a
 * disabled one explains itself, and the count line above says why.
 */
export function ChipMultiSelect({
  name,
  options,
  value,
  onChange,
  max,
  error,
}: ChipMultiSelectProps) {
  const selected = React.useMemo(() => new Set(value), [value]);
  const atCap = max !== undefined && selected.size >= max;

  const toggle = (optionValue: string) => {
    const next = new Set(selected);
    if (next.has(optionValue)) next.delete(optionValue);
    else if (!atCap) next.add(optionValue);
    // Rebuilt from the option order rather than insertion order, so the stored
    // array is stable and two users picking the same chips store the same thing.
    onChange(options.map((o) => o.value).filter((v) => next.has(v)));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const id = `${name}-${option.value}`;
          const isSelected = selected.has(option.value);
          const disabled = atCap && !isSelected;

          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                "rounded-full border px-3.5 py-2 text-sm",
                "transition-colors duration-[var(--duration-default)]",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                disabled
                  ? "cursor-not-allowed border-input opacity-45"
                  : "cursor-pointer",
                isSelected
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] font-medium text-[hsl(var(--primary-foreground))]"
                  : !disabled &&
                      "border-input text-foreground hover:border-[hsl(var(--primary)_/_0.4)] hover:bg-[hsl(var(--background-muted))]",
                error && "border-[hsl(var(--invalid-border))]"
              )}
            >
              <input
                type="checkbox"
                id={id}
                name={name}
                value={option.value}
                checked={isSelected}
                disabled={disabled}
                onChange={() => toggle(option.value)}
                className="sr-only"
              />
              {option.label}
            </label>
          );
        })}
      </div>

      {max !== undefined && (
        // aria-live so reaching the cap is announced rather than only visible.
        <p
          className="text-xs text-[hsl(var(--foreground-muted))]"
          aria-live="polite"
        >
          {selected.size} of {max} selected
          {atCap && " — deselect one to choose a different challenge"}
        </p>
      )}
    </div>
  );
}
