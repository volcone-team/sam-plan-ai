import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  getStripe,
  webhookSecret,
  STRIPE_MODE_TAG,
} from "@/lib/billing/stripe-client";
import {
  isHandledEvent,
  mapStripeStatus,
  subscriptionIdFromInvoice,
  extractPeriod,
  nextPastDueSince,
  shouldClearPendingChange,
  shouldClearComp,
  interpretClaim,
  isEnding,
} from "@/lib/billing/webhook-logic";

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



function adminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: Request) {
  const db = adminClient();

  // Single webhook secret; the key in the environment is the only universe.
  const mode = STRIPE_MODE_TAG;

  const secret = webhookSecret();
  if (!secret) {
    console.error("[stripe/webhook] No signing secret configured (STRIPE_WEBHOOK_SECRET)");
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
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
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

  const claim = interpretClaim(claimError?.code);

  if (claim === "duplicate") {
    console.log("[stripe/webhook] Duplicate event ignored:", event.id, event.type);
    return NextResponse.json({ received: true, duplicate: true });
  }
  if (claim === "storage_error") {
    console.error("[stripe/webhook] Could not record event:", claimError?.message);
    // A genuine DB fault: let Stripe retry, since the event was never handled.
    return NextResponse.json({ error: "record_failed" }, { status: 500 });
  }

  if (!isHandledEvent(event.type)) {
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
  mode: string,
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
      // subscriptionIdFromInvoice reads both the modern and legacy payload
      // shapes — see webhook-logic.ts — and is unit-tested.
      const subId = subscriptionIdFromInvoice(
        invoice as unknown as Parameters<typeof subscriptionIdFromInvoice>[0]
      );
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
  mode: string,
  subscriptionId: string
): Promise<void> {
  const stripe = getStripe();
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

  // Period location moved between API versions (subscription item vs the
  // subscription); extractPeriod reads both and is unit-tested.
  const { start: periodStart, end: periodEnd } = extractPeriod(
    sub as unknown as Parameters<typeof extractPeriod>[0]
  );

  const patch: Record<string, unknown> = {
    stripe_mode: mode,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    stripe_status: sub.status,
    status: mapStripeStatus(sub.status),
    billing_cycle: interval === "year" ? "annual" : "monthly",
    // isEnding covers BOTH cancel_at_period_end and a dated cancel_at — the
    // billing portal uses the latter, so reading only the flag reported a
    // cancelled subscription as renewing.
    cancel_at_period_end: isEnding(sub),
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    is_trial_active: sub.status === "trialing",
    // Null when ending: a subscription that stops is not renewing, and a date
    // here is displayed as "Renews".
    renewal_date: isEnding(sub) || !periodEnd
      ? null
      : new Date(periodEnd * 1000).toISOString(),
    cancelled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  if (planId) patch.plan_id = planId;

  // past_due_since anchors the dunning grace window. nextPastDueSince keeps the
  // ORIGINAL timestamp across retries (re-stamping would push the deadline out
  // forever) and clears it on recovery (otherwise a later failure would measure
  // grace from the first-ever one and deny access instantly). Unit-tested.
  const { data: existing } = await db
    .from("subscriptions")
    .select("past_due_since")
    .eq("company_id", companyId)
    .maybeSingle();

  patch.past_due_since = nextPastDueSince({
    stripeStatus: sub.status,
    existing: (existing?.past_due_since as string) ?? null,
    now: new Date().toISOString(),
  });

  /**
   * Clear a pending downgrade only once it has ACTUALLY been applied.
   *
   * A scheduled downgrade keeps the subscription `active` for the remainder of
   * the paid period, so keying this on status alone wiped the customer's
   * "Changing to X on <date>" notice on the next event — seconds after they
   * booked it. The schedule and the currently-billed plan are what distinguish
   * "still coming" from "landed".
   */
  const { data: pendingRow } = await db
    .from("subscriptions")
    .select("pending_plan_id")
    .eq("company_id", companyId)
    .maybeSingle();

  if (
    shouldClearPendingChange({
      stripeStatus: sub.status,
      hasSchedule: !!sub.schedule,
      pendingPlanId: (pendingRow?.pending_plan_id as string) ?? null,
      currentPlanId: planId,
    })
  ) {
    patch.pending_plan_id = null;
    patch.pending_billing_cycle = null;
  }

  // A real paid subscription supersedes any comp, or a paying customer keeps
  // showing as complimentary access and "who is not paying" becomes wrong.
  if (shouldClearComp(sub.status)) {
    patch.is_comped = false;
    patch.comped_until = null;
    patch.comped_reason = null;
  }

  const { error } = await db.from("subscriptions").update(patch).eq("company_id", companyId);
  if (error) throw new Error(`Subscription update failed: ${error.message}`);
}

async function resolveCompanyId(
  db: SupabaseClient,
  mode: string,
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
  mode: string,
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
  mode: string,
  invoice: Stripe.Invoice
): Promise<void> {
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;

  const subId = subscriptionIdFromInvoice(
    invoice as unknown as Parameters<typeof subscriptionIdFromInvoice>[0]
  );

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

  /**
   * An invoice we cannot attribute to a company is not ours to record.
   *
   * This table is the app's view of its own customers' payments, and every
   * reader treats it that way: "Collected to date" sums it, and the admin
   * payment history lists it. A row with a null company_id is therefore counted
   * as platform revenue while belonging to nobody — which is how invoices from
   * unrelated Stripe customers ended up inflating both.
   *
   * Returning quietly rather than throwing: the event was handled correctly,
   * there is simply nothing here to store, and a throw would make Stripe retry
   * an event that can never succeed.
   */
  if (!companyId) {
    console.log(
      "[stripe/webhook] Ignoring invoice", invoice.id,
      "— customer", customerId ?? "unknown", "maps to no company here"
    );
    return;
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

