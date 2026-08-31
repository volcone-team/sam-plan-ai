import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * GET /api/admin/companies/[id]
 *
 * Returns full detail for a single company:
 *   - Company info
 *   - All members (profiles)
 *   - Products
 *   - Initiatives
 *   - Annual plan summary
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // 1. Auth check
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

    // 2. Verify admin
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();

    if (!profile?.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // 3. Service role client
    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 4. Get company
    const { data: company, error: compError } = await adminClient
      .from("companies")
      .select("*")
      .eq("id", id)
      .single();

    if (compError || !company) {
      console.log("[admin/companies/id] Company not found:", id);
      return NextResponse.json({ error: "Company not found" }, { status: 404 });
    }

    console.log("[admin/companies/id] Found company:", company.name);

    // 5. Get members
    const { data: members } = await adminClient
      .from("profiles")
      .select("id, email, first_name, last_name, role, is_active, is_admin, created_at")
      .eq("company_id", id)
      .order("created_at", { ascending: true });

    console.log("[admin/companies/id] Members:", members?.length || 0);

    // 6. Get products
    const { data: products } = await adminClient
      .from("products")
      .select("id, name, price, revenue_type, ticket_tier, is_active, display_order")
      .eq("company_id", id)
      .order("display_order", { ascending: true });

    console.log("[admin/companies/id] Products:", products?.length || 0);

    // 7. Get initiatives
    const { data: initiatives } = await adminClient
      .from("initiatives")
      .select("id, name, description, kind, channel, status, activation_date, revenue_better, planned_budget")
      .eq("company_id", id)
      .order("activation_date", { ascending: true });

    console.log("[admin/companies/id] Initiatives:", initiatives?.length || 0);

    // 8. Get annual plan
    const { data: annualPlan } = await adminClient
      .from("annual_plans")
      .select("id, year, baseline_revenue, stretch_revenue, operating_budget, status")
      .eq("company_id", id)
      .order("year", { ascending: false })
      .limit(1)
      .single();

    console.log("[admin/companies/id] Annual plan:", annualPlan?.year || "none");

    return NextResponse.json({
      company: {
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
      },
      members: (members || []).map((m) => ({
        id: m.id,
        email: m.email,
        firstName: m.first_name,
        lastName: m.last_name,
        role: m.role,
        isActive: m.is_active,
        isAdmin: m.is_admin,
        createdAt: m.created_at,
      })),
      products: (products || []).map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price) || 0,
        revenueType: p.revenue_type,
        ticketTier: p.ticket_tier,
        isActive: p.is_active,
      })),
      initiatives: (initiatives || []).map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        kind: i.kind,
        channel: i.channel,
        status: i.status,
        activationDate: i.activation_date,
        revenueBetter: Number(i.revenue_better) || 0,
        plannedBudget: Number(i.planned_budget) || 0,
      })),
      annualPlan: annualPlan
        ? {
            id: annualPlan.id,
            year: annualPlan.year,
            baselineRevenue: Number(annualPlan.baseline_revenue) || 0,
            stretchRevenue: Number(annualPlan.stretch_revenue) || 0,
            operatingBudget: Number(annualPlan.operating_budget) || 0,
            status: annualPlan.status,
          }
        : null,
    });
  } catch (err: any) {
    console.error("[admin/companies/id] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/companies/[id]
 *
 * Permanently deletes a company and ALL its data:
 *   - Deletes all auth users belonging to the company
 *   - Deletes the company row (cascades to profiles, products,
 *     initiatives, tasks, projections, results, expenses, plans, snapshots)
 *
 * Admin-only. This is irreversible.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    console.log("[admin/companies/id] DELETE company:", id);

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

    const { data: adminProfile } = await supabase
      .from("profiles")
      .select("is_admin, company_id")
      .eq("id", user.id)
      .single();

    if (!adminProfile?.is_admin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Guard: admin cannot delete their own company
    if (adminProfile.company_id === id) {
      return NextResponse.json({ error: "You cannot delete your own company." }, { status: 400 });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Get all members (auth users) of this company
    const { data: members } = await adminClient
      .from("profiles")
      .select("id, email")
      .eq("company_id", id);

    console.log("[admin/companies/id] Deleting", members?.length || 0, "auth users");

    // 2. Delete each auth user (this cascades to their profile)
    for (const member of members || []) {
      const { error: delErr } = await adminClient.auth.admin.deleteUser(member.id);
      if (delErr) {
        console.error("[admin/companies/id] Failed to delete user:", member.email, delErr.message);
      } else {
        console.log("[admin/companies/id] Deleted user:", member.email);
      }
    }

    // 3. Delete the company row (cascades to all company-scoped data)
    const { error: compErr } = await adminClient
      .from("companies")
      .delete()
      .eq("id", id);

    if (compErr) {
      console.error("[admin/companies/id] Company delete error:", compErr.message);
      return NextResponse.json({ error: compErr.message }, { status: 500 });
    }

    console.log("[admin/companies/id] Company deleted:", id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[admin/companies/id] DELETE Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
