import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  getStripe,
  webhookSecretFor,
  loadBillingConfig,
  type StripeMode,
} from "@/lib/billing/stripe-client";

export const runtime = "nodejs";
// Stripe retries on any non-2xx, so slow handling is safe — but a hung handler
// wastes retries. 60s is far more than the work needs.
export const maxDuration = 60;

/**
 * POST /api/stripe/webhook
 *
 * The ONLY writer of subscription status. Checkout does not mark anyone active;
 * this does, because Stripe is the authority on whether money moved and the
 * browser can be closed, spoofed, or simply never return from checkout.
 *
 * THREE THINGS THIS GETS RIGHT, each of which is a real bug if skipped:
 *
 * 1. SIGNATURE VERIFICATION. This endpoint is public — it must be, Stripe calls
 *    it. Without verifying the signature anyone could POST a fake
 *    `invoice.paid` and grant themselves a subscription. The raw body is
 *    required for this (see the `request.text()` below); parsing it first
 *    invalidates the signature.
 *
 * 2. IDEMPOTENCY. Stripe retries on failure and can deliver the same event more
 *    than once even after a 200. Re-processing `invoice.paid` could double-extend
 *    a period. The insert into stripe_webhook_events is the lock: a unique
 *    violation means "already handled", so we acknowledge and stop.
 *
 * 3. OUT-OF-ORDER DELIVERY. Events are not guaranteed in order, so a stale
 *    `subscription.updated` can arrive after a newer one. Subscription state is
 *    therefore re-fetched from Stripe rather than trusted from the payload.
 *
 * Always returns 200 once an event is recorded, even if our own handling failed —
 * the failure is stored with status 'failed' for operator follow-up. Returning
 * 500 would make Stripe retry forever on a bug it cannot fix.
 */

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
]);

function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  const db = adminClient();

  // The mode the app is CURRENTLY in decides which signing secret applies. A
  // webhook from the other universe will fail verification, which is correct:
  // test events must never mutate live records.
  const config = await loadBillingConfig(db);
  const mode: StripeMode = config.mode;

  const secret = webhookSecretFor(mode);
  if (!secret) {
    console.error("[stripe/webhook] No signing secret configured for", mode);
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    console.warn("[stripe/webhook] Request without a signature header — rejected");
    return NextResponse.json({ error: "no_signature" }, { status: 400 });
  }

  // RAW body, not request.json(): the signature covers the exact bytes Stripe
  // sent, so any re-serialisation breaks verification.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe(mode).webhooks.constructEvent(rawBody, signature, secret);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[stripe/webhook] Signature verification failed:", message);
    // 400 (not 500): the payload is untrusted, and Stripe should not retry it.
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // --- Idempotency gate -----------------------------------------------------
  // Insert first. A duplicate key means another delivery already handled this.
  const { error: claimError } = await db.from("stripe_webhook_events").insert({
    stripe_mode: mode,
    stripe_event_id: event.id,
    event_type: event.type,
    event_created: new Date(event.created * 1000).toISOString(),
    status: "processed",
    payload: event.data.object as unknown as Record<string, unknown>,
  });

  if (claimError) {
    // 23505 = unique_violation.
    if (claimError.code === "23505") {
      console.log("[stripe/webhook] Duplicate event ignored:", event.id, event.type);
      return NextResponse.json({ received: true, duplicate: true });
    }
    console.error("[stripe/webhook] Could not record event:", claimError.message);
    // A genuine DB fault: let Stripe retry, since the event was never handled.
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    await db
      .from("stripe_webhook_events")
      .update({ status: "ignored" })
      .eq("stripe_mode", mode)
      .eq("stripe_event_id", event.id);
    return NextResponse.json({ received: true, ignored: true });
  }

  try {
    await handleEvent(db, mode, event);
    console.log("[stripe/webhook] Handled", event.type, event.id);
    return NextResponse.json({ received: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe/webhook] Handler failed for", event.type, message);

    await db
      .from("stripe_webhook_events")
      .update({ status: "failed", error_message: message.slice(0, 1000) })
      .eq("stripe_mode", mode)
      .eq("stripe_event_id", event.id);

    // 200 on purpose: the event is recorded as failed for follow-up. Retrying
    // will not fix a logic bug, and an endlessly retried event buries real ones.
    return NextResponse.json({ received: true, handlerFailed: true });
  }
}

async function handleEvent(
  db: SupabaseClient,
  mode: StripeMode,
  event: Stripe.Event
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // Subscription mode only; a one-off payment has no subscription to sync.
      if (session.mode === "subscription" && session.subscription) {
        await syncSubscription(db, mode, String(session.subscription));
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      // Re-fetch rather than trusting the payload: events can arrive out of
      // order, and the API always returns current truth.
      await syncSubscription(db, mode, sub.id);
      break;
    }

    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const invoice = event.data.object as Stripe.Invoice;
      await recordInvoice(db, mode, invoice);

      // A paid or failed invoice changes subscription status, so resync.
      const subId = subscriptionIdFromInvoice(invoice);
      if (subId) await syncSubscription(db, mode, subId);
      break;
    }
  }
}

/**
 * Pull a subscription from Stripe and write it to our row.
 *
 * Company resolution is by stripe_customer_id first, then the `company_id`
 * metadata we set at checkout. Metadata is the fallback because the customer id
 * may not be stored yet on a first subscription.
 */
async function syncSubscription(
  db: SupabaseClient,
  mode: StripeMode,
  subscriptionId: string
): Promise<void> {
  const stripe = getStripe(mode);
  const sub = await stripe.subscriptions.retrieve(subscriptionId);

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const companyId = await resolveCompanyId(db, mode, customerId, sub.metadata);

  if (!companyId) {
    // Not an error we can fix by retrying: without a company the row has no home.
    throw new Error(`No company for subscription ${subscriptionId} (customer ${customerId})`);
  }

  const priceId = sub.items.data[0]?.price?.id ?? null;
  const planId = priceId ? await resolvePlanId(db, mode, priceId) : null;
  const item = sub.items.data[0];
  const interval = item?.price?.recurring?.interval;

  // Stripe reports periods on the subscription ITEM in current API versions.
  const periodStart = item?.current_period_start ?? null;
  const periodEnd = item?.current_period_end ?? null;

  const patch: Record<string, unknown> = {
    stripe_mode: mode,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    stripe_status: sub.status,
    status: mapStatus(sub.status),
    billing_cycle: interval === "year" ? "annual" : "monthly",
    cancel_at_period_end: sub.cancel_at_period_end === true,
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    is_trial_active: sub.status === "trialing",
    renewal_date: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  if (planId) patch.plan_id = planId;

  // past_due_since anchors the dunning grace window. Set it when entering
  // past_due and CLEAR it on recovery, or a later failure would measure grace
  // from the first-ever failure and lock someone out immediately.
  if (sub.status === "past_due" || sub.status === "unpaid") {
    const { data: existing } = await db
      .from("subscriptions")
      .select("past_due_since")
      .eq("company_id", companyId)
      .maybeSingle();
    if (!existing?.past_due_since) {
      patch.past_due_since = new Date().toISOString();
    }
  } else {
    patch.past_due_since = null;
  }

  // A completed downgrade clears its pending target.
  if (sub.status === "active" || sub.status === "trialing") {
    patch.pending_plan_id = null;
    patch.pending_billing_cycle = null;
  }

  const { error } = await db.from("subscriptions").update(patch).eq("company_id", companyId);
  if (error) throw new Error(`Subscription update failed: ${error.message}`);
}

/**
 * Extract the subscription id from an invoice.
 *
 * `invoice.subscription` was REMOVED in recent API versions (this SDK targets
 * 2026-08-26.dahlia). The link now lives under
 * `invoice.parent.subscription_details.subscription`, which may be an id or an
 * expanded object. Reading the old field silently yields undefined, so every
 * invoice would look like a one-off and no subscription would ever resync.
 */
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const details = invoice.parent?.subscription_details;
  if (!details) return null;
  const sub = details.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}

/** Map Stripe's richer status onto the legacy 5-value column from migration 001. */
function mapStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case "active":
      return "active";
    case "trialing":
      return "trial";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    case "paused":
      return "paused";
    default:
      // incomplete: checkout started, never finished.
      return "past_due";
  }
}

async function resolveCompanyId(
  db: SupabaseClient,
  mode: StripeMode,
  customerId: string,
  metadata: Stripe.Metadata | null
): Promise<string | null> {
  const { data: byCustomer } = await db
    .from("subscriptions")
    .select("company_id")
    .eq("stripe_customer_id", customerId)
    .eq("stripe_mode", mode)
    .maybeSingle();

  if (byCustomer?.company_id) return byCustomer.company_id as string;

  const fromMetadata = metadata?.company_id;
  if (fromMetadata) {
    const { data: byId } = await db
      .from("subscriptions")
      .select("company_id")
      .eq("company_id", fromMetadata)
      .maybeSingle();
    if (byId?.company_id) return byId.company_id as string;
  }

  return null;
}

async function resolvePlanId(
  db: SupabaseClient,
  mode: StripeMode,
  priceId: string
): Promise<string | null> {
  // Not filtered on is_current: a grandfathered subscriber legitimately sits on
  // a superseded price and must still resolve to its plan.
  const { data } = await db
    .from("stripe_prices")
    .select("plan_id")
    .eq("stripe_mode", mode)
    .eq("stripe_price_id", priceId)
    .maybeSingle();
  return (data?.plan_id as string) ?? null;
}

/** Upsert an invoice for the billing history view. */
async function recordInvoice(
  db: SupabaseClient,
  mode: StripeMode,
  invoice: Stripe.Invoice
): Promise<void> {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;

  const subId = subscriptionIdFromInvoice(invoice);

  let companyId: string | null = null;
  if (customerId) {
    const { data } = await db
      .from("subscriptions")
      .select("company_id")
      .eq("stripe_customer_id", customerId)
      .eq("stripe_mode", mode)
      .maybeSingle();
    companyId = (data?.company_id as string) ?? null;
  }

  const line = invoice.lines?.data?.[0];

  const { error } = await db.from("billing_invoices").upsert(
    {
      company_id: companyId,
      stripe_mode: mode,
      stripe_invoice_id: invoice.id,
      stripe_customer_id: customerId,
      stripe_subscription_id: subId,
      status: invoice.status ?? null,
      amount_due: invoice.amount_due ?? null,
      amount_paid: invoice.amount_paid ?? null,
      currency: invoice.currency ?? "usd",
      description: invoice.description ?? line?.description ?? null,
      hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      invoice_pdf: invoice.invoice_pdf ?? null,
      period_start: line?.period?.start
        ? new Date(line.period.start * 1000).toISOString()
        : null,
      period_end: line?.period?.end
        ? new Date(line.period.end * 1000).toISOString()
        : null,
      paid_at:
        invoice.status === "paid" && invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
          : null,
      failure_message:
        typeof invoice.last_finalization_error?.message === "string"
          ? invoice.last_finalization_error.message
          : null,
      attempt_count: invoice.attempt_count ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_mode,stripe_invoice_id" }
  );

  if (error) throw new Error(`Invoice upsert failed: ${error.message}`);
}
