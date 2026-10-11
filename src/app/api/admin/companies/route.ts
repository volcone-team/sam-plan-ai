import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { loadBillingConfig } from "@/lib/billing/stripe-client";
import { evaluateAccess } from "@/lib/billing/entitlement";

/**
 * GET /api/admin/companies
 *
 * Every company with its owner, member count, plan status AND SUBSCRIPTION.
 * Admin-only: requires is_admin = true on the requesting user's profile.
 *
 * The subscription half used to live on a separate Accounts table under
 * Subscriptions, which listed the same companies again with a different subset
 * of their data. Two tables of the same rows meant answering "what is going on
 * with this account" needed both pages open. This endpoint is now the single
 * source for the merged table.
 *
 * Access state is computed with `evaluateAccess` — the same function that gates
 * features for customers — so the admin view cannot disagree with what the
 * customer actually experiences.
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

    /**
     * 5b. Subscription, plan catalogue and lifetime payments.
     *
     * Batched by the ids on this page rather than one query per row, and loaded
     * in parallel with the billing config that `evaluateAccess` needs.
     */
    const [config, subsRes, plansCatalogRes, paymentsRes] = await Promise.all([
      loadBillingConfig(adminClient),
      companyIds.length
        ? adminClient
            .from("subscriptions")
            .select(
              "id, company_id, plan_id, tier, status, stripe_status, billing_cycle, " +
              "stripe_subscription_id, stripe_mode, current_period_end, " +
              "cancel_at_period_end, pending_plan_id, is_comped, comped_until, " +
              "comped_reason, trial_ends_at, past_due_since, " +
              "is_paused, paused_at, pause_reason, pause_resumes_at"
            )
            .in("company_id", companyIds)
        : Promise.resolve({ data: [] }),
      adminClient
        .from("subscription_plans")
        .select("id, name, monthly_price, annual_price"),
      // Lifetime paid per company. Unattributed invoices are excluded: they are
      // not any company's spend.
      companyIds.length
        ? adminClient
            .from("billing_invoices")
            .select("company_id, amount_paid, status")
            .in("company_id", companyIds)
        : Promise.resolve({ data: [] }),
    ]);

    type SubRow = {
      id: string; company_id: string; plan_id: string | null; tier: string;
      status: string; stripe_status: string | null; billing_cycle: string;
      stripe_subscription_id: string | null; stripe_mode: string | null;
      current_period_end: string | null; cancel_at_period_end: boolean;
      pending_plan_id: string | null; is_comped: boolean;
      comped_until: string | null; comped_reason: string | null;
      trial_ends_at: string | null; past_due_since: string | null;
      is_paused: boolean | null; paused_at: string | null;
      pause_reason: string | null; pause_resumes_at: string | null;
    };

    // Via `unknown`: supabase-js cannot infer a row shape from a concatenated
    // select string and falls back to a union including an error type.
    const subByCompany = new Map<string, SubRow>();
    for (const row of ((subsRes.data ?? []) as unknown as SubRow[])) {
      if (row.company_id) subByCompany.set(row.company_id, row);
    }

    const planById = new Map(
      ((plansCatalogRes.data ?? []) as {
        id: string; name: string; monthly_price: number; annual_price: number;
      }[]).map((p) => [p.id, p])
    );

    const paidByCompany = new Map<string, number>();
    for (const inv of ((paymentsRes.data ?? []) as {
      company_id: string | null; amount_paid: number | null; status: string | null;
    }[])) {
      if (!inv.company_id || inv.status !== "paid") continue;
      paidByCompany.set(
        inv.company_id,
        (paidByCompany.get(inv.company_id) ?? 0) + (inv.amount_paid ?? 0)
      );
    }

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
      const sub = subByCompany.get(company.id) ?? null;
      const subPlan = sub?.plan_id ? planById.get(sub.plan_id) ?? null : null;

      /**
       * A company with NO subscription row is reported as null rather than
       * invented defaults. "No subscription" and "subscription on the free
       * tier" are different states, and a default would hide accounts that
       * never got one.
       */
      const subscription = sub
        ? {
            subscriptionId: sub.id,
            planId: sub.plan_id,
            planName: subPlan?.name ?? sub.tier,
            billingCycle: sub.billing_cycle,
            price: subPlan
              ? sub.billing_cycle === "annual"
                ? subPlan.annual_price
                : subPlan.monthly_price
              : null,
            status: sub.status,
            stripeStatus: sub.stripe_status,
            stripeMode: sub.stripe_mode,
            hasStripeSubscription: !!sub.stripe_subscription_id,
            currentPeriodEnd: sub.current_period_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            pendingPlanName: sub.pending_plan_id
              ? planById.get(sub.pending_plan_id)?.name ?? null
              : null,
            isComped: sub.is_comped,
            compedUntil: sub.comped_until,
            compedReason: sub.comped_reason,
            trialEndsAt: sub.trial_ends_at,
            pastDueSince: sub.past_due_since,
            // The admin table DOES show the pause reason — it is the audience
            // the note was written for.
            isPaused: sub.is_paused ?? false,
            pausedAt: sub.paused_at,
            pauseReason: sub.pause_reason,
            pauseResumesAt: sub.pause_resumes_at,
            /**
             * Is this account actually paying RIGHT NOW?
             *
             * A live Stripe subscription, not merely a plan_id — a trial
             * mirrors the default plan onto that column, so plan_id alone
             * reports trial users as paying customers.
             */
            isPaying:
              !!sub.stripe_subscription_id &&
              ["active", "trialing", "past_due"].includes(sub.stripe_status ?? ""),
            access: (() => {
              const access = evaluateAccess(
                {
                  stripeEnabled: config.stripeEnabled,
                  trialEnabled: config.trialEnabled,
                  trialDays: config.trialDays,
                  dunningGraceDays: config.dunningGraceDays,
                },
                {
                  status: (sub.stripe_status ?? sub.status) as never,
                  isComped: sub.is_comped,
                  compedUntil: sub.comped_until,
                  trialEndsAt: sub.trial_ends_at,
                  currentPeriodEnd: sub.current_period_end,
                  pastDueSince: sub.past_due_since,
                  cancelAtPeriodEnd: sub.cancel_at_period_end,
                  isPaused: sub.is_paused ?? false,
                  pauseResumesAt: sub.pause_resumes_at,
                }
              );
              return {
                allowed: access.allowed,
                reason: access.reason,
                warn: access.warn,
                daysRemaining: access.daysRemaining,
              };
            })(),
          }
        : null;

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
        // Minor units, as stored by Stripe.
        lifetimePaid: paidByCompany.get(company.id) ?? 0,
        subscription,
      };
    });

    console.log("[admin/companies] Returning", result.length, "companies");

    return NextResponse.json({
      companies: result,
      total: count || 0,
      limit,
      offset,
      // The comp controls need the plan list to offer a choice, and whether
      // Stripe is on at all changes what the subscription columns mean.
      stripeEnabled: config.stripeEnabled,
      plans: [...planById.values()].map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (err: any) {
    console.error("[admin/companies] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
