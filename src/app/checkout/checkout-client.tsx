"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { asBillingCycle, asPlanId, pathForStep } from "@/lib/billing/signup-flow";

/**
 * Starts Stripe Checkout for the plan chosen before registration.
 *
 * Runs once, automatically. If it fails the user gets a reason and a retry
 * rather than a dead end — they have an account by this point, so stranding
 * them here means an account that can never be paid for.
 */
export function CheckoutClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = asPlanId(searchParams.get("plan"));
  /**
   * The cycle picked on /get-started, carried in the URL like the plan.
   * Absent (e.g. a confirmation link sent before the cycle was carried) means
   * monthly, as before.
   */
  const cycle = asBillingCycle(searchParams.get("cycle"));

  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  /**
   * Guards against a double start.
   *
   * Creating two Checkout sessions is not harmful in itself, but React runs
   * effects twice in development and a second session would replace the first
   * mid-redirect.
   */
  const startedRef = useRef(false);

  const start = useCallback(async () => {
    if (!planId) {
      // No plan, or a junk value in the URL. Nothing to buy, so send them to
      // pick one rather than showing an error for something they can fix.
      router.replace("/choose-plan");
      return;
    }

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          billingCycle: cycle ?? "monthly",
          // Lands on the welcome page after paying, not settings.
          returnTo: "welcome",
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (res.status === 401) {
        /*
         * The session is not readable yet — the auth callback may still be
         * settling after email confirmation. Sending them to sign in is
         * better than failing: they return here with a working session.
         */
        router.replace(
          `/auth/login?next=${encodeURIComponent(pathForStep("checkout", planId, cycle))}`
        );
        return;
      }

      if (!res.ok || !body?.url) {
        setError(
          body?.error === "already_subscribed"
            ? "You already have an active plan."
            : body?.error === "not_permitted"
              ? "Only the account owner can purchase a plan."
              : body?.error === "price_not_found" || body?.error === "price_stale"
                ? (body?.message ??
                   "That plan is not available right now. Please choose another.")
                : "We could not start checkout. Please try again."
        );
        return;
      }

      // Leaves for Stripe's hosted page; card details never touch us.
      window.location.href = body.url;
    } catch {
      setError("Could not reach the server. Please try again.");
    }
  }, [planId, cycle, router]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
  }, [start, attempt]);

  const retry = () => {
    setError(null);
    startedRef.current = false;
    setAttempt((n) => n + 1);
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[hsl(var(--background-subtle))] px-4">
      <div className="mb-10">
        <BrandLogo width={160} height={54} />
      </div>

      {error ? (
        <div className="w-full max-w-sm rounded-[var(--radius-lg)] border border-border bg-card p-6 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
            <TriangleAlert
              className="h-5 w-5 text-amber-700 dark:text-amber-400"
              aria-hidden="true"
            />
          </div>
          <h1 className="mt-4 text-base font-semibold text-foreground">
            We couldn&apos;t open checkout
          </h1>
          <p role="alert" className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
            {error}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <button
              onClick={retry}
              className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Try again
            </button>
            {/*
              Always offered: the account exists, so a failure here must not
              leave it with no route to a plan.
            */}
            <button
              onClick={() => router.push("/choose-plan")}
              className="rounded-[var(--radius-md)] border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-[hsl(var(--background-muted))]"
            >
              Choose a different plan
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <Loader2
            className="h-6 w-6 animate-spin text-[hsl(var(--primary))]"
            aria-hidden="true"
          />
          <p className="mt-4 text-sm text-[hsl(var(--foreground-muted))]">
            Taking you to secure checkout…
          </p>
          <p className="mt-1 text-xs text-[hsl(var(--foreground-subtle))]">
            Payment is handled by Stripe.
          </p>
        </div>
      )}
    </div>
  );
}
