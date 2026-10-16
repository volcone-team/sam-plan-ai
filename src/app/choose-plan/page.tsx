import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { loadBillingConfig, STRIPE_MODE_TAG } from "@/lib/billing/stripe-client";
import { evaluateAccess } from "@/lib/billing/entitlement";
import { lockoutCopy } from "@/lib/billing/lockout";
import { decideChoosePlanPage } from "@/lib/billing/billing-gate";
import { ChoosePlanClient, type PurchasablePlan } from "./choose-plan-client";

export const metadata = {
  title: "Choose a plan | SAM Plan AI",
};

// Entitlement must be read per request: a customer who just paid should not be
// shown a cached lockout.
export const dynamic = "force-dynamic";

/**
 * The purchase screen for a locked-out account.
 *
 * ITS OWN ROUTE, outside the `(app)` group, for two reasons. The app layout
 * renders the sidebar, header and chat widget, and offering navigation to
 * someone who cannot open any of it is a page of dead links. And plan purchase
 * used to live only inside `/settings`, which meant blocking that route also
 * removed the one way to pay — so the purchase flow needed somewhere of its own
 * before the rest of settings could be blocked.
 *
 * SERVER-RENDERED, and the reason comes from `evaluateAccess` — the same
 * function the API enforcement path uses. The copy therefore cannot be spoofed
 * by a query parameter, and the page cannot disagree with the gate about
 * whether someone is locked out.
 */
export default async function ChoosePlanPage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // A server component cannot write cookies; refresh is the middleware's job.
        setAll() {},
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

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

  const companyId =
    (profile as { company_id?: string | null } | null)?.company_id ?? null;
  const role = (profile as { role?: string | null } | null)?.role ?? null;

  const { data: subRaw } = companyId
    ? await db
        .from("subscriptions")
        .select(
          "plan_id, tier, status, stripe_status, is_comped, comped_until, " +
          "trial_ends_at, current_period_end, past_due_since, " +
          "cancel_at_period_end, is_paused, pause_resumes_at, " +
          "stripe_subscription_id, stripe_mode"
        )
        .eq("company_id", companyId)
        .maybeSingle()
    : { data: null };

  const sub = subRaw as {
    plan_id: string | null; tier: string; status: string;
    stripe_status: string | null; is_comped: boolean;
    comped_until: string | null; trial_ends_at: string | null;
    current_period_end: string | null; past_due_since: string | null;
    cancel_at_period_end: boolean; is_paused: boolean | null;
    pause_resumes_at: string | null;
    stripe_subscription_id: string | null; stripe_mode: string | null;
  } | null;

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

  /**
   * Where this visitor belongs (decideChoosePlanPage, tested):
   *
   * - PAUSED with a live subscription (or comped): its own page. Paying cannot
   *   lift an admin's pause, so a purchase button would take money and leave
   *   them locked out.
   * - PAUSED with NO live subscription: render the plans. User decision,
   *   "Buying a plan ends the pause" — the webhook clears the pause when the
   *   new subscription lands.
   * - Still entitled: nothing to buy here. Without this the page stays
   *   reachable after payment, so a stale tab or a bookmark shows "your trial
   *   has ended" to someone with a live subscription.
   */
  const outcome = decideChoosePlanPage(
    access,
    sub
      ? {
          is_paused: sub.is_paused,
          pause_resumes_at: sub.pause_resumes_at,
          status: sub.status,
          stripe_status: sub.stripe_status,
          is_comped: sub.is_comped,
          comped_until: sub.comped_until,
          trial_ends_at: sub.trial_ends_at,
          current_period_end: sub.current_period_end,
          past_due_since: sub.past_due_since,
          cancel_at_period_end: sub.cancel_at_period_end,
          stripe_subscription_id: sub.stripe_subscription_id,
          stripe_mode: sub.stripe_mode,
        }
      : null
  );
  if (outcome === "redirect_paused") {
    redirect("/account-paused");
  }
  if (outcome === "redirect_app") {
    redirect("/year-at-a-glance");
  }

  /* ---- The plans they can actually buy ---- */

  const { data: plansRaw } = await db
    .from("subscription_plans")
    .select(
      "id, name, description, tagline, monthly_price, annual_price, " +
      "is_default, display_order"
    )
    .eq("is_active", true)
    .order("display_order");

  const plans = (plansRaw ?? []) as unknown as {
    id: string; name: string; description: string | null;
    tagline: string | null; monthly_price: number; annual_price: number;
    is_default: boolean;
  }[];

  // A plan with no synced price for the active Stripe mode cannot go through
  // checkout, so offering it would produce a dead button.
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

  const planIds = plans.map((p) => p.id);
  const [{ data: limitRows }, { data: featureRows }] = await Promise.all([
    planIds.length
      ? db
          .from("plan_limits")
          .select("plan_id, limit_key, limit_label, limit_value")
          .in("plan_id", planIds)
      : Promise.resolve({ data: [] }),
    planIds.length
      ? db
          .from("plan_features")
          .select("plan_id, feature_key, feature_label, enabled")
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

  const offered: PurchasablePlan[] = plans.map((p) => ({
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

  // The plan they HAD, for the cancellation copy. Resolved against all plans,
  // including retired ones, so a retired plan still has a name.
  const { data: previousPlan } = sub?.plan_id
    ? await db
        .from("subscription_plans")
        .select("name")
        .eq("id", sub.plan_id)
        .maybeSingle()
    : { data: null };

  const copy = lockoutCopy(
    access.reason,
    (previousPlan as { name?: string } | null)?.name ?? null
  );

  return (
    <ChoosePlanClient
      copy={copy}
      reason={access.reason}
      plans={offered}
      // Only an owner may buy. Everyone else is told who to ask rather than
      // being given a button that fails at the API.
      canPurchase={!role || role === "owner"}
      email={user.email ?? null}
    />
  );
}
