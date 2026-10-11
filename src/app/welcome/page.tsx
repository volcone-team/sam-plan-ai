import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { loadBillingConfig } from "@/lib/billing/stripe-client";
import { evaluateAccess } from "@/lib/billing/entitlement";
import { WelcomeClient } from "./welcome-client";

export const metadata = {
  title: "Welcome | SAM Plan AI",
};

export const dynamic = "force-dynamic";

/**
 * The page a new customer lands on after paying.
 *
 * Outside the `(app)` route group deliberately: this is a handover moment, not
 * a dashboard screen, and the sidebar would invite them to wander off before
 * they have done the one thing that makes the product work (the intake).
 *
 * GATED ON ENTITLEMENT, not on a "new user" flag. Reaching this page means
 * Stripe took money, and the only honest way to know that is to evaluate
 * access the same way every other gate does. Without the check it would be a
 * public congratulations page reachable by anyone.
 *
 * Note it does NOT redirect once onboarding is done. Someone may legitimately
 * return for the booking links and the video — the perks are not single-use —
 * so the only redirect is for people who should not be here at all.
 */
export default async function WelcomePage() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
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
    .select("company_id, first_name")
    .eq("id", user.id)
    .maybeSingle();

  const companyId =
    (profile as { company_id?: string | null } | null)?.company_id ?? null;
  const firstName =
    (profile as { first_name?: string | null } | null)?.first_name ?? null;

  const { data: subRaw } = companyId
    ? await db
        .from("subscriptions")
        .select(
          "plan_id, status, stripe_status, is_comped, comped_until, " +
          "trial_ends_at, current_period_end, past_due_since, " +
          "cancel_at_period_end, is_paused, pause_resumes_at"
        )
        .eq("company_id", companyId)
        .maybeSingle()
    : { data: null };

  const sub = subRaw as unknown as {
    plan_id: string | null; status: string; stripe_status: string | null;
    is_comped: boolean; comped_until: string | null;
    trial_ends_at: string | null; current_period_end: string | null;
    past_due_since: string | null; cancel_at_period_end: boolean;
    is_paused: boolean | null; pause_resumes_at: string | null;
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
   * No entitlement means they have not paid, so there is nothing to welcome
   * them to. The middleware would catch this on any app route, but this page
   * sits outside the gate's reach by design and has to check for itself.
   */
  if (!access.allowed) {
    redirect(access.reason === "paused" ? "/account-paused" : "/choose-plan");
  }

  const { data: plan } = sub?.plan_id
    ? await db
        .from("subscription_plans")
        .select("name")
        .eq("id", sub.plan_id)
        .maybeSingle()
    : { data: null };

  /**
   * Has the intake already been completed?
   *
   * Decides whether step 2 reads as an action or as done. Checked against real
   * initiatives rather than a flag, so an abandoned intake correctly still
   * looks outstanding.
   */
  const { count: initiativeCount } = companyId
    ? await db
        .from("initiatives")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId)
    : { count: 0 };

  return (
    <WelcomeClient
      firstName={firstName}
      planName={(plan as { name?: string } | null)?.name ?? null}
      intakeDone={(initiativeCount ?? 0) > 0}
      isTrial={access.reason === "trialing"}
      trialDaysRemaining={access.daysRemaining}
    />
  );
}
