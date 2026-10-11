"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

/**
 * The gap between paying Stripe and the app knowing about it.
 *
 * The webhook is the ONLY writer of subscription state, and it is
 * asynchronous — Stripe cannot reach localhost at all, and in production
 * delivery can lag the browser redirect by seconds. So a customer returning
 * from a successful Checkout arrived at /welcome, the page evaluated
 * entitlement, found nothing, and bounced them to the purchase screen. They
 * had already paid. That is the worst possible moment to doubt the product.
 *
 * This closes the gap by reconciling from Stripe before anyone is told they
 * are unentitled. It does NOT grant access: `?checkout=success` is a hint
 * only, and the reconcile reads the truth from Stripe server-side. A forged
 * URL produces a reconcile that finds no subscription, lands back here with
 * `confirmed=1`, and is redirected to the purchase screen as it should be.
 *
 * `confirmed=1` is what stops this from looping. Without a marker the page
 * could not tell "we have not tried yet" from "we tried and there genuinely
 * is no subscription", and a customer with no payment would reconcile forever.
 */
export function ConfirmPayment() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        await fetch("/api/billing/reconcile", {
          method: "POST",
          credentials: "same-origin",
        });
      } catch {
        if (!cancelled) setFailed(true);
        return;
      }

      if (cancelled) return;

      /*
       * Full reload, not a router refresh: entitlement is decided by the
       * server component, and only a fresh request re-runs it. The marker
       * makes this a one-shot attempt.
       */
      const url = new URL(window.location.href);
      url.searchParams.set("checkout", "success");
      url.searchParams.set("confirmed", "1");
      window.location.replace(url.toString());
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-dvh flex-col bg-[hsl(var(--background-subtle))]">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-center px-4 sm:px-6">
          <BrandLogo width={120} height={40} />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6">
        {failed ? (
          <div
            role="alert"
            className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-6 text-center"
          >
            <h1 className="text-base font-semibold text-foreground">
              Your payment went through
            </h1>
            <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
              We just could not confirm it from here. Nothing is lost and you
              have not been charged twice — refresh in a moment and it should
              appear.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              Try again
            </button>
            <p className="mt-4 text-xs text-[hsl(var(--foreground-subtle))]">
              Still stuck? Email support@samplan.ai and we will sort it out.
            </p>
          </div>
        ) : (
          <div className="text-center">
            <Loader2
              className="mx-auto h-6 w-6 animate-spin text-[hsl(var(--primary))]"
              aria-hidden="true"
            />
            <p className="mt-4 text-sm font-medium text-foreground">
              Confirming your payment
            </p>
            <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
              This only takes a moment. Please do not close this tab.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
