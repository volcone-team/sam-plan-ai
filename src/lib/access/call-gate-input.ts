import { isUsableBookingUrl } from "@/lib/billing/booking";

/**
 * Validation for the admin's onboarding-call settings write
 * (/api/admin/call-gate-settings PUT).
 *
 * ITS OWN PURE MODULE, following src/lib/legal-urls.ts: the route needs it on
 * the server and it is the only part of that endpoint worth testing — the rest
 * is an auth check, an upsert and an audit line. Keeping it out of
 * call-gate-settings.ts is deliberate too: that file is imported by the
 * middleware, so it carries only what the Edge bundle needs, and nothing in
 * the request path ever validates admin input.
 *
 * THREE FIELDS, ALL OPTIONAL, because the panel saves whichever the admin
 * touched and a PUT that names none is a mistake rather than a no-op worth
 * writing. (The yearly link, migration 048, is sent only when it changed, so a
 * database without 048 can still have its switch and monthly link saved.) Column names are produced here so the caller can hand the result
 * straight to the upsert without a second mapping to keep in step.
 */

export interface CallGateSettingsInput {
  requireCall?: unknown;
  /** The monthly link (`onboarding_call_url`), also used for trials. */
  bookingUrl?: unknown;
  /** The yearly link (`onboarding_call_url_yearly`, migration 048). */
  bookingUrlYearly?: unknown;
}

/** The column migration 048 adds. */
export const YEARLY_COLUMN = "onboarding_call_url_yearly";

/** Why an input was refused. Sent as the `error` field, so it is stable. */
export type CallGateInputError =
  /** `requireCall` was present but not a boolean. */
  | "requireCall"
  /** `bookingUrl` was present but is not a usable https link. */
  | "bookingUrl"
  /** `bookingUrlYearly` was present but is not a usable https link. */
  | "bookingUrlYearly"
  /** Neither field was present, so there is nothing to write. */
  | "nothing_to_update";

export type CallGateInputResult =
  | {
      ok: true;
      /** Column-keyed, ready for the `app_settings` upsert. */
      patch: Record<string, boolean | string | null>;
      /** The same values under their API names, for the audit log. */
      changed: Record<string, boolean | string | null>;
    }
  | { ok: false; error: CallGateInputError; message: string };

/**
 * The example link in the error message.
 *
 * GHL, because that is the calendar this gate was built for (the owner's
 * booking link on the thank-you page), unlike the retention fields which show
 * a Calendly example. Any https host is accepted — see isUsableBookingUrl for
 * why there is no allowlist.
 */
const BOOKING_URL_HINT =
  "Enter a full https:// booking link, for example " +
  "https://link.gohighlevel.com/widget/bookings/your-calendar";

/**
 * Turn a request body into an `app_settings` patch.
 *
 * `bookingUrl` of null or "" CLEARS the column, which is how an admin removes
 * a dead calendar; the thank-you page then renders its honest fallback instead
 * of a button that goes nowhere. An unusable value is refused rather than
 * silently stored as null, because "we quietly dropped your link" and "your
 * link is saved" look identical on the next load.
 *
 * `requireCall` is checked for an actual boolean instead of being coerced. A
 * truthy string from a hand-rolled curl would otherwise switch the gate on for
 * every future signup, and that is not a mistake worth guessing at.
 */
export function parseCallGateSettingsInput(body: unknown): CallGateInputResult {
  const input: CallGateSettingsInput =
    body && typeof body === "object" ? (body as CallGateSettingsInput) : {};

  const patch: Record<string, boolean | string | null> = {};
  const changed: Record<string, boolean | string | null> = {};

  if (input.requireCall !== undefined) {
    if (typeof input.requireCall !== "boolean") {
      return {
        ok: false,
        error: "requireCall",
        message: "The switch must be true or false.",
      };
    }
    patch.require_call_before_access = input.requireCall;
    changed.requireCall = input.requireCall;
  }

  if (input.bookingUrl !== undefined) {
    const raw = input.bookingUrl;
    if (raw === null || raw === "") {
      patch.onboarding_call_url = null;
      changed.bookingUrl = null;
    } else if (!isUsableBookingUrl(raw)) {
      return { ok: false, error: "bookingUrl", message: BOOKING_URL_HINT };
    } else {
      patch.onboarding_call_url = raw.trim();
      changed.bookingUrl = raw.trim();
    }
  }

  // Same rules as the monthly link. Blank clears it, which puts yearly
  // customers back on the monthly link rather than on no link at all.
  if (input.bookingUrlYearly !== undefined) {
    const raw = input.bookingUrlYearly;
    if (raw === null || raw === "") {
      patch[YEARLY_COLUMN] = null;
      changed.bookingUrlYearly = null;
    } else if (!isUsableBookingUrl(raw)) {
      return { ok: false, error: "bookingUrlYearly", message: BOOKING_URL_HINT };
    } else {
      patch[YEARLY_COLUMN] = raw.trim();
      changed.bookingUrlYearly = raw.trim();
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      error: "nothing_to_update",
      message: "Nothing to update.",
    };
  }

  return { ok: true, patch, changed };
}

/** 043's columns on `app_settings`. */
const MIGRATION_043_COLUMNS = ["require_call_before_access", "onboarding_call_url"];

/**
 * Which migration a missing-column write error points at.
 *
 * Called only after isMissingColumnError said yes. PostgREST names the column
 * it could not find, so the message decides when it can: a 043 column means
 * 043, the yearly column means 048. When the message names neither, a patch
 * that writes the yearly column is blamed on 048 and anything else on 043,
 * since 043's columns are the only other ones this route writes.
 *
 * The yearly name is checked FIRST because it contains `onboarding_call_url`
 * as a prefix and would otherwise match the 043 test.
 */
export function migrationForMissingColumn(
  error: { message?: string | null } | null,
  patch: Record<string, unknown>
): "043" | "048" {
  const message = error?.message ?? "";
  if (message.includes(YEARLY_COLUMN)) return "048";
  if (MIGRATION_043_COLUMNS.some((c) => message.includes(c))) return "043";
  return YEARLY_COLUMN in patch ? "048" : "043";
}
