import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stripe client construction and mode resolution.
 *
 * TEST AND LIVE ARE SEPARATE UNIVERSES. Ids created in one do not exist in the
 * other, so which key is used is not a cosmetic choice — using the wrong one
 * against a stored id fails, and (worse) writing test ids over live ones
 * corrupts real subscriptions. Everything here exists to make the active mode
 * explicit and to keep it paired with the ids it created.
 *
 * KEYS LIVE IN ENV VARS, NEVER IN THE DATABASE. The super-admin toggle selects
 * WHICH pair to use; it does not store secrets. A live secret key editable from
 * a web UI is a far larger blast radius than the convenience is worth — anyone
 * who reached that table could charge or refund real customers.
 */

export type StripeMode = "test" | "live";

/**
 * Pinned to the API version this SDK ships with (stripe@22.6.2). Pinning rather
 * than defaulting means Stripe rolling a new version cannot silently change
 * payload shapes under us; upgrading becomes a deliberate, testable step.
 */
const API_VERSION = "2026-08-26.dahlia" as const;

export class StripeNotConfiguredError extends Error {
  readonly mode: StripeMode;
  constructor(mode: StripeMode) {
    super(
      `Stripe is not configured for ${mode} mode. Set STRIPE_SECRET_KEY_${mode.toUpperCase()}.`
    );
    this.name = "StripeNotConfiguredError";
    this.mode = mode;
  }
}

function secretKeyFor(mode: StripeMode): string | null {
  const key =
    mode === "live"
      ? process.env.STRIPE_SECRET_KEY_LIVE
      : process.env.STRIPE_SECRET_KEY_TEST;
  return key && key.trim() ? key.trim() : null;
}

export function webhookSecretFor(mode: StripeMode): string | null {
  const secret =
    mode === "live"
      ? process.env.STRIPE_WEBHOOK_SECRET_LIVE
      : process.env.STRIPE_WEBHOOK_SECRET_TEST;
  return secret && secret.trim() ? secret.trim() : null;
}

/** True when the given mode has a usable secret key. */
export function isModeConfigured(mode: StripeMode): boolean {
  return secretKeyFor(mode) !== null;
}

/**
 * Guard against the classic and expensive mistake: a live secret key sitting in
 * the test slot, or vice versa. Stripe key prefixes make this checkable, so it
 * is checked rather than hoped for.
 */
export function detectKeyMismatch(mode: StripeMode): string | null {
  const key = secretKeyFor(mode);
  if (!key) return null;

  const isLiveKey = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  const isTestKey = key.startsWith("sk_test_") || key.startsWith("rk_test_");

  if (mode === "live" && isTestKey) {
    return "STRIPE_SECRET_KEY_LIVE holds a TEST key — live payments would not be real.";
  }
  if (mode === "test" && isLiveKey) {
    return "STRIPE_SECRET_KEY_TEST holds a LIVE key — test actions would charge real cards.";
  }
  if (!isLiveKey && !isTestKey) {
    return `The ${mode} secret key does not look like a Stripe secret key.`;
  }
  return null;
}

// Clients are cached per mode: constructing one opens a keep-alive HTTP agent,
// and rebuilding it per request wastes connections under load.
const clients = new Map<StripeMode, Stripe>();

export function getStripe(mode: StripeMode): Stripe {
  const cached = clients.get(mode);
  if (cached) return cached;

  const key = secretKeyFor(mode);
  if (!key) throw new StripeNotConfiguredError(mode);

  const mismatch = detectKeyMismatch(mode);
  if (mismatch) {
    // Loud, because the consequence is either fake "real" payments or real
    // charges during testing.
    console.error("[stripe] KEY MISMATCH:", mismatch);
  }

  const client = new Stripe(key, {
    apiVersion: API_VERSION,
    // Surfaces this app in Stripe's dashboard request logs, which makes
    // debugging a specific call far easier.
    appInfo: { name: "SAM Plan AI", version: "1.0.0" },
    // Transient network failures are common and safe to retry: the SDK sends an
    // idempotency key on writes, so a retry cannot double-charge.
    maxNetworkRetries: 2,
  });

  clients.set(mode, client);
  return client;
}

export interface BillingConfig {
  stripeEnabled: boolean;
  mode: StripeMode;
  trialEnabled: boolean;
  trialDays: number;
  trialPlanId: string | null;
  trialRequiresCard: boolean;
  /** Initiatives allowed for the WHOLE trial, not per period. */
  trialInitiativeCap: number;
  dunningGraceDays: number;
}

const FALLBACK_CONFIG: BillingConfig = {
  // Fails CLOSED on billing but OPEN on access: if settings cannot be read we
  // must not start charging people, and evaluateAccess treats stripeEnabled
  // false as "everyone has access". A read failure degrades to the pre-Stripe
  // app rather than locking every customer out.
  stripeEnabled: false,
  mode: "test",
  trialEnabled: true,
  trialDays: 14,
  trialPlanId: null,
  trialRequiresCard: false,
  trialInitiativeCap: 3,
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
      "stripe_enabled, stripe_mode, trial_enabled, trial_days, trial_plan_id, " +
      "trial_requires_card, trial_initiative_cap, dunning_grace_days"
    )
    .eq("id", "global")
    .maybeSingle();

  if (error || !data) {
    if (error) console.error("[stripe] Could not load billing config:", error.message);
    return FALLBACK_CONFIG;
  }

  // Cast via `unknown`: supabase-js cannot infer a row shape from a concatenated
  // select string and falls back to a union including an error type.
  const row = data as unknown as {
    stripe_enabled: boolean | null; stripe_mode: string | null;
    trial_enabled: boolean | null; trial_days: number | null;
    trial_plan_id: string | null; trial_requires_card: boolean | null;
    trial_initiative_cap: number | null; dunning_grace_days: number | null;
  };

  const mode: StripeMode = row.stripe_mode === "live" ? "live" : "test";

  return {
    stripeEnabled: row.stripe_enabled === true,
    mode,
    trialEnabled: row.trial_enabled !== false,
    trialDays: typeof row.trial_days === "number" ? row.trial_days : 14,
    trialPlanId: row.trial_plan_id ?? null,
    trialRequiresCard: row.trial_requires_card === true,
    trialInitiativeCap:
      typeof row.trial_initiative_cap === "number" ? row.trial_initiative_cap : 3,
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
