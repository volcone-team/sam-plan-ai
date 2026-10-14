import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { isUsableBookingUrl, resolveBookingUrls } from "@/lib/billing/booking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retention controls for the cancellation flow. SUPER-ADMIN ONLY, matching
 * /api/admin/chat-settings: these decide what is offered to a customer who is
 * about to leave, which is a commercial decision rather than day-to-day admin.
 *
 * Today that is the two coaching-call booking links. Both screens stay HIDDEN
 * until a URL is set here, so a half-configured flow never shows a customer a
 * button that goes nowhere.
 *
 * GET → the stored URLs, plus which screens they currently enable.
 * PUT → set or clear either URL.
 *
 * Body (both optional, null or "" clears):
 *   { resetCallUrl?: string|null, strategyCallUrl?: string|null }
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = adminClient();

    const { data: settings, error } = await db
      .from("app_settings")
      .select("retention_reset_call_url, retention_strategy_call_url")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      /**
       * Almost certainly migration 033 not applied yet. Reported plainly so the
       * admin sees a cause rather than empty fields that silently discard
       * whatever they type.
       */
      console.error("[admin/retention-settings] Read failed:", error.message);
      return NextResponse.json(
        { error: "settings_unavailable", message: error.message },
        { status: 503 }
      );
    }

    const row = settings as {
      retention_reset_call_url: string | null;
      retention_strategy_call_url: string | null;
    } | null;

    const resolved = resolveBookingUrls({
      resetCallUrl: row?.retention_reset_call_url,
      strategyCallUrl: row?.retention_strategy_call_url,
    });

    return NextResponse.json({
      // The raw stored values, so the form shows what was actually saved
      // rather than the resolved fallback.
      resetCallUrl: row?.retention_reset_call_url ?? null,
      strategyCallUrl: row?.retention_strategy_call_url ?? null,
      /**
       * What those values currently achieve. Shown in the UI because the
       * fallback (one URL serving both screens) is not obvious from the fields
       * alone, and an admin should be able to see which screens are live.
       */
      screens: {
        resetCallEnabled: !!resolved.resetCall,
        strategyCallEnabled: !!resolved.strategyCall,
        strategyUsesResetUrl:
          !!resolved.strategyCall && !row?.retention_strategy_call_url,
      },
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/retention-settings] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: { resetCallUrl?: unknown; strategyCallUrl?: unknown } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};
    const changed: Record<string, unknown> = {};

    /**
     * Validated with the same function the renderer trusts.
     *
     * These values end up as the href of a link a customer clicks, so a
     * `javascript:` URL typed here would be stored XSS. isUsableBookingUrl
     * requires https and is unit tested against exactly that.
     */
    const fields: [keyof typeof body, string][] = [
      ["resetCallUrl", "retention_reset_call_url"],
      ["strategyCallUrl", "retention_strategy_call_url"],
    ];

    for (const [key, column] of fields) {
      const raw = body[key];
      if (raw === undefined) continue;

      if (raw === null || raw === "") {
        patch[column] = null;
        changed[key] = null;
        continue;
      }

      if (!isUsableBookingUrl(raw)) {
        return NextResponse.json(
          {
            error: key,
            message:
              "Enter a full https:// booking link, for example " +
              "https://calendly.com/your-team/reset-call",
          },
          { status: 400 }
        );
      }

      patch[column] = raw.trim();
      changed[key] = raw.trim();
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
    }

    const db = adminClient();
    const now = new Date().toISOString();

    const { error } = await db
      .from("app_settings")
      .upsert(
        { id: "global", ...patch, updated_by: check.userId, updated_at: now },
        { onConflict: "id" }
      );

    if (error) {
      console.error("[admin/retention-settings] Write failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const { data: actor } = await db
      .from("profiles")
      .select("email")
      .eq("id", check.userId)
      .maybeSingle();

    await logActivity(
      {
        actorUserId: check.userId,
        actorEmail: (actor as { email?: string } | null)?.email ?? null,
        action: "retention_settings.updated",
        targetType: "app_settings",
        targetId: null,
        targetLabel: "retention",
        // The URLs themselves are recorded: they are operational config, not
        // customer data, and "who changed the booking link to what" is exactly
        // what an audit trail is for.
        metadata: { changed, fields: Object.keys(changed) },
      },
      db
    );

    return NextResponse.json({ updated: true, changed });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/retention-settings] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
