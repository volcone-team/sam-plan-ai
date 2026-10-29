/**
 * Support contact details shown in the "Need Assistance?" footer.
 *
 * Stored in `app_settings.support_email` / `support_phone` (migration 059) and
 * edited on /admin/settings. Until they are set, or while 059 is not applied,
 * the footer falls back to the values it used to hardcode, so it is never blank.
 *
 * No React, no database.
 */

export interface SupportContact {
  email: string;
  /** As the admin typed it, e.g. "(901) 612-8106". */
  phoneDisplay: string;
  /** `sms:` link built from the digits, e.g. "sms:+19016128106". */
  phoneHref: string;
}

export const DEFAULT_SUPPORT_EMAIL = "support@samplanai.com";
export const DEFAULT_SUPPORT_PHONE = "(901) 612-8106";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS_RE = /^\+?[\d\s().-]+$/;

export function isUsableSupportEmail(value: unknown): value is string {
  return typeof value === "string" && EMAIL_RE.test(value.trim());
}

/** 7 to 15 digits, made of digits, spaces, ( ) . - and an optional leading +. */
export function isUsableSupportPhone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!PHONE_CHARS_RE.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/** `sms:` href. A bare 10-digit number is treated as US (+1). */
export function smsHref(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `sms:+${digits}`;
  if (digits.length === 10) return `sms:+1${digits}`;
  return `sms:+${digits}`;
}

/** Problem with an admin-entered value, or null when it is fine (empty clears it). */
export function describeSupportEmailProblem(value: string): string | null {
  if (!value.trim() || isUsableSupportEmail(value)) return null;
  return "Enter a full email address, for example support@samplan.ai.";
}

export function describeSupportPhoneProblem(value: string): string | null {
  if (!value.trim() || isUsableSupportPhone(value)) return null;
  return "Enter a phone number using digits, spaces, ( ) - or a leading +.";
}

/** What the footer renders: stored values when usable, the old constants otherwise. */
export function resolveSupportContact(row: {
  support_email?: string | null;
  support_phone?: string | null;
} | null | undefined): SupportContact {
  const email = isUsableSupportEmail(row?.support_email)
    ? row!.support_email!.trim()
    : DEFAULT_SUPPORT_EMAIL;
  const phone = isUsableSupportPhone(row?.support_phone)
    ? row!.support_phone!.trim()
    : DEFAULT_SUPPORT_PHONE;
  return { email, phoneDisplay: phone, phoneHref: smsHref(phone) };
}
