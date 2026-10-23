import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  defaultSubscriptionRow,
  ensureSubscriptionRow,
  afterSubscriptionUpdate,
} from "./subscription-row";
import { evaluateAccess } from "./entitlement";

/**
 * An in-memory `subscriptions` table with the one behaviour that matters:
 * a UNIQUE company_id, and upsert-with-ignoreDuplicates = ON CONFLICT DO
 * NOTHING (returns only the rows it inserted).
 */
function fakeDb(initial: Record<string, unknown>[] = []) {
  const rows = initial.map((r) => ({ ...r }));
  const calls: { table: string; options: unknown }[] = [];
  const db = {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>, options: { onConflict?: string; ignoreDuplicates?: boolean }) {
          calls.push({ table, options });
          return {
            select: async () => {
              const exists = rows.some((r) => r.company_id === row.company_id);
              if (exists && options.ignoreDuplicates) return { data: [], error: null };
              if (exists) {
                // Would be an overwrite — the helper must never ask for this.
                throw new Error("upsert without ignoreDuplicates would overwrite");
              }
              const inserted = { id: `sub-${rows.length + 1}`, ...row };
              rows.push(inserted);
              return { data: [{ id: inserted.id }], error: null };
            },
          };
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, rows, calls };
}

describe("ensureSubscriptionRow", () => {
  it("inserts the default row when the company has none", async () => {
    const { db, rows, calls } = fakeDb();
    const result = await ensureSubscriptionRow(db, "company-1");

    expect(result).toEqual({ ok: true, created: true });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      company_id: "company-1",
      status: "cancelled",
      plan_id: null,
      is_trial_active: false,
      trial_ends_at: null,
    });
    expect(calls[0]).toEqual({
      table: "subscriptions",
      options: { onConflict: "company_id", ignoreDuplicates: true },
    });
  });

  it("leaves an existing row untouched", async () => {
    const existing = {
      id: "sub-x",
      company_id: "company-1",
      status: "active",
      plan_id: "plan-pro",
      is_comped: true,
      stripe_customer_id: "cus_123",
    };
    const { db, rows } = fakeDb([existing]);
    const result = await ensureSubscriptionRow(db, "company-1");

    expect(result).toEqual({ ok: true, created: false });
    expect(rows).toEqual([existing]);
  });

  it("reports a database error instead of throwing", async () => {
    const db = {
      from: () => ({
        upsert: () => ({ select: async () => ({ data: null, error: { message: "boom" } }) }),
      }),
    } as unknown as SupabaseClient;
    expect(await ensureSubscriptionRow(db, "company-1")).toEqual({ ok: false, error: "boom" });
  });

  it("refuses an empty company id without touching the database", async () => {
    const { db, calls } = fakeDb();
    expect(await ensureSubscriptionRow(db, "")).toEqual({ ok: false, error: "companyId required" });
    expect(calls).toHaveLength(0);
  });
});

describe("defaultSubscriptionRow", () => {
  it("never grants a trial or a plan", () => {
    const row = defaultSubscriptionRow("c", new Date("2026-10-23T00:00:00Z"));
    expect(row).toEqual({
      company_id: "c",
      tier: "none",
      status: "cancelled",
      billing_cycle: "monthly",
      plan_id: null,
      is_trial_active: false,
      trial_ends_at: null,
      start_date: "2026-10-23T00:00:00.000Z",
    });
  });

  it("is read by evaluateAccess as no access while billing is on", () => {
    const row = defaultSubscriptionRow("c");
    const decision = evaluateAccess(
      { stripeEnabled: true, trialEnabled: true, trialDays: 14, dunningGraceDays: 7 },
      {
        status: row.status as never,
        isComped: false,
        compedUntil: null,
        trialEndsAt: row.trial_ends_at,
        currentPeriodEnd: null,
        pastDueSince: null,
        cancelAtPeriodEnd: false,
      }
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("afterSubscriptionUpdate (webhook zero-row decision)", () => {
  it("is done when the update touched a row", () => {
    expect(afterSubscriptionUpdate(1, 1)).toBe("done");
    expect(afterSubscriptionUpdate(1, 2)).toBe("done");
  });

  it("ensures and retries once on the first zero-row update", () => {
    expect(afterSubscriptionUpdate(0, 1)).toBe("ensure_and_retry");
  });

  it("gives up after the retry also matches nothing", () => {
    expect(afterSubscriptionUpdate(0, 2)).toBe("give_up");
  });
});
