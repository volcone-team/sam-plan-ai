import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { loadBillingConfig, STRIPE_MODE_TAG } from "@/lib/billing/stripe-client";
import { evaluateAccess } from "@/lib/billing/entitlement";
import { resolveUsagePeriod, checkLimit } from "@/lib/billing/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/me
 *
 * Everything the customer-facing billing UI needs: available plans, the caller's
 * current subscription, their access state, and this period's usage against each
 * of their plan's limits.
 *
 * Usage is computed with the SAME functions the server enforces with, so the
 * numbers a customer sees cannot disagree with the answer they get when they
 * press Generate.
 *
 * Returns { billingEnabled: false } when Stripe is off — the UI then hides
 * pricing entirely rather than showing plans nobody can buy.
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

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const config = await loadBillingConfig(db);

    const { data: profile } = await db
      .from("profiles")
      .select("company_id, role")
      .eq("id", user.id)
      .maybeSingle();

    const companyId = profile?.company_id ?? null;

    /**
     * EVERY plan, active or not.
     *
     * This used to filter on `is_active`, which broke the one case that matters
     * when a plan is retired: a subscriber on it could no longer be NAMED. The
     * lookup below (`plans.find(p => p.id === sub.plan_id)`) returned undefined
     * and fell back to `sub.tier` — a legacy pre-Stripe string — so a customer
     * paying for Pro was told they were on Starter.
     *
     * Retiring a plan means "stop offering it to new customers", not "take it
     * away from existing ones". Their limits and their Stripe billing are both
     * unchanged, so the label has to match that.
     *
     * The active filter now applies only to the PURCHASABLE list below.
     */
    const { data: plansRaw } = await db
      .from("subscription_plans")
      .select(
        "id, name, description, tagline, monthly_price, annual_price, " +
        "is_default, is_active, display_order"
      )
      .order("display_order");

    // Via `unknown`: supabase-js cannot infer a row shape from a concatenated
    // select string and falls back to a union including an error type.
    const allPlans = (plansRaw ?? []) as unknown as {
      id: string; name: string; description: string | null; tagline: string | null;
      monthly_price: number; annual_price: number; is_default: boolean;
      is_active: boolean;
    }[];

    /** Offered to new buyers. A retired plan is not on the pricing cards. */
    const plans = allPlans.filter((p) => p.is_active);

    // Which plans can actually be bought right now: a plan with no synced price
    // for the active mode cannot go through checkout, so the UI must not offer it.
    const { data: prices } = await db
      .from("stripe_prices")
      .select("plan_id, billing_cycle")
      .eq("stripe_mode", STRIPE_MODE_TAG)
      .eq("is_current", true);

    const purchasable = new Set(
      ((prices ?? []) as { plan_id: string; billing_cycle: string }[]).map(
        (p) => `${p.plan_id}:${p.billing_cycle}`
      )
    );

    // Plan limits and features for display on the pricing cards.
    const planIds = plans.map((p) => p.id);
    const [{ data: limitRows }, { data: featureRows }] = await Promise.all([
      planIds.length
        ? db.from("plan_limits").select("plan_id, limit_key, limit_label, limit_value").in("plan_id", planIds)
        : Promise.resolve({ data: [], error: null }),
      planIds.length
        ? db.from("plan_features").select("plan_id, feature_key, feature_label, enabled").in("plan_id", planIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const limitsByPlan = new Map<string, { key: string; label: string; value: number }[]>();
    for (const r of (limitRows ?? []) as {
      plan_id: string; limit_key: string; limit_label: string; limit_value: number;
    }[]) {
      const list = limitsByPlan.get(r.plan_id) ?? [];
      list.push({ key: r.limit_key, label: r.limit_label, value: r.limit_value });
      limitsByPlan.set(r.plan_id, list);
    }

    const featuresByPlan = new Map<string, { key: string; label: string; enabled: boolean }[]>();
    for (const r of (featureRows ?? []) as {
      plan_id: string; feature_key: string; feature_label: string; enabled: boolean;
    }[]) {
      const list = featuresByPlan.get(r.plan_id) ?? [];
      list.push({ key: r.feature_key, label: r.feature_label, enabled: r.enabled });
      featuresByPlan.set(r.plan_id, list);
    }

    const { data: subRaw } = companyId
      ? await db
          .from("subscriptions")
          .select(
            "plan_id, tier, status, stripe_status, billing_cycle, is_comped, comped_until, " +
            "comped_reason, trial_ends_at, current_period_start, current_period_end, " +
            "cancel_at_period_end, past_due_since, pending_plan_id, pending_billing_cycle, " +
            "stripe_subscription_id, stripe_mode, is_paused, paused_at, pause_resumes_at"
          )
          .eq("company_id", companyId)
          .maybeSingle()
      : { data: null };

    const sub = subRaw as {
      plan_id: string | null; tier: string; status: string; stripe_status: string | null;
      billing_cycle: string; is_comped: boolean; comped_until: string | null;
      comped_reason: string | null; trial_ends_at: string | null;
      current_period_start: string | null; current_period_end: string | null;
      cancel_at_period_end: boolean; past_due_since: string | null;
      pending_plan_id: string | null; pending_billing_cycle: string | null;
      stripe_subscription_id: string | null; stripe_mode: string | null;
      is_paused: boolean | null; paused_at: string | null;
      pause_resumes_at: string | null;
    } | null;

    /**
     * Is there a plan the company has actually been GIVEN, as opposed to one it
     * is merely trialing?
     *
     * A trial (migration 023) mirrors the default plan by writing that plan's id
     * onto the subscription row, with no Stripe subscription behind it. Deriving
     * "current plan" from `plan_id` alone therefore marked Starter as owned for
     * every brand-new account, so the one plan a trial user is most likely to buy
     * rendered as a disabled "Your plan" button and could not be purchased at all.
     *
     * Only two things count as genuinely holding a plan: a live Stripe
     * subscription in this mode, or a comp granted by an admin. Everything else
     * — including an in-progress trial — leaves every plan buyable.
     */
    const hasPurchasedPlan =
      !!sub &&
      (sub.is_comped ||
        (!!sub.stripe_subscription_id &&
          sub.stripe_mode === STRIPE_MODE_TAG &&
          ["active", "trialing", "past_due"].includes(sub.stripe_status ?? "")));

    const access = evaluateAccess(
      {
        stripeEnabled: config.stripeEnabled,
        trialEnabled: config.trialEnabled,
        trialDays: config.trialDays,
        dunningGraceDays: config.dunningGraceDays,
      },
      sub
        ? {
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
        : null
    );

    // Usage for the CURRENT plan's limits, in the same period the enforcement
    // path uses, so the figures shown match the figures acted on.
    const period = resolveUsagePeriod(
      sub?.current_period_start ?? null,
      sub?.current_period_end ?? null
    );

    let usage: {
      key: string; label: string; limit: number; used: number;
      remaining: number | null; unlimited: boolean; notIncluded: boolean;
    }[] = [];

    if (companyId && sub?.plan_id) {
      const planLimits = limitsByPlan.get(sub.plan_id) ?? [];
      const { data: counters } = await db
        .from("usage_counters")
        .select("limit_key, used")
        .eq("company_id", companyId)
        .eq("period_start", period.periodStart);

      const usedByKey = new Map(
        ((counters ?? []) as { limit_key: string; used: number }[]).map((c) => [c.limit_key, c.used])
      );

      usage = planLimits.map((l) => {
        const check = checkLimit(l.value, usedByKey.get(l.key) ?? 0);
        return {
          key: l.key,
          label: l.label,
          limit: check.limit,
          used: check.used,
          remaining: check.remaining,
          unlimited: check.unlimited,
          notIncluded: check.notIncluded,
        };
      });
    }

    const { data: invoices } = companyId
      ? await db
          .from("billing_invoices")
          .select("stripe_invoice_id, status, amount_paid, currency, paid_at, hosted_invoice_url, created_at")
          .eq("company_id", companyId)
          .order("created_at", { ascending: false })
          .limit(12)
      : { data: [] };

    return NextResponse.json({
      billingEnabled: config.stripeEnabled,
      // Only an owner may buy or change a plan; the UI hides the buttons for
      // everyone else rather than letting them fail at the API.
      canManage: !profile?.role || profile.role === "owner",
      trial: {
        enabled: config.trialEnabled,
        days: config.trialDays,
        requiresCard: config.trialRequiresCard,
      },
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        tagline: p.tagline,
        monthlyPrice: p.monthly_price,
        annualPrice: p.annual_price,
        isDefault: p.is_default,
        // Never true during a trial — see hasPurchasedPlan above.
        isCurrent: hasPurchasedPlan && sub?.plan_id === p.id,
        purchasableMonthly: purchasable.has(`${p.id}:monthly`),
        purchasableAnnual: purchasable.has(`${p.id}:annual`),
        limits: limitsByPlan.get(p.id) ?? [],
        features: featuresByPlan.get(p.id) ?? [],
      })),
      subscription: sub
        ? {
            planId: sub.plan_id,
            // Resolved against ALL plans, so a retired plan still has a name.
            // `sub.tier` remains the last resort for rows with no plan_id at all.
            planName:
              allPlans.find((p) => p.id === sub.plan_id)?.name ?? sub.tier,
            /**
             * The plan exists but is no longer sold. The UI says so plainly
             * rather than implying the customer was moved or must act — their
             * price and limits are untouched.
             */
            planRetired:
              !!sub.plan_id &&
              allPlans.some((p) => p.id === sub.plan_id && !p.is_active),
            billingCycle: sub.billing_cycle,
            status: sub.stripe_status ?? sub.status,
            isComped: sub.is_comped,
            compedUntil: sub.comped_until,
            compedReason: sub.comped_reason,
            trialEndsAt: sub.trial_ends_at,
            currentPeriodEnd: sub.current_period_end,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            isPaused: sub.is_paused ?? false,
            pausedAt: sub.paused_at,
            pauseResumesAt: sub.pause_resumes_at,
            // `pause_reason` is deliberately NOT exposed: it is an internal
            // admin note and may say "non-payment" or "contract dispute".
            // Also resolved against ALL plans: a scheduled downgrade to a plan
            // retired after it was scheduled must still show its name.
            pendingPlanName: sub.pending_plan_id
              ? allPlans.find((p) => p.id === sub.pending_plan_id)?.name ?? null
              : null,
            pendingBillingCycle: sub.pending_billing_cycle,
            // Drives whether the portal link is shown: no Stripe subscription in
            // the active mode means there is nothing for the portal to manage.
            hasStripeSubscription:
              !!sub.stripe_subscription_id && sub.stripe_mode === STRIPE_MODE_TAG,
          }
        : null,
      access: {
        allowed: access.allowed,
        reason: access.reason,
        warn: access.warn,
        daysRemaining: access.daysRemaining,
      },
      usage,
      periodEnd: period.periodEnd,
      invoices: invoices ?? [],
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[billing/me] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
