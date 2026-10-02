import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/require-admin";
import { loadBillingConfig, isStripeConfigured, detectKeyKind } from "@/lib/billing/stripe-client";

/**
 * GET /api/admin/stats
 *
 * Returns real dashboard metrics for the admin overview.
 *   - totalUsers, totalCompanies
 *   - activePlans (annual_plans with status 'active')
 *   - aiGenerations (exact count of generation_events rows)
 *
 * aiGenerations used to fall back to an ESTIMATE (companies with initiatives +
 * snapshot count) whenever the count came back 0. That fallback masked a real
 * bug: generation_events was empty because every insert was being rejected by
 * RLS. The estimate has been removed — migration 016 backfills the historical
 * rows the estimate used to approximate, so this number is now the truth.
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
    const [customerUsersRes, internalUsersRes, companiesRes, activePlansRes, genEventsRes] = await Promise.all([
      adminClient.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", false),
      adminClient.from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true),
      adminClient.from("companies").select("id", { count: "exact", head: true }),
      adminClient.from("annual_plans").select("id", { count: "exact", head: true }).eq("status", "active"),
      adminClient.from("generation_events").select("id", { count: "exact", head: true }),
    ]);

    // AI Generations: the real log, no estimate. A query failure is reported
    // loudly and surfaces as 0 rather than being papered over.
    if (genEventsRes.error) {
      console.error("[admin/stats] generation_events count failed:", genEventsRes.error.message, genEventsRes.error.code);
    }
    const aiGenerations = genEventsRes.error ? 0 : genEventsRes.count || 0;

    const stats = {
      totalUsers: customerUsersRes.count || 0,
      internalUsers: internalUsersRes.count || 0,
      totalCompanies: companiesRes.count || 0,
      activePlans: activePlansRes.count || 0,
      aiGenerations,
    };

    // Real Stripe status for the dashboard, replacing the hardcoded
    // "Not connected". Reports against the ACTIVE mode: a configured key for the
    // mode currently selected is what actually matters.
    const config = await loadBillingConfig(adminClient);
    const stripe = {
      enabled: config.stripeEnabled,
      mode: detectKeyKind(), // 'live' | 'test' | 'unknown' | 'missing'
      configured: isStripeConfigured(),
    };

    console.log("[admin/stats]", JSON.stringify(stats), "| stripe:", JSON.stringify(stripe));

    return NextResponse.json({ stats, stripe });
  } catch (err: any) {
    console.error("[admin/stats] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
