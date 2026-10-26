import type { SupabaseClient } from "@supabase/supabase-js";
import { ghlIsOn, loadGhlConfig, type GhlConfig } from "@/lib/ghl/config";
import { resolveGhlOwnerContact } from "@/lib/ghl/contact";
import { enqueueGhlEvent, type GhlEventType } from "@/lib/ghl/outbox";
import { TAG_FINISHED_INTAKE, TAG_PLAN_GENERATED } from "@/lib/ghl/tags";

/**
 * The milestone producer: "this company reached a point in its life once, tell
 * GoHighLevel."
 *
 * THE THIRD SIBLING of `producers/subscription.ts` and `producers/cancellation.ts`,
 * deliberately shaped the same way: same never-throws contract, same
 * config-first ordering by cost, same discriminated result, same enqueue-only
 * reach, same "no secrets in the payload" rule. Read `subscription.ts` first;
 * the reasoning it spells out is not repeated here.
 *
 * ONE MODULE FOR TWO TAGS because they are structurally identical — a fixed
 * tag, added and never removed, once per company. `finished intake` and
 * `plan generated` differ only in which string and which `event_type` they
 * carry, so splitting them would duplicate the interesting half (the one-shot
 * mechanism) in two places that could then drift on it.
 *
 * ── THESE ARE MILESTONES, NOT STATES ────────────────────────────────────────
 *
 * This is the one way this producer genuinely differs from its siblings, and
 * it inverts their central design decision. The buyer and cancellation tags
 * are STATES: they are re-sent on every write, because re-sending the truth is
 * idempotent and self-healing. A milestone cannot work that way.
 *
 * A customer regenerates their plan repeatedly — `/api/generate-plan` tracks
 * `plan_regeneration` explicitly, and `/api/intake/build` meters
 * `plan_regenerations` because rebuilding from the intake is a normal thing to
 * do. GHL's add-tag call is idempotent on the TAG, so re-sending would not
 * produce a second tag. But a GHL workflow triggered by "contact tag added"
 * fires again on the re-add, and the client's onboarding workflow is wired to
 * exactly that. Re-sending would mail a two-year-old customer their welcome
 * sequence because they tidied up next year's plan. There is no undo: the
 * email has been sent, from the client's domain, to the client's customer.
 *
 * SO: ONE-SHOT PER COMPANY PER MILESTONE, ENFORCED BY THE DEDUPE KEY. The key
 * is `company:{companyId}:{milestone}` — scoped to the COMPANY, not to the
 * event that produced it. 044's unique index is
 *
 *     ON ghl_events(sub_account, dedupe_key)
 *     WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'delivered')
 *
 * so once a row for that key is pending or delivered, every later insert with
 * the same key hits 23505 and the outbox reports `duplicate` — a success that
 * wrote nothing. Exactly-once, with no new column and no hand-run migration.
 *
 * WHY NOT A COLUMN ON `companies` (`ghl_plan_generated_at` and friends), which
 * is the other obvious design. It would cost a migration that is run BY HAND
 * in the Supabase SQL editor against the one database that is also production,
 * and it would need a read before every enqueue plus a write after, with a
 * race between two concurrent builds that only a constraint can actually
 * adjudicate. 044 already ships that constraint. A column would also put the
 * fact in two places — the flag and the outbox row — and the two could
 * disagree. The index is the stronger primitive and it is already there.
 *
 * ── THE ONE CONSEQUENCE, STATED PLAINLY ─────────────────────────────────────
 *
 * The index predicate covers `pending` and `delivered` ONLY. A row that ends
 * `failed` (the drain exhausted its retries) or `skipped` stops blocking the
 * key, so the same milestone CAN be enqueued again later.
 *
 * That is desirable and is the reason to prefer this over a column: an
 * operator who fixes the cause — a bad token, a contact GHL rejected — gets
 * the milestone delivered on the customer's next build instead of having to
 * replay a row by hand. But it means "one-shot" is precisely ONE SUCCESSFUL
 * DELIVERY, not one attempt. A milestone that failed and later succeeds fires
 * the client's workflow then, late, which is the right trade; a milestone that
 * delivered can never fire it twice, which is the one that matters.
 *
 * ── OWNER ATTRIBUTION: NOT A BUG ────────────────────────────────────────────
 *
 * ANY TEAM MEMBER CAN COMPLETE THE INTAKE OR GENERATE A PLAN. Only the company
 * OWNER is a GHL contact (see `contact.ts` — a client requirement, and the
 * reason invited members are never resolved: tagging one would manufacture a
 * contact in a CRM the client pays for per contact, and drop a team member
 * into a buyer workflow).
 *
 * So the milestone is attributed to the OWNER's contact regardless of who
 * clicked, and `ghl_events.user_id` is the owner's profile id — not the
 * actor's. Whoever reads this code later will wonder whether that is a
 * mis-attribution, so: it is deliberate. A milestone is a fact about the
 * COMPANY ("this account has a plan now"), the workflows keyed off it address
 * the account holder, and the client's tag list has no concept of a member.
 * The person who actually clicked is kept in the payload as
 * `triggeredByUserId` so the admin screen can still answer "who did this",
 * which is the only question the actor's identity is useful for here.
 */

/* ------------------------------------------------------------------ *
 * The milestones
 * ------------------------------------------------------------------ */

/**
 * The two one-shot lifecycle milestones.
 *
 * NAMED FOR THE `event_type` COLUMN, not for the tag, so the mapping below is
 * the only place the two vocabularies meet. Both values are already in 044's
 * CHECK and in `GhlEventType`; the `satisfies` on the map is what keeps that
 * true if either list ever moves.
 *
 * `first_login` is NOT here even though it is the same shape. It is task 8 and
 * has its own call site and its own question of what "first" means; adding it
 * speculatively would mean a milestone nothing fires.
 */
export type GhlMilestone = "finished_intake" | "plan_generated";

/**
 * Milestone -> tag. The ONLY place these two tags are selected.
 *
 * `satisfies Record<GhlMilestone, string>` rather than a plain object so a new
 * milestone cannot be added to the union without a tag here.
 *
 * THE ROW'S `event_type` IS THE MILESTONE NAME VERBATIM, which is only legal
 * while `GhlMilestone` is a subset of `GhlEventType`. That is not asserted
 * separately because it is already load-bearing: `eventType: input.milestone`
 * at the enqueue below does not compile otherwise.
 */
const MILESTONE_TAGS = {
  finished_intake: TAG_FINISHED_INTAKE,
  plan_generated: TAG_PLAN_GENERATED,
} satisfies Record<GhlMilestone, string>;

/** Which route fired it. Debug context in the payload; never a decision input. */
export type MilestoneSource =
  /** `/api/intake/build` — the intake's single commit point. */
  | "intake_build"
  /** `/api/generate-plan` — first generation or a regeneration. */
  | "generate_plan";

/* ------------------------------------------------------------------ *
 * The dedupe key
 * ------------------------------------------------------------------ */

/**
 * The dedupe key shape: `company:{companyId}:{milestone}`.
 *
 * THE COMPANY IS THE SCOPE, AND THAT IS THE WHOLE MECHANISM. An event-scoped
 * key (a Stripe event id, a plan id, a timestamp) would be unique per run and
 * would therefore enqueue the milestone again on every rebuild — which is the
 * failure this producer exists to prevent. See the module header.
 *
 * `:{milestone}` IS LOAD-BEARING, exactly as `:cancellation` is in
 * `cancellationDedupeKey`. 044's unique index carries NO event_type, and both
 * milestones fire from the SAME request in `/api/intake/build` (it finishes the
 * intake and produces a plan in one commit). With a bare company id the second
 * insert would hit 23505, be reported as a `duplicate` — a success — and one
 * of the two tags would never be written, silently, forever, with no error
 * anywhere to find. `milestone.test.ts` asserts the two keys differ.
 *
 * THE `company:` PREFIX IS WHAT KEEPS THIS CLEAR OF THE STRIPE PRODUCERS.
 * Theirs are `stripe:{eventId}:...`; a Stripe event id is `evt_…` and could
 * never be a company uuid, but the namespace prefix means the keys cannot
 * collide even if that stopped being true. Tested across all four producers.
 */
export function milestoneDedupeKey(
  companyId: string,
  milestone: GhlMilestone
): string {
  return `company:${companyId}:${milestone}`;
}

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

export type MilestoneProducerResult =
  /**
   * A row was written, or this company has already reached this milestone.
   *
   * `duplicate` IS THE EXPECTED STEADY STATE HERE, not an edge case — every
   * regeneration after the first lands on it. Callers log it and carry on.
   */
  | { ok: true; outcome: "enqueued" | "duplicate"; milestone: GhlMilestone; tag: string }
  /** Nothing to do, and nothing wrong. */
  | { ok: true; outcome: "skipped"; reason: MilestoneSkipReason; detail?: string }
  /** Something went wrong that a human may want to know about. */
  | { ok: false; outcome: "failed"; reason: MilestoneFailReason; message: string };

export type MilestoneSkipReason =
  /** `ghlIsOn` is false. The common case today, and the cheapest path. */
  | "integration_off"
  /** The caller passed no usable company id. A bug in the caller. */
  | "no_company"
  /** No owner profile, or the owner has no email. A data gap. */
  | "no_owner_contact"
  /** The outbox declined (no email, nothing to do). Already logged there. */
  | "outbox_skipped";

export type MilestoneFailReason =
  /** The insert failed, or something threw. */
  "enqueue_failed";

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

export interface MilestoneProducerInput {
  milestone: GhlMilestone;
  /** The company whose OWNER becomes the GHL contact. */
  companyId: string;
  /**
   * The profile that actually triggered this, which may be a MEMBER.
   *
   * Recorded in the payload as `triggeredByUserId`, never written to
   * `ghl_events.user_id` — that column is the owner's, because the owner is
   * the contact. See the module header on owner attribution.
   */
  userId?: string | null;
  /** Which route fired it. Written to the payload so an admin can say. */
  source?: MilestoneSource;
  /**
   * Extra debug context merged into the payload: `regeneration`,
   * `initiativeCount`, `productCount` — whatever the call site has CHEAPLY in
   * hand at the moment it fires.
   *
   * MUST NOT CONTAIN A SECRET, and must not contain anything expensive to
   * compute: this runs after the customer's work is already committed and is
   * not worth a query. Merged FIRST below, so it cannot clobber the fields
   * `deliverGhlRow` reads.
   */
  context?: Record<string, unknown>;
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
 * Enqueue a one-shot milestone tag for a company.
 *
 * `db` must be a service-role client: `ghl_events` has RLS on with no
 * policies, and `profiles` / `companies` are not readable without it. Both
 * call sites already hold one at the point they fire (the intake build's own
 * `db`, generate-plan's `billingDb`).
 *
 * ORDER OF OPERATIONS IS AN ORDER OF COST, matching both siblings. Config
 * first and free, so the normal case today — the integration switched off —
 * does ZERO queries; `milestone.test.ts` asserts that with a spy, because it
 * is the only thing standing between a customer's spinner and three round
 * trips they gain nothing from. Then the company id, which is pure. Only then
 * the owner, which is two selects.
 *
 * THE DEDUPE IS NOT CHECKED FIRST, and that is deliberate: a pre-read would be
 * a third query that still could not decide the race, and the insert's 23505
 * answers the question authoritatively for free. The cost of a
 * second-and-later build is therefore two selects and one refused insert —
 * paid once per build, after the plan is already safe on disk.
 */
export async function enqueueMilestoneEvent(
  db: SupabaseClient,
  input: MilestoneProducerInput
): Promise<MilestoneProducerResult> {
  try {
    const config = input.config ?? (await loadGhlConfig(db));

    // OFF IS THE CHEAPEST PATH AND THE CURRENT ONE. No queries, no row, no log.
    if (!ghlIsOn(config)) {
      return { ok: true, outcome: "skipped", reason: "integration_off" };
    }

    const companyId =
      typeof input.companyId === "string" ? input.companyId.trim() : "";
    if (!companyId) {
      /*
       * Checked HERE rather than left to `resolveGhlOwnerContact` (which also
       * refuses, with `no_company`) only so the dedupe key below can never be
       * built from a blank id. `company::plan_generated` would be a single
       * key shared by every company that ever hit this path, and the first one
       * through would permanently block the rest.
       */
      return { ok: true, outcome: "skipped", reason: "no_company" };
    }

    const tag = MILESTONE_TAGS[input.milestone];

    // Never throws; reports a data gap as a reason, and has already logged it
    // in its own voice.
    const owner = await resolveGhlOwnerContact(db, companyId);
    if (!owner.ok) {
      /*
       * SKIP, NOT FAIL. Same call both siblings make: a company with no owner
       * profile is a data gap this route cannot fix, and re-logging it at
       * error level on a path the customer is watching would train people to
       * ignore that path's logs.
       */
      return {
        ok: true,
        outcome: "skipped",
        reason: "no_owner_contact",
        detail: owner.reason,
      };
    }

    const enqueued = await enqueueGhlEvent(db, {
      // THE MILESTONE NAME IS THE EVENT TYPE, and this line is the only thing
      // keeping that true: it stops compiling the moment the two unions part.
      eventType: input.milestone,
      companyId,
      // THE OWNER'S PROFILE, NOT THE ACTOR'S. See the module header; 044
      // cascades this column on profile delete, and the contact is the owner.
      userId: owner.contact.userId,
      contactEmail: owner.contact.email,
      /*
       * ADD ONLY, AND NEVER A REMOVAL. A milestone is a fact about the past:
       * finishing the intake cannot be un-finished, and a plan that existed
       * once existed. Nothing in this app may take either tag off, which is
       * also why there is no state machine here — there is no second state.
       */
      tagsAdd: [tag],
      tagsRemove: [],
      payload: {
        /*
         * The call site's context FIRST, so our own fields win on a key
         * collision. `deliverGhlRow` reads firstName / lastName / companyName
         * out of this payload to name the contact it upserts, and a call site
         * that happened to pass a `firstName` must not be able to rename the
         * client's contact.
         */
        ...(input.context ?? {}),
        milestone: input.milestone,
        source: input.source ?? null,
        /*
         * WHO CLICKED, which may be a member, kept beside the owner it was
         * attributed to so the admin screen can answer the question without
         * anyone concluding the attribution is a bug. A profile uuid, not a
         * session, a token or an address.
         */
        triggeredByUserId: input.userId ?? null,
        firstName: owner.contact.firstName,
        lastName: owner.contact.lastName,
        companyName: owner.contact.companyName,
        phone: owner.contact.phone,
      },
      /*
       * ALWAYS A KEY, unlike both siblings — where a key is optional because a
       * user-driven action that happened once should enqueue unconditionally.
       * Here the key IS the feature, so there is no mode without one.
       */
      dedupeKey: milestoneDedupeKey(companyId, input.milestone),
      // Passed through so the outbox does not re-read `app_settings`.
      config,
    });

    if (enqueued.outcome === "enqueued") {
      return { ok: true, outcome: "enqueued", milestone: input.milestone, tag };
    }
    if (enqueued.outcome === "duplicate") {
      /*
       * THE ONE-SHOT WORKING AS DESIGNED, and the steady state after the first
       * build: this company already has a pending or delivered row for this
       * milestone. Not a problem, and not worth a log line on a path that runs
       * on every regeneration.
       */
      return { ok: true, outcome: "duplicate", milestone: input.milestone, tag };
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
    /*
     * THE CATCH THAT MAKES THE DOC COMMENT TRUE, and here the stake is tokens
     * rather than money: both callers have just spent a real Anthropic call
     * and written the customer's plan. A throw out of this module would turn a
     * finished plan into a 500, and the customer would press the button again.
     */
    const message = errMessage(err);
    console.error("[ghl/milestone] producer threw:", message);
    return { ok: false, outcome: "failed", reason: "enqueue_failed", message };
  }
}
