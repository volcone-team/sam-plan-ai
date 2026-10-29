import { describe, it, expect } from "vitest";
import {
  TAG_FOUNDER,
  TAG_ONBOARDING_PETE_BOOKED,
  TAG_ONBOARDING_RACHEL_BOOKED,
  TAG_ONBOARDING_CALL_BOOKED,
  TAG_LOGIN_TRIGGER,
  TAG_INACTIVE_90,
  TAG_INACTIVE_60,
  TAG_INACTIVE_30,
  TAG_FIRST_LOGIN,
  TAG_PLAN_GENERATED,
  TAG_FINISHED_INTAKE,
  TAG_CANCELLATION,
  TAG_REGISTERED_NOT_PAID,
  TAG_OPTED_DND,
  TAG_OPTED_COMMUNICATION,
  consentTagFor,
  FIXED_TAGS,
  MARKETING_SUPPRESSION_TAG,
  MARKETING_SUPPRESSION_TAG_AS_WRITTEN,
  BUYER_TAG_PREFIX,
  normaliseTagForCompare,
  tagsEqual,
  isAppOriginTag,
  isBuyerTag,
  normalisePlanNameForTag,
  toTagCycle,
  buyerTag,
  buyerTagsFor,
  buyerTagTransition,
  BUYER_STATES,
  TAG_CYCLES,
  type BuyerState,
  type TagCycle,
} from "./tags";

/**
 * The tag contract.
 *
 * These tests are not here to prove the functions compute something. They are
 * here because GHL accepts any string: writing a tag that does not exist
 * CREATES it, successfully, and the only symptom is a workflow that never
 * fires. There is no error to find afterwards, so the strings are pinned here
 * instead — character for character, against the list the client sent.
 */

/* ------------------------------------------------------------------ *
 * 1. The fixed tags, exactly as the client wrote them
 * ------------------------------------------------------------------ */

describe("the fixed tag constants", () => {
  it("are byte-for-byte the strings the client gave us", () => {
    expect(TAG_FOUNDER).toBe("sam plan ai app - founder");
    expect(TAG_ONBOARDING_PETE_BOOKED).toBe("sam plan ai onboarding - pete booked");
    expect(TAG_ONBOARDING_RACHEL_BOOKED).toBe("sam plan ai onboarding - rachel booked");
    expect(TAG_ONBOARDING_CALL_BOOKED).toBe("sam plan ai onboarding - call booked");
    expect(TAG_LOGIN_TRIGGER).toBe("sam plan ai app - login trigger");
    expect(TAG_INACTIVE_90).toBe("sam plan ai app - haven\u2019t logged \u2013 90 days+");
    expect(TAG_INACTIVE_60).toBe("sam plan ai app - haven\u2019t logged \u2013 60 days");
    expect(TAG_INACTIVE_30).toBe("sam plan ai app - haven\u2019t logged \u2013 30 days");
    expect(TAG_FIRST_LOGIN).toBe("sam plan ai app - first login");
    expect(TAG_PLAN_GENERATED).toBe("sam plan ai app - plan generated");
    expect(TAG_FINISHED_INTAKE).toBe("sam plan ai app - finished intake");
    expect(TAG_CANCELLATION).toBe("sam plan ai app - cancellation");
  });

  it("carry no stray whitespace, so normalising is a no-op on all of them", () => {
    // If a constant ever acquires a leading space or a double space, equality
    // against the client's live tag still passes through normaliseTagForCompare
    // but the string we WRITE to GHL is the raw one — and that creates a new
    // tag. The raw form has to be clean, not merely normalisable.
    for (const tag of FIXED_TAGS) {
      expect(normaliseTagForCompare(tag)).toBe(tag);
    }
  });

  it("are all lowercase, because GHL lowercases on write and we compare on read", () => {
    for (const tag of FIXED_TAGS) {
      expect(tag).toBe(tag.toLowerCase());
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2. The non-ASCII characters in the three inactivity tags
 * ------------------------------------------------------------------ */

/**
 * The most important block in this file.
 *
 * The three inactivity tags contain two characters a keyboard does not
 * produce: U+2019 RIGHT SINGLE QUOTATION MARK in "haven’t", and U+2013 EN DASH
 * as the separator before the day count. Both are the client's; both already
 * exist in their account; both are load-bearing.
 *
 * Swap either for its ASCII lookalike and nothing fails. GHL creates a second,
 * near-identical tag, no workflow is attached to it, and the win-back email
 * silently never sends to anyone the app tagged. The assertions below are
 * written on code points rather than whole strings so that when one of these
 * does get mangled — by an editor autocorrect, a smart-quotes setting, a
 * copy-paste through a tool that normalises punctuation — the failure message
 * names the character instead of printing two strings that look identical.
 */
describe("the inactivity tags' exact code points", () => {
  const inactivityTags: ReadonlyArray<[string, string]> = [
    ["90", TAG_INACTIVE_90],
    ["60", TAG_INACTIVE_60],
    ["30", TAG_INACTIVE_30],
  ];

  describe.each(inactivityTags)("the %s-day tag", (_label, tag) => {
    it("uses U+2019 for the apostrophe in haven’t, never U+0027", () => {
      expect(tag.includes("\u2019")).toBe(true);
      expect(tag.includes("'")).toBe(false);

      // Positional, so the failure says which character is wrong rather than
      // just that one is missing: "haven" + 5 is the apostrophe slot.
      const apostropheIndex = tag.indexOf("haven") + "haven".length;
      expect(tag.codePointAt(apostropheIndex)).toBe(0x2019);
      expect(tag.codePointAt(apostropheIndex)).not.toBe(0x27);
    });

    it("uses U+2013 as the separator before the day count", () => {
      expect(tag.includes("\u2013")).toBe(true);
      expect(tag.includes(" \u2013 ")).toBe(true);

      const enDashIndex = tag.indexOf("\u2013");
      expect(tag.codePointAt(enDashIndex)).toBe(0x2013);
    });

    it("still contains an ASCII hyphen EARLIER in the same string", () => {
      // The inconsistency is deliberate and is the client's: "app - " uses an
      // ASCII hyphen, " – 90 days" uses an en dash, in one tag. A well-meaning
      // tidy-up in either direction renames the tag and orphans the workflow,
      // so both characters are asserted together, in order.
      const hyphenIndex = tag.indexOf("-");
      const enDashIndex = tag.indexOf("\u2013");

      expect(hyphenIndex).toBeGreaterThan(-1);
      expect(tag.codePointAt(hyphenIndex)).toBe(0x2d);
      expect(hyphenIndex).toBeLessThan(enDashIndex);
      expect(tag).toContain("app - haven");
    });

    it("contains no other non-ASCII characters beyond those two", () => {
      // Guards against an invisible passenger — a non-breaking space or a
      // zero-width joiner picked up in transit — which would be undetectable
      // by eye and would also create a new tag.
      const unexpected = [...tag].filter(
        (ch) => ch.codePointAt(0)! > 0x7f && ch !== "\u2019" && ch !== "\u2013"
      );
      expect(unexpected).toEqual([]);
    });
  });

  it("differ from each other only in the day count", () => {
    const strip = (tag: string) => tag.replace(/\d+/g, "N");
    expect(strip(TAG_INACTIVE_60)).toBe(strip(TAG_INACTIVE_30));
    // The 90-day tag is the odd one: it alone ends in "days+".
    expect(TAG_INACTIVE_90.endsWith("90 days+")).toBe(true);
    expect(TAG_INACTIVE_60.endsWith("60 days")).toBe(true);
    expect(TAG_INACTIVE_30.endsWith("30 days")).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 3. FIXED_TAGS
 * ------------------------------------------------------------------ */

describe("FIXED_TAGS", () => {
  it("lists all fifteen tags in the client's order", () => {
    expect(FIXED_TAGS).toEqual([
      "sam plan ai app - founder",
      "sam plan ai onboarding - pete booked",
      "sam plan ai onboarding - rachel booked",
      "sam plan ai onboarding - call booked",
      "sam plan ai app - login trigger",
      "sam plan ai app - haven\u2019t logged \u2013 90 days+",
      "sam plan ai app - haven\u2019t logged \u2013 60 days",
      "sam plan ai app - haven\u2019t logged \u2013 30 days",
      "sam plan ai app - first login",
      "sam plan ai app - plan generated",
      "sam plan ai app - finished intake",
      "sam plan ai app - cancellation",
      "sam plan ai app - registered - not - paid",
      "sam plan ai app - buyer - opted - dnd",
      "sam plan ai app - buyer - opted - communication",
    ]);
    expect(FIXED_TAGS).toHaveLength(15);
  });

  it("contains no duplicates, even after normalising", () => {
    // A duplicate would be harmless in GHL but would double every entry in the
    // admin screen's "wire these up" list and in the cleanup's remove set.
    const normalised = FIXED_TAGS.map(normaliseTagForCompare);
    expect(new Set(normalised).size).toBe(FIXED_TAGS.length);
  });

  it("is frozen, and mutating it throws rather than silently succeeding", () => {
    expect(Object.isFrozen(FIXED_TAGS)).toBe(true);
    // This module is ESM, so the test file runs in strict mode and a write to
    // a frozen array is a TypeError rather than a no-op. Asserted as a throw
    // because that is the actual behaviour callers will see; if the module ever
    // ships as non-strict CJS this flips to silent and the test tells us.
    expect(() => {
      (FIXED_TAGS as string[]).push("sam plan ai app - invented");
    }).toThrow(TypeError);
    expect(() => {
      (FIXED_TAGS as string[])[0] = "clobbered";
    }).toThrow(TypeError);
    expect(FIXED_TAGS).toHaveLength(15);
    expect(FIXED_TAGS[0]).toBe(TAG_FOUNDER);
  });

  it("does not contain the marketing suppression tag or any buyer tag", () => {
    expect(FIXED_TAGS).not.toContain(MARKETING_SUPPRESSION_TAG);
    for (const tag of FIXED_TAGS) {
      expect(isBuyerTag(tag)).toBe(false);
    }
  });

  it("freezes the state and cycle vocabularies too", () => {
    expect(Object.isFrozen(BUYER_STATES)).toBe(true);
    expect(Object.isFrozen(TAG_CYCLES)).toBe(true);
    expect(BUYER_STATES).toEqual(["active", "inactive"]);
    expect(TAG_CYCLES).toEqual(["monthly", "yearly"]);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Comparison helpers
 * ------------------------------------------------------------------ */

describe("normaliseTagForCompare", () => {
  it("folds case, because GHL lowercases tags on write", () => {
    expect(normaliseTagForCompare("Sam Plan AI App - Founder")).toBe(TAG_FOUNDER);
    expect(normaliseTagForCompare("SAM PLAN AI APP - FOUNDER")).toBe(TAG_FOUNDER);
  });

  it("trims and collapses whitespace", () => {
    expect(normaliseTagForCompare("  sam plan ai app - founder  ")).toBe(TAG_FOUNDER);
    expect(normaliseTagForCompare("sam  plan   ai app -  founder")).toBe(TAG_FOUNDER);
    expect(normaliseTagForCompare("sam plan ai app -\tfounder")).toBe(TAG_FOUNDER);
    expect(normaliseTagForCompare("sam plan ai app -\nfounder")).toBe(TAG_FOUNDER);
  });

  it.each([null, undefined, 42, {}, [], true, Symbol("x")])(
    "returns empty string for non-string input (%o)",
    (value) => {
      expect(normaliseTagForCompare(value)).toBe("");
    }
  );

  it("returns empty string for a string with nothing in it", () => {
    expect(normaliseTagForCompare("")).toBe("");
    expect(normaliseTagForCompare("   ")).toBe("");
  });

  it("does NOT fold punctuation, which is the entire point", () => {
    // Folding \u2019 to ' here would make the ASCII-typed lookalike compare
    // equal to the real tag. They are two different tags in GHL, and treating
    // them as one would mean the cleanup "recognises" a tag it never set and
    // the real one never gets added.
    const asciiLookalike = "sam plan ai app - haven't logged - 90 days+";
    expect(normaliseTagForCompare(asciiLookalike)).not.toBe(
      normaliseTagForCompare(TAG_INACTIVE_90)
    );
  });
});

describe("tagsEqual", () => {
  it("matches the same tag written with different case and spacing", () => {
    expect(tagsEqual(TAG_FOUNDER, "  SAM Plan AI App  -  Founder ")).toBe(true);
    expect(tagsEqual(TAG_PLAN_GENERATED, "Sam Plan Ai App - Plan Generated")).toBe(true);
  });

  it("does not match different tags", () => {
    expect(tagsEqual(TAG_FIRST_LOGIN, TAG_LOGIN_TRIGGER)).toBe(false);
    expect(tagsEqual(TAG_INACTIVE_60, TAG_INACTIVE_30)).toBe(false);
  });

  it("treats the ASCII-apostrophe form of an inactivity tag as a DIFFERENT tag", () => {
    // Deliberate. These are two distinct tags in the client's account and must
    // never be conflated — see normaliseTagForCompare above.
    expect(tagsEqual(TAG_INACTIVE_90, "sam plan ai app - haven't logged \u2013 90 days+")).toBe(
      false
    );
    expect(tagsEqual(TAG_INACTIVE_90, "sam plan ai app - haven\u2019t logged - 90 days+")).toBe(
      false
    );
  });

  it("never reports two empties as equal", () => {
    // Otherwise `tagsEqual(contactTag, ourTag)` would return true whenever both
    // sides were junk, and the cleanup would think it had a match.
    expect(tagsEqual("", "")).toBe(false);
    expect(tagsEqual(null, undefined)).toBe(false);
    expect(tagsEqual("   ", "")).toBe(false);
    expect(tagsEqual(null, TAG_FOUNDER)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 5. Ownership: isAppOriginTag / isBuyerTag
 * ------------------------------------------------------------------ */

describe("isAppOriginTag", () => {
  it("claims every fixed tag", () => {
    for (const tag of FIXED_TAGS) {
      expect(isAppOriginTag(tag)).toBe(true);
    }
  });

  it("claims a fixed tag read back in any casing or spacing", () => {
    expect(isAppOriginTag("Sam Plan AI App - Founder")).toBe(true);
    expect(isAppOriginTag("  sam plan ai app -  cancellation  ")).toBe(true);
  });

  it("claims buyer tags, including for plans it has never heard of", () => {
    // A renamed or deleted plan leaves its old tags on the contact. If we
    // disowned them the contact would hold two buyer tags forever and get two
    // lifecycle emails.
    expect(isAppOriginTag("sam plan ai app - buyer - active - pro monthly")).toBe(true);
    expect(isAppOriginTag("sam plan ai app - buyer - inactive - legacy founders yearly")).toBe(
      true
    );
    expect(isAppOriginTag("sam plan ai app - buyer - whatever this is")).toBe(true);
  });

  it("disowns the marketing suppression tag", () => {
    // It lives in the client's marketing sub-accounts and keeps their nurture
    // sequences off our paying customers. Sweeping it up would start spamming
    // every subscriber with promos for a product they already own.
    expect(isAppOriginTag(MARKETING_SUPPRESSION_TAG)).toBe(false);
    expect(isAppOriginTag(MARKETING_SUPPRESSION_TAG_AS_WRITTEN)).toBe(false);
  });

  it("disowns a plausible-but-foreign tag that merely starts the same way", () => {
    // Membership, not prefix. The contact's tag list is shared with the
    // client's marketing team: a tag they made by hand that happens to begin
    // "sam plan ai app - " is theirs, and prefix matching here would let our
    // cleanup delete it and destroy their segmentation.
    expect(isAppOriginTag("sam plan ai app - webinar attendee")).toBe(false);
    expect(isAppOriginTag("sam plan ai app - vip")).toBe(false);
    expect(isAppOriginTag("sam plan ai onboarding - no show")).toBe(false);
    // Including the near-miss lookalikes of our own tags.
    expect(isAppOriginTag("sam plan ai app - haven't logged - 90 days+")).toBe(false);
    expect(isAppOriginTag("sam plan ai app - first logins")).toBe(false);
  });

  it("disowns a bare prefix with nothing after it", () => {
    expect(isAppOriginTag("sam plan ai app - ")).toBe(false);
    expect(isAppOriginTag("sam plan ai app -")).toBe(false);
    expect(isAppOriginTag(BUYER_TAG_PREFIX)).toBe(false);
    expect(isAppOriginTag(BUYER_TAG_PREFIX.trim())).toBe(false);
  });

  it.each([null, undefined, "", "   ", 0, 1, {}, [], true, "webinar attendee"])(
    "disowns junk (%o)",
    (value) => {
      expect(isAppOriginTag(value)).toBe(false);
    }
  );
});

describe("isBuyerTag", () => {
  it("matches any plan name after the prefix", () => {
    expect(isBuyerTag("sam plan ai app - buyer - active - pro monthly")).toBe(true);
    expect(isBuyerTag("SAM Plan AI App - Buyer - Inactive - Starter Yearly")).toBe(true);
    expect(isBuyerTag("sam plan ai app - buyer - active - 10x stages monthly")).toBe(true);
  });

  it("requires something after the prefix", () => {
    expect(isBuyerTag(BUYER_TAG_PREFIX)).toBe(false);
    expect(isBuyerTag("sam plan ai app - buyer -")).toBe(false);
    expect(isBuyerTag("sam plan ai app - buyer")).toBe(false);
  });

  it("does not match the fixed tags or foreign tags", () => {
    expect(isBuyerTag(TAG_FOUNDER)).toBe(false);
    expect(isBuyerTag("sam plan ai app - webinar attendee")).toBe(false);
    expect(isBuyerTag(MARKETING_SUPPRESSION_TAG)).toBe(false);
  });

  it.each([null, undefined, "", 42, {}, []])("rejects junk (%o)", (value) => {
    expect(isBuyerTag(value)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 6. buyerTag
 * ------------------------------------------------------------------ */

describe("buyerTag", () => {
  it("produces the client's live tags, character for character", () => {
    const expected: ReadonlyArray<[string, string, BuyerState, string]> = [
      ["Pro", "monthly", "active", "sam plan ai app - buyer - active - pro monthly"],
      ["Pro", "yearly", "active", "sam plan ai app - buyer - active - pro yearly"],
      ["Pro", "monthly", "inactive", "sam plan ai app - buyer - inactive - pro monthly"],
      ["Pro", "yearly", "inactive", "sam plan ai app - buyer - inactive - pro yearly"],
      ["Starter", "monthly", "active", "sam plan ai app - buyer - active - starter monthly"],
      ["Starter", "yearly", "active", "sam plan ai app - buyer - active - starter yearly"],
      ["Starter", "monthly", "inactive", "sam plan ai app - buyer - inactive - starter monthly"],
      ["Starter", "yearly", "inactive", "sam plan ai app - buyer - inactive - starter yearly"],
    ];

    for (const [planName, cycle, state, tag] of expected) {
      const result = buyerTag({ planName, cycle, state });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.tag).toBe(tag);
    }
    // All eight are distinct — the whole mutual-exclusion story rests on it.
    expect(new Set(expected.map(([, , , tag]) => tag)).size).toBe(8);
  });

  describe("the annual / yearly mismatch", () => {
    it("accepts the DATABASE's spelling and emits the TAG's", () => {
      // subscriptions.billing_cycle stores "annual"; the client's tags say
      // "yearly". Passing the column straight through would create
      // "... - pro annual", which GHL accepts and no workflow sees.
      const result = buyerTag({ planName: "Pro", cycle: "annual", state: "active" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.tag).toBe("sam plan ai app - buyer - active - pro yearly");
        expect(result.cycle).toBe("yearly");
      }
    });

    it("accepts the tag's own spelling too, and lands on the same tag", () => {
      const fromDb = buyerTag({ planName: "Pro", cycle: "annual", state: "active" });
      const fromTag = buyerTag({ planName: "Pro", cycle: "yearly", state: "active" });
      expect(fromDb.ok && fromTag.ok).toBe(true);
      if (fromDb.ok && fromTag.ok) expect(fromDb.tag).toBe(fromTag.tag);
    });

    it("never emits the word annual, whichever spelling went in", () => {
      for (const cycle of ["annual", "yearly", " Annual ", "YEARLY"]) {
        for (const state of BUYER_STATES) {
          const result = buyerTag({ planName: "Pro", cycle, state });
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.tag).not.toContain("annual");
            expect(result.tag).toContain("yearly");
          }
        }
      }
    });
  });

  describe("admin-typed plan names", () => {
    it.each([
      ["  Pro  ", "pro"],
      ["PRO", "pro"],
      ["Pro+", "pro"],
      ["Pro + Max", "pro max"],
      ["10X Stages", "10x stages"],
      ["Starter   Plan", "starter plan"],
      ["Pro—Annual", "pro annual"],
      ["Pro 🚀", "pro"],
    ])("normalises %o to %o", (planName, plan) => {
      const result = buyerTag({ planName, cycle: "monthly", state: "active" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.plan).toBe(plan);
        expect(result.tag).toBe(`${BUYER_TAG_PREFIX}active - ${plan} monthly`);
      }
    });

    it("strips rather than substitutes, so Pro+ is not pro-plus", () => {
      // The client's existing tags contain only letters, digits and spaces. A
      // substitution would invent a naming convention they have not agreed to
      // and nobody could retype in a GHL workflow.
      const result = buyerTag({ planName: "Pro+", cycle: "monthly", state: "active" });
      if (result.ok) {
        expect(result.plan).toBe("pro");
        expect(result.tag).not.toContain("+");
        expect(result.tag).not.toContain("plus");
        expect(result.tag).not.toContain("_");
      }
    });

    it("leaves no double space behind after stripping a middle character", () => {
      const result = buyerTag({ planName: "Pro + Max", cycle: "monthly", state: "active" });
      if (result.ok) expect(result.tag).not.toContain("  ");
    });
  });

  describe("refusals", () => {
    it.each([
      ["+++", "plan_name"],
      ["", "plan_name"],
      ["   ", "plan_name"],
      ["---", "plan_name"],
      ["日本語", "plan_name"],
      ["🚀", "plan_name"],
    ])("refuses plan name %o with error %s", (planName, error) => {
      const result = buyerTag({ planName, cycle: "monthly", state: "active" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
        expect(result.message).toBeTruthy();
      }
      // Never a string. A plausible-but-wrong tag is the failure mode this
      // whole module exists to prevent, so the refusal must not be smuggled
      // out as something a caller could accidentally send to GHL.
      expect(result).not.toHaveProperty("tag");
    });

    it.each([null, undefined, 42, {}, [], true])(
      "refuses a non-string plan name (%o)",
      (planName) => {
        const result = buyerTag({ planName, cycle: "monthly", state: "active" });
        expect(result).toMatchObject({ ok: false, error: "plan_name" });
      }
    );

    it.each(["", "quarterly", "annually", "year", "month", "ANNUALLYY", null, 1, {}])(
      "refuses cycle %o",
      (cycle) => {
        const result = buyerTag({ planName: "Pro", cycle, state: "active" });
        expect(result).toMatchObject({ ok: false, error: "cycle" });
        expect(result).not.toHaveProperty("tag");
      }
    );

    it.each(["", "trialing", "paused", "canceled", "Active ", null, 1, {}, true])(
      "refuses state %o",
      (state) => {
        const result = buyerTag({ planName: "Pro", cycle: "monthly", state });
        if (state === "Active ") {
          // Trimmed and lowercased, so this one is actually fine.
          expect(result.ok).toBe(true);
          return;
        }
        expect(result).toMatchObject({ ok: false, error: "state" });
        expect(result).not.toHaveProperty("tag");
      }
    );

    it("reports the plan name first when several inputs are bad", () => {
      // Stable error precedence: admins see one actionable message, and the
      // plan name is the only one of the three they can actually fix.
      const result = buyerTag({ planName: "+++", cycle: "quarterly", state: "paused" });
      expect(result).toMatchObject({ ok: false, error: "plan_name" });
    });

    it("refuses rather than throwing, because this runs in the Stripe webhook", () => {
      // A thrown error there costs us the event. A result object costs us a
      // log line.
      expect(() => buyerTag({ planName: null, cycle: null, state: null })).not.toThrow();
    });
  });

  it("every successful tag it builds is recognised as ours", () => {
    for (const state of BUYER_STATES) {
      for (const cycle of TAG_CYCLES) {
        const result = buyerTag({ planName: "Pro", cycle, state });
        if (result.ok) {
          expect(isBuyerTag(result.tag)).toBe(true);
          expect(isAppOriginTag(result.tag)).toBe(true);
        }
      }
    }
  });
});

describe("normalisePlanNameForTag", () => {
  it("returns null for anything with no letters or digits", () => {
    expect(normalisePlanNameForTag("+++")).toBeNull();
    expect(normalisePlanNameForTag("")).toBeNull();
    expect(normalisePlanNameForTag("   ")).toBeNull();
    expect(normalisePlanNameForTag(null)).toBeNull();
    expect(normalisePlanNameForTag(7)).toBeNull();
  });

  it("keeps letters, digits and single spaces only", () => {
    expect(normalisePlanNameForTag("10X Stages")).toBe("10x stages");
    expect(normalisePlanNameForTag("Pro/Max")).toBe("pro max");
  });
});

describe("toTagCycle", () => {
  it("maps both spellings of a year onto yearly", () => {
    expect(toTagCycle("annual")).toBe("yearly");
    expect(toTagCycle("yearly")).toBe("yearly");
    expect(toTagCycle(" ANNUAL ")).toBe("yearly");
  });

  it("passes monthly through", () => {
    expect(toTagCycle("monthly")).toBe("monthly");
    expect(toTagCycle("Monthly")).toBe("monthly");
  });

  it("returns null for anything else", () => {
    expect(toTagCycle("quarterly")).toBeNull();
    expect(toTagCycle("")).toBeNull();
    expect(toTagCycle(null)).toBeNull();
    expect(toTagCycle(12)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 7. buyerTagsFor
 * ------------------------------------------------------------------ */

describe("buyerTagsFor", () => {
  it("gives four tags per plan, in the client's order", () => {
    const { tags, plans, skipped } = buyerTagsFor(["Pro", "Starter"]);
    expect(tags).toEqual([
      "sam plan ai app - buyer - active - pro monthly",
      "sam plan ai app - buyer - active - pro yearly",
      "sam plan ai app - buyer - inactive - pro monthly",
      "sam plan ai app - buyer - inactive - pro yearly",
      "sam plan ai app - buyer - active - starter monthly",
      "sam plan ai app - buyer - active - starter yearly",
      "sam plan ai app - buyer - inactive - starter monthly",
      "sam plan ai app - buyer - inactive - starter yearly",
    ]);
    expect(plans).toEqual(["pro", "starter"]);
    expect(skipped).toEqual([]);
  });

  it("dedupes AFTER normalising, so one plan spelled three ways is one plan", () => {
    // Otherwise the remove set would carry the same tag repeatedly and the
    // admin screen would list "wire this up" four times for one plan.
    const { tags, plans } = buyerTagsFor(["Pro", " pro ", "PRO", "Pro+"]);
    expect(plans).toEqual(["pro"]);
    expect(tags).toHaveLength(4);
    expect(new Set(tags).size).toBe(4);
  });

  it("is deterministic and independent of how the table happened to order rows", () => {
    const first = buyerTagsFor(["Pro", "Starter"]);
    const second = buyerTagsFor(["Pro", "Starter"]);
    expect(second.tags).toEqual(first.tags);
    // Different input order gives a different (but still stable) output order;
    // what matters is the SET is the same, so nothing is missed on cleanup.
    const reversed = buyerTagsFor(["Starter", "Pro"]);
    expect(new Set(reversed.tags)).toEqual(new Set(first.tags));
  });

  it("skips unusable names instead of refusing the whole batch", () => {
    // One badly named plan must not stop a contact's other tags from being
    // cleaned up. The skipped list is what the admin screen reports.
    const { tags, plans, skipped } = buyerTagsFor(["Pro", "+++", null, "Starter", 7]);
    expect(plans).toEqual(["pro", "starter"]);
    expect(tags).toHaveLength(8);
    expect(skipped).toEqual(["+++", null, 7]);
  });

  it("gives empty output for empty input", () => {
    expect(buyerTagsFor([])).toEqual({ tags: [], plans: [], skipped: [] });
  });

  it("accepts any iterable, not just an array", () => {
    expect(buyerTagsFor(new Set(["Pro", "Pro"])).tags).toHaveLength(4);
  });

  it("produces only tags that isBuyerTag claims", () => {
    for (const tag of buyerTagsFor(["Pro", "10X Stages"]).tags) {
      expect(isBuyerTag(tag)).toBe(true);
      expect(isAppOriginTag(tag)).toBe(true);
    }
  });

  it("agrees with buyerTag on every tag it emits", () => {
    // Two code paths build the same string. If they ever drift, half the
    // system adds one tag and the other half tries to remove a different one.
    const { tags } = buyerTagsFor(["Pro"]);
    const direct = BUYER_STATES.flatMap((state) =>
      TAG_CYCLES.map((cycle) => {
        const r = buyerTag({ planName: "Pro", cycle, state });
        return r.ok ? r.tag : "REFUSED";
      })
    );
    expect(tags).toEqual(direct);
  });
});

/* ------------------------------------------------------------------ *
 * 8. buyerTagTransition — mutual exclusion
 * ------------------------------------------------------------------ */

describe("buyerTagTransition", () => {
  const KNOWN = ["Pro", "Starter"];

  it("adds exactly one tag and removes the rest", () => {
    const result = buyerTagTransition({
      planName: "Pro",
      cycle: "monthly",
      state: "active",
      knownPlanNames: KNOWN,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.add).toBe("sam plan ai app - buyer - active - pro monthly");
    expect(result.remove).toEqual([
      "sam plan ai app - buyer - active - pro yearly",
      "sam plan ai app - buyer - inactive - pro monthly",
      "sam plan ai app - buyer - inactive - pro yearly",
      "sam plan ai app - buyer - active - starter monthly",
      "sam plan ai app - buyer - active - starter yearly",
      "sam plan ai app - buyer - inactive - starter monthly",
      "sam plan ai app - buyer - inactive - starter yearly",
    ]);
  });

  it("NEVER puts the added tag in the remove list", () => {
    // The one invariant that cannot bend. GHL applies removals and additions
    // independently; a tag in both lists means the contact may end up without
    // the tag that describes what they just bought, and no email at all.
    const planSets: unknown[][] = [
      [],
      ["Pro"],
      ["Pro", "Starter"],
      ["Pro", " pro ", "PRO"],
      ["Starter", "Pro", "Legacy Founders", "10X Stages"],
      ["+++", null, "Pro"],
    ];

    for (const knownPlanNames of planSets) {
      for (const planName of ["Pro", "Starter", "Legacy Founders", "Brand New Plan"]) {
        for (const cycle of ["monthly", "annual", "yearly"]) {
          for (const state of BUYER_STATES) {
            const result = buyerTagTransition({ planName, cycle, state, knownPlanNames });
            expect(result.ok).toBe(true);
            if (!result.ok) continue;
            expect(result.remove).not.toContain(result.add);
            expect(result.remove.some((t) => tagsEqual(t, result.add))).toBe(false);
            // And nothing is listed twice, which would double the API calls.
            expect(new Set(result.remove).size).toBe(result.remove.length);
          }
        }
      }
    }
  });

  it("names every other state and cycle of the same plan for removal", () => {
    // So a contact can never hold two actives, or active and inactive at once.
    const result = buyerTagTransition({
      planName: "Pro",
      cycle: "monthly",
      state: "active",
      knownPlanNames: ["Pro"],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.remove).toContain("sam plan ai app - buyer - inactive - pro monthly");
    expect(result.remove).toContain("sam plan ai app - buyer - active - pro yearly");
    expect(result.remove).toContain("sam plan ai app - buyer - inactive - pro yearly");
  });

  it("names the other plans' tags for removal, so last month's plan does not linger", () => {
    const result = buyerTagTransition({
      planName: "Pro",
      cycle: "monthly",
      state: "active",
      knownPlanNames: KNOWN,
    });
    if (!result.ok) throw new Error("expected ok");
    for (const tag of buyerTagsFor(["Starter"]).tags) {
      expect(result.remove).toContain(tag);
    }
  });

  it("covers the entering plan even when it is absent from knownPlanNames", () => {
    // A plan can be renamed or deleted between the subscription being written
    // and this running. If the entering plan were not added to the universe,
    // its other three tags would never be named and the contact could keep an
    // inactive tag alongside the new active one.
    const result = buyerTagTransition({
      planName: "Brand New Plan",
      cycle: "yearly",
      state: "active",
      knownPlanNames: KNOWN,
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.add).toBe("sam plan ai app - buyer - active - brand new plan yearly");
    expect(result.remove).toContain("sam plan ai app - buyer - active - brand new plan monthly");
    expect(result.remove).toContain("sam plan ai app - buyer - inactive - brand new plan monthly");
    expect(result.remove).toContain("sam plan ai app - buyer - inactive - brand new plan yearly");
    expect(result.remove).not.toContain(result.add);
  });

  it("does not duplicate the entering plan when it IS in knownPlanNames", () => {
    const result = buyerTagTransition({
      planName: "Pro",
      cycle: "monthly",
      state: "active",
      knownPlanNames: ["Pro", "Pro", " pro "],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.remove).toHaveLength(3);
  });

  it("enumerates retired plan names that are passed in", () => {
    // Retired plans keep their existing subscribers, so their tags are live
    // and have to be cleared when one of those subscribers moves. Passing only
    // the active plans would leave "buyer - active - legacy monthly" on the
    // contact forever.
    const result = buyerTagTransition({
      planName: "Pro",
      cycle: "monthly",
      state: "active",
      knownPlanNames: ["Pro", "Starter", "Legacy Founders"],
    });
    if (!result.ok) throw new Error("expected ok");
    for (const tag of buyerTagsFor(["Legacy Founders"]).tags) {
      expect(result.remove).toContain(tag);
    }
  });

  it("works with no known plans at all, covering the entering plan alone", () => {
    const result = buyerTagTransition({
      planName: "Pro",
      cycle: "monthly",
      state: "active",
      knownPlanNames: [],
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.remove).toHaveLength(3);
  });

  it("propagates a refusal from buyerTag unchanged", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ planName: "+++", cycle: "monthly", state: "active" }, "plan_name"],
      [{ planName: null, cycle: "monthly", state: "active" }, "plan_name"],
      [{ planName: "Pro", cycle: "quarterly", state: "active" }, "cycle"],
      [{ planName: "Pro", cycle: "monthly", state: "paused" }, "state"],
    ];
    for (const [input, error] of cases) {
      const result = buyerTagTransition({ ...input, knownPlanNames: KNOWN } as never);
      expect(result).toMatchObject({ ok: false, error });
      // No partial output: a caller that ignored `ok` must not find a remove
      // list it could send, or it would strip every buyer tag off the contact.
      expect(result).not.toHaveProperty("add");
      expect(result).not.toHaveProperty("remove");
    }
  });

  it("reports the normalised plan, translated cycle and state it acted on", () => {
    const result = buyerTagTransition({
      planName: "  Pro+  ",
      cycle: "annual",
      state: "Inactive",
      knownPlanNames: KNOWN,
    });
    expect(result).toMatchObject({
      ok: true,
      plan: "pro",
      cycle: "yearly",
      state: "inactive",
    });
  });

  /**
   * The invariant stated as a property rather than as examples: for every
   * state × cycle × plan the app knows about, add and remove must PARTITION
   * the whole tag universe — nothing in both, nothing missing. Any gap is a
   * tag left on the contact, and a tag left on the contact is an extra email.
   */
  it("partitions the full tag universe for every combination", () => {
    const plans = ["Pro", "Starter"];
    const universe = buyerTagsFor(plans).tags;
    expect(universe).toHaveLength(8);

    let combinations = 0;
    for (const planName of plans) {
      for (const cycle of TAG_CYCLES as readonly TagCycle[]) {
        for (const state of BUYER_STATES as readonly BuyerState[]) {
          const result = buyerTagTransition({
            planName,
            cycle,
            state,
            knownPlanNames: plans,
          });
          expect(result.ok).toBe(true);
          if (!result.ok) continue;

          const covered = new Set([result.add, ...result.remove]);
          expect(covered.size).toBe(universe.length);
          expect(covered).toEqual(new Set(universe));
          expect(result.remove).toHaveLength(universe.length - 1);
          combinations += 1;
        }
      }
    }
    expect(combinations).toBe(8);
  });

  it("gives a different add for every one of those combinations", () => {
    const plans = ["Pro", "Starter"];
    const adds = new Set<string>();
    for (const planName of plans) {
      for (const cycle of TAG_CYCLES) {
        for (const state of BUYER_STATES) {
          const r = buyerTagTransition({ planName, cycle, state, knownPlanNames: plans });
          if (r.ok) adds.add(r.add);
        }
      }
    }
    expect(adds.size).toBe(8);
  });
});

/* ------------------------------------------------------------------ *
 * 9. The marketing suppression tag
 * ------------------------------------------------------------------ */

describe("MARKETING_SUPPRESSION_TAG", () => {
  it("is the normalised form of the string the client writes by hand", () => {
    expect(MARKETING_SUPPRESSION_TAG_AS_WRITTEN).toBe("Customer - SAM Plan AI");
    expect(MARKETING_SUPPRESSION_TAG).toBe("customer - sam plan ai");
    // The two agree under comparison: GHL lowercases on write, so the
    // as-written form is documentation and admin copy, and the normalised form
    // is what comes back on a read.
    expect(normaliseTagForCompare(MARKETING_SUPPRESSION_TAG_AS_WRITTEN)).toBe(
      MARKETING_SUPPRESSION_TAG
    );
    expect(tagsEqual(MARKETING_SUPPRESSION_TAG, MARKETING_SUPPRESSION_TAG_AS_WRITTEN)).toBe(true);
  });

  it("is not app-origin, so the cleanup never touches it", () => {
    // It lives in the two marketing sub-accounts against a different location
    // ID, and it is the only thing keeping promotional sequences off people who
    // already pay us.
    expect(isAppOriginTag(MARKETING_SUPPRESSION_TAG)).toBe(false);
    expect(isAppOriginTag(MARKETING_SUPPRESSION_TAG_AS_WRITTEN)).toBe(false);
    expect(isBuyerTag(MARKETING_SUPPRESSION_TAG)).toBe(false);
  });

  it("does not collide with any tag in our own namespace", () => {
    expect(MARKETING_SUPPRESSION_TAG.startsWith("sam plan ai")).toBe(false);
    for (const tag of FIXED_TAGS) {
      expect(tagsEqual(tag, MARKETING_SUPPRESSION_TAG)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Registration tags
 * ------------------------------------------------------------------ */

describe("registration tags", () => {
  it("pins the exact strings", () => {
    expect(TAG_REGISTERED_NOT_PAID).toBe("sam plan ai app - registered - not - paid");
    expect(TAG_OPTED_DND).toBe("sam plan ai app - buyer - opted - dnd");
  });

  it("are both ours", () => {
    expect(isAppOriginTag(TAG_REGISTERED_NOT_PAID)).toBe(true);
    expect(isAppOriginTag(TAG_OPTED_DND)).toBe(true);
  });

  it("TAG_OPTED_COMMUNICATION is pinned, ours, and not a buyer tag", () => {
    expect(TAG_OPTED_COMMUNICATION).toBe("sam plan ai app - buyer - opted - communication");
    expect(isAppOriginTag(TAG_OPTED_COMMUNICATION)).toBe(true);
    expect(isBuyerTag(TAG_OPTED_COMMUNICATION)).toBe(false);
    expect(isBuyerTag("SAM Plan AI App - Buyer - Opted - Communication")).toBe(false);
  });

  it("consentTagFor picks exactly one tag per answer, none when never asked", () => {
    expect(consentTagFor(true)).toBe(TAG_OPTED_COMMUNICATION);
    expect(consentTagFor(false)).toBe(TAG_OPTED_DND);
    expect(consentTagFor(null)).toBeNull();
    expect(consentTagFor(undefined)).toBeNull();
  });

  it("TAG_OPTED_DND shares the buyer prefix but is not a buyer tag, in any casing", () => {
    expect(TAG_OPTED_DND.startsWith(BUYER_TAG_PREFIX)).toBe(true);
    expect(isBuyerTag(TAG_OPTED_DND)).toBe(false);
    expect(isBuyerTag("SAM Plan AI App - Buyer - Opted - DND")).toBe(false);
    expect(isBuyerTag("  sam plan ai app -  buyer - opted - dnd ")).toBe(false);
    expect(isBuyerTag(TAG_REGISTERED_NOT_PAID)).toBe(false);
  });

  it("buyerTagsFor and buyerTagTransition never list TAG_OPTED_DND", () => {
    const awkward = ["Pro", "opted", "dnd", "opted - dnd", "Opted DND", "- opted -"];
    const { tags } = buyerTagsFor(awkward);
    expect(tags.some((t) => tagsEqual(t, TAG_OPTED_DND))).toBe(false);
    for (const state of BUYER_STATES) {
      for (const cycle of TAG_CYCLES) {
        for (const planName of awkward) {
          const r = buyerTagTransition({ planName, cycle, state, knownPlanNames: awkward });
          if (!r.ok) continue;
          expect(tagsEqual(r.add, TAG_OPTED_DND)).toBe(false);
          expect(r.remove.some((t) => tagsEqual(t, TAG_OPTED_DND))).toBe(false);
          expect(r.remove.some((t) => tagsEqual(t, TAG_REGISTERED_NOT_PAID))).toBe(false);
        }
      }
    }
  });
});
