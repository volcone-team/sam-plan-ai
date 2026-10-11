"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";
import { createClient } from "@/lib/supabase/client";
import type { LockoutCopy } from "@/lib/billing/lockout";
import type { AccessReason } from "@/lib/billing/entitlement";

/**
 * The interactive half of the purchase screen.
 *
 * Presentation only: the page decides WHETHER someone is locked out and WHY,
 * server-side, so nothing here can grant access or alter the reason.
 */

export interface PurchasablePlan {
  id: string;
  name: string;
  description: string | null;
  tagline: string | null;
  monthlyPrice: number;
  annualPrice: number;
  isDefault: boolean;
  purchasableMonthly: boolean;
  purchasableAnnual: boolean;
  limits: { label: string; value: number }[];
  features: { label: string; enabled: boolean }[];
}

type Cycle = "monthly" | "annual";

function money(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** -1 means unlimited; 0 means not included on this plan. */
function limitText(value: number): string {
  if (value < 0) return "Unlimited";
  if (value === 0) return "Not included";
  return value.toLocaleString();
}

export function ChoosePlanClient({
  copy,
  reason,
  plans,
  canPurchase,
  email,
}: {
  copy: LockoutCopy;
  reason: AccessReason;
  plans: PurchasablePlan[];
  canPurchase: boolean;
  email: string | null;
}) {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** True while recovering a payment Stripe made but no webhook recorded. */
  const [reconciling, setReconciling] = useState(false);

  /**
   * RECOVER A PAYMENT THAT NEVER REACHED US.
   *
   * The webhook is the only writer of subscription state, and Stripe cannot
   * deliver webhooks to localhost at all — nor is delivery instant in
   * production. Returning from a successful Checkout therefore found no
   * subscription, so this page decided the user was still unentitled and
   * showed the purchase screen again. They had paid.
   *
   * `?checkout=success` is a HINT ONLY and grants nothing: it merely triggers
   * a reconcile, which reads the truth from Stripe server-side. A forged URL
   * gets a reconcile that finds no subscription and changes nothing.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("checkout") !== "success") {
      return;
    }

    let cancelled = false;
    setReconciling(true);

    (async () => {
      try {
        await fetch("/api/billing/reconcile", {
          method: "POST",
          credentials: "same-origin",
        });
        if (cancelled) return;
        /*
         * Full reload rather than a router refresh: entitlement is evaluated
         * server-side on this page, and a reload is the only way to re-run it
         * and leave the redirect to the dashboard to the page itself.
         */
        const url = new URL(window.location.href);
        url.searchParams.delete("checkout");
        window.location.replace(url.toString());
      } catch {
        if (!cancelled) {
          setReconciling(false);
          setError(
            "Your payment went through, but we could not confirm it yet. " +
              "Wait a moment and refresh — if it persists, contact support and " +
              "we will sort it out."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A failed payment is fixed in the Stripe portal, not by buying again:
   * the subscription already exists and only needs a working card. Sending
   * them through checkout would create a second subscription.
   */
  const isPaymentFailure = reason === "past_due_expired";

  const openPortal = async () => {
    setBusyPlanId("portal");
    setError(null);
    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        credentials: "same-origin",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setError("Could not open the billing portal. Please try again.");
        setBusyPlanId(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError("Could not reach the server.");
      setBusyPlanId(null);
    }
  };

  const subscribe = async (planId: string) => {
    setBusyPlanId(planId);
    setError(null);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, billingCycle: cycle }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body?.url) {
        setError(
          body?.error === "already_subscribed"
            ? "You already have a subscription. Try refreshing the page."
            : body?.error === "not_permitted"
              ? "Only the account owner can manage billing."
              : body?.error === "price_stale" || body?.error === "price_not_found"
                ? (body?.message ??
                   "This plan is not available yet. Please contact support.")
                : "Could not start checkout. Please try again."
        );
        setBusyPlanId(null);
        return;
      }

      // Leaves for Stripe's hosted page; card data never touches us.
      window.location.href = body.url;
    } catch {
      setError("Could not reach the server.");
      setBusyPlanId(null);
    }
  };

  /**
   * Sign out stays available. Without it this screen is a dead end for anyone
   * with a second account, and for anyone who simply wants to leave.
   */
  const signOut = async () => {
    try {
      // Local scope: signing out here must not end the user's sessions on
      // their other devices.
      await createClient().auth.signOut({ scope: "local" });
    } catch {
      // Fall through to the redirect regardless — staying stuck here is worse
      // than an unclean sign-out.
    }
    window.location.assign("/auth/login");
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[hsl(var(--background-subtle))]">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandLogo width={120} height={40} />
          <div className="flex items-center gap-3">
            {email && (
              <span className="hidden text-xs text-[hsl(var(--foreground-muted))] sm:inline">
                {email}
              </span>
            )}
            <button
              onClick={signOut}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background-muted))] hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {copy.title}
            </h1>
            <p className="mt-3 text-sm text-[hsl(var(--foreground-muted))]">
              {copy.body}
            </p>
          </div>

          {!canPurchase ? (
            /*
              A team member cannot buy. Told plainly, with who to ask, rather
              than being shown buttons that fail at the API.
            */
            <p className="mx-auto mt-8 max-w-md rounded-[var(--radius-lg)] border border-border bg-card px-5 py-4 text-center text-sm text-[hsl(var(--foreground-muted))]">
              Only the account owner can choose a plan. Ask them to restore
              access for your team.
            </p>
          ) : isPaymentFailure ? (
            <div className="mx-auto mt-8 max-w-md text-center">
              <button
                onClick={openPortal}
                disabled={busyPlanId !== null}
                className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {busyPlanId === "portal" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {copy.cta}
              </button>
              <p className="mt-3 text-xs text-[hsl(var(--foreground-subtle))]">
                You keep your current plan — this only updates how you pay.
              </p>
            </div>
          ) : (
            <>
              {/* Cycle toggle */}
              <div className="mt-8 flex justify-center">
                <div className="inline-flex rounded-[var(--radius-md)] border border-border bg-card p-1">
                  {(["monthly", "annual"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => setCycle(c)}
                      className={cn(
                        "rounded-[var(--radius-sm)] px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                        cycle === c
                          ? "bg-[hsl(var(--primary))] text-white"
                          : "text-[hsl(var(--foreground-muted))] hover:text-foreground"
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              {plans.length === 0 ? (
                /*
                  No plans configured, or none with a synced Stripe price.
                  That is an operator fault, so it says who to contact instead
                  of leaving an empty page.
                */
                <p className="mx-auto mt-8 max-w-md rounded-[var(--radius-lg)] border border-border bg-card px-5 py-4 text-center text-sm text-[hsl(var(--foreground-muted))]">
                  No plans are available to purchase right now. Please contact
                  support and we will sort it out.
                </p>
              ) : (
                <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {plans.map((plan) => {
                    const price =
                      cycle === "annual" ? plan.annualPrice : plan.monthlyPrice;
                    const buyable =
                      cycle === "annual"
                        ? plan.purchasableAnnual
                        : plan.purchasableMonthly;

                    return (
                      <div
                        key={plan.id}
                        className={cn(
                          "flex flex-col rounded-[var(--radius-lg)] border bg-card p-5",
                          plan.isDefault
                            ? "border-[hsl(var(--primary))] shadow-sm"
                            : "border-border"
                        )}
                      >
                        <h2 className="text-base font-semibold text-foreground">
                          {plan.name}
                        </h2>
                        {plan.tagline && (
                          <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
                            {plan.tagline}
                          </p>
                        )}

                        <p className="mt-4">
                          <span className="text-2xl font-bold text-foreground">
                            {money(price)}
                          </span>
                          <span className="text-sm text-[hsl(var(--foreground-muted))]">
                            {cycle === "annual" ? "/year" : "/month"}
                          </span>
                        </p>

                        {plan.description && (
                          <p className="mt-3 text-xs text-[hsl(var(--foreground-muted))]">
                            {plan.description}
                          </p>
                        )}

                        {plan.limits.length > 0 && (
                          <ul className="mt-4 space-y-1.5 text-xs">
                            {plan.limits.map((l) => (
                              <li
                                key={l.label}
                                className="flex items-baseline justify-between gap-2"
                              >
                                <span className="text-[hsl(var(--foreground-muted))]">
                                  {l.label}
                                </span>
                                <span className="font-medium tabular-nums text-foreground">
                                  {limitText(l.value)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}

                        {plan.features.some((f) => f.enabled) && (
                          <ul className="mt-3 space-y-1.5 text-xs">
                            {plan.features
                              .filter((f) => f.enabled)
                              .map((f) => (
                                <li key={f.label} className="flex items-start gap-1.5">
                                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(var(--primary))]" />
                                  <span className="text-[hsl(var(--foreground-muted))]">
                                    {f.label}
                                  </span>
                                </li>
                              ))}
                          </ul>
                        )}

                        <div className="mt-5 pt-1">
                          <button
                            onClick={() => subscribe(plan.id)}
                            disabled={!buyable || busyPlanId !== null}
                            className={cn(
                              "inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] px-4 py-2.5 text-sm font-semibold transition-opacity",
                              buyable
                                ? "bg-[hsl(var(--primary))] text-white hover:opacity-90"
                                : "cursor-not-allowed border border-border text-[hsl(var(--foreground-muted))]",
                              busyPlanId !== null && "opacity-50"
                            )}
                          >
                            {busyPlanId === plan.id && (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            )}
                            {buyable
                              ? `Choose ${plan.name}`
                              : /*
                                  Not purchasable means no synced Stripe price
                                  for this cycle — a configuration gap, not a
                                  decision the customer made.
                                */
                                `Not available ${cycle}`}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {error && (
            <p
              role="alert"
              className="mx-auto mt-6 max-w-md rounded-[var(--radius-md)] border border-[hsl(var(--invalid-border))] bg-[hsl(var(--invalid)_/_0.08)] px-4 py-3 text-center text-sm text-[hsl(var(--destructive))]"
            >
              {error}
            </p>
          )}

          <p className="mt-10 text-center text-xs text-[hsl(var(--foreground-subtle))]">
            Questions? Email support@samplan.ai
          </p>
        </div>
      </main>
    </div>
  );
}
