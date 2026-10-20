/**
 * Thousands-separated number INPUT handling.
 *
 * Reading `1000000` and checking it is a million rather than a hundred thousand
 * takes real effort; `1,000,000` does not. Display formatting alone cannot fix
 * this, because `<input type="number">` refuses any value containing a comma —
 * the browser treats it as invalid and hands back an empty string. So a
 * comma-formatted field must be `type="text"` with its own parsing, which is
 * what these functions provide.
 *
 * Pure and framework-free so the parsing rules can be tested directly rather
 * than through a rendered component.
 *
 * The caret helpers exist because naive reformat-on-every-keystroke jumps the
 * cursor to the end of the field: typing `1000000` then clicking back to fix
 * the first digit flings you to the end on the next keypress.
 */

/** Characters allowed through while typing a number. */
const ALLOWED = /[^0-9.\-]/g;

/**
 * Strip formatting down to a raw numeric string.
 *
 * Keeps a single leading minus and a single decimal point, so partial input
 * like "-" or "12." survives mid-typing instead of being erased under the user.
 */
export function stripFormatting(input: string): string {
  if (!input) return "";

  const cleaned = input.replace(ALLOWED, "");
  const negative = input.trimStart().startsWith("-");

  // Collapse any extra decimal points: the first one wins.
  const parts = cleaned.replace(/-/g, "").split(".");
  const joined =
    parts.length > 1 ? `${parts[0]}.${parts.slice(1).join("")}` : parts[0];

  return negative ? `-${joined}` : joined;
}

/**
 * Parse a possibly comma-formatted string to a number.
 *
 * Returns null for empty or non-numeric input rather than NaN or 0: the
 * questionnaire stores `number | null` and must distinguish "not answered"
 * from "answered zero".
 */
export function parseNumberInput(input: string): number | null {
  const raw = stripFormatting(input);
  if (!raw || raw === "-" || raw === "." || raw === "-.") return null;

  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Add thousands separators to a numeric string, preserving what the user is
 * mid-way through typing.
 *
 * Only the integer part is grouped. A trailing "." is kept so typing "1000."
 * does not have the point swallowed before the decimals arrive.
 */
export function formatNumberInput(input: string): string {
  const raw = stripFormatting(input);
  if (!raw) return "";

  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;

  if (!unsigned || unsigned === ".") return negative ? "-" : "";

  const [intPart, ...rest] = unsigned.split(".");
  const hasDecimalPoint = unsigned.includes(".");
  const decimals = rest.join("");

  const grouped = intPart ? Number(intPart).toLocaleString("en-US") : "";
  // Number("") is 0, so an empty integer part with decimals ("‑.5") must not
  // silently become "0".
  const safeInt = intPart === "" ? "" : grouped;

  let out = safeInt;
  if (hasDecimalPoint) out += `.${decimals}`;
  return negative ? `-${out}` : out;
}

/** Format a stored numeric value for display in an input. */
export function formatNumberValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return value.toLocaleString("en-US", { maximumFractionDigits: 20 });
}

/**
 * Where should the caret sit after reformatting?
 *
 * Counts the DIGITS to the left of the caret in the user's raw input, then
 * finds the position in the formatted string with that many digits to its left.
 * Commas shift as digits are added, so a plain character offset drifts; digit
 * count is stable under reformatting.
 */
export function caretPositionAfterFormat(
  formatted: string,
  rawCaret: number,
  rawInput: string
): number {
  // Digits (and the decimal point) before the caret in what was typed.
  const significantBefore = rawInput
    .slice(0, rawCaret)
    .replace(/[^0-9.]/g, "").length;

  if (significantBefore === 0) {
    // Caret at the very start, or only separators to its left.
    return rawCaret === 0 ? 0 : Math.min(formatted.length, rawCaret);
  }

  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[0-9.]/.test(formatted[i])) {
      seen += 1;
      if (seen === significantBefore) return i + 1;
    }
  }
  return formatted.length;
}

/* ─────────────────────────────────────────────────
 * Grouped text inputs (metric fields)
 * ───────────────────────────────────────────────── */

export interface GroupedInputOptions {
  /** Keep one decimal point. False drops every dot (whole counts). */
  allowDecimal: boolean;
  /** Keep a leading minus (scores). Default false. */
  allowNegative?: boolean;
  /** Truncate the decimals typed beyond this many (money: 2). */
  maxDecimals?: number;
  /** A leading symbol kept when typed, e.g. "$" for money. */
  prefix?: string;
  /** A trailing symbol kept when typed, e.g. "%" for rates. */
  suffix?: string;
}

/** Group an all-digit string with commas, without going through Number. */
function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format what the user has typed into a metric field, keeping it a string.
 *
 * Unlike `formatNumberInput` this never goes through `Number`, so it cannot
 * lose precision on long inputs, and it keeps an optional "$" prefix or "%"
 * suffix that metric validation (`normaliseMetricInput`) accepts:
 *   "1234"   -> "1,234"      "1234."  -> "1,234."     "0." -> "0."
 *   "1234.5" -> "1,234.5"    "12.5%"  -> "12.5%"      "$1234" -> "$1,234"
 *   "1,2,34" -> "1,234"      "1.2.3"  -> "1.23"
 * Anything else (letters, spaces, a misplaced minus) is dropped. Leading
 * zeros collapse ("007" -> "7") but a single "0" is kept.
 */
export function formatGroupedInput(raw: string, opts: GroupedInputOptions): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const prefix = opts.prefix ?? "";
  const suffix = opts.suffix ?? "";
  const hasPrefix = prefix !== "" && trimmed.startsWith(prefix);
  const hasSuffix = suffix !== "" && trimmed.endsWith(suffix);
  const afterPrefix = hasPrefix ? trimmed.slice(prefix.length).trimStart() : trimmed;
  const negative = !!opts.allowNegative && afterPrefix.startsWith("-");

  const cleaned = raw.replace(opts.allowDecimal ? /[^0-9.]/g : /[^0-9]/g, "");
  const dot = cleaned.indexOf(".");
  const intRaw = dot === -1 ? cleaned : cleaned.slice(0, dot);
  let decimals = dot === -1 ? "" : cleaned.slice(dot + 1).replace(/\./g, "");
  if (opts.maxDecimals !== undefined) decimals = decimals.slice(0, opts.maxDecimals);

  const intPart = intRaw.replace(/^0+(?=\d)/, "");
  const body = groupDigits(intPart) + (dot === -1 ? "" : `.${decimals}`);

  // Nothing numeric yet: keep a lone minus so a score can be typed, drop
  // the bare symbols so "%" or "$" alone does not sit there as an error.
  if (body === "") return negative ? "-" : "";
  return `${hasPrefix ? prefix : ""}${negative ? "-" : ""}${body}${hasSuffix ? suffix : ""}`;
}

/** Digits and the decimal point: what survives reformatting. */
function significantCount(s: string): number {
  return s.replace(/[^0-9.]/g, "").length;
}

/**
 * Caret position in `formatted` after `formatGroupedInput(rawInput)`.
 *
 * Formats the text LEFT of the caret with the same rules and counts the
 * digits and point it keeps, then finds that many in the result. Formatting
 * the prefix (rather than counting raw digits) means characters the
 * formatter drops — a second dot, a letter, a pasted comma — do not push the
 * caret too far right.
 */
export function groupedCaretPosition(
  rawInput: string,
  rawCaret: number,
  formatted: string,
  opts: GroupedInputOptions
): number {
  if (rawCaret <= 0) return 0;
  if (rawCaret >= rawInput.length) return formatted.length;

  const wanted = significantCount(formatGroupedInput(rawInput.slice(0, rawCaret), opts));
  if (wanted === 0) {
    // Only symbols to the left: sit just before the first digit.
    const first = formatted.search(/[0-9.]/);
    return first === -1 ? formatted.length : first;
  }

  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[0-9.]/.test(formatted[i])) {
      seen += 1;
      if (seen === wanted) return i + 1;
    }
  }
  return formatted.length;
}
