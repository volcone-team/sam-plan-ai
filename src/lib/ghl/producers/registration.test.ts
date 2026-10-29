import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueRegisteredEvent,
  isPaidSubscription,
  registrationDedupeKey,
  registrationTags,
  resetRegistrationLogOnceForTests,
  shouldFireRegistration,
  type RegistrationDecisionInput,
} from "./registration";
import { firstLoginDedupeKey } from "./first-login";
import { milestoneDedupeKey } from "./milestone";
import { founderDedupeKey } from "./founder";
import type { GhlConfig } from "../config";
import { TAG_OPTED_COMMUNICATION, TAG_OPTED_DND, TAG_REGISTERED_NOT_PAID } from "../tags";

/* ── Mocked Supabase ─────────────────────────────────────────────────────── */

type Filter = { column: string; value: unknown };

interface TableState {
  rows: Record<string, unknown>[];
  error?: { code?: string; message: string } | null;
}

let tables: Record<string, TableState>;
let inserts: { table: string; values: Record<string, unknown> }[];
let insertError: { code?: string; message: string } | null;
let queried: string[];

function result(table: string, filters: Filter[]) {
  const state = tables[table];
  if (!state) return { data: [], error: null };
  if (state.error) return { data: null, error: state.error };
  const rows = state.rows.filter((row) => filters.every((f) => row[f.column] === f.value));
  return { data: rows, error: null };
}

function makeDb(): SupabaseClient {
  const db = {
    from(table: string) {
      queried.push(table);
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
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient;
}

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

function ownerRow(over: Record<string, unknown> = {}) {
  return {
    id: OWNER,
    company_id: COMPANY,
    role: "owner",
    is_admin: false,
    admin_level: null,
    email: "Owner@Example.com",
    first_name: "Olive",
    last_name: "Owner",
    phone: "+447700900123",
    terms_accepted_at: "2026-10-12T10:00:00Z",
    promotional_consent: true,
    ...over,
  };
}

beforeEach(() => {
  tables = {
    profiles: {
      rows: [
        {
          id: MEMBER,
          company_id: COMPANY,
          role: "member",
          email: "member@example.com",
          terms_accepted_at: "2026-10-12T10:00:00Z",
        },
        ownerRow(),
      ],
    },
    companies: { rows: [{ id: COMPANY, name: "Volcone Ltd" }] },
    subscriptions: { rows: [{ company_id: COMPANY, status: "trialing", stripe_subscription_id: null }] },
  };
  inserts = [];
  insertError = null;
  queried = [];
  resetRegistrationLogOnceForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setOwner(over: Record<string, unknown>) {
  tables.profiles.rows = tables.profiles.rows.map((r) => (r.id === OWNER ? ownerRow(over) : r));
}

/* ── The pure decision ───────────────────────────────────────────────────── */

describe("shouldFireRegistration", () => {
  const base: RegistrationDecisionInput = {
    role: "owner",
    isAdmin: false,
    adminLevel: null,
    companyId: COMPANY,
    termsAcceptedAt: "2026-10-12T10:00:00Z",
    isImpersonating: false,
  };

  const cases: [string, Partial<RegistrationDecisionInput>, boolean, string][] = [
    ["public-signup owner", {}, true, "registered"],
    ["owner, role padded", { role: " Owner " }, true, "registered"],
    ["impersonated", { isImpersonating: true }, false, "impersonating"],
    ["is_admin", { isAdmin: true }, false, "admin"],
    ["super admin level", { adminLevel: "super_admin" }, false, "admin"],
    ["team member", { role: "member" }, false, "not_owner"],
    ["company admin role", { role: "admin" }, false, "not_owner"],
    ["no role", { role: null }, false, "not_owner"],
    ["no company", { companyId: null }, false, "no_company"],
    ["admin-created (no terms stamp)", { termsAcceptedAt: null }, false, "not_public_signup"],
    ["blank terms stamp", { termsAcceptedAt: "  " }, false, "not_public_signup"],
    ["terms accepted on an invite", { termsAcceptedVia: "invite" }, false, "not_public_signup"],
    ["terms accepted at signup (058)", { termsAcceptedVia: "signup" }, true, "registered"],
  ];

  for (const [name, over, fire, reason] of cases) {
    it(`${name} -> ${reason}`, () => {
      expect(shouldFireRegistration({ ...base, ...over })).toEqual({ fire, reason });
    });
  }
});

describe("registrationTags", () => {
  it("adds DND when unticked, communication when ticked, neither when never asked", () => {
    expect(registrationTags(false)).toEqual([TAG_REGISTERED_NOT_PAID, TAG_OPTED_DND]);
    expect(registrationTags(true)).toEqual([TAG_REGISTERED_NOT_PAID, TAG_OPTED_COMMUNICATION]);
    expect(registrationTags(null)).toEqual([TAG_REGISTERED_NOT_PAID]);
    expect(registrationTags(undefined)).toEqual([TAG_REGISTERED_NOT_PAID]);
  });
});

describe("isPaidSubscription", () => {
  it("is paid only with a Stripe subscription in the active buyer state", () => {
    expect(isPaidSubscription([{ status: "active", stripe_subscription_id: "sub_1" }])).toBe(true);
    expect(isPaidSubscription([{ status: "past_due", stripe_subscription_id: "sub_1" }])).toBe(true);
  });

  it("treats trials, comps, ended and missing subscriptions as not paid", () => {
    expect(isPaidSubscription([])).toBe(false);
    expect(isPaidSubscription([{ status: "trialing", stripe_subscription_id: "sub_1" }])).toBe(false);
    expect(isPaidSubscription([{ status: "trial", stripe_subscription_id: null }])).toBe(false);
    expect(isPaidSubscription([{ status: "active", stripe_subscription_id: null }])).toBe(false);
    expect(isPaidSubscription([{ status: "active", stripe_subscription_id: "  " }])).toBe(false);
    expect(isPaidSubscription([{ status: "cancelled", stripe_subscription_id: "sub_1" }])).toBe(false);
    expect(isPaidSubscription([{ status: "incomplete", stripe_subscription_id: "sub_1" }])).toBe(false);
  });

  it("is paid when any one row is paid", () => {
    expect(
      isPaidSubscription([
        { status: "trialing", stripe_subscription_id: null },
        { status: "active", stripe_subscription_id: "sub_2" },
      ])
    ).toBe(true);
  });
});

describe("registrationDedupeKey", () => {
  it("is one per company and collides with no sibling key", () => {
    expect(registrationDedupeKey(COMPANY)).toBe("company:comp-1:registered");
    const others = [
      firstLoginDedupeKey(OWNER),
      firstLoginDedupeKey(COMPANY),
      milestoneDedupeKey(COMPANY, "finished_intake"),
      milestoneDedupeKey(COMPANY, "plan_generated"),
      founderDedupeKey(COMPANY),
    ];
    expect(others).not.toContain(registrationDedupeKey(COMPANY));
  });
});

/* ── The producer ────────────────────────────────────────────────────────── */

const run = (over: Record<string, unknown> = {}) =>
  enqueueRegisteredEvent(makeDb(), {
    userId: OWNER,
    source: "direct_signup",
    config: LIVE,
    ...over,
  } as Parameters<typeof enqueueRegisteredEvent>[1]);

describe("enqueueRegisteredEvent — when it fires", () => {
  it("enqueues one row for the owner with the tag, names and phone", async () => {
    const result = await run();
    // The fixture owner ticked the promotional box.
    expect(result).toEqual({
      ok: true,
      outcome: "enqueued",
      tags: [TAG_REGISTERED_NOT_PAID, TAG_OPTED_COMMUNICATION],
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("ghl_events");
    expect(inserts[0].values).toMatchObject({
      company_id: COMPANY,
      user_id: OWNER,
      contact_email: "owner@example.com",
      event_type: "registered",
      tags_add: [TAG_REGISTERED_NOT_PAID, TAG_OPTED_COMMUNICATION],
      tags_remove: [],
      dedupe_key: "company:comp-1:registered",
      payload: {
        source: "direct_signup",
        firstName: "Olive",
        lastName: "Owner",
        companyName: "Volcone Ltd",
        phone: "+447700900123",
      },
    });
  });

  it("adds the DND tag when the promotional box was unticked", async () => {
    setOwner({ promotional_consent: false });
    const result = await run();
    expect(result).toMatchObject({ outcome: "enqueued", tags: [TAG_REGISTERED_NOT_PAID, TAG_OPTED_DND] });
    expect(inserts[0].values.tags_add).toEqual([TAG_REGISTERED_NOT_PAID, TAG_OPTED_DND]);
  });

  it("adds no DND tag when consent was never asked (null)", async () => {
    setOwner({ promotional_consent: null });
    await run();
    expect(inserts[0].values.tags_add).toEqual([TAG_REGISTERED_NOT_PAID]);
  });

  it("fires for a trial (trial is not paid)", async () => {
    tables.subscriptions.rows = [{ company_id: COMPANY, status: "trialing", stripe_subscription_id: "sub_t" }];
    expect((await run()).outcome).toBe("enqueued");
  });

  it("reports a second call for the same company as a duplicate", async () => {
    insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    expect(await run({ source: "api_me" })).toEqual({
      ok: true,
      outcome: "duplicate",
      tags: [TAG_REGISTERED_NOT_PAID, TAG_OPTED_COMMUNICATION],
    });
  });
});

describe("enqueueRegisteredEvent — when it does nothing", () => {
  it("does no queries while the integration is off", async () => {
    const result = await run({ config: OFF });
    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
    expect(queried).toEqual([]);
  });

  it("does no queries while impersonating", async () => {
    const result = await run({ isImpersonating: true });
    expect(result).toMatchObject({ outcome: "skipped", reason: "not_eligible", detail: "impersonating" });
    expect(queried).toEqual([]);
  });

  it("skips a team member", async () => {
    const result = await run({ userId: MEMBER });
    expect(result).toMatchObject({ outcome: "skipped", reason: "not_eligible", detail: "not_owner" });
    expect(inserts).toHaveLength(0);
  });

  it("skips an admin profile", async () => {
    setOwner({ is_admin: true });
    expect(await run()).toMatchObject({ reason: "not_eligible", detail: "admin" });
    setOwner({ admin_level: "super_admin" });
    expect(await run()).toMatchObject({ reason: "not_eligible", detail: "admin" });
    expect(inserts).toHaveLength(0);
  });

  it("skips an owner who accepted the terms on an invite, not at signup", async () => {
    setOwner({ terms_accepted_via: "invite" });
    expect(await run({ source: "api_me" })).toMatchObject({
      reason: "not_eligible",
      detail: "not_public_signup",
    });
    expect(inserts).toHaveLength(0);
  });

  it("skips an admin-created company owner (no terms stamp)", async () => {
    setOwner({ terms_accepted_at: null });
    expect(await run({ source: "api_me" })).toMatchObject({
      reason: "not_eligible",
      detail: "not_public_signup",
    });
    expect(inserts).toHaveLength(0);
  });

  it("skips a company that is already paying", async () => {
    tables.subscriptions.rows = [{ company_id: COMPANY, status: "active", stripe_subscription_id: "sub_1" }];
    expect(await run()).toEqual({ ok: true, outcome: "skipped", reason: "already_paid" });
    expect(inserts).toHaveLength(0);
  });

  it("enqueues nothing when the subscription read fails", async () => {
    tables.subscriptions.error = { message: "timeout" };
    expect(await run()).toMatchObject({ ok: false, reason: "read_failed" });
    expect(inserts).toHaveLength(0);
  });

  it("skips when the profile does not exist yet", async () => {
    expect(await run({ userId: "nobody" })).toEqual({ ok: true, outcome: "skipped", reason: "no_profile" });
  });

  it("skips quietly when migration 037 columns are missing", async () => {
    tables.profiles.error = { code: "42703", message: "column profiles.terms_accepted_at does not exist" };
    expect(await run()).toMatchObject({ ok: true, reason: "unavailable", detail: "migration_037" });
  });
});

describe("enqueueRegisteredEvent — before migration 052", () => {
  it("reads a CHECK violation as not delivered, and warns once", async () => {
    insertError = { code: "23514", message: "violates check constraint ghl_events_event_type_check" };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await run()).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "unavailable",
      detail: "migration_052",
    });
    await run();
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("migration 052"))).toHaveLength(1);
  });

  it("reports any other insert failure as failed", async () => {
    insertError = { code: "42501", message: "permission denied" };
    expect(await run()).toMatchObject({ ok: false, outcome: "failed", reason: "enqueue_failed" });
  });

  it("never throws, even when the client does", async () => {
    const throwingDb = {
      from() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    await expect(
      enqueueRegisteredEvent(throwingDb, { userId: OWNER, source: "api_me", config: LIVE })
    ).resolves.toMatchObject({ ok: false, outcome: "failed" });
  });
});
