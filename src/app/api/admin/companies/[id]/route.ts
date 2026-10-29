import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { logActivity } from "@/lib/activity-log";
import { cancelSubscriptionsForCompany } from "@/lib/billing/cancel-on-delete";
import { isMissingColumnError } from "@/lib/supabase/missing-column";

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
      .select("is_admin, admin_level")
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

    /**
     * Each member's answers to the two signup checkboxes, SUPER ADMINS ONLY
     * (client, Oct 2026). Null for anyone else, so the page shows nothing.
     * A separate read so a database without 037/058 still returns the page:
     * it retries without terms_accepted_via, then gives up quietly.
     */
    let consent: Record<string, unknown>[] | null = null;
    if (profile.admin_level === "super_admin") {
      const read = (columns: string) =>
        adminClient.from("profiles").select(columns).eq("company_id", id);
      const BASE = "id, terms_accepted_at, promotional_consent, promotional_consent_at";
      let res = await read(`${BASE}, terms_accepted_via`);
      if (res.error && isMissingColumnError(res.error)) res = await read(BASE);
      if (res.error) {
        console.error("[admin/companies/id] Consent read failed:", res.error.message);
      } else {
        consent = (res.data ?? []) as unknown as Record<string, unknown>[];
      }
    }
    const consentById = new Map((consent ?? []).map((c) => [c.id as string, c]));

    console.log("[admin/companies/id] Members:", members?.length || 0);

    // 6. Get products
    const { data: products } = await adminClient
      .from("products")
      .select("id, name, price, revenue_type, ticket_tier, is_active, display_order")
      .eq("company_id", id)
      .order("display_order", { ascending: true });

    console.log("[admin/companies/id] Products:", products?.length || 0);

    // 7. Get initiatives
    const { data: initiatives, error: initErr } = await adminClient
      .from("initiatives")
      .select("id, name, description, kind, status, activation_date, revenue_better, planned_budget, initiative_types(channel)")
      .eq("company_id", id)
      .order("activation_date", { ascending: true });

    if (initErr) {
      console.error("[admin/companies/id] Initiatives query error:", initErr.message);
    }
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
      // Null when the caller is not a super admin (or the read failed).
      consent: consent
        ? (members || []).map((m) => {
            const c = consentById.get(m.id) ?? {};
            return {
              memberId: m.id,
              termsAcceptedAt: (c.terms_accepted_at as string | null) ?? null,
              termsAcceptedVia: (c.terms_accepted_via as string | null) ?? null,
              promotionalConsent:
                typeof c.promotional_consent === "boolean" ? c.promotional_consent : null,
              promotionalConsentAt: (c.promotional_consent_at as string | null) ?? null,
            };
          })
        : null,
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
        channel: (i as any).initiative_types?.channel || "unknown",
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

    // Snapshot the company name BEFORE the cascade — it is unreadable after.
    const { data: doomedCompany } = await adminClient
      .from("companies")
      .select("name")
      .eq("id", id)
      .maybeSingle();

    /**
     * Cancel Stripe FIRST, while the subscription rows still exist.
     *
     * After the cascade there is no way to find the customer, so the
     * subscription would bill forever with no account behind it. It also stops
     * the orphan being adopted later: reconcile recovers a lost customer link
     * by email, so a deleted address that is registered again would otherwise
     * inherit this subscription.
     *
     * Never throws — a half-deleted account is worse than an orphan — so the
     * result is recorded in the audit log instead.
     */
    const stripeCancel = await cancelSubscriptionsForCompany(adminClient, id);

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

    // Audit trail — never throws, never affects this response. company_id is
    // left null: the company row is gone, so an FK reference cannot survive.
    await logActivity(
      {
        actorUserId: user.id,
        actorEmail: user.email ?? null,
        action: "company.deleted",
        targetType: "company",
        targetId: id,
        targetLabel: doomedCompany?.name ?? null,
        companyId: null,
        metadata: {
          membersDeleted: members?.length || 0,
          stripeCancelled: stripeCancel.cancelled,
          // Anything here needs cancelling by hand in Stripe, so it must be
          // recorded rather than lost with the rest of the account.
          stripeFailed: stripeCancel.failed,
        },
      },
      adminClient
    );

    return NextResponse.json({
      success: true,
      // Surfaced so the admin is told when a subscription is still billing.
      stripeCancelled: stripeCancel.cancelled.length,
      stripeFailed: stripeCancel.failed,
    });
  } catch (err: any) {
    console.error("[admin/companies/id] DELETE Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
