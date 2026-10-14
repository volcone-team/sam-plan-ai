/**
 * Phone numbers: a dialling code, a national number, and one canonical string.
 *
 * TWO FIELDS, ONE STORED VALUE. The form asks for the country code and the
 * national number separately, and `composeE164` joins them into the single
 * `+15551234567` that goes in `profiles.phone`. The split is a UI concern — the
 * database wants one dialable string, not two columns to keep in step.
 *
 * WHY THE SPLIT EARNS ITS KEEP. In a single field there is no way to tell
 * whether a leading 1 is a country code or an area code, whether a leading 0 is
 * a UK trunk prefix or a real digit, or how many digits the number ought to
 * have. That ambiguity is why the first version of this file refused to check
 * length at all. Once the code is its own field the national number has a
 * predictable length and a real check becomes possible: exactly 10 digits after
 * +1, exactly 9 after +61, and so on.
 *
 * A RANGE PER COUNTRY, NOT ONE GLOBAL RULE. `min`/`max` rather than a single
 * number, because several countries genuinely vary — German national numbers
 * run from 6 to 11 digits and a fixed length would reject most of them. Where a
 * country really is fixed, min and max are equal and the error message says
 * "needs 10 digits" rather than a vague range.
 *
 * AN UNLISTED COUNTRY IS ACCEPTED, not rejected. The table below is the common
 * markets, not every country on earth. Anything else falls back to E.164's own
 * bounds of 7 to 15 digits, because turning away a real customer from an
 * unlisted country is far worse than accepting a number we cannot length-check.
 *
 * NOT A VALIDATOR OF REALITY. None of this confirms a number exists or is
 * reachable; that needs a carrier lookup. It catches typos and half-finished
 * entries, which are the mistakes that actually happen.
 *
 * No React, no database.
 */

/**
 * E.164's own limits, used for any country not in the table.
 *
 * 15 is the standard's hard maximum for a full international number. The lower
 * bound is judgement: the shortest national numbers in use are around seven
 * digits, and below that it is certainly incomplete.
 */
const FALLBACK_MIN_DIGITS = 7;
const FALLBACK_MAX_DIGITS = 15;

export interface DialCode {
  /**
   * ISO 3166-1 alpha-2, uppercase. The IDENTITY of an entry.
   *
   * Selection is keyed on this rather than on the dialling code, because a
   * code is not unique: the US and Canada both use +1, and they need separate
   * rows so each can show its own flag. The flag is derived from these two
   * letters, so it is not stored anywhere.
   */
  iso: string;
  /** Digits only, no plus. `"1"`, `"44"`, `"353"`. */
  code: string;
  /**
   * Country name on its own, WITHOUT the code or flag appended.
   *
   * Kept as a bare name so each surface can compose its own presentation: the
   * open dropdown shows flag, country and code together, while the collapsed
   * control shows only the flag and code. Baking any of that into this string
   * would force one fixed arrangement on both.
   */
  country: string;
  /** National significant number length, excluding any trunk prefix. */
  min: number;
  max: number;
}

/**
 * Dialling codes offered on the form.
 *
 * Lengths are NATIONAL SIGNIFICANT NUMBER lengths — what remains after the
 * country code and after any trunk prefix is stripped. A London number written
 * `020 7946 0958` is 10 significant digits (`20 7946 0958`), not 11, which is
 * why `normaliseNationalNumber` removes the leading zero before counting.
 *
 * Ordered alphabetically by country so the dropdown is scannable. The default is
 * applied separately, not by position here.
 */
export const DIAL_CODES: readonly DialCode[] = [
  { iso: "AU", code: "61", country: "Australia", min: 9, max: 9 },
  { iso: "AT", code: "43", country: "Austria", min: 7, max: 13 },
  { iso: "BE", code: "32", country: "Belgium", min: 8, max: 9 },
  { iso: "BR", code: "55", country: "Brazil", min: 10, max: 11 },
  { iso: "CA", code: "1", country: "Canada", min: 10, max: 10 },
  { iso: "CL", code: "56", country: "Chile", min: 9, max: 9 },
  { iso: "CN", code: "86", country: "China", min: 10, max: 11 },
  { iso: "CO", code: "57", country: "Colombia", min: 10, max: 10 },
  { iso: "CZ", code: "420", country: "Czechia", min: 9, max: 9 },
  { iso: "DK", code: "45", country: "Denmark", min: 8, max: 8 },
  { iso: "EG", code: "20", country: "Egypt", min: 9, max: 10 },
  { iso: "FI", code: "358", country: "Finland", min: 6, max: 12 },
  { iso: "FR", code: "33", country: "France", min: 9, max: 9 },
  // Genuinely 6 to 11. A fixed length here would reject most German numbers.
  { iso: "DE", code: "49", country: "Germany", min: 6, max: 11 },
  { iso: "GR", code: "30", country: "Greece", min: 10, max: 10 },
  { iso: "HK", code: "852", country: "Hong Kong", min: 8, max: 8 },
  { iso: "HU", code: "36", country: "Hungary", min: 8, max: 9 },
  { iso: "IN", code: "91", country: "India", min: 10, max: 10 },
  { iso: "ID", code: "62", country: "Indonesia", min: 9, max: 12 },
  { iso: "IE", code: "353", country: "Ireland", min: 7, max: 9 },
  { iso: "IL", code: "972", country: "Israel", min: 9, max: 9 },
  { iso: "IT", code: "39", country: "Italy", min: 9, max: 11 },
  { iso: "JP", code: "81", country: "Japan", min: 9, max: 10 },
  { iso: "KE", code: "254", country: "Kenya", min: 9, max: 9 },
  { iso: "MY", code: "60", country: "Malaysia", min: 9, max: 10 },
  { iso: "MX", code: "52", country: "Mexico", min: 10, max: 10 },
  { iso: "MA", code: "212", country: "Morocco", min: 9, max: 9 },
  { iso: "NL", code: "31", country: "Netherlands", min: 9, max: 9 },
  { iso: "NZ", code: "64", country: "New Zealand", min: 8, max: 9 },
  { iso: "NG", code: "234", country: "Nigeria", min: 10, max: 10 },
  { iso: "NO", code: "47", country: "Norway", min: 8, max: 8 },
  { iso: "PH", code: "63", country: "Philippines", min: 10, max: 10 },
  { iso: "PL", code: "48", country: "Poland", min: 9, max: 9 },
  { iso: "PT", code: "351", country: "Portugal", min: 9, max: 9 },
  { iso: "RO", code: "40", country: "Romania", min: 9, max: 9 },
  { iso: "SA", code: "966", country: "Saudi Arabia", min: 9, max: 9 },
  { iso: "SG", code: "65", country: "Singapore", min: 8, max: 8 },
  { iso: "ZA", code: "27", country: "South Africa", min: 9, max: 9 },
  { iso: "KR", code: "82", country: "South Korea", min: 9, max: 10 },
  { iso: "ES", code: "34", country: "Spain", min: 9, max: 9 },
  { iso: "SE", code: "46", country: "Sweden", min: 7, max: 13 },
  { iso: "CH", code: "41", country: "Switzerland", min: 9, max: 9 },
  { iso: "TH", code: "66", country: "Thailand", min: 9, max: 9 },
  { iso: "TR", code: "90", country: "Turkey", min: 10, max: 10 },
  { iso: "AE", code: "971", country: "United Arab Emirates", min: 8, max: 9 },
  // Mobiles are 10 significant digits, some landlines 9.
  { iso: "GB", code: "44", country: "United Kingdom", min: 9, max: 10 },
  { iso: "US", code: "1", country: "United States", min: 10, max: 10 },
  { iso: "VN", code: "84", country: "Vietnam", min: 9, max: 10 },
];

/**
 * Pre-selected country.
 *
 * The US because it is the largest market for this product. A default is a
 * guess either way; the alternative — an empty "choose a country" option —
 * adds a required click for the majority to save one for the minority.
 */
export const DEFAULT_COUNTRY = "US";

const BY_ISO = new Map(DIAL_CODES.map((entry) => [entry.iso, entry]));

/**
 * Lookup by dialling code, FIRST MATCH WINS.
 *
 * +1 maps to two entries (Canada and the United States). Which one this
 * returns does not matter: it exists to length-check a number where only the
 * code is known — a value already stored, or one typed into a field with no
 * country attached — and the two share identical rules. Anything that needs to
 * know WHICH country was chosen should key on ISO via `findCountry`.
 */
const BY_CODE = new Map<string, DialCode>();
for (const entry of DIAL_CODES) {
  if (!BY_CODE.has(entry.code)) BY_CODE.set(entry.code, entry);
}

/** The entry for an ISO country code, or null if we do not list it. */
export function findCountry(iso: string | null | undefined): DialCode | null {
  if (!iso) return null;
  return BY_ISO.get(iso.trim().toUpperCase()) ?? null;
}

/**
 * The flag emoji for an ISO 3166-1 alpha-2 code.
 *
 * Built from REGIONAL INDICATOR SYMBOLS — "US" becomes U+1F1FA U+1F1F8 — so
 * there are no image assets, no icon dependency and nothing to keep in sync
 * with the country list.
 *
 * KNOWN LIMITATION, WINDOWS. Windows ships no country-flag glyphs in its
 * system fonts, so Chrome, Edge and Firefox on Windows render these as the two
 * letters instead ("US", "GB"). That is a legible fallback rather than a blank
 * box, and the code and country name are shown alongside regardless, so
 * nothing becomes unusable — but anyone on Windows will not see flags. Real
 * flags everywhere need an SVG set such as flag-icons, which is a dependency
 * and ~40kB of assets.
 *
 * Returns "" for anything that is not two ASCII letters, so a bad value
 * renders nothing rather than stray glyphs.
 */
export function flagEmoji(iso: string | null | undefined): string {
  if (!iso) return "";
  const letters = iso.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(letters)) return "";

  const REGIONAL_INDICATOR_A = 0x1f1e6;
  const A = "A".charCodeAt(0);

  return String.fromCodePoint(
    ...[...letters].map((c) => REGIONAL_INDICATOR_A + c.charCodeAt(0) - A)
  );
}

/** The table entry for a code, or null when it is not one we list. */
export function findDialCode(code: string | null | undefined): DialCode | null {
  if (!code) return null;
  return BY_CODE.get(code.replace(/\D/g, "")) ?? null;
}

/** How many actual digits a string contains. */
export function phoneDigitCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  return raw.replace(/\D/g, "").length;
}

/**
 * A typed national number, reduced to the digits that count.
 *
 * STRIPS ONE LEADING ZERO, which is the whole reason this function exists
 * rather than a bare regex. Outside North America people type their number
 * with the trunk prefix out of habit — `020 7946 0958`, `0412 345 678` — and
 * that zero is not part of the international number. Keeping it would both
 * fail the length check and produce `+44020...`, which cannot be dialled.
 *
 * Only ONE zero is removed. A second leading zero is not a trunk prefix, and
 * silently eating digits until the length happens to fit would be guessing.
 */
export function normaliseNationalNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("0") ? digits.slice(1) : digits;
}

/**
 * Strip a full number down to a storable form, keeping a single leading plus.
 *
 * Used by `composeE164` and by anything handling a number that already arrived
 * as one string. The plus is the one piece of punctuation carrying meaning: it
 * marks the number as international rather than national.
 */
export function normalisePhone(raw: string | null | undefined): string {
  if (!raw) return "";

  const trimmed = raw.trim();
  const international = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (!digits) return "";
  return international ? `+${digits}` : digits;
}

/**
 * Is a full international number plausible on length alone?
 *
 * The last-resort check, applied to a composed value and to countries absent
 * from the table. An empty value is NOT plausible.
 */
export function isPlausiblePhone(raw: string | null | undefined): boolean {
  const count = phoneDigitCount(raw);
  return count >= FALLBACK_MIN_DIGITS && count <= FALLBACK_MAX_DIGITS;
}

/**
 * What is wrong with this national number for this country, if anything.
 *
 * Returns null when it is acceptable. The message always states the expected
 * length AND the length received, because "invalid phone number" gives someone
 * staring at their own correct-looking number nothing to act on.
 *
 * Never uses the word "invalid": we are checking a digit count, not confirming
 * the number exists.
 */
export function describeNationalNumberProblem(
  code: string | null | undefined,
  raw: string | null | undefined
): string | null {
  const national = normaliseNationalNumber(raw);
  const count = national.length;

  if (count === 0) return "Please enter your phone number.";

  const entry = findDialCode(code);

  /**
   * Unlisted country: fall back to the E.164 range rather than refusing.
   *
   * Reachable only if the stored code is not in DIAL_CODES — a hand-edited
   * value, or a code removed from the table after someone had signed up with
   * it. Accepting is the right failure.
   */
  if (!entry) {
    if (count < FALLBACK_MIN_DIGITS || count > FALLBACK_MAX_DIGITS) {
      return `That phone number has ${count} digits. Please enter between ${FALLBACK_MIN_DIGITS} and ${FALLBACK_MAX_DIGITS}.`;
    }
    return null;
  }

  if (count >= entry.min && count <= entry.max) return null;

  const expected =
    entry.min === entry.max
      ? `${entry.min} digits`
      : `${entry.min} to ${entry.max} digits`;

  return `A +${entry.code} number needs ${expected}. You entered ${count}.`;
}

/**
 * The two fields joined into one storable value.
 *
 * `+` then the dialling code then the national number, with the trunk prefix
 * already removed — the form that every dialler, SMS gateway and export
 * expects.
 *
 * Returns "" when either half is missing, so a caller cannot accidentally
 * store a bare "+44" or a national number with no country.
 */
export function composeE164(
  code: string | null | undefined,
  nationalRaw: string | null | undefined
): string {
  const dial = (code ?? "").replace(/\D/g, "");
  const national = normaliseNationalNumber(nationalRaw);

  if (!dial || !national) return "";
  return normalisePhone(`+${dial}${national}`);
}
