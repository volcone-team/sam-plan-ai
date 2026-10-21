import type { SupabaseClient } from "@supabase/supabase-js";
import { ghlIsOn, loadGhlConfig, type GhlConfig } from "@/lib/ghl/config";
import { resolveGhlOwnerContact } from "@/lib/ghl/contact";
import { enqueueGhlEvent } from "@/lib/ghl/outbox";
import { TAG_CANCELLATION } from "@/lib/ghl/tags";
import type { SubscriptionStatus } from "@/lib/billing/entitlement";

/**
 * The cancellation producer: "this subscription is ending — or has stopped
 * ending — tell GoHighLevel."
 *
 * THE SIBLING OF `producers/subscription.ts`, deliberately shaped the same
 * way: same never-throws contract, same config-first ordering by cost, same
 * discriminated result, same enqueue-only reach. Read that module first; the
 * reasoning it spells out (why this is not ten lines inline in the webhook,
 * why every await is guarded, why the payment path must not pay for a
 * marketing tag) applies here verbatim and is not repeated.
 *
 * WHAT IS DIFFERENT IS THE TAG ITSELF, AND IT IS WORTH BEING PRECISE ABOUT.
 *
 * THERE IS ONE CANCELLATION TAG, NOT TWO. The original brief distinguished
 * "cancellation requested" from "access actually expired"; the client's final
 * tag list has only `sam plan ai app - cancellation`. So this producer fires
 * on the REQUEST — while the customer still has paid access until period end,
 * which is precisely when a save-the-customer workflow is worth running.
 * Expiry is already covered elsewhere: `producers/subscription.ts` flips the
 * buyer tag `active` -> `inactive` when Stripe reports cancelled or unpaid.
 * Nothing here duplicates that.
 *
 * THE TAG IS MODELLED AS A STATE, NOT AN EVENT, exactly as the buyer tags are.
 * Given "is this subscription ending?" we produce either an add or a remove,
 * and we send the appropriate one EVERY time the state is written. The
 * alternative — detect the transition by reading the previous row and only act
 * when it changed — was rejected for two reasons:
 *
 *   - it needs the prior value, which means an extra read on the payment path
 *     and a race with every concurrent writer of `subscriptions` (the webhook,
 *     the cancel route, the reactivate route and reconcile all write it), so
 *     two near-simultaneous writes can both see "unchanged" and neither acts;
 *   - it buys nothing. GHL's add-tag and remove-tag calls are both idempotent,
 *     and a remove is a no-op for a tag the contact does not hold. Sending the
 *     current state unconditionally cannot drift, needs no history, and
 *     self-heals a contact whose earlier event was lost.
 *
 * THE TAG MUST COME OFF AGAIN, which is the whole reason the remove half
 * exists. This app's retention flow genuinely saves people — discount offers,
 * a pause, and `/api/billing/reactivate` exists for no other purpose than
 * undoing a pending cancellation. A customer who stays must not sit in a churn
 * or win-back sequence.
 */

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

/** Add the tag, take it off, or leave the contact exactly as it is. */
export type CancellationAction = "add" | "remove" | "none";

/** Why that action. Stable strings: logged, surfaced, and pinned in tests. */
export type CancellationReason =
  /** `isEnding` — cancel_at_period_end, or a dated cancel_at from the portal. */
  | "ending"
  /** Not ending AND currently live. The reversal, and the repurchase. */
  | "renewing"
  /** The cancellation already completed. The tag is true; it stays. */
  | "expired"
  /** Nothing about this row says anything about cancellation either way. */
  | "no_signal";

export interface CancellationDecision {
  action: CancellationAction;
  reason: CancellationReason;
  /** The normalised status the decision was made on. Debug context. */
  status: string;
}

/**
 * Statuses that mean "there is a live subscription here that intends to renew".
 *
 * `past_due` is in the list on purpose and for the same reason
 * `buyerPresenceForStatus` calls it `active`: Stripe is still retrying the
 * card, `evaluateAccess` still grants access inside the dunning window, and
 * they have not cancelled anything. A failed payment is not a churn signal.
 *
 * `trialing` is in the list because a trial can be cancelled and un-cancelled
 * like anything else, and a trialling customer who reversed their cancellation
 * must come out of the churn workflow too.
 */
const RENEWING_STATUSES = new Set(["active", "past_due", "trialing", "trial"]);

/**
 * Statuses that mean the cancellation has already run its course.
 *
 * Both spellings of cancelled, because the type says `canceled` (Stripe's) and
 * `mapStripeStatus` writes `cancelled` (migration 001's CHECK). `buyer-state.ts`
 * documents that trap at length; getting it wrong here would silently REMOVE a
 * genuinely cancelled customer's tag.
 */
const EXPIRED_STATUSES = new Set([
  "canceled",
  "cancelled",
  "unpaid",
  "incomplete_expired",
]);

export interface CancellationDecisionInput {
  /**
   * Is the subscription ending rather than renewing?
   *
   * The caller computes this — in the webhook it is the `isEnding(sub)` value
   * already in hand, which covers BOTH `cancel_at_period_end` and a dated
   * `cancel_at` (the Stripe billing portal sets the latter). Taking it as an
   * input rather than re-deriving it keeps one answer to that question.
   */
  isEnding: boolean;
  /** `subscriptions.status` after the write. Either spelling of cancelled. */
  status: SubscriptionStatus | string | null | undefined;
}

/**
 * Add or remove, from the subscription's current state alone.
 *
 * THE FOUR CASES, AND THE TWO THAT NEEDED AN ARGUMENT:
 *
 * `ending` -> ADD. A cancellation has been requested. Checked FIRST, so it
 *   wins over any status: a subscription that is `active` and ending is the
 *   normal pending-cancellation shape, and that is exactly the contact the
 *   client wants in a save sequence.
 *
 * `renewing` -> REMOVE. Not ending, and live. This single case covers both
 *   reversals, which is the pay-off of the state model:
 *     - the retention save (`/api/billing/reactivate` clears the flag, status
 *       stays `active`), and
 *     - THE REPURCHASE. A customer who cancelled, lapsed, and later bought
 *       again arrives here as a fresh `active`, not-ending subscription and the
 *       tag comes off with NO special case. It falls out of the design rather
 *       than being handled by it — which is the argument for the design. And it
 *       matters: leaving the tag on would keep a paying customer inside a
 *       win-back sequence aimed at people who left.
 *
 * `expired` -> NONE, and this is the deliberate one. A subscription that has
 *   actually reached `cancelled` / `unpaid` belongs to somebody who DID cancel,
 *   so the tag is true and removing it would be a lie. It is also not needed as
 *   a churn signal: the buyer tag already carries active-vs-inactive, so GHL
 *   can tell "cancelled and gone" from "cancelled but still paid up" without a
 *   second tag. Note that in practice Stripe usually leaves `cancel_at` set on
 *   a cancelled subscription, so most of these never get past the `ending`
 *   branch at all; this case is here for the ones that do.
 *
 * `no_signal` -> NONE. `paused`, `incomplete`, a blank status, or a status
 *   Stripe has invented since. Not ending, not live, not finished. We know
 *   nothing about their cancellation intent, and neither adding nor stripping
 *   a tag on no information is defensible. Matches `mapStripeStatus` and
 *   `buyerPresenceForStatus`, both of which refuse to guess at an unknown
 *   status rather than defaulting it somewhere plausible.
 *
 *   A Stripe `paused` collection landing here is the case worth naming: it is
 *   not a cancellation and it does not reverse one, so the tag is left exactly
 *   as it was. (The app's own admin pause, `subscriptions.is_paused` from 027,
 *   is never written by Stripe and never reaches a `status` at all.)
 *
 * PURE. No database, no network — the whole decision is testable without a
 * Supabase in sight, which is the point of it being a function.
 */
export function decideCancellationTags(
  input: CancellationDecisionInput
): CancellationDecision {
  const status = typeof input.status === "string" ? input.status.trim().toLowerCase() : "";

  // FIRST, so a pending cancellation on an otherwise healthy subscription is
  // reported as ending rather than as renewing.
  if (input.isEnding) return { action: "add", reason: "ending", status };

  if (RENEWING_STATUSES.has(status)) {
    return { action: "remove", reason: "renewing", status };
  }
  if (EXPIRED_STATUSES.has(status)) {
    return { action: "none", reason: "expired", status };
  }
  return { action: "none", reason: "no_signal", status };
}

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

export type CancellationProducerResult =
  /** A row was written, or one already existed for this source event. */
  | {
      ok: true;
      outcome: "enqueued" | "duplicate";
      action: "add" | "remove";
      reason: CancellationReason;
    }
  /** Nothing to do, and nothing wrong. */
  | { ok: true; outcome: "skipped"; reason: CancellationSkipReason; detail?: string }
  /** Something went wrong that a human may want to know about. */
  | { ok: false; outcome: "failed"; reason: CancellationFailReason; message: string };

export type CancellationSkipReason =
  /** `ghlIsOn` is false. The common case today, and the cheapest path. */
  | "integration_off"
  /** The state says neither add nor remove. See `CancellationReason`. */
  | "no_signal"
  /** No owner profile, or the owner has no email. A data gap. */
  | "no_owner_contact"
  /** The outbox declined (no email, nothing to do). Already logged there. */
  | "outbox_skipped";

export type CancellationFailReason =
  /** The insert failed, or something threw. */
  "enqueue_failed";

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

/** Where the call came from. Debug context in the payload; never a decision. */
export type CancellationSource =
  | "stripe_webhook"
  | "billing_cancel"
  | "billing_reactivate";

export interface CancellationProducerInput extends CancellationDecisionInput {
  /** The company whose OWNER becomes the GHL contact. */
  companyId: string;
  /**
   * The Stripe event id that caused this, when there is one. Drives the
   * dedupe key; absent means "enqueue unconditionally". See
   * `cancellationDedupeKey` for why both modes are correct.
   */
  stripeEventId?: string | null;
  /** e.g. "customer.subscription.updated". Debug context only. */
  stripeEventType?: string | null;
  /** Which call site. Written to the payload so the admin screen can say. */
  source?: CancellationSource;
  /** An already-loaded config, so `app_settings` is not read twice. */
  config?: GhlConfig;
}

/**
 * The dedupe key shape: `stripe:{eventId}:cancellation`.
 *
 * `:cancellation` IS LOAD-BEARING, AND NO LONGER HYPOTHETICALLY SO. 044's
 * unique index is on `(sub_account, dedupe_key)` with NO event_type in it, and
 * as of this task the buyer-state producer and this one fire from the SAME
 * Stripe event, at the end of the same `syncSubscription`. With a bare event
 * id both would compute the same key, the second insert would hit 23505, and
 * the outbox would report it as a `duplicate` — a success. The cancellation
 * tag would simply never be written, silently, forever, with no error anywhere
 * to find. The intent suffix is the only thing preventing that, which is why
 * `cancellation.test.ts` asserts the two keys differ for one event id.
 *
 * Same shape and same reasoning as `buyerStateDedupeKey`; see that function
 * for why Stripe's event id is the identifier with the right lifetime and why
 * the company id is not in the key.
 */
export function cancellationDedupeKey(stripeEventId: string): string {
  return `stripe:${stripeEventId}:cancellation`;
}

/* ------------------------------------------------------------------ *
 * Producer
 * ------------------------------------------------------------------ */

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Enqueue the cancellation tag implied by a subscription's current state.
 *
 * `db` must be a service-role client: `ghl_events` has RLS on with no
 * policies, and `profiles` / `companies` are not readable without it.
 *
 * ORDER OF OPERATIONS IS AN ORDER OF COST, matching the buyer-state producer.
 * Config first and free, so the normal case today — the integration switched
 * off — does ZERO queries. Then the decision, which is pure and is the most
 * likely early exit. Only then the owner, which is two selects. There are no
 * plan names to read here: the tag is a fixed string, so this producer is
 * strictly cheaper than its sibling.
 */
export async function enqueueCancellationEvent(
  db: SupabaseClient,
  input: CancellationProducerInput
): Promise<CancellationProducerResult> {
  try {
    const config = input.config ?? (await loadGhlConfig(db));

    // OFF IS THE CHEAPEST PATH AND THE CURRENT ONE. No queries, no row, no log.
    if (!ghlIsOn(config)) {
      return { ok: true, outcome: "skipped", reason: "integration_off" };
    }

    const decision = decideCancellationTags(input);

    if (decision.action === "none") {
      /*
       * Expected and frequent — every renewal event on a healthy subscription
       * whose status we deliberately do not read as a signal. Not worth a log
       * line on the payment path; the reason comes back for the caller.
       */
      return {
        ok: true,
        outcome: "skipped",
        reason: "no_signal",
        detail: decision.reason,
      };
    }

    // Never throws; reports a data gap as a reason, and has already logged it
    // in its own voice.
    const owner = await resolveGhlOwnerContact(db, input.companyId);
    if (!owner.ok) {
      /*
       * SKIP, NOT FAIL. "This company has no owner profile" is a data gap the
       * webhook cannot fix, and re-logging it at error level on the payment
       * path would train people to ignore that path's logs. Same call as the
       * buyer-state producer makes.
       */
      return {
        ok: true,
        outcome: "skipped",
        reason: "no_owner_contact",
        detail: owner.reason,
      };
    }

    const enqueued = await enqueueGhlEvent(db, {
      eventType: "cancellation",
      companyId: input.companyId,
      userId: owner.contact.userId,
      contactEmail: owner.contact.email,
      /*
       * ONE SIDE OR THE OTHER, NEVER BOTH. The add and the remove are the same
       * tag, so a row carrying both would ask the drain to add and remove it
       * in one delivery and the outcome would depend on GHL's call ordering.
       */
      tagsAdd: decision.action === "add" ? [TAG_CANCELLATION] : [],
      tagsRemove: decision.action === "remove" ? [TAG_CANCELLATION] : [],
      /*
       * DEBUGGING CONTEXT ONLY, AND NO SECRETS. Enough to answer "why does
       * this contact have (or not have) the cancellation tag" from the admin
       * screen weeks later: what we decided, on what state, from which call
       * site. NOT the raw Stripe object — it carries customer, card and
       * metadata detail that has no business in a table an admin screen
       * renders — and nothing resembling a key or a token.
       *
       * firstName / lastName / companyName are read by `deliverGhlRow` and
       * passed to the contact upsert, which is how a contact created by this
       * event gets a name rather than just an address.
       */
      payload: {
        action: decision.action,
        reason: decision.reason,
        isEnding: input.isEnding,
        status: decision.status,
        source: input.source ?? null,
        stripeEventType: input.stripeEventType ?? null,
        firstName: owner.contact.firstName,
        lastName: owner.contact.lastName,
        companyName: owner.contact.companyName,
      },
      /*
       * A key only when a Stripe event is behind the call. The two user-driven
       * routes pass none deliberately — see the note on `cancellationDedupeKey`
       * and the comment at each call site.
       */
      dedupeKey: input.stripeEventId
        ? cancellationDedupeKey(input.stripeEventId)
        : null,
      // Passed through so the outbox does not re-read `app_settings`.
      config,
    });

    if (enqueued.outcome === "enqueued") {
      return {
        ok: true,
        outcome: "enqueued",
        action: decision.action,
        reason: decision.reason,
      };
    }
    if (enqueued.outcome === "duplicate") {
      // The expected outcome of a redelivered Stripe event. Not a problem.
      return {
        ok: true,
        outcome: "duplicate",
        action: decision.action,
        reason: decision.reason,
      };
    }
    if (enqueued.outcome === "skipped") {
      return {
        ok: true,
        outcome: "skipped",
        reason: "outbox_skipped",
        detail: enqueued.reason,
      };
    }

    return {
      ok: false,
      outcome: "failed",
      reason: "enqueue_failed",
      message: enqueued.message,
    };
  } catch (err: unknown) {
    // THE CATCH THAT MAKES THE DOC COMMENT TRUE. Two of the three callers
    // handle money; none of them may fail for a marketing tag.
    const message = errMessage(err);
    console.error("[ghl/cancellation] producer threw:", message);
    return { ok: false, outcome: "failed", reason: "enqueue_failed", message };
  }
}
