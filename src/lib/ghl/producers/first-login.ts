import type { SupabaseClient } from "@supabase/supabase-js";
import { ghlIsOn, loadGhlConfig, type GhlConfig } from "@/lib/ghl/config";
import { resolveGhlOwnerContact } from "@/lib/ghl/contact";
import { enqueueGhlEvent } from "@/lib/ghl/outbox";
import { TAG_FIRST_LOGIN } from "@/lib/ghl/tags";
import { isMissingColumnError } from "@/lib/supabase/missing-column";

/**
 * The first-login producer: "we have seen this person authenticated for the
 * first time ever — tell GoHighLevel."
 *
 * THE FOURTH SIBLING of `producers/subscription.ts`, `producers/cancellation.ts`
 * and `producers/milestone.ts`, deliberately shaped the same way: same
 * never-throws contract, same config-first ordering by cost, same discriminated
 * result, same stable skip/fail reasons, same enqueue-only reach, same "no
 * secrets in the payload" rule. Read `milestone.ts` first — this is the same
 * one-shot problem, and the reasoning it spells out is not repeated.
 *
 * ── WHAT "FIRST LOGIN" EVEN MEANS HERE ──────────────────────────────────────
 *
 * THERE IS NO LOGIN EVENT IN THIS APP. There is a sign-in form, a 2FA code,
 * and a `sam_2fa` HMAC cookie that trusts the device for THIRTY DAYS. A
 * returning customer on a trusted device never touches `/auth/verify-code`,
 * and a customer who confirms their signup email is granted 2FA trust by that
 * link — so neither route is a place every person reliably passes through, and
 * neither is a place a FIRST login is reliably observable. What the app
 * actually has is a stream of authenticated requests.
 *
 * So the honest definition, and the one this module implements, is: THE FIRST
 * TIME WE EVER SAW THIS PERSON AUTHENTICATED. The call site is `GET /api/me` —
 * the one request every signed-in user makes on every page load, because
 * `AuthProvider` cannot render anything without it, and one of the few routes
 * exempt from the 2FA gate by exact match. If a person has an authenticated
 * session at all, they have been through this route.
 *
 * THAT CALL SITE IS A HOT PATH, AND IT DICTATES THE DESIGN. `/api/me` runs on
 * every page load, and a failure there is an app that cannot render. Hence:
 *
 *   - `ghl_first_login_at` is read as ONE MORE COLUMN on the SELECT the route
 *     already makes, never as a query of its own;
 *   - the decision is a PURE function (`shouldFireFirstLogin`) over data the
 *     route already holds, so after the first time the entire cost of this
 *     feature is a null check on a value already in memory;
 *   - nothing below this module's own entry point is reached unless the column
 *     is actually null.
 *
 * ── THE THREE CONDITIONS ────────────────────────────────────────────────────
 *
 * 1. `ghl_first_login_at IS NULL`. One-shot per person, forever. 044 added the
 *    column for exactly this and documents it as "set once and never cleared,
 *    which also keeps it correct after outbox rows are pruned".
 *
 * 2. THE PROFILE'S ROLE IS `owner`. Only the main user is a GHL contact — see
 *    `contact.ts`, where this is a client requirement rather than an
 *    optimisation. A team member's first login must not fire the tag, and must
 *    not MANUFACTURE a contact: the drain upserts from the row's email, so an
 *    event for a member would create a second contact in a CRM the client pays
 *    for per contact and drop a non-buyer into an onboarding workflow.
 *
 * 3. *** NOT IMPERSONATING. *** This is the condition that is easiest to
 *    forget and the most expensive to get wrong, so it is stated loudly. A
 *    super admin who opens a customer's account from `/admin/companies` is
 *    signed in AS that customer: same session, same profile row, same
 *    `/api/me`. Without this check, a support visit to a brand-new account
 *    would stamp that customer's first login and fire the welcome workflow
 *    behind it — an email from the client's domain, to the client's customer,
 *    triggered by the client's own staff looking at a screen. There is no
 *    undo. `/api/me` already resolves impersonation (it is the authoritative
 *    source for the exit banner), so the signal is free at the call site and
 *    is passed in rather than re-derived here.
 *
 * ── WHY THE STAMP, AND NOT ONLY THE DEDUPE KEY ──────────────────────────────
 *
 * The milestone producer gets away with the dedupe key alone because its call
 * sites are rare (an intake build, a plan generation). This one runs on every
 * page load, so "enqueue and let the unique index refuse it" would mean an
 * INSERT PER PAGE LOAD, forever, for every customer. The column is the cheap
 * guard; the key is the correctness guard. Both, not either.
 */

/* ------------------------------------------------------------------ *
 * The decision
 * ------------------------------------------------------------------ */

/**
 * The owner role, spelled once.
 *
 * Same string `resolveGhlOwnerContact` filters on, and the two must not drift:
 * a decision that said "fire" for a role the contact lookup then refuses to
 * resolve would burn the one-shot on nothing.
 */
const OWNER_ROLE = "owner";

/** Why the tag is or is not firing. Stable strings: logged, pinned in tests. */
export type FirstLoginDecisionReason =
  /** Owner, never stamped, not impersonated. The one case that fires. */
  | "first_login"
  /** `ghl_first_login_at` is already set. The steady state for everybody. */
  | "already_stamped"
  /** An invited team member (or an admin profile). Never a GHL contact. */
  | "not_owner"
  /** A super admin is viewing this account. Not the customer's first login. */
  | "impersonating";

export interface FirstLoginDecision {
  fire: boolean;
  reason: FirstLoginDecisionReason;
}

export interface FirstLoginDecisionInput {
  /** `profiles.role`. Anything other than "owner" declines. */
  role: string | null | undefined;
  /**
   * `profiles.ghl_first_login_at` as read. A timestamp string, a Date, or null.
   *
   * ANY NON-NULL VALUE COUNTS AS STAMPED, including an unparseable one. We
   * never compare it to a clock — the question is "has this ever fired", not
   * "when" — so there is nothing to parse and nothing to get wrong.
   */
  firstLoginAt: string | Date | null | undefined;
  /** Is a super admin signed in as this person right now? See condition 3. */
  isImpersonating: boolean;
}

/**
 * Should the first-login tag fire for this person, on this request?
 *
 * PURE. No database, no network, no cookies — the whole decision table is a
 * unit test rather than an integration one, which is the point of pulling it
 * out of the producer.
 *
 * ORDER OF THE CHECKS IS THE ORDER OF CERTAINTY, AND IT IS NOT ARBITRARY.
 * `already_stamped` is read FIRST because it is the steady state for every
 * person after their first page load, so it is both the commonest answer and
 * the one the hot path wants to reach soonest. Impersonation is read BEFORE
 * the role, so an admin viewing an owner's account is reported as
 * `impersonating` rather than as a would-be fire — the reason string is what
 * ends up in a log when someone asks why a tag did not fire, and "an admin was
 * in there" is the useful answer.
 *
 * NOTE WHAT IS NOT HERE: no company id, and no entitlement. A first login is a
 * fact about a PERSON. The company only matters later, as the route to the
 * owner's contact details, and whether they are paying is the buyer tag's
 * business, not this one's.
 */
export function shouldFireFirstLogin(
  input: FirstLoginDecisionInput
): FirstLoginDecision {
  if (input.firstLoginAt !== null && input.firstLoginAt !== undefined) {
    return { fire: false, reason: "already_stamped" };
  }

  // BEFORE the role check, deliberately: see above.
  if (input.isImpersonating) {
    return { fire: false, reason: "impersonating" };
  }

  const role = typeof input.role === "string" ? input.role.trim().toLowerCase() : "";
  if (role !== OWNER_ROLE) {
    return { fire: false, reason: "not_owner" };
  }

  return { fire: true, reason: "first_login" };
}

/* ------------------------------------------------------------------ *
 * The dedupe key
 * ------------------------------------------------------------------ */

/**
 * The dedupe key shape: `profile:{userId}:first_login`.
 *
 * PERSON-SCOPED, WHICH IS THE ONE WAY THIS DIFFERS FROM `milestoneDedupeKey`.
 * A first login belongs to a human, not to an account: the owner of a
 * five-person company has one, the other four never fire at all, and a company
 * cannot have two first logins. So the namespace is `profile:` over
 * `profiles.id` rather than `company:` over `companies.id`.
 *
 * THE NAMESPACE PREFIX IS WHAT GUARANTEES NON-COLLISION, and 044's unique
 * index makes that load-bearing: it is on `(sub_account, dedupe_key)` with NO
 * `event_type` in it, so a key shared with another producer would have the
 * second insert hit 23505, be reported as a `duplicate` — a SUCCESS — and one
 * of the two tags would never be written, silently, with no error to find.
 * There are now four producers and four namespaces:
 *
 *   `profile:{userId}:first_login`          — here
 *   `company:{companyId}:{milestone}`       — milestone
 *   `stripe:{eventId}:buyer_state`          — subscription
 *   `stripe:{eventId}:cancellation`         — cancellation
 *
 * The prefixes alone make a collision impossible, and the `:first_login`
 * suffix means this stays true if a second person-level tag is ever added over
 * the same id. `first-login.test.ts` asserts it against all three siblings.
 */
export function firstLoginDedupeKey(userId: string): string {
  return `profile:${userId}:first_login`;
}

/* ------------------------------------------------------------------ *
 * Result
 * ------------------------------------------------------------------ */

export type FirstLoginProducerResult =
  /** A row was written, or one already existed for this person. */
  | { ok: true; outcome: "enqueued" | "duplicate"; tag: string }
  /** Nothing to do, and nothing wrong. */
  | { ok: true; outcome: "skipped"; reason: FirstLoginSkipReason; detail?: string }
  /** Something went wrong that a human may want to know about. */
  | { ok: false; outcome: "failed"; reason: FirstLoginFailReason; message: string };

export type FirstLoginSkipReason =
  /** `ghlIsOn` is false. The common case today, and the cheapest path. */
  | "integration_off"
  /** The pure decision declined. `detail` carries which of the three. */
  | "not_eligible"
  /** No usable profile id, so there is nothing to stamp. A caller bug. */
  | "no_user"
  /** No owner profile, or the owner has no email. A data gap. */
  | "no_owner_contact"
  /**
   * THE RACE, AND THE EXPECTED OUTCOME OF IT. The conditional stamp matched
   * zero rows, so a concurrent request got there first. Not an error.
   */
  | "stamp_lost"
  /** Migration 044 is not applied, so there is no column to stamp. */
  | "unavailable"
  /** The outbox declined (no email, nothing to do). Already logged there. */
  | "outbox_skipped";

export type FirstLoginFailReason =
  /** The stamp update errored. Nothing was enqueued. */
  | "stamp_failed"
  /** The insert failed, or something threw. */
  | "enqueue_failed";

/* ------------------------------------------------------------------ *
 * Input
 * ------------------------------------------------------------------ */

/** Which call site. Debug context in the payload; never a decision input. */
export type FirstLoginSource =
  /** `GET /api/me` — the only one, and the only place this is observable. */
  "api_me";

export interface FirstLoginProducerInput extends FirstLoginDecisionInput {
  /** `profiles.id`. The person being stamped, and the dedupe scope. */
  userId: string;
  /**
   * `profiles.company_id`. The route to the owner's contact details.
   *
   * Nullable because `/api/me` tolerates a profile with no company (it reports
   * `profileMissing` / a null `companyId` rather than failing), and a person
   * with no company has no contact to resolve.
   */
  companyId?: string | null;
  source?: FirstLoginSource;
  /**
   * Extra debug context merged into the payload. MUST NOT CONTAIN A SECRET,
   * and must not contain anything expensive to compute: this runs inside the
   * request that renders every page.
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
 * Enqueue the one-shot first-login tag for a person.
 *
 * `db` must be a service-role client: `ghl_events` has RLS on with no policies,
 * and `profiles` / `companies` are not readable without it. `/api/me` already
 * holds one — it reads the profile with the service role on purpose, so that
 * RLS can never be the reason a user fails to load their own account.
 *
 * ORDER OF OPERATIONS IS AN ORDER OF COST, matching all three siblings. Config
 * first and free, so the normal case today — the integration switched off —
 * does ZERO queries; `first-login.test.ts` asserts that with a spy, because
 * this is the one producer whose call site runs on every page load. Then the
 * pure decision, which is where every request after the first one exits. Only
 * then the owner, which is two selects, and the stamp, which is one update.
 *
 * ── THE OWNER LOOKUP COMES BEFORE THE STAMP, AND THAT IS A CHOICE ───────────
 *
 * The stamp is the one-shot, so whatever happens after it cannot be retried.
 * Resolving the contact first means a DATA GAP — an owner row with no usable
 * email — does not consume the one chance this person gets: nothing is
 * stamped, and the next page load tries again, which is what an operator
 * fixing the address would expect. The cost is two selects per page load for
 * as long as the gap persists, which is the right way round: a tag that is
 * late is recoverable, a tag that can never fire is not.
 *
 * ── STAMP, THEN ENQUEUE ─────────────────────────────────────────────────────
 *
 * The two orderings have different failure modes and neither is free:
 *
 *   ENQUEUE THEN STAMP risks a DOUBLE ENQUEUE (two requests both insert before
 *   either stamps). The dedupe key makes that safe at the database — the second
 *   insert hits 23505 and is reported as `duplicate` — so correctness survives.
 *   What does not survive is the hot path: if the stamp then fails for any
 *   reason, every subsequent page load re-reads a null column, resolves the
 *   owner and attempts an insert, forever. A per-page-load write against
 *   `/api/me` is not a cost this route can carry.
 *
 *   STAMP THEN ENQUEUE risks a LOST TAG (the stamp lands, the insert fails,
 *   and the null that would have retried is gone). That is one missed
 *   marketing workflow for one person, visible in the logs, and recoverable by
 *   hand — an operator clears the column and the next page load fires it.
 *
 * So: STAMP FIRST. The hot path can never double-write, and the dedupe key
 * stays as the second line of defence for the window between the two
 * statements — if a request dies after stamping, or if two somehow both got
 * past the conditional update, the unique index still admits exactly one row.
 * Belt and braces, in that order.
 *
 * NOTE WHAT WE DO NOT DO ON AN ENQUEUE FAILURE: clear the stamp. It is
 * tempting and it is wrong — un-stamping re-opens the race this whole
 * mechanism exists to close, and a flapping insert could then fire the welcome
 * workflow more than once. A missing tag is the cheaper mistake.
 *
 * ── THE STAMP IS THE ARBITER, NOT THE READ ──────────────────────────────────
 *
 * The null that got us here was read from a SELECT that may be milliseconds
 * stale, and a customer's browser opens several pages at once — two concurrent
 * `/api/me` calls both seeing null is ordinary, not exotic. So the read decides
 * only whether to BOTHER; the conditional update decides whether we WON. It
 * carries `.is("ghl_first_login_at", null)` in the WHERE and `.select("id")`,
 * and Postgres serialises the two updates on the row: the winner flips the
 * column out of the predicate and the loser matches nothing. ZERO ROWS BACK
 * MEANS SOMEBODY ELSE OWNS IT — do not enqueue. Same idiom, and the same
 * sentence, as `claimGhlEventRow`'s lease in `drain.ts` and
 * `stampCallUnlockForNewCompany` in `call-gate-settings.ts`.
 */
export async function enqueueFirstLoginEvent(
  db: SupabaseClient,
  input: FirstLoginProducerInput
): Promise<FirstLoginProducerResult> {
  try {
    const config = input.config ?? (await loadGhlConfig(db));

    // OFF IS THE CHEAPEST PATH AND THE CURRENT ONE. No queries, no row, no log.
    if (!ghlIsOn(config)) {
      return { ok: true, outcome: "skipped", reason: "integration_off" };
    }

    const decision = shouldFireFirstLogin(input);
    if (!decision.fire) {
      /*
       * WHERE EVERY REQUEST AFTER THE FIRST ONE EXITS, and where every team
       * member and every impersonated page load exits always. Pure, no
       * queries, and not worth a log line on a path that runs on every page.
       */
      return {
        ok: true,
        outcome: "skipped",
        reason: "not_eligible",
        detail: decision.reason,
      };
    }

    const userId = typeof input.userId === "string" ? input.userId.trim() : "";
    if (!userId) {
      /*
       * Checked so the dedupe key below can never be built from a blank id.
       * `profile::first_login` would be a single key shared by everybody who
       * ever hit this path, and the first one through would permanently block
       * the rest — the same trap `enqueueMilestoneEvent` guards for companies.
       */
      return { ok: true, outcome: "skipped", reason: "no_user" };
    }

    // Never throws; reports a data gap as a reason, and has already logged it
    // in its own voice. BEFORE the stamp — see the doc comment.
    const owner = await resolveGhlOwnerContact(db, input.companyId);
    if (!owner.ok) {
      /*
       * SKIP, NOT FAIL. Same call all three siblings make: a company with no
       * owner profile is a data gap this route cannot fix, and re-logging it at
       * error level on the path that renders every page would train people to
       * ignore that path's logs.
       */
      return {
        ok: true,
        outcome: "skipped",
        reason: "no_owner_contact",
        detail: owner.reason,
      };
    }

    const stamp = await stampFirstLogin(db, userId);
    if (stamp !== "won") return stamp.result;

    const enqueued = await enqueueGhlEvent(db, {
      eventType: "first_login",
      /*
       * BOTH IDS, even though 044 calls first login a person-level event whose
       * `company_id` may be null. We know the company here, it is how we found
       * the contact, and carrying it means the admin "what has this company
       * triggered" view (idx_ghl_events_company_created) can show it.
       */
      companyId: input.companyId ?? null,
      /*
       * THE OWNER'S PROFILE ID, which — unlike in the milestone producer — is
       * also the actor's: the decision only fires for role `owner`, so the
       * person who triggered this IS the contact. There is no attribution
       * question to answer here.
       */
      userId: owner.contact.userId ?? userId,
      contactEmail: owner.contact.email,
      /*
       * ADD ONLY, AND NEVER A REMOVAL. A first login is a fact about the past:
       * it cannot be un-happened, so there is no second state and no state
       * machine. Nothing in this app may take this tag off.
       */
      tagsAdd: [TAG_FIRST_LOGIN],
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
        reason: decision.reason,
        source: input.source ?? null,
        /*
         * NO SECRETS, AND IN PARTICULAR NOTHING FROM THE SESSION. The call
         * site is a route holding cookies, an access token and an
         * impersonation ticket; this column is rendered on an admin screen and
         * sits in every backup. The only thing recorded about impersonation is
         * that there was none — had there been, we would not be here.
         */
        impersonated: false,
        firstName: owner.contact.firstName,
        lastName: owner.contact.lastName,
        companyName: owner.contact.companyName,
      },
      /*
       * ALWAYS A KEY. The stamp already decided we are the only request that
       * gets here, so this is the second line of defence rather than the
       * mechanism — see the doc comment on ordering.
       */
      dedupeKey: firstLoginDedupeKey(userId),
      // Passed through so the outbox does not re-read `app_settings`.
      config,
    });

    if (enqueued.outcome === "enqueued") {
      return { ok: true, outcome: "enqueued", tag: TAG_FIRST_LOGIN };
    }
    if (enqueued.outcome === "duplicate") {
      /*
       * THE SECOND LINE OF DEFENCE DOING ITS JOB: this person already has a
       * pending or delivered first-login row, even though we won the stamp —
       * a request that stamped and then died before inserting, or a column
       * cleared by hand. Not a problem, and the tag is already on its way.
       */
      return { ok: true, outcome: "duplicate", tag: TAG_FIRST_LOGIN };
    }
    if (enqueued.outcome === "skipped") {
      return {
        ok: true,
        outcome: "skipped",
        reason: "outbox_skipped",
        detail: enqueued.reason,
      };
    }

    /*
     * THE LOST-TAG CASE, named in the doc comment and logged at error level
     * because it is the one outcome a human can act on: the stamp is spent and
     * no row exists. Clearing `profiles.ghl_first_login_at` for this id makes
     * the next page load fire it again.
     */
    console.error(
      `[ghl/first-login] stamped ${userId} but the enqueue failed, so the tag ` +
        `will not be sent: ${enqueued.message}`
    );
    return {
      ok: false,
      outcome: "failed",
      reason: "enqueue_failed",
      message: enqueued.message,
    };
  } catch (err: unknown) {
    /*
     * THE CATCH THAT MAKES THE CONTRACT TRUE, and here the stake is the whole
     * app: `/api/me` is what `AuthProvider` waits on before rendering
     * anything, so a throw out of this module would be a blank screen for
     * every signed-in customer, caused by a marketing tag.
     */
    const message = errMessage(err);
    console.error("[ghl/first-login] producer threw:", message);
    return { ok: false, outcome: "failed", reason: "enqueue_failed", message };
  }
}

/* ------------------------------------------------------------------ *
 * The stamp
 * ------------------------------------------------------------------ */

/**
 * Claim this person's one first login, conditionally.
 *
 * Returns the literal `"won"` on success, or a wrapped producer result for the
 * caller to return verbatim — the same shape the drain's lease uses, so the
 * win is impossible to confuse with a skip at the call site.
 *
 * A MISSING COLUMN IS A SKIP, NOT A FAILURE. 044 IS applied in the live
 * database, but migrations here are run BY HAND and a release routinely ships
 * ahead of one. Reporting `unavailable` quietly (no log) is the same stance
 * `loadGhlConfig` and `stampCallUnlockForNewCompany` take: an unapplied
 * migration is expected and must not fill the logs of the route that renders
 * every page.
 */
async function stampFirstLogin(
  db: SupabaseClient,
  userId: string
): Promise<"won" | { result: FirstLoginProducerResult }> {
  const { data, error } = await db
    .from("profiles")
    .update({ ghl_first_login_at: new Date().toISOString() })
    .eq("id", userId)
    // THE ARBITER. Without this predicate the update always matches and two
    // concurrent requests would both enqueue; with it, exactly one can.
    .is("ghl_first_login_at", null)
    // Required, not decoration: PostgREST returns the affected rows only when
    // asked, and "how many rows did I change" is the entire answer here.
    .select("id");

  if (error) {
    if (isMissingColumnError(error)) {
      return { result: { ok: true, outcome: "skipped", reason: "unavailable" } };
    }
    console.error("[ghl/first-login] stamp failed:", error.message);
    return {
      result: {
        ok: false,
        outcome: "failed",
        reason: "stamp_failed",
        message: error.message,
      },
    };
  }

  const rows = Array.isArray(data) ? data : data ? [data] : [];
  if (rows.length === 0) {
    /*
     * SOMEBODY ELSE WON, and that is the system working. Expected whenever a
     * browser opens two pages at once on a brand-new account. Not logged: it
     * is not an error, and it happens at most once per person.
     */
    return { result: { ok: true, outcome: "skipped", reason: "stamp_lost" } };
  }

  return "won";
}
