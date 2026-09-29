'use client';

import { BillingPanel } from './billing-panel';

/**
 * Subscription settings.
 *
 * This used to render plan cards from a hardcoded `CURRENT_PLAN_ID = 'plan-pro'`
 * with buttons that showed "Billing coming soon", so it displayed the wrong plan
 * for every account and could not actually change anything.
 *
 * BillingPanel replaces it with the real thing: the company's actual plan, usage
 * against its real limits, Stripe Checkout, plan changes, the billing portal and
 * invoice history — all read from /api/billing/me, which uses the same
 * entitlement functions the server enforces with, so what a customer sees cannot
 * disagree with what they get.
 */
export function SubscriptionSettings() {
  return <BillingPanel />;
}
