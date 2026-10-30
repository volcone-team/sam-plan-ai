import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { loadBillingConfig, STRIPE_MODE_TAG } from "@/lib/billing/stripe-client";
import { firstSignupStep } from "@/lib/billing/signup-flow";
import { loadPricingTable } from "@/lib/billing/load-pricing-table";
import { readRegistrationOpen } from "@/lib/auth/registration-setting";
import { RegistrationClosedNotice } from "@/components/auth/registration-closed-notice";
import { selectComparisonPlans } from "@/components/billing/plan-comparison-view";
import {
  GetStartedClient,
  type SignupComparison,
  type SignupPlan,
} from "./get-started-client";

export const metadata = {
  title: "Choose your plan | SAM Plan AI",
};

// Plans and the trial setting are read per request: an admin change should take
// effect immediately, not after a rebuild.
export const dynamic = "force-dynamic";

/**
 * Plan selection BEFORE registering — the first screen of the no-trial flow.
 *
 * PUBLIC. There is no account yet, which is the whole point: with trials off
 * nothing is free, so the plan is chosen first and carried into signup through
 * the URL.
 *
 * Distinct from /choose-plan, which looks similar but is not the same screen:
 * that one is for an EXISTING signed-in account that has lost entitlement, and
 * it starts Stripe Checkout directly. This one has no session to attach a
 * purchase to, so its only job is to hand a plan id to the signup form.
 *
 * If the admin turns the trial ON, this page has no reason to exist and
 * redirects to signup rather than asking someone to choose something they are
 * about to be given free.
 */
export default async function GetStartedPage() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [config, registration] = await Promise.all([loadBillingConfig(db), readRegistrationOpen(db)]);

  // The admin has closed new registrations: no plans to pick.
  if (!registration.open) return <RegistrationClosedNotice />;

  // Trial on, or billing off entirely: no plan choice belongs in signup.
  if (firstSignupStep({
    trialEnabled: config.trialEnabled,
    stripeEnabled: config.stripeEnabled,
  }) === "register") {
    redirect("/auth/signup");
  }

  // A plan with no synced price for the active Stripe mode cannot be bought, so
  // offering it here would strand someone at checkout after they registered.
  // The comparison table (migration 050) is read alongside; null means "show
  // the plan cards", including when 050 is not applied.
  const [{ data: plansRaw }, { data: prices }, pricing] = await Promise.all([
    db
      .from("subscription_plans")
      .select(
        "id, name, description, tagline, monthly_price, annual_price, " +
        "is_default, display_order"
      )
      .eq("is_active", true)
      .order("display_order"),
    db
      .from("stripe_prices")
      .select("plan_id, billing_cycle")
      .eq("stripe_mode", STRIPE_MODE_TAG)
      .eq("is_current", true),
    loadPricingTable(db),
  ]);

  const plans = (plansRaw ?? []) as unknown as {
    id: string; name: string; description: string | null;
    tagline: string | null; monthly_price: number; annual_price: number;
    is_default: boolean;
  }[];

  const purchasable = new Set(
    ((prices ?? []) as { plan_id: string; billing_cycle: string }[]).map(
      (p) => `${p.plan_id}:${p.billing_cycle}`
    )
  );

  const planIds = plans.map((p) => p.id);
  const [{ data: limitRows }, { data: featureRows }] = await Promise.all([
    planIds.length
      ? db
          .from("plan_limits")
          .select("plan_id, limit_label, limit_value")
          .in("plan_id", planIds)
      : Promise.resolve({ data: [] }),
    planIds.length
      ? db
          .from("plan_features")
          .select("plan_id, feature_label, enabled")
          .in("plan_id", planIds)
      : Promise.resolve({ data: [] }),
  ]);

  const limitsByPlan = new Map<string, { label: string; value: number }[]>();
  for (const r of (limitRows ?? []) as {
    plan_id: string; limit_label: string; limit_value: number;
  }[]) {
    const list = limitsByPlan.get(r.plan_id) ?? [];
    list.push({ label: r.limit_label, value: r.limit_value });
    limitsByPlan.set(r.plan_id, list);
  }

  const featuresByPlan = new Map<string, { label: string; enabled: boolean }[]>();
  for (const r of (featureRows ?? []) as {
    plan_id: string; feature_label: string; enabled: boolean;
  }[]) {
    const list = featuresByPlan.get(r.plan_id) ?? [];
    list.push({ label: r.feature_label, enabled: r.enabled });
    featuresByPlan.set(r.plan_id, list);
  }

  const offered: SignupPlan[] = plans
    // Unbuyable plans are dropped rather than shown disabled: this is the first
    // thing a prospect sees, and a dead card reads as a broken product.
    .filter(
      (p) =>
        purchasable.has(`${p.id}:monthly`) || purchasable.has(`${p.id}:annual`)
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      tagline: p.tagline,
      monthlyPrice: Number(p.monthly_price) || 0,
      annualPrice: Number(p.annual_price) || 0,
      isDefault: p.is_default,
      purchasableMonthly: purchasable.has(`${p.id}:monthly`),
      purchasableAnnual: purchasable.has(`${p.id}:annual`),
      limits: limitsByPlan.get(p.id) ?? [],
      features: featuresByPlan.get(p.id) ?? [],
    }));

  // Only plans both in the table and offered above, in table order. None in
  // common means there is no table to show, so the cards render instead.
  const comparisonPlans = pricing ? selectComparisonPlans(pricing.table, offered) : [];
  const comparison: SignupComparison | null =
    pricing && comparisonPlans.length > 0
      ? {
          table: pricing.table,
          annualNote: pricing.annualNote,
          annualNoteValueCents: pricing.annualNoteValueCents,
          plans: comparisonPlans,
        }
      : null;

  return <GetStartedClient plans={offered} comparison={comparison} />;
}
