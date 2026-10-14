import { describe, it, expect } from "vitest";
import {
  PAUSE_DURATIONS,
  PAUSE_REMINDER_LEAD_DAYS,
  isPauseMonths,
  isPauseOrigin,
  canPauseSelf,
  canResumeSelf,
  explainPauseBlocker,
  pauseScheduleFor,
  shouldSendPauseReminder,
  pauseHasElapsed,
  describePauseOffer,
  describePauseAccepted,
  pauseClaimLabel,
} from "./pause";
import { addMonthsClamped } from "./month-math";

const DAY = 24 * 60 * 60 * 1000;

describe("addMonthsClamped — shared with the retention discount", () => {
  it("adds whole months", () => {
    expect(addMonthsClamped("2026-11-12T00:00:00.000Z", 1)).toBe("2026-12-12T00:00:00.000Z");
    expect(addMonthsClamped("2026-11-12T00:00:00.000Z", 3)).toBe("2027-02-12T00:00:00.000Z");
  });

  /**
   * THE BUG THIS EXISTS FOR. Naive setMonth on 31 January gives 3 March,
   * because 31 February does not exist and JS rolls over instead of clamping.
   * Used in billing copy it promises a date two days later than the truth.
   */
  it("clamps the day into a shorter month instead of rolling over", () => {
    expect(addMonthsClamped("2027-01-31T00:00:00.000Z", 1)).toBe("2027-02-28T00:00:00.000Z");
    expect(addMonthsClamped("2026-03-31T00:00:00.000Z", 1)).toBe("2026-04-30T00:00:00.000Z");
    expect(addMonthsClamped("2026-08-31T00:00:00.000Z", 3)).toBe("2026-11-30T00:00:00.000Z");
  });

  it("knows about leap years", () => {
    expect(addMonthsClamped("2028-01-31T00:00:00.000Z", 1)).toBe("2028-02-29T00:00:00.000Z");
    expect(addMonthsClamped("2027-01-31T00:00:00.000Z", 1)).toBe("2027-02-28T00:00:00.000Z");
  });

  it("returns null rather than an Invalid Date a customer could see", () => {
    expect(addMonthsClamped(null, 1)).toBeNull();
    expect(addMonthsClamped("", 1)).toBeNull();
    expect(addMonthsClamped("not a date", 1)).toBeNull();
    expect(addMonthsClamped("2026-11-12T00:00:00.000Z", -1)).toBeNull();
    expect(addMonthsClamped("2026-11-12T00:00:00.000Z", Number.NaN)).toBeNull();
  });

  it("adding zero months is a no-op", () => {
    expect(addMonthsClamped("2026-11-12T00:00:00.000Z", 0)).toBe("2026-11-12T00:00:00.000Z");
  });
});

describe("pause durations", () => {
  it("offers 1, 2 and 3 months, as the mockup does", () => {
    expect(PAUSE_DURATIONS).toEqual([1, 2, 3]);
  });

  it("rejects anything else arriving from a request body", () => {
    for (const bad of [0, 4, 12, -1, 1.5, "1", null, undefined, {}, []]) {
      expect(isPauseMonths(bad)).toBe(false);
    }
    for (const good of [1, 2, 3]) expect(isPauseMonths(good)).toBe(true);
  });

  it("labels each duration with the right plural", () => {
    expect(pauseClaimLabel(1)).toBe("Pause for 1 month");
    expect(pauseClaimLabel(2)).toBe("Pause for 2 months");
    expect(pauseClaimLabel(3)).toBe("Pause for 3 months");
  });

  it("validates the origin values", () => {
    expect(isPauseOrigin("admin")).toBe(true);
    expect(isPauseOrigin("customer")).toBe(true);
    for (const bad of ["", "ADMIN", "system", null, 1]) {
      expect(isPauseOrigin(bad)).toBe(false);
    }
  });
});

describe("canPauseSelf", () => {
  it("allows a monthly payer in good standing", () => {
    expect(canPauseSelf({ cancelEligible: true, billingCycle: "monthly" }))
      .toEqual({ allowed: true });
  });

  /**
   * canCancel already refuses comped, trialing, paused and already-ending
   * accounts. Reusing it means pause and cancel cannot disagree about who is
   * in a normal paying state.
   */
  it("refuses anyone who could not cancel either", () => {
    expect(canPauseSelf({ cancelEligible: false, billingCycle: "monthly" }))
      .toEqual({ allowed: false, blocker: "not_eligible_to_cancel" });
  });

  /**
   * `pause_collection` suppresses invoices RAISED during the window — it does
   * not move a renewal. An annual subscriber whose renewal is ten months out
   * would lose access and save nothing, which is strictly worse for them than
   * doing nothing at all.
   */
  it("refuses annual subscribers, who would lose access and save nothing", () => {
    expect(canPauseSelf({ cancelEligible: true, billingCycle: "annual" }))
      .toEqual({ allowed: false, blocker: "not_monthly" });
    for (const cycle of [null, "", "quarterly"]) {
      expect(canPauseSelf({ cancelEligible: true, billingCycle: cycle }).allowed).toBe(false);
    }
  });
});

describe("canResumeSelf — the security-relevant one", () => {
  it("lets a customer lift a pause they chose", () => {
    expect(canResumeSelf({ isPaused: true, pauseOrigin: "customer" }))
      .toEqual({ allowed: true });
  });

  /**
   * An admin pause is a SUSPENSION — non-payment, a contract dispute, abuse.
   * Letting the customer undo it would make the admin control decorative.
   */
  it("refuses to let a customer undo an admin suspension", () => {
    expect(canResumeSelf({ isPaused: true, pauseOrigin: "admin" }))
      .toEqual({ allowed: false, blocker: "admin_paused" });
  });

  /**
   * FAILS CLOSED on a missing origin. Every pause predating migration 032 was
   * applied by an admin; the migration backfills them, and this is the belt to
   * that braces — a row the backfill missed must not become self-resumable.
   */
  it("treats an unknown origin as an admin pause", () => {
    for (const origin of [null, "", "system", "unknown"]) {
      expect(canResumeSelf({ isPaused: true, pauseOrigin: origin }))
        .toEqual({ allowed: false, blocker: "admin_paused" });
    }
  });

  it("has nothing to resume when not paused", () => {
    expect(canResumeSelf({ isPaused: false, pauseOrigin: "customer" }))
      .toEqual({ allowed: false, blocker: "not_paused" });
  });

  it("has a sentence for every blocker", () => {
    for (const b of ["not_eligible_to_cancel", "not_monthly", "not_paused", "admin_paused"] as const) {
      expect(explainPauseBlocker(b).length).toBeGreaterThan(10);
    }
  });

  /** pause_reason is an internal admin note, never shown to the customer. */
  it("does not leak why an admin paused the account", () => {
    const text = explainPauseBlocker("admin_paused");
    expect(text).not.toMatch(/non-payment|dispute|abuse|reason:/i);
  });

  /** Must not coach someone into switching cycles to unlock the feature. */
  it("does not suggest changing billing cycle", () => {
    expect(explainPauseBlocker("not_monthly")).not.toMatch(/switch|change to/i);
  });
});

describe("pauseScheduleFor", () => {
  const now = new Date("2026-11-12T10:30:00.000Z");

  it("starts today and ends N months later", () => {
    expect(pauseScheduleFor(1, now)).toEqual({
      pausesAt: "2026-11-12T10:30:00.000Z",
      resumesAt: "2026-12-12T10:30:00.000Z",
    });
    expect(pauseScheduleFor(3, now).resumesAt).toBe("2027-02-12T10:30:00.000Z");
  });

  it("clamps into shorter months like everything else", () => {
    expect(pauseScheduleFor(1, new Date("2027-01-31T00:00:00.000Z")).resumesAt)
      .toBe("2027-02-28T00:00:00.000Z");
  });

  it("always resumes strictly after it pauses", () => {
    for (const months of PAUSE_DURATIONS) {
      const s = pauseScheduleFor(months, now);
      expect(new Date(s.resumesAt).getTime()).toBeGreaterThan(new Date(s.pausesAt).getTime());
    }
  });
});

describe("shouldSendPauseReminder", () => {
  const now = new Date("2026-12-05T00:00:00.000Z").getTime();
  const base = { isPaused: true, reminderSentAt: null, now };

  it("sends inside the final week", () => {
    // Resumes in 3 days.
    expect(shouldSendPauseReminder({
      ...base, pauseResumesAt: new Date(now + 3 * DAY).toISOString(),
    })).toBe(true);
  });

  it("stays quiet while the resume date is more than a week out", () => {
    expect(shouldSendPauseReminder({
      ...base, pauseResumesAt: new Date(now + 20 * DAY).toISOString(),
    })).toBe(false);
  });

  it("promises a week, so seven days qualifies", () => {
    expect(shouldSendPauseReminder({
      ...base, pauseResumesAt: new Date(now + PAUSE_REMINDER_LEAD_DAYS * DAY).toISOString(),
    })).toBe(true);
  });

  /**
   * Idempotency. The cron runs daily, so without this the customer gets the
   * same "billing restarts soon" email seven times.
   */
  it("sends only once", () => {
    expect(shouldSendPauseReminder({
      ...base,
      pauseResumesAt: new Date(now + 3 * DAY).toISOString(),
      reminderSentAt: new Date(now - DAY).toISOString(),
    })).toBe(false);
  });

  /**
   * NO LOWER BOUND, on purpose. If the job misses a day, a late reminder is
   * still better than none — a silently restarting charge is what it exists to
   * prevent.
   */
  it("still sends late if the job missed the window", () => {
    expect(shouldSendPauseReminder({
      ...base, pauseResumesAt: new Date(now - 2 * DAY).toISOString(),
    })).toBe(true);
  });

  it("sends nothing for an open-ended pause or an unpaused account", () => {
    expect(shouldSendPauseReminder({ ...base, pauseResumesAt: null })).toBe(false);
    expect(shouldSendPauseReminder({
      ...base, isPaused: false, pauseResumesAt: new Date(now + DAY).toISOString(),
    })).toBe(false);
    expect(shouldSendPauseReminder({ ...base, pauseResumesAt: "not a date" })).toBe(false);
  });
});

describe("pauseHasElapsed", () => {
  const now = new Date("2026-12-12T00:00:00.000Z").getTime();

  it("is true once the resume date has passed", () => {
    expect(pauseHasElapsed({
      isPaused: true, pauseResumesAt: new Date(now - DAY).toISOString(), now,
    })).toBe(true);
  });

  it("is true exactly on the boundary, so access is not withheld a day too long", () => {
    expect(pauseHasElapsed({
      isPaused: true, pauseResumesAt: new Date(now).toISOString(), now,
    })).toBe(true);
  });

  it("is false while the pause is still running", () => {
    expect(pauseHasElapsed({
      isPaused: true, pauseResumesAt: new Date(now + DAY).toISOString(), now,
    })).toBe(false);
  });

  /**
   * An open-ended pause is an admin suspension with no end date. It must never
   * expire on its own, or a suspension would quietly lift itself.
   */
  it("never expires a pause with no resume date", () => {
    expect(pauseHasElapsed({ isPaused: true, pauseResumesAt: null, now })).toBe(false);
  });

  it("is false for an account that is not paused", () => {
    expect(pauseHasElapsed({
      isPaused: false, pauseResumesAt: new Date(now - DAY).toISOString(), now,
    })).toBe(false);
  });

  it("ignores an unparseable date rather than treating it as elapsed", () => {
    // Fails CLOSED: a corrupt date must not silently restore access.
    expect(pauseHasElapsed({ isPaused: true, pauseResumesAt: "garbage", now })).toBe(false);
  });
});

describe("describePauseOffer", () => {
  const copy = describePauseOffer();

  it("names the control and both dates", () => {
    expect(copy.durationLabel).toBe("Pause for");
    expect(copy.pausesAtLabel).toBe("Billing pauses");
    expect(copy.resumesAtLabel).toBe("Billing restarts");
    expect(copy.declineLabel).toMatch(/continue to cancel/i);
  });

  /**
   * THE MOST IMPORTANT ASSERTION IN THIS FILE.
   *
   * A pause stops access as well as billing. The mockup lists what is preserved
   * and never says the product closes, which would leave someone expecting to
   * keep working. The screen must say it.
   */
  it("tells the customer their access pauses too", () => {
    const all = [copy.subtitle, ...copy.guarantees].join(" ");
    expect(all).toMatch(/access pauses/i);
  });

  it("reassures that nothing is deleted", () => {
    const all = [copy.subtitle, ...copy.guarantees].join(" ");
    expect(all).toMatch(/nothing is deleted|stay saved/i);
  });

  it("repeats the email promise the cron has to keep", () => {
    expect(copy.guarantees.join(" ")).toMatch(/week before billing restarts/i);
  });

  /** No scorecards exist in the product. */
  it("does not name features that do not exist", () => {
    expect(copy.guarantees.join(" ")).not.toMatch(/scorecard/i);
  });
});

describe("describePauseAccepted", () => {
  it("leads with the access consequence and names the restart date", () => {
    const copy = describePauseAccepted({
      months: 1,
      resumesAt: "2026-12-12T00:00:00.000Z",
      resumesOnLabel: "Dec 12, 2026",
    });
    expect(copy.title).toBe("Your plan is paused");
    expect(copy.body).toContain("Dec 12, 2026");
    expect(copy.body).toMatch(/access is on hold/i);
    expect(copy.body).toMatch(/nothing has been deleted/i);
  });

  it("falls back to a duration when there is no date", () => {
    const copy = describePauseAccepted({ months: 3, resumesAt: null, resumesOnLabel: null });
    expect(copy.body).not.toMatch(/Invalid|null|undefined/);
    expect(copy.body).toContain("in 3 months");
  });

  it("tells them they can come back early", () => {
    const copy = describePauseAccepted({ months: 2, resumesAt: null, resumesOnLabel: null });
    expect(copy.nextStepBody).toMatch(/any time/i);
  });
});
