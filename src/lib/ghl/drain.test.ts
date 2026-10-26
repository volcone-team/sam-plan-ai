import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  drainGhlOutbox,
  computeGhlBackoffMs,
  classifyGhlFailure,
  isGhlRowClaimable,
  GHL_DRAIN_BATCH_SIZE,
  GHL_DRAIN_MAX_ATTEMPTS,
  GHL_LEASE_MS,
  GHL_DRY_RUN_MARKER,
  type GhlEventRow,
} from "./drain";
import type { GhlClient, GhlFailure } from "./client";
import type { GhlConfig } from "./config";
import { TAG_FOUNDER, TAG_PLAN_GENERATED } from "./tags";

/* ── Configs ─────────────────────────────────────────────────────────────── */

const LIVE: GhlConfig = {
  status: "live",
  available: true,
  env: { locationId: true, token: true },
  mayWrite: true,
  credentials: { locationId: "loc_1", token: "pit-secret-value" },
};
const DRY: GhlConfig = {
  status: "dry_run",
  available: true,
  env: { locationId: true, token: true },
  mayWrite: false,
};
const OFF: GhlConfig = {
  status: "disabled",
  available: true,
  env: { locationId: true, token: true },
  mayWrite: false,
};

/* ── Fake Supabase ───────────────────────────────────────────────────────────
 * Richer than config.test.ts's because the drain does three different shapes
 * of query: the batch select, the conditional lease update (which reads back
 * `select('id')`), and the final write-back (which does not).
 */
type Filter = [string, string, unknown];
interface Op {
  table: string;
  kind: "select" | "update";
  values?: Record<string, unknown>;
  filters: Filter[];
  limit?: number;
}

interface DbState {
  rows: GhlEventRow[];
  /** Per row id: does the lease update match a row? Default: yes. */
  lease: Record<string, "won" | "lost" | "error">;
  selectError: { message: string } | null;
  finaliseError: Record<string, { message: string }>;
  /** Everything that was asked, in order. */
  ops: Op[];
  /** The write-back patches, by row id. */
  patches: { id: string; values: Record<string, unknown> }[];
  leaseCalls: { id: string; values: Record<string, unknown>; filters: Filter[] }[];
}

function freshState(rows: GhlEventRow[] = []): DbState {
  return {
    rows,
    lease: {},
    selectError: null,
    finaliseError: {},
    ops: [],
    patches: [],
    leaseCalls: [],
  };
}

function idOf(filters: Filter[]): string {
  const hit = filters.find(([op, col]) => op === "eq" && col === "id");
  return String(hit?.[2] ?? "");
}

function makeDb(state: DbState): SupabaseClient {
  const db = {
    from(table: string) {
      const op: Op = { table, kind: "select", filters: [] };
      state.ops.push(op);

      const builder: Record<string, unknown> = {};

      const chain = (name: string) => (col: unknown, value?: unknown) => {
        op.filters.push([name, String(col), value]);
        return builder;
      };

      builder.eq = chain("eq");
      builder.lte = chain("lte");
      builder.order = () => builder;

      builder.update = (values: Record<string, unknown>) => {
        op.kind = "update";
        op.values = values;
        return builder;
      };

      builder.select = (cols?: string) => {
        if (op.kind === "update") {
          // The lease: an update that reads back the ids it matched.
          const id = idOf(op.filters);
          state.leaseCalls.push({ id, values: op.values ?? {}, filters: op.filters });
          const outcome = state.lease[id] ?? "won";
          if (outcome === "error") {
            return Promise.resolve({ data: null, error: { message: "claim exploded" } });
          }
          return Promise.resolve({
            data: outcome === "won" ? [{ id }] : [],
            error: null,
          });
        }
        void cols;
        return builder;
      };

      builder.limit = (n: number) => {
        op.limit = n;
        if (state.selectError) {
          return Promise.resolve({ data: null, error: state.selectError });
        }
        return Promise.resolve({ data: state.rows, error: null });
      };

      // The write-back is awaited directly, with no `select`, so the builder
      // itself has to be thenable.
      builder.then = (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown
      ) => {
        const id = idOf(op.filters);
        state.patches.push({ id, values: op.values ?? {} });
        const error = state.finaliseError[id] ?? null;
        return Promise.resolve({ data: null, error }).then(resolve, reject);
      };

      return builder;
    },
  };
  return db as unknown as SupabaseClient;
}

/* ── Fake GHL client ─────────────────────────────────────────────────────── */

interface FakeClientScript {
  upsert?: (email: string) => unknown;
  lookup?: (email: string) => unknown;
  addTags?: (contactId: string, tags: readonly string[]) => unknown;
  removeTags?: (contactId: string, tags: readonly string[]) => unknown;
}

function makeClient(script: FakeClientScript = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  const ok = (data: unknown) => ({ ok: true, status: 200, data });

  const client = {
    async upsertContact(input: { email: string }) {
      calls.push({ method: "upsertContact", args: [input] });
      return script.upsert?.(input.email) ?? ok({ contactId: "contact-1", isNew: false });
    },
    async findContactIdByEmail(email: string) {
      calls.push({ method: "findContactIdByEmail", args: [email] });
      return script.lookup?.(email) ?? ok("contact-1");
    },
    async addTags(contactId: string, tags: readonly string[]) {
      calls.push({ method: "addTags", args: [contactId, tags] });
      return script.addTags?.(contactId, tags) ?? ok([...tags]);
    },
    async removeTags(contactId: string, tags: readonly string[]) {
      calls.push({ method: "removeTags", args: [contactId, tags] });
      return script.removeTags?.(contactId, tags) ?? ok([...tags]);
    },
  };

  return { client: client as unknown as GhlClient, calls };
}

function failure(over: Partial<GhlFailure> = {}): GhlFailure {
  return {
    ok: false,
    retryable: true,
    status: 503,
    reason: "server_error",
    message: "GoHighLevel returned 503.",
    ...over,
  };
}

/* ── Rows ────────────────────────────────────────────────────────────────── */

const NOW = Date.parse("2026-10-12T12:00:00.000Z");

function row(over: Partial<GhlEventRow> = {}): GhlEventRow {
  return {
    id: "row-1",
    contact_email: "owner@example.com",
    event_type: "founder",
    tags_add: [TAG_FOUNDER],
    tags_remove: [],
    attempts: 0,
    status: "pending",
    next_attempt_at: "2026-10-12T11:59:00.000Z",
    payload: {},
    ...over,
  };
}

function patchFor(state: DbState, id: string): Record<string, unknown> {
  const hit = state.patches.find((p) => p.id === id);
  return hit?.values ?? {};
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

describe("isGhlRowClaimable", () => {
  it("is true only for a pending row that is due", () => {
    expect(isGhlRowClaimable({ status: "pending", next_attempt_at: "2026-10-12T11:00:00Z" }, NOW)).toBe(true);
    expect(isGhlRowClaimable({ status: "pending", next_attempt_at: "2026-10-12T13:00:00Z" }, NOW)).toBe(false);
  });

  it("never claims a terminal row", () => {
    for (const status of ["delivered", "failed", "skipped", null]) {
      expect(isGhlRowClaimable({ status, next_attempt_at: "2026-10-12T11:00:00Z" }, NOW)).toBe(false);
    }
  });

  /**
   * The column is NOT NULL with a default of now(), so this shape should not
   * exist. If it does, "deliver it" is the safe reading — every call is
   * idempotent, whereas "never due" would strand the row forever.
   */
  it("treats a missing or unparseable due time as due", () => {
    expect(isGhlRowClaimable({ status: "pending", next_attempt_at: null }, NOW)).toBe(true);
    expect(isGhlRowClaimable({ status: "pending", next_attempt_at: "not a date" }, NOW)).toBe(true);
  });
});

describe("computeGhlBackoffMs", () => {
  /** A negative delay is a retry in the past, i.e. a hot loop. */
  it("is never negative, for any attempt count or random draw", () => {
    for (const random of [() => 0, () => 0.5, () => 1, () => NaN, () => -3]) {
      for (const attempts of [0, 1, 2, 5, 50, 5000]) {
        expect(computeGhlBackoffMs({ attempts, random })).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("grows, and never shrinks, as attempts rise", () => {
    let previousLow = -1;
    for (let attempts = 1; attempts <= 12; attempts++) {
      const low = computeGhlBackoffMs({ attempts, random: () => 0 });
      const high = computeGhlBackoffMs({ attempts, random: () => 1 });
      expect(low).toBeGreaterThanOrEqual(previousLow);
      expect(high).toBeGreaterThanOrEqual(low);
      previousLow = low;
    }
  });

  /**
   * The stronger claim the 20% figure buys, and the reason it is 20% and not
   * 120%: below the cap, even a maximally jittered attempt is shorter than the
   * next step's nominal delay, so the schedule never doubles back on itself.
   * At the cap every step is equal, so the right claim there is the
   * non-decreasing one above.
   */
  it("never jitters one step past the next one, below the cap", () => {
    for (let attempts = 1; attempts <= 6; attempts++) {
      const high = computeGhlBackoffMs({ attempts, random: () => 1 });
      const nextLow = computeGhlBackoffMs({ attempts: attempts + 1, random: () => 0 });
      expect(high).toBeLessThanOrEqual(nextLow);
    }
  });

  it("is bounded, so a corrupt attempt count cannot park a row for a week", () => {
    const cap = 60 * 60_000 * 1.2;
    for (const attempts of [10, 100, 1e6, Number.MAX_SAFE_INTEGER]) {
      const ms = computeGhlBackoffMs({ attempts, random: () => 1 });
      expect(ms).toBeLessThanOrEqual(cap);
      expect(Number.isFinite(ms)).toBe(true);
    }
  });

  it("starts at one minute on the first failure", () => {
    expect(computeGhlBackoffMs({ attempts: 1, random: () => 0 })).toBe(60_000);
    expect(computeGhlBackoffMs({ attempts: 2, random: () => 0 })).toBe(120_000);
    expect(computeGhlBackoffMs({ attempts: 3, random: () => 0 })).toBe(240_000);
  });

  /** Their number is better information than our schedule. */
  it("honours Retry-After over the default schedule, with no jitter", () => {
    expect(computeGhlBackoffMs({ attempts: 1, retryAfterMs: 9_000, random: () => 1 })).toBe(9_000);
    // Even when it is longer than our own next step.
    expect(computeGhlBackoffMs({ attempts: 1, retryAfterMs: 600_000, random: () => 0 })).toBe(600_000);
  });

  it("clamps a nonsensical Retry-After rather than scheduling the past", () => {
    expect(computeGhlBackoffMs({ attempts: 2, retryAfterMs: -5_000 })).toBe(0);
    // Not a number: falls back to the schedule.
    expect(
      computeGhlBackoffMs({ attempts: 2, retryAfterMs: NaN, random: () => 0 })
    ).toBe(120_000);
  });
});

describe("classifyGhlFailure", () => {
  it("retries a retryable failure while the budget lasts", () => {
    expect(
      classifyGhlFailure({ failure: failure(), attempts: 1, maxAttempts: 5 })
    ).toBe("retry");
  });

  /** `>=`, because the lease already counted this attempt. */
  it("gives up once the budget is spent", () => {
    expect(
      classifyGhlFailure({ failure: failure(), attempts: 5, maxAttempts: 5 })
    ).toBe("failed");
    expect(
      classifyGhlFailure({ failure: failure(), attempts: 9, maxAttempts: 5 })
    ).toBe("failed");
  });

  /**
   * A 401 does not come back on its own. Retrying it would mean the whole
   * outbox beating against a revoked token while the admin screen says
   * "pending".
   */
  it("never retries a terminal failure, however much budget is left", () => {
    for (const reason of ["unauthorized", "forbidden", "not_found", "bad_request", "malformed"] as const) {
      expect(
        classifyGhlFailure({
          failure: failure({ retryable: false, reason, status: 401 }),
          attempts: 1,
          maxAttempts: 99,
        })
      ).toBe("failed");
    }
  });
});

/* ------------------------------------------------------------------ *
 * Drain: refusals
 * ------------------------------------------------------------------ */

describe("drainGhlOutbox — when it declines to work", () => {
  it("reads nothing when the integration is off", async () => {
    const state = freshState([row()]);
    const { client, calls } = makeClient();

    const summary = await drainGhlOutbox({ db: makeDb(state), config: OFF, client, now: NOW });

    expect(summary.halted).toBe("integration_off");
    expect(state.ops).toEqual([]);
    expect(calls).toEqual([]);
  });

  /**
   * Claiming rows we cannot deliver would burn their attempt budget and push
   * them into the future for nothing.
   */
  it("claims nothing when a live config arrives without a client", async () => {
    const state = freshState([row()]);

    const summary = await drainGhlOutbox({ db: makeDb(state), config: LIVE, client: null, now: NOW });

    expect(summary.halted).toBe("no_client");
    expect(state.ops).toEqual([]);
  });

  it("halts on an unreadable outbox without touching the client", async () => {
    const state = freshState([row()]);
    state.selectError = { message: "connection failure" };
    const { client, calls } = makeClient();

    const summary = await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    expect(summary.halted).toBe("read_failed");
    expect(calls).toEqual([]);
  });

  it("asks for only a batch of due pending rows, oldest first", async () => {
    const state = freshState([]);
    const { client } = makeClient();

    await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    const select = state.ops[0];
    expect(select.limit).toBe(GHL_DRAIN_BATCH_SIZE);
    expect(select.filters).toEqual([
      ["eq", "status", "pending"],
      ["lte", "next_attempt_at", new Date(NOW).toISOString()],
    ]);
  });

  /** The batch size is a rate-limit budget: 25 rows x 3 calls < 100 per 10s. */
  it("keeps the default batch under the documented GHL ceiling", () => {
    expect(GHL_DRAIN_BATCH_SIZE * 3).toBeLessThan(100);
  });
});

/* ------------------------------------------------------------------ *
 * Drain: the lease
 * ------------------------------------------------------------------ */

describe("drainGhlOutbox — claiming", () => {
  it("leases a row by bumping attempts and pushing the due time out", async () => {
    const state = freshState([row({ attempts: 2 })]);
    const { client } = makeClient();

    await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    const lease = state.leaseCalls[0];
    expect(lease.values).toEqual({
      attempts: 3,
      next_attempt_at: new Date(NOW + GHL_LEASE_MS).toISOString(),
    });
    // The two guards that make this a lease rather than an update.
    expect(lease.filters).toEqual([
      ["eq", "id", "row-1"],
      ["eq", "status", "pending"],
      ["lte", "next_attempt_at", new Date(NOW).toISOString()],
    ]);
  });

  /**
   * THE REASON THE LEASE EXISTS. Two workers (overlapping cron, or a manual
   * admin trigger) both SELECT the row; only one UPDATE matches it. Zero rows
   * back means somebody else owns it, and a plain select-then-deliver would
   * have sent the tags twice.
   */
  it("does not deliver a row whose lease update matched nothing", async () => {
    const state = freshState([row()]);
    state.lease["row-1"] = "lost";
    const { client, calls } = makeClient();

    const summary = await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    expect(calls).toEqual([]);
    expect(state.patches).toEqual([]);
    expect(summary).toMatchObject({ claimed: 0, leaseLost: 1, delivered: 0 });
  });

  it("treats a failed claim as not ours, and sends nothing", async () => {
    const state = freshState([row()]);
    state.lease["row-1"] = "error";
    const { client, calls } = makeClient();

    const summary = await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    expect(calls).toEqual([]);
    expect(summary.leaseLost).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Drain: the outcome matrix
 * ------------------------------------------------------------------ */

describe("drainGhlOutbox — delivery", () => {
  it("upserts the contact, then adds and removes tags", async () => {
    const state = freshState([
      row({ tags_add: [TAG_FOUNDER], tags_remove: [TAG_PLAN_GENERATED] }),
    ]);
    const { client, calls } = makeClient();

    const summary = await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    expect(calls.map((c) => c.method)).toEqual(["upsertContact", "addTags", "removeTags"]);
    /*
     * THE ONE THING THIS MUST NEVER DO. The upsert body accepts `tags` and
     * GHL documents it as overwriting the contact's whole tag list, which is
     * shared with the client's marketing team.
     */
    expect(calls[0].args[0]).not.toHaveProperty("tags");
    expect(calls[1].args[1]).toEqual([TAG_FOUNDER]);
    expect(calls[2].args[1]).toEqual([TAG_PLAN_GENERATED]);

    expect(patchFor(state, "row-1")).toEqual({
      status: "delivered",
      delivered_at: new Date(NOW).toISOString(),
      last_error: null,
    });
    expect(summary).toMatchObject({ claimed: 1, delivered: 1, failed: 0, retrying: 0 });
  });

  it("forwards the payload's phone to the contact upsert", async () => {
    const state = freshState([
      row({ payload: { firstName: "Olive", phone: " +447700900123 " } }),
    ]);
    const { client, calls } = makeClient();

    await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    expect(calls[0].method).toBe("upsertContact");
    expect(calls[0].args[0]).toMatchObject({
      email: "owner@example.com",
      firstName: "Olive",
      phone: "+447700900123",
    });
  });

  it("passes a blank or absent phone as null, never as an empty string", async () => {
    for (const payload of [{}, { phone: "" }, { phone: "   " }, { phone: null }]) {
      const state = freshState([row({ payload })]);
      const { client, calls } = makeClient();

      await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

      expect((calls[0].args[0] as { phone?: unknown }).phone).toBeNull();
    }
  });

  it("does not call a tag endpoint with an empty list", async () => {
    const state = freshState([row({ tags_add: [TAG_FOUNDER], tags_remove: [] })]);
    const { client, calls } = makeClient();

    await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    expect(calls.map((c) => c.method)).toEqual(["upsertContact", "addTags"]);
  });

  it("leaves a retryable failure pending, with a backoff and the reason", async () => {
    const state = freshState([row({ attempts: 0 })]);
    const { client } = makeClient({ addTags: () => failure() });

    const summary = await drainGhlOutbox({
      db: makeDb(state),
      config: LIVE,
      client,
      now: NOW,
      random: () => 0,
    });

    const patch = patchFor(state, "row-1");
    expect(patch.status).toBe("pending");
    // One minute out: attempts is 1 after the lease.
    expect(patch.next_attempt_at).toBe(new Date(NOW + 60_000).toISOString());
    expect(String(patch.last_error)).toContain("server_error");
    expect(patch).not.toHaveProperty("delivered_at");
    expect(summary).toMatchObject({ retrying: 1, failed: 0, delivered: 0 });
  });

  /** The row has had every attempt it was promised. */
  it("promotes a retryable failure to failed once the budget is spent", async () => {
    const state = freshState([row({ attempts: GHL_DRAIN_MAX_ATTEMPTS - 1 })]);
    const { client } = makeClient({ upsert: () => failure() });

    const summary = await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    const patch = patchFor(state, "row-1");
    expect(patch.status).toBe("failed");
    expect(String(patch.last_error)).toContain("gave up after 5 attempts");
    expect(summary).toMatchObject({ failed: 1, retrying: 0 });
  });

  it("fails a terminal failure immediately, with budget to spare", async () => {
    const state = freshState([row({ attempts: 0 })]);
    const { client } = makeClient({
      upsert: () =>
        failure({ retryable: false, status: 401, reason: "unauthorized", message: "GoHighLevel returned 401." }),
    });

    const summary = await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    const patch = patchFor(state, "row-1");
    expect(patch.status).toBe("failed");
    expect(patch).not.toHaveProperty("next_attempt_at");
    expect(String(patch.last_error)).toContain("unauthorized");
    // Not reported as a retry, so nothing will pick it up again.
    expect(summary).toMatchObject({ failed: 1, retrying: 0 });
  });

  /**
   * 044 is explicit: skipped is a TERMINAL SUCCESS, not an error. It must not
   * surface as a failure on the admin screen, and `delivered_at` is stamped
   * because the column means "reached a terminal state".
   */
  it("skips, terminally and without counting a failure, when the contact is absent", async () => {
    const state = freshState([
      row({ payload: { requireExistingContact: true } }),
    ]);
    const { client, calls } = makeClient({ lookup: () => ({ ok: true, status: 200, data: null }) });

    const summary = await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    expect(calls.map((c) => c.method)).toEqual(["findContactIdByEmail"]);
    expect(patchFor(state, "row-1")).toEqual({
      status: "skipped",
      delivered_at: new Date(NOW).toISOString(),
      last_error: expect.stringContaining("does not exist"),
    });
    expect(summary).toMatchObject({ skipped: 1, failed: 0, delivered: 0, retrying: 0 });
  });

  /** A 429's own advice beats our schedule. */
  it("honours Retry-After from a rate limit", async () => {
    const state = freshState([row()]);
    const { client } = makeClient({
      addTags: () =>
        failure({ status: 429, reason: "rate_limited", message: "rate limit", retryAfterMs: 90_000 }),
    });

    await drainGhlOutbox({
      db: makeDb(state),
      config: LIVE,
      client,
      now: NOW,
      // Would have produced a 1-minute wait, and a jittered one at that.
      random: () => 1,
    });

    expect(patchFor(state, "row-1").next_attempt_at).toBe(
      new Date(NOW + 90_000).toISOString()
    );
  });
});

/* ------------------------------------------------------------------ *
 * Dry run
 * ------------------------------------------------------------------ */

describe("drainGhlOutbox — dry run", () => {
  it("resolves the row, contacts nobody, and marks it unmistakably", async () => {
    const state = freshState([row({ payload: { plan: "pro" } })]);
    const { client, calls } = makeClient();

    const summary = await drainGhlOutbox({
      db: makeDb(state),
      config: DRY,
      // Supplied on purpose: even handed a client, a dry run must not use it.
      client,
      now: NOW,
    });

    expect(calls).toEqual([]);
    const patch = patchFor(state, "row-1");
    expect(patch.status).toBe("delivered");
    expect(patch.last_error).toBe(GHL_DRY_RUN_MARKER);
    expect(patch.payload).toEqual({ plan: "pro", ghl_dry_run: true });
    expect(summary).toMatchObject({ claimed: 1, delivered: 1, dryRun: true });
  });

  it("still claims under the lease, so a dry run and a live run cannot overlap", async () => {
    const state = freshState([row()]);
    await drainGhlOutbox({ db: makeDb(state), config: DRY, now: NOW });
    expect(state.leaseCalls).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Resilience
 * ------------------------------------------------------------------ */

describe("drainGhlOutbox — one bad row", () => {
  /**
   * The per-row guard. A thrown row taking the other twenty-four with it is
   * how an outbox stops draining and nobody notices.
   */
  it("does not abandon the batch when a row throws", async () => {
    const state = freshState([row({ id: "row-1" }), row({ id: "row-2" })]);
    // Only the first row throws; the second must still be delivered.
    let first = true;
    const { client } = makeClient({
      upsert: () => {
        if (first) {
          first = false;
          throw new Error("exploded");
        }
        return { ok: true, status: 200, data: { contactId: "contact-2", isNew: false } };
      },
    });

    const summary = await drainGhlOutbox({
      db: makeDb(state),
      config: LIVE,
      client,
      now: NOW,
    });

    expect(summary.errors).toEqual([
      { id: "row-1", step: "row", message: "exploded" },
    ]);
    // The second row still went out and was recorded.
    expect(patchFor(state, "row-2")).toMatchObject({ status: "delivered" });
    expect(summary).toMatchObject({ claimed: 2, delivered: 1 });
  });

  /**
   * The delivery happened; only the bookkeeping failed. The lease expires and
   * the row is re-delivered, which is safe because every GHL call is
   * idempotent.
   */
  it("reports a write-back failure without counting a delivery", async () => {
    const state = freshState([row()]);
    state.finaliseError["row-1"] = { message: "update failed" };
    const { client } = makeClient();

    const summary = await drainGhlOutbox({ db: makeDb(state), config: LIVE, client, now: NOW });

    expect(summary.delivered).toBe(0);
    expect(summary.errors).toEqual([
      { id: "row-1", step: "finalise:delivered", message: "update failed" },
    ]);
  });

  it("never throws", async () => {
    const throwingDb = {
      from() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    const { client } = makeClient();

    await expect(
      drainGhlOutbox({ db: throwingDb, config: LIVE, client, now: NOW })
    ).resolves.toMatchObject({ halted: "read_failed" });
  });
});
