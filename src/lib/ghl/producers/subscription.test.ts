import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueBuyerStateEvent, buyerStateDedupeKey } from "./subscription";
import type { GhlConfig } from "../config";
import { BUYER_TAG_PREFIX } from "../tags";

/* ── Mocked Supabase ─────────────────────────────────────────────────────────
 * One builder that covers the three shapes this producer uses: a bare
 * `select()` that is awaited directly (subscription_plans), a filtered
 * `maybeSingle()` (profiles, companies), and an `insert().select().maybeSingle()`
 * (ghl_events). Thenable, because PostgrestBuilder is.
 */
type Filter = { column: string; value: unknown };

interface TableState {
  rows: Record<string, unknown>[];
  error?: { code?: string; message: string } | null;
}

let tables: Record<string, TableState>;
let inserts: { table: string; values: Record<string, unknown> }[];
let insertError: { code?: string; message: string } | null;

function result(table: string, filters: Filter[]) {
  const state = tables[table];
  if (!state) return { data: null, error: null };
  if (state.error) return { data: null, error: state.error };
  const rows = state.rows.filter((row) =>
    filters.every((f) => row[f.column] === f.value)
  );
  return { data: rows, error: null };
}

function makeDb(): SupabaseClient {
  const db = {
    from(table: string) {
      const filters: Filter[] = [];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        maybeSingle() {
          const { data, error } = result(table, filters);
          return Promise.resolve({ data: data?.[0] ?? null, error });
        },
        // Awaited directly: `select("id, name")` with no filter.
        then(onFulfilled: (value: unknown) => unknown) {
          return Promise.resolve(result(table, filters)).then(onFulfilled);
        },
        insert(values: Record<string, unknown>) {
          inserts.push({ table, values });
          return {
            select: () => ({
              maybeSingle: () =>
                Promise.resolve(
                  insertError
                    ? { data: null, error: insertError }
                    : { data: { id: "row-1" }, error: null }
                ),
            }),
          };
        },
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient;
}

const throwingDb = {
  from() {
    throw new Error("boom");
  },
} as unknown as SupabaseClient;

/* ── Configs ──────────────────────────────────────────────────────────────── */

const LIVE: GhlConfig = {
  status: "live",
  available: true,
  env: { locationId: true, token: true },
  mayWrite: true,
  credentials: { locationId: "loc_1", token: "pit-secret-value" },
};
const OFF: GhlConfig = {
  status: "disabled",
  available: true,
  env: { locationId: true, token: true },
  mayWrite: false,
};

const COMPANY = "comp-1";
const PRO = "plan-pro";
const EVENT = "evt_1KxTest";

beforeEach(() => {
  tables = {
    subscription_plans: {
      rows: [
        { id: PRO, name: "Pro" },
        { id: "plan-starter", name: "Starter" },
        // A RETIRED plan. It keeps its subscribers, so its tags are still live
        // and must still appear in the removal list.
        { id: "plan-legacy", name: "Legacy" },
      ],
    },
    profiles: {
      rows: [
        // A member as well as the owner, so "owner only" has to be enforced
        // by the query rather than by there being nobody else to pick.
        { id: "member-1", company_id: COMPANY, role: "member", email: "member@example.com" },
        {
          id: "owner-1",
          company_id: COMPANY,
          role: "owner",
          email: "owner@example.com",
          first_name: "Olive",
          last_name: "Owner",
        },
      ],
    },
    companies: { rows: [{ id: COMPANY, name: "Volcone Ltd" }] },
  };
  inserts = [];
  insertError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function input(over: Record<string, unknown> = {}) {
  return {
    companyId: COMPANY,
    planId: PRO,
    status: "active",
    billingCycle: "annual",
    stripeEventId: EVENT,
    stripeEventType: "invoice.paid",
    config: LIVE,
    ...over,
  } as Parameters<typeof enqueueBuyerStateEvent>[1];
}

describe("enqueueBuyerStateEvent — the happy path", () => {
  it("enqueues one buyer_state row for the owner with the right tags", async () => {
    const result = await enqueueBuyerStateEvent(makeDb(), input());

    expect(result).toMatchObject({ ok: true, outcome: "enqueued" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("ghl_events");

    const values = inserts[0].values;
    expect(values).toMatchObject({
      event_type: "buyer_state",
      company_id: COMPANY,
      // The OWNER, never the member. A team member in a buyer workflow is the
      // failure this whole path is shaped to avoid.
      user_id: "owner-1",
      contact_email: "owner@example.com",
      // "annual" in the database, "yearly" in the tag.
      tags_add: [`${BUYER_TAG_PREFIX}active - pro yearly`],
      dedupe_key: `stripe:${EVENT}:buyer_state`,
    });
  });

  it("names the retired plan's tags in the removal list", async () => {
    await enqueueBuyerStateEvent(makeDb(), input());

    const remove = inserts[0].values.tags_remove as string[];
    expect(remove).toEqual(
      expect.arrayContaining([
        `${BUYER_TAG_PREFIX}active - legacy monthly`,
        `${BUYER_TAG_PREFIX}inactive - legacy yearly`,
        `${BUYER_TAG_PREFIX}active - starter monthly`,
      ])
    );
    // The add is never also a removal.
    expect(remove).not.toContain(`${BUYER_TAG_PREFIX}active - pro yearly`);
  });

  /**
   * The payload is rendered on an admin screen and sits in every backup. It
   * carries enough to answer "why does this contact have this tag" and
   * nothing that could leak.
   */
  it("carries debugging context and no secrets in the payload", async () => {
    await enqueueBuyerStateEvent(makeDb(), input());

    const payload = inserts[0].values.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      plan: "pro",
      cycle: "yearly",
      state: "active",
      status: "active",
      stripeEventType: "invoice.paid",
      // Read by deliverGhlRow and passed to the contact upsert.
      firstName: "Olive",
      lastName: "Owner",
      companyName: "Volcone Ltd",
    });
    expect(JSON.stringify(payload)).not.toContain("pit-secret-value");
  });

  it("writes no dedupe key when there is no Stripe event behind the call", async () => {
    // A deliberate manual resync should enqueue unconditionally.
    await enqueueBuyerStateEvent(makeDb(), input({ stripeEventId: null }));
    expect(inserts[0].values.dedupe_key).toBeNull();
  });

  it("maps a cancelled subscription to the inactive tag", async () => {
    // The British spelling is what mapStripeStatus actually writes.
    await enqueueBuyerStateEvent(
      makeDb(),
      input({ status: "cancelled", billingCycle: "monthly" })
    );
    expect(inserts[0].values.tags_add).toEqual([
      `${BUYER_TAG_PREFIX}inactive - pro monthly`,
    ]);
  });
});

describe("enqueueBuyerStateEvent — when it does nothing", () => {
  /**
   * THE CHEAPEST PATH, AND THE CURRENT ONE. `ghl_enabled` is false in the live
   * database, so this is where every real webhook lands today: no queries, no
   * row.
   */
  it("does nothing at all — not even a query — when the integration is off", async () => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueBuyerStateEvent(db, input({ config: OFF }));

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
    expect(spy).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("enqueues nothing for a trial, and says why", async () => {
    const result = await enqueueBuyerStateEvent(makeDb(), input({ status: "trial" }));

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "no_buyer_state",
      detail: "trialing",
    });
    expect(inserts).toEqual([]);
  });

  it("enqueues nothing when the company has no owner", async () => {
    tables.profiles.rows = tables.profiles.rows.filter((r) => r.role !== "owner");

    const result = await enqueueBuyerStateEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: true,
      outcome: "skipped",
      reason: "no_owner_contact",
      detail: "no_owner",
    });
    expect(inserts).toEqual([]);
  });

  it("enqueues nothing, and reports a failure, when the plan cannot be tagged", async () => {
    tables.subscription_plans.rows = [{ id: PRO, name: "+++" }];

    const result = await enqueueBuyerStateEvent(makeDb(), input());

    expect(result).toMatchObject({ ok: false, outcome: "failed", reason: "tag_refused" });
    expect(inserts).toEqual([]);
  });

  /**
   * Without the plan names we cannot name the tags to REMOVE, and a row with
   * only an add would leave the contact in two workflows — worse than late.
   */
  it("enqueues nothing when the plan table is unreadable", async () => {
    tables.subscription_plans.error = { message: "permission denied" };

    const result = await enqueueBuyerStateEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      reason: "plans_unreadable",
    });
    expect(inserts).toEqual([]);
  });
});

describe("enqueueBuyerStateEvent — redelivery and failure", () => {
  /**
   * Stripe redelivers. The route's `stripe_webhook_events` insert catches most
   * of it; the dedupe key is the line of defence that survives a handler which
   * failed halfway.
   */
  it("treats the same Stripe event twice as one row", async () => {
    const first = await enqueueBuyerStateEvent(makeDb(), input());
    expect(first).toMatchObject({ outcome: "enqueued" });

    // Second delivery: the partial unique index on (sub_account, dedupe_key)
    // is the arbiter, and a 23505 is the expected answer.
    insertError = {
      code: "23505",
      message: 'duplicate key value violates "uq_ghl_events_dedupe"',
    };
    const second = await enqueueBuyerStateEvent(makeDb(), input());

    expect(second).toEqual({ ok: true, outcome: "duplicate" });
    // Both attempted the insert — that is what makes the race safe — but only
    // one row survives, which is the index's job rather than ours.
    expect(inserts).toHaveLength(2);
    expect(inserts[0].values.dedupe_key).toBe(inserts[1].values.dedupe_key);
  });

  it("reports an insert failure without throwing", async () => {
    insertError = { code: "42501", message: "permission denied for table ghl_events" };

    const result = await enqueueBuyerStateEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      reason: "enqueue_failed",
      message: "permission denied for table ghl_events",
    });
  });

  /**
   * THE PROPERTY THE WEBHOOK DEPENDS ON. A thrown database call here would be
   * a non-2xx from the only writer of subscription state, and Stripe would
   * redeliver a PAYMENT event for the sake of a marketing tag.
   */
  it("never propagates a thrown database call", async () => {
    await expect(
      enqueueBuyerStateEvent(throwingDb, input())
    ).resolves.toMatchObject({ ok: false, outcome: "failed" });
  });

  it("never throws when the config has to be loaded against a broken client", async () => {
    // loadGhlConfig fails closed to `unavailable`, so this is a skip.
    await expect(
      enqueueBuyerStateEvent(throwingDb, input({ config: undefined }))
    ).resolves.toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
  });
});

describe("buyerStateDedupeKey", () => {
  /**
   * The intent suffix is not decoration: 044's index is on
   * (sub_account, dedupe_key) with no event_type, so one Stripe event that
   * produces two intents would have the second silently lose as a duplicate.
   */
  it("pins the shape: stripe:{eventId}:buyer_state", () => {
    expect(buyerStateDedupeKey("evt_123")).toBe("stripe:evt_123:buyer_state");
  });
});
