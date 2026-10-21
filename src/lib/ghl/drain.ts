import type { SupabaseClient } from "@supabase/supabase-js";
import type { GhlClient, GhlFailure } from "@/lib/ghl/client";
import { ghlIsOn, type GhlConfig } from "@/lib/ghl/config";

/**
 * Delivering the GoHighLevel outbox.
 *
 * Producers only INSERT into `ghl_events` (see `outbox.ts`). This module is
 * the other half: claim a batch of pending rows, turn each one into GHL calls,
 * and write back a terminal status or a retry schedule.
 *
 * THE DECISION-MAKING LIVES HERE, NOT IN THE ROUTE. `drainGhlOutbox` takes its
 * database, its client, its config, its clock and its randomness as arguments,
 * so the whole thing runs in a unit test with no network, no environment and
 * no Supabase. The route is thirty lines of auth and JSON. The genuinely pure
 * pieces — the backoff schedule, the outcome classification, whether a row is
 * claimable — are exported separately and tested directly, because they are
 * the parts that are easy to get subtly wrong and impossible to notice:
 * a backoff that can land in the past is a hot loop against someone else's
 * API, and a terminal failure misread as retryable is the whole outbox
 * grinding against a revoked token.
 *
 * NEVER THROWS, AND ONE BAD ROW NEVER ABANDONS THE BATCH. Rows are processed
 * sequentially with a `try` each. A thrown row is left `pending` to be picked
 * up next time rather than taking the other twenty-four with it.
 */

/* ------------------------------------------------------------------ *
 * Policy constants
 * ------------------------------------------------------------------ */

/**
 * How many rows one invocation claims.
 *
 * TWENTY-FIVE, AND THE NUMBER IS A RATE LIMIT IN DISGUISE. The documented GHL
 * ceiling is 100 requests per 10 seconds per location
 * (https://marketplace.gohighlevel.com/docs/other/rate-limits/) and the client
 * has no rate limiter by design — its doc comment says so explicitly and names
 * the drain's batch size as the real control. Each row costs up to three calls
 * (upsert, add tags, remove tags), so 25 rows is at most 75 calls. That stays
 * under the ceiling even in the pathological case where every call returns
 * instantly and the entire batch lands inside one 10-second window, and it
 * leaves ~25 calls of headroom for the admin screen or a manual trigger
 * running at the same moment.
 *
 * The daily ceiling (200,000) is not a consideration at this volume: 25 rows
 * every few minutes is four orders of magnitude below it.
 *
 * Raising this is a decision about THEIR api, not about our throughput.
 *
 * "RUN THE CRON MORE OFTEN" IS NO LONGER AN OPTION, which is what this comment
 * used to advise. The outbox has no cron of its own: Hobby allows two cron
 * jobs and daily schedules only. Delivery is opportunistic instead — a small
 * batch after every enqueue (`schedule-drain.ts`) — with a full batch of this
 * size once a day from /api/cron/resume-paused as the safety net. So a backed
 * up queue is drained by more ENQUEUES, and the lever for a one-off backlog is
 * the admin screen's "Run drain now", not a schedule.
 */
export const GHL_DRAIN_BATCH_SIZE = 25;

/**
 * How many attempts a row gets before it is given up on.
 *
 * FIVE, which with the schedule below is four waits — 1m + 2m + 4m + 8m, so
 * roughly a quarter of an hour of outage (a little more with jitter) — before
 * the row is marked `failed`. Long enough to ride out a GHL deploy or a
 * rate-limit window; short enough that a genuinely broken row surfaces on the
 * admin screen while someone is still awake rather than retrying quietly for
 * a week.
 *
 * A `failed` row is not lost — 044's dedupe index is partial over
 * `status IN ('pending','delivered')` precisely so that a failed row can be
 * re-enqueued with the same key once a human has fixed the cause.
 */
export const GHL_DRAIN_MAX_ATTEMPTS = 5;

/**
 * The retry schedule: 1m, 2m, 4m, 8m, 16m, capped at an hour.
 *
 * EXPONENTIAL, BECAUSE THE FAILURES WE RETRY ARE CONGESTION AND OUTAGE. 429,
 * 5xx, a reset connection and a timeout all mean "too much traffic or not
 * enough service right now", and the one thing that reliably makes those
 * worse is a fleet of workers retrying on a fixed short interval. Doubling
 * means a GHL outage costs them a geometrically decreasing number of our
 * requests.
 *
 * BASE OF ONE MINUTE rather than a second or two: nothing here is
 * user-visible. A tag that lands a minute late is indistinguishable from one
 * that lands instantly, so there is no reason to spend a request on an
 * optimistic fast retry.
 *
 * CAPPED AT AN HOUR so a row cannot drift past the point where anyone is
 * still watching. With five attempts the cap is never actually reached; it is
 * there so that raising `maxAttempts` cannot accidentally schedule a retry for
 * next week.
 */
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 60 * 60_000;

/**
 * Jitter: up to +20%, added, never subtracted.
 *
 * WHY JITTER AT ALL. Rows enqueued by one event (a purchase writes a buyer
 * state and a founder tag) fail together and would otherwise retry in
 * lockstep forever, re-creating the same burst that failed. A spread of up to
 * twelve seconds on the first retry is enough to decorrelate them.
 *
 * WHY ADDITIVE AND ONE-SIDED, which is the part worth being careful about: a
 * symmetric jitter (±20%) subtracts time, and the floor of that is a retry
 * scheduled closer to now than intended — at a small enough base, in the past.
 * A `next_attempt_at` in the past is not a slow retry, it is an immediate one,
 * i.e. a hot loop against the API we are backing off from. Adding only means
 * the delay is always at least the nominal one.
 *
 * 20% ALSO KEEPS THE SCHEDULE FROM DOUBLING BACK. The step factor is 2 and
 * the worst case inflation is 1.2, so below the cap even a maximally jittered
 * attempt is shorter than an unjittered next one (1.2 < 2); at the cap every
 * step is equal, so the delay is non-decreasing either way. `drain.test.ts`
 * asserts both rather than trusting the arithmetic.
 */
const BACKOFF_JITTER = 0.2;

/**
 * How long a claimed row is held before another worker may take it.
 *
 * FIVE MINUTES, i.e. comfortably longer than any invocation can live. The
 * lease is written as a future `next_attempt_at` (see `claimGhlEventRow`), so
 * it doubles as the recovery window for a worker that dies mid-row: the row
 * becomes claimable again after this long, with its attempt already counted.
 *
 * Longer than the Vercel function limit on any plan, and longer than 25 rows
 * × the client's 10s timeout (250s) could possibly take, so a worker still
 * working cannot have its row stolen. Short enough that a crashed invocation
 * does not park a row for an hour.
 */
export const GHL_LEASE_MS = 5 * 60_000;

/**
 * Written to `last_error` on a dry-run row.
 *
 * ON A `delivered` ROW, last_error IS A NOTE, NOT AN ERROR. Reading it as a
 * failure would be reasonable and wrong, which is exactly why the marker says
 * what it says: anyone looking at this row in the admin screen or in psql must
 * be unable to mistake it for something that reached the client's CRM.
 */
export const GHL_DRY_RUN_MARKER =
  "DRY RUN - nothing was sent to GoHighLevel.";

/* ------------------------------------------------------------------ *
 * Row shape
 * ------------------------------------------------------------------ */

/** The columns the drain reads. A subset of `ghl_events` (migration 044). */
export interface GhlEventRow {
  id: string;
  contact_email: string;
  event_type: string;
  tags_add: string[] | null;
  tags_remove: string[] | null;
  attempts: number | null;
  status: string | null;
  next_attempt_at: string | null;
  payload: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ *
 * Pure: claimability
 * ------------------------------------------------------------------ */

/**
 * Is this row due?
 *
 * The same predicate the claim query and the lease update use, in one place so
 * the three cannot disagree. Exported because it is also the honest answer to
 * "why did the drain skip this row" on an admin screen.
 *
 * A MISSING OR UNPARSEABLE `next_attempt_at` READS AS DUE. The column is NOT
 * NULL with a default of now() in 044, so this is a shape that should not
 * exist; if it somehow does, the safe reading is "deliver it" — the delivery
 * path is idempotent (upsert by email, add a named tag), whereas treating it
 * as never-due would strand the row silently forever.
 */
export function isGhlRowClaimable(
  row: Pick<GhlEventRow, "status" | "next_attempt_at">,
  now: number
): boolean {
  if (row.status !== "pending") return false;
  if (!row.next_attempt_at) return true;
  const due = Date.parse(row.next_attempt_at);
  return Number.isFinite(due) ? due <= now : true;
}

/* ------------------------------------------------------------------ *
 * Pure: backoff
 * ------------------------------------------------------------------ */

export interface BackoffInput {
  /** Attempts INCLUDING the one that just failed, i.e. the post-lease value. */
  attempts: number;
  /** From a 429's `Retry-After`, when GHL actually sent one. */
  retryAfterMs?: number;
  /** Injected for determinism in tests. Expected to return [0, 1). */
  random?: () => number;
}

/**
 * How long until the next attempt, in milliseconds.
 *
 * `retryAfterMs` WINS, AND GETS NO JITTER. When GHL tells us when to come
 * back, their number is better information than our schedule — it is derived
 * from the window we actually tripped, and ignoring it in favour of a shorter
 * default earns another 429. No jitter on top because the value is already a
 * deadline rather than an estimate, and the client clamps it to a day
 * (`parseRetryAfterMs`), so it cannot park a row.
 *
 * Guaranteed by construction, and asserted in the tests:
 *   - never negative, so `now + result` is never in the past;
 *   - non-decreasing in `attempts`, even across the jitter range;
 *   - bounded by the cap (plus jitter) however large `attempts` gets, which
 *     also means an absurd `attempts` from a corrupted row cannot overflow
 *     into an Infinity date.
 */
export function computeGhlBackoffMs(input: BackoffInput): number {
  if (typeof input.retryAfterMs === "number" && Number.isFinite(input.retryAfterMs)) {
    // Clamped at zero: a negative header-derived value would schedule a retry
    // in the past, which is the one outcome this function must never produce.
    return Math.max(0, Math.round(input.retryAfterMs));
  }

  // `attempts` is 1-based by the time we are here (the lease bumped it before
  // delivery), so the first failure waits one base interval, not two.
  const step = Math.max(0, Math.floor(input.attempts) - 1);
  // Exponent clamped before the shift: 2 ** 1024 is Infinity, and
  // `Math.min(Infinity, cap)` works but `Infinity * jitter` does not read as
  // obviously safe to the next person.
  const growth = 2 ** Math.min(step, 20);
  const base = Math.min(BACKOFF_BASE_MS * growth, BACKOFF_CAP_MS);

  const random = input.random ?? Math.random;
  const draw = random();
  // A random source that misbehaves (NaN, out of range) must not produce a
  // negative delay. Clamped rather than trusted.
  const factor = Number.isFinite(draw) ? Math.min(Math.max(draw, 0), 1) : 0;

  return Math.round(base * (1 + BACKOFF_JITTER * factor));
}

/* ------------------------------------------------------------------ *
 * Pure: outcome classification
 * ------------------------------------------------------------------ */

/**
 * What a row's status becomes. Mirrors 044's CHECK, plus `retry`, which is
 * "stays pending with a later `next_attempt_at`" — not a status of its own.
 */
export type GhlRowDisposition = "delivered" | "skipped" | "failed" | "retry";

export interface ClassifyInput {
  failure: GhlFailure;
  /** Attempts INCLUDING this one. */
  attempts: number;
  maxAttempts: number;
}

/**
 * Turn a client failure into a disposition.
 *
 * TWO INPUTS, ONE OF THEM THE CLIENT'S OWN JUDGEMENT. `retryable` is the
 * client's single most important output and this function does not
 * second-guess it: a 401 is terminal because only a human can clear it, and
 * retrying it would mean the whole outbox beating against a revoked token
 * while the admin screen reassuringly says "pending".
 *
 * THE BUDGET CHECK IS `>=`, NOT `>`. `attempts` has already been incremented
 * by the lease, so when it equals `maxAttempts` the row has had every attempt
 * it was promised and the next schedule would be an attempt too many.
 */
export function classifyGhlFailure(input: ClassifyInput): GhlRowDisposition {
  if (!input.failure.retryable) return "failed";
  return input.attempts >= input.maxAttempts ? "failed" : "retry";
}

/* ------------------------------------------------------------------ *
 * Drain
 * ------------------------------------------------------------------ */

export interface DrainGhlOptions {
  /** Service-role client: `ghl_events` has RLS on with no policies. */
  db: SupabaseClient;
  config: GhlConfig;
  /**
   * Only needed when `config.status === 'live'`. Absent on a dry run BY
   * DESIGN — the dry-run config carries no credentials, so there is nothing to
   * build a client from, and that is the guarantee that a dry run cannot write.
   */
  client?: GhlClient | null;
  now?: number;
  batchSize?: number;
  maxAttempts?: number;
  /** Injected for deterministic jitter in tests. */
  random?: () => number;
}

export interface DrainGhlSummary {
  /** Rows the lease was actually won for. */
  claimed: number;
  delivered: number;
  /** Terminal success: the contact is not in the CRM. NOT a failure. */
  skipped: number;
  failed: number;
  /** Still pending, with a later `next_attempt_at`. */
  retrying: number;
  /** Rows another worker claimed first. Expected, not an error. */
  leaseLost: number;
  /** Why no work was done, when none was. */
  halted?: "integration_off" | "no_client" | "read_failed";
  /** Rows whose write-back failed. A human may need to look. */
  errors: { id: string; step: string; message: string }[];
  dryRun: boolean;
}

function emptySummary(dryRun: boolean): DrainGhlSummary {
  return {
    claimed: 0,
    delivered: 0,
    skipped: 0,
    failed: 0,
    retrying: 0,
    leaseLost: 0,
    errors: [],
    dryRun,
  };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Claim and deliver one batch.
 *
 * Returns counts and never throws. Safe to run concurrently with itself — see
 * `claimGhlEventRow` for how, and why that matters.
 */
export async function drainGhlOutbox(options: DrainGhlOptions): Promise<DrainGhlSummary> {
  const {
    db,
    config,
    client = null,
    now = Date.now(),
    batchSize = GHL_DRAIN_BATCH_SIZE,
    maxAttempts = GHL_DRAIN_MAX_ATTEMPTS,
    random,
  } = options;

  const dryRun = config.status === "dry_run";
  const summary = emptySummary(dryRun);

  // Switched off, unconfigured, or the settings were unreadable. `config.ts`
  // fails closed for a reason; this is the drain honouring it.
  if (!ghlIsOn(config)) {
    summary.halted = "integration_off";
    return summary;
  }

  /*
   * LIVE WITH NO CLIENT IS A WIRING BUG, AND IT HALTS RATHER THAN IMPROVISING.
   * Claiming rows we cannot deliver would burn their attempt budget and push
   * them an hour into the future for nothing. Leaving them pending costs one
   * idle invocation.
   */
  if (!dryRun && !client) {
    console.error("[ghl/drain] live config but no client was supplied — nothing claimed.");
    summary.halted = "no_client";
    return summary;
  }

  const claimTime = new Date(now).toISOString();

  let rows: GhlEventRow[];
  try {
    const { data, error } = await db
      .from("ghl_events")
      .select(
        "id, contact_email, event_type, tags_add, tags_remove, attempts, status, next_attempt_at, payload"
      )
      .eq("status", "pending")
      .lte("next_attempt_at", claimTime)
      // Oldest first, matching the partial index from 044
      // (next_attempt_at, created_at) WHERE status = 'pending'. FIFO also
      // means a row that keeps failing cannot starve newer ones forever: once
      // it backs off, it sorts behind them on due time.
      .order("created_at", { ascending: true })
      .limit(batchSize);

    if (error) {
      console.error("[ghl/drain] could not read the outbox:", error.message);
      summary.halted = "read_failed";
      return summary;
    }
    rows = (data ?? []) as unknown as GhlEventRow[];
  } catch (err: unknown) {
    console.error("[ghl/drain] outbox read threw:", errMessage(err));
    summary.halted = "read_failed";
    return summary;
  }

  /*
   * SEQUENTIAL, NOT `Promise.all`. Three reasons, in order of how much they
   * cost: the batch size is a rate-limit budget and firing 75 requests at once
   * is the one shape guaranteed to trip it; a row that fails fast should not
   * be racing twenty-four others for the same connection pool; and the
   * invocation can be killed at any moment, so the rows that did complete
   * should be a prefix rather than twenty-five half-finished attempts.
   */
  for (const row of rows) {
    try {
      const claimed = await claimGhlEventRow({ db, row, claimTime, now });
      if (!claimed.won) {
        // Another worker got there first. Expected whenever a manual trigger
        // overlaps the cron, and not an error.
        summary.leaseLost += 1;
        continue;
      }
      summary.claimed += 1;

      const attempts = claimed.attempts;
      const result = dryRun
        ? dryRunRow(row)
        : await deliverGhlRow({ client: client!, row });

      await finaliseGhlRow({ db, row, result, attempts, maxAttempts, now, random, summary });
    } catch (err: unknown) {
      /*
       * The per-row guard. A row left `pending` with its lease still running
       * becomes claimable again in five minutes; the alternative — one thrown
       * row taking the rest of the batch with it — is how an outbox stops
       * draining and nobody notices.
       */
      summary.errors.push({ id: row.id, step: "row", message: errMessage(err) });
      console.error("[ghl/drain] row", row.id, "threw:", errMessage(err));
    }
  }

  return summary;
}

/* ------------------------------------------------------------------ *
 * The lease
 * ------------------------------------------------------------------ */

/**
 * Take exclusive ownership of a row, or find out that we did not.
 *
 * THERE IS NO `processing` STATUS. 044's CHECK allows only pending, delivered,
 * failed and skipped, and adding one would need a hand-run migration. So the
 * claim is a LEASE expressed in the columns that already exist: bump
 * `attempts` and push `next_attempt_at` five minutes out, conditional on the
 * row still being pending and still due.
 *
 * WHY A PLAIN SELECT-THEN-DELIVER IS NOT ENOUGH, since it looks like it would
 * be. The cron can overlap itself (a slow invocation and the next schedule),
 * and the admin screen is going to get a manual "drain now" button. Two
 * workers that both SELECT the same pending row both deliver it. The GHL
 * writes themselves are idempotent, so the contact ends up correct — but
 * `attempts` is double-counted, the row is marked delivered twice, and we
 * spend twice the rate-limit budget on half the queue. Worse, the two can
 * interleave an add and a remove of the same tag and leave the contact in the
 * state the older row wanted.
 *
 * THE UPDATE IS THE ARBITER. Postgres serialises the two UPDATEs on the row;
 * the first flips `next_attempt_at` out of the `<= claimTime` window, so the
 * second matches nothing and PostgREST returns an empty array. ZERO ROWS BACK
 * MEANS SOMEBODY ELSE OWNS IT — do not deliver. That is also why `attempts`
 * can be computed in JS (`attempts + 1`) rather than needing an atomic
 * increment: only one writer ever gets past the predicate.
 *
 * `last_error` IS LEFT ALONE. It still holds why the previous attempt failed,
 * which is the only context an operator has while a row is mid-flight.
 */
export async function claimGhlEventRow(params: {
  db: SupabaseClient;
  row: GhlEventRow;
  /** The same instant the batch was selected with. */
  claimTime: string;
  now: number;
}): Promise<{ won: false } | { won: true; attempts: number }> {
  const { db, row, claimTime, now } = params;
  const attempts = (typeof row.attempts === "number" ? row.attempts : 0) + 1;

  const { data, error } = await db
    .from("ghl_events")
    .update({
      attempts,
      next_attempt_at: new Date(now + GHL_LEASE_MS).toISOString(),
    })
    .eq("id", row.id)
    // The two guards that make this a lease rather than an update. Both are
    // required: `status` stops us re-claiming a row a concurrent worker has
    // already finished, `next_attempt_at` stops us re-claiming one it has
    // merely leased.
    .eq("status", "pending")
    .lte("next_attempt_at", claimTime)
    .select("id");

  if (error) {
    // A failed claim is not a failed delivery. Nothing was sent, the row is
    // untouched, and the next invocation will try again.
    console.error("[ghl/drain] claim failed for", row.id, "-", error.message);
    return { won: false };
  }

  const claimedRows = Array.isArray(data) ? data : data ? [data] : [];
  return claimedRows.length > 0 ? { won: true, attempts } : { won: false };
}

/* ------------------------------------------------------------------ *
 * Delivery
 * ------------------------------------------------------------------ */

export type DeliverResult =
  | { kind: "delivered"; contactId: string | null; note?: string }
  | { kind: "skipped"; note: string }
  | { kind: "failed"; failure: GhlFailure };

/** Tags, defensive about a null array column and stray blanks. */
function tagList(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((t) => (typeof t === "string" ? t.trim() : "")).filter((t) => t !== "");
}

function payloadString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * Make the calls for one row.
 *
 * UPSERT FIRST, TAGS SECOND, AND NEVER TAGS ON THE UPSERT. The upsert body
 * accepts a `tags` array and using it would save a round trip, but GHL
 * documents it as OVERWRITING the contact's entire tag list. That list is
 * shared with the client's marketing team; sending our two or three lifecycle
 * tags would delete their segmentation. The client's `upsertContact` comment
 * carries the citation. This is the one place where fewer calls is the wrong
 * answer, which is why it is restated here at the call site.
 *
 * ADD BEFORE REMOVE. For a buyer-state transition the add and the remove lists
 * are disjoint by construction (`buyerTagTransition` guarantees it), so the
 * order cannot matter for correctness — but if an interrupted row has to be
 * half-done, "holds the new tag as well as an old one" is a better state for a
 * marketing workflow than "holds nothing".
 *
 * STOPS AT THE FIRST FAILURE. The row stays pending and the whole thing is
 * re-run on the next attempt; every call is idempotent, so replaying the ones
 * that already succeeded costs a request and changes nothing.
 */
export async function deliverGhlRow(params: {
  client: GhlClient;
  row: GhlEventRow;
}): Promise<DeliverResult> {
  const { client, row } = params;
  const add = tagList(row.tags_add);
  const remove = tagList(row.tags_remove);

  /*
   * `requireExistingContact` IS WHY `skipped` EXISTS. The app sub-account
   * creates contacts — a customer who has paid us belongs in the CRM — so the
   * normal path upserts. A producer can set this flag in the payload to mean
   * "tag them only if they are already there", which is how a suppression-style
   * event avoids manufacturing contacts in an account it does not own.
   *
   * 044 is explicit that `skipped` is a TERMINAL SUCCESS and must not read as
   * an error on the admin screen: "this person is not in that sub-account" is
   * a legitimate answer, not a fault, and retrying it would never change.
   */
  const requireExisting = row.payload?.requireExistingContact === true;

  let contactId: string;
  if (requireExisting) {
    const found = await client.findContactIdByEmail(row.contact_email);
    if (!found.ok) return { kind: "failed", failure: found };
    if (!found.data) {
      return {
        kind: "skipped",
        note: "The contact does not exist in GoHighLevel, and this event does not create one.",
      };
    }
    contactId = found.data;
  } else {
    const upserted = await client.upsertContact({
      email: row.contact_email,
      // Optional context only, and only when the producer happened to have it.
      // Absent keys are NOT sent: GHL reads a present null as "clear this
      // field", so a blind pass-through would wipe a name their team typed in.
      firstName: payloadString(row.payload, "firstName"),
      lastName: payloadString(row.payload, "lastName"),
      companyName: payloadString(row.payload, "companyName"),
    });
    if (!upserted.ok) return { kind: "failed", failure: upserted };
    contactId = upserted.data.contactId;
  }

  if (add.length > 0) {
    const added = await client.addTags(contactId, add);
    if (!added.ok) return { kind: "failed", failure: added };
  }

  if (remove.length > 0) {
    const removed = await client.removeTags(contactId, remove);
    if (!removed.ok) return { kind: "failed", failure: removed };
  }

  return { kind: "delivered", contactId };
}

/**
 * The dry run.
 *
 * RESOLVES EVERYTHING AND CALLS NOTHING. 044's argument for two switches
 * rather than one is that enabling the integration should exercise the whole
 * path — producers enqueue, the drain claims, leases and resolves — against
 * the real database and the real event stream with the client's CRM untouched.
 * This is the point where that promise is kept: no client is instantiated, so
 * there is nothing to call even by accident.
 *
 * The row is marked `delivered` (there is nothing left to do with it) and
 * carries a marker in both `last_error` and `payload` so that neither an
 * operator nor a later query can mistake it for a real write.
 */
export function dryRunRow(row: GhlEventRow): DeliverResult {
  const add = tagList(row.tags_add);
  const remove = tagList(row.tags_remove);

  // The log line is the actual deliverable of a dry run. Email included
  // because an operator checking a dry run is checking WHO would be tagged;
  // no credential is logged, which is the rule that matters.
  console.log(
    "[ghl/drain] DRY RUN",
    JSON.stringify({
      id: row.id,
      eventType: row.event_type,
      contact: row.contact_email,
      wouldAdd: add,
      wouldRemove: remove,
    })
  );

  return { kind: "delivered", contactId: null, note: GHL_DRY_RUN_MARKER };
}

/* ------------------------------------------------------------------ *
 * Write-back
 * ------------------------------------------------------------------ */

/**
 * Record what happened to one row.
 *
 * THE OUTCOME MATRIX, in one place:
 *
 *   every call ok          -> delivered, delivered_at stamped
 *   dry run                -> delivered, delivered_at stamped, marker written
 *   contact absent         -> skipped, delivered_at stamped (TERMINAL SUCCESS)
 *   retryable, budget left -> stays pending, next_attempt_at = now + backoff
 *   retryable, budget gone -> failed
 *   terminal failure       -> failed, immediately, no further attempts
 *
 * `delivered_at` IS STAMPED ON `skipped` TOO, which looks odd until you read
 * 044's comment on the column: it means "when the row reached a terminal
 * state", and skipped is terminal. Leaving it null would make a skipped row
 * indistinguishable from an in-flight one.
 */
async function finaliseGhlRow(params: {
  db: SupabaseClient;
  row: GhlEventRow;
  result: DeliverResult;
  attempts: number;
  maxAttempts: number;
  now: number;
  random?: () => number;
  summary: DrainGhlSummary;
}): Promise<void> {
  const { db, row, result, attempts, maxAttempts, now, random, summary } = params;
  const stamp = new Date(now).toISOString();

  let patch: Record<string, unknown>;
  let disposition: GhlRowDisposition;

  if (result.kind === "delivered") {
    disposition = "delivered";
    patch = {
      status: "delivered",
      delivered_at: stamp,
      // Cleared on a real delivery so a row that succeeded after two failures
      // does not keep showing the old error; set to the marker on a dry run.
      last_error: result.note ?? null,
      ...(result.note
        ? { payload: { ...(row.payload ?? {}), ghl_dry_run: true } }
        : {}),
    };
  } else if (result.kind === "skipped") {
    disposition = "skipped";
    patch = { status: "skipped", delivered_at: stamp, last_error: result.note };
  } else {
    disposition = classifyGhlFailure({ failure: result.failure, attempts, maxAttempts });
    const detail = `${result.failure.reason}: ${result.failure.message}`;

    if (disposition === "failed") {
      patch = {
        status: "failed",
        // delivered_at stays null: 044 reserves it for delivered and skipped.
        last_error: result.failure.retryable
          ? `${detail} (gave up after ${attempts} attempts)`
          : detail,
      };
    } else {
      const waitMs = computeGhlBackoffMs({
        attempts,
        // Honoured over our own schedule when GHL told us when to come back.
        ...(typeof result.failure.retryAfterMs === "number"
          ? { retryAfterMs: result.failure.retryAfterMs }
          : {}),
        random,
      });
      patch = {
        // Explicit rather than implied: the lease already moved
        // `next_attempt_at`, and this overwrites it with the real schedule.
        status: "pending",
        next_attempt_at: new Date(now + waitMs).toISOString(),
        last_error: detail,
      };
    }
  }

  const { error } = await db.from("ghl_events").update(patch).eq("id", row.id);

  if (error) {
    /*
     * The delivery happened; only the bookkeeping failed. The row's lease
     * expires in five minutes and it will be re-delivered — safe, because
     * every GHL call we make is idempotent, and the honest alternative
     * (pretending it is finished) would lose a tag for good if the write-back
     * failure was really a row that never got updated.
     */
    summary.errors.push({ id: row.id, step: `finalise:${disposition}`, message: error.message });
    console.error("[ghl/drain] could not record", disposition, "for", row.id, "-", error.message);
    return;
  }

  if (disposition === "delivered") summary.delivered += 1;
  else if (disposition === "skipped") summary.skipped += 1;
  else if (disposition === "failed") summary.failed += 1;
  else summary.retrying += 1;
}
