import { describe, it, expect } from "vitest";
import {
  DIAL_CODES,
  DEFAULT_COUNTRY,
  findCountry,
  flagEmoji,
  findDialCode,
  phoneDigitCount,
  normaliseNationalNumber,
  normalisePhone,
  isPlausiblePhone,
  describeNationalNumberProblem,
  composeE164,
} from "./phone";

describe("DIAL_CODES", () => {
  it("has no duplicate ISO codes", () => {
    const isos = DIAL_CODES.map((entry) => entry.iso);
    expect(new Set(isos).size).toBe(isos.length);
  });

  it("holds two-letter uppercase ISO codes", () => {
    for (const entry of DIAL_CODES) {
      expect(entry.iso, entry.country).toMatch(/^[A-Z]{2}$/);
    }
  });

  /**
   * DIALLING CODES ARE NOT UNIQUE and must not be treated as the identity of
   * an entry. The US and Canada share +1 and need separate rows so each can
   * show its own flag.
   */
  it("lists the US and Canada separately on the shared +1 code", () => {
    const plusOne = DIAL_CODES.filter((entry) => entry.code === "1");
    expect(plusOne.map((entry) => entry.iso).sort()).toEqual(["CA", "US"]);
    // Identical rules, which is why lookup by code alone is still safe.
    for (const entry of plusOne) {
      expect(entry.min).toBe(10);
      expect(entry.max).toBe(10);
    }
  });

  it("holds digits only, with no plus", () => {
    for (const entry of DIAL_CODES) {
      expect(entry.code, entry.country).toMatch(/^\d+$/);
    }
  });

  it("has a sane range for every country", () => {
    for (const entry of DIAL_CODES) {
      expect(entry.min, entry.country).toBeGreaterThan(0);
      expect(entry.max, entry.country).toBeGreaterThanOrEqual(entry.min);
      // Code plus national number must still fit E.164's 15-digit ceiling.
      expect(entry.code.length + entry.max, entry.country).toBeLessThanOrEqual(15);
    }
  });

  it("is ordered alphabetically so the dropdown is scannable", () => {
    const countries = DIAL_CODES.map((entry) => entry.country);
    expect(countries).toEqual([...countries].sort((a, b) => a.localeCompare(b)));
  });

  it("offers the default country", () => {
    expect(findCountry(DEFAULT_COUNTRY)).not.toBeNull();
  });

  /** The lengths the user explicitly asked about. */
  it("requires exactly 10 digits for +1", () => {
    const us = findDialCode("1");
    expect(us?.min).toBe(10);
    expect(us?.max).toBe(10);
  });

  /**
   * The form renders "+1 United States / Canada" by concatenating the two
   * fields, so a code embedded in the country name would print twice.
   */
  it("keeps the dialling code out of the country name", () => {
    for (const entry of DIAL_CODES) {
      expect(entry.country, entry.country).not.toContain("+");
      expect(entry.country, entry.country).not.toMatch(/\d/);
    }
  });

  it("gives every country a flag", () => {
    for (const entry of DIAL_CODES) {
      // Two regional indicator symbols, each outside the BMP.
      expect([...flagEmoji(entry.iso)].length, entry.country).toBe(2);
    }
  });
});

describe("flagEmoji", () => {
  it("derives the flag from the ISO letters", () => {
    expect(flagEmoji("US")).toBe("\u{1F1FA}\u{1F1F8}");
    expect(flagEmoji("GB")).toBe("\u{1F1EC}\u{1F1E7}");
    expect(flagEmoji("IN")).toBe("\u{1F1EE}\u{1F1F3}");
  });

  it("accepts lowercase and padded input", () => {
    expect(flagEmoji("us")).toBe(flagEmoji("US"));
    expect(flagEmoji(" gb ")).toBe(flagEmoji("GB"));
  });

  /** A bad value must render nothing rather than stray glyphs. */
  it("returns empty for anything that is not two letters", () => {
    expect(flagEmoji("")).toBe("");
    expect(flagEmoji(null)).toBe("");
    expect(flagEmoji(undefined)).toBe("");
    expect(flagEmoji("USA")).toBe("");
    expect(flagEmoji("U1")).toBe("");
    expect(flagEmoji("1")).toBe("");
  });
});

describe("findCountry", () => {
  it("finds a listed country by ISO", () => {
    expect(findCountry("GB")?.code).toBe("44");
    expect(findCountry("CA")?.code).toBe("1");
    expect(findCountry("US")?.code).toBe("1");
  });

  it("is case-insensitive and tolerates padding", () => {
    expect(findCountry("gb")?.code).toBe("44");
    expect(findCountry(" us ")?.code).toBe("1");
  });

  it("returns null for anything unlisted", () => {
    expect(findCountry("ZZ")).toBeNull();
    expect(findCountry("")).toBeNull();
    expect(findCountry(null)).toBeNull();
  });
});

describe("findDialCode", () => {
  it("finds a listed code", () => {
    expect(findDialCode("44")?.country).toContain("United Kingdom");
    expect(findDialCode("353")?.country).toContain("Ireland");
  });

  it("tolerates a plus or spaces on the way in", () => {
    expect(findDialCode("+44")?.code).toBe("44");
    expect(findDialCode(" 44 ")?.code).toBe("44");
  });

  it("returns null for an unlisted or empty code", () => {
    expect(findDialCode("999")).toBeNull();
    expect(findDialCode("")).toBeNull();
    expect(findDialCode(null)).toBeNull();
    expect(findDialCode(undefined)).toBeNull();
  });
});

describe("normaliseNationalNumber", () => {
  it("keeps the digits and drops the decoration", () => {
    expect(normaliseNationalNumber("(555) 123-4567")).toBe("5551234567");
    expect(normaliseNationalNumber("555.123.4567")).toBe("5551234567");
    expect(normaliseNationalNumber("7946 0958")).toBe("79460958");
  });

  /**
   * THE REASON THIS FUNCTION EXISTS. People type the trunk prefix out of
   * habit, and it is not part of the international number — keeping it both
   * fails the length check and produces an undialable +44020... value.
   */
  it("strips one leading trunk zero", () => {
    expect(normaliseNationalNumber("020 7946 0958")).toBe("2079460958");
    expect(normaliseNationalNumber("0412 345 678")).toBe("412345678");
  });

  it("strips only ONE zero, never guesses further", () => {
    // A second zero is a real digit, not a prefix. Eating digits until the
    // length happens to fit would be invention.
    expect(normaliseNationalNumber("0020 7946 0958")).toBe("02079460958");
    expect(normaliseNationalNumber("00123")).toBe("0123");
  });

  it("returns empty for nothing usable", () => {
    expect(normaliseNationalNumber("")).toBe("");
    expect(normaliseNationalNumber(null)).toBe("");
    expect(normaliseNationalNumber(undefined)).toBe("");
    expect(normaliseNationalNumber("call me")).toBe("");
  });
});

describe("normalisePhone", () => {
  it("keeps a single leading plus", () => {
    expect(normalisePhone("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalisePhone("++15551234567")).toBe("+15551234567");
  });

  it("drops a plus that is not at the start", () => {
    expect(normalisePhone("555+1234567")).toBe("5551234567");
  });

  it("returns empty for nothing usable", () => {
    expect(normalisePhone("")).toBe("");
    expect(normalisePhone("+")).toBe("");
    expect(normalisePhone(null)).toBe("");
  });

  it("is idempotent", () => {
    const once = normalisePhone("+44 20 7946 0958");
    expect(normalisePhone(once)).toBe(once);
  });
});

describe("phoneDigitCount", () => {
  it("counts only digits", () => {
    expect(phoneDigitCount("+1 (555) 123-4567")).toBe(11);
    expect(phoneDigitCount("555-CALL")).toBe(3);
    expect(phoneDigitCount(null)).toBe(0);
  });
});

describe("describeNationalNumberProblem", () => {
  it("accepts a correct number for each listed country", () => {
    const samples: [string, string][] = [
      ["1", "555 123 4567"],        // 10
      ["44", "020 7946 0958"],      // 10 after the trunk zero
      ["44", "7946 0958 1"],        // 9, a shorter landline
      ["353", "87 123 4567"],       // 9
      ["61", "0412 345 678"],       // 9 after the trunk zero
      ["91", "98765 43210"],        // 10
      ["65", "9123 4567"],          // 8
      ["49", "30 123456"],          // 8, inside Germany's 6-11
      ["86", "138 0013 8000"],      // 11
    ];

    for (const [code, number] of samples) {
      expect(
        describeNationalNumberProblem(code, number),
        `+${code} ${number}`
      ).toBeNull();
    }
  });

  it("asks for a number when the field is empty", () => {
    expect(describeNationalNumberProblem("1", "")).toBe(
      "Please enter your phone number."
    );
    expect(describeNationalNumberProblem("1", "no digits")).toBe(
      "Please enter your phone number."
    );
    expect(describeNationalNumberProblem("1", null)).toBe(
      "Please enter your phone number."
    );
  });

  /** The 10-digit rule, stated plainly in the message. */
  it("rejects a +1 number that is not 10 digits", () => {
    expect(describeNationalNumberProblem("1", "555 123 456")).toBe(
      "A +1 number needs 10 digits. You entered 9."
    );
    expect(describeNationalNumberProblem("1", "555 123 45678")).toBe(
      "A +1 number needs 10 digits. You entered 11."
    );
  });

  it("names a range when the country has one", () => {
    const problem = describeNationalNumberProblem("44", "7946");
    expect(problem).toBe("A +44 number needs 9 to 10 digits. You entered 4.");
  });

  it("reports the count it actually received", () => {
    expect(describeNationalNumberProblem("61", "412 345")).toContain(
      "You entered 6."
    );
  });

  /**
   * A listed country must not be judged by the fallback range, and an unlisted
   * one must not be refused outright.
   */
  it("falls back to the E.164 range for an unlisted code", () => {
    expect(describeNationalNumberProblem("999", "1234567")).toBeNull();
    expect(describeNationalNumberProblem("999", "123456789012345")).toBeNull();
    expect(describeNationalNumberProblem("999", "12345")).toContain("5 digits");
    expect(describeNationalNumberProblem("999", "1234567890123456")).toContain(
      "16 digits"
    );
  });

  it("still enforces the country rule when it is stricter than the fallback", () => {
    // 8 digits would pass the 7-15 fallback but not the US rule.
    expect(describeNationalNumberProblem("1", "12345678")).not.toBeNull();
  });

  it("never calls a number invalid", () => {
    for (const [code, number] of [["1", "123"], ["44", "1"], ["999", "1"]]) {
      expect(
        describeNationalNumberProblem(code, number)?.toLowerCase()
      ).not.toContain("invalid");
    }
  });
});

describe("composeE164", () => {
  it("joins the code and the national number", () => {
    expect(composeE164("1", "555 123 4567")).toBe("+15551234567");
    expect(composeE164("353", "87 123 4567")).toBe("+353871234567");
  });

  /** The trunk zero must not survive into the stored value. */
  it("drops the trunk prefix", () => {
    expect(composeE164("44", "020 7946 0958")).toBe("+442079460958");
    expect(composeE164("61", "0412 345 678")).toBe("+61412345678");
  });

  it("tolerates a plus already on the code", () => {
    expect(composeE164("+44", "20 7946 0958")).toBe("+442079460958");
  });

  it("returns empty rather than half a number", () => {
    expect(composeE164("1", "")).toBe("");
    expect(composeE164("", "5551234567")).toBe("");
    expect(composeE164(null, null)).toBe("");
    expect(composeE164("1", "no digits")).toBe("");
  });

  it("produces a value that passes the plausibility check", () => {
    for (const [code, number] of [
      ["1", "5551234567"],
      ["44", "020 7946 0958"],
      ["65", "9123 4567"],
    ]) {
      expect(isPlausiblePhone(composeE164(code, number))).toBe(true);
    }
  });

  it("is stable when fed its own output's parts", () => {
    const first = composeE164("44", "020 7946 0958");
    expect(composeE164("44", first.replace("+44", ""))).toBe(first);
  });
});

describe("isPlausiblePhone", () => {
  it("accepts composed international numbers", () => {
    expect(isPlausiblePhone("+15551234567")).toBe(true);
    expect(isPlausiblePhone("+442079460958")).toBe(true);
  });

  it("rejects empty, short and over-long values", () => {
    expect(isPlausiblePhone("")).toBe(false);
    expect(isPlausiblePhone(null)).toBe(false);
    expect(isPlausiblePhone("+123456")).toBe(false);
    expect(isPlausiblePhone("+1234567890123456")).toBe(false);
  });
});
