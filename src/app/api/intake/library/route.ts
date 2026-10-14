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
 * THE WHOLE WORKBOOK, INCLUDING ADMIN-DISABLED INITIATIVES.
 *
 * The admin allowlist (`initiative_settings`, migration 034) answers "what may
 * we RECOMMEND". It must not answer "what might this business already be
 * doing" — and these two screens ask only the second question. Screen 5 is
 * what they are already planning; screen 6 is what has worked and what has
 * not. Both are statements of fact about the customer's own history.
 *
 * Filtering them to the recommendable set was wrong in three ways:
 *   - it told a customer who runs podcasts that podcasts do not exist;
 *   - a win we cannot see is a win the forecast cannot credit;
 *   - worse, a FAILURE we cannot see is one we might then recommend, because
 *     REQ-13.8 excludes an initiative only when the user has reported it as
 *     failed, and they cannot report what the picker never offered.
 *
 * The recommendation path keeps the allowlist: /api/intake/recommend filters
 * its candidate pool through `loadLibrary` without this flag and re-checks
 * every pick against `inactiveKeys` in `isEligible`. So we still only propose
 * the admin's chosen few while letting customers describe anything.
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

    /**
     * `includeInactive` — see the header. These pickers record the customer's
     * own history, so the admin's recommendation allowlist does not apply.
     *
     * Deliberately NOT marked up in the response. Which initiatives we are
     * currently willing to recommend is our internal policy, and flagging some
     * of the customer's own activities as second-class would be both confusing
     * and none of their business.
     */
    const library = await loadLibrary(db, { includeInactive: true });

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
