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
  /**
   * Size the pills to their text instead of filling the row.
   *
   * For controls that switch a VIEW rather than record an answer — the
   * Month/Exact date toggle, for instance. Stretching "Month" across half the
   * form would make a display preference look as important as the question
   * above it.
   */
  compact?: boolean;
}

/**
 * Pills for a single choice, laid out as a GRID that fills the row.
 *
 * Grid rather than `flex-wrap`, because wrapping sizes each pill to its own
 * text: "I do" ends up a third the width of "A salesperson or sales team",
 * which reads as a ragged edge and leaves a different amount of dead space on
 * every question. An equal-column grid gives one clean right edge down the
 * whole form, and every option the same click target regardless of how long its
 * wording happens to be.
 *
 * `gridColumnsFor` picks the column count from the number of options, so two
 * options take half the width each and a longer list fills end to end.
 */
export function PillSelect<V extends string>({
  name,
  options,
  value,
  onChange,
  error,
  compact,
}: PillSelectProps<V>) {
  return (
    <div
      role="radiogroup"
      aria-invalid={error || undefined}
      className={cn(
        compact ? "flex flex-wrap gap-2" : "grid gap-2",
        !compact && gridColumnsFor(options.length)
      )}
    >
      {options.map((option, index) => {
        const id = `${name}-${option.value}`;
        const selected = value === option.value;

        return (
          <label
            key={option.value}
            htmlFor={id}
            title={option.subLabel}
            className={cn(
              // Centred because the pills are now wider than their text, and
              // left-aligned labels in equal columns look accidental.
              "flex cursor-pointer items-center justify-center gap-1.5 rounded-full border px-3.5 py-2 text-center text-sm",
              !compact && fillTrailingItem(index, options.length),
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
            <span>{option.label}</span>
            {option.subLabel && (
              <span
                className={cn(
                  "text-xs",
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

/**
 * Columns for a given number of options.
 *
 * ONE option is full width, TWO are half each, and anything longer settles at
 * two or three columns rather than growing indefinitely — five equal columns
 * would squeeze "A salesperson or sales team" into three wrapped lines.
 *
 * Always one column on mobile, so nothing is ever narrower than its own label.
 */
export function gridColumnsFor(count: number): string {
  if (count <= 1) return "sm:grid-cols-1";
  if (count === 2) return "sm:grid-cols-2";
  if (count === 3) return "sm:grid-cols-3";
  if (count === 4) return "sm:grid-cols-2 lg:grid-cols-4";
  // Five or more: two columns on tablet, three on desktop.
  return "sm:grid-cols-2 lg:grid-cols-3";
}

/**
 * Stretch a trailing odd item across the empty columns beside it.
 *
 * Without this, an odd count leaves a half-width pill with dead space to its
 * right, which looks like a rendering fault rather than a deliberate layout.
 * Only applies to the LAST item, and only when the count is odd — three options
 * in a three-column grid are already flush.
 *
 * Returns a class string rather than a style so it stays inside Tailwind's
 * responsive variants: the span must not apply at the mobile single-column
 * breakpoint, where every item is already full width.
 */
export function fillTrailingItem(index: number, count: number): string {
  const isLast = index === count - 1;
  if (!isLast) return "";

  // Two-column layouts: an odd count leaves one gap beside the last item.
  if (count === 2 || count === 4) return "";
  if (count % 2 === 1 && count >= 5) return "sm:col-span-2 lg:col-span-1";
  return "";
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
      {/*
        Same grid as PillSelect. These lists are longer — ten obstacles, fourteen
        industries — so wrapping produced a particularly ragged block where
        "Need more leads" sat beside "Unclear marketing strategy" at wildly
        different widths.
      */}
      <div className={cn("grid gap-2", gridColumnsFor(options.length))}>
        {options.map((option, index) => {
          const id = `${name}-${option.value}`;
          const isSelected = selected.has(option.value);
          const disabled = atCap && !isSelected;

          return (
            <label
              key={option.value}
              htmlFor={id}
              className={cn(
                "flex items-center justify-center rounded-full border px-3.5 py-2 text-center text-sm",
                "transition-colors duration-[var(--duration-default)]",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                fillTrailingItem(index, options.length),
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
