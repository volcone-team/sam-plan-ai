/**
 * Parsers for the workbook's two frequency cells on "1. Initiative Library".
 *
 *   "Frequency"           -> which KINDS an initiative allows
 *                            ("Once, Recurring", "Evergreen", "Limited series, Recurring")
 *   "Allowed Frequencies" -> which repeat intervals a recurring one allows
 *                            ("Monthly, Quarterly", "n/a", "Seasonal")
 *
 * The raw cells are stored verbatim on wb_initiative_library
 * (allowed_kinds_raw / allowed_frequencies_raw, migration 051) and parsed here
 * when deriveConfig builds a record's starting config.
 *
 * NULL vs []: a blank cell (or one with nothing recognisable) is `null`,
 * "nobody has said". `[]` is returned only where the sheet SAYS none: "n/a"
 * in Allowed Frequencies. A kinds list is never [] (no record allows nothing).
 *
 * Nothing is dropped silently: every token that is not used is a warning with
 * a stable code. PURE.
 */

import {
  INITIATIVE_KINDS,
  RECURRENCE_FREQUENCIES,
  type InitiativeKind,
  type RecurrenceFrequency,
} from "./library-config";

export type WorkbookKindsWarningCode =
  /** "Limited series" has no kind of its own; read as recurring. */
  | "limited_series_as_recurring"
  /** A token that is not a known kind. Ignored. */
  | "unknown_kind_token";

export type WorkbookFrequenciesWarningCode =
  /** "Seasonal" is not an interval. Ignored. */
  | "seasonal_ignored"
  /** A token that is not a known interval. Ignored. */
  | "unknown_frequency_token";

export interface WorkbookParseWarning<C extends string> {
  code: C;
  /** The token as written. */
  value: string;
  message: string;
}

export interface WorkbookKindsResult {
  kinds: InitiativeKind[] | null;
  warnings: WorkbookParseWarning<WorkbookKindsWarningCode>[];
}

export interface WorkbookFrequenciesResult {
  frequencies: RecurrenceFrequency[] | null;
  warnings: WorkbookParseWarning<WorkbookFrequenciesWarningCode>[];
}

/** Comma, semicolon or newline separated; trimmed; empties dropped. */
function tokens(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(/[,;\n]/)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter((t) => t !== "");
}

/** Case, spaces, hyphens and slashes ignored: "Bi-weekly" = "biweekly", "n/a" = "na". */
const squash = (t: string): string => t.toLowerCase().replace(/[^a-z]/g, "");

const KIND_TOKENS: ReadonlyMap<string, InitiativeKind> = new Map([
  ["once", "one-time"],
  ["onetime", "one-time"],
  ["recurring", "recurring"],
  ["evergreen", "ongoing"],
  ["ongoing", "ongoing"],
]);

const LIMITED_SERIES = "limitedseries";

export function parseWorkbookKinds(raw: string | null | undefined): WorkbookKindsResult {
  const warnings: WorkbookKindsResult["warnings"] = [];
  const found = new Set<InitiativeKind>();
  for (const token of tokens(raw)) {
    const key = squash(token);
    const kind = KIND_TOKENS.get(key);
    if (kind) {
      found.add(kind);
    } else if (key === LIMITED_SERIES) {
      found.add("recurring");
      warnings.push({
        code: "limited_series_as_recurring",
        value: token,
        message: `"${token}" has no kind of its own, so it was read as Recurring.`,
      });
    } else {
      warnings.push({
        code: "unknown_kind_token",
        value: token,
        message: `"${token}" is not a known frequency (Once, Recurring, Evergreen), so it was ignored.`,
      });
    }
  }
  return {
    kinds: found.size > 0 ? INITIATIVE_KINDS.filter((k) => found.has(k)) : null,
    warnings,
  };
}

const FREQUENCY_TOKENS: ReadonlyMap<string, RecurrenceFrequency> = new Map([
  ["weekly", "weekly"],
  ["biweekly", "bi-weekly"],
  ["monthly", "monthly"],
  ["bimonthly", "bi-monthly"],
  ["quarterly", "quarterly"],
  ["semiannually", "semi-annually"],
  ["semiannual", "semi-annually"],
  ["annually", "annually"],
  ["annual", "annually"],
  ["yearly", "annually"],
]);

/** "Explicitly none." */
const NONE_TOKENS: ReadonlySet<string> = new Set(["na", "none"]);

export function parseWorkbookFrequencies(raw: string | null | undefined): WorkbookFrequenciesResult {
  const warnings: WorkbookFrequenciesResult["warnings"] = [];
  const found = new Set<RecurrenceFrequency>();
  let saidNone = false;
  for (const token of tokens(raw)) {
    const key = squash(token);
    const frequency = FREQUENCY_TOKENS.get(key);
    if (frequency) {
      found.add(frequency);
    } else if (NONE_TOKENS.has(key)) {
      saidNone = true;
    } else if (key === "seasonal") {
      warnings.push({
        code: "seasonal_ignored",
        value: token,
        message: `"${token}" is not a repeat interval, so it was ignored.`,
      });
    } else {
      warnings.push({
        code: "unknown_frequency_token",
        value: token,
        message: `"${token}" is not a known repeat interval, so it was ignored.`,
      });
    }
  }
  if (found.size > 0) {
    return { frequencies: RECURRENCE_FREQUENCIES.filter((f) => found.has(f)), warnings };
  }
  return { frequencies: saidNone ? [] : null, warnings };
}

/** Whether the raw Frequency cell mentions "evergreen" (for the ongoing label). */
export function mentionsEvergreen(raw: string | null | undefined): boolean {
  return /evergreen/i.test(String(raw ?? ""));
}
