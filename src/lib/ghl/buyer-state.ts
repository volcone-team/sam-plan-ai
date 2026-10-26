import type { SubscriptionStatus } from "@/lib/billing/entitlement";
import {
  buyerTagTransition,
  TAG_REGISTERED_NOT_PAID,
  type BuyerState,
  type BuyerTagError,
  type TagCycle,
} from "@/lib/ghl/tags";

/**
 * "Is this subscription's owner an ACTIVE buyer, an INACTIVE buyer, or not a
 * buyer at all?"
 *
 * PURE. No database, no network, no Stripe. The caller reads the subscription
 * row and the plan names and passes them in; this module only decides, and
 * `tags.ts` only spells. That split exists because the decision below is the
 * part that is easy to get wrong and impossible to notice: a contact tagged
 * `inactive` when they are merely mid-dunning receives a win-back sequence
 * while their card is still being retried, and nothing in our logs says so.
 *
 * WHY THERE ARE THREE ANSWERS AND NOT TWO. `tags.ts` knows two buyer states,
 * active and inactive, because those are the only two the client's tags
 * express. But a great many subscription rows deserve NEITHER tag — a trial, a
 * half-finished checkout, a company with no subscription at all — and
 * inventing one for them is worse than silence. So `none` is a first-class
 * outcome here, distinct from a refusal (`ok: false`), which means "we wanted
 * a tag and could not build one".
 */

/* ------------------------------------------------------------------ *
 * Status -> presence
 * ------------------------------------------------------------------ */

/** Either buyer tag, or neither. */
export type BuyerPresence = BuyerState | "none";

/** Why no buyer tag applies. Stable strings: logged and asserted in tests. */
export type BuyerPresenceNoneReason =
  /** No subscription row, or a null/blank status. Never bought anything. */
  | "no_subscription"
  /** On trial. A trial is not a purchase — see the note below. */
  | "trialing"
  /** A checkout that was started and never completed. */
  | "incomplete"
  /** A status string this module has never heard of. Fails to `none`. */
  | "unknown_status";

export type BuyerPresenceResult =
  | { presence: BuyerState; status: string }
  | { presence: "none"; reason: BuyerPresenceNoneReason; status: string };

/**
 * THE DATABASE SPELLS "cancelled" AND THE TYPE SPELLS "canceled".
 *
 * `SubscriptionStatus` (entitlement.ts) lists the American `canceled`, because
 * it is Stripe's spelling. But `mapStripeStatus` in webhook-logic.ts writes
 * the British `cancelled` into `subscriptions.status`, and migration 001's
 * CHECK is what forces that. So the value this function actually receives
 * from a database row does not match the type that describes it.
 *
 * Accepting both is not tidiness, it is the difference between a cancelled
 * customer being tagged `inactive` and being tagged nothing at all — and
 * because the fallback is `none`, the failure would be SILENT. Hence a string
 * input, both spellings, and a test that pins them.
 */
const CANCELLED_SPELLINGS = new Set(["canceled", "cancelled"]);

/**
 * Map a subscription status onto a buyer presence.
 *
 * THE DEBATABLE THREE, reasoned out, because these are the decisions in this
 * task that a future reader will want to argue with:
 *
 * `trialing` / `trial` -> NONE, not active.
 *   The tag is called "buyer". A trialling customer has not bought anything:
 *   no money has moved, and the majority of them never will. Tagging them
 *   `buyer - active - pro monthly` would put them in the same workflow as a
 *   paying customer, so they would receive onboarding and retention email
 *   written for people who have paid, and — worse — the plan in the tag would
 *   be the plan `resolve_trial_plan()` happened to grant, which is an
 *   implementation detail of the trial, not a thing they chose.
 *
 *   THE ARGUMENT THE OTHER WAY, which is real: a trial is the single most
 *   valuable moment to be running an automation, and "active" is the state
 *   that unlocks the client's sequences. Tagging trials active would get them
 *   nurtured for free.
 *
 *   `none` wins because the tag's MEANING is load-bearing and shared with the
 *   client's marketing team. If "buyer - active" stops meaning "is paying us",
 *   every workflow and every report built on it is quietly wrong, and nobody
 *   who did not read this comment will know. Trials deserve their own tag, and
 *   when the client asks for one it belongs in `tags.ts` as a new constant.
 *
 *   THE CONSEQUENCE, stated plainly so it is not a surprise: a trialling
 *   customer carries NO buyer tag, so any workflow keyed on buyer tags cannot
 *   see them until they convert. On conversion the webhook writes `active` and
 *   the tag appears. There is no "trial started" signal in GHL today.
 *
 * `past_due` -> ACTIVE.
 *   They still have the product: `evaluateAccess` keeps a past_due company
 *   inside the dunning grace window, and Stripe is still retrying the card. A
 *   failed payment is a payment-method problem, and most of them resolve
 *   within days.
 *
 *   What the client's workflows would want decides it. Flipping to `inactive`
 *   would fire win-back and lapsed-customer messaging at somebody whose card
 *   merely expired, while they are still logging in and still a customer — and
 *   then flip them back to `active` on recovery, which is tag THRASH: two
 *   transitions, two workflow entries, for a customer who never left. Dunning
 *   is noisy by nature (Stripe retries several times), so the quiet state is
 *   the correct one.
 *
 *   The honest cost: a customer who is going to churn spends their whole
 *   dunning window tagged `active`. That is acceptable because the end of
 *   dunning is `unpaid` or `canceled`, both of which land on `inactive` below,
 *   so nobody is stranded in the wrong tag — they are simply moved late.
 *
 * `paused` -> INACTIVE.
 *   Two different pauses exist and it is worth separating them. The app's own
 *   `subscriptions.is_paused` (migration 027) is an ADMIN suspension and is
 *   never written by Stripe; it does not reach this function, because this
 *   function only sees `status`. A `status` of `paused` means Stripe's own
 *   paused collection: no money is moving, and `evaluateAccess` locks the
 *   account out (the pause outranks everything but the global billing switch).
 *
 *   So `inactive` is the honest reading — they are a buyer, and they are not
 *   currently active. Note what this is NOT: `inactive` is not the cancellation
 *   tag, which is its own fixed tag with its own workflow, so a pause does not
 *   look like a churn to GHL. And it is fully reversible: resuming writes
 *   `active` again through the same path.
 *
 * The rest are not arguable:
 *   `active`             -> active.
 *   `unpaid`             -> inactive. Dunning is over and Stripe gave up.
 *   `canceled`           -> inactive.
 *   `incomplete_expired` -> inactive. A checkout that expired unpaid.
 *   `incomplete`         -> none. A checkout that never completed. They were
 *                           never a buyer, so there is no state to record and
 *                           nothing to clear.
 *   null / blank         -> none. No subscription.
 *   anything else        -> none. Stripe adds statuses; an unknown one must
 *                           not be guessed into a workflow. Matches
 *                           `mapStripeStatus`, which refuses to default to
 *                           'active' for the same reason.
 */
export function buyerPresenceForStatus(
  raw: SubscriptionStatus | string | null | undefined
): BuyerPresenceResult {
  const status = typeof raw === "string" ? raw.trim().toLowerCase() : "";

  if (status === "") return { presence: "none", reason: "no_subscription", status };

  if (status === "active") return { presence: "active", status };
  // Still inside the grace window, still a customer. See the note above.
  if (status === "past_due") return { presence: "active", status };

  if (status === "unpaid") return { presence: "inactive", status };
  if (CANCELLED_SPELLINGS.has(status)) return { presence: "inactive", status };
  if (status === "incomplete_expired") return { presence: "inactive", status };
  if (status === "paused") return { presence: "inactive", status };

  if (status === "trialing" || status === "trial") {
    return { presence: "none", reason: "trialing", status };
  }
  if (status === "incomplete") {
    return { presence: "none", reason: "incomplete", status };
  }

  return { presence: "none", reason: "unknown_status", status };
}

/* ------------------------------------------------------------------ *
 * Status + plan + cycle -> tags
 * ------------------------------------------------------------------ */

export interface BuyerStateTagsInput {
  /** `subscriptions.status`. Either spelling of cancelled is accepted. */
  status: SubscriptionStatus | string | null | undefined;
  /** Raw `subscription_plans.name`. Normalised by `tags.ts`, not here. */
  planName: unknown;
  /** `subscriptions.billing_cycle` — "annual" or "monthly". */
  cycle: unknown;
  /**
   * `subscription_plans.name` for **every** plan, RETIRED ONES INCLUDED.
   *
   * THE CALLER MUST NOT FILTER ON `is_active`. "Retire Plan" stops new sales
   * only — existing subscribers keep their price, their limits and therefore
   * their TAGS. A retired plan's four buyer tags are still sitting on real
   * contacts, so they are still live and still have to be cleared when one of
   * those subscribers moves. Passing only the active plans leaves
   * "buyer - active - legacy monthly" on the contact forever, alongside the
   * new tag, and the contact is then in two workflows at once.
   *
   * `buyerTagTransition` documents the same requirement from the other side.
   */
  knownPlanNames: Iterable<unknown>;
}

export type BuyerStateTagsResult =
  | {
      ok: true;
      outcome: "tags";
      /** The one buyer tag the contact should hold. */
      add: string;
      /** Every other buyer tag we can name. Never contains `add`. */
      remove: string[];
      state: BuyerState;
      plan: string;
      cycle: TagCycle;
      status: string;
    }
  /** No buyer tag applies, and nothing is wrong. Not a refusal. */
  | { ok: true; outcome: "none"; reason: BuyerPresenceNoneReason; status: string }
  /** We wanted a tag and could not build one. The caller logs and does nothing. */
  | { ok: false; error: BuyerTagError; message: string; status: string };

/**
 * Decide the add/remove tag lists for a subscription's current state.
 *
 * The join between `buyerPresenceForStatus` (what state are they in) and
 * `buyerTagTransition` (what does that spell, and what must be cleared).
 *
 * THE PRESENCE CHECK COMES FIRST, and the ordering is the interesting part. A
 * `none` status short-circuits BEFORE the plan name is validated, so a
 * trialling customer on a plan whose name cannot be put in a tag reports
 * `none` rather than a plan-name refusal. That is the truthful answer — the
 * plan name was never going to be used — and it keeps the refusal path
 * meaning "something is misconfigured and an admin should fix it".
 *
 * NOTHING IS REMOVED ON `none`, which is a decision rather than an omission.
 * It would be tempting to clear every buyer tag when no state applies, but the
 * `none` statuses are `trialing` and `incomplete`: neither can follow a real
 * purchase in the normal lifecycle, so there is nothing to clear, and a
 * missing or garbled status must not strip a paying customer's tags. Genuine
 * exits (cancel, unpaid) land on `inactive`, which carries its own removals.
 */
export function decideBuyerStateTags(
  input: BuyerStateTagsInput
): BuyerStateTagsResult {
  const presence = buyerPresenceForStatus(input.status);

  if (presence.presence === "none") {
    return {
      ok: true,
      outcome: "none",
      reason: presence.reason,
      status: presence.status,
    };
  }

  const transition = buyerTagTransition({
    planName: input.planName,
    // "annual" -> "yearly" happens inside tags.ts, once, and only there.
    cycle: input.cycle,
    state: presence.presence,
    knownPlanNames: input.knownPlanNames,
  });

  if (!transition.ok) {
    return {
      ok: false,
      error: transition.error,
      message: transition.message,
      status: presence.status,
    };
  }

  return {
    ok: true,
    outcome: "tags",
    add: transition.add,
    remove: buyerStateRemovals(transition.state, transition.remove),
    state: transition.state,
    plan: transition.plan,
    cycle: transition.cycle,
    status: presence.status,
  };
}

/**
 * The buyer-tag removals plus any non-buyer tag that a state transition ends.
 *
 * ENTERING ACTIVE ENDS "registered - not paid": the owner is now paying, so
 * TAG_REGISTERED_NOT_PAID goes into the remove list. Entering INACTIVE does
 * not touch it: a lapsed buyer has paid before, and the tag was already
 * removed when they first became active.
 *
 * `past_due` maps to active (see buyerPresenceForStatus), so a customer in
 * dunning also has it removed. They have paid at least once.
 */
export function buyerStateRemovals(state: BuyerState, buyerRemovals: string[]): string[] {
  if (state !== "active") return buyerRemovals;
  return [...buyerRemovals, TAG_REGISTERED_NOT_PAID];
}
