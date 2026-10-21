import { describe, it, expect } from "vitest";
import { buyerPresenceForStatus, decideBuyerStateTags } from "./buyer-state";
import { BUYER_TAG_PREFIX, isBuyerTag, tagsEqual } from "./tags";

const PLANS = ["Starter", "Pro", "Legacy"];

describe("buyerPresenceForStatus — the whole mapping", () => {
  /**
   * EVERY status, as a table, because the fallback is `none` and a mapping
   * that quietly stops recognising a status produces no tag and no error. The
   * three debatable ones carry their reasoning in buyer-state.ts; the table is
   * here so that changing any of them has to be deliberate.
   */
  const cases: [string | null | undefined, string, string | undefined][] = [
    // status                presence     none-reason
    ["active", "active", undefined],
    // Still inside the dunning grace window, still logging in, card still
    // being retried. Flipping to inactive would fire win-back at somebody
    // whose card merely expired, then flip back on recovery — tag thrash.
    ["past_due", "active", undefined],

    ["unpaid", "inactive", undefined],
    ["canceled", "inactive", undefined],
    // The spelling mapStripeStatus actually writes. See the note in the module.
    ["cancelled", "inactive", undefined],
    ["incomplete_expired", "inactive", undefined],
    // Stripe's paused collection: no money moving, and evaluateAccess locks
    // the account out. Not the cancellation tag, and fully reversible.
    ["paused", "inactive", undefined],

    // A trial is not a purchase. "buyer" must keep meaning "bought".
    ["trialing", "none", "trialing"],
    ["trial", "none", "trialing"],
    // A checkout that never completed. They were never a buyer.
    ["incomplete", "none", "incomplete"],

    [null, "none", "no_subscription"],
    [undefined, "none", "no_subscription"],
    ["", "none", "no_subscription"],
    ["   ", "none", "no_subscription"],

    // Stripe adds statuses. An unknown one must not be guessed into a
    // workflow — the same refusal mapStripeStatus makes.
    ["something_new", "none", "unknown_status"],
  ];

  for (const [status, presence, reason] of cases) {
    it(`maps ${JSON.stringify(status)} to ${presence}${reason ? ` (${reason})` : ""}`, () => {
      const result = buyerPresenceForStatus(status);
      expect(result.presence).toBe(presence);
      if (reason) {
        expect(result).toMatchObject({ reason });
      } else {
        expect(result).not.toHaveProperty("reason");
      }
    });
  }

  it("is case- and whitespace-insensitive, because the column is free text", () => {
    expect(buyerPresenceForStatus(" ACTIVE ").presence).toBe("active");
    expect(buyerPresenceForStatus("Trialing").presence).toBe("none");
  });
});

describe("decideBuyerStateTags", () => {
  it("builds one add and the rest as removals for an active subscriber", () => {
    const result = decideBuyerStateTags({
      status: "active",
      planName: "Pro",
      cycle: "monthly",
      knownPlanNames: PLANS,
    });

    expect(result).toMatchObject({
      ok: true,
      outcome: "tags",
      add: `${BUYER_TAG_PREFIX}active - pro monthly`,
      state: "active",
      plan: "pro",
      cycle: "monthly",
      status: "active",
    });
  });

  /**
   * THE DATABASE SAYS "annual", THE CLIENT'S TAGS SAY "yearly". Passing the
   * column through would create a tag no workflow is listening to.
   */
  it("translates the database's annual into the tag's yearly", () => {
    const result = decideBuyerStateTags({
      status: "active",
      planName: "Pro",
      cycle: "annual",
      knownPlanNames: PLANS,
    });

    expect(result).toMatchObject({
      ok: true,
      add: `${BUYER_TAG_PREFIX}active - pro yearly`,
      cycle: "yearly",
    });
    if (result.ok && result.outcome === "tags") {
      expect(result.add).not.toContain("annual");
    }
  });

  /**
   * RETIRED PLANS KEEP THEIR SUBSCRIBERS, so their tags are still live on real
   * contacts and still have to be cleared. "Legacy" here stands for a retired
   * plan the caller must not have filtered out.
   */
  it("names a retired plan's tags in the removal list", () => {
    const result = decideBuyerStateTags({
      status: "active",
      planName: "Pro",
      cycle: "monthly",
      knownPlanNames: PLANS,
    });

    expect(result.ok && result.outcome === "tags" ? result.remove : []).toEqual(
      expect.arrayContaining([
        `${BUYER_TAG_PREFIX}active - legacy monthly`,
        `${BUYER_TAG_PREFIX}active - legacy yearly`,
        `${BUYER_TAG_PREFIX}inactive - legacy monthly`,
        `${BUYER_TAG_PREFIX}inactive - legacy yearly`,
      ])
    );
  });

  /**
   * The invariant a GHL workflow depends on: a contact holds exactly one buyer
   * tag. If `add` appeared in `remove`, the drain would add it and take it
   * straight back off.
   */
  it("never puts the add tag in the remove list, and removes only buyer tags", () => {
    for (const cycle of ["monthly", "annual"]) {
      for (const status of ["active", "cancelled"]) {
        const result = decideBuyerStateTags({
          status,
          planName: "Pro",
          cycle,
          knownPlanNames: PLANS,
        });
        if (!result.ok || result.outcome !== "tags") throw new Error("expected tags");

        expect(result.remove.some((t) => tagsEqual(t, result.add))).toBe(false);
        expect(result.remove.every(isBuyerTag)).toBe(true);
      }
    }
  });

  it("covers the entering plan even when it is missing from the known names", () => {
    // A plan renamed or deleted between the subscription write and this call.
    const result = decideBuyerStateTags({
      status: "active",
      planName: "Ghost",
      cycle: "monthly",
      knownPlanNames: PLANS,
    });

    if (!result.ok || result.outcome !== "tags") throw new Error("expected tags");
    expect(result.add).toBe(`${BUYER_TAG_PREFIX}active - ghost monthly`);
    expect(result.remove).toContain(`${BUYER_TAG_PREFIX}inactive - ghost monthly`);
  });

  describe("none and refusal are different answers", () => {
    it("reports none for a status that implies no buyer tag", () => {
      const result = decideBuyerStateTags({
        status: "trialing",
        planName: "Pro",
        cycle: "monthly",
        knownPlanNames: PLANS,
      });

      expect(result).toEqual({
        ok: true,
        outcome: "none",
        reason: "trialing",
        status: "trialing",
      });
    });

    /**
     * The presence check runs FIRST, so a trial on an untaggable plan is
     * `none` rather than a plan-name refusal — the plan name was never going
     * to be used, and `ok: false` must keep meaning "an admin should fix
     * something".
     */
    it("prefers none over a refusal when the status never needed a tag", () => {
      const result = decideBuyerStateTags({
        status: "trialing",
        planName: "+++",
        cycle: "nonsense",
        knownPlanNames: PLANS,
      });
      expect(result).toMatchObject({ ok: true, outcome: "none" });
    });

    it("refuses a plan name that cannot be put in a tag", () => {
      for (const planName of ["+++", "", "   ", null, 7, "日本語"]) {
        const result = decideBuyerStateTags({
          status: "active",
          planName,
          cycle: "monthly",
          knownPlanNames: PLANS,
        });
        expect(result).toMatchObject({ ok: false, error: "plan_name" });
      }
    });

    it("refuses a cycle it does not recognise", () => {
      for (const cycle of ["weekly", "", null, 12]) {
        const result = decideBuyerStateTags({
          status: "active",
          planName: "Pro",
          cycle,
          knownPlanNames: PLANS,
        });
        expect(result).toMatchObject({ ok: false, error: "cycle" });
      }
    });
  });
});
