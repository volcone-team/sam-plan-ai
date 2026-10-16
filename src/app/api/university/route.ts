import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import {
  loadCatalogueForUser,
  UniversityMigrationMissingError,
} from "@/lib/university/catalogue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-user and plan-gated: no shared or browser cache may keep it. */
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/university
 *
 * The SAM University catalogue for the signed-in user, gated by the company's
 * plan. Built only by buildCustomerCatalogue (src/lib/university/access.ts):
 * locked and coming-soon items carry `url: null`, drafts are absent.
 *
 * The university tables have RLS on with no policies, so they are read with
 * the service-role client; the caller's session is used only to identify them.
 *
 * Responses (all `Cache-Control: no-store`):
 *   200 UniversityCatalogueResponse
 *   401 { error: "Unauthorized" }
 *   503 { error: "migration_not_applied" }   migration 038 not run yet
 *   500 { error: "internal_error" }
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch {}
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
    }

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("company_id, is_admin")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) throw new Error(`profiles query failed: ${profileError.message}`);

    const body = await loadCatalogueForUser(db, {
      companyId: (profile?.company_id as string | null | undefined) ?? null,
      isAdmin: profile?.is_admin === true,
    });

    return NextResponse.json(body, { headers: NO_STORE });
  } catch (err: unknown) {
    if (err instanceof UniversityMigrationMissingError) {
      console.warn("[university] Migration 038 not applied:", err.message);
      return NextResponse.json({ error: "migration_not_applied" }, { status: 503, headers: NO_STORE });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[university] Error:", message);
    return NextResponse.json({ error: "internal_error" }, { status: 500, headers: NO_STORE });
  }
}
