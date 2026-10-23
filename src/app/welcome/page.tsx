import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { loadBillingConfig } from "@/lib/billing/stripe-client";
import { evaluateAccess } from "@/lib/billing/entitlement";
import { needsCallUnlock, type CallGateCompany } from "@/lib/access/call-gate";
import {
  loadCallGateSettings,
  stampCallUnlockForNewCompany,
} from "@/lib/access/call-gate-settings";
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import {
  resolveOnboardingBookingUrl,
  onboardingBookingCycle,
} from "@/lib/billing/booking";
import { WelcomeClient } from "./welcome-client";
import { ConfirmPayment } from "./confirm-payment";

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
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
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
          "cancel_at_period_end, is_paused, pause_resumes_at, billing_cycle"
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
    billing_cycle: string | null;
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
   *
   * EXCEPT right after Checkout. The webhook is the only writer of
   * subscription state and it arrives asynchronously — it cannot reach
   * localhost at all, and in production it can lag the browser redirect. So
   * the honest answer here is not "unentitled", it is "we do not know yet":
   * reconcile from Stripe first, and only then decide.
   *
   * `?checkout=success` grants nothing. It triggers a reconcile that reads
   * Stripe server-side; `confirmed=1` records that the attempt has been made,
   * so someone who never paid is redirected on the second pass instead of
   * reconciling in a loop.
   */
  if (!access.allowed) {
    const justPaid = query.checkout === "success";
    const alreadyReconciled = query.confirmed === "1";

    if (justPaid && !alreadyReconciled && access.reason !== "paused") {
      return <ConfirmPayment />;
    }

    redirect(access.reason === "paused" ? "/account-paused" : "/choose-plan");
  }

  /**
   * THE ONBOARDING CALL GATE (migration 043).
   *
   * Reached only once entitlement is settled above, which is what makes this
   * the thank-you page rather than a second lockout screen: they have paid,
   * and the one thing left is to meet somebody.
   *
   * THIS IS ALSO WHERE THE PAID FLOW GETS STAMPED. Public signup's company row
   * is written by the `handle_new_user` trigger, and the confirmation link can
   * land on /auth/confirmed as a hash fragment the server never sees, so no
   * application code reliably runs at creation. The middleware has a backstop
   * for the trial flow (which never passes this page); this covers the no-trial
   * flow, where the company is created at registration and arrives here a few
   * minutes later, inside the stamp's grace window.
   *
   * Service-role client on purpose: `requires_call_unlock` is not writable from
   * a customer session, and `app_settings` is not readable from one.
   * `stampCallUnlockForNewCompany` is idempotent, never un-stamps, never
   * re-locks a company that has been granted access, refuses a company older
   * than the grace window, and never throws.
   */
  const callSettings = await loadCallGateSettings(db);

  let callGateCompany: CallGateCompany | null = null;

  if (companyId) {
    const { data: companyRow, error: companyError } = await db
      .from("companies")
      .select("requires_call_unlock, portal_access_granted_at")
      .eq("id", companyId)
      .maybeSingle();

    if (companyError) {
      // Fails OPEN, like everywhere else in this feature: before 043 is applied
      // the columns do not exist, and no read failure may turn a paying
      // customer's welcome page into a waiting room.
      if (!isMissingColumnError(companyError)) {
        console.warn(
          "[welcome] call-gate columns unreadable, not gating:",
          companyError.message
        );
      }
    } else if (companyRow) {
      const row = companyRow as unknown as {
        requires_call_unlock?: boolean | null;
        portal_access_granted_at?: string | null;
      };
      callGateCompany = {
        requires_call_unlock: row.requires_call_unlock ?? null,
        portal_access_granted_at: row.portal_access_granted_at ?? null,
      };

      /*
       * Only a company with NO decision yet is a candidate, and only while the
       * switch is on — which is already in hand, so the normal case (feature
       * off, or an already flagged or already unlocked company) adds no query
       * beyond the read above.
       */
      if (
        callSettings.requireCall &&
        callGateCompany.requires_call_unlock !== true &&
        !callGateCompany.portal_access_granted_at
      ) {
        const stamp = await stampCallUnlockForNewCompany(db, companyId);
        if (stamp.stamped) {
          callGateCompany = {
            requires_call_unlock: true,
            portal_access_granted_at: null,
          };
        }
      }
    }
  }

  const awaitingCall = needsCallUnlock(callGateCompany);

  /*
   * Monthly or yearly calendar. Only a paid subscription's cycle counts — a
   * trial or comp gets the monthly link whatever the row's NOT NULL
   * billing_cycle default says — and a yearly customer with no yearly link
   * set falls back to the monthly one.
   */
  const bookingUrl = resolveOnboardingBookingUrl({
    monthlyUrl: callSettings.bookingUrl,
    yearlyUrl: callSettings.bookingUrlYearly,
    billingCycle: onboardingBookingCycle({
      accessReason: access.reason,
      billingCycle: sub?.billing_cycle ?? null,
    }),
  });

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
      awaitingCall={awaitingCall}
      bookingUrl={bookingUrl}
    />
  );
}
