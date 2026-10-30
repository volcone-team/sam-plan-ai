import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import {
  REGISTRATION_OPEN_COLUMN,
  parseRegistrationToggle,
  readRegistrationOpen,
} from "@/lib/auth/registration-setting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether new customers can register
 * (migration 062, app_settings.registration_open, default open).
 * SUPER-ADMIN ONLY.
 *
 * GET -> { open, available }
 *   `available` false: 062 not applied; reads as open and cannot be saved.
 * PUT { open: boolean } -> { open }. 409 migration_required before 062.
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
  migration: "062_registration_open",
  message:
    "Migration 062 (062_registration_open.sql) has not been applied yet, so the switch cannot be saved.",
} as const;

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    const state = await readRegistrationOpen(adminClient());
    return NextResponse.json({ open: state.open, available: state.available });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/registration-toggle] GET error:", msg);
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
    const parsed = parseRegistrationToggle(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "open", message: parsed.message }, { status: 400 });
    }

    const db = adminClient();
    const before = await readRegistrationOpen(db);
    if (!before.available) return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });

    const { error } = await db.from("app_settings").upsert(
      {
        id: "global",
        [REGISTRATION_OPEN_COLUMN]: parsed.open,
        updated_by: check.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      if (isMissingColumnError(error)) return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
      console.error("[admin/registration-toggle] write failed:", error.message);
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
        action: "registration.updated",
        targetType: "app_settings",
        targetId: "global",
        targetLabel: `New registrations ${parsed.open ? "opened" : "closed"}`,
        metadata: { from: before.open, to: parsed.open },
      },
      db
    );

    return NextResponse.json({ open: parsed.open });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/registration-toggle] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
