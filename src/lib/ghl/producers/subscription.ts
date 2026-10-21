import type { SupabaseClient } from "@supabase/supabase-js";
import { ghlIsOn, loadGhlConfig, type GhlConfig } from "@/lib/ghl/config";
import { resolveGhlOwnerContact } from "@/lib/ghl/contact";
import { decideBuyerStateTags } from "@/lib/ghl/buyer-state";
import { enqueueGhlEvent } from "@/lib/ghl/outbox";
import type { SubscriptionStatus } from "@/lib/billing/entitlement";

/**
 * The buyer-state producer: "the subscription just changed, tell GoHighLevel."
 *
 * A MODULE RATHER THAN TEN LINES INLINE IN THE WEBHOOK, deliberately. The
 * route it is called from is the only writer of subscription state and the
 * thing that decides whether a customer has paid; every line added there is a
 * line that can cost a payment event. Out here the whole decision — resolve
 * the owner, read the plan names, map the status, build the tags, enqueue —
 * runs in a unit test with a fake Supabase and no Stripe event at all, which
 * is the only way the interesting cases (no owner, a plan name that cannot be
 * tagged, a redelivered event) get tested. The route keeps ONE guarded call.
 *
 * NEVER THROWS, AND THAT IS THE ENTIRE CONTRACT. Read `enqueueGhlEvent`'s
 * comment on the subject; this module sits between it and the webhook and is
 * held to the same standard, because `enqueueGhlEvent` not throwing is no help
 * if the lookups in front of it do. Every await below is either inside the one
 * `try` or is itself a never-throws function.
 *
 * ENQUEUE ONLY. Nothing here talks to GHL — `drain.ts` does that, later, on
 * its own schedule. So the cost of this call on the payment path is: one
 * `app_settings` read, two small selects, one insert, all local.
 */

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

/**
 * What happened. Verbose on purpose: this is what the caller logs, and the
 * difference between "nothing to do" and "we wanted to and could not" is the
 * only signal anybody gets that a customer is missing their tags.
 */
export type BuyerStateProducerResult =
  /** A row was written, or one already existed for this Stripe event. */
  | { ok: true; outcome: "enqueued" | "duplicate"; add?: string; removeCount?: number }
  /** Nothing to do, and nothing wrong. */
  | { ok: true; outcome: "skipped"; reason: BuyerStateSkipReason; detail?: string }
  /** Something went wrong that a human may want to know about. */
  | { ok: false; outcome: "failed"; reason: BuyerStateFailReason; message: string };

export type BuyerStateSkipReason =
  /** `ghlIsOn` is false. The common case today, and the cheapest path. */
  | "integration_off"
  /** The status implies no buyer tag — a trial, an abandoned checkout, none. */
  | "no_buyer_state"
  /** No owner profile, or the owner has no email. A data gap. */
  | "no_owner_contact"
  /** The outbox declined (no email, nothing to do). Already logged there. */
  | "outbox_skipped";

export type BuyerStateFailReason =
  /** `buyerTagTransition` refused — almost always an untaggable plan name. */
  | "tag_refused"
  /** The plan lookup failed, so we cannot name the tags to clear. */
  | "plans_unreadable"
  /** The insert failed, or something threw. */
  | "enqueue_failed";

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

export interface BuyerStateProducerInput {
  /** The company whose OWNER becomes the GHL contact. */
  companyId: string;
  /** `subscriptions.plan_id` after the sync, or null if it could not resolve. */
  planId: string | null;
  /** `subscriptions.status` after the sync. */
  status: SubscriptionStatus | string | null;
  /** `subscriptions.billing_cycle` — "annual" | "monthly". */
  billingCycle: string | null;
  /**
   * The Stripe event id that caused this. Drives the dedupe key.
   *
   * Optional because a future caller (a reconcile, an admin resync) has no
   * Stripe event; absent means NO dedupe key, i.e. "enqueue unconditionally",
   * which is the right default for a deliberate manual action.
   */
  stripeEventId?: string | null;
  /** e.g. "invoice.paid". Debug context only; never a decision input. */
  stripeEventType?: string | null;
  /** An already-loaded config, so `app_settings` is not read twice. */
  config?: GhlConfig;
}

/**
 * The dedupe key shape: `stripe:{eventId}:buyer_state`.
 *
 * STRIPE'S EVENT ID IS THE ONLY IDENTIFIER WITH THE RIGHT LIFETIME. Stripe
 * redelivers on any non-2xx and can repeat an event even after a 200; the
 * route's own idempotency is one insert into `stripe_webhook_events`, which
 * short-circuits a redelivery BEFORE this producer runs — but only while that
 * row exists and only if the first delivery got far enough to write it. The
 * dedupe key is the second line of defence, and it is the one that survives a
 * handler that failed halfway.
 *
 * `:buyer_state` IS NOT DECORATION. One Stripe event will eventually produce
 * more than one GHL event (a cancellation also writes a buyer state), and 044's
 * unique index is on `(sub_account, dedupe_key)` with no event_type in it. Two
 * intents sharing a bare event id would mean the second one silently losing to
 * the first as a "duplicate". The intent suffix keeps them separate.
 *
 * NO COMPANY ID IN THE KEY. One Stripe subscription event concerns exactly one
 * company, so adding it would only make the key longer; and a key that varied
 * by company could not protect against the one race that matters (the same
 * event delivered twice).
 */
export function buyerStateDedupeKey(stripeEventId: string): string {
  return `stripe:${stripeEventId}:buyer_state`;
}

/* ------------------------------------------------------------------ *
 * Producer
 * ------------------------------------------------------------------ */

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Enqueue the buyer-state tags implied by a subscription's current state.
 *
 * `db` must be a service-role client: `ghl_events` has RLS on with no
 * policies, and `profiles` / `subscription_plans` are not readable without it.
 *
 * ORDER OF OPERATIONS IS AN ORDER OF COST. The config check is first and free,
 * so the normal case today — the integration switched off — does no queries at
 * all. Then the plans (one select, needed for both the subscriber's plan name
 * and the removal list), then the status mapping (pure, and the most likely
 * early exit), then the owner (two selects). Resolving the owner before
 * knowing whether any tag applies would be two queries on the payment path
 * for every trial event in the system.
 */
export async function enqueueBuyerStateEvent(
  db: SupabaseClient,
  input: BuyerStateProducerInput
): Promise<BuyerStateProducerResult> {
  try {
    const config = input.config ?? (await loadGhlConfig(db));

    /*
     * OFF IS THE CHEAPEST PATH AND THE CURRENT ONE. `ghl_enabled` is false in
     * the live database and the credentials are unset, so this is where every
     * real webhook lands today. No queries, no row, no log line.
     */
    if (!ghlIsOn(config)) {
      return { ok: true, outcome: "skipped", reason: "integration_off" };
    }

    const plans = await readPlanNames(db, input.planId);
    if (!plans.ok) {
      /*
       * We cannot name the tags to REMOVE, which is the half that matters. A
       * row with only an add would leave the contact holding two buyer tags
       * and therefore in two workflows — worse than being late. So nothing is
       * enqueued and the failure is reported.
       */
      console.error(
        "[ghl/buyer-state] plan names unreadable for company",
        input.companyId,
        "-",
        plans.message
      );
      return {
        ok: false,
        outcome: "failed",
        reason: "plans_unreadable",
        message: plans.message,
      };
    }

    const decision = decideBuyerStateTags({
      status: input.status,
      planName: plans.planName,
      cycle: input.billingCycle,
      // ALL plans, retired included. See the note on `knownPlanNames`.
      knownPlanNames: plans.allNames,
    });

    if (decision.ok && decision.outcome === "none") {
      /*
       * A trial, an abandoned checkout, or no subscription. Expected and
       * frequent, so this is a log.debug-shaped event — not worth a warn, and
       * certainly not an error.
       */
      return {
        ok: true,
        outcome: "skipped",
        reason: "no_buyer_state",
        detail: decision.reason,
      };
    }

    if (!decision.ok) {
      /*
       * WORTH AN ERROR LINE. The only realistic cause is a plan whose name has
       * no letters or digits, which means a paying customer is getting no
       * buyer tag at all until an admin renames the plan. Nothing retries this
       * and nothing else reports it.
       */
      console.error(
        "[ghl/buyer-state] refusing to tag company",
        input.companyId,
        `- ${decision.error}:`,
        decision.message
      );
      return {
        ok: false,
        outcome: "failed",
        reason: "tag_refused",
        message: decision.message,
      };
    }

    // Never throws; reports a data gap as a reason.
    const owner = await resolveGhlOwnerContact(db, input.companyId);
    if (!owner.ok) {
      /*
       * WARN, NOT ERROR, except for a read failure. "This company has no owner
       * profile" is a data gap the webhook cannot fix and `contact.ts` has
       * already logged it in its own voice; repeating it at error level on the
       * payment path would train people to ignore the payment path's logs.
       */
      return {
        ok: true,
        outcome: "skipped",
        reason: "no_owner_contact",
        detail: owner.reason,
      };
    }

    const enqueued = await enqueueGhlEvent(db, {
      eventType: "buyer_state",
      companyId: input.companyId,
      userId: owner.contact.userId,
      contactEmail: owner.contact.email,
      tagsAdd: [decision.add],
      tagsRemove: decision.remove,
      /*
       * DEBUGGING CONTEXT ONLY, AND NO SECRETS. Plan, cycle, status and the
       * Stripe event type — enough to answer "why does this contact have this
       * tag" from the admin screen six weeks later. NOT the raw Stripe object
       * (it carries customer, card and metadata detail that has no business in
       * a table an admin screen renders), and nothing resembling a key or a
       * token. 044 says the same thing in a COMMENT on the column.
       *
       * firstName / lastName / companyName are read by `deliverGhlRow` and
       * passed to the contact upsert, which is how a contact created by this
       * event gets a name rather than just an address.
       */
      payload: {
        plan: decision.plan,
        cycle: decision.cycle,
        state: decision.state,
        status: decision.status,
        stripeEventType: input.stripeEventType ?? null,
        firstName: owner.contact.firstName,
        lastName: owner.contact.lastName,
        companyName: owner.contact.companyName,
      },
      dedupeKey: input.stripeEventId
        ? buyerStateDedupeKey(input.stripeEventId)
        : null,
      // Passed through so the outbox does not re-read `app_settings`.
      config,
    });

    if (enqueued.outcome === "enqueued") {
      return {
        ok: true,
        outcome: "enqueued",
        add: decision.add,
        removeCount: decision.remove.length,
      };
    }
    if (enqueued.outcome === "duplicate") {
      // The expected outcome of a redelivered Stripe event. Not a problem.
      return { ok: true, outcome: "duplicate" };
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
    // THE CATCH THAT MAKES THE DOC COMMENT TRUE. The caller is the Stripe
    // webhook; a CRM concern must never cost a payment event.
    const message = errMessage(err);
    console.error("[ghl/buyer-state] producer threw:", message);
    return { ok: false, outcome: "failed", reason: "enqueue_failed", message };
  }
}

/* ------------------------------------------------------------------ *
 * Plan names
 * ------------------------------------------------------------------ */

type PlanNamesResult =
  | { ok: true; planName: string | null; allNames: string[] }
  | { ok: false; message: string };

/**
 * Every plan name, plus the one this subscription is on.
 *
 * ONE QUERY FOR BOTH, because they come from the same table and the removal
 * list needs the whole thing anyway. Splitting it would be two round trips on
 * the payment path for no gain.
 *
 * NOT FILTERED ON `is_active`. The single most important line in this
 * function. "Retire Plan" stops new sales only — existing subscribers keep
 * their price, their limits and their tags — so a retired plan's four buyer
 * tags are still sitting on real contacts and still have to be named in the
 * removal list when one of those subscribers moves. It is also why the
 * subscriber's OWN plan resolves here: a grandfathered customer is legitimately
 * on a retired plan, exactly as `resolvePlanId` in the webhook already allows.
 */
async function readPlanNames(
  db: SupabaseClient,
  planId: string | null
): Promise<PlanNamesResult> {
  const { data, error } = await db.from("subscription_plans").select("id, name");

  if (error) return { ok: false, message: error.message };

  const rows = (data ?? []) as { id?: unknown; name?: unknown }[];

  const allNames: string[] = [];
  let planName: string | null = null;

  for (const row of rows) {
    if (typeof row.name === "string" && row.name.trim() !== "") {
      allNames.push(row.name);
    }
    if (planId && row.id === planId && typeof row.name === "string") {
      planName = row.name;
    }
  }

  /*
   * A null `planName` is NOT an error here. It means the subscription has no
   * plan_id, or points at a plan that no longer exists; `decideBuyerStateTags`
   * then refuses with `plan_name`, which is logged once by the caller with the
   * company id attached. Failing early would lose that context.
   */
  return { ok: true, planName, allNames };
}
