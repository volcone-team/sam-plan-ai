import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { serviceClient } from "@/lib/billing/enforce";
import {
  countLiveUsage,
  evaluateLiveLimit,
  loadLiveLimitContext,
  LIVE_LIMIT_KEYS,
  type LiveLimitKey,
} from "@/lib/billing/live-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/limits
 *
 * The caller's company's LIVE limits (products, team; initiatives are per plan
 * year and not answered here), for screens that cap what can be added before
 * the server would refuse it — e.g. the intake products screen.
 *
 * Any member may call this: it carries the plan name and a few numbers, none
 * of the billing detail `/api/billing/me` withholds from non-owners. The server
 * checks on each create path remain the authority.
 *
 * 200 { planName, limits: { [key]: { limit, used, remaining, notIncluded } } }
 *     `limit` null = unlimited or not enforced (billing off, no plan).
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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = serviceClient();
    const { data: profile } = await db
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .maybeSingle();

    const companyId = (profile?.company_id as string | null) ?? null;
    if (!companyId) return NextResponse.json({ error: "No company found" }, { status: 400 });

    const ctx = await loadLiveLimitContext(db, companyId);
    const keys = LIVE_LIMIT_KEYS.filter((k): k is Exclude<LiveLimitKey, "max_initiatives"> => k !== "max_initiatives");

    const limits: Record<string, { limit: number | null; used: number; remaining: number | null; notIncluded: boolean }> = {};
    for (const key of keys) {
      const used = ctx.enforced ? await countLiveUsage(db, companyId, key) : 0;
      // adding 0: describe the limit without asking for anything.
      const r = evaluateLiveLimit(ctx, key, used, 0);
      limits[key] = {
        limit: r.limit,
        used: r.used,
        remaining: r.remaining,
        notIncluded: r.limit === 0,
      };
    }

    return NextResponse.json({ planName: ctx.planName, limits });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[billing/limits] failed:", message);
    return NextResponse.json({ error: "Could not read your plan limits." }, { status: 500 });
  }
}
