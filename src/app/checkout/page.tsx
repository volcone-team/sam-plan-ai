import { Suspense } from "react";
import { CheckoutClient } from "./checkout-client";

export const metadata = {
  title: "Complete your purchase | SAM Plan AI",
};

/**
 * The bridge between confirming an account and paying for it.
 *
 * WHY A PAGE AND NOT A DIRECT REDIRECT. Creating a Checkout session needs an
 * authenticated session, and immediately after email confirmation the cookies
 * may not be readable yet — the auth callback is still settling. Redirecting
 * straight to Stripe from the confirmation link therefore failed
 * intermittently with "Unauthorized", which looks like a broken payment link.
 *
 * This page waits for the session client-side, then starts checkout. It also
 * gives somewhere to land when Stripe is slow, instead of a blank screen.
 *
 * Suspense because the client reads `?plan=` from the URL.
 */
export default function CheckoutPage() {
  return (
    <Suspense fallback={null}>
      <CheckoutClient />
    </Suspense>
  );
}
