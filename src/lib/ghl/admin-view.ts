import { GHL_DRY_RUN_MARKER } from "@/lib/ghl/drain";
import {
  describeGhlConfig,
  GHL_ENV_LOCATION_ID,
  GHL_ENV_PRIVATE_TOKEN,
  type GhlConfig,
} from "@/lib/ghl/config";
import {
  FIXED_TAGS,
  TAG_CANCELLATION,
  TAG_FINISHED_INTAKE,
  TAG_FIRST_LOGIN,
  TAG_FOUNDER,
  TAG_INACTIVE_30,
  TAG_INACTIVE_60,
  TAG_INACTIVE_90,
  TAG_LOGIN_TRIGGER,
  TAG_ONBOARDING_CALL_BOOKED,
  TAG_ONBOARDING_PETE_BOOKED,
  TAG_ONBOARDING_RACHEL_BOOKED,
  TAG_OPTED_COMMUNICATION,
  TAG_OPTED_DND,
  TAG_PLAN_GENERATED,
  TAG_REGISTERED_NOT_PAID,
} from "@/lib/ghl/tags";

/**
 * Presentation logic for the GoHighLevel admin panel.
 *
 * SPLIT OUT OF THE COMPONENT so the two judgements that are easy to get wrong
 * are testable without rendering anything:
 *
 *   1. `skipped` IS A TERMINAL SUCCESS. 044 says so in a COMMENT and says why:
 *      "the contact does not exist in that sub-account" is a legitimate answer,
 *      not a fault, and it must not be retried and must not show up as an
 *      error on the admin screen. Every place that could accidentally count it
 *      as a problem — the "needs attention" number, the row tone, the retry
 *      scope — resolves through this module.
 *   2. A DRY-RUN ROW IS `delivered` AND REACHED NOBODY. The drain marks it
 *      delivered because there is nothing left to do with it, and writes a
 *      marker so neither an operator nor a later query mistakes it for a real
 *      write. Rendering it as a plain delivery would be the single most
 *      misleading thing this screen could do.
 *
 * Pure: no React, no fetch, no Supabase. Imports one constant from `drain.ts`
 * rather than restating it, because a marker that drifts is a marker that
 * silently stops marking.
 */

/** The `status` CHECK from 044, verbatim. */
export const GHL_OUTBOX_STATUSES = ["pending", "delivered", "failed", "skipped"] as const;

export type GhlOutboxStatus = (typeof GHL_OUTBOX_STATUSES)[number];

export interface GhlOutboxCounts {
  pending: number;
  delivered: number;
  failed: number;
  skipped: number;
  /** Pending rows whose `next_attempt_at` has passed: work the drain can do now. */
  dueNow: number;
}

export interface GhlOutboxSummary {
  total: number;
  /**
   * The only number an operator has to act on.
   *
   * `failed` ALONE. Not `failed + skipped`, for the reason at the top of this
   * file; not `failed + pending`, because a pending row is the system working
   * — it is either waiting for the next cron tick or backing off from a
   * transient GHL error, and both resolve themselves.
   */
  needsAttention: number;
  /** Rows the drain still owes an answer on. Informational. */
  inFlight: number;
}

export function summariseGhlOutbox(counts: GhlOutboxCounts): GhlOutboxSummary {
  return {
    total: counts.pending + counts.delivered + counts.failed + counts.skipped,
    needsAttention: counts.failed,
    inFlight: counts.pending,
  };
}

/** How a status reads to a human, and how loudly. */
export type GhlStatusTone = "ok" | "muted" | "error";

export interface GhlStatusDescription {
  label: string;
  tone: GhlStatusTone;
  /** False only for `pending`: the drain will come back to it. */
  terminal: boolean;
  /** One line of "what this means", for a title attribute or a legend. */
  detail: string;
}

export function describeGhlRowStatus(status: string | null): GhlStatusDescription {
  switch (status) {
    case "delivered":
      return {
        label: "Delivered",
        tone: "ok",
        terminal: true,
        detail: "GoHighLevel accepted the tag changes.",
      };
    case "skipped":
      return {
        label: "Skipped",
        // MUTED, NOT `error`. The one presentational decision in this file
        // that 044 legislates directly.
        tone: "muted",
        terminal: true,
        detail:
          "The contact is not in GoHighLevel and this event does not create one. " +
          "A normal outcome, not a failure — nothing to retry.",
      };
    case "failed":
      return {
        label: "Failed",
        tone: "error",
        terminal: true,
        detail:
          "Gave up after the retry budget, or hit an error only a human can clear. " +
          "Fix the cause, then retry the row.",
      };
    case "pending":
      return {
        label: "Pending",
        tone: "muted",
        terminal: false,
        detail: "Queued. The next drain will pick it up once its retry time passes.",
      };
    default:
      // Not reachable through 044's CHECK, so it means the row was written by
      // something this screen does not know about. Said plainly rather than
      // rendered as a blank cell.
      return {
        label: status ? `Unknown (${status})` : "Unknown",
        tone: "error",
        terminal: false,
        detail: "Not one of the four statuses migration 044 allows.",
      };
  }
}

/** The columns the panel needs to tell a dry-run row from a real delivery. */
export interface GhlDryRunMarkers {
  last_error?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Did this row reach GoHighLevel, or only a log line?
 *
 * BOTH MARKERS CHECKED, EITHER SUFFICES. The drain writes the marker to
 * `last_error` AND sets `payload.ghl_dry_run`, and the two can legitimately
 * diverge over a row's life: a later real delivery clears `last_error` but
 * leaves the old payload key, and a row delivered before the payload flag
 * existed carries only the string. Reading one would mislabel the other, and
 * mislabelling in the direction of "this was sent for real" is the expensive
 * mistake.
 */
export function isGhlDryRunRow(row: GhlDryRunMarkers): boolean {
  if (row.payload?.ghl_dry_run === true) return true;
  return (row.last_error ?? "") === GHL_DRY_RUN_MARKER;
}

/**
 * `last_error` on a delivered dry-run row is a NOTE, not an error.
 *
 * Returns null for it so the log's error column stays empty rather than
 * reporting the thing that went right.
 */
export function ghlRowErrorText(
  row: GhlDryRunMarkers & { status?: string | null }
): string | null {
  const text = (row.last_error ?? "").trim();
  if (text === "") return null;
  if (isGhlDryRunRow(row)) return null;
  // A `skipped` row's last_error holds the reason it was skipped, which is
  // information, not a fault — the caller tones it down via
  // `describeGhlRowStatus`, so it is still returned here.
  return text;
}

/* ------------------------------------------------------------------ *
 * The credential-free view of a config
 * ------------------------------------------------------------------ */

export interface GhlSettingsPayload {
  status: GhlConfig["status"];
  description: string;
  available: boolean;
  mayWrite: boolean;
  /** PRESENCE ONLY. */
  env: { locationId: boolean; token: boolean };
  /** NAMES ONLY, so the panel can say what to set in Vercel. */
  envVars: { locationId: string; token: string };
}

/**
 * Everything the admin panel is allowed to know about the configuration.
 *
 * BUILT FIELD BY FIELD, NEVER SPREAD. A `live` config carries
 * `credentials: { locationId, token }`, so `{ ...config }` — the obvious
 * shorthand, and the one a future edit will reach for — would put the client's
 * Private Integration Token in an HTTP response and in whatever logs or
 * browser devtools see it. An explicit projection cannot do that by accident,
 * and `admin-view.test.ts` asserts the serialised payload contains neither
 * value for a live config rather than leaving it to review.
 *
 * A PURE FUNCTION RATHER THAN A FEW LINES IN THE ROUTE, precisely so that
 * assertion is possible: the route itself has no injection seam worth the
 * ceremony (`requireSuperAdmin` reads cookies, the client needs the service
 * key), but this is where the leak would happen and this is testable.
 */
export function ghlSettingsPayload(config: GhlConfig): GhlSettingsPayload {
  return {
    status: config.status,
    /** Credential-free by contract — see `describeGhlConfig`. */
    description: describeGhlConfig(config),
    /** False → migration 044 is missing; the UI disables everything. */
    available: config.available,
    /** True only on `live`. */
    mayWrite: config.mayWrite,
    env: { locationId: config.env.locationId, token: config.env.token },
    envVars: { locationId: GHL_ENV_LOCATION_ID, token: GHL_ENV_PRIVATE_TOKEN },
  };
}

/** Event types, as 044's CHECK spells them, in words an operator recognises. */
export function describeGhlEventType(eventType: string | null): string {
  switch (eventType) {
    case "buyer_state":
      return "Buyer state";
    case "founder":
      return "Founding member";
    case "cancellation":
      return "Cancellation";
    case "finished_intake":
      return "Finished intake";
    case "plan_generated":
      return "Plan generated";
    case "first_login":
      return "First login";
    case "marketing_suppression":
      return "Marketing suppression";
    case "registered":
      return "Registered";
    case "consent":
      return "Invite consent";
    default:
      // `login_trigger` lands here by design: the client dropped that tag, so
      // nothing enqueues one any more, but 044's CHECK still accepts it and an
      // old row could exist. Shown as-is rather than given a friendly name
      // that would imply it is still a thing.
      return eventType ?? "—";
  }
}

/* ------------------------------------------------------------------ *
 * The fixed tags, for the panel's reference list
 * ------------------------------------------------------------------ */

/** One line per fixed tag: what it means in the client's CRM. */
const FIXED_TAG_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  [TAG_FOUNDER]: "Founding-member cohort. Added once, never removed by the app.",
  [TAG_ONBOARDING_PETE_BOOKED]: "Onboarding call booked with Pete.",
  [TAG_ONBOARDING_RACHEL_BOOKED]: "Onboarding call booked with Rachel.",
  [TAG_ONBOARDING_CALL_BOOKED]: "Onboarding call booked with any coach.",
  [TAG_LOGIN_TRIGGER]: "Login workflow trigger. Dropped by the client; nothing sends it now.",
  [TAG_INACTIVE_90]: "Has not logged in for 90 days or more.",
  [TAG_INACTIVE_60]: "Has not logged in for 60 days.",
  [TAG_INACTIVE_30]: "Has not logged in for 30 days.",
  [TAG_FIRST_LOGIN]: "First time the owner was seen signed in.",
  [TAG_PLAN_GENERATED]: "The company generated its first plan.",
  [TAG_FINISHED_INTAKE]: "The company finished the intake.",
  [TAG_CANCELLATION]: "The subscription was cancelled.",
  [TAG_REGISTERED_NOT_PAID]:
    "Owner signed up through the public signup and has not paid (trials included). Removed when they become an active buyer.",
  [TAG_OPTED_DND]:
    "Owner left the promotional consent box unticked, at signup or when an invited owner set their password. Added once, never removed by the app.",
  [TAG_OPTED_COMMUNICATION]:
    "Owner ticked the promotional consent box, at signup or when an invited owner set their password. Added once, never removed by the app.",
});

export interface GhlFixedTagRow {
  tag: string;
  description: string;
}

/** Every fixed tag, in contract order, with its one-line description. */
export function describeGhlFixedTags(): GhlFixedTagRow[] {
  return FIXED_TAGS.map((tag) => ({
    tag,
    description: FIXED_TAG_DESCRIPTIONS[tag] ?? "",
  }));
}
