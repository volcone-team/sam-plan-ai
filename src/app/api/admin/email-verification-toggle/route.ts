import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import {
  EMAIL_VERIFICATION_COLUMN,
  parseToggleInput,
  readRequireEmailVerification,
} from "@/lib/auth/email-verification-setting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether new customers must confirm their email before paying
 * (migration 049, app_settings.require_email_verification, default off).
 * SUPER-ADMIN ONLY.
 *
 * GET → { required, available }
 *   `available` false: 049 not applied; the switch reads as off and cannot be saved.
 * PUT { required: boolean } → { required }. 409 migration_required before 049.
 */
function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const MIGRATION_REQUIRED = {
  error: "migration_required",
  migration: "049_require_email_verification",
  message:
    "Migration 049 (049_require_email_verification.sql) has not been applied yet, so the " +
    "switch cannot be saved.",
} as const;

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const state = await readRequireEmailVerification(adminClient());
    return NextResponse.json({ required: state.required, available: state.available });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/email-verification-toggle] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }
    const parsed = parseToggleInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "required", message: parsed.message }, { status: 400 });
    }

    const db = adminClient();
    const before = await readRequireEmailVerification(db);
    if (!before.available) return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });

    const { error } = await db.from("app_settings").upsert(
      {
        id: "global",
        [EMAIL_VERIFICATION_COLUMN]: parsed.required,
        updated_by: check.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      if (isMissingColumnError(error)) return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
      console.error("[admin/email-verification-toggle] write failed:", error.message);
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
        action: "email_verification.updated",
        targetType: "app_settings",
        targetId: "global",
        targetLabel: `Email verification at signup ${parsed.required ? "required" : "not required"}`,
        metadata: { from: before.required, to: parsed.required },
      },
      db
    );

    return NextResponse.json({ required: parsed.required });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/email-verification-toggle] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
