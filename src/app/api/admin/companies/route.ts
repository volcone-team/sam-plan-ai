import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * GET /api/admin/companies
 *
 * Returns all companies with owner info, member count, and plan status.
 * Admin-only: requires is_admin = true on the requesting user's profile.
 *
 * Query params:
 *   ?search=text  — filters by company name (case-insensitive)
 *   ?limit=20     — pagination limit
 *   ?offset=0     — pagination offset
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);
    const offset = Number(searchParams.get("offset")) || 0;

    // 1. Authenticate the requesting user
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
      console.log("[admin/companies] No user session");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Verify admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    console.log("[admin/companies] User:", user.email, "| is_admin:", profile?.is_admin);

    if (!profile?.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // 3. Use service role to bypass RLS and get all companies
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Build query
    let query = adminClient
      .from("companies")
      .select("*", { count: "exact" });

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    query = query.order("created_at", { ascending: false }).range(offset, offset + limit - 1);

    const { data: companies, error, count } = await query;

    if (error) {
      console.error("[admin/companies] Query error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log("[admin/companies] Found", companies?.length, "companies, total:", count);

    // 4. Get member counts and owner info for each company
    const companyIds = (companies || []).map((c) => c.id);

    const { data: profiles } = await adminClient
      .from("profiles")
      .select("company_id, email, first_name, last_name, role")
      .in("company_id", companyIds.length > 0 ? companyIds : ["__none__"]);

    // 5. Get plan status for each company
    const { data: plans } = await adminClient
      .from("annual_plans")
      .select("company_id, status, year")
      .in("company_id", companyIds.length > 0 ? companyIds : ["__none__"])
      .order("year", { ascending: false });

    // Group profiles and plans by company
    const profilesByCompany = new Map<string, typeof profiles>();
    for (const p of profiles || []) {
      const arr = profilesByCompany.get(p.company_id) || [];
      arr.push(p);
      profilesByCompany.set(p.company_id, arr);
    }

    const plansByCompany = new Map<string, any>();
    for (const p of plans || []) {
      if (!plansByCompany.has(p.company_id)) {
        plansByCompany.set(p.company_id, p); // latest plan per company
      }
    }

    // 6. Format response
    const result = (companies || []).map((company) => {
      const members = profilesByCompany.get(company.id) || [];
      const owner = members.find((m) => m.role === "owner");
      const latestPlan = plansByCompany.get(company.id);

      return {
        id: company.id,
        name: company.name,
        description: company.description,
        currency: company.currency,
        fiscalYear: company.fiscal_year,
        planningYear: company.planning_year,
        priorYearRevenue: Number(company.prior_year_revenue) || 0,
        targetRevenue: Number(company.target_revenue) || 0,
        baselineRevenue: Number(company.baseline_revenue) || 0,
        stretchRevenue: Number(company.stretch_revenue) || 0,
        operatingBudget: Number(company.operating_budget) || 0,
        createdAt: company.created_at,
        memberCount: members.length,
        ownerEmail: owner?.email || null,
        ownerName: owner ? `${owner.first_name} ${owner.last_name}`.trim() : null,
        planStatus: latestPlan?.status || "none",
        planYear: latestPlan?.year || null,
      };
    });

    console.log("[admin/companies] Returning", result.length, "companies");

    return NextResponse.json({
      companies: result,
      total: count || 0,
      limit,
      offset,
    });
  } catch (err: any) {
    console.error("[admin/companies] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
