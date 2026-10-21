import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueFirstLoginEvent,
  firstLoginDedupeKey,
  shouldFireFirstLogin,
} from "./first-login";
import { milestoneDedupeKey } from "./milestone";
import { buyerStateDedupeKey } from "./subscription";
import { cancellationDedupeKey } from "./cancellation";
import type { GhlConfig } from "../config";
import { TAG_FIRST_LOGIN } from "../tags";

/* ── Mocked Supabase ─────────────────────────────────────────────────────────
 * The builder from milestone.test.ts, plus the one thing this producer does
 * that none of its siblings do: a CONDITIONAL UPDATE whose returned row count
 * is the answer. `stampRows` is what the fake hands back from
 * `update().eq().is().select()`, so the race is a test rather than a timing
 * experiment.
 */
type Filter = { column: string; value: unknown };

interface TableState {
  rows: Record<string, unknown>[];
  error?: { code?: string; message: string } | null;
}

let tables: Record<string, TableState>;
let inserts: { table: string; values: Record<string, unknown> }[];
let updates: { table: string; values: Record<string, unknown>; filters: Filter[] }[];
let insertError: { code?: string; message: string } | null;
/** Rows the conditional stamp "affected". Empty = another request won. */
let stampRows: Record<string, unknown>[];
let stampError: { code?: string; message: string } | null;

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
        update(values: Record<string, unknown>) {
          const upFilters: Filter[] = [];
          const up: Record<string, unknown> = {
            eq(column: string, value: unknown) {
              upFilters.push({ column, value });
              return up;
            },
            is(column: string, value: unknown) {
              upFilters.push({ column, value });
              return up;
            },
            select() {
              updates.push({ table, values, filters: upFilters });
              if (stampError) {
                return Promise.resolve({ data: null, error: stampError });
              }
              /*
               * CONSUMED, exactly as Postgres consumes it: the first update
               * that matches flips the column out of the `is null` predicate,
               * so every later one affects nothing. That is what makes the
               * concurrency test below a test rather than a timing accident.
               */
              const rows = stampRows;
              stampRows = [];
              return Promise.resolve({ data: rows, error: null });
            },
          };
          return up;
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

beforeEach(() => {
  tables = {
    profiles: {
      rows: [
        // A member as well as the owner: "owner only" has to be enforced by
        // the query and by the decision, not by there being nobody else to pick.
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
    companies: { rows: [{ id: COMPANY, name: "Volcone Ltd" }] },
  };
  inserts = [];
  updates = [];
  insertError = null;
  // The stamp is won by default: the interesting case is losing it.
  stampRows = [{ id: OWNER }];
  stampError = null;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function input(over: Record<string, unknown> = {}) {
  return {
    userId: OWNER,
    companyId: COMPANY,
    role: "owner",
    firstLoginAt: null,
    isImpersonating: false,
    source: "api_me",
    config: LIVE,
    ...over,
  } as Parameters<typeof enqueueFirstLoginEvent>[1];
}

/* ── The pure decision ───────────────────────────────────────────────────────
 * A table, because the three conditions are independent and the whole point of
 * pulling the decision out of the producer is that every combination is a unit
 * test with no database in sight.
 */

describe("shouldFireFirstLogin — the three conditions", () => {
  const cases: {
    role: string | null;
    firstLoginAt: string | null;
    isImpersonating: boolean;
    fire: boolean;
    reason: string;
  }[] = [
    // The one case that fires.
    { role: "owner", firstLoginAt: null, isImpersonating: false, fire: true, reason: "first_login" },

    // Already stamped — the steady state for everybody after one page load.
    { role: "owner", firstLoginAt: "2026-10-01T00:00:00Z", isImpersonating: false, fire: false, reason: "already_stamped" },
    { role: "member", firstLoginAt: "2026-10-01T00:00:00Z", isImpersonating: false, fire: false, reason: "already_stamped" },
    { role: "owner", firstLoginAt: "2026-10-01T00:00:00Z", isImpersonating: true, fire: false, reason: "already_stamped" },

    // Not the owner. A member is never a GHL contact; tagging one would
    // MANUFACTURE a contact in a CRM the client pays for per contact.
    { role: "member", firstLoginAt: null, isImpersonating: false, fire: false, reason: "not_owner" },
    { role: "admin", firstLoginAt: null, isImpersonating: false, fire: false, reason: "not_owner" },
    { role: null, firstLoginAt: null, isImpersonating: false, fire: false, reason: "not_owner" },

    // Impersonated. An admin viewing the account is not the customer's first
    // login, and is reported as such rather than as a role problem.
    { role: "owner", firstLoginAt: null, isImpersonating: true, fire: false, reason: "impersonating" },
    { role: "member", firstLoginAt: null, isImpersonating: true, fire: false, reason: "impersonating" },
  ];

  for (const c of cases) {
    it(`role=${c.role} stamped=${c.firstLoginAt !== null} impersonating=${c.isImpersonating} -> ${c.reason}`, () => {
      expect(
        shouldFireFirstLogin({
          role: c.role,
          firstLoginAt: c.firstLoginAt,
          isImpersonating: c.isImpersonating,
        })
      ).toEqual({ fire: c.fire, reason: c.reason });
    });
  }

  /**
   * We never compare the stamp to a clock — the question is "has this ever
   * fired", not "when" — so there is nothing to parse and nothing to get
   * wrong. A Date, and even a value we could not parse, counts as stamped.
   */
  it("treats any non-null stamp as stamped, whatever its shape", () => {
    expect(
      shouldFireFirstLogin({ role: "owner", firstLoginAt: new Date(), isImpersonating: false }).reason
    ).toBe("already_stamped");
    expect(
      shouldFireFirstLogin({ role: "owner", firstLoginAt: "not a date", isImpersonating: false }).reason
    ).toBe("already_stamped");
  });

  it("is not fooled by the casing or padding of the role", () => {
    expect(
      shouldFireFirstLogin({ role: " Owner ", firstLoginAt: null, isImpersonating: false }).fire
    ).toBe(true);
  });
});

/* ── The producer ─────────────────────────────────────────────────────────── */

describe("enqueueFirstLoginEvent — the one time it fires", () => {
  it("stamps the profile and enqueues one first-login row", async () => {
    const result = await enqueueFirstLoginEvent(makeDb(), input());

    expect(result).toEqual({ ok: true, outcome: "enqueued", tag: TAG_FIRST_LOGIN });

    // The stamp, with the predicate that makes it the arbiter.
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("profiles");
    expect(updates[0].filters).toEqual([
      { column: "id", value: OWNER },
      { column: "ghl_first_login_at", value: null },
    ]);
    expect(updates[0].values.ghl_first_login_at).toBeTypeOf("string");

    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("ghl_events");
    expect(inserts[0].values).toMatchObject({
      event_type: "first_login",
      company_id: COMPANY,
      user_id: OWNER,
      contact_email: "owner@example.com",
      tags_add: [TAG_FIRST_LOGIN],
      dedupe_key: `profile:${OWNER}:first_login`,
    });
    /*
     * ADD ONLY, NEVER A REMOVAL. A first login is a fact about the past: it
     * cannot be un-happened, so there is no second state and nothing in this
     * app may take the tag off.
     */
    expect(inserts[0].values.tags_remove).toEqual([]);
  });

  /** The payload is rendered on an admin screen and sits in every backup. */
  it("carries context and no secrets in the payload", async () => {
    await enqueueFirstLoginEvent(makeDb(), input({ context: { entry: "dashboard" } }));

    const payload = inserts[0].values.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      reason: "first_login",
      source: "api_me",
      impersonated: false,
      entry: "dashboard",
      // Read by deliverGhlRow and passed to the contact upsert.
      firstName: "Olive",
      lastName: "Owner",
      companyName: "Volcone Ltd",
    });
    expect(JSON.stringify(payload)).not.toContain("pit-secret-value");
  });

  /**
   * The call site's context cannot rename the client's contact: deliverGhlRow
   * reads firstName out of this payload, so our own fields win.
   */
  it("does not let the call site's context clobber the contact's name", async () => {
    await enqueueFirstLoginEvent(makeDb(), input({ context: { firstName: "Hacked" } }));

    const payload = inserts[0].values.payload as Record<string, unknown>;
    expect(payload.firstName).toBe("Olive");
  });
});

describe("enqueueFirstLoginEvent — when it does nothing", () => {
  /**
   * THE CHEAPEST PATH, AND THE CURRENT ONE. `ghl_enabled` is false in the live
   * database, and this producer's call site is /api/me — every page load of
   * every signed-in customer. Zero queries is not a nicety here.
   */
  it("does nothing at all — not even a query — when the integration is off", async () => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueFirstLoginEvent(db, input({ config: OFF }));

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
    expect(spy).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  /**
   * The decision is pure and comes before every query, so the steady state —
   * an already-stamped profile, i.e. every page load after the first — costs
   * nothing either.
   */
  it("reads nothing once the profile has already been stamped", async () => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueFirstLoginEvent(
      db,
      input({ firstLoginAt: "2026-10-01T00:00:00Z" })
    );

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "not_eligible",
      detail: "already_stamped",
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reads nothing, and stamps nothing, for an invited team member", async () => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueFirstLoginEvent(db, input({ userId: MEMBER, role: "member" }));

    expect(result).toMatchObject({ outcome: "skipped", detail: "not_owner" });
    expect(spy).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  /**
   * THE CONDITION MOST EASILY FORGOTTEN. A super admin opening a customer's
   * account is signed in AS that customer — same session, same profile row,
   * same /api/me. Stamping here would spend the customer's one-shot and fire
   * the welcome workflow behind it, from the client's domain, at the client's
   * customer, because a support person looked at a screen.
   */
  it("never fires, or stamps, while an admin is impersonating", async () => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueFirstLoginEvent(db, input({ isImpersonating: true }));

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "not_eligible",
      detail: "impersonating",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("refuses a blank user id rather than building a shared dedupe key", async () => {
    // `profile::first_login` would be one key for everybody, and the first
    // person through would permanently block the rest.
    const result = await enqueueFirstLoginEvent(makeDb(), input({ userId: "  " }));

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "no_user" });
    expect(updates).toEqual([]);
  });

  /**
   * THE STAMP COMES AFTER THE OWNER LOOKUP so a data gap does not consume the
   * one chance this person gets: nothing is stamped, and the next page load
   * tries again once the address is fixed.
   */
  it("enqueues nothing, and stamps nothing, when there is no owner contact", async () => {
    tables.profiles.rows = tables.profiles.rows.filter((r) => r.role !== "owner");

    const result = await enqueueFirstLoginEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: true,
      outcome: "skipped",
      reason: "no_owner_contact",
      detail: "no_owner",
    });
    expect(updates).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("skips quietly when migration 044 is not applied", async () => {
    stampError = { code: "42703", message: 'column "ghl_first_login_at" does not exist' };

    const result = await enqueueFirstLoginEvent(makeDb(), input());

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "unavailable" });
    expect(inserts).toEqual([]);
  });
});

describe("enqueueFirstLoginEvent — the race", () => {
  /**
   * THE STAMP IS THE ARBITER, NOT THE READ. The null that got us here came
   * from a SELECT that may be milliseconds stale, and a browser opening two
   * pages at once on a brand-new account is ordinary. Postgres serialises the
   * two updates: the winner flips the column out of the `is null` predicate
   * and the loser matches nothing. ZERO ROWS BACK MEANS SOMEBODY ELSE OWNS IT.
   */
  it("enqueues nothing when the conditional stamp affects no rows", async () => {
    stampRows = [];

    const result = await enqueueFirstLoginEvent(makeDb(), input());

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "stamp_lost" });
    expect(updates).toHaveLength(1);
    expect(inserts).toEqual([]);
  });

  /**
   * Two concurrent requests, one winner, with NOTHING set up between them:
   * both see the same null read, and the fake's consume-once stamp does the
   * adjudicating, which is exactly what the `is null` predicate does in
   * Postgres.
   */
  it("writes exactly one row when two requests arrive together", async () => {
    const db = makeDb();
    const first = enqueueFirstLoginEvent(db, input());
    const second = enqueueFirstLoginEvent(db, input());

    const [a, b] = await Promise.all([first, second]);

    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(["enqueued", "skipped"]);
    expect(inserts).toHaveLength(1);
  });
});

describe("enqueueFirstLoginEvent — failure", () => {
  it("reports a failed stamp without enqueueing", async () => {
    stampError = { code: "42501", message: "permission denied for table profiles" };

    const result = await enqueueFirstLoginEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      reason: "stamp_failed",
      message: "permission denied for table profiles",
    });
    expect(inserts).toEqual([]);
  });

  /**
   * THE LOST-TAG CASE, which is the accepted cost of stamping first: the stamp
   * is spent and no row exists. Reported as a failure and logged, because an
   * operator clearing the column makes the next page load fire it again.
   */
  it("reports an insert failure after a won stamp, and does not un-stamp", async () => {
    insertError = { code: "42501", message: "permission denied for table ghl_events" };

    const result = await enqueueFirstLoginEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      reason: "enqueue_failed",
      message: "permission denied for table ghl_events",
    });
    // Exactly one update: the stamp. Nothing tried to put the null back —
    // un-stamping would re-open the race and could fire the workflow twice.
    expect(updates).toHaveLength(1);
  });

  it("treats a row that already exists for this person as a duplicate", async () => {
    insertError = {
      code: "23505",
      message: 'duplicate key value violates "uq_ghl_events_dedupe"',
    };

    const result = await enqueueFirstLoginEvent(makeDb(), input());

    expect(result).toEqual({ ok: true, outcome: "duplicate", tag: TAG_FIRST_LOGIN });
  });

  /**
   * THE PROPERTY THE CALL SITE DEPENDS ON ENTIRELY. /api/me is what
   * AuthProvider waits on before rendering anything, so a throw here is a
   * blank screen for every signed-in customer — caused by a marketing tag.
   */
  it("never propagates a thrown database call", async () => {
    /*
     * RESOLVES, and resolves to a SKIP rather than a failure. Worth pinning
     * rather than loosening to "does not reject": the owner lookup is itself a
     * never-throws function, so a client that throws on `from()` is absorbed
     * by `resolveGhlOwnerContact` and never reaches this module's own catch.
     * That catch is belt and braces, and this test says so.
     */
    await expect(enqueueFirstLoginEvent(throwingDb, input())).resolves.toEqual({
      ok: true,
      outcome: "skipped",
      reason: "no_owner_contact",
      detail: "read_failed",
    });
  });

  it("never throws when the config has to be loaded against a broken client", async () => {
    // loadGhlConfig fails closed to `unavailable`, so this is a skip.
    await expect(
      enqueueFirstLoginEvent(throwingDb, input({ config: undefined }))
    ).resolves.toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
  });
});

/* ── The dedupe key ───────────────────────────────────────────────────────── */

describe("firstLoginDedupeKey", () => {
  it("pins the shape: profile:{userId}:first_login", () => {
    expect(firstLoginDedupeKey("user-1")).toBe("profile:user-1:first_login");
  });

  /**
   * 044's unique index is on (sub_account, dedupe_key) with NO event_type in
   * it, so a key shared with another producer would have the second insert hit
   * 23505, be reported as a `duplicate` — a SUCCESS — and one of the two tags
   * would never be written, silently, with no error to find. Four producers,
   * four namespaces.
   */
  it("cannot collide with the milestone, buyer-state or cancellation keys", () => {
    const id = "shared-id";
    const keys = [
      firstLoginDedupeKey(id),
      milestoneDedupeKey(id, "finished_intake"),
      milestoneDedupeKey(id, "plan_generated"),
      buyerStateDedupeKey(id),
      cancellationDedupeKey(id),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("is person-scoped, so two people in one company get different keys", () => {
    expect(firstLoginDedupeKey("owner-1")).not.toBe(firstLoginDedupeKey("owner-2"));
  });
});
