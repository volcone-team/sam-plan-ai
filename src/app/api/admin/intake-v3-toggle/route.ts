import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { loadLibraryConfigs } from "@/lib/intake-v3/config-repo";
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import {
  INTAKE_V3_COLUMN,
  parseIntakeV3ToggleInput,
  readIntakeV3Enabled,
} from "@/lib/intake-v3/rollout-setting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The on/off switch for the new Initiative Intake in the Add Initiative panel
 * (migration 047, app_settings.intake_v3_enabled, default off).
 * SUPER-ADMIN ONLY, matching /api/admin/initiative-config.
 *
 * GET → { enabled, available, offeredInPicker }
 *   `available` false: 047 not applied; the switch reads as off and cannot be saved.
 *   `offeredInPicker`: records the new picker would show (active and valid),
 *   null if the library config could not be loaded.
 * PUT { enabled: boolean } → { enabled }. 409 migration_required before 047.
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
  migration: "047_intake_v3_toggle",
  message:
    "Migration 047 (047_intake_v3_toggle.sql) has not been applied yet, so the switch " +
    "cannot be saved. Customers see the current form until then.",
} as const;

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const db = adminClient();
    const [state, loaded] = await Promise.all([readIntakeV3Enabled(db), loadLibraryConfigs(db)]);
    return NextResponse.json({
      enabled: state.enabled,
      available: state.available,
      offeredInPicker: loaded.ok ? loaded.summary.offeredInPicker : null,
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/intake-v3-toggle] GET error:", msg);
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
    const parsed = parseIntakeV3ToggleInput(body);
    if (!parsed.ok) {
      return NextResponse.json({ error: "enabled", message: parsed.message }, { status: 400 });
    }

    const db = adminClient();
    const before = await readIntakeV3Enabled(db);
    if (!before.available) return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });

    const { error } = await db.from("app_settings").upsert(
      {
        id: "global",
        [INTAKE_V3_COLUMN]: parsed.enabled,
        updated_by: check.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      if (isMissingColumnError(error)) return NextResponse.json(MIGRATION_REQUIRED, { status: 409 });
      console.error("[admin/intake-v3-toggle] write failed:", error.message);
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
        action: "intake_v3_toggle.updated",
        targetType: "app_settings",
        targetId: "global",
        targetLabel: `New initiative form ${parsed.enabled ? "on" : "off"}`,
        metadata: { from: before.enabled, to: parsed.enabled },
      },
      db
    );

    return NextResponse.json({ enabled: parsed.enabled });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/intake-v3-toggle] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
