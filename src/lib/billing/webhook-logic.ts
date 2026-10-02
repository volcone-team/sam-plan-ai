/**
 * Webhook decision logic, extracted so it can be tested without Stripe or a
 * database.
 *
 * This is the most consequential code in billing: the webhook is the ONLY writer
 * of subscription state, so a mistake here means a customer pays and receives
 * nothing, or keeps access they have stopped paying for. It previously lived
 * inline in the route handler, tangled with network calls, and therefore had no
 * tests at all — which is how an API-version field change reached production and
 * stopped every payment from being applied.
 *
 * The route still performs the I/O. What to DO is decided here.
 */

/** Events the handler acts on. Anything else is recorded and ignored. */
export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
] as const;

export function isHandledEvent(type: string): boolean {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

/**
 * Map Stripe's status onto the 5-value `status` column from migration 001.
 *
 * Stripe has states that column cannot express, so the mapping is lossy on
 * purpose — `stripe_status` keeps the original verbatim. What matters is that
 * nothing maps to 'active' unless the customer really is active: an over-generous
 * default here would hand out free access.
 */
export function mapStripeStatus(stripeStatus: string): string {
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
      // incomplete, and anything Stripe adds in future. Deliberately NOT
      // 'active': an unknown state must not grant access.
      return "past_due";
  }
}

/** Shapes an invoice can arrive in, across pinned API versions. */
export interface InvoiceLike {
  parent?: {
    subscription_details?: { subscription?: string | { id: string } | null } | null;
  } | null;
  subscription?: string | { id: string } | null;
}

/**
 * Pull the subscription id out of an invoice.
 *
 * A webhook endpoint is PINNED to the API version it was created with, and that
 * pin is immutable — so an endpoint made years ago still delivers the old shape
 * regardless of which version the SDK targets. Both layouts must be read:
 *
 *   modern: invoice.parent.subscription_details.subscription
 *   legacy: invoice.subscription
 *
 * Reading only the modern path against a legacy payload silently yields
 * undefined, so every invoice looks like a one-off purchase and no subscription
 * is ever synced. That is the exact bug that let a payment succeed while the
 * customer's plan never changed.
 */
export function subscriptionIdFromInvoice(invoice: InvoiceLike): string | null {
  const modern = invoice.parent?.subscription_details?.subscription;
  if (modern) return typeof modern === "string" ? modern : modern.id;

  const legacy = invoice.subscription;
  if (legacy) return typeof legacy === "string" ? legacy : legacy.id;

  return null;
}

/** Billing period, which also moved between the subscription and its item. */
export interface PeriodSource {
  items?: { data?: { current_period_start?: number; current_period_end?: number }[] };
  current_period_start?: number;
  current_period_end?: number;
}

export function extractPeriod(sub: PeriodSource): { start: number | null; end: number | null } {
  const item = sub.items?.data?.[0];
  return {
    start: item?.current_period_start ?? sub.current_period_start ?? null,
    end: item?.current_period_end ?? sub.current_period_end ?? null,
  };
}

/**
 * Decide how `past_due_since` should change.
 *
 * It anchors the dunning grace window, so the rules are:
 *   - entering past_due: stamp it, but only if not already stamped, or each
 *     retry would push the deadline further out and grace would never expire;
 *   - recovering: CLEAR it, or a later failure would measure grace from the
 *     first-ever failure and lock the customer out immediately.
 */
export function nextPastDueSince(args: {
  stripeStatus: string;
  existing: string | null;
  now: string;
}): string | null {
  const isFailing = args.stripeStatus === "past_due" || args.stripeStatus === "unpaid";
  if (!isFailing) return null;
  return args.existing ?? args.now;
}

/**
 * Should a pending plan change be cleared?
 *
 * @deprecated Status alone CANNOT answer this — see shouldClearPendingChange.
 * Kept only so any older caller keeps compiling; it must not be used for new
 * decisions.
 */
export function shouldClearPending(stripeStatus: string): boolean {
  return stripeStatus === "active" || stripeStatus === "trialing";
}

export interface PendingChangeState {
  stripeStatus: string;
  /** Is a Stripe subscription schedule still attached? */
  hasSchedule: boolean;
  /** The plan the customer is scheduled to move to, if any. */
  pendingPlanId: string | null;
  /** The plan Stripe currently bills, resolved from the active price. */
  currentPlanId: string | null;
}

/**
 * Should a pending plan change be cleared?
 *
 * STATUS ALONE IS THE WRONG QUESTION, and getting this wrong erased the feature.
 * A scheduled downgrade leaves the subscription `active` for the whole remainder
 * of the paid period — that is the entire point of scheduling it. So treating
 * "active" as "the change has landed" cleared `pending_plan_id` on the very next
 * `customer.subscription.updated` event, seconds after the downgrade was booked.
 *
 * The visible symptom: the customer saw "Changing to Starter on <date>", pressed
 * refresh, and the message was gone — while Stripe still showed the lower amount
 * due next month. The downgrade was real; only our record of it had been wiped.
 *
 * The change has ACTUALLY been applied when Stripe bills the pending plan
 * (`currentPlanId === pendingPlanId`). Until then, an attached schedule means it
 * is still coming.
 */
export function shouldClearPendingChange(state: PendingChangeState): boolean {
  // Nothing recorded as pending — nothing to clear.
  if (!state.pendingPlanId) return false;

  // Not healthy: leave it alone. A past_due subscription may still have a
  // scheduled change, and dropping it here would lose the customer's intent.
  const healthy = state.stripeStatus === "active" || state.stripeStatus === "trialing";
  if (!healthy) return false;

  // Applied: Stripe is now billing the plan that was pending.
  if (state.currentPlanId && state.currentPlanId === state.pendingPlanId) return true;

  // Still scheduled — the whole period before it takes effect lands here.
  if (state.hasSchedule) return false;

  /**
   * Healthy, pending a DIFFERENT plan, and no schedule attached.
   *
   * The schedule was released or removed without the change being applied —
   * an upgrade supersedes a pending downgrade and releases the schedule
   * (see change-plan), so this is the normal "customer changed their mind"
   * path. The pending target is genuinely stale now.
   */
  return true;
}

/**
 * Should a comp be cleared because a real subscription now exists?
 *
 * Without this a paying customer keeps showing as complimentary access, so
 * "who is not paying" — the whole point of the comped flag — becomes wrong.
 */
export function shouldClearComp(stripeStatus: string): boolean {
  return stripeStatus === "active" || stripeStatus === "trialing";
}

/** Outcomes of the idempotency gate. */
export type ClaimOutcome = "process" | "duplicate" | "storage_error";

/**
 * Interpret the result of claiming an event id.
 *
 * Stripe retries on any non-2xx AND can deliver the same event more than once
 * even after a 200, so claiming is what stops a retried `invoice.paid` from
 * double-extending a billing period.
 *
 * 23505 is Postgres unique_violation — someone else already claimed it. Any other
 * error means the claim itself failed, so the event was never handled and Stripe
 * SHOULD retry.
 */
export function interpretClaim(errorCode: string | null | undefined): ClaimOutcome {
  if (!errorCode) return "process";
  if (errorCode === "23505") return "duplicate";
  return "storage_error";
}

/**
 * HTTP status to answer a webhook with.
 *
 * The distinction matters more than it looks:
 *   - bad signature -> 400, never retry. The payload is untrusted.
 *   - claim failed   -> 500, DO retry. Nothing was processed.
 *   - handler threw  -> 200, do NOT retry. Retrying cannot fix a logic bug, and
 *     an endlessly retried event buries genuine ones; it is recorded as failed
 *     for an operator instead.
 */
export function webhookResponseStatus(
  outcome: "invalid_signature" | "no_signature" | "claim_failed" | "handler_failed" | "ok" | "duplicate" | "ignored"
): number {
  switch (outcome) {
    case "invalid_signature":
    case "no_signature":
      return 400;
    case "claim_failed":
      return 500;
    default:
      return 200;
  }
}

/**
 * Is this subscription ending rather than renewing?
 *
 * Stripe expresses "will not renew" in TWO ways, and reading only one of them
 * misreports a cancelled subscription as active:
 *
 *   cancel_at_period_end: true  — the flag set by subscriptions.update()
 *   cancel_at: <timestamp>      — a dated stop, which is what the BILLING PORTAL
 *                                 sets when a customer cancels themselves
 *
 * Because only the flag was checked, a customer who cancelled through the portal
 * still saw "Renews <date>", and so did the admin table — the single most
 * misleading thing billing UI can say.
 */
export function isEnding(sub: {
  cancel_at_period_end?: boolean | null;
  cancel_at?: number | null;
  status?: string | null;
}): boolean {
  if (sub.cancel_at_period_end === true) return true;
  if (typeof sub.cancel_at === "number" && sub.cancel_at > 0) return true;
  return false;
}

/**
 * When access actually ends, as a unix timestamp.
 *
 * Prefers an explicit `cancel_at` over the period end: a customer can schedule a
 * stop at a date that is not the current period boundary, and showing the period
 * end would then be wrong.
 */
export function accessEndsAt(sub: {
  cancel_at?: number | null;
  current_period_end?: number | null;
}): number | null {
  if (typeof sub.cancel_at === "number" && sub.cancel_at > 0) return sub.cancel_at;
  if (typeof sub.current_period_end === "number" && sub.current_period_end > 0) {
    return sub.current_period_end;
  }
  return null;
}
