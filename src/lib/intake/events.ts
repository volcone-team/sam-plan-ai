/**
 * Intake analytics (D5, REQ-14.1).
 *
 * Internal `intake_events` table rather than a third-party tool: no new secret
 * to manage, no vendor dependency, and the admin report can query it directly.
 *
 * The event NAMES and their payload builders live here so the eleven events are
 * declared once. A screen firing `"intake_screen_complete"` instead of
 * `"intake_screen_completed"` would not fail anywhere — it would just quietly
 * produce a funnel with a missing step, which is the failure mode analytics
 * code is most prone to.
 *
 * `company_id` and `user_id` are NOT in any payload here. The API route stamps
 * them from the session, because a client-supplied company id would let anyone
 * pollute another account's funnel data.
 */

import type { PlanPath, ScreenId } from "@/lib/intake/flow";

/* ------------------------------------------------------------------ *
 * Event names
 * ------------------------------------------------------------------ */

export const INTAKE_EVENTS = {
  pathSelected: "intake_path_selected",
  screenViewed: "intake_screen_viewed",
  screenCompleted: "intake_screen_completed",
  fieldSkipped: "intake_field_skipped",
  abandoned: "intake_abandoned",
  voiceUsed: "intake_voice_used",
  recommendationShown: "recommendation_shown",
  recommendationAccepted: "recommendation_accepted",
  recommendationDismissed: "recommendation_dismissed",
  planBuilt: "plan_built",
} as const;

export type IntakeEventName = (typeof INTAKE_EVENTS)[keyof typeof INTAKE_EVENTS];

/** Every name, for validating what arrives at the API route. */
export const INTAKE_EVENT_NAMES: readonly string[] = Object.values(INTAKE_EVENTS);

export function isIntakeEvent(value: unknown): value is IntakeEventName {
  return typeof value === "string" && INTAKE_EVENT_NAMES.includes(value);
}

/* ------------------------------------------------------------------ *
 * Payload
 * ------------------------------------------------------------------ */

/**
 * What goes over the wire. `screen` and `plan_path` are promoted to columns
 * because almost every report groups by them; the rest lives in `properties`
 * JSONB, since the eleven events carry different shapes and a column per
 * property would be mostly null.
 */
export interface IntakeEventPayload {
  event: IntakeEventName;
  screen?: ScreenId | null;
  plan_path?: PlanPath | null;
  properties?: Record<string, unknown>;
}

/** Where a recommended initiative came from (REQ-14.1). */
export type RecommendationSource = "user" | "suggested" | "recommended";

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

export function pathSelected(path: PlanPath): IntakeEventPayload {
  return {
    event: INTAKE_EVENTS.pathSelected,
    screen: "start",
    plan_path: path,
    properties: { plan_path: path },
  };
}

export function screenViewed(
  screen: ScreenId,
  path: PlanPath | null
): IntakeEventPayload {
  return { event: INTAKE_EVENTS.screenViewed, screen, plan_path: path };
}

/**
 * Fired on Next, with the dwell time.
 *
 * Seconds rather than milliseconds, and floored: the question this answers is
 * "which screens do people labour over", and sub-second precision on a form
 * field is noise.
 */
export function screenCompleted(
  screen: ScreenId,
  path: PlanPath | null,
  secondsOnScreen: number
): IntakeEventPayload {
  return {
    event: INTAKE_EVENTS.screenCompleted,
    screen,
    plan_path: path,
    properties: { seconds_on_screen: Math.max(0, Math.floor(secondsOnScreen)) },
  };
}

/**
 * An optional field left empty, or answered "Not sure".
 *
 * This is the signal for which questions are not worth asking. The field NAME
 * is recorded but never its value — a skipped field has no value, and recording
 * one would mean recording the answer to a question the user declined.
 */
export function fieldSkipped(
  screen: ScreenId,
  field: string,
  path: PlanPath | null
): IntakeEventPayload {
  return {
    event: INTAKE_EVENTS.fieldSkipped,
    screen,
    plan_path: path,
    properties: { field },
  };
}

export function voiceUsed(
  screen: ScreenId,
  field: string,
  path: PlanPath | null
): IntakeEventPayload {
  return {
    event: INTAKE_EVENTS.voiceUsed,
    screen,
    plan_path: path,
    properties: { field },
  };
}

export function recommendationShown(
  initiativeType: string,
  source: RecommendationSource,
  path: PlanPath | null
): IntakeEventPayload {
  return {
    event: INTAKE_EVENTS.recommendationShown,
    plan_path: path,
    properties: { initiative_type: initiativeType, source },
  };
}

export function recommendationAccepted(
  initiativeType: string,
  path: PlanPath | null
): IntakeEventPayload {
  return {
    event: INTAKE_EVENTS.recommendationAccepted,
    plan_path: path,
    properties: { initiative_type: initiativeType },
  };
}

/**
 * Dismiss and swap share an event, separated by `action`.
 *
 * Both are rejections of the same recommendation, so one event with an action
 * keeps the acceptance-rate query in REQ-14.4 a single aggregate rather than a
 * union of two.
 */
export function recommendationDismissed(
  initiativeType: string,
  action: "dismiss" | "swap",
  path: PlanPath | null
): IntakeEventPayload {
  return {
    event: INTAKE_EVENTS.recommendationDismissed,
    plan_path: path,
    properties: { initiative_type: initiativeType, action },
  };
}

export function planBuilt(
  path: PlanPath | null,
  initiativeCount: number,
  gapAmount: number
): IntakeEventPayload {
  return {
    event: INTAKE_EVENTS.planBuilt,
    plan_path: path,
    properties: { initiative_count: initiativeCount, gap_amount: gapAmount },
  };
}

/* ------------------------------------------------------------------ *
 * Abandonment (REQ-14.1)
 * ------------------------------------------------------------------ */

/** Idle time after which an unfinished intake counts as abandoned. */
export const ABANDON_AFTER_MINUTES = 30;

/**
 * `intake_abandoned` is DERIVED, never fired by the client.
 *
 * A browser that has closed the tab cannot report anything, and firing on
 * `beforeunload` would count every ordinary navigation as an abandonment —
 * inflating the number precisely where it needs to be trustworthy. Instead a
 * check marks any draft with no activity for 30 minutes and no
 * `intake_complete_at`.
 */
export function isAbandoned(
  lastActivityAt: string | Date | null | undefined,
  completedAt: string | Date | null | undefined,
  now: Date = new Date()
): boolean {
  if (completedAt) return false;
  if (!lastActivityAt) return false;

  const last = lastActivityAt instanceof Date ? lastActivityAt : new Date(lastActivityAt);
  if (Number.isNaN(last.getTime())) return false;

  const idleMinutes = (now.getTime() - last.getTime()) / 60000;
  return idleMinutes >= ABANDON_AFTER_MINUTES;
}

/* ------------------------------------------------------------------ *
 * Client transport
 * ------------------------------------------------------------------ */

/**
 * Send an event, ignoring failures.
 *
 * Analytics must never break the intake. A failed POST here is a lost row in a
 * funnel report; a thrown error would be a user stuck on a screen because their
 * ad blocker ate the request. So this swallows everything and returns whether
 * it landed, for callers that care.
 */
export async function trackIntakeEvent(
  payload: IntakeEventPayload
): Promise<boolean> {
  if (typeof fetch === "undefined") return false;
  try {
    const response = await fetch("/api/intake/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // The answer is never read, and keepalive lets the request outlive a
      // navigation that happens immediately after Next is clicked.
      keepalive: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}
