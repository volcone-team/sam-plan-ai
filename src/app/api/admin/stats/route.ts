import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";

/**
 * GET /api/admin/stats
 *
 * Returns real dashboard metrics for the admin overview.
 *   - totalUsers, totalCompanies
 *   - activePlans (annual_plans with status 'active')
 *   - aiGenerations (approx: companies that have at least one initiative)
 */
export async function GET() {
  try {
    const check = await requireAdmin();
    if (!check.ok) {
      console.log("[admin/stats] Denied:", check.error);
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Run all counts in parallel using head:true (count only, no rows)
    const [customerUsersRes, internalUsersRes, companiesRes, activePlansRes, initiativesRes] = await Promise.all([
      adminClient.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", false),
      adminClient.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true),
      adminClient.from("companies").select("id", { count: "exact", head: true }),
      adminClient.from("annual_plans").select("id", { count: "exact", head: true }).eq("status", "active"),
      adminClient.from("initiatives").select("company_id"),
    ]);

    // Distinct companies that have at least one initiative = plans actually generated
    const companiesWithInitiatives = new Set(
      (initiativesRes.data || []).map((r: any) => r.company_id)
    ).size;

    const stats = {
      totalUsers: customerUsersRes.count || 0,
      internalUsers: internalUsersRes.count || 0,
      totalCompanies: companiesRes.count || 0,
      activePlans: activePlansRes.count || 0,
      aiGenerations: companiesWithInitiatives,
    };

    console.log("[admin/stats]", JSON.stringify(stats));

    return NextResponse.json({ stats });
  } catch (err: any) {
    console.error("[admin/stats] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
