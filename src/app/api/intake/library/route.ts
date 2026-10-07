import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { loadLibrary } from "@/lib/workbook/read";
import { EXCLUDED_PICKER_CATEGORIES } from "@/lib/intake/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/intake/library — the initiative list for the screen 5 and 6 pickers.
 *
 * Served from an API route rather than read client-side so the exclusion rules
 * are applied in ONE place. REQ-8.2 drops Maximizers; a picker that filtered
 * client-side would let a stale bundle offer an initiative the plan builder
 * then rejects.
 *
 * Read-only and company-agnostic: the workbook library is the same catalogue
 * for everyone, so there is nothing here to scope. Authentication is still
 * required — the library is the product's intellectual property, not public
 * reference data.
 *
 * Responses:
 *   200 { initiatives: [...] }
 *   401 { error: "Unauthorized" }
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

    const library = await loadLibrary(db);

    const excluded = new Set(
      EXCLUDED_PICKER_CATEGORIES.map((c) => c.toLowerCase())
    );

    const initiatives = library
      // REQ-8.2 — Maximizers attach to an initiative later rather than
      // standing alone, so offering them here would let someone build a plan
      // made entirely of add-ons.
      .filter((entry) => !excluded.has((entry.category ?? "").toLowerCase()))
      .map((entry) => ({
        key: entry.initiativeKey,
        name: entry.name,
        category: entry.category,
        oneLiner: entry.oneLiner,
        ownOrOps: entry.ownOrOps,
        priceTier: entry.priceTier,
        difficulty: entry.difficulty,
        speedToResults: entry.speedToResults,
        needsSalesTeam: entry.needsSalesTeam,
      }));

    return NextResponse.json({ initiatives });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[intake/library] GET failed:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
