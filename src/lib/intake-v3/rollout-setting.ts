import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/supabase/missing-column";

/**
 * The admin's on/off switch for the new Initiative Intake in the Add
 * Initiative panel (migration 047, `app_settings.intake_v3_enabled`).
 *
 * DEFAULT OFF. Customers keep the current Add Initiative form until a super
 * admin switches this on at /admin/initiative-config. Super admins always get
 * the new form, so they can preview it while customers do not.
 *
 * NEVER FAILS. A missing column (047 not applied), a missing singleton row, a
 * NULL, an unreadable table or a thrown client all read as OFF: the fallback
 * is the form customers already have, so off is the safe side.
 */

export const INTAKE_V3_COLUMN = "intake_v3_enabled";

export interface IntakeV3SettingState {
  enabled: boolean;
  /** False when migration 047 has not been applied (column missing). */
  available: boolean;
}

export async function readIntakeV3Enabled(db: SupabaseClient): Promise<IntakeV3SettingState> {
  try {
    const { data, error } = await db
      .from("app_settings")
      .select(INTAKE_V3_COLUMN)
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      const missing = isMissingColumnError(error);
      if (!missing) console.error("[intake-v3/setting] read failed, treating as off:", error.message);
      return { enabled: false, available: !missing };
    }
    const raw = (data as { intake_v3_enabled?: unknown } | null)?.intake_v3_enabled;
    return { enabled: raw === true, available: true };
  } catch (err: unknown) {
    console.error(
      "[intake-v3/setting] read threw, treating as off:",
      err instanceof Error ? err.message : String(err)
    );
    return { enabled: false, available: true };
  }
}

/** The same rule as requireSuperAdmin, on a profile row already read. */
export function isSuperAdminProfile(
  profile: { is_admin?: unknown; admin_level?: unknown } | null | undefined
): boolean {
  return profile?.is_admin === true && profile.admin_level === "super_admin";
}

/**
 * What GET /api/intake-v3/picker serves.
 *   serve    the switch is on: real data for everyone.
 *   preview  the switch is off, caller is a super admin: real data, marked preview.
 *   off      the switch is off: the empty disabled body.
 */
export type PickerAccess = "serve" | "preview" | "off";

export function pickerAccess(enabled: boolean, isSuperAdmin: boolean): PickerAccess {
  if (enabled) return "serve";
  return isSuperAdmin ? "preview" : "off";
}

/** The 200 body when the switch is off and the caller is not a super admin. */
export function disabledPickerBody() {
  return { enabled: false as const, items: [] as never[], configs: {}, recentKeys: [] as string[] };
}

/** PUT /api/admin/intake-v3-toggle body: `{ enabled: boolean }`, nothing coerced. */
export function parseIntakeV3ToggleInput(
  body: unknown
): { ok: true; enabled: boolean } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Body must be an object." };
  }
  const enabled = (body as { enabled?: unknown }).enabled;
  if (typeof enabled !== "boolean") {
    return { ok: false, message: "`enabled` must be true or false." };
  }
  return { ok: true, enabled };
}
