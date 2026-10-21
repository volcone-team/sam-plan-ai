import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  enqueueCancellationEvent,
  cancellationDedupeKey,
  decideCancellationTags,
} from "./cancellation";
import { buyerStateDedupeKey } from "./subscription";
import type { GhlConfig } from "../config";
import { TAG_CANCELLATION } from "../tags";

/* ── Mocked Supabase ─────────────────────────────────────────────────────────
 * The same builder as subscription.test.ts, minus nothing: this producer reads
 * fewer tables (no plan names — the tag is a fixed string) but the shapes it
 * does use are identical, so the fake is kept recognisable rather than trimmed.
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
const EVENT = "evt_1KxTest";

beforeEach(() => {
  tables = {
    profiles: {
      rows: [
        // A member as well as the owner: "owner only" has to be enforced by
        // the query, not by there being nobody else to pick.
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
    isEnding: true,
    status: "active",
    stripeEventId: EVENT,
    stripeEventType: "customer.subscription.updated",
    source: "stripe_webhook",
    config: LIVE,
    ...over,
  } as Parameters<typeof enqueueCancellationEvent>[1];
}

/* ── The decision ─────────────────────────────────────────────────────────── */

describe("decideCancellationTags — the state, not the transition", () => {
  it("adds the tag while a cancellation is pending", () => {
    // Still `active`: they keep paid access until period end, which is exactly
    // when a save-the-customer workflow is worth running.
    expect(decideCancellationTags({ isEnding: true, status: "active" })).toEqual({
      action: "add",
      reason: "ending",
      status: "active",
    });
  });

  it("removes the tag once the subscription is renewing again", () => {
    expect(decideCancellationTags({ isEnding: false, status: "active" })).toEqual({
      action: "remove",
      reason: "renewing",
      status: "active",
    });
  });

  /**
   * Dunning is not churn. Stripe is still retrying the card and evaluateAccess
   * still grants access, so a past_due customer who is not ending is renewing —
   * the same call buyerPresenceForStatus makes.
   */
  it("treats past_due and a trial as renewing", () => {
    expect(decideCancellationTags({ isEnding: false, status: "past_due" }).action).toBe("remove");
    expect(decideCancellationTags({ isEnding: false, status: "trialing" }).action).toBe("remove");
  });

  /**
   * They did cancel, so the tag is TRUE and stripping it would be a lie. The
   * buyer tag carries the active/inactive distinction instead. Both spellings,
   * because the type says `canceled` and mapStripeStatus writes `cancelled`.
   */
  it("leaves the tag alone once the cancellation has actually completed", () => {
    for (const status of ["cancelled", "canceled", "unpaid", "incomplete_expired"]) {
      expect(decideCancellationTags({ isEnding: false, status })).toMatchObject({
        action: "none",
        reason: "expired",
      });
    }
  });

  /**
   * No information is not a reason to add or to strip. A Stripe pause is not a
   * cancellation and does not reverse one; an unknown status must not be
   * guessed into a workflow.
   */
  it("does nothing when the state says nothing either way", () => {
    for (const status of ["paused", "incomplete", "", null, undefined, "something_new"]) {
      expect(decideCancellationTags({ isEnding: false, status })).toMatchObject({
        action: "none",
        reason: "no_signal",
      });
    }
  });

  it("reads ending first, so a pending cancellation outranks the status", () => {
    // An `active` subscription that is ending is the normal pending shape.
    expect(decideCancellationTags({ isEnding: true, status: "past_due" }).action).toBe("add");
    expect(decideCancellationTags({ isEnding: true, status: "trialing" }).action).toBe("add");
  });
});

/* ── The producer ─────────────────────────────────────────────────────────── */

describe("enqueueCancellationEvent — adding the tag", () => {
  it("enqueues one cancellation row for the owner", async () => {
    const result = await enqueueCancellationEvent(makeDb(), input());

    expect(result).toMatchObject({ ok: true, outcome: "enqueued", action: "add" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe("ghl_events");
    expect(inserts[0].values).toMatchObject({
      event_type: "cancellation",
      company_id: COMPANY,
      // The OWNER, never the member. A team member in a churn workflow is
      // somebody else's billing email landing in their inbox.
      user_id: "owner-1",
      contact_email: "owner@example.com",
      tags_add: [TAG_CANCELLATION],
      dedupe_key: `stripe:${EVENT}:cancellation`,
    });
    // One side or the other, never both: the add and the remove are the same
    // tag, and a row carrying both would depend on GHL's call ordering.
    expect(inserts[0].values.tags_remove).toEqual([]);
  });

  /**
   * The payload is rendered on an admin screen and sits in every backup.
   */
  it("carries debugging context and no secrets in the payload", async () => {
    await enqueueCancellationEvent(makeDb(), input());

    const payload = inserts[0].values.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      action: "add",
      reason: "ending",
      isEnding: true,
      status: "active",
      source: "stripe_webhook",
      stripeEventType: "customer.subscription.updated",
      // Read by deliverGhlRow and passed to the contact upsert.
      firstName: "Olive",
      lastName: "Owner",
      companyName: "Volcone Ltd",
    });
    expect(JSON.stringify(payload)).not.toContain("pit-secret-value");
  });
});

describe("enqueueCancellationEvent — taking the tag off", () => {
  /**
   * THE REASON THE TAG IS A STATE. The retention flow genuinely saves people
   * and /api/billing/reactivate exists to undo a pending cancellation; a
   * customer who stays must not sit in a churn sequence.
   */
  it("enqueues a removal when the cancellation has been reversed", async () => {
    const result = await enqueueCancellationEvent(
      makeDb(),
      input({ isEnding: false, status: "active", source: "billing_reactivate" })
    );

    expect(result).toMatchObject({ ok: true, outcome: "enqueued", action: "remove" });
    expect(inserts[0].values).toMatchObject({
      tags_remove: [TAG_CANCELLATION],
      tags_add: [],
    });
  });

  /**
   * THE REPURCHASE, and the point is that there is no special case for it. A
   * customer who cancelled, lapsed, and later bought again arrives as a fresh
   * active, not-ending subscription and the tag comes off by the same rule as
   * a reactivation. Leaving it on would keep a paying customer in a win-back
   * sequence aimed at people who left.
   */
  it("removes the tag for a lapsed customer who repurchases, with no special case", async () => {
    const result = await enqueueCancellationEvent(
      makeDb(),
      // The shape of a brand-new subscription after Checkout.
      input({ isEnding: false, status: "active", stripeEventType: "invoice.paid" })
    );

    expect(result).toMatchObject({ ok: true, outcome: "enqueued", action: "remove" });
    expect(inserts[0].values.tags_remove).toEqual([TAG_CANCELLATION]);
    expect((inserts[0].values.payload as Record<string, unknown>).reason).toBe("renewing");
  });

  it("writes no dedupe key when there is no Stripe event behind the call", async () => {
    // The cancel and reactivate routes: a user-initiated action that happened
    // once, so it enqueues unconditionally.
    await enqueueCancellationEvent(
      makeDb(),
      input({ stripeEventId: null, source: "billing_cancel" })
    );
    expect(inserts[0].values.dedupe_key).toBeNull();
  });
});

describe("enqueueCancellationEvent — when it does nothing", () => {
  /**
   * THE CHEAPEST PATH, AND THE CURRENT ONE. `ghl_enabled` is false in the live
   * database, so this is where every real webhook lands today.
   */
  it("does nothing at all — not even a query — when the integration is off", async () => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueCancellationEvent(db, input({ config: OFF }));

    expect(result).toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
    expect(spy).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  /**
   * The decision is pure and comes BEFORE the owner lookup, so the common
   * no-op case costs no queries either.
   */
  it("enqueues nothing, and reads nothing, when the state says nothing", async () => {
    const db = makeDb();
    const spy = vi.spyOn(db, "from");

    const result = await enqueueCancellationEvent(
      db,
      input({ isEnding: false, status: "cancelled" })
    );

    expect(result).toEqual({
      ok: true,
      outcome: "skipped",
      reason: "no_signal",
      detail: "expired",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("enqueues nothing when the company has no owner", async () => {
    tables.profiles.rows = tables.profiles.rows.filter((r) => r.role !== "owner");

    const result = await enqueueCancellationEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: true,
      outcome: "skipped",
      reason: "no_owner_contact",
      detail: "no_owner",
    });
    expect(inserts).toEqual([]);
  });
});

describe("enqueueCancellationEvent — redelivery and failure", () => {
  it("treats the same Stripe event twice as one row", async () => {
    const first = await enqueueCancellationEvent(makeDb(), input());
    expect(first).toMatchObject({ outcome: "enqueued" });

    insertError = {
      code: "23505",
      message: 'duplicate key value violates "uq_ghl_events_dedupe"',
    };
    const second = await enqueueCancellationEvent(makeDb(), input());

    expect(second).toMatchObject({ ok: true, outcome: "duplicate" });
    expect(inserts[0].values.dedupe_key).toBe(inserts[1].values.dedupe_key);
  });

  it("reports an insert failure without throwing", async () => {
    insertError = { code: "42501", message: "permission denied for table ghl_events" };

    const result = await enqueueCancellationEvent(makeDb(), input());

    expect(result).toMatchObject({
      ok: false,
      outcome: "failed",
      reason: "enqueue_failed",
      message: "permission denied for table ghl_events",
    });
  });

  /**
   * THE PROPERTY TWO OF THE THREE CALLERS DEPEND ON. A throw from the webhook
   * is a non-2xx from the only writer of subscription state, and Stripe would
   * redeliver a PAYMENT event for the sake of a marketing tag; a throw from the
   * cancel route would report a completed cancellation as failed.
   */
  it("never propagates a thrown database call", async () => {
    /*
     * RESOLVES, and resolves to a SKIP rather than a failure — which is worth
     * pinning rather than loosening to "does not reject". Every await in this
     * producer is itself a never-throws function, so a client that throws on
     * `from()` is absorbed by `resolveGhlOwnerContact` (which reports it as
     * `read_failed`) and never reaches this module's own catch. That catch is
     * belt and braces, and this test says so: the contract holds by
     * construction, not by rescue.
     */
    await expect(
      enqueueCancellationEvent(throwingDb, input())
    ).resolves.toEqual({
      ok: true,
      outcome: "skipped",
      reason: "no_owner_contact",
      detail: "read_failed",
    });
  });

  it("never throws when the config has to be loaded against a broken client", async () => {
    // loadGhlConfig fails closed to `unavailable`, so this is a skip.
    await expect(
      enqueueCancellationEvent(throwingDb, input({ config: undefined }))
    ).resolves.toEqual({ ok: true, outcome: "skipped", reason: "integration_off" });
  });
});

describe("cancellationDedupeKey", () => {
  it("pins the shape: stripe:{eventId}:cancellation", () => {
    expect(cancellationDedupeKey("evt_123")).toBe("stripe:evt_123:cancellation");
  });

  /**
   * THE COLLISION THIS SUFFIX EXISTS TO PREVENT, and it is no longer
   * hypothetical: both producers now fire from the same Stripe event at the end
   * of the same syncSubscription. 044's unique index is on
   * (sub_account, dedupe_key) with NO event_type, so a bare event id would have
   * the second insert hit 23505, be reported as a `duplicate` — a success — and
   * the tag would never be written, silently, with no error to find.
   */
  it("cannot collide with the buyer-state key for the same Stripe event", () => {
    expect(cancellationDedupeKey("evt_123")).not.toBe(buyerStateDedupeKey("evt_123"));
  });
});
