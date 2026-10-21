import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueMilestoneEvent,
  milestoneDedupeKey,
  type GhlMilestone,
} from "./milestone";
import { buyerStateDedupeKey } from "./subscription";
import { cancellationDedupeKey } from "./cancellation";
import type { GhlConfig } from "../config";
import { TAG_FINISHED_INTAKE, TAG_PLAN_GENERATED } from "../tags";

/* ── Mocked Supabase ─────────────────────────────────────────────────────────
 * The same builder as cancellation.test.ts, unchanged: this producer reads the
 * same two tables (profiles for the owner, companies for the display name) and
 * writes the same one, so the fake is kept recognisable rather than re-invented.
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
/** The member who clicked. Never the contact; always in the payload. */
const MEMBER = "member-1";

beforeEach(() => {
  tables = {
    profiles: {
      rows: [
        // A member as well as the owner: "owner only" has to be enforced by
        // the query, not by there being nobody else to pick.
        { id: MEMBER, company_id: COMPANY, role: "member", email: "member@example.com" },
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
    milestone: "plan_generated" as GhlMilestone,
    companyId: COMPANY,
    userId: "owner-1",
    source: "generate_plan",
    config: LIVE,
    ...over,
  } as Parameters<typeof enqueueMilestoneEvent>[1];
}

/* ── Enqueueing ───────────────────────────────────────────────────────────── */

describe("enqueueMilestoneEvent — the two milestones", () => {
  it("enqueues plan_generated with one tag and nothing to remove", async () => {
    const result = await enqueueMilestoneEvent(makeDb(), input());

    expect(result).toEqual({
      ok: true,
      outcome: "enqueued",
      milestone: "plan_generated",
      tag: TAG_PLAN_GENERATED,
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("ghl_events");
    expect(inserts[0].values).toMatchObject({
      event_type: "plan_generated",
      company_id: COMPANY,
      contact_email: "owner@example.com",
      tags_add: [TAG_PLAN_GENERATED],
      dedupe_key: `company:${COMPANY}:plan_generated`,
    });
    /*
     * NEVER A REMOVAL. A milestone is a fact about the past — a plan that
     * existed once existed — so nothing in this app may take the tag off.
     */
    expect(inserts[0].values.tags_remove).toEqual([]);
  });

  it("enqueues finished_intake with its own tag and its own key", async () => {
    const result = await enqueueMilestoneEvent(
      makeDb(),
      input({ milestone: "finished_intake", source: "intake_build" })
    );

    expect(result).toMatchObject({ ok: true, outcome: "enqueued", tag: TAG_FINISHED_INTAKE });
    expect(inserts[0].values).toMatchObject({
      event_type: "finished_intake",
      tags_add: [TAG_FINISHED_INTAKE],
      dedupe_key: `company:${COMPANY}:finished_intake`,
    });
    expect(inserts[0].values.tags_remove).toEqual([]);
  });

  /**
   * /api/intake/build fires BOTH from one request — it is the intake's commit
   * point and the only way a customer gets a plan. Two rows, two keys, two
   * tags: the thing the milestone suffix in the key exists to make possible.
   */
  it("writes two independent rows when one route fires both", async () => {
    const db = makeDb();
    await enqueueMilestoneEvent(db, input({ milestone: "finished_intake" }));
    await enqueueMilestoneEvent(db, input({ milestone: "plan_generated" }));

    expect(inserts).toHaveLength(2);
    expect(inserts[0].values.dedupe_key).not.toBe(inserts[1].values.dedupe_key);
    expect(inserts.map((i) => i.values.tags_add)).toEqual([
      [TAG_FINISHED_INTAKE],
      [TAG_PLAN_GENERATED],
    ]);
  });
});

/* ── Owner attribution ────────────────────────────────────────────────────── */

describe("enqueueMilestoneEvent — who gets tagged", () => {
  /**
   * THE SUBTLETY WORTH PINNING. A team member can complete the intake or
   * generate a plan, but only the OWNER is a GHL contact — tagging a member
   * would manufacture a contact in a CRM the client pays for per contact and
   * drop a non-buyer into a buyer workflow. So the milestone is attributed to
   * the owner regardless of who clicked, and the actor is kept in the payload
   * so nobody later reads the attribution as a bug.
   */
  it("tags the owner even when a member triggered it", async () => {
    await enqueueMilestoneEvent(makeDb(), input({ userId: MEMBER }));

    expect(inserts[0].values).toMatchObject({
      contact_email: "owner@example.com",
      // The OWNER's profile, not the actor's. 044 cascades this column.
      user_id: "owner-1",
    });
    expect((inserts[0].values.payload as Record<string, unknown>).triggeredByUserId).toBe(
      MEMBER
    );
  });

  /**
   * The payload is rendered on an admin screen and sits in every backup.
   */
  it("carries debugging context and no secrets in the payload", async () => {
    await enqueueMilestoneEvent(
      makeDb(),
      input({
        milestone: "plan_generated",
        source: "generate_plan",
        context: { regeneration: true, initiativeCount: 4 },
      })
    );

    const payload = inserts[0].values.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      milestone: "plan_generated",
      source: "generate_plan",
      regeneration: true,
      initiativeCount: 4,
      // Read by deliverGhlRow and passed to the contact upsert.
      firstName: "Olive",
      lastName: "Owner",
      companyName: "Volcone Ltd",
    });
    expect(JSON.stringify(payload)).not.toContain("pit-secret-value");
  });

  /**
   * Context is merged FIRST so a call site cannot rename the client's contact
   * by passing a firstName of its own — deliverGhlRow reads these fields.
   */
  it("does not let call-site context clobber the contact fields", async () => {
    await enqueueMilestoneEvent(
      makeDb(),
      input({ context: { firstName: "Hijacked", milestone: "nonsense" } })
    );

    const payload = inserts[0].values.payload as Record<string, unknown>;
    expect(payload.firstName).toBe("Olive");
    expect(payload.milestone).toBe("plan_generated");
  });
});

/* ── When it does nothing ─────────────────────────────────────────────────── */

describe("enqueueMilestoneEvent — when it does nothing", () => {
  /**
   * THE CHEAPEST PATH, AND THE CURRENT ONE. `ghl_enabled` is false in the live
   * database, and both call sites run with a customer watching a spinner, so
   * "off" must not cost them a single round trip.
   */
  it("does nothing at all — not even a query — when the integration is off", async () => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueMilestoneEvent(db, input({ config: OFF }));

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
    expect(spy).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("enqueues nothing when the company has no owner", async () => {
    tables.profiles.rows = tables.profiles.rows.filter((r) => r.role !== "owner");

    const result = await enqueueMilestoneEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: true,
      outcome: "skipped",
      reason: "no_owner_contact",
      detail: "no_owner",
    });
    expect(inserts).toEqual([]);
  });

  /**
   * A blank company id would build the key `company::plan_generated`, shared
   * by every company that ever hit this path — the first one through would
   * permanently block the rest. Refused before the key is built.
   */
  it("refuses a blank company id before it can build a shared key", async () => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueMilestoneEvent(db, input({ companyId: "   " }));

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "no_company" });
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ── The one-shot ─────────────────────────────────────────────────────────── */

describe("enqueueMilestoneEvent — one-shot per company", () => {
  /**
   * THE WHOLE POINT. A customer regenerates their plan repeatedly; the second
   * and every later run must write nothing, because a GHL workflow triggered
   * by "contact tag added" fires again on a re-add and would re-send the
   * client's onboarding email. 044's partial unique index adjudicates it, and
   * a 23505 comes back as `duplicate` — a success.
   */
  it("reports a duplicate when the same company reaches the milestone again", async () => {
    const first = await enqueueMilestoneEvent(makeDb(), input());
    expect(first).toMatchObject({ outcome: "enqueued" });

    insertError = {
      code: "23505",
      message: 'duplicate key value violates "uq_ghl_events_dedupe"',
    };
    const second = await enqueueMilestoneEvent(makeDb(), input());

    expect(second).toEqual({
      ok: true,
      outcome: "duplicate",
      milestone: "plan_generated",
      tag: TAG_PLAN_GENERATED,
    });
    // The same key both times: it is scoped to the company, not to the run.
    expect(inserts[0].values.dedupe_key).toBe(inserts[1].values.dedupe_key);
  });

  it("always writes a key, unlike its siblings", async () => {
    // Both Stripe producers accept "no event id, enqueue unconditionally".
    // Here the key IS the feature, so there is no mode without one.
    await enqueueMilestoneEvent(makeDb(), input({ userId: null, source: undefined }));
    expect(inserts[0].values.dedupe_key).toBe(`company:${COMPANY}:plan_generated`);
  });
});

/* ── Failure ──────────────────────────────────────────────────────────────── */

describe("enqueueMilestoneEvent — failure", () => {
  it("reports an insert failure without throwing", async () => {
    insertError = { code: "42501", message: "permission denied for table ghl_events" };

    const result = await enqueueMilestoneEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      reason: "enqueue_failed",
      message: "permission denied for table ghl_events",
    });
  });

  /**
   * THE PROPERTY BOTH CALLERS DEPEND ON. Each has just spent a real Anthropic
   * call and written the customer's plan; a throw here would report a finished
   * plan as a 500 and invite them to spend those tokens again.
   */
  it("never propagates a thrown database call", async () => {
    /*
     * RESOLVES, and resolves to a SKIP rather than a failure — worth pinning
     * rather than loosening to "does not reject", exactly as
     * cancellation.test.ts does. Every await in this producer is itself a
     * never-throws function, so a client that throws on `from()` is absorbed
     * by `resolveGhlOwnerContact` (which reports `read_failed`) and never
     * reaches this module's own catch. That catch is belt and braces.
     */
    await expect(enqueueMilestoneEvent(throwingDb, input())).resolves.toEqual({
      ok: true,
      outcome: "skipped",
      reason: "no_owner_contact",
      detail: "read_failed",
    });
  });

  it("never throws when the config has to be loaded against a broken client", async () => {
    // loadGhlConfig fails closed to `unavailable`, so this is a skip.
    await expect(
      enqueueMilestoneEvent(throwingDb, input({ config: undefined }))
    ).resolves.toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
  });
});

/* ── The key ──────────────────────────────────────────────────────────────── */

describe("milestoneDedupeKey", () => {
  it("pins the shape: company:{companyId}:{milestone}", () => {
    expect(milestoneDedupeKey("comp-9", "plan_generated")).toBe(
      "company:comp-9:plan_generated"
    );
    expect(milestoneDedupeKey("comp-9", "finished_intake")).toBe(
      "company:comp-9:finished_intake"
    );
  });

  /**
   * THE COLLISION THE SUFFIX EXISTS TO PREVENT, and it is not hypothetical:
   * /api/intake/build fires both milestones from the same request. 044's
   * unique index is on (sub_account, dedupe_key) with NO event_type, so a bare
   * company id would have the second insert hit 23505, be reported as a
   * `duplicate` — a success — and one of the two tags would never be written,
   * silently, with no error to find.
   */
  it("cannot collide across the two milestones for one company", () => {
    expect(milestoneDedupeKey("comp-9", "plan_generated")).not.toBe(
      milestoneDedupeKey("comp-9", "finished_intake")
    );
  });

  /**
   * ALL FOUR PRODUCERS SHARE ONE INDEX, so the namespaces have to be disjoint.
   * `company:` against `stripe:` is what keeps them apart — and the milestone
   * keys are deliberately NOT event-scoped, so a company whose Stripe event id
   * happened to equal its own id still could not clash.
   */
  it("cannot collide with the buyer-state or cancellation keys", () => {
    const id = "shared-identifier";
    const keys = [
      milestoneDedupeKey(id, "plan_generated"),
      milestoneDedupeKey(id, "finished_intake"),
      buyerStateDedupeKey(id),
      cancellationDedupeKey(id),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys.slice(0, 2)) expect(key.startsWith("company:")).toBe(true);
    for (const key of keys.slice(2)) expect(key.startsWith("stripe:")).toBe(true);
  });
});
