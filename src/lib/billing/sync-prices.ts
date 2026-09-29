import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe, toMinorUnits, type StripeMode } from "./stripe-client";

/**
 * Sync `subscription_plans` into Stripe products and prices.
 *
 * WHY THIS EXISTS RATHER THAN EDITING PRICES IN STRIPE:
 * Stripe prices are IMMUTABLE. Changing what a plan costs means creating a new
 * Price object; the old one keeps existing and keeps billing whoever is attached
 * to it. That is precisely the grandfathering behaviour we want, so this module
 * leans on it instead of fighting it:
 *
 *   - Changing a plan's price creates a NEW Stripe price and marks the previous
 *     row `is_current = false` — retained, not deleted, because grandfathered
 *     subscribers still reference it.
 *   - Existing subscriptions are untouched. Moving them is a separate, explicit
 *     migration action (see migrateSubscribersToCurrentPrice).
 *
 * Idempotent: running it twice creates nothing the second time.
 */

export interface SyncResult {
  mode: StripeMode;
  created: string[];
  updated: string[];
  unchanged: string[];
  /** Cycles deliberately not offered (price 0) — reported, not an error. */
  skipped: string[];
  errors: { plan: string; message: string }[];
}

interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  monthly_price: number;
  annual_price: number;
  is_active: boolean;
}

interface PriceRow {
  id: string;
  plan_id: string;
  billing_cycle: string;
  stripe_product_id: string;
  stripe_price_id: string;
  unit_amount: number;
}

const CYCLES = [
  { cycle: "monthly" as const, interval: "month" as const, field: "monthly_price" as const },
  { cycle: "annual" as const, interval: "year" as const, field: "annual_price" as const },
];

export async function syncPlansToStripe(
  db: SupabaseClient,
  mode: StripeMode
): Promise<SyncResult> {
  const stripe = getStripe(mode);
  const result: SyncResult = {
    mode, created: [], updated: [], unchanged: [], skipped: [], errors: [],
  };

  const { data: plans, error: plansErr } = await db
    .from("subscription_plans")
    .select("id, name, description, monthly_price, annual_price, is_active")
    .eq("is_active", true)
    .order("display_order");

  if (plansErr) {
    result.errors.push({ plan: "-", message: plansErr.message });
    return result;
  }

  const { data: existing } = await db
    .from("stripe_prices")
    .select("id, plan_id, billing_cycle, stripe_product_id, stripe_price_id, unit_amount")
    .eq("stripe_mode", mode)
    .eq("is_current", true);

  const currentByKey = new Map<string, PriceRow>();
  for (const row of (existing ?? []) as PriceRow[]) {
    currentByKey.set(`${row.plan_id}:${row.billing_cycle}`, row);
  }

  for (const plan of (plans ?? []) as PlanRow[]) {
    for (const { cycle, interval, field } of CYCLES) {
      const amount = toMinorUnits(Number(plan[field]) || 0);
      const label = `${plan.name} (${cycle})`;

      /**
       * A price of 0 means "this plan is not offered on this billing cycle" —
       * e.g. Mastery sold annually only. That is a legitimate configuration, not
       * an error, so the cycle is skipped and the plan stays unpurchasable on it.
       *
       * Stripe cannot express a recurring price of 0 as a subscription anyway;
       * genuinely free access is granted by comping instead.
       */
      if (amount <= 0) {
        result.skipped.push(
          `${label} — not offered (price 0), so no Stripe price created`
        );
        continue;
      }

      const key = `${plan.id}:${cycle}`;
      const current = currentByKey.get(key);

      try {
        if (current && current.unit_amount === amount) {
          result.unchanged.push(label);
          continue;
        }

        // Reuse the product across price changes so Stripe's dashboard keeps one
        // coherent product with a price history, rather than a new product per
        // price edit.
        let productId = current?.stripe_product_id;

        if (!productId) {
          const product = await stripe.products.create({
            name: `SAM Plan AI — ${plan.name}`,
            description: plan.description || undefined,
            metadata: { plan_id: plan.id, plan_name: plan.name },
          });
          productId = product.id;
        }

        const price = await stripe.prices.create({
          product: productId,
          unit_amount: amount,
          currency: "usd",
          recurring: { interval },
          metadata: { plan_id: plan.id, plan_name: plan.name, billing_cycle: cycle },
        });

        // Retire the old row BEFORE inserting the new one: a partial unique index
        // allows only one current price per plan/cycle/mode.
        if (current) {
          await db
            .from("stripe_prices")
            .update({ is_current: false })
            .eq("id", current.id);
        }

        const { error: insertErr } = await db.from("stripe_prices").insert({
          plan_id: plan.id,
          stripe_mode: mode,
          billing_cycle: cycle,
          stripe_product_id: productId,
          stripe_price_id: price.id,
          unit_amount: amount,
          currency: "usd",
          is_current: true,
        });

        if (insertErr) {
          result.errors.push({ plan: label, message: insertErr.message });
          continue;
        }

        if (current) {
          result.updated.push(`${label} — new price, existing subscribers keep the old one`);
        } else {
          result.created.push(label);
        }
      } catch (err: unknown) {
        result.errors.push({
          plan: label,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return result;
}

/**
 * Move existing subscribers onto the current price for their plan.
 *
 * THIS IS THE "apply the new price to everyone" ACTION and it is deliberately
 * separate from syncing. Calling it changes what real customers are charged, so
 * it must be an explicit decision rather than a side effect of editing a price.
 *
 * `proration_behavior: 'none'` — the new amount applies from the next invoice.
 * Prorating a price INCREASE would bill customers immediately for a change they
 * did not request, which is the kind of surprise charge that causes disputes.
 *
 * Comped subscriptions are skipped: they have no Stripe subscription to update.
 */
export async function migrateSubscribersToCurrentPrice(
  db: SupabaseClient,
  mode: StripeMode,
  planId: string
): Promise<{ migrated: number; skipped: number; errors: string[] }> {
  const stripe = getStripe(mode);
  const out = { migrated: 0, skipped: 0, errors: [] as string[] };

  const { data: prices } = await db
    .from("stripe_prices")
    .select("stripe_price_id, billing_cycle")
    .eq("stripe_mode", mode)
    .eq("plan_id", planId)
    .eq("is_current", true);

  const priceByCycle = new Map<string, string>(
    ((prices ?? []) as { stripe_price_id: string; billing_cycle: string }[]).map((p) => [
      p.billing_cycle,
      p.stripe_price_id,
    ])
  );

  if (priceByCycle.size === 0) {
    out.errors.push("No current price for this plan — run a sync first.");
    return out;
  }

  const { data: subs } = await db
    .from("subscriptions")
    .select("id, company_id, stripe_subscription_id, stripe_price_id, billing_cycle, is_comped")
    .eq("plan_id", planId)
    .eq("stripe_mode", mode)
    .not("stripe_subscription_id", "is", null);

  for (const sub of (subs ?? []) as {
    id: string; stripe_subscription_id: string; stripe_price_id: string | null;
    billing_cycle: string; is_comped: boolean;
  }[]) {
    const targetPrice = priceByCycle.get(sub.billing_cycle);

    if (sub.is_comped || !targetPrice || sub.stripe_price_id === targetPrice) {
      out.skipped += 1;
      continue;
    }

    try {
      const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
      const itemId = stripeSub.items.data[0]?.id;
      if (!itemId) {
        out.errors.push(`${sub.stripe_subscription_id}: no subscription item`);
        continue;
      }

      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        items: [{ id: itemId, price: targetPrice }],
        proration_behavior: "none",
      });

      await db
        .from("subscriptions")
        .update({ stripe_price_id: targetPrice, updated_at: new Date().toISOString() })
        .eq("id", sub.id);

      out.migrated += 1;
    } catch (err: unknown) {
      out.errors.push(
        `${sub.stripe_subscription_id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return out;
}
