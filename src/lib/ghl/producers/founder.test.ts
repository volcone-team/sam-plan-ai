import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueFounderEvent,
  founderDedupeKey,
  isFounderRank,
  GHL_FOUNDER_LIMIT,
} from "./founder";
import { milestoneDedupeKey } from "./milestone";
import { buyerStateDedupeKey } from "./subscription";
import { cancellationDedupeKey } from "./cancellation";
import { firstLoginDedupeKey } from "./first-login";
import type { GhlConfig } from "../config";
import { TAG_FOUNDER } from "../tags";

/* ── Mocked Supabase ─────────────────────────────────────────────────────────
 * The builder from first-login.test.ts, minus the conditional update (this
 * producer stamps nothing) and plus the one thing none of its siblings do: a
 * HEAD/EXACT COUNT with an `.lt()` filter. `priorCount` is what the fake hands
 * back from `select("id", { count: "exact", head: true }).lt(...)`, and
 * `countFilters` records the comparison so the strictly-`<` rule is a test
 * rather than a reading of the source.
 */
type Filter = { column: string; value: unknown };

interface TableState {
  rows: Record<string, unknown>[];
  error?: { code?: string; message: string } | null;
}

let tables: Record<string, TableState>;
let inserts: { table: string; values: Record<string, unknown> }[];
let insertError: { code?: string; message: string } | null;
/** What the HEAD count answers. Null is PostgREST's "could not count". */
let priorCount: number | null;
let countError: { code?: string; message: string } | null;
/** Every filter the count query carried: column, operator, value. */
let countFilters: { op: string; column: string; value: unknown }[];
/** Every select, so "did it read created_at" is an assertion. */
let selects: { table: string; columns: string | undefined }[];

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
      let counting = false;
      const builder: Record<string, unknown> = {
        select(columns?: string, options?: { count?: string; head?: boolean }) {
          selects.push({ table, columns });
          // A count request is a different query with a different answer, so
          // the fake has to notice the second argument.
          if (options?.count) counting = true;
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push({ column, value });
          return builder;
        },
        lt(column: string, value: unknown) {
          countFilters.push({ op: "lt", column, value });
          return builder;
        },
        lte(column: string, value: unknown) {
          countFilters.push({ op: "lte", column, value });
          return builder;
        },
        maybeSingle() {
          const { data, error } = result(table, filters);
          return Promise.resolve({ data: data?.[0] ?? null, error });
        },
        then(onFulfilled: (value: unknown) => unknown) {
          if (counting) {
            return Promise.resolve(
              countError
                ? { data: null, count: null, error: countError }
                : { data: null, count: priorCount, error: null }
            ).then(onFulfilled);
          }
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
const OWNER = "owner-1";
const MEMBER = "member-1";
const CREATED = "2026-01-05T09:30:00.123456+00:00";

beforeEach(() => {
  tables = {
    profiles: {
      rows: [
        // A member as well as the owner: "owner only" has to be enforced by
        // the query, not by there being nobody else to pick.
        { id: MEMBER, company_id: COMPANY, role: "member", email: "member@example.com" },
        {
          id: OWNER,
          company_id: COMPANY,
          role: "owner",
          email: "owner@example.com",
          first_name: "Olive",
          last_name: "Owner",
        },
      ],
    },
    companies: { rows: [{ id: COMPANY, name: "Volcone Ltd", created_at: CREATED }] },
  };
  inserts = [];
  insertError = null;
  // Comfortably inside the cohort by default; the boundary is its own test.
  priorCount = 4;
  countError = null;
  countFilters = [];
  selects = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function input(over: Record<string, unknown> = {}) {
  return {
    companyId: COMPANY,
    status: "active",
    source: "stripe_webhook",
    config: LIVE,
    ...over,
  } as Parameters<typeof enqueueFounderEvent>[1];
}

/* ── The pure rank decision ──────────────────────────────────────────────────
 * The off-by-one, in isolation and with no database in sight, which is the
 * entire reason the arithmetic is a separate function. "First 100" means ranks
 * 1 through 100, and rank is priorCount + 1.
 */

describe("isFounderRank — the boundary", () => {
  it("counts the very first company ever, which has nothing before it", () => {
    expect(isFounderRank(0)).toBe(true);
  });

  it("counts the hundredth company, which has ninety-nine before it", () => {
    expect(isFounderRank(GHL_FOUNDER_LIMIT - 1)).toBe(true);
    expect(isFounderRank(99)).toBe(true);
  });

  /** The first company that misses out. 100 before it means it is rank 101. */
  it("refuses the hundred-and-first company", () => {
    expect(isFounderRank(GHL_FOUNDER_LIMIT)).toBe(false);
    expect(isFounderRank(100)).toBe(false);
    expect(isFounderRank(5000)).toBe(false);
  });

  it("honours a custom limit, so the cohort size is one constant to change", () => {
    expect(isFounderRank(0, 1)).toBe(true);
    expect(isFounderRank(1, 1)).toBe(false);
    expect(isFounderRank(9, 10)).toBe(true);
    expect(isFounderRank(10, 10)).toBe(false);
  });

  /**
   * A null count must NOT read as zero. Zero means "the very first company
   * ever", i.e. a guaranteed founder, so reading PostgREST's "could not count"
   * as zero would tag the entire customer base.
   */
  it("refuses anything that is not a real count", () => {
    expect(isFounderRank(null)).toBe(false);
    expect(isFounderRank(undefined)).toBe(false);
    expect(isFounderRank(Number.NaN)).toBe(false);
    expect(isFounderRank(-1)).toBe(false);
  });

  it("refuses a nonsensical limit rather than tagging everybody", () => {
    expect(isFounderRank(0, 0)).toBe(false);
    expect(isFounderRank(0, -5)).toBe(false);
  });

  it("pins the client's number", () => {
    expect(GHL_FOUNDER_LIMIT).toBe(100);
  });
});

/* ── The producer ─────────────────────────────────────────────────────────── */

describe("enqueueFounderEvent — the one time it fires", () => {
  it("enqueues one founder row for a company inside the cohort", async () => {
    const result = await enqueueFounderEvent(makeDb(), input());

    expect(result).toEqual({
      ok: true,
      outcome: "enqueued",
      tag: TAG_FOUNDER,
      rank: 5,
      limit: GHL_FOUNDER_LIMIT,
    });

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("ghl_events");
    expect(inserts[0].values).toMatchObject({
      event_type: "founder",
      company_id: COMPANY,
      // The OWNER's profile, because the owner is the contact.
      user_id: OWNER,
      contact_email: "owner@example.com",
      tags_add: [TAG_FOUNDER],
      dedupe_key: `company:${COMPANY}:founder`,
    });
  });

  /**
   * NO REMOVE LIST, EVER. Founder status is a fact about when they joined; it
   * cannot be un-happened, and a company promoted out of the cohort by
   * somebody else's deletion has still been a founder since the day we said
   * so. `tags.ts` documents the same thing: "set once, never cleared".
   */
  it("never asks for the tag to be removed", async () => {
    await enqueueFounderEvent(makeDb(), input());

    expect(inserts[0].values.tags_remove).toEqual([]);
  });

  /**
   * A HEAD/EXACT COUNT AND A STRICT `<`. Pulling a hundred rows to take
   * `.length` would be the same answer for ten times the payload, and would go
   * silently wrong the moment the limit exceeded PostgREST's row cap.
   */
  it("counts the companies before it with a strict less-than, and fetches no rows", async () => {
    await enqueueFounderEvent(makeDb(), input());

    expect(countFilters).toEqual([{ op: "lt", column: "created_at", value: CREATED }]);
    // Not `lte`: that would count the company itself and shift every rank.
    expect(countFilters.some((f) => f.op === "lte")).toBe(false);
  });

  /**
   * Postgres stores `timestamptz` to microseconds and
   * `new Date(s).toISOString()` truncates to milliseconds, so a re-serialised
   * timestamp would move the comparison boundary by up to 999µs and could
   * change a rank by one. The string goes to the comparison VERBATIM.
   */
  it("compares against the stored timestamp verbatim, microseconds and all", async () => {
    await enqueueFounderEvent(makeDb(), input());

    expect(countFilters[0].value).toBe(CREATED);
  });

  /** The payload is rendered on an admin screen and sits in every backup. */
  it("carries the rank and the limit, and no secrets, in the payload", async () => {
    await enqueueFounderEvent(makeDb(), input());

    const payload = inserts[0].values.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      // "Why is this contact a founder?" — the only record of what we believed
      // at the moment we tagged them, which is a belief that drifts.
      rank: 5,
      limit: GHL_FOUNDER_LIMIT,
      priorCompanies: 4,
      status: "active",
      source: "stripe_webhook",
      // Read by deliverGhlRow and passed to the contact upsert.
      firstName: "Olive",
      lastName: "Owner",
      companyName: "Volcone Ltd",
    });
    expect(JSON.stringify(payload)).not.toContain("pit-secret-value");
  });

  /**
   * `past_due` IS a buyer: `buyerPresenceForStatus` maps it to active because
   * Stripe is still retrying a card that already paid once. Inheriting that
   * judgement is the whole reason for reusing the function.
   */
  it("fires for a past_due subscription, which is still a customer", async () => {
    const result = await enqueueFounderEvent(makeDb(), input({ status: "past_due" }));

    expect(result).toMatchObject({ outcome: "enqueued" });
  });

  /**
   * A caller that already holds the row should not pay for a second read of a
   * column it is carrying.
   */
  it("uses a supplied created_at without reading it back", async () => {
    const result = await enqueueFounderEvent(
      makeDb(),
      input({ companyCreatedAt: "2025-02-02T00:00:00Z" })
    );

    expect(result).toMatchObject({ outcome: "enqueued" });
    expect(countFilters[0].value).toBe("2025-02-02T00:00:00Z");
    // `companies` is still touched twice — the HEAD count and the display name
    // `contact.ts` reads — but nothing selected created_at.
    expect(selects.some((s) => s.columns === "created_at")).toBe(false);
  });

  /** And the other way round: with nothing supplied, it reads the column. */
  it("reads created_at itself when the caller has not got it", async () => {
    await enqueueFounderEvent(makeDb(), input());

    expect(selects).toContainEqual({ table: "companies", columns: "created_at" });
  });
});

describe("enqueueFounderEvent — when it does nothing", () => {
  /**
   * THE CHEAPEST PATH, AND THE CURRENT ONE. `ghl_enabled` is false in the live
   * database, and the call site is the Stripe webhook.
   */
  it("does nothing at all — not even a query — when the integration is off", async () => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueFounderEvent(db, input({ config: OFF }));

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
    expect(spy).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  /**
   * THE PURCHASE GATE, and it is pure, so every trial and abandoned-checkout
   * event on the payment path exits before a single query. A founder is a
   * founding CUSTOMER: a trial that never converts must not consume a slot.
   */
  it.each([
    ["trialing", "trialing"],
    ["incomplete", "incomplete"],
    ["cancelled", "inactive"],
    ["unpaid", "inactive"],
    ["paused", "inactive"],
    ["", "no_subscription"],
    ["something_stripe_invented", "unknown_status"],
  ])("reads nothing for status %s", async (status, detail) => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueFounderEvent(db, input({ status }));

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "not_a_buyer",
      detail,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("refuses a blank company id rather than building a shared dedupe key", async () => {
    // `company::founder` would be one key for everybody, and the first company
    // through would permanently block the rest.
    const result = await enqueueFounderEvent(makeDb(), input({ companyId: "  " }));

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "no_company" });
    expect(inserts).toEqual([]);
  });

  /** The steady state for every company after the hundredth, forever. */
  it("enqueues nothing for a company past the limit", async () => {
    priorCount = GHL_FOUNDER_LIMIT;

    const result = await enqueueFounderEvent(makeDb(), input());

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "past_limit" });
    expect(inserts).toEqual([]);
  });

  /**
   * The rank is checked BEFORE the owner lookup: resolving a contact for every
   * customer after the hundredth would be two queries on the payment path,
   * forever, for a company that can never qualify.
   */
  it("does not resolve an owner for a company past the limit", async () => {
    priorCount = 1000;
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    await enqueueFounderEvent(db, input());

    expect(spy.mock.calls.filter((c) => c[0] === "profiles")).toHaveLength(0);
  });

  it("enqueues nothing when the company has no owner contact", async () => {
    tables.profiles.rows = tables.profiles.rows.filter((r) => r.role !== "owner");

    const result = await enqueueFounderEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: true,
      outcome: "skipped",
      reason: "no_owner_contact",
      detail: "no_owner",
    });
    expect(inserts).toEqual([]);
  });

  /**
   * *** THE PINNED SAFE BEHAVIOUR. *** An unknowable rank is NOT guessed at in
   * either direction. A wrong founder tag cannot be un-sent: the add fires a
   * GHL workflow and the welcome mail leaves the client's domain. Silence is
   * recoverable by hand; a sent email is not.
   */
  it.each([
    ["missing", null],
    ["missing", "   "],
    ["unparseable", "not a timestamp"],
    ["unparseable", new Date("nonsense")],
  ])("does not tag when created_at is %s", async (detail, created) => {
    tables.companies.rows = [{ id: COMPANY, name: "Volcone Ltd", created_at: created }];

    const result = await enqueueFounderEvent(makeDb(), input());

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "no_created_at",
      detail,
    });
    expect(inserts).toEqual([]);
    // And nothing was counted, so no rank was ever in play.
    expect(countFilters).toEqual([]);
  });

  it("does not tag when the company row cannot be read at all", async () => {
    tables.companies.error = { code: "42501", message: "permission denied" };

    const result = await enqueueFounderEvent(makeDb(), input());

    expect(result).toMatchObject({ outcome: "skipped", reason: "no_created_at" });
    expect(inserts).toEqual([]);
  });
});

describe("enqueueFounderEvent — the one-shot", () => {
  /**
   * THE EXPECTED STEADY STATE FOR A FOUNDER: every renewal, every card retry
   * and every redelivered Stripe event after the first lands here. GHL fires a
   * workflow on every tag ADD, so a second row would send the client's founder
   * sequence again — which is the failure the company-scoped key prevents.
   */
  it("reports a second call as a duplicate rather than tagging twice", async () => {
    insertError = {
      code: "23505",
      message: 'duplicate key value violates "uq_ghl_events_dedupe"',
    };

    const result = await enqueueFounderEvent(makeDb(), input());

    expect(result).toEqual({
      ok: true,
      outcome: "duplicate",
      tag: TAG_FOUNDER,
      rank: 5,
      limit: GHL_FOUNDER_LIMIT,
    });
  });

  /**
   * Two calls over one fake, with nothing arranged between them: the first
   * writes, the second is refused by the unique index exactly as Postgres
   * refuses it.
   */
  it("writes one row across repeated events for the same company", async () => {
    const db = makeDb();

    const first = await enqueueFounderEvent(db, input());
    insertError = {
      code: "23505",
      message: 'duplicate key value violates "uq_ghl_events_dedupe"',
    };
    const second = await enqueueFounderEvent(db, input());

    expect(first.outcome).toBe("enqueued");
    expect(second.outcome).toBe("duplicate");
    expect(inserts.filter((i) => i.values.event_type === "founder")).toHaveLength(2);
    // Both attempts carried the SAME key, which is what makes the second one
    // the database's problem rather than ours.
    expect(inserts[0].values.dedupe_key).toBe(inserts[1].values.dedupe_key);
  });
});

describe("enqueueFounderEvent — failure", () => {
  /**
   * FAIL, NOT SKIP: we do not know whether this company qualifies. Nothing is
   * enqueued, and because the key is company-scoped the next subscription
   * event re-evaluates and can still tag them.
   */
  it("reports an unreadable rank without enqueueing", async () => {
    countError = { code: "42501", message: "permission denied for table companies" };

    const result = await enqueueFounderEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      reason: "rank_unreadable",
      message: "permission denied for table companies",
    });
    expect(inserts).toEqual([]);
  });

  /**
   * A NULL COUNT IS NOT A ZERO. Zero means "the very first company ever", so
   * reading PostgREST's "could not count" as zero would tag everybody.
   */
  it("refuses a count that came back empty", async () => {
    priorCount = null;

    const result = await enqueueFounderEvent(makeDb(), input());

    expect(result).toMatchObject({ ok: false, reason: "rank_unreadable" });
    expect(inserts).toEqual([]);
  });

  it("reports an insert failure", async () => {
    insertError = { code: "42501", message: "permission denied for table ghl_events" };

    const result = await enqueueFounderEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      reason: "enqueue_failed",
      message: "permission denied for table ghl_events",
    });
  });

  /**
   * THE PROPERTY THE CALL SITE DEPENDS ON ENTIRELY. The Stripe webhook is the
   * only writer of subscription state, and any non-2xx makes Stripe redeliver
   * a PAYMENT event for the sake of a marketing tag.
   */
  it("never propagates a thrown database call", async () => {
    /*
     * RESOLVES, and resolves to a SKIP: the created_at read is itself guarded,
     * so a client that throws on `from()` is absorbed there and reported as an
     * unknowable rank. The producer's own catch is belt and braces.
     */
    await expect(enqueueFounderEvent(throwingDb, input())).resolves.toEqual({
      ok: true,
      outcome: "skipped",
      reason: "no_created_at",
      detail: "read_failed",
    });
  });

  it("never throws when the config has to be loaded against a broken client", async () => {
    // loadGhlConfig fails closed to `unavailable`, so this is a skip.
    await expect(
      enqueueFounderEvent(throwingDb, input({ config: undefined }))
    ).resolves.toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
  });
});

/* ── The dedupe key ───────────────────────────────────────────────────────── */

describe("founderDedupeKey", () => {
  it("pins the shape: company:{companyId}:founder", () => {
    expect(founderDedupeKey("comp-9")).toBe("company:comp-9:founder");
  });

  /**
   * 044's unique index is on (sub_account, dedupe_key) with NO event_type in
   * it, so a key shared with another producer would have the second insert hit
   * 23505, be reported as a `duplicate` — a SUCCESS — and one of the two tags
   * would never be written, silently, with no error to find. This producer
   * shares the `company:` namespace with the milestones AND fires from the
   * same Stripe event as buyer-state and cancellation, so the suffix is the
   * only thing keeping all five apart.
   */
  it("cannot collide with any of the other five keys", () => {
    const id = "shared-id";
    const keys = [
      founderDedupeKey(id),
      milestoneDedupeKey(id, "finished_intake"),
      milestoneDedupeKey(id, "plan_generated"),
      firstLoginDedupeKey(id),
      buyerStateDedupeKey(id),
      cancellationDedupeKey(id),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is company-scoped, so two companies get different keys", () => {
    expect(founderDedupeKey("comp-1")).not.toBe(founderDedupeKey("comp-2"));
  });
});
