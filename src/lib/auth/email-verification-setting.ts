import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/supabase/missing-column";

/**
 * The admin's switch for whether new customers must confirm their email
 * before paying (migration 049, `app_settings.require_email_verification`).
 *
 * DEFAULT OFF. Off: the app's own signup route creates the customer already
 * confirmed and they go straight to payment. On: the old flow, Supabase sends
 * a confirmation email first. Set at /admin/subscriptions.
 *
 * NEVER FAILS. A missing column (049 not applied), a missing singleton row, a
 * NULL, an unreadable table or a thrown client all read as OFF.
 */
export const EMAIL_VERIFICATION_COLUMN = "require_email_verification";

export interface EmailVerificationSettingState {
  required: boolean;
  /** False when migration 049 has not been applied (column missing). */
  available: boolean;
}

export async function readRequireEmailVerification(
  db: SupabaseClient
): Promise<EmailVerificationSettingState> {
  try {
    const { data, error } = await db
      .from("app_settings")
      .select(EMAIL_VERIFICATION_COLUMN)
      .eq("id", "global")
      .maybeSingle();
    if (error) {
      const missing = isMissingColumnError(error);
      if (!missing) {
        console.error("[auth/email-verification-setting] read failed, treating as off:", error.message);
      }
      return { required: false, available: !missing };
    }
    const raw = (data as { require_email_verification?: unknown } | null)?.require_email_verification;
    return { required: raw === true, available: true };
  } catch (err: unknown) {
    console.error(
      "[auth/email-verification-setting] read threw, treating as off:",
      err instanceof Error ? err.message : String(err)
    );
    return { required: false, available: true };
  }
}

/** PUT /api/admin/email-verification-toggle body: `{ required: boolean }`, nothing coerced. */
export function parseToggleInput(
  body: unknown
): { ok: true; required: boolean } | { ok: false; message: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "Body must be an object." };
  }
  const required = (body as { required?: unknown }).required;
  if (typeof required !== "boolean") {
    return { ok: false, message: "`required` must be true or false." };
  }
  return { ok: true, required };
}
