import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { loadLibraryConfigs, saveLibraryConfig } from "@/lib/intake-v3/config-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-record Initiative Intake configuration (initiative_library_config, 045).
 * SUPER-ADMIN ONLY, same as /api/admin/initiative-library.
 *
 * GET → every library record with its saved row, settings, effective config
 *       (saved over derived), validation, plus summary and reconciliation.
 * PUT → { initiativeKey, patch }. 400 bad body, 404 unknown key, 422 invalid.
 *
 * Service-role client: the table's RLS allows authenticated SELECT only.
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

export async function GET() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const result = await loadLibraryConfigs(adminClient());
    if (!result.ok) {
      console.error("[admin/initiative-config] Load failed:", result.error);
      return NextResponse.json(
        { error: "config_unavailable", message: result.error },
        { status: 503 }
      );
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/initiative-config] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: { initiativeKey?: unknown; patch?: unknown } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    const db = adminClient();
    const result = await saveLibraryConfig(db, body.initiativeKey, body.patch, check.userId);

    if (!result.ok) {
      switch (result.reason) {
        case "bad_request":
          return NextResponse.json({ error: "bad_request", errors: result.errors }, { status: 400 });
        case "not_found":
          return NextResponse.json({ error: "not_found", message: result.message }, { status: 404 });
        case "invalid":
          return NextResponse.json({ error: "invalid_config", problems: result.problems }, { status: 422 });
        default:
          console.error("[admin/initiative-config] Write failed:", result.message);
          return NextResponse.json({ error: result.message }, { status: 500 });
      }
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
        action: "initiative_config.updated",
        targetType: "initiative_library_config",
        targetId: result.initiativeKey,
        targetLabel: result.initiativeKey,
        metadata: {
          fields: Object.keys((body.patch as Record<string, unknown>) ?? {}),
          created: result.created,
          status: result.validation.status,
        },
      },
      db
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/initiative-config] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
