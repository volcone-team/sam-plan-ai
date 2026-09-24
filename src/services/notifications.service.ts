/**
 * Initiative notifications service.
 *
 * Orchestrates the daily reminder batch: load rules -> detect eligible
 * initiatives -> resolve recipients -> idempotently send. Uses the service-role
 * Supabase client (the cron endpoint has no user session). Pure decision logic
 * lives in `@/lib/notifications/logic`; this module is the DB + send wiring.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createAppNotification } from "./app-notifications.service";
import { sendEmail } from "@/lib/mailgun";
import { renderTemplate, type EmailTemplate } from "@/lib/notifications/render";
import { buildEmailBody, unsubscribeUrlFor } from "@/lib/notifications/unsubscribe-link";
import {
  DEFAULT_RULES,
  normalizeLeadTimes,
  targetDateFor,
  selectRecipients,
  ELIGIBLE_STATUSES,
  type NotificationRules,
  type RecipientRule,
  type ProfileLike,
} from "@/lib/notifications/logic";

const DATE_FIELDS = ["activation_date", "event_date"] as const;
type DateField = (typeof DATE_FIELDS)[number];

export interface RunSummary {
  ranAt: string;
  enabled: boolean;
  attempted: number;
  sent: number;
  skipped: number;
  failed: number;
  errors: { initiativeId: string; recipient: string; message: string }[];
}

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Load the global rules row, or coded safe defaults if absent (Req 2.7). */
export async function loadRules(db: SupabaseClient): Promise<NotificationRules> {
  const { data } = await db.from("notification_rules").select("*").eq("id", "global").maybeSingle();
  if (!data) return { ...DEFAULT_RULES };
  return {
    enabled: data.enabled ?? true,
    leadTimes: normalizeLeadTimes(data.lead_times) ,
    recipientRule: (data.recipient_rule as RecipientRule) || "owners_operators",
    templateKey: data.template_key || "initiative_reminder",
  };
}

async function loadTemplate(db: SupabaseClient, key: string): Promise<EmailTemplate | null> {
  const { data } = await db
    .from("email_templates")
    .select("subject, body_html, active")
    .eq("key", key)
    .maybeSingle();
  if (!data || data.active === false) return null;
  return { subject: data.subject, body_html: data.body_html };
}

/** Company profiles filtered by the recipient rule + opt-outs (Req 4). */
export async function resolveRecipients(
  db: SupabaseClient,
  companyId: string,
  rule: RecipientRule
): Promise<ProfileLike[]> {
  const { data: profiles } = await db
    .from("profiles")
    .select("id, email, role")
    .eq("company_id", companyId);
  const { data: optOuts } = await db
    .from("notification_opt_outs")
    .select("user_id");
  const optedOut = new Set((optOuts || []).map((o) => o.user_id as string));
  return selectRecipients((profiles || []) as ProfileLike[], rule, optedOut);
}

interface EligibleRow {
  id: string;
  company_id: string;
  name: string;
  activation_date: string;
  channel: string;
  dateField: DateField;
  leadDays: number;
  triggerDate: string;
}

/** Find initiatives whose trigger date is exactly a lead-time away (Req 1). */
export async function detectEligible(
  db: SupabaseClient,
  rules: NotificationRules,
  today: Date
): Promise<EligibleRow[]> {
  const out: EligibleRow[] = [];
  for (const leadDays of rules.leadTimes) {
    const target = targetDateFor(today, leadDays);
    for (const dateField of DATE_FIELDS) {
      const { data } = await db
        .from("initiatives")
        .select("id, company_id, name, activation_date, event_date, initiative_types(channel)")
        .in("status", ELIGIBLE_STATUSES as unknown as string[])
        .eq(dateField, target); // exactly leadDays out; null event_date never equals a date
      for (const r of data || []) {
        const it = (r as Record<string, unknown>).initiative_types as { channel?: string } | { channel?: string }[] | null;
        const channel = Array.isArray(it) ? it[0]?.channel : it?.channel;
        out.push({
          id: r.id as string,
          company_id: r.company_id as string,
          name: r.name as string,
          activation_date: r.activation_date as string,
          channel: channel || "initiative",
          dateField,
          leadDays,
          triggerDate: target,
        });
      }
    }
  }
  return out;
}

/**
 * Claim-before-send: insert a pending log row (UNIQUE guard), send, finalize.
 * Returns one of 'sent' | 'skipped' | 'failed'.
 */
async function claimAndSend(
  db: SupabaseClient,
  row: EligibleRow,
  recipient: ProfileLike,
  firstName: string | null,
  template: EmailTemplate | null
): Promise<"sent" | "skipped" | "failed"> {
  // 1. Claim via INSERT. UNIQUE violation => already handled -> skip (Req 3.2-3.4).
  const { data: claimed, error: claimErr } = await db
    .from("notification_log")
    .insert({
      initiative_id: row.id,
      recipient_user_id: recipient.id,
      recipient_email: recipient.email,
      date_field: row.dateField,
      lead_days: row.leadDays,
      trigger_date: row.triggerDate,
      status: "pending",
    })
    .select("id")
    .single();

  if (claimErr || !claimed) {
    // Most likely the UNIQUE constraint — someone already claimed this offset.
    return "skipped";
  }

  // 2. Render + 3. send. Every email carries a per-recipient unsubscribe link (Req 5.1).
  const rendered = renderTemplate(template, {
    firstName,
    initiativeName: row.name,
    channel: row.channel,
    daysUntil: row.leadDays,
    activationDate: row.activation_date,
  });
  const html = buildEmailBody(rendered.html, unsubscribeUrlFor(recipient.id));

  let messageId: string | null = null;
  try {
    messageId = await sendEmail({
      to: recipient.email!,
      subject: rendered.subject,
      html,
      tags: ["initiative-reminder"],
    });
  } catch (e) {
    await db
      .from("notification_log")
      .update({ status: "failed", error: e instanceof Error ? e.message : String(e), updated_at: new Date().toISOString() })
      .eq("id", claimed.id);
    return "failed";
  }

  // 4. Finalize. sendEmail returning null is a failure, not a success (Req 8.5).
  if (!messageId) {
    await db
      .from("notification_log")
      .update({ status: "failed", error: "sendEmail returned null", updated_at: new Date().toISOString() })
      .eq("id", claimed.id);
    return "failed";
  }

  await db
    .from("notification_log")
    .update({ status: "sent", provider_message_id: messageId, updated_at: new Date().toISOString() })
    .eq("id", claimed.id);

  // Mirror the email as an in-app notification (bell feed). The stable dedupeKey
  // matches the notification_log claim identity, so a re-run stays idempotent and
  // won't create a second in-app row. createAppNotification never throws and its
  // result is intentionally ignored — creating the bell item must never change
  // the fact that the email was sent.
  await createAppNotification(
    {
      userId: recipient.id,
      companyId: row.company_id,
      type: "initiative_reminder",
      title: `Your ${row.channel} "${row.name}" is coming up`,
      body: `${row.name} is scheduled for ${row.activation_date} — ${row.leadDays} day(s) away.`,
      link: "/initiatives/" + row.id,
      metadata: {
        initiativeId: row.id,
        dateField: row.dateField,
        leadDays: row.leadDays,
        triggerDate: row.triggerDate,
      },
      dedupeKey: `initiative_reminder:${row.id}:${row.dateField}:${row.leadDays}:${row.triggerDate}`,
    },
    db
  );

  return "sent";
}

/** Run the full reminder batch. `today` overridable for testing. */
export async function runInitiativeReminders(today: Date = new Date()): Promise<RunSummary> {
  const db = serviceClient();
  const summary: RunSummary = {
    ranAt: new Date().toISOString(),
    enabled: true,
    attempted: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const rules = await loadRules(db);
  if (!rules.enabled) {
    summary.enabled = false;
    return summary; // Req 2.4 — disabled means send nothing
  }
  if (rules.leadTimes.length === 0) return summary;

  const template = await loadTemplate(db, rules.templateKey);
  const eligible = await detectEligible(db, rules, today);

  // Cache recipients + first names per company to avoid repeat queries.
  const recipientCache = new Map<string, ProfileLike[]>();
  const firstNameCache = new Map<string, Map<string, string | null>>();

  for (const row of eligible) {
    let recipients = recipientCache.get(row.company_id);
    if (!recipients) {
      recipients = await resolveRecipients(db, row.company_id, rules.recipientRule);
      recipientCache.set(row.company_id, recipients);
      // fetch first names once per company
      const { data: profs } = await db
        .from("profiles")
        .select("id, first_name")
        .eq("company_id", row.company_id);
      const fnMap = new Map<string, string | null>();
      for (const p of profs || []) fnMap.set(p.id as string, (p.first_name as string) || null);
      firstNameCache.set(row.company_id, fnMap);
    }
    if (recipients.length === 0) continue; // Req 4.5

    const fnMap = firstNameCache.get(row.company_id)!;
    for (const recipient of recipients) {
      summary.attempted++;
      try {
        const result = await claimAndSend(db, row, recipient, fnMap.get(recipient.id) ?? null, template);
        summary[result === "sent" ? "sent" : result === "skipped" ? "skipped" : "failed"]++;
      } catch (e) {
        // Per-recipient failure must not stop the batch (Req 8.1).
        summary.failed++;
        summary.errors.push({
          initiativeId: row.id,
          recipient: recipient.id,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  return summary;
}
