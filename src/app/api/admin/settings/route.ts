import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Platform settings API.
 *
 * GET → the 'global' app_settings row (coded defaults if it is somehow absent).
 * PUT → update supplied fields, stamping updated_by/updated_at.
 *
 * Reads are allowed for any authenticated user: the client layout needs
 * `deterDevtools` to decide whether to attach its listeners, and the value is
 * observable from the page's behaviour regardless. Writes require an admin.
 */

type Settings = { deterDevtools: boolean };

const DEFAULTS: Settings = { deterDevtools: false };

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
    const db = adminClient();
    const { data, error } = await db
      .from("app_settings")
      .select("deter_devtools")
      .eq("id", "global")
      .maybeSingle();

    if (error) {
      // Never fail the page over a settings read — fall back to defaults.
      console.error("[admin/settings] GET error:", error.message);
      return NextResponse.json(DEFAULTS);
    }

    return NextResponse.json({
      deterDevtools: data?.deter_devtools ?? DEFAULTS.deterDevtools,
    });
  } catch (err: unknown) {
    console.error("[admin/settings] GET error:", errMessage(err));
    return NextResponse.json(DEFAULTS);
  }
}

export async function PUT(req: Request) {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      console.log("[admin/settings] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: { deterDevtools?: unknown } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    if (typeof body.deterDevtools !== "boolean") {
      return NextResponse.json({ error: "deterDevtools" }, { status: 400 });
    }

    const db = adminClient();
    const { error } = await db
      .from("app_settings")
      .upsert(
        {
          id: "global",
          deter_devtools: body.deterDevtools,
          updated_by: check.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

    if (error) {
      console.error("[admin/settings] PUT error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Audit trail — best-effort, never affects the response.
    const { data: actor } = await db
      .from("profiles")
      .select("email")
      .eq("id", check.userId)
      .maybeSingle();

    await logActivity(
      {
        actorUserId: check.userId,
        actorEmail: actor?.email ?? null,
        action: "app_settings.updated",
        targetType: "app_settings",
        targetId: null,
        targetLabel: "global",
        metadata: { deterDevtools: body.deterDevtools },
      },
      db
    );

    return NextResponse.json({ deterDevtools: body.deterDevtools });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/settings] PUT error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
