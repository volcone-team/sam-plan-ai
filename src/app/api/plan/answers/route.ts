import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * GET /api/plan/answers
 *
 * Returns the user's saved questionnaire answers from planning_inputs.
 * Used to pre-fill the questionnaire during regeneration.
 */
export async function GET() {
  try {
    console.log("[plan/answers] Loading saved answers...");

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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .single();

    if (!profile?.company_id) {
      console.log("[plan/answers] No company for user");
      return NextResponse.json({ answers: null });
    }

    // Get latest planning input
    const { data: input } = await supabase
      .from("planning_inputs")
      .select("*")
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!input) {
      console.log("[plan/answers] No planning_inputs found");
      return NextResponse.json({ answers: null });
    }

    console.log("[plan/answers] Found planning input:", input.id, "| route:", input.intake_route);

    // Get products for this company (to map back to questionnaire format)
    const { data: products } = await supabase
      .from("products")
      .select("id, name, price, revenue_type")
      .eq("company_id", profile.company_id)
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    console.log("[plan/answers] Products:", products?.length || 0);

    const assets = (input.current_assets as any) || {};

    // Map to questionnaire format
    const answers = {
      annualRevenueGoal: Number(input.revenue_goal) || 0,
      planningPeriod: input.revenue_timeframe === 3 ? "3-months" : input.revenue_timeframe === 6 ? "6-months" : "12-months",
      products: (products || []).map((p: any) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        type: p.revenue_type === "recurring" ? "membership" : "service",
      })),
      whatsWorked: input.successful_initiative_types || [],
      obstacleNotes: input.failed_initiatives || "",
      idealCustomer: input.ideal_customer_description || "",
      emailListSize: assets.emailListSize || 0,
      monthlyWebsiteVisitors: assets.websiteMonthlyVisitors || assets.monthlyWebsiteVisitors || 0,
      socialFollowing: assets.socialFollowing || 0,
      existingCustomers: assets.existingCustomers || 0,
      monthlyLeads: assets.monthlyLeads || 0,
      monthlyMarketingBudget: Number(input.monthly_marketing_budget) || 0,
      teamSize: input.team_size || 1,
    };

    console.log("[plan/answers] Returning answers:", Object.keys(answers).length, "fields");

    return NextResponse.json({ answers });
  } catch (err: any) {
    console.error("[plan/answers] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
