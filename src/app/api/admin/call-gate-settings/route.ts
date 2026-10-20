import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { readCallGateSettings } from "@/lib/access/call-gate-settings";
import { parseCallGateSettingsInput } from "@/lib/access/call-gate-input";
import { isMissingColumnError } from "@/lib/supabase/missing-column";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The onboarding call gate's global switch and booking link (migration 043).
 *
 * SUPER-ADMIN ONLY, matching /api/admin/retention-settings: this decides
 * whether a paying customer lands in the portal or on a thank-you page waiting
 * for a human, which is a commercial decision rather than day-to-day admin.
 *
 * GET → the stored switch and URL, plus whether migration 043 is applied.
 * PUT → set the switch, set or clear the URL.
 *
 * Body (both optional, null or "" clears the URL):
 *   { requireCall?: boolean, bookingUrl?: string|null }
 *
 * WHAT THIS ENDPOINT DOES NOT DO: it never touches an existing company. The
 * switch is snapshotted onto a company at creation
 * (stampCallUnlockForNewCompany), so turning it on here affects signups from
 * now on and nobody who is already using the product. That is the owner's
 * rule, and it is enforced by never writing `companies` from here at all.
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

/**
 * The answer when the columns are not there yet.
 *
 * 409, not 500 and not 503: nothing has failed and retrying will not help —
 * the database is simply a migration behind, which is a normal state in this
 * project (they are applied by hand). The admin screen keys off
 * `migration_required` to say so and disable its controls, rather than showing
 * a switch that silently discards what it is told.
 */
const MIGRATION_REQUIRED = {
  error: "migration_required",
  migration: "043_call_before_access",
  message:
    "Migration 043 (043_call_before_access.sql) has not been applied to this " +
    "database yet, so the onboarding call gate cannot be configured. Run it " +
    "in the Supabase SQL editor, then reload this page.",
} as const;

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    // Reused rather than re-queried: readCallGateSettings already distinguishes
    // "not applied" from "off" and re-validates the stored URL on the way out,
    // and a second hand-rolled read here would be a second thing to keep in
    // step with the gate the customer actually meets.
    const state = await readCallGateSettings(adminClient());

    return NextResponse.json({
      requireCall: state.requireCall,
      bookingUrl: state.bookingUrl,
      /** False → migration 043 is missing; the UI disables everything. */
      available: state.available,
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/call-gate-settings] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const parsed = parseCallGateSettingsInput(body);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: parsed.error, message: parsed.message },
        { status: 400 }
      );
    }

    const db = adminClient();
    const now = new Date().toISOString();

    const { error } = await db
      .from("app_settings")
      .upsert(
        { id: "global", ...parsed.patch, updated_by: check.userId, updated_at: now },
        { onConflict: "id" }
      );

    if (error) {
      if (isMissingColumnError(error)) {
        return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
      }
      console.error("[admin/call-gate-settings] Write failed:", error.message);
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
        action: "call_gate_settings.updated",
        targetType: "app_settings",
        targetId: null,
        targetLabel: "onboarding_call",
        // Values recorded in full: this is operational config, not customer
        // data, and "who switched the gate on, and when" is the one question
        // an audit trail has to answer if a signup cohort gets locked out.
        metadata: { changed: parsed.changed, fields: Object.keys(parsed.changed) },
      },
      db
    );

    return NextResponse.json({ updated: true, changed: parsed.changed });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/call-gate-settings] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
