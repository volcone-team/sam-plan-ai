import { describe, it, expect } from "vitest";
import {
  INTAKE_EVENTS,
  INTAKE_EVENT_NAMES,
  isIntakeEvent,
  pathSelected,
  screenViewed,
  screenCompleted,
  fieldSkipped,
  voiceUsed,
  recommendationShown,
  recommendationAccepted,
  recommendationDismissed,
  planBuilt,
  isAbandoned,
  ABANDON_AFTER_MINUTES,
} from "./events";

/**
 * Analytics bugs are quiet: a mistyped event name produces a funnel with a
 * missing step rather than an error. So the names are asserted literally
 * against the requirement's table, and the API route validates against the
 * same list.
 */

describe("event names", () => {
  // REQ-14.1 lists ten named events; intake_abandoned is derived server-side.
  it("declares the ten events from the requirement", () => {
    expect(INTAKE_EVENT_NAMES).toHaveLength(10);
  });

  it("matches the requirement's spelling exactly", () => {
    expect(INTAKE_EVENTS.pathSelected).toBe("intake_path_selected");
    expect(INTAKE_EVENTS.screenViewed).toBe("intake_screen_viewed");
    expect(INTAKE_EVENTS.screenCompleted).toBe("intake_screen_completed");
    expect(INTAKE_EVENTS.fieldSkipped).toBe("intake_field_skipped");
    expect(INTAKE_EVENTS.abandoned).toBe("intake_abandoned");
    expect(INTAKE_EVENTS.voiceUsed).toBe("intake_voice_used");
    expect(INTAKE_EVENTS.recommendationShown).toBe("recommendation_shown");
    expect(INTAKE_EVENTS.recommendationAccepted).toBe("recommendation_accepted");
    expect(INTAKE_EVENTS.recommendationDismissed).toBe("recommendation_dismissed");
    expect(INTAKE_EVENTS.planBuilt).toBe("plan_built");
  });

  it("has no duplicates", () => {
    expect(new Set(INTAKE_EVENT_NAMES).size).toBe(INTAKE_EVENT_NAMES.length);
  });

  /**
   * The guard the API route uses. A near-miss must be rejected rather than
   * stored, because a stored typo looks like real data.
   */
  it("rejects a near-miss event name", () => {
    expect(isIntakeEvent("intake_screen_completed")).toBe(true);
    expect(isIntakeEvent("intake_screen_complete")).toBe(false);
    expect(isIntakeEvent("")).toBe(false);
    expect(isIntakeEvent(null)).toBe(false);
    expect(isIntakeEvent(42)).toBe(false);
  });
});

describe("builders", () => {
  it("records the chosen path on screen 0", () => {
    const payload = pathSelected("know_some");
    expect(payload.event).toBe("intake_path_selected");
    expect(payload.plan_path).toBe("know_some");
    expect(payload.screen).toBe("start");
  });

  it("records the screen and path on a view", () => {
    const payload = screenViewed("products", "know_most");
    expect(payload.event).toBe("intake_screen_viewed");
    expect(payload.screen).toBe("products");
    expect(payload.plan_path).toBe("know_most");
  });

  it("carries the path as null before screen 0 is answered", () => {
    expect(screenViewed("start", null).plan_path).toBeNull();
  });

  // Whole seconds: the question is which screens people labour over, and
  // sub-second precision on a form field is noise.
  it("floors the dwell time to whole seconds", () => {
    expect(screenCompleted("team", "know_most", 12.9).properties?.seconds_on_screen)
      .toBe(12);
  });

  it("never reports a negative dwell time", () => {
    // A clock adjustment mid-screen should not produce a negative duration.
    expect(screenCompleted("team", null, -5).properties?.seconds_on_screen).toBe(0);
  });

  /**
   * The field NAME is recorded but never its value — a skipped field has no
   * value, and recording one would mean recording an answer the user declined
   * to give.
   */
  it("records only the field name on a skip", () => {
    const payload = fieldSkipped("audience", "email_list_size", "recommend_all");
    expect(payload.properties).toEqual({ field: "email_list_size" });
  });

  it("records the field the mic was used on", () => {
    const payload = voiceUsed("business", "business_description", "know_most");
    expect(payload.event).toBe("intake_voice_used");
    expect(payload.properties?.field).toBe("business_description");
  });

  it("distinguishes where a shown recommendation came from", () => {
    expect(recommendationShown("live_webinar_own", "user", "know_most").properties)
      .toEqual({ initiative_type: "live_webinar_own", source: "user" });
    expect(recommendationShown("podcast_own", "recommended", "recommend_all").properties?.source)
      .toBe("recommended");
  });

  it("records an acceptance", () => {
    const payload = recommendationAccepted("email_campaign", "know_some");
    expect(payload.event).toBe("recommendation_accepted");
    expect(payload.properties?.initiative_type).toBe("email_campaign");
  });

  /**
   * Dismiss and swap share an event with an `action`, so the acceptance-rate
   * query in REQ-14.4 stays a single aggregate rather than a union.
   */
  it("separates a dismiss from a swap by action", () => {
    expect(recommendationDismissed("paid_ads_meta", "dismiss", null).properties?.action)
      .toBe("dismiss");
    expect(recommendationDismissed("paid_ads_meta", "swap", null).properties?.action)
      .toBe("swap");
    expect(recommendationDismissed("paid_ads_meta", "swap", null).event)
      .toBe("recommendation_dismissed");
  });

  it("records the plan size and remaining gap on build", () => {
    const payload = planBuilt("know_some", 4, 131_400);
    expect(payload.properties).toEqual({
      initiative_count: 4,
      gap_amount: 131_400,
    });
  });

  it("records a zero gap when the plan covers the goal", () => {
    expect(planBuilt("know_most", 6, 0).properties?.gap_amount).toBe(0);
  });
});

describe("isAbandoned", () => {
  const now = new Date("2026-10-07T12:00:00Z");

  it("is true after the idle window with no completion", () => {
    expect(isAbandoned("2026-10-07T11:25:00Z", null, now)).toBe(true);
  });

  it("is false inside the idle window", () => {
    expect(isAbandoned("2026-10-07T11:45:00Z", null, now)).toBe(false);
  });

  it("uses the declared window", () => {
    expect(ABANDON_AFTER_MINUTES).toBe(30);
    const justInside = new Date(now.getTime() - (ABANDON_AFTER_MINUTES - 1) * 60000);
    const justOutside = new Date(now.getTime() - ABANDON_AFTER_MINUTES * 60000);
    expect(isAbandoned(justInside, null, now)).toBe(false);
    expect(isAbandoned(justOutside, null, now)).toBe(true);
  });

  /**
   * Someone who finished is never abandoned, however long ago they were last
   * active — otherwise every completed intake eventually counts as a dropout.
   */
  it("is false once the intake is complete", () => {
    expect(isAbandoned("2026-01-01T00:00:00Z", "2026-01-01T00:30:00Z", now)).toBe(false);
  });

  it("is false with no recorded activity", () => {
    expect(isAbandoned(null, null, now)).toBe(false);
    expect(isAbandoned(undefined, null, now)).toBe(false);
  });

  it("is false on an unparseable timestamp rather than throwing", () => {
    expect(isAbandoned("not a date", null, now)).toBe(false);
  });

  it("accepts a Date as well as a string", () => {
    expect(isAbandoned(new Date("2026-10-07T11:00:00Z"), null, now)).toBe(true);
  });
});
