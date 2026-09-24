/**
 * Pure decision logic for initiative notifications — no DB, no I/O.
 * Extracted so the tricky rules (date math, recipient filtering, defaults)
 * can be unit-tested in isolation from Supabase.
 */

export type RecipientRule = "all" | "owners_operators";

export interface NotificationRules {
  enabled: boolean;
  leadTimes: number[];
  recipientRule: RecipientRule;
  templateKey: string;
}

/** Safe defaults used when no rules row exists (Req 2.7). */
export const DEFAULT_RULES: NotificationRules = {
  enabled: true,
  leadTimes: [7, 2, 1],
  recipientRule: "owners_operators",
  templateKey: "initiative_reminder",
};

/** Normalize an admin-configured lead-time list: positive ints, deduped, sorted. */
export function normalizeLeadTimes(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<number>();
  for (const v of input) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) seen.add(n);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/** Format a Date as YYYY-MM-DD in UTC (matches the DATE columns + UTC cron). */
export function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The DATE that is `leadDays` ahead of `today`, as YYYY-MM-DD (UTC). */
export function targetDateFor(today: Date, leadDays: number): string {
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + leadDays);
  return toDateStr(t);
}

/** Statuses that are still "upcoming" and eligible for a reminder (Req 1.3). */
export const ELIGIBLE_STATUSES = ["planned", "in_progress", "launched"] as const;

export function isEligibleStatus(status: string): boolean {
  return (ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

export interface ProfileLike {
  id: string;
  email: string | null;
  role: string;
}

/**
 * Filter a company's profiles down to who should receive a reminder (Req 4).
 * @param optedOut set of user ids that have unsubscribed
 */
export function selectRecipients(
  profiles: ProfileLike[],
  rule: RecipientRule,
  optedOut: Set<string>
): ProfileLike[] {
  return profiles.filter((p) => {
    if (!p.email || !p.email.trim()) return false; // Req 4.3
    if (optedOut.has(p.id)) return false; // Req 4.4 / 5.3
    if (rule === "owners_operators") return p.role === "owner" || p.role === "operator";
    return true; // "all"
  });
}

/**
 * Pure validation for the admin notification settings PUT payload (Req 2.5, 2.6).
 *
 * Validates whatever subset of fields is present. Rules fields (enabled,
 * lead_times, recipient_rule) and template fields (subject, body_html) are all
 * optional individually, but any field that IS present must be well-formed or
 * the whole call is rejected — the route must write NOTHING on failure.
 *
 * On success the returned `value` carries the cleaned fields that were present:
 *  - enabled: boolean
 *  - leadTimes: number[] normalized (positive ints, deduped, sorted)
 *  - recipientRule: RecipientRule
 *  - subject / bodyHtml: trimmed-non-empty strings
 * Callers apply defaults for any absent field.
 */
export interface ValidatedSettings {
  enabled?: boolean;
  leadTimes?: number[];
  recipientRule?: RecipientRule;
  subject?: string;
  bodyHtml?: string;
}

export type ValidationResult =
  | { ok: true; value: ValidatedSettings }
  | { ok: false; field: string };

/** True only for a finite integer strictly greater than zero. */
function isPositiveInt(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export function validateNotificationSettings(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, field: "body" };
  }
  const obj = input as Record<string, unknown>;
  const value: ValidatedSettings = {};

  if ("enabled" in obj && obj.enabled !== undefined) {
    if (typeof obj.enabled !== "boolean") return { ok: false, field: "enabled" };
    value.enabled = obj.enabled;
  }

  if ("lead_times" in obj && obj.lead_times !== undefined) {
    const raw = obj.lead_times;
    if (!Array.isArray(raw)) return { ok: false, field: "lead_times" };
    // Reject clearly-invalid entries (strings, negatives, floats, non-numbers).
    // An empty array is allowed and means "send nothing".
    for (const el of raw) {
      if (!isPositiveInt(el)) return { ok: false, field: "lead_times" };
    }
    value.leadTimes = normalizeLeadTimes(raw);
  }

  if ("recipient_rule" in obj && obj.recipient_rule !== undefined) {
    if (obj.recipient_rule !== "all" && obj.recipient_rule !== "owners_operators") {
      return { ok: false, field: "recipient_rule" };
    }
    value.recipientRule = obj.recipient_rule;
  }

  if ("subject" in obj && obj.subject !== undefined) {
    if (typeof obj.subject !== "string" || obj.subject.trim() === "") {
      return { ok: false, field: "subject" };
    }
    value.subject = obj.subject;
  }

  if ("body_html" in obj && obj.body_html !== undefined) {
    if (typeof obj.body_html !== "string" || obj.body_html.trim() === "") {
      return { ok: false, field: "body_html" };
    }
    value.bodyHtml = obj.body_html;
  }

  return { ok: true, value };
}
