"use client";

import * as React from "react";
import { Select } from "@/components/ui/select";

/**
 * Month picker for the plan start (REQ-6.2) and optional initiative dates.
 *
 * WHY NOT `<input type="month">`: the same problem as the native date input —
 * it renders in the BROWSER's locale, which the page cannot override, so the
 * month order and separators vary by machine while every date the app prints is
 * MM/DD/YYYY. A select of named months is unambiguous everywhere.
 *
 * The past is not offered at all, rather than offered and rejected (REQ-6.2):
 * a plan starting last month would have the generator sequencing tasks into
 * dates that have already gone by, and a disabled option the user can see is
 * easier to understand than an error after the fact.
 *
 * The value crossing the boundary is `YYYY-MM-01`, matching the DATE column.
 */

export interface MonthSelectProps {
  id?: string;
  /** `YYYY-MM-DD`, or '' when unset. */
  value: string;
  onValueChange: (value: string) => void;
  /** How many months forward to offer. */
  monthsAhead?: number;
  /** Earliest selectable month. Defaults to the current month. */
  from?: Date;
  /** Shown as the blank first option. Omit to require a choice. */
  placeholder?: string;
  error?: boolean;
  className?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

export function MonthSelect({
  id,
  value,
  onValueChange,
  monthsAhead = 24,
  from,
  placeholder,
  error,
  className,
  ...aria
}: MonthSelectProps) {
  /**
   * Built in UTC throughout. A date-only value parsed in local time can land in
   * the previous month for anyone west of UTC, which would silently offer — and
   * store — a month earlier than the one displayed.
   */
  const options = React.useMemo(() => {
    const start = from ?? new Date();
    const base = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

    return Array.from({ length: monthsAhead }, (_, offset) => {
      const date = new Date(
        Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + offset, 1)
      );
      return { value: toIsoMonth(date), label: toLabel(date) };
    });
  }, [from, monthsAhead]);

  /**
   * A stored month earlier than the window is still shown, so an existing draft
   * does not appear to have lost its answer. It will fail validation, which is
   * the right place to say so.
   */
  const storedIsOutsideRange =
    value !== "" && !options.some((option) => option.value === value);

  return (
    <Select
      id={id}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
      error={error}
      className={className}
      {...aria}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {storedIsOutsideRange && (
        <option value={value}>{toLabel(parseIsoMonth(value))}</option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>
  );
}

/** `YYYY-MM-01` — the first of the month, which is what a plan start means. */
function toIsoMonth(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-01`;
}

function toLabel(date: Date | null): string {
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function parseIsoMonth(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}
