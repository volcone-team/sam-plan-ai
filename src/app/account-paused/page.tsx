import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { PauseCircle, Mail } from "lucide-react";
import { canPurchaseWhilePaused } from "@/lib/billing/live-subscription";
import { BrandLogo } from "@/components/brand-logo";
import { ResumePlanButton } from "@/components/billing/resume-plan-button";
import { SwitchAccountLink } from "@/components/auth/switch-account-link";

export const metadata = {
  title: "Account paused | SAM Plan AI",
};

// The contact email is read per request: an admin changing it should take
// effect immediately, not after a rebuild.
export const dynamic = "force-dynamic";

/**
 * Where a paused account lands.
 *
 * Deliberately OUTSIDE the `(app)` route group. That layout renders the
 * sidebar, header and chat widget — offering navigation to someone who cannot
 * use any of it would be a page full of dead links.
 *
 * WHAT THIS PAGE DOES NOT SAY. The admin's `pause_reason` is never shown. It is
 * an internal note that may read "non-payment" or "contract dispute", and the
 * customer is not its audience. They are told the state and who to contact,
 * which is everything they can act on.
 *
 * The contact address comes from the same `app_settings.chat_contact_email` the
 * AI Tools page edits, so there is ONE place to maintain it rather than a
 * second setting that silently disagrees with the first.
 */
async function loadContactEmail(): Promise<string | null> {
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data } = await db
      .from("app_settings")
      .select("chat_contact_email")
      .eq("id", "global")
      .maybeSingle();

    return (data as { chat_contact_email?: string | null } | null)?.chat_contact_email ?? null;
  } catch (err) {
    // A failed lookup must not break the page — the pause message itself is
    // the important part, and a missing address degrades to generic wording.
    console.error("[account-paused] Could not read contact email:", err);
    return null;
  }
}

/**
 * Is the caller's account actually paused?
 *
 * The middleware redirects paused users HERE, so it never redirects away from
 * here — which left the page reachable by anyone, including after an admin
 * resumed the account. A stale tab or a bookmark then showed "your plan is
 * paused" to someone whose access was fine.
 *
 * Checked server-side on every request (the page is force-dynamic), so the
 * answer cannot be cached from when the pause was real.
 */
interface PauseState {
  paused: boolean;
  /** 'customer' when they paused themselves, 'admin' for a suspension. */
  origin: string | null;
  resumesAt: string | null;
  /** Only an owner may restart billing, matching the resume route. */
  isOwner: boolean;
  /**
   * No live Stripe subscription behind the pause (and not comped), so buying
   * a plan ends it. User decision: "Buying a plan ends the pause".
   */
  canBuyToEndPause: boolean;
}

/**
 * Returns the whole pause state rather than a boolean, because the page now has
 * to answer three questions, not one: is this account paused, did the CUSTOMER
 * pause it, and may this particular person restart it. Two of those decide
 * whether a "restart my plan" button appears at all.
 */
async function loadPauseState(): Promise<PauseState> {
  const DENIED: PauseState = {
    paused: true,
    origin: null,
    resumesAt: null,
    isOwner: false,
    canBuyToEndPause: false,
  };

  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          // A server component cannot set cookies; refresh is the middleware's job.
          setAll() {},
        },
      }
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Not signed in: there is no account to be paused, so nothing to show.
    if (!user) return { ...DENIED, paused: false };

    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profile } = await db
      .from("profiles")
      .select("company_id, role")
      .eq("id", user.id)
      .maybeSingle();

    const me = profile as { company_id?: string | null; role?: string | null } | null;
    const companyId = me?.company_id;
    if (!companyId) return { ...DENIED, paused: false };

    const { data: sub } = await db
      .from("subscriptions")
      .select(
        "is_paused, pause_origin, pause_resumes_at, is_comped, " +
        "stripe_subscription_id, stripe_mode, stripe_status, status"
      )
      .eq("company_id", companyId)
      .maybeSingle();

    const row = sub as unknown as {
      is_paused?: boolean | null;
      pause_origin?: string | null;
      pause_resumes_at?: string | null;
      is_comped?: boolean | null;
      stripe_subscription_id?: string | null;
      stripe_mode?: string | null;
      stripe_status?: string | null;
      status?: string | null;
    } | null;

    return {
      paused: row?.is_paused === true,
      origin: row?.pause_origin ?? null,
      resumesAt: row?.pause_resumes_at ?? null,
      // Same rule as /api/billing/resume: a missing role means sole owner.
      isOwner: !me?.role || me.role === "owner",
      canBuyToEndPause: canPurchaseWhilePaused(row),
    };
  } catch (err) {
    /*
     * Fails CLOSED on the redirect, OPEN on the message: a read failure shows
     * the paused page rather than bouncing someone into an app they may not be
     * entitled to. Being told to contact an admin is recoverable; silently
     * granting access is not.
     *
     * The restart button is withheld in this case too — offering a button that
     * cannot know whether it is allowed is worse than the generic message.
     */
    console.error("[account-paused] Could not verify pause state:", err);
    return DENIED;
  }
}

export default async function AccountPausedPage() {
  const pause = await loadPauseState();

  // Anyone not actually paused has no business here.
  if (!pause.paused) {
    redirect("/year-at-a-glance");
  }

  /**
   * A pause the customer chose is theirs to end. An admin suspension is not —
   * it exists for non-payment, contract disputes and abuse, and a customer who
   * could lift it would make the control decorative. canResumeSelf on the route
   * enforces the same rule, so this only decides what to RENDER.
   */
  const selfPaused = pause.origin === "customer";
  const canRestart = selfPaused && pause.isOwner;

  const resumesOnLabel = pause.resumesAt
    ? new Date(pause.resumesAt).toLocaleDateString("en-US", { dateStyle: "medium" })
    : null;

  const contactEmail = await loadContactEmail();

  return (
    <div className="flex min-h-dvh flex-col bg-[hsl(var(--background-subtle))]">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
          <BrandLogo width={120} height={40} />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
            <PauseCircle
              className="h-6 w-6 text-amber-700 dark:text-amber-400"
              aria-hidden="true"
            />
          </div>

          <h1 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
            Your plan is paused
          </h1>

          <p className="mt-3 text-sm text-[hsl(var(--foreground-muted))]">
            Access to your plan, initiatives and reports is on hold while your
            account is paused. Nothing has been deleted — everything will be
            exactly as you left it once access is restored.
          </p>

          {/*
            A SELF-PAUSED CUSTOMER IS NOT SENT TO AN ADMINISTRATOR.
            They have one and it is them. Telling someone who paused their own
            billing to "contact your administrator" was a dead end with no way
            out of the product, which is why this page now branches.
          */}
          {selfPaused ? (
            <>
              <p className="mt-4 text-sm text-foreground">
                {resumesOnLabel ? (
                  <>
                    You paused this yourself. Billing and access restart
                    automatically on{" "}
                    <span className="font-semibold">{resumesOnLabel}</span>.
                  </>
                ) : (
                  <>You paused this yourself.</>
                )}
              </p>

              {canRestart ? (
                <ResumePlanButton resumesOnLabel={resumesOnLabel} />
              ) : (
                /*
                  Paused by the customer, but this person is not the owner. Only
                  an owner may restart billing, so pointing them at a button
                  that would 403 would be worse than saying who can.
                */
                <p className="mt-5 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
                  The account owner can restart the plan at any time from this
                  page.
                </p>
              )}
            </>
          ) : (
            <p className="mt-4 text-sm font-medium text-foreground">
              To continue, please contact your administrator.
            </p>
          )}

          {/*
            NO LIVE SUBSCRIPTION BEHIND THE PAUSE: buying a plan ends it.
            User decision, "Buying a plan ends the pause". The webhook clears
            the pause when the new subscription lands. Shown only when there is
            nothing live to resume; a paused paid subscription still needs an
            administrator (or the customer's own restart button above).
          */}
          {pause.canBuyToEndPause &&
            (pause.isOwner ? (
              <div className="mt-5 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-4 py-4 text-sm text-foreground">
                <p>
                  There is no active subscription on this account. Choosing a
                  plan restores access straight away and ends the pause.
                </p>
                <Link
                  href="/choose-plan"
                  className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-2"
                >
                  Choose a plan
                </Link>
              </div>
            ) : (
              <p className="mt-5 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
                The account owner can restore access by choosing a plan.
              </p>
            ))}

          {!selfPaused && contactEmail ? (
            <a
              href={`mailto:${contactEmail}?subject=${encodeURIComponent(
                "Paused account — request to restore access"
              )}`}
              className="mt-5 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {contactEmail}
            </a>
          ) : !selfPaused ? (
            /*
              No address configured. Say so plainly rather than rendering a
              dead mailto: link, which would look like the page is broken.
            */
            <p className="mt-5 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
              Please get in touch with the person who manages your SAM Plan AI
              account.
            </p>
          ) : null}

          {/*
            Sign out stays reachable. Someone with access to two accounts needs
            a way off this page, and without it a paused session is a dead end.

            A BUTTON THAT SIGNS OUT, not a link to /auth/login. The link looked
            right and did nothing: the session was still valid, so the user
            arrived at login already authenticated and the lockout gate
            returned them here. Signing out has to happen before the
            navigation, which needs a client component.
          */}
          <p className="mt-6 text-xs text-[hsl(var(--foreground-subtle))]">
            <SwitchAccountLink />
          </p>
        </div>
      </main>
    </div>
  );
}
