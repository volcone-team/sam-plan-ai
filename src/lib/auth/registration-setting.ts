import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/supabase/missing-column";

/**
 * The admin's switch for whether NEW CUSTOMERS can register
 * (migration 062, `app_settings.registration_open`, default true).
 * Set at /admin/settings.
 *
 * Closed blocks self-signup only: the signup form, /get-started and
 * POST /api/auth/signup. People an admin or an owner adds (team invites,
 * admin-created users and companies) are still created, and every existing
 * account keeps signing in and paying as before.
 *
 * NEVER FAILS, and fails OPEN. A missing column (062 not applied), a missing
 * row, a NULL or a read error all read as OPEN: a settings glitch must not
 * shut the door on customers the admin never meant to turn away.
 */
export const REGISTRATION_OPEN_COLUMN = "registration_open";

/**
 * app_metadata stamped on every account a super admin or an owner creates
 * through the service role. The migration 062 trigger lets these through
 * while registration is closed. app_metadata cannot be set by a browser
 * (supabase.auth.signUp only writes user_metadata), so a self-signup cannot
 * claim it.
 */
export const ADMIN_CREATED_APP_METADATA = Object.freeze({ created_by: "admin" });

export const REGISTRATION_CLOSED_MESSAGE =
  "We're not accepting new registrations right now. Please check back soon.";

export interface RegistrationSettingState {
  open: boolean;
  /** False when migration 062 has not been applied (column missing). */
  available: boolean;
}

export async function readRegistrationOpen(db: SupabaseClient): Promise<RegistrationSettingState> {
  try {
    const { data, error } = await db
      .from("app_settings")
      .select(REGISTRATION_OPEN_COLUMN)
      .eq("id", "global")
      .maybeSingle();
    if (error) {
      const missing = isMissingColumnError(error);
      if (!missing) {
        console.error("[auth/registration-setting] read failed, treating as open:", error.message);
      }
      return { open: true, available: !missing };
    }
    const raw = (data as { registration_open?: unknown } | null)?.registration_open;
    return { open: raw !== false, available: true };
  } catch (err: unknown) {
    console.error(
      "[auth/registration-setting] read threw, treating as open:",
      err instanceof Error ? err.message : String(err)
    );
    return { open: true, available: true };
  }
}

/** PUT /api/admin/registration-toggle body: `{ open: boolean }`, nothing coerced. */
export function parseRegistrationToggle(
  body: unknown
): { ok: true; open: boolean } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Body must be an object." };
  }
  const open = (body as { open?: unknown }).open;
  if (typeof open !== "boolean") return { ok: false, message: "`open` must be true or false." };
  return { ok: true, open };
}
