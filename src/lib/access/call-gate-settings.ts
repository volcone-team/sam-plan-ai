import type { SupabaseClient } from "@supabase/supabase-js";
// From its own module, not via @/lib/workbook/read (which re-exports it): this
// file is imported by the middleware, and the workbook graph has no business in
// the Edge bundle.
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import { isUsableBookingUrl } from "@/lib/billing/booking";

/**
 * The admin's onboarding-call settings (migration 043,
 * `app_settings.require_call_before_access` / `onboarding_call_url`), read
 * server-side.
 *
 * NEVER FAILS, and that is the whole point of the module. Migration 043 is
 * applied BY HAND, so this code runs for a while against a database that does
 * not have the columns. A missing column, a missing singleton row, an
 * unreadable table or a thrown client error all give the same answer: the
 * switch is OFF. Nothing is gated until the owner applies the migration and
 * turns it on deliberately.
 *
 * Failing OFF rather than ON is the only safe direction here. Reading an error
 * as "require a call" would lock every customer out of a product they have
 * paid for because a settings row was briefly unreadable.
 *
 * Follows src/lib/legal-urls.ts (validate the URL on the way out as well as
 * in) and src/lib/recommend/weight-setting.ts (missing column means default).
 */

export interface CallGateSettings {
  /** The global switch. Read only at company creation, never as a live gate. */
  requireCall: boolean;
  /** The GHL booking link for the thank-you page, or null when unusable/unset. */
  bookingUrl: string | null;
}

/** The answer whenever the setting cannot be read, and the shape of "off". */
export const CALL_GATE_OFF: CallGateSettings = {
  requireCall: false,
  bookingUrl: null,
};

/**
 * Read the switch and the booking link.
 *
 * `db` should be a service-role or server client: `app_settings` is admin
 * configuration and is not readable from the browser.
 */
export async function loadCallGateSettings(db: SupabaseClient): Promise<CallGateSettings> {
  const state = await readCallGateSettings(db);
  return { requireCall: state.requireCall, bookingUrl: state.bookingUrl };
}

export interface CallGateSettingsState extends CallGateSettings {
  /**
   * False when migration 043 has not been applied (columns missing).
   *
   * For the admin screen, so it can say "apply migration 043" instead of
   * showing a switch that silently does nothing. Everything else should use
   * `loadCallGateSettings` and ignore this.
   */
  available: boolean;
}

/** As loadCallGateSettings, also saying whether the columns exist. */
export async function readCallGateSettings(db: SupabaseClient): Promise<CallGateSettingsState> {
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("require_call_before_access, onboarding_call_url")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      const missing = isMissingColumnError(error);
      if (!missing) {
        // A real read failure is worth a line in the log; an unapplied
        // migration is expected and is not.
        console.error("[access/call-gate] settings read failed, gate off:", error.message);
      }
      return { ...CALL_GATE_OFF, available: !missing };
    }

    const row = (data ?? null) as {
      require_call_before_access?: unknown;
      onboarding_call_url?: unknown;
    } | null;

    return {
      // Strict true: a null column on a row written before the DEFAULT took
      // effect must not read as on.
      requireCall: row?.require_call_before_access === true,
      /*
       * Re-validated on the way OUT. The value is typed into an admin field
       * and rendered as a link a paying customer clicks, and a row can be
       * edited directly in the SQL editor — the thank-you page must not be the
       * first place a `javascript:` URL is discovered.
       */
      bookingUrl: isUsableBookingUrl(row?.onboarding_call_url)
        ? row.onboarding_call_url.trim()
        : null,
      available: true,
    };
  } catch (err: unknown) {
    console.error(
      "[access/call-gate] settings read threw, gate off:",
      err instanceof Error ? err.message : String(err)
    );
    return { ...CALL_GATE_OFF, available: true };
  }
}

/* ------------------------------------------------------------------ *
 * Stamping a new company
 * ------------------------------------------------------------------ */

/**
 * How long after a company is created the stamp may still be applied.
 *
 * NEEDED BECAUSE THE PUBLIC SIGNUP'S COMPANY ROW IS WRITTEN BY A DATABASE
 * TRIGGER (`handle_new_user`, latest version in migration 037), so the
 * application's first chance to stamp it is the new user's first server-side
 * request a moment later. That is close enough to creation to be the same
 * event — but without a bound it would also catch an EXISTING customer's next
 * request, and the owner's rule is that switching the gate on only affects
 * companies that sign up afterwards.
 *
 * Ten minutes, following the 5-minute grace `/api/billing/reconcile` uses for
 * the same kind of "is this the same event" judgement, with headroom for an
 * email-confirmation link opened a few minutes after registering.
 */
export const NEW_COMPANY_STAMP_GRACE_MS = 10 * 60 * 1000;

export type CallUnlockStampReason =
  /** The global switch is off, so there is nothing to stamp. */
  | "switch_off"
  /** Stamped: this company must book its call. */
  | "stamped"
  /** Older than the grace window, so not a new signup. Left alone. */
  | "too_old"
  /** Already flagged, or already granted. Left alone. */
  | "already_decided"
  /** Migration 043 is not applied, or the row could not be read/written. */
  | "unavailable";

export interface CallUnlockStampResult {
  /** True only when this call set the flag. */
  stamped: boolean;
  /** The switch as read, for the caller's logging. */
  requireCall: boolean;
  reason: CallUnlockStampReason;
}

/**
 * Apply the CURRENT global switch to a just-created company.
 *
 * Called at every company-creation path (see the report in the handover): the
 * admin "create company" route, and the first server-side touch of a public
 * signup, whose company row is written by a database trigger this cannot run
 * inside.
 *
 * NEVER THROWS. A company that fails to be stamped is a company that is not
 * gated, which is the same as the gate being off — annoying, and far better
 * than a signup that 500s because a settings column is missing.
 *
 * IDEMPOTENT, and refuses to undo anything:
 *   - it only ever sets the flag TRUE, never back to false, so a later read of
 *     a switched-off setting cannot release a company that is mid-gate;
 *   - it skips a company that already has a grant, so re-running cannot
 *     re-lock someone who has had their call;
 *   - it skips a company older than the grace window, so it cannot gate an
 *     existing customer.
 *
 * @param db        service-role client; `app_settings` and this column are not
 *                  writable from a customer session.
 * @param companyId the company just created.
 * @param options.maxAgeMs  grace window against `companies.created_at`. Pass
 *                  `null` for a path that KNOWS it just created the row (the
 *                  admin route), where the age check is pointless and would
 *                  only add a round trip.
 */
export async function stampCallUnlockForNewCompany(
  db: SupabaseClient,
  companyId: string,
  options?: { maxAgeMs?: number | null; now?: number }
): Promise<CallUnlockStampResult> {
  const settings = await loadCallGateSettings(db);

  // Read the switch FIRST: with the gate off (the normal case, and the only
  // case before 043 is applied) this costs one query and writes nothing.
  if (!settings.requireCall) {
    return { stamped: false, requireCall: false, reason: "switch_off" };
  }

  const maxAgeMs = options?.maxAgeMs === undefined ? NEW_COMPANY_STAMP_GRACE_MS : options.maxAgeMs;
  const now = options?.now ?? Date.now();

  try {
    const { data, error } = await db
      .from("companies")
      .select("id, created_at, requires_call_unlock, portal_access_granted_at")
      .eq("id", companyId)
      .maybeSingle();

    if (error || !data) {
      if (error && !isMissingColumnError(error)) {
        console.error("[access/call-gate] could not read the new company:", error.message);
      }
      return { stamped: false, requireCall: true, reason: "unavailable" };
    }

    const row = data as {
      created_at?: string | null;
      requires_call_unlock?: boolean | null;
      portal_access_granted_at?: string | null;
    };

    if (row.requires_call_unlock === true || row.portal_access_granted_at) {
      return { stamped: false, requireCall: true, reason: "already_decided" };
    }

    if (maxAgeMs !== null) {
      const createdAt = row.created_at ? Date.parse(row.created_at) : NaN;
      // An unparseable created_at is treated as too old: refusing to gate is
      // the recoverable mistake, gating an existing customer is not.
      if (!Number.isFinite(createdAt) || now - createdAt > maxAgeMs) {
        return { stamped: false, requireCall: true, reason: "too_old" };
      }
    }

    const { error: updateError } = await db
      .from("companies")
      .update({ requires_call_unlock: true })
      .eq("id", companyId)
      // Re-asserted in the WHERE as well as checked above, so two concurrent
      // first requests cannot race a grant that landed in between.
      .is("portal_access_granted_at", null);

    if (updateError) {
      if (!isMissingColumnError(updateError)) {
        console.error("[access/call-gate] stamp failed:", updateError.message);
      }
      return { stamped: false, requireCall: true, reason: "unavailable" };
    }

    return { stamped: true, requireCall: true, reason: "stamped" };
  } catch (err: unknown) {
    console.error(
      "[access/call-gate] stamp threw:",
      err instanceof Error ? err.message : String(err)
    );
    return { stamped: false, requireCall: true, reason: "unavailable" };
  }
}
