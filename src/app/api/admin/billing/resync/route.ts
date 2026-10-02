import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSuperAdmin } from "@/lib/require-admin";
import { getStripe, STRIPE_MODE_TAG } from "@/lib/billing/stripe-client";
import { isEnding } from "@/lib/billing/webhook-logic";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/billing/resync
 *
 * Pulls every subscription from Stripe and writes it to our tables, without
 * waiting for a webhook.
 *
 * WHY THIS IS NEEDED even with a correct webhook: a webhook endpoint is PINNED to
 * the API version it was created with, and that pin cannot be changed. An
 * endpoint created under an old version delivers an old payload shape, so a
 * handler written for the current version can fail to read it — the payment
 * succeeds in Stripe while the customer's plan never updates in the app.
 *
 * This is the repair path for exactly that: state is reconciled FROM Stripe,
 * which is the authority on what was paid. Also useful after any webhook outage,
 * and safe to run repeatedly — it only ever overwrites our copy with Stripe's.
 *
 * Super-admin only.
 */

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Stripe's status onto the legacy 5-value column from migration 001. */
function mapStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case "active": return "active";
    case "trialing": return "trial";
    case "past_due":
    case "unpaid": return "past_due";
    case "canceled":
    case "incomplete_expired": return "cancelled";
    case "paused": return "paused";
    default: return "past_due";
  }
}

export async function POST() {
  try {
    const check = await requireSuperAdmin();
    if (!check.ok) {
      return NextResponse.json({ error: check.error }, { status: check.status });
    }

    const db = adminClient();
    const mode = STRIPE_MODE_TAG;
    const stripe = getStripe();

    const results: { synced: string[]; skipped: string[]; errors: string[] } = {
      synced: [], skipped: [], errors: [],
    };

    // Every non-terminal subscription. 'all' rather than 'active' so a cancelled
    // or past_due one is reflected too — otherwise our copy keeps showing access
    // that Stripe has already withdrawn.
    const subs = await stripe.subscriptions.list({ status: "all", limit: 100 });

    for (const sub of subs.data) {
      try {
        const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const priceId = sub.items.data[0]?.price?.id ?? null;
        const item = sub.items.data[0];
        const interval = item?.price?.recurring?.interval;

        // company_id comes from metadata set at checkout; fall back to matching a
        // stored customer id for subscriptions created before that existed.
        let companyId = sub.metadata?.company_id ?? null;

        if (!companyId) {
          const { data } = await db
            .from("subscriptions")
            .select("company_id")
            .eq("stripe_customer_id", customerId)
            .maybeSingle();
          companyId = (data?.company_id as string) ?? null;
        }

        if (!companyId) {
          results.skipped.push(`${sub.id} — no company_id in metadata or database`);
          continue;
        }

        // Resolve the plan from the price. NOT filtered on is_current: a
        // grandfathered subscriber legitimately sits on a superseded price.
        let planId: string | null = sub.metadata?.plan_id ?? null;
        if (!planId && priceId) {
          const { data } = await db
            .from("stripe_prices")
            .select("plan_id")
            .eq("stripe_mode", mode)
            .eq("stripe_price_id", priceId)
            .maybeSingle();
          planId = (data?.plan_id as string) ?? null;
        }

        const legacySub = sub as unknown as {
          current_period_start?: number; current_period_end?: number;
        };
        const periodStart = item?.current_period_start ?? legacySub.current_period_start ?? null;
        const periodEnd = item?.current_period_end ?? legacySub.current_period_end ?? null;

        const patch: Record<string, unknown> = {
          stripe_mode: mode,
          stripe_customer_id: customerId,
          stripe_subscription_id: sub.id,
          stripe_price_id: priceId,
          stripe_status: sub.status,
          status: mapStatus(sub.status),
          billing_cycle: interval === "year" ? "annual" : "monthly",
          // Covers both cancel_at_period_end and a dated cancel_at.
          cancel_at_period_end: isEnding(sub),
          current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
          current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
          trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
          is_trial_active: sub.status === "trialing",
          renewal_date: isEnding(sub) || !periodEnd
            ? null
            : new Date(periodEnd * 1000).toISOString(),
          cancelled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
          updated_at: new Date().toISOString(),
        };

        if (planId) patch.plan_id = planId;

        // A real paid subscription supersedes any comp: leaving is_comped set
        // would make a paying customer look like they are on free access.
        if (sub.status === "active" || sub.status === "trialing") {
          patch.is_comped = false;
          patch.comped_until = null;
          patch.comped_reason = null;
          patch.past_due_since = null;
        }

        const { error } = await db
          .from("subscriptions")
          .update(patch)
          .eq("company_id", companyId);

        if (error) {
          results.errors.push(`${sub.id}: ${error.message}`);
          continue;
        }

        results.synced.push(`${sub.id} → ${sub.status} (${priceId ?? "no price"})`);
      } catch (err: unknown) {
        results.errors.push(
          `${sub.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // Invoices too, so payment history is not left empty by the same gap.
    const invoices = await stripe.invoices.list({ limit: 100 });
    let invoicesRecorded = 0;
    let invoicesSkipped = 0;

    for (const inv of invoices.data) {
      const customerId =
        typeof inv.customer === "string" ? inv.customer : inv.customer?.id ?? null;
      if (!customerId || !inv.id) continue;

      const { data } = await db
        .from("subscriptions")
        .select("company_id")
        .eq("stripe_customer_id", customerId)
        .eq("stripe_mode", mode)
        .maybeSingle();

      const invoiceCompanyId = (data?.company_id as string) ?? null;

      /**
       * SKIP invoices that belong to no company in THIS database.
       *
       * `stripe.invoices.list` is account-wide, not app-wide. A Stripe account
       * accumulates invoices from every customer it has ever had — earlier
       * testing, deleted accounts, other environments sharing the same keys —
       * and storing them with a null company_id silently imported all of that
       * history into our tables. It then surfaced as revenue: "Collected to
       * date" summed invoices from customers who no longer exist, and payment
       * history listed rows with a blank Company column.
       *
       * Stripe remains the ledger of record for the account as a whole; this
       * table is only the app's view of ITS OWN customers, so an invoice we
       * cannot attribute to a company does not belong here.
       */
      if (!invoiceCompanyId) {
        invoicesSkipped += 1;
        continue;
      }

      const line = inv.lines?.data?.[0];

      const { error } = await db.from("billing_invoices").upsert(
        {
          company_id: invoiceCompanyId,
          stripe_mode: mode,
          stripe_invoice_id: inv.id,
          stripe_customer_id: customerId,
          status: inv.status ?? null,
          amount_due: inv.amount_due ?? null,
          amount_paid: inv.amount_paid ?? null,
          currency: inv.currency ?? "usd",
          description: inv.description ?? line?.description ?? null,
          hosted_invoice_url: inv.hosted_invoice_url ?? null,
          invoice_pdf: inv.invoice_pdf ?? null,
          paid_at:
            inv.status === "paid" && inv.status_transitions?.paid_at
              ? new Date(inv.status_transitions.paid_at * 1000).toISOString()
              : null,
          attempt_count: inv.attempt_count ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "stripe_mode,stripe_invoice_id" }
      );

      if (!error) invoicesRecorded += 1;
    }

    console.log(
      "[admin/billing/resync] synced", results.synced.length,
      "subscriptions,", invoicesRecorded, "invoices,",
      invoicesSkipped, "invoices skipped (no matching company)"
    );

    return NextResponse.json({ ...results, invoicesRecorded, invoicesSkipped });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[admin/billing/resync] Error:", message);
    return NextResponse.json({ error: message || "Internal error" }, { status: 500 });
  }
}
