import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { loadCallGateSettings } from "@/lib/access/call-gate-settings";
import { resolveOnboardingBookingUrl } from "@/lib/billing/booking";
import { isSuperAdminProfile } from "@/lib/intake-v3/rollout-setting";
import { WelcomeClient, type WelcomePlan } from "../welcome-client";

export const metadata = {
  title: "Welcome page preview | SAM Plan AI",
};

export const dynamic = "force-dynamic";

/**
 * /welcome/preview?plan=monthly | yearly — the post-purchase welcome page as a
 * monthly or yearly customer sees it, for reviewing copy.
 *
 * SUPER ADMINS ONLY; anyone else gets a 404, so the route does not advertise
 * itself. Nothing is read from or written to a customer's account: the page
 * renders with sample values (no first name, intake not done) and the real
 * booking calendar configured for that plan in admin settings.
 *
 * `state=gated` (default) shows the page as a new customer who must book the
 * onboarding call first; `state=open` as one who can already use the app.
 */
export default async function WelcomePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const query = await searchParams;
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll() {} } }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin-login");

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: profile } = await db
    .from("profiles")
    .select("is_admin, admin_level")
    .eq("id", user.id)
    .maybeSingle();
  if (!isSuperAdminProfile(profile as { is_admin?: unknown; admin_level?: unknown } | null)) notFound();

  const plan: WelcomePlan = query.plan === "yearly" || query.plan === "annual" ? "yearly" : "monthly";
  const awaitingCall = query.state !== "open";
  const callSettings = await loadCallGateSettings(db);
  const bookingUrl = resolveOnboardingBookingUrl({
    monthlyUrl: callSettings.bookingUrl,
    yearlyUrl: callSettings.bookingUrlYearly,
    billingCycle: plan === "yearly" ? "yearly" : "monthly",
  });

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-50 bg-amber-400 px-4 py-1.5 text-center text-xs font-semibold text-black">
        Preview: {plan === "yearly" ? "Yearly" : "Monthly"} welcome page
        {awaitingCall ? " · new customer who must book their call" : " · customer with app access"} ·{" "}
        <a className="underline" href={`/welcome/preview?plan=monthly${awaitingCall ? "" : "&state=open"}`}>Monthly</a> ·{" "}
        <a className="underline" href={`/welcome/preview?plan=yearly${awaitingCall ? "" : "&state=open"}`}>Yearly</a> ·{" "}
        <a className="underline" href={`/welcome/preview?plan=${plan}${awaitingCall ? "&state=open" : ""}`}>
          {awaitingCall ? "Show with app access" : "Show as must-book"}
        </a>
      </div>
      <WelcomeClient
        firstName={null}
        planName={null}
        intakeDone={false}
        isTrial={false}
        trialDaysRemaining={null}
        awaitingCall={awaitingCall}
        bookingUrl={bookingUrl}
        plan={plan}
      />
    </>
  );
}
