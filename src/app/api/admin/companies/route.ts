import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { loadBillingConfig } from "@/lib/billing/stripe-client";
import { evaluateAccess, neverPaid } from "@/lib/billing/entitlement";
import {
  latestCancellationByCompany,
  type CancellationFeedbackRowLike,
} from "@/lib/billing/cancellation-history";
import {
  derivePortalAccessState,
  type PortalAccessCompany,
} from "@/lib/access/portal-access";
import { loadCallGateSettings } from "@/lib/access/call-gate-settings";

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
    const [config, subsRes, plansCatalogRes, paymentsRes, cancellationsRes] = await Promise.all([
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
      // Unfiltered by `is_active`: a subscriber on a RETIRED plan must still be
      // nameable, and admins may grant retired plans (see the plan list below).
      adminClient
        .from("subscription_plans")
        .select("id, name, monthly_price, annual_price, is_active")
        .order("display_order"),
      // Lifetime paid per company. Unattributed invoices are excluded: they are
      // not any company's spend.
      companyIds.length
        ? adminClient
            .from("billing_invoices")
            .select("company_id, amount_paid, status")
            .in("company_id", companyIds)
        : Promise.resolve({ data: [] }),
      /**
       * Why each company LEFT, for the "Reason for plan cancellation" note.
       *
       * FILTERED TO `cancelled` IN SQL. Migration 030 writes a row for every
       * pass through the cancellation flow, including everyone who stayed, and
       * on the live database those are the large majority. Fetching them all
       * and discarding them in JS would move far more rows than the note needs.
       * `latestCancellationByCompany` re-checks the outcome regardless, so this
       * filter is an optimisation rather than the guarantee.
       *
       * Ordered to match idx_cancellation_feedback_company (company_id,
       * created_at DESC), though the reduction compares timestamps itself and
       * does not rely on it.
       */
      companyIds.length
        ? adminClient
            .from("cancellation_feedback")
            .select("company_id, reason, reason_detail, outcome, created_at, access_ends_at")
            .eq("outcome", "cancelled")
            .in("company_id", companyIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    /**
     * Logged rather than failed on.
     *
     * The usual cause is migration 030 not being applied on whichever database
     * this is pointed at. An absent churn note is a missing nicety; refusing
     * the whole company list over it would take out the page admins use to
     * grant access and pause billing.
     */
    if ("error" in cancellationsRes && cancellationsRes.error) {
      console.error(
        "[admin/companies] Could not read cancellation feedback:",
        cancellationsRes.error.message
      );
    }

    const cancellationByCompany = latestCancellationByCompany(
      (cancellationsRes.data ?? []) as unknown as CancellationFeedbackRowLike[]
    );

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
      ((plansCatalogRes.data ?? []) as unknown as {
        id: string; name: string; monthly_price: number; annual_price: number;
        is_active: boolean;
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

    /**
     * Who opened each gated company's portal (migration 043).
     *
     * A SEPARATE LOOKUP from the member query above, which is scoped by
     * company_id: the granter is one of OUR admins, so they are almost never a
     * member of the company they unlocked and would never appear in it.
     *
     * Keyed by profiles.id with no foreign key behind it (see migration 043),
     * so a granter whose account has since been deleted simply resolves to
     * nothing and the UI falls back to the raw id.
     */
    const granterIds = [
      ...new Set(
        (companies || [])
          .map((c) => (c as { portal_access_granted_by?: string | null }).portal_access_granted_by)
          .filter((v): v is string => typeof v === "string" && !!v)
      ),
    ];

    const { data: granters } = granterIds.length
      ? await adminClient
          .from("profiles")
          .select("id, email, first_name, last_name")
          .in("id", granterIds)
      : { data: [] as { id: string; email: string | null; first_name: string | null; last_name: string | null }[] };

    const granterById = new Map(
      ((granters ?? []) as {
        id: string; email: string | null; first_name: string | null; last_name: string | null;
      }[]).map((g) => [
        g.id,
        `${g.first_name ?? ""} ${g.last_name ?? ""}`.trim() || g.email || g.id,
      ])
    );

    /**
     * Is migration 043 applied?
     *
     * Inferred from the SHAPE of the rows rather than asked for separately.
     * The company query is `select("*")`, which is why an unapplied 043 cannot
     * break this page at all — the columns are simply absent from each row
     * instead of erroring — and absent is also the signal: no key means no
     * column. With no companies at all there is nothing to inspect, so it
     * reports true and the UI shows nothing either way.
     */
    const callGateAvailable =
      (companies || []).length === 0 ||
      Object.prototype.hasOwnProperty.call(companies![0], "requires_call_unlock");
    // The global switch: an undecided company reads as waiting while it is on.
    const callRequireSwitch = (await loadCallGateSettings(adminClient)).requireCall;

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
            // Retired: still billed and still entitled, just not sold any more.
            planRetired: !!subPlan && !subPlan.is_active,
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
                  neverPaid: neverPaid(sub),
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
        /**
         * The last time this company actually cancelled, or null if never.
         *
         * SEPARATE FROM `subscription` ON PURPOSE. It outlives the
         * subscription it describes: a customer who cancels and later
         * resubscribes gets a new Stripe subscription, and a company whose
         * subscription row is gone entirely still has a reason worth reading.
         * Nesting it under `subscription` would hide it in exactly those two
         * cases.
         *
         * Also survives reactivation. Clearing `cancel_at_period_end` does not
         * unmake the cancellation, so the note stays and the UI dates it.
         */
        cancellation: cancellationByCompany.get(company.id) ?? null,
        /**
         * The onboarding call gate for this company (migration 043).
         *
         * SEPARATE FROM `subscription`, like `cancellation` and for a stronger
         * reason: it is not billing at all. A company can be waiting for its
         * call while perfectly paid up, or unlocked while past due, so nesting
         * it under the subscription would imply the two decide each other.
         *
         * `state` comes from derivePortalAccessState rather than being spelled
         * out here, so the admin table cannot disagree with the gate the
         * customer meets. An unapplied 043 leaves the columns absent, which
         * that function reads as "never gated" — the whole page keeps working.
         */
        portalAccess: {
          state: derivePortalAccessState(company as PortalAccessCompany, { requireCall: callRequireSwitch }),
          grantedAt: (company as { portal_access_granted_at?: string | null })
            .portal_access_granted_at ?? null,
          /** Name or email of the admin who opened it; the raw id if they are gone. */
          grantedBy:
            granterById.get(
              (company as { portal_access_granted_by?: string | null })
                .portal_access_granted_by ?? ""
            ) ?? null,
        },
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
      // RETIRED PLANS INCLUDED (client request, Oct 2026): admins may grant a
      // retired plan on purpose. This list is admin-only; customers never see
      // retired plans on /get-started or /choose-plan.
      stripeEnabled: config.stripeEnabled,
      /**
       * False → migration 043 is missing, so the portal-access control is not
       * rendered at all. Showing a button that cannot store its result is
       * worse than showing none: the admin would believe a customer had been
       * let in.
       */
      callGateAvailable,
      plans: [...planById.values()]
        // Active first, so "the first plan" (the default pick) is never retired.
        .sort((a, b) => Number(b.is_active) - Number(a.is_active))
        .map((p) => ({ id: p.id, name: p.name, retired: !p.is_active })),
    });
  } catch (err: any) {
    console.error("[admin/companies] Error:", err?.message || err);
    return NextResponse.json({ error: err?.message || "Internal error" }, { status: 500 });
  }
}
