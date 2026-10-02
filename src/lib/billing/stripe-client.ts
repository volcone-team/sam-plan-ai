import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stripe client construction.
 *
 * ONE KEY PAIR, no test/live switch. Whatever `STRIPE_SECRET_KEY` and
 * `STRIPE_WEBHOOK_SECRET` hold is what the app uses — put test keys in local
 * development, live keys in production. The environment decides which universe
 * you are in, not a database flag.
 *
 * This deliberately replaced a runtime test/live toggle. Flipping a production
 * app between modes is something you do approximately never, and the toggle cost
 * a mode column, per-row stamping and selection logic for a convenience nobody
 * used. Separation now comes for free from .env.local vs Vercel's env.
 *
 * KEYS LIVE IN ENV VARS, NEVER THE DATABASE — a live secret editable from a web
 * UI would let anyone who reached that table charge or refund real customers.
 *
 * The DATABASE still carries a `stripe_mode` column (always written as the
 * constant below). It is kept only because it participates in unique constraints
 * (billing_invoices, stripe_webhook_events); dropping it would be schema churn
 * for no gain. Nothing reads it to decide behaviour anymore.
 */

/**
 * Pinned to the API version this SDK ships with (stripe@22.6.2). Pinning rather
 * than defaulting means Stripe rolling a new version cannot silently change
 * payload shapes under us; upgrading becomes a deliberate, testable step.
 */
const API_VERSION = "2026-08-26.dahlia" as const;

/**
 * Constant written to every `stripe_mode` column. A fixed value satisfies the
 * unique constraints while carrying no meaning — the real test/live distinction
 * is which key is in the environment.
 */
export const STRIPE_MODE_TAG = "live" as const;

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe is not configured. Set STRIPE_SECRET_KEY in the environment.");
    this.name = "StripeNotConfiguredError";
  }
}

function secretKey(): string | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key && key.trim() ? key.trim() : null;
}

export function webhookSecret(): string | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  return secret && secret.trim() ? secret.trim() : null;
}

/** True when a usable secret key is present. */
export function isStripeConfigured(): boolean {
  return secretKey() !== null;
}

/**
 * Report the mode the configured key implies, for display only. The key prefix
 * tells us whether real money is in play — useful to surface in the admin UI so
 * nobody mistakes a test deployment for a live one, or vice versa.
 */
export function detectKeyKind(): "live" | "test" | "unknown" | "missing" {
  const key = secretKey();
  if (!key) return "missing";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "unknown";
}

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;

  const key = secretKey();
  if (!key) throw new StripeNotConfiguredError();

  client = new Stripe(key, {
    apiVersion: API_VERSION,
    // Surfaces this app in Stripe's dashboard request logs.
    appInfo: { name: "SAM Plan AI", version: "1.0.0" },
    // Transient network failures are common and safe to retry: the SDK sends an
    // idempotency key on writes, so a retry cannot double-charge.
    maxNetworkRetries: 2,
  });

  return client;
}

export interface BillingConfig {
  stripeEnabled: boolean;
  trialEnabled: boolean;
  trialDays: number;
  trialPlanId: string | null;
  trialRequiresCard: boolean;
  dunningGraceDays: number;
}

const FALLBACK_CONFIG: BillingConfig = {
  // Fails CLOSED on billing but OPEN on access: if settings cannot be read we
  // must not start charging people, and evaluateAccess treats stripeEnabled
  // false as "everyone has access". A read failure degrades to the pre-Stripe
  // app rather than locking every customer out.
  stripeEnabled: false,
  trialEnabled: true,
  trialDays: 14,
  trialPlanId: null,
  trialRequiresCard: false,
  dunningGraceDays: 7,
};

/**
 * Load billing settings from the app_settings singleton.
 *
 * Requires a service-role client: app_settings has no user-facing write policy
 * and the billing columns should not be shaped by client reads.
 */
export async function loadBillingConfig(db: SupabaseClient): Promise<BillingConfig> {
  const { data, error } = await db
    .from("app_settings")
    .select(
      "stripe_enabled, trial_enabled, trial_days, trial_plan_id, " +
      "trial_requires_card, dunning_grace_days"
    )
    .eq("id", "global")
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[stripe] Could not load billing config:", error.message);
    return FALLBACK_CONFIG;
  }

  const row = data as unknown as {
    stripe_enabled: boolean | null;
    trial_enabled: boolean | null; trial_days: number | null;
    trial_plan_id: string | null; trial_requires_card: boolean | null;
    dunning_grace_days: number | null;
  };

  return {
    stripeEnabled: row.stripe_enabled === true,
    trialEnabled: row.trial_enabled !== false,
    trialDays: typeof row.trial_days === "number" ? row.trial_days : 14,
    trialPlanId: row.trial_plan_id ?? null,
    trialRequiresCard: row.trial_requires_card === true,
    dunningGraceDays:
      typeof row.dunning_grace_days === "number" ? row.dunning_grace_days : 7,
  };
}

/** Minor units (cents) from a decimal price, which is how Stripe wants amounts. */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/** Minor units back to a display number. */
export function fromMinorUnits(minor: number | null | undefined): number {
  if (typeof minor !== "number" || !Number.isFinite(minor)) return 0;
  return Math.round(minor) / 100;
}
