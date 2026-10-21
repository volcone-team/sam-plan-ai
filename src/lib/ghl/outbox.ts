import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseGhlEmail } from "@/lib/ghl/client";
import { ghlIsOn, loadGhlConfig, type GhlConfig } from "@/lib/ghl/config";
// The dedupe insert IS a claim, and the claim idiom already exists and is
// already tested: an insert that hits a unique index means somebody else got
// there first. Reused rather than re-written so the two paths cannot drift on
// what "23505" means. `webhook-logic` is pure (it imports only `plan-change`),
// so this costs nothing at import time.
import { interpretClaim } from "@/lib/billing/webhook-logic";
// Delivery is still `drain.ts`; this only ASKS for one, after the response has
// been sent. It never throws and is safe with no request context, so it adds
// no failure mode to the callers listed below. No cycle: `schedule-drain`
// reaches `drain.ts`, `config.ts` and `client.ts`, none of which import this.
import { scheduleGhlDrain } from "@/lib/ghl/schedule-drain";

/**
 * Enqueueing a GoHighLevel side effect.
 *
 * ONE JOB: record "this contact should hold these tags" in `ghl_events` and
 * get out of the way. Delivery is `drain.ts`, on its own schedule, with its
 * own retry budget. Nothing in this module talks to GHL.
 *
 * NEVER THROWS, AND NEVER FAILS ITS CALLER. This is the whole reason the
 * outbox exists, so it is worth being explicit about who the callers are:
 *
 *   - the Stripe webhook, which is the ONLY writer of subscription state and
 *     whose idempotency is one insert into `stripe_webhook_events`. If a CRM
 *     concern made that handler non-2xx, Stripe would redeliver a PAYMENT
 *     event for the sake of a MARKETING tag.
 *   - intake build and plan generation, which the customer is sitting in front
 *     of watching a spinner.
 *   - login, where a thrown error is a person who cannot sign in.
 *
 * In all four cases the correct behaviour when the CRM bookkeeping cannot be
 * written is: log it, carry on, and let the tag be late or missing. A missing
 * tag costs an automation. A failed payment, a lost plan or a blocked sign-in
 * costs the customer. So every path below returns a result object (the house
 * pattern — see `buyerTag`, `decidePortalAccessChange`, the GHL client) and
 * the one `try` wraps everything, including the config read.
 *
 * ENQUEUEING IS CHEAP ON PURPOSE. One `app_settings` read (skipped entirely
 * when the caller already holds a config) and one insert, both on the local
 * database. No network, no fan-out, no transaction of its own.
 */

/* ------------------------------------------------------------------ *
 * The row
 * ------------------------------------------------------------------ */

/**
 * ONE SUB-ACCOUNT. 044's CHECK allows 'app' | 'ayr' | '10x' because the
 * original plan had three locations; the client cancelled that fan-out before
 * any of it was built, and `config.ts` carries the matching note about there
 * being one location id and one token. Every row written by this app is
 * therefore `'app'`, and it is a constant rather than a parameter so no
 * producer can accidentally address a location we have no credentials for.
 */
export const GHL_SUB_ACCOUNT_APP = "app" as const;

/**
 * The `event_type` CHECK from 044, verbatim.
 *
 * `login_trigger` IS DELIBERATELY ABSENT from the type below even though the
 * database still accepts it: the client dropped the login-trigger tag, so
 * nothing may enqueue one. Narrowing the CHECK would need a hand-run
 * migration for no behavioural gain, so the narrowing lives here instead.
 */
export type GhlEventType =
  | "buyer_state"
  | "founder"
  | "cancellation"
  | "finished_intake"
  | "plan_generated"
  | "first_login"
  | "marketing_suppression";

export interface EnqueueGhlEventInput {
  eventType: GhlEventType;
  /** Null for person-level events; 044 cascades this on company delete. */
  companyId?: string | null;
  /** Null when we only know an address. 044 nulls this on profile delete. */
  userId?: string | null;
  /** The GHL join key. Normalised here, not by the caller. */
  contactEmail: string;
  /**
   * RESOLVED tag strings from `tags.ts` — never inputs to be re-derived at
   * delivery time. 044 documents why: a buyer tag contains the admin-editable
   * plan name, and a rename between enqueue and delivery must not silently
   * change what lands in the client's CRM.
   */
  tagsAdd?: readonly string[];
  tagsRemove?: readonly string[];
  /**
   * Debugging context: plan name, cycle, source route, counts.
   *
   * MUST NOT CONTAIN A SECRET. No tokens, no location id, no session or cookie
   * data, no Stripe keys. This column is readable by anyone with database or
   * backup access and is rendered on an admin screen, so treat it as public
   * within the company. 044 says the same thing in a COMMENT; it is repeated
   * here because this is where the value is actually chosen.
   */
  payload?: Record<string, unknown>;
  /**
   * Stable identity of the LOGICAL event — a Stripe event id plus the intent,
   * a user id plus a day. Null means "never deduped", the same convention
   * `app_notifications.dedupe_key` uses.
   */
  dedupeKey?: string | null;
  /**
   * An already-loaded config, so a producer that enqueues several events (or
   * has already decided to act on `ghlIsOn`) does not re-read `app_settings`
   * once per row.
   */
  config?: GhlConfig;
  /**
   * Whether to ask for an opportunistic drain after the response (default
   * true). The ONLY reason to pass false is that the caller is itself a drain
   * or a batch/backfill: scheduling a delivery from inside delivery is at best
   * a lease loss per row, and a backfill writing hundreds of rows would ask
   * for hundreds of identical drains. Normal producers leave it alone.
   */
  scheduleDrain?: boolean;
}

/** Why nothing was written. Stable strings: logged, and asserted in tests. */
export type EnqueueSkipReason =
  /** `ghlIsOn` is false: switched off, unconfigured, or settings unreadable. */
  | "integration_off"
  /** No usable address, so there is no contact to tag. */
  | "no_email"
  /** Both tag lists are empty — the row would ask the drain to do nothing. */
  | "nothing_to_do";

export type EnqueueGhlEventResult =
  | { ok: true; outcome: "enqueued"; id: string | null }
  /** The dedupe key is already pending or delivered. Idempotent no-op. */
  | { ok: true; outcome: "duplicate"; id: null }
  /** Nothing to do, and nothing wrong. See `reason`. */
  | { ok: true; outcome: "skipped"; reason: EnqueueSkipReason }
  /** The insert itself failed. The caller carries on regardless. */
  | { ok: false; outcome: "failed"; message: string };

/* ------------------------------------------------------------------ *
 * Enqueue
 * ------------------------------------------------------------------ */

/**
 * Record an intended GHL side effect.
 *
 * `db` must be a service-role client: `ghl_events` has RLS on with no
 * policies, so anon and authenticated read and write nothing (044 §3).
 *
 * WHY A PLAIN INSERT AND NOT `.upsert({ onConflict: ... })`, which is the
 * obvious thing to reach for and does not work. The dedupe index in 044 is
 * PARTIAL:
 *
 *     CREATE UNIQUE INDEX uq_ghl_events_dedupe
 *       ON ghl_events(sub_account, dedupe_key)
 *       WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'delivered');
 *
 * PostgREST's `on_conflict` parameter carries COLUMN NAMES only; it has no way
 * to express an index predicate. Postgres will not infer a partial index from
 * a bare column list, so the statement fails outright with "there is no unique
 * or exclusion constraint matching the ON CONFLICT specification" — at runtime,
 * on every insert, not at compile time. `app_notifications` hit exactly this
 * and settled on the same answer.
 *
 * So: insert, and read a unique violation as "already enqueued". That is not a
 * workaround, it is the stronger primitive — the index is the only thing that
 * can adjudicate a race between two concurrent producers, and the losing
 * insert finding out by 23505 is precisely the signal we want. Note the
 * partial predicate is doing real work here: a `failed` or `skipped` row does
 * NOT block a re-enqueue of the same key, because both are states an operator
 * legitimately retries later.
 */
export async function enqueueGhlEvent(
  db: SupabaseClient,
  input: EnqueueGhlEventInput
): Promise<EnqueueGhlEventResult> {
  try {
    // One settings read, and only when the caller has not already done it.
    const config = input.config ?? (await loadGhlConfig(db));

    /*
     * OFF MEANS NO ROW, not a row for later. A queue that fills up while the
     * integration is switched off would deliver a flood of stale tags the
     * moment someone enables it — "you finished your intake" six weeks after
     * the fact, triggering a workflow aimed at people who just signed up. The
     * events are only worth sending while they are true.
     *
     * `ghlIsOn` and not `mayWrite`: a dry run must exercise this whole path.
     */
    if (!ghlIsOn(config)) {
      return { ok: true, outcome: "skipped", reason: "integration_off" };
    }

    const email = normaliseGhlEmail(input.contactEmail);
    if (!email) {
      /*
       * SKIPPED, NOT FAILED. A person-level event for an account with no
       * usable address is a data gap, not a fault in this call, and the
       * producer has nothing it could do differently. Logged so it is visible
       * if it ever becomes common.
       */
      console.warn(
        `[ghl/outbox] ${input.eventType}: no contact email, nothing enqueued.`
      );
      return { ok: true, outcome: "skipped", reason: "no_email" };
    }

    const tagsAdd = cleanTags(input.tagsAdd);
    const tagsRemove = cleanTags(input.tagsRemove);

    /*
     * A row with both lists empty would be claimed, leased, upserted against
     * the CRM and marked delivered, all to write no tags. Refused here rather
     * than filtered in the drain so the cost is nothing and the outbox stays
     * an honest record of intent.
     */
    if (tagsAdd.length === 0 && tagsRemove.length === 0) {
      return { ok: true, outcome: "skipped", reason: "nothing_to_do" };
    }

    const { data, error } = await db
      .from("ghl_events")
      .insert({
        company_id: input.companyId ?? null,
        user_id: input.userId ?? null,
        contact_email: email,
        sub_account: GHL_SUB_ACCOUNT_APP,
        event_type: input.eventType,
        tags_add: tagsAdd,
        tags_remove: tagsRemove,
        payload: input.payload ?? {},
        // status / attempts / next_attempt_at are left to the column defaults
        // from 044: pending, 0, now() — i.e. immediately claimable.
        dedupe_key: input.dedupeKey ?? null,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      const claim = interpretClaim(error.code);
      if (claim === "duplicate") {
        // Already pending or delivered against this key. The expected outcome
        // of a redelivered Stripe event, not a problem.
        return { ok: true, outcome: "duplicate", id: null };
      }
      console.error(`[ghl/outbox] ${input.eventType}: insert failed:`, error.message);
      return { ok: false, outcome: "failed", message: error.message };
    }

    /*
     * `id` CAN BE NULL ON SUCCESS and that is not an error worth surfacing. A
     * service-role insert returns the row, but a future RLS policy or a
     * `returning=minimal` default would leave `data` empty while the row
     * exists. The caller does nothing with the id but log it; refusing the
     * write because we could not read it back would be the wrong trade.
     */
    /*
     * ON `enqueued` ONLY. `duplicate`, `skipped` and `failed` all mean there
     * is no new row to deliver, so a drain would spend a query to find that
     * out. NOT DEDUPED PER REQUEST, deliberately: the Stripe webhook enqueues
     * up to three events and so asks for three drains, but the lease makes
     * that harmless (the first takes the rows, the others read an empty batch
     * or lose the lease) and the cost is two extra selects on a local
     * database. The alternatives are worse — module-level "already scheduled"
     * state is simply wrong in a serverless runtime, where one instance
     * serves many requests, and `React.cache` would pull React into the
     * import graph of the Stripe webhook to save a query.
     */
    if (input.scheduleDrain !== false) scheduleGhlDrain(db);

    return {
      ok: true,
      outcome: "enqueued",
      id: typeof data?.id === "string" ? data.id : null,
    };
  } catch (err: unknown) {
    // A thrown client (bad URL, fetch failure, a method mocked away in a
    // test). THE CATCH THAT MAKES THE DOC COMMENT TRUE.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ghl/outbox] ${input.eventType}: enqueue threw:`, message);
    return { ok: false, outcome: "failed", message };
  }
}

/**
 * Trim, drop blanks, and de-duplicate within the list.
 *
 * NOT NORMALISED FOR CASE. GHL lowercases tags on write, so the strings from
 * `tags.ts` go to the CRM exactly as the contract spells them — including the
 * non-ASCII apostrophe and en dash in the inactivity tags, which are
 * load-bearing and which `normaliseTagForCompare` is careful not to fold
 * either. The only cleaning here is the kind that cannot change which GHL tag
 * is meant.
 *
 * De-duplicated because `buyerTagTransition` legitimately produces overlapping
 * lists across plans, and sending the same tag twice is a longer request body
 * for the same effect.
 */
function cleanTags(tags: readonly string[] | undefined): string[] {
  if (!tags) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = typeof raw === "string" ? raw.trim() : "";
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}
