import type { SupabaseClient } from "@supabase/supabase-js";
import { ghlIsOn, loadGhlConfig, type GhlConfig } from "@/lib/ghl/config";
import { resolveGhlOwnerContact } from "@/lib/ghl/contact";
import { enqueueGhlEvent } from "@/lib/ghl/outbox";
import { TAG_FOUNDER } from "@/lib/ghl/tags";
// READ-ONLY REUSE, and the point of reusing it is that there is exactly one
// answer in this codebase to "has money actually moved". See `fire only on a
// real purchase` below.
import { buyerPresenceForStatus } from "@/lib/ghl/buyer-state";
import type { SubscriptionStatus } from "@/lib/billing/entitlement";

/**
 * The founder producer: "this company is one of the first hundred, tell
 * GoHighLevel."
 *
 * THE FIFTH SIBLING of `producers/subscription.ts`, `producers/cancellation.ts`,
 * `producers/milestone.ts` and `producers/first-login.ts`, deliberately shaped
 * the same way: same never-throws contract, same config-first ordering by
 * cost, same discriminated result, same stable skip/fail reasons, same
 * enqueue-only reach, same "no secrets in the payload" rule. Read
 * `milestone.ts` first — this is the same one-shot-by-dedupe-key problem, and
 * the reasoning it spells out is not repeated here.
 *
 * ── THE CLIENT'S RULE, AND THE INTERPRETATION OF IT ─────────────────────────
 *
 * What the client said, in full: "First 100 users are counted as founder
 * users." That is one sentence and it leaves three things open, so the reading
 * implemented here is written out in order to be CORRECTED LATER rather than
 * guessed at by the next reader:
 *
 *   1. THE UNIT IS A COMPANY, NOT A PROFILE. "Users" is the client's word, but
 *      only the company OWNER is ever a GHL contact (`contact.ts`, where that
 *      is a client requirement rather than an optimisation). Counting profiles
 *      would let one five-person agency consume five of the hundred slots
 *      while producing exactly one tagged contact, so the cohort would be
 *      smaller than a hundred contacts and nobody could say by how much.
 *
 *   2. RANK IS BY `companies.created_at` ASCENDING. A company is a founder if
 *      FEWER THAN `GHL_FOUNDER_LIMIT` companies were created strictly before
 *      it. Signup order is the only ordering the client's sentence can mean,
 *      and `created_at` is the only column that records it.
 *
 *   3. THE LIMIT IS ONE CONSTANT. `GHL_FOUNDER_LIMIT` below. The client has
 *      changed numbers like this before, so changing it is one line and the
 *      arithmetic around it is unit tested without a database.
 *
 * ── WRINKLE ONE: DELETES ARE HARD IN THIS SCHEMA ────────────────────────────
 *
 * *** THE OWNER HAS BEEN TOLD ABOUT THIS. IT IS NOT A BUG TO BE FIXED HERE. ***
 *
 * There is no `deleted_at` column anywhere in this schema — deleting a company
 * removes the row and cascades (see `cancel-on-delete.ts`). So the rank counts
 * EVERY company row that currently exists, including every dummy and test
 * account. The existing accounts in the live database are test data, so if
 * there are N of them at the moment the first real customer buys, only
 * 100 − N real customers can ever qualify.
 *
 * Nothing in this module can distinguish a test company from a real one: there
 * is no flag for it, and inventing one (an email domain, a name pattern) would
 * be a guess that silently changes who gets a tag. If the client wants the
 * hundred to mean a hundred PAYING customers, that is a different rule and it
 * needs a different column, not a cleverer query here.
 *
 * ── WRINKLE TWO: RANK CAN DRIFT ─────────────────────────────────────────────
 *
 * *** ALSO ALREADY FLAGGED TO THE OWNER. ***
 *
 * Rank is computed from the rows that exist at the moment it is asked, so it
 * is not stable over time. Delete an early company and everybody behind it is
 * promoted: a company that evaluated as rank 101 (not a founder) can later
 * evaluate as rank 100 and BECOME one.
 *
 * What the one-shot dedupe key guarantees and what it does not:
 *
 *   - AN EXISTING FOUNDER NEVER LOSES THE TAG. The row is already pending or
 *     delivered, nothing here ever removes the tag (see below), and a later
 *     re-evaluation that says "not a founder" simply enqueues nothing.
 *   - A NEW FOUNDER CAN STILL APPEAR, later, after a deletion, on that
 *     company's next qualifying subscription event. So the cohort can exceed
 *     a hundred contacts over the lifetime of the account.
 *
 * That is stated plainly rather than papered over. Pinning rank at signup
 * (a `founder_rank` column) would fix it and costs a hand-run migration; it is
 * the right change if the client ever cares about the exact membership.
 *
 * ── ADD ONLY, NEVER REMOVED ─────────────────────────────────────────────────
 *
 * `tags.ts` already documents this tag as "set once, never cleared by the
 * app", and this producer has NO remove list and never will. Founder status is
 * a fact about WHEN SOMEBODY JOINED; it cannot be un-happened. There is no
 * second state, so there is no state machine here — unlike the cancellation
 * producer, which exists in two directions precisely because a cancellation
 * can be reversed.
 */

/* ------------------------------------------------------------------ *
 * The limit
 * ------------------------------------------------------------------ */

/**
 * How many companies are founders. The client's "first 100".
 *
 * THE ONLY PLACE THE NUMBER APPEARS. Exported so the admin screen and the
 * tests read the same value rather than restating it, and so changing the
 * cohort size is one line here instead of a search for `100`.
 */
export const GHL_FOUNDER_LIMIT = 100;

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

/**
 * Is a company with this many companies created before it a founder?
 *
 * PURE, AND SEPARATE FROM THE QUERY FOR ONE REASON: the off-by-one. "First
 * 100" means ranks 1 through 100, and rank is `priorCompanyCount + 1`, so the
 * hundredth founder has NINETY-NINE companies before it and the first company
 * that misses out has a hundred. Written as `prior < limit` rather than
 * `rank <= limit` because the count is what the database actually returns, so
 * there is no arithmetic between the query and the comparison to get wrong.
 *
 * Defensive on the inputs because the count comes back from PostgREST as
 * `number | null` and a null must not read as zero — zero is the one value
 * that means "the very first company ever", i.e. a guaranteed founder.
 */
export function isFounderRank(
  priorCompanyCount: number | null | undefined,
  limit: number = GHL_FOUNDER_LIMIT
): boolean {
  if (typeof priorCompanyCount !== "number" || !Number.isFinite(priorCompanyCount)) {
    return false;
  }
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return false;
  return priorCompanyCount >= 0 && priorCompanyCount < limit;
}

/* ------------------------------------------------------------------ *
 * The dedupe key
 * ------------------------------------------------------------------ */

/**
 * The dedupe key shape: `company:{companyId}:founder`.
 *
 * COMPANY-SCOPED, because the cohort is companies (see the module header), and
 * one-shot because 044's unique index is
 *
 *     ON ghl_events(sub_account, dedupe_key)
 *     WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'delivered')
 *
 * so once a row for this key is pending or delivered, every later insert hits
 * 23505 and the outbox reports `duplicate` — a success that wrote nothing.
 * That is what makes "a founder never loses the tag, and never gets it twice"
 * true even though this producer runs on every qualifying subscription event.
 *
 * `:founder` IS LOAD-BEARING. That index carries NO `event_type`, and this
 * producer shares the `company:` namespace with `milestoneDedupeKey`
 * (`company:{id}:finished_intake`, `company:{id}:plan_generated`) AND fires
 * from the same Stripe event as the buyer-state and cancellation producers. A
 * key that collided with any of them would have the second insert reported as
 * a `duplicate` — a SUCCESS — and one of the two tags would never be written,
 * silently, forever, with no error anywhere to find. Five producers, five
 * distinct suffixes; `founder.test.ts` asserts this key against all of them.
 */
export function founderDedupeKey(companyId: string): string {
  return `company:${companyId}:founder`;
}

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

export type FounderProducerResult =
  /**
   * A row was written, or this company is already a founder.
   *
   * `duplicate` IS THE EXPECTED STEADY STATE for a founder: every renewal
   * after the first lands on it. `rank` and `limit` come back on both so a
   * caller can log why.
   */
  | {
      ok: true;
      outcome: "enqueued" | "duplicate";
      tag: string;
      /** 1-based position by `created_at`. See the drift note in the header. */
      rank: number;
      limit: number;
    }
  /** Nothing to do, and nothing wrong. */
  | { ok: true; outcome: "skipped"; reason: FounderSkipReason; detail?: string }
  /** Something went wrong that a human may want to know about. */
  | { ok: false; outcome: "failed"; reason: FounderFailReason; message: string };

export type FounderSkipReason =
  /** `ghlIsOn` is false. The common case today, and the cheapest path. */
  | "integration_off"
  /** The caller passed no usable company id. A bug in the caller. */
  | "no_company"
  /**
   * The status does not mean "they have bought". A trial, an abandoned
   * checkout, a cancelled subscription. `detail` carries the presence reason.
   */
  | "not_a_buyer"
  /**
   * `companies.created_at` is missing or unparseable, so rank is unknowable.
   * REFUSED RATHER THAN GUESSED — see `readCompanyCreatedAt`.
   */
  | "no_created_at"
  /** Rank is at or past `GHL_FOUNDER_LIMIT`. The steady state after 100. */
  | "past_limit"
  /** No owner profile, or the owner has no email. A data gap. */
  | "no_owner_contact"
  /** The outbox declined (no email, nothing to do). Already logged there. */
  | "outbox_skipped";

export type FounderFailReason =
  /** The rank count errored, so we do not know whether they qualify. */
  | "rank_unreadable"
  /** The insert failed, or something threw. */
  | "enqueue_failed";

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

/** Which call site. Debug context in the payload; never a decision input. */
export type FounderSource =
  /** `syncSubscription` in `/api/stripe/webhook` — the only one today. */
  "stripe_webhook";

export interface FounderProducerInput {
  /** The company whose OWNER becomes the GHL contact, and the rank subject. */
  companyId: string;
  /**
   * `subscriptions.status` after the write. Gates the whole producer: founder
   * status is only evaluated for a company that has actually bought. Either
   * spelling of cancelled is accepted, because `buyerPresenceForStatus`
   * accepts both and that is the point of reusing it.
   */
  status: SubscriptionStatus | string | null | undefined;
  /**
   * `companies.created_at`, when the caller already has it.
   *
   * ACCEPTED AS AN INPUT *AND* READ HERE IF ABSENT, and the asymmetry is
   * deliberate. The only call site today is the Stripe webhook, which holds a
   * subscription row and a company id but NOT the company's creation time, so
   * requiring it would push a query into the payment path's own code and make
   * the webhook responsible for a detail of this rule. Reading it here keeps
   * the route to one guarded call — the shape every sibling producer has.
   *
   * It stays accepted because a future caller (company creation, an admin
   * backfill) has the row in hand, and paying for a second read of a column
   * you are already holding is the kind of thing that makes a producer too
   * expensive to call. A string is passed to the comparison VERBATIM; see
   * `normaliseCreatedAt`.
   */
  companyCreatedAt?: string | Date | null;
  /** The Stripe event id that caused this. Debug context only — see below. */
  stripeEventId?: string | null;
  /** e.g. "invoice.paid". Debug context only; never a decision input. */
  stripeEventType?: string | null;
  /** Which call site. Written to the payload so the admin screen can say. */
  source?: FounderSource;
  /** An already-loaded config, so `app_settings` is not read twice. */
  config?: GhlConfig;
}

/* ------------------------------------------------------------------ *
 * Producer
 * ------------------------------------------------------------------ */

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Enqueue the one-shot founder tag for a company, if it is one of the first
 * `GHL_FOUNDER_LIMIT`.
 *
 * `db` must be a service-role client: `ghl_events` has RLS on with no
 * policies, and `companies` / `profiles` are not readable without it. The
 * webhook already holds one.
 *
 * ── FIRE ONLY ON A REAL PURCHASE ────────────────────────────────────────────
 *
 * The call site is the end of `syncSubscription`, beside the buyer-state and
 * cancellation producers, and NOT company creation. Two reasons, and the first
 * is the client's concept rather than a convenience:
 *
 *   - A FOUNDER IS A FOUNDING *CUSTOMER*. Firing at signup would spend the
 *     hundred slots on trials and abandoned registrations — the majority of
 *     which never pay — so the client's "first 100" would be a hundred
 *     sign-ups, most of them holding a founder tag they never bought. Firing
 *     when money moves means a trialling company that never converts does not
 *     consume the concept. (Note what this does NOT change: rank is still by
 *     `created_at`, i.e. SIGNUP order. Purchase is the trigger, signup order
 *     is the rule. A company that signed up tenth and bought a year later is
 *     still rank 10 — if the nine ahead of it still exist. See the drift note.)
 *   - THE GUARDED BLOCK ALREADY EXISTS. The webhook's GHL block is already
 *     written, already wrapped in a `try` that cannot fail the handler, and
 *     already the last thing in the function. Adding a sixth producer there is
 *     one call; adding a brand-new guarded block to the registration path
 *     would be new surface on a route where a throw is a customer who cannot
 *     sign up.
 *
 * HOW "THEY REALLY BOUGHT" IS DECIDED, without duplicating the buyer-state
 * decision: this producer takes the `status` the webhook has just written and
 * runs it through `buyerPresenceForStatus` — the SAME pure function
 * `decideBuyerStateTags` uses, imported read-only. Presence must be `active`.
 *
 *   - Reading the buyer-state producer's RESULT instead was the obvious
 *     alternative and it does not work: on a redelivered event that producer
 *     returns `{ outcome: "duplicate" }` with no state in it, so the founder
 *     tag would depend on whether Stripe happened to send the event twice.
 *   - `inactive` is NOT enough. A cancelled or unpaid company reaching here is
 *     an exit, not a purchase, and a company that bought while in the first
 *     hundred was already tagged on that earlier `active` event.
 *   - `past_due` COUNTS, because `buyerPresenceForStatus` maps it to `active`:
 *     Stripe is still retrying a card that already paid once, and
 *     `evaluateAccess` still grants access. Inheriting that judgement is the
 *     whole reason for reusing the function rather than writing a status list
 *     here that could drift from it.
 *
 * ORDER OF OPERATIONS IS AN ORDER OF COST, matching all four siblings. Config
 * first and free, so the normal case today — the integration switched off —
 * does ZERO queries (`founder.test.ts` asserts that with a spy). Then the
 * purchase gate and the company id, both pure. Then `created_at` (one select,
 * skipped when the caller supplied it) and the rank count (one HEAD count).
 * Only then the owner, which is two selects: resolving a contact before
 * knowing whether the company is even in the cohort would be two queries on
 * the payment path for every customer after the hundredth, forever.
 *
 * THE DEDUPE IS NOT CHECKED FIRST, same as `milestone.ts`: a pre-read would be
 * another query that still could not decide a race, and the insert's 23505
 * answers it authoritatively for free.
 */
export async function enqueueFounderEvent(
  db: SupabaseClient,
  input: FounderProducerInput
): Promise<FounderProducerResult> {
  try {
    const config = input.config ?? (await loadGhlConfig(db));

    // OFF IS THE CHEAPEST PATH AND THE CURRENT ONE. No queries, no row, no log.
    if (!ghlIsOn(config)) {
      return { ok: true, outcome: "skipped", reason: "integration_off" };
    }

    // THE PURCHASE GATE. Pure, and the most likely early exit on a payment
    // path full of trial and incomplete-checkout events.
    const presence = buyerPresenceForStatus(input.status);
    if (presence.presence !== "active") {
      return {
        ok: true,
        outcome: "skipped",
        reason: "not_a_buyer",
        detail: presence.presence === "none" ? presence.reason : presence.presence,
      };
    }

    const companyId =
      typeof input.companyId === "string" ? input.companyId.trim() : "";
    if (!companyId) {
      /*
       * Checked HERE rather than left to `resolveGhlOwnerContact` only so the
       * dedupe key below can never be built from a blank id. `company::founder`
       * would be one key shared by every company that ever hit this path, and
       * the first one through would permanently block the rest — the same trap
       * `enqueueMilestoneEvent` and `enqueueFirstLoginEvent` both guard.
       */
      return { ok: true, outcome: "skipped", reason: "no_company" };
    }

    const createdAt = await readCompanyCreatedAt(db, companyId, input.companyCreatedAt);
    if (!createdAt.ok) {
      /*
       * NO TIMESTAMP, NO TAG. See `readCompanyCreatedAt` — a wrong founder tag
       * cannot be un-sent, so an unknowable rank must not be guessed at.
       */
      return {
        ok: true,
        outcome: "skipped",
        reason: "no_created_at",
        detail: createdAt.detail,
      };
    }

    const prior = await countPriorCompanies(db, createdAt.value);
    if (!prior.ok) {
      /*
       * FAIL, NOT SKIP, and the distinction matters to whoever reads the log:
       * we do not know whether this company qualifies. Nothing is enqueued,
       * and because the dedupe key is company-scoped rather than event-scoped,
       * the NEXT subscription event re-evaluates and can still tag them. A
       * founder tag that is late is recoverable; a wrong one is not.
       */
      console.error(
        "[ghl/founder] founder rank unreadable for company",
        companyId,
        "-",
        prior.message
      );
      return {
        ok: false,
        outcome: "failed",
        reason: "rank_unreadable",
        message: prior.message,
      };
    }

    if (!isFounderRank(prior.count, GHL_FOUNDER_LIMIT)) {
      /*
       * WHERE EVERY COMPANY AFTER THE HUNDREDTH EXITS, on every subscription
       * event, forever. Two cheap reads and no write. Not logged: it is the
       * normal answer, not an event.
       */
      return { ok: true, outcome: "skipped", reason: "past_limit" };
    }

    // 1-based, for humans and for the payload. The DECISION is made on the
    // count above, never on this; see `isFounderRank` on the off-by-one.
    const rank = prior.count + 1;

    // Never throws; reports a data gap as a reason, and has already logged it
    // in its own voice.
    const owner = await resolveGhlOwnerContact(db, companyId);
    if (!owner.ok) {
      /*
       * SKIP, NOT FAIL. Same call all four siblings make: a company with no
       * owner profile is a data gap the webhook cannot fix, and re-logging it
       * at error level on the payment path would train people to ignore that
       * path's logs. The company keeps its place in the cohort — nothing has
       * been spent — so a fixed address gets tagged on the next event.
       */
      return {
        ok: true,
        outcome: "skipped",
        reason: "no_owner_contact",
        detail: owner.reason,
      };
    }

    const enqueued = await enqueueGhlEvent(db, {
      eventType: "founder",
      companyId,
      userId: owner.contact.userId,
      contactEmail: owner.contact.email,
      /*
       * ADD ONLY, AND THERE IS NO REMOVE LIST, EVER. Founder status is a fact
       * about when they joined — it cannot be un-happened, and a company
       * promoted out of the cohort by somebody else's deletion has still been
       * a founder since the day we said so. `tags.ts` documents the same thing
       * from the other side: "set once, never cleared by the app".
       */
      tagsAdd: [TAG_FOUNDER],
      tagsRemove: [],
      payload: {
        /*
         * THE RANK AND THE LIMIT, which is the genuinely useful half of this
         * payload: "why is this contact a founder?" is a question an admin
         * will ask, the answer drifts over time (see the header), and this row
         * is the only record of what we believed at the moment we tagged them.
         */
        rank,
        limit: GHL_FOUNDER_LIMIT,
        /** The raw count the decision was made on, so the arithmetic is visible. */
        priorCompanies: prior.count,
        /* Debug context. NO SECRETS: no tokens, no location id, nothing from
         * the Stripe object itself — this column is rendered on an admin
         * screen and sits in every backup. */
        status: presence.status,
        source: input.source ?? null,
        stripeEventType: input.stripeEventType ?? null,
        // Read by `deliverGhlRow` and passed to the contact upsert, which is
        // how a contact created by this event gets a name and not just an
        // address.
        firstName: owner.contact.firstName,
        lastName: owner.contact.lastName,
        companyName: owner.contact.companyName,
      },
      /*
       * ALWAYS A KEY, AND NEVER THE STRIPE EVENT ID. The two Stripe producers
       * key on the event because they re-send a STATE on every change; this is
       * a one-shot, so keying on the event would re-tag the same company on
       * every renewal for the rest of its life — and GHL fires a workflow on
       * every tag ADD, so the client's founder sequence would send again. The
       * company is the scope because the fact is about the company.
       */
      dedupeKey: founderDedupeKey(companyId),
      // Passed through so the outbox does not re-read `app_settings`.
      config,
    });

    if (enqueued.outcome === "enqueued") {
      return {
        ok: true,
        outcome: "enqueued",
        tag: TAG_FOUNDER,
        rank,
        limit: GHL_FOUNDER_LIMIT,
      };
    }
    if (enqueued.outcome === "duplicate") {
      /*
       * THE ONE-SHOT WORKING AS DESIGNED, and the steady state for a founder:
       * every renewal, every card retry and every redelivered event after the
       * first lands here. Not a problem, and not worth a log line on the
       * payment path.
       */
      return {
        ok: true,
        outcome: "duplicate",
        tag: TAG_FOUNDER,
        rank,
        limit: GHL_FOUNDER_LIMIT,
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
    // THE CATCH THAT MAKES THE DOC COMMENT TRUE. The caller is the Stripe
    // webhook: a non-2xx there makes Stripe REDELIVER A PAYMENT EVENT for the
    // sake of a marketing tag.
    const message = errMessage(err);
    console.error("[ghl/founder] producer threw:", message);
    return { ok: false, outcome: "failed", reason: "enqueue_failed", message };
  }
}

/* ------------------------------------------------------------------ *
 * created_at
 * ------------------------------------------------------------------ */

type CreatedAtResult =
  | { ok: true; value: string }
  /** `detail` is a stable string: logged, and pinned in the tests. */
  | { ok: false; detail: "missing" | "unparseable" | "read_failed" };

/**
 * Normalise a `created_at` into something safe to compare against.
 *
 * A STRING IS PASSED THROUGH VERBATIM, and that is not laziness. Postgres
 * stores `timestamptz` to MICROSECOND precision; `new Date(s).toISOString()`
 * truncates to milliseconds, so re-serialising a timestamp would shift the
 * comparison boundary by up to 999µs and could change a company's rank by one.
 * The string from the database is already in the exact form PostgREST wants,
 * so the only thing done to it is a VALIDITY check — parsed and thrown away.
 *
 * A `Date` has no sub-millisecond precision to lose, so it is serialised.
 */
function normaliseCreatedAt(raw: unknown): CreatedAtResult {
  if (raw instanceof Date) {
    return Number.isFinite(raw.getTime())
      ? { ok: true, value: raw.toISOString() }
      : { ok: false, detail: "unparseable" };
  }
  if (typeof raw !== "string") return { ok: false, detail: "missing" };
  const text = raw.trim();
  if (text === "") return { ok: false, detail: "missing" };
  // Parsed only to validate. The VALUE sent on is the original text.
  if (!Number.isFinite(Date.parse(text))) return { ok: false, detail: "unparseable" };
  return { ok: true, value: text };
}

/**
 * The company's own `created_at` — from the caller if it has it, otherwise one
 * select.
 *
 * A MISSING OR UNPARSEABLE TIMESTAMP MEANS NO TAG, which is the one place this
 * module refuses rather than degrades, so it is worth being explicit about
 * why. Every other producer treats a data gap as "skip and try again later",
 * and so does this one — but the temptation here is different: rank could be
 * "assumed founder" (the company is probably old if its row is odd) or
 * "assumed not". Both are guesses about who is in a cohort the client will
 * build email on, and A WRONG FOUNDER TAG CANNOT BE UN-SENT: the add fires a
 * GHL workflow, the welcome mail leaves the client's domain, and removing the
 * tag afterwards changes nothing. Silence is recoverable by hand; a sent email
 * is not. So: refuse.
 *
 * `created_at` is NOT NULL in migration 001, so `missing` is not a state the
 * schema allows — it is here for a stubbed client, a `select` that returned a
 * partial row, and the day somebody changes the column.
 */
async function readCompanyCreatedAt(
  db: SupabaseClient,
  companyId: string,
  supplied: string | Date | null | undefined
): Promise<CreatedAtResult> {
  if (supplied !== null && supplied !== undefined) {
    const normalised = normaliseCreatedAt(supplied);
    /*
     * A SUPPLIED-BUT-BAD VALUE IS NOT RE-READ FROM THE DATABASE. The caller
     * said it had the answer; quietly querying behind it would hide a caller
     * bug and make the cost of this producer unpredictable.
     */
    return normalised;
  }

  try {
    const { data, error } = await db
      .from("companies")
      .select("created_at")
      .eq("id", companyId)
      .maybeSingle();

    if (error) {
      console.error(
        `[ghl/founder] created_at unreadable for company ${companyId}:`,
        error.message
      );
      return { ok: false, detail: "read_failed" };
    }
    return normaliseCreatedAt((data as { created_at?: unknown } | null)?.created_at);
  } catch (err: unknown) {
    // Belt and braces: the producer's own catch would absorb this, but a
    // thrown client here is a read failure rather than a producer fault.
    console.error(
      `[ghl/founder] created_at read threw for company ${companyId}:`,
      errMessage(err)
    );
    return { ok: false, detail: "read_failed" };
  }
}

/* ------------------------------------------------------------------ *
 * Rank
 * ------------------------------------------------------------------ */

type PriorCountResult = { ok: true; count: number } | { ok: false; message: string };

/**
 * How many companies were created STRICTLY BEFORE this one.
 *
 * A HEAD / EXACT COUNT, NOT A FETCH. `{ count: "exact", head: true }` makes
 * PostgREST answer with a count in the Content-Range header and NO rows at
 * all. Selecting a hundred ids and taking `.length` would be the same answer
 * for ten times the payload — and would be WRONG the moment the limit is
 * raised, because a plain select is capped by PostgREST's row limit, so a
 * limit of 2000 would silently count 1000. `select("id")` here names a column
 * only because PostgREST requires one; no value is transferred.
 *
 * STRICTLY `<`, AND THE TIE CASE IS REAL. `.lt()` means a company created at
 * the same instant is NOT counted, so two companies sharing a `created_at`
 * BOTH see the same prior count and BOTH get the same rank. At the boundary
 * that means the cohort can be 101 companies rather than 100 — two companies
 * tied at prior-count 99 are both founders.
 *
 * That is the right way round. The alternative, `<=`, counts the company
 * ITSELF (its own `created_at` is equal to its own `created_at`), which would
 * shift every single rank by one and make the first company ever a rank-2
 * founder — a guaranteed off-by-one in exchange for a tie that needs
 * microsecond-identical timestamps on a `now()` default. Letting a tie admit
 * one extra founder is a rounding error in a marketing cohort; getting every
 * rank wrong is not.
 *
 * NO `is_active` OR SIMILAR FILTER, AND NOTHING EXCLUDING TEST DATA. There is
 * no column for either. See wrinkle one in the module header.
 */
async function countPriorCompanies(
  db: SupabaseClient,
  createdAt: string
): Promise<PriorCountResult> {
  const { count, error } = await db
    .from("companies")
    // No rows come back; the count arrives in a header.
    .select("id", { count: "exact", head: true })
    .lt("created_at", createdAt);

  if (error) return { ok: false, message: error.message };

  if (typeof count !== "number" || !Number.isFinite(count)) {
    /*
     * A NULL COUNT IS A FAILURE, NOT A ZERO. PostgREST returns null when it
     * could not count (a planned count, a missing header); reading that as
     * zero would make EVERY company look like the first one ever and tag the
     * entire customer base as founders.
     */
    return { ok: false, message: "The company count came back empty." };
  }

  return { ok: true, count };
}
