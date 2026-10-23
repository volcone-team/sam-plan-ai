import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { seedLibraryConfigs } from "@/lib/intake-v3/config-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST → create a derived initiative_library_config row for every library
 * record that has none. Never overwrites an existing row; idempotent.
 * SUPER-ADMIN ONLY.
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

export async function POST() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = adminClient();
    const result = await seedLibraryConfigs(db, check.userId);
    if (!result.ok) {
      console.error("[admin/initiative-config/seed] Seed failed:", result.error);
      return NextResponse.json({ error: result.error }, { status: 500 });
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
        action: "initiative_config.seeded",
        targetType: "initiative_library_config",
        targetId: null,
        targetLabel: `${result.created} created, ${result.skipped} skipped`,
        metadata: { created: result.created, skipped: result.skipped, createdKeys: result.createdKeys },
      },
      db
    );

    return NextResponse.json(result);
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/initiative-config/seed] POST error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
