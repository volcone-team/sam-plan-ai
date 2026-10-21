import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

/* ── Mocked drain scheduler ──────────────────────────────────────────────────
 * The real one calls `after()`, which throws outside a request context — so
 * mocking it is not only about observing the call, it is what keeps these
 * tests about the insert. Its own guarantees live in schedule-drain.test.ts.
 */
const scheduleGhlDrain = vi.fn();
vi.mock("@/lib/ghl/schedule-drain", () => ({
  scheduleGhlDrain: (db: never) => scheduleGhlDrain(db),
}));

import {
  enqueueGhlEvent,
  GHL_SUB_ACCOUNT_APP,
  type EnqueueGhlEventInput,
} from "./outbox";
import type { GhlConfig } from "./config";
import { TAG_FOUNDER, TAG_INACTIVE_30 } from "./tags";

/* ── Mocked Supabase ─────────────────────────────────────────────────────────
 * Same shape as config.test.ts: records the chain so a test can assert both
 * what was written and that nothing was written at all.
 */
type Insert = { table: string; values: Record<string, unknown> };
let inserts: Insert[] = [];
let insertError: { code?: string; message: string } | null = null;
let insertData: unknown = { id: "row-1" };

function makeDb(): SupabaseClient {
  const db = {
    from(table: string) {
      return {
        insert(values: Record<string, unknown>) {
          inserts.push({ table, values });
          return {
            select: () => ({
              maybeSingle: () =>
                Promise.resolve(
                  insertError
                    ? { data: null, error: insertError }
                    : { data: insertData, error: null }
                ),
            }),
          };
        },
      };
    },
  };
  return db as unknown as SupabaseClient;
}

const throwingDb = {
  from() {
    throw new Error("boom");
  },
} as unknown as SupabaseClient;

/* ── Configs ────────────────────────────────────────────────────────────────
 * Built by hand rather than through loadGhlConfig, so these tests exercise the
 * outbox and not the settings reader.
 */
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
const UNAVAILABLE: GhlConfig = {
  status: "unavailable",
  available: true,
  env: { locationId: false, token: false },
  mayWrite: false,
};
const UNCONFIGURED: GhlConfig = {
  status: "not_configured",
  available: true,
  env: { locationId: false, token: false },
  mayWrite: false,
  missing: ["GHL_LOCATION_ID"],
};

function input(over: Partial<EnqueueGhlEventInput> = {}): EnqueueGhlEventInput {
  return {
    eventType: "founder",
    companyId: "company-1",
    userId: "user-1",
    contactEmail: "owner@example.com",
    tagsAdd: [TAG_FOUNDER],
    config: LIVE,
    ...over,
  };
}

beforeEach(() => {
  inserts = [];
  insertError = null;
  insertData = { id: "row-1" };
  scheduleGhlDrain.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("enqueueGhlEvent — the row it writes", () => {
  it("writes one pending row against the app sub-account", async () => {
    const result = await enqueueGhlEvent(makeDb(), input());

    expect(result).toEqual({ ok: true, outcome: "enqueued", id: "row-1" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("ghl_events");
    expect(inserts[0].values).toMatchObject({
      company_id: "company-1",
      user_id: "user-1",
      contact_email: "owner@example.com",
      // ONE sub-account. 044's CHECK allows three; the fan-out was cancelled.
      sub_account: GHL_SUB_ACCOUNT_APP,
      event_type: "founder",
      tags_add: [TAG_FOUNDER],
      tags_remove: [],
      payload: {},
      dedupe_key: null,
    });
  });

  /**
   * status / attempts / next_attempt_at are column defaults in 044 (pending,
   * 0, now()). Writing them here would be a second place for the policy to
   * live, and a fresh row must be immediately claimable.
   */
  it("leaves the scheduling columns to the database defaults", async () => {
    await enqueueGhlEvent(makeDb(), input());
    const values = inserts[0].values;
    expect(values).not.toHaveProperty("status");
    expect(values).not.toHaveProperty("attempts");
    expect(values).not.toHaveProperty("next_attempt_at");
  });

  it("normalises the email, because that is the GHL join key", async () => {
    await enqueueGhlEvent(makeDb(), input({ contactEmail: "  Owner@Example.COM \n" }));
    expect(inserts[0].values.contact_email).toBe("owner@example.com");
  });

  /**
   * The non-ASCII apostrophe and en dash in the inactivity tags are
   * load-bearing: folding either one creates a different tag in GHL with no
   * workflow attached. The outbox trims and dedupes and does nothing else.
   */
  it("passes tag strings through untouched apart from trimming and deduping", async () => {
    await enqueueGhlEvent(
      makeDb(),
      input({
        tagsAdd: [` ${TAG_INACTIVE_30} `, TAG_INACTIVE_30, "", "   "],
        tagsRemove: [TAG_FOUNDER],
      })
    );
    expect(inserts[0].values.tags_add).toEqual([TAG_INACTIVE_30]);
    expect(inserts[0].values.tags_remove).toEqual([TAG_FOUNDER]);
  });

  it("carries a dedupe key and a payload when given them", async () => {
    await enqueueGhlEvent(
      makeDb(),
      input({ dedupeKey: "evt_123:buyer_state", payload: { plan: "pro" } })
    );
    expect(inserts[0].values).toMatchObject({
      dedupe_key: "evt_123:buyer_state",
      payload: { plan: "pro" },
    });
  });

  it("accepts a person-level event with no company", async () => {
    await enqueueGhlEvent(
      makeDb(),
      input({ eventType: "first_login", companyId: null, userId: "user-9" })
    );
    expect(inserts[0].values).toMatchObject({ company_id: null, user_id: "user-9" });
  });
});

describe("enqueueGhlEvent — when it refuses", () => {
  /**
   * OFF MEANS NO ROW. A queue filling up behind a switched-off integration
   * would flood the client's CRM with stale lifecycle tags the moment someone
   * enabled it.
   */
  it("skips without writing anything when the integration is not on", async () => {
    for (const config of [OFF, UNAVAILABLE, UNCONFIGURED]) {
      const result = await enqueueGhlEvent(makeDb(), input({ config }));
      expect(result).toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
    }
    expect(inserts).toEqual([]);
  });

  /** A dry run must exercise the whole path, so it still enqueues. */
  it("still enqueues on a dry run", async () => {
    const result = await enqueueGhlEvent(makeDb(), input({ config: DRY }));
    expect(result).toMatchObject({ outcome: "enqueued" });
    expect(inserts).toHaveLength(1);
  });

  it("refuses when there is no usable email", async () => {
    for (const email of ["", "   ", "\t\n"]) {
      const result = await enqueueGhlEvent(makeDb(), input({ contactEmail: email }));
      expect(result).toEqual({ ok: true, outcome: "skipped", reason: "no_email" });
    }
    expect(inserts).toEqual([]);
  });

  /** A row with both lists empty would upsert a contact to write no tags. */
  it("refuses when there is nothing to add and nothing to remove", async () => {
    for (const tags of [
      { tagsAdd: [], tagsRemove: [] },
      { tagsAdd: undefined, tagsRemove: undefined },
      { tagsAdd: ["  ", ""], tagsRemove: [""] },
    ]) {
      const result = await enqueueGhlEvent(makeDb(), input(tags));
      expect(result).toEqual({ ok: true, outcome: "skipped", reason: "nothing_to_do" });
    }
    expect(inserts).toEqual([]);
  });
});

describe("enqueueGhlEvent — dedupe and failure", () => {
  /**
   * The partial unique index is the arbiter, not an `on_conflict` clause:
   * PostgREST cannot express the index predicate, so the insert is plain and a
   * 23505 is read as "already enqueued" — the stripe_webhook_events idiom.
   */
  it("reads a unique violation as a duplicate, not an error", async () => {
    insertError = { code: "23505", message: 'duplicate key value violates "uq_ghl_events_dedupe"' };

    const result = await enqueueGhlEvent(makeDb(), input({ dedupeKey: "evt_1:founder" }));

    expect(result).toEqual({ ok: true, outcome: "duplicate", id: null });
    // The insert was attempted: that is what makes the race safe.
    expect(inserts).toHaveLength(1);
  });

  it("reports any other database error as failed", async () => {
    insertError = { code: "42501", message: "permission denied for table ghl_events" };

    const result = await enqueueGhlEvent(makeDb(), input());

    expect(result).toEqual({
      ok: false,
      outcome: "failed",
      message: "permission denied for table ghl_events",
    });
  });

  it("counts an insert as enqueued even when the id cannot be read back", async () => {
    insertData = null;
    const result = await enqueueGhlEvent(makeDb(), input());
    expect(result).toEqual({ ok: true, outcome: "enqueued", id: null });
  });

  /**
   * THE INVARIANT THIS MODULE EXISTS FOR. The callers are the Stripe webhook,
   * intake build, plan generation and login. A CRM side effect must never cost
   * a payment, a plan or a sign-in.
   */
  it("never throws, whatever the client does", async () => {
    await expect(enqueueGhlEvent(throwingDb, input())).resolves.toEqual({
      ok: false,
      outcome: "failed",
      message: "boom",
    });
  });

  it("never throws when the config read itself throws", async () => {
    // No config passed, so it loads one — against a client that throws.
    const result = await enqueueGhlEvent(throwingDb, input({ config: undefined }));
    // loadGhlConfig fails closed to `unavailable`, so this is a skip, not a
    // crash and not a write.
    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
  });

  /** Nothing in this path may put a credential in a log line. */
  it("never logs the token", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });

    insertError = { code: "42501", message: "nope" };
    await enqueueGhlEvent(makeDb(), input());

    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join("\n")).not.toContain("pit-secret-value");
  });
});

/* ------------------------------------------------------------------ *
 * Delivery scheduling
 * ------------------------------------------------------------------ */

/**
 * THE OUTBOX HAS NO CRON OF ITS OWN. Hobby allows two cron jobs and daily
 * schedules only, so routine delivery is opportunistic: a new row asks for a
 * small drain once the response has been sent. Which makes "did we ask" a
 * correctness property of this module rather than a detail — a row nobody
 * drains waits for tomorrow's safety-net sweep.
 */
describe("enqueueGhlEvent — asking for delivery", () => {
  it("schedules a drain with the same client when a row is written", async () => {
    const db = makeDb();
    await enqueueGhlEvent(db, input());

    expect(scheduleGhlDrain).toHaveBeenCalledTimes(1);
    // The caller's service-role client, reused rather than rebuilt.
    expect(scheduleGhlDrain).toHaveBeenCalledWith(db);
  });

  /** A dry run exercises the whole path, delivery included. */
  it("schedules a drain on a dry run too", async () => {
    await enqueueGhlEvent(makeDb(), input({ config: DRY }));
    expect(scheduleGhlDrain).toHaveBeenCalledTimes(1);
  });

  /**
   * NOTHING NEW TO DELIVER MEANS NO DRAIN. A duplicate is already queued or
   * already sent, a skip wrote nothing, and a failed insert left nothing
   * behind — in all three a drain would spend a query to discover that.
   */
  it("does not schedule a drain on a duplicate", async () => {
    insertError = { code: "23505", message: "duplicate key value" };
    const result = await enqueueGhlEvent(makeDb(), input({ dedupeKey: "evt_1:founder" }));

    expect(result).toMatchObject({ outcome: "duplicate" });
    expect(scheduleGhlDrain).not.toHaveBeenCalled();
  });

  it("does not schedule a drain on any skip", async () => {
    await enqueueGhlEvent(makeDb(), input({ config: OFF }));
    await enqueueGhlEvent(makeDb(), input({ contactEmail: "  " }));
    await enqueueGhlEvent(makeDb(), input({ tagsAdd: [], tagsRemove: [] }));

    expect(scheduleGhlDrain).not.toHaveBeenCalled();
  });

  it("does not schedule a drain when the insert failed", async () => {
    insertError = { code: "42501", message: "permission denied" };
    const result = await enqueueGhlEvent(makeDb(), input());

    expect(result).toMatchObject({ outcome: "failed" });
    expect(scheduleGhlDrain).not.toHaveBeenCalled();
  });

  /**
   * The opt-out, for the callers that are already delivering or are writing in
   * bulk: a drain scheduling a drain, or a backfill asking for one per row.
   */
  it("suppresses the drain when the caller opts out", async () => {
    const result = await enqueueGhlEvent(makeDb(), input({ scheduleDrain: false }));

    expect(result).toMatchObject({ outcome: "enqueued" });
    expect(scheduleGhlDrain).not.toHaveBeenCalled();
  });
});
