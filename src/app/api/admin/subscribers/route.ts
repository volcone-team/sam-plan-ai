import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { logActivity } from "@/lib/activity-log";
import { loadBillingConfig } from "@/lib/billing/stripe-client";
import { evaluateAccess } from "@/lib/billing/entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Subscriber and payment administration. SUPER-ADMIN ONLY.
 *
 * GET  → every company with its subscription state, computed access decision,
 *        and payment totals. Plus recent invoices across all customers.
 * POST → comp | uncomp  (grant or revoke free access to a plan)
 *
 * Invoice data is read from our own billing_invoices table, populated by the
 * webhook — NOT fetched from Stripe per request. A page that fans out to Stripe
 * for every customer is slow and breaks entirely when Stripe is unreachable.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET(request: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const url = new URL(request.url);
    const invoiceLimit = Math.min(Number(url.searchParams.get("invoices")) || 50, 200);

    const db = adminClient();
    const config = await loadBillingConfig(db);

    const { data: subs, error: subsErr } = await db
      .from("subscriptions")
      .select(
        "id, company_id, plan_id, tier, status, stripe_status, billing_cycle, " +
        "stripe_customer_id, stripe_subscription_id, stripe_price_id, stripe_mode, " +
        "current_period_start, current_period_end, cancel_at_period_end, " +
        "pending_plan_id, pending_billing_cycle, " +
        "is_comped, comped_until, comped_reason, comped_by, " +
        "trial_ends_at, is_trial_active, past_due_since, created_at"
      )
      .order("created_at", { ascending: false });

    if (subsErr) {
      console.error("[admin/subscribers] Query failed:", subsErr.message);
      return NextResponse.json({ error: subsErr.message }, { status: 500 });
    }

    type SubRow = {
      id: string; company_id: string; plan_id: string | null; tier: string;
      status: string; stripe_status: string | null; billing_cycle: string;
      stripe_customer_id: string | null; stripe_subscription_id: string | null;
      stripe_price_id: string | null; stripe_mode: string | null;
      current_period_start: string | null; current_period_end: string | null;
      cancel_at_period_end: boolean; pending_plan_id: string | null;
      pending_billing_cycle: string | null; is_comped: boolean;
      comped_until: string | null; comped_reason: string | null; comped_by: string | null;
      trial_ends_at: string | null; is_trial_active: boolean;
      past_due_since: string | null; created_at: string;
    };

    // Via `unknown`: supabase-js cannot infer a row shape from a concatenated
    // select string, so it falls back to a union that includes an error type.
    const rows = (subs ?? []) as unknown as SubRow[];

    // Batched lookups keyed on the ids present, never one query per row.
    const companyIds = [...new Set(rows.map((r) => r.company_id).filter(Boolean))];
    const planIds = [...new Set(rows.flatMap((r) => [r.plan_id, r.pending_plan_id]).filter((v): v is string => !!v))];

    const [companiesRes, plansRes, paymentsRes] = await Promise.all([
      companyIds.length
        ? db.from("companies").select("id, name").in("id", companyIds)
        : Promise.resolve({ data: [], error: null }),
      planIds.length
        ? db.from("subscription_plans").select("id, name, monthly_price, annual_price").in("id", planIds)
        : Promise.resolve({ data: [], error: null }),
      // Lifetime paid total per company, from stored invoices.
      db.from("billing_invoices").select("company_id, amount_paid, status"),
    ]);

    const companyName = new Map(
      ((companiesRes.data ?? []) as { id: string; name: string | null }[]).map((c) => [c.id, c.name])
    );
    const planById = new Map(
      ((plansRes.data ?? []) as { id: string; name: string; monthly_price: number; annual_price: number }[])
        .map((p) => [p.id, p])
    );

    const paidByCompany = new Map<string, number>();
    for (const inv of (paymentsRes.data ?? []) as {
      company_id: string | null; amount_paid: number | null; status: string | null;
    }[]) {
      if (!inv.company_id || inv.status !== "paid") continue;
      paidByCompany.set(
        inv.company_id,
        (paidByCompany.get(inv.company_id) ?? 0) + (inv.amount_paid ?? 0)
      );
    }

    const subscribers = rows.map((r) => {
      // Same function the app uses to gate features, so the admin view cannot
      // disagree with what a customer actually experiences.
      const access = evaluateAccess(
        {
          stripeEnabled: config.stripeEnabled,
          trialEnabled: config.trialEnabled,
          trialDays: config.trialDays,
          dunningGraceDays: config.dunningGraceDays,
        },
        {
          status: (r.stripe_status ?? r.status) as never,
          isComped: r.is_comped,
          compedUntil: r.comped_until,
          trialEndsAt: r.trial_ends_at,
          currentPeriodEnd: r.current_period_end,
          pastDueSince: r.past_due_since,
          cancelAtPeriodEnd: r.cancel_at_period_end,
        }
      );

      const plan = r.plan_id ? planById.get(r.plan_id) : null;

      return {
        subscriptionId: r.id,
        companyId: r.company_id,
        companyName: companyName.get(r.company_id) ?? null,
        planId: r.plan_id,
        planName: plan?.name ?? r.tier,
        billingCycle: r.billing_cycle,
        price: plan
          ? r.billing_cycle === "annual" ? plan.annual_price : plan.monthly_price
          : null,
        status: r.status,
        stripeStatus: r.stripe_status,
        stripeMode: r.stripe_mode,
        hasStripeSubscription: !!r.stripe_subscription_id,
        currentPeriodEnd: r.current_period_end,
        cancelAtPeriodEnd: r.cancel_at_period_end,
        pendingPlanName: r.pending_plan_id ? planById.get(r.pending_plan_id)?.name ?? null : null,
        pendingBillingCycle: r.pending_billing_cycle,
        isComped: r.is_comped,
        compedUntil: r.comped_until,
        compedReason: r.comped_reason,
        trialEndsAt: r.trial_ends_at,
        pastDueSince: r.past_due_since,
        // Minor units, as stored.
        lifetimePaid: paidByCompany.get(r.company_id) ?? 0,
        access: {
          allowed: access.allowed,
          reason: access.reason,
          warn: access.warn,
          daysRemaining: access.daysRemaining,
        },
        createdAt: r.created_at,
      };
    });

    const { data: invoices } = await db
      .from("billing_invoices")
      .select(
        "id, company_id, stripe_invoice_id, stripe_mode, status, amount_due, amount_paid, " +
        "currency, description, hosted_invoice_url, invoice_pdf, period_start, period_end, " +
        "paid_at, failure_message, attempt_count, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(invoiceLimit);

    return NextResponse.json({
      mode: config.mode,
      stripeEnabled: config.stripeEnabled,
      subscribers,
      invoices: ((invoices ?? []) as unknown as Record<string, unknown>[]).map((i) => ({
        ...i,
        companyName: i.company_id ? companyName.get(i.company_id as string) ?? null : null,
      })),
      totals: {
        companies: subscribers.length,
        comped: subscribers.filter((s) => s.isComped).length,
        paying: subscribers.filter((s) => s.hasStripeSubscription && !s.isComped).length,
        pastDue: subscribers.filter((s) => s.stripeStatus === "past_due").length,
        // Minor units summed across all paid invoices.
        collected: [...paidByCompany.values()].reduce((a, b) => a + b, 0),
      },
    });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/subscribers] GET error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}

/**
 * POST — comp or un-comp a company.
 *
 * Comping is how a super admin grants a plan without payment: existing test
 * accounts, a friend, a partner, or an account they created manually. It bypasses
 * Stripe entirely but still resolves to a plan, so limits continue to apply and
 * entitlement logic has exactly one shape.
 *
 * Body: { action: 'comp', companyId, planId, until?: string|null, reason?: string }
 *       { action: 'uncomp', companyId }
 */
export async function POST(req: Request) {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    let body: {
      action?: unknown; companyId?: unknown; planId?: unknown;
      until?: unknown; reason?: unknown;
    } = {};
    try {
      const parsed = await req.json();
      if (parsed && typeof parsed === "object") body = parsed;
    } catch {
      return NextResponse.json({ error: "body" }, { status: 400 });
    }

    if (typeof body.companyId !== "string" || !body.companyId) {
      return NextResponse.json({ error: "companyId" }, { status: 400 });
    }

    const db = adminClient();
    const now = new Date().toISOString();

    const { data: actor } = await db
      .from("profiles").select("email").eq("id", check.userId).maybeSingle();

    if (body.action === "comp") {
      if (typeof body.planId !== "string" || !body.planId) {
        return NextResponse.json({ error: "planId" }, { status: 400 });
      }

      let until: string | null = null;
      if (typeof body.until === "string" && body.until.trim()) {
        const t = new Date(body.until).getTime();
        if (!Number.isFinite(t)) {
          return NextResponse.json({ error: "until" }, { status: 400 });
        }
        until = new Date(t).toISOString();
      }

      const { error } = await db
        .from("subscriptions")
        .update({
          is_comped: true,
          comped_until: until,
          comped_reason:
            typeof body.reason === "string" && body.reason.trim()
              ? body.reason.trim().slice(0, 300)
              : "Granted by super admin",
          comped_by: check.userId,
          plan_id: body.planId,
          updated_at: now,
        })
        .eq("company_id", body.companyId);

      if (error) {
        console.error("[admin/subscribers] Comp failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      await logActivity(
        {
          actorUserId: check.userId,
          actorEmail: actor?.email ?? null,
          action: "billing.comped",
          targetType: "companies",
          targetId: body.companyId,
          targetLabel: null,
          metadata: { planId: body.planId, until, reason: body.reason ?? null },
        },
        db
      );

      return NextResponse.json({ comped: true, until });
    }

    if (body.action === "uncomp") {
      // Clears the comp only. Any real Stripe subscription is untouched, so a
      // company that later subscribed properly keeps it.
      const { error } = await db
        .from("subscriptions")
        .update({
          is_comped: false,
          comped_until: null,
          comped_reason: null,
          comped_by: null,
          updated_at: now,
        })
        .eq("company_id", body.companyId);

      if (error) {
        console.error("[admin/subscribers] Uncomp failed:", error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      await logActivity(
        {
          actorUserId: check.userId,
          actorEmail: actor?.email ?? null,
          action: "billing.uncomped",
          targetType: "companies",
          targetId: body.companyId,
          targetLabel: null,
          metadata: {},
        },
        db
      );

      return NextResponse.json({ comped: false });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (err: unknown) {
    const msg = errMessage(err);
    console.error("[admin/subscribers] POST error:", msg);
    return NextResponse.json({ error: msg || "Internal error" }, { status: 500 });
  }
}
