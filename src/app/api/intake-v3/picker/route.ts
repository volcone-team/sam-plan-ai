import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { isOfferedInIntakePicker, loadLibraryConfigs, pickerConfigs } from "@/lib/intake-v3/config-repo";
import { toPickerItems } from "@/lib/intake-v3/picker";
import {
  disabledPickerBody,
  isSuperAdminProfile,
  pickerAccess,
  readIntakeV3Enabled,
} from "@/lib/intake-v3/rollout-setting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many recent initiative rows to read. The picker shows at most 4 distinct keys. */
const RECENT_ROWS = 50;

/**
 * GET /api/intake-v3/picker — data for the new two-screen initiative picker.
 *
 * Offered records only (active AND a valid intake config — see
 * isOfferedInIntakePicker), projected to PickerItem.
 *
 * configs: the effective LibraryRecordConfig of each returned item, keyed by
 * initiative key, so the intake form can lay itself out. Only for items in
 * `items`. Validation, settings, warnings and workbook ids never leave the
 * server.
 *
 * recentKeys: the caller's company's initiatives.library_key, newest first.
 * Raw keys, possibly repeated or no longer offered; buildRecents filters.
 * A failure reading them is not fatal — the picker works without recents.
 *
 * The admin switch (app_settings.intake_v3_enabled, 047, default off):
 *   off, not a super admin → 200 { enabled: false, items: [], configs: {}, recentKeys: [] }
 *   off, super admin       → the real data with enabled: false, preview: true
 *   on                     → the real data with enabled: true
 *
 * Responses:
 *   200 { enabled, preview?, items: PickerItem[], configs: Record<string, LibraryRecordConfig>, recentKeys: string[] }
 *   401 { error: "Unauthorized" }
 *   503 { error }   the library config could not be loaded
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // The admin switch (047). Off → customers get the empty disabled body and
    // keep the current form; super admins still get the data, as a preview.
    const [setting, profileRes] = await Promise.all([
      readIntakeV3Enabled(db),
      db.from("profiles").select("is_admin, admin_level, company_id").eq("id", user.id).maybeSingle(),
    ]);
    const profile = profileRes.error
      ? null
      : (profileRes.data as { is_admin?: unknown; admin_level?: unknown; company_id?: string | null } | null);
    const access = pickerAccess(setting.enabled, isSuperAdminProfile(profile));
    if (access === "off") {
      return NextResponse.json(disabledPickerBody());
    }

    const [loaded, oneLinerRes] = await Promise.all([
      loadLibraryConfigs(db),
      // The config record does not carry the one-liner.
      db.from("wb_initiative_library").select("initiative_key, one_liner"),
    ]);
    if (!loaded.ok || oneLinerRes.error) {
      const detail = !loaded.ok ? loaded.error : oneLinerRes.error!.message;
      console.error("[intake-v3/picker] library load failed:", detail);
      return NextResponse.json(
        { error: "The initiative library is unavailable right now. Please try again shortly." },
        { status: 503 }
      );
    }

    const oneLiners = new Map(
      ((oneLinerRes.data ?? []) as { initiative_key: string; one_liner: string | null }[]).map(
        (r) => [r.initiative_key, r.one_liner]
      )
    );
    const offered = loaded.records.filter(isOfferedInIntakePicker);
    const items = toPickerItems(offered, oneLiners);
    const configs = pickerConfigs(offered, items.map((i) => i.key));

    return NextResponse.json({
      enabled: setting.enabled,
      ...(access === "preview" ? { preview: true } : {}),
      items,
      configs,
      recentKeys: await loadRecentKeys(db, profile?.company_id ?? null),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[intake-v3/picker] GET failed:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}

async function loadRecentKeys(
  db: SupabaseClient,
  companyId: string | null
): Promise<string[]> {
  if (!companyId) return [];

  const { data, error } = await db
    .from("initiatives")
    .select("library_key")
    .eq("company_id", companyId)
    .not("library_key", "is", null)
    .order("created_at", { ascending: false })
    .limit(RECENT_ROWS);
  if (error) {
    console.error("[intake-v3/picker] recents failed:", error.message);
    return [];
  }
  return ((data ?? []) as { library_key: string | null }[])
    .map((r) => r.library_key)
    .filter((k): k is string => typeof k === "string" && k !== "");
}
