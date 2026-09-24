import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";
import {
  DEFAULT_RULES,
  validateNotificationSettings,
} from "@/lib/notifications/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin notification rules + template API (Req 2).
 *
 * GET  → current notification_rules ('global' singleton, or coded DEFAULT_RULES
 *        if the row is absent) PLUS the selected email_templates row.
 * PUT  → validate then persist rules + template, stamping updated_by/updated_at.
 *
 * Both use the service-role client (like admin/stats) and are guarded by
 * requireAdmin(). All state lives in the DB — never localStorage (Req 2.2/2.3).
 *
 * Response shape (consumed by the admin page, Task 11):
 *   {
 *     rules:    { enabled, lead_times, recipient_rule, template_key },
 *     template: { key, subject, body_html, active }
 *   }
 */

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Load the rules row (or coded defaults) plus the selected template row. */
async function loadState(db: ReturnType<typeof adminClient>) {
  const { data: rulesRow } = await db
    .from("notification_rules")
    .select("enabled, lead_times, recipient_rule, template_key")
    .eq("id", "global")
    .maybeSingle();

  const rules = rulesRow
    ? {
        enabled: rulesRow.enabled as boolean,
        lead_times: (rulesRow.lead_times as number[]) ?? [],
        recipient_rule: rulesRow.recipient_rule as string,
        template_key: rulesRow.template_key as string,
      }
    : {
        enabled: DEFAULT_RULES.enabled,
        lead_times: DEFAULT_RULES.leadTimes,
        recipient_rule: DEFAULT_RULES.recipientRule,
        template_key: DEFAULT_RULES.templateKey,
      };

  const { data: tplRow } = await db
    .from("email_templates")
    .select("key, subject, body_html, active")
    .eq("key", rules.template_key)
    .maybeSingle();

  const template = tplRow
    ? {
        key: tplRow.key as string,
        subject: tplRow.subject as string,
        body_html: tplRow.body_html as string,
        active: tplRow.active as boolean,
      }
    : null;

  return { rules, template };
}

export async function GET() {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      console.log("[admin/notifications] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = adminClient();
    const state = await loadState(db);
    return NextResponse.json(state);
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/notifications] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      console.log("[admin/notifications] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    // Validate EVERYTHING before any write (Req 2.5/2.6).
    const result = validateNotificationSettings(body);
    if (!result.ok) {
      return NextResponse.json({ error: result.field }, { status: 400 });
    }
    const v = result.value;

    const db = adminClient();
    const now = new Date().toISOString();

    // Read current state so we can fill in any fields the caller omitted and
    // know which template row to update.
    const current = await loadState(db);

    const enabled = v.enabled ?? current.rules.enabled;
    const leadTimes = v.leadTimes ?? current.rules.lead_times;
    const recipientRule = v.recipientRule ?? current.rules.recipient_rule;
    const templateKey = current.rules.template_key;

    const { error: rulesErr } = await db
      .from("notification_rules")
      .upsert(
        {
          id: "global",
          enabled,
          lead_times: leadTimes,
          recipient_rule: recipientRule,
          template_key: templateKey,
          updated_by: check.userId,
          updated_at: now,
        },
        { onConflict: "id" }
      );
    if (rulesErr) {
      console.error("[admin/notifications] rules upsert error:", rulesErr.message);
      return NextResponse.json({ error: rulesErr.message }, { status: 500 });
    }

    // Only touch the template if subject/body were supplied.
    if (v.subject !== undefined || v.bodyHtml !== undefined) {
      const tplPatch: Record<string, unknown> = {
        updated_by: check.userId,
        updated_at: now,
      };
      if (v.subject !== undefined) tplPatch.subject = v.subject;
      if (v.bodyHtml !== undefined) tplPatch.body_html = v.bodyHtml;

      const { error: tplErr } = await db
        .from("email_templates")
        .update(tplPatch)
        .eq("key", templateKey);
      if (tplErr) {
        console.error("[admin/notifications] template update error:", tplErr.message);
        return NextResponse.json({ error: tplErr.message }, { status: 500 });
      }
    }

    const saved = await loadState(db);
    return NextResponse.json(saved);
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/notifications] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
