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
