import { describe, it, expect, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompanyAccess, COMPANY_SUBSCRIPTION_SELECT } from "./company-access";

// ── Mocked Supabase ─────────────────────────────────────────────────────────
// Records each query chain and answers by table, so the test can assert both
// what was asked and what was decided.
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[] = [];
let responses: Record<string, { data: unknown; error: unknown }> = {};

function makeDb(): SupabaseClient {
  const db = {
    from(table: string) {
      calls.push({ table, method: "from", args: [table] });
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.maybeSingle = () => {
        calls.push({ table, method: "maybeSingle", args: [] });
        return Promise.resolve(responses[table] ?? { data: null, error: null });
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient;
}

const BILLING_ON = {
  stripe_enabled: true, trial_enabled: true, trial_days: 14,
  trial_plan_id: null, trial_requires_card: false, dunning_grace_days: 7,
};

const FUTURE = new Date(Date.now() + 10 * 86_400_000).toISOString();

function sub(over: Record<string, unknown> = {}) {
  return {
    plan_id: "plan-pro", status: "active", stripe_status: "active",
    is_comped: false, comped_until: null, trial_ends_at: null,
    current_period_start: null, current_period_end: FUTURE,
    past_due_since: null, cancel_at_period_end: false,
    is_paused: false, pause_resumes_at: null,
    ...over,
  };
}

beforeEach(() => {
  calls = [];
  responses = { app_settings: { data: BILLING_ON, error: null } };
});

describe("loadCompanyAccess", () => {
  it("reads the company's subscription with the enforce.ts select and returns its plan", async () => {
    responses.subscriptions = { data: sub(), error: null };
    const out = await loadCompanyAccess(makeDb(), "co-1");

    expect(out.planId).toBe("plan-pro");
    expect(out.access).toMatchObject({ allowed: true, reason: "active" });

    const subCalls = calls.filter((c) => c.table === "subscriptions");
    expect(subCalls.find((c) => c.method === "select")?.args).toEqual([COMPANY_SUBSCRIPTION_SELECT]);
    expect(subCalls.find((c) => c.method === "eq")?.args).toEqual(["company_id", "co-1"]);
  });

  it("returns the plan of a comped account", async () => {
    responses.subscriptions = {
      data: sub({ plan_id: "plan-comp", is_comped: true, status: "cancelled", stripe_status: null }),
      error: null,
    };
    const out = await loadCompanyAccess(makeDb(), "co-1");
    expect(out).toMatchObject({ planId: "plan-comp", access: { allowed: true, reason: "comped" } });
  });

  it("keeps planId but denies access when paused", async () => {
    responses.subscriptions = { data: sub({ is_paused: true }), error: null };
    const out = await loadCompanyAccess(makeDb(), "co-1");
    expect(out).toMatchObject({ planId: "plan-pro", access: { allowed: false, reason: "paused" } });
  });

  it("no subscription row → no plan, no_subscription", async () => {
    const out = await loadCompanyAccess(makeDb(), "co-1");
    expect(out).toMatchObject({ planId: null, access: { allowed: false, reason: "no_subscription" } });
  });

  it("billing switched off → allowed as billing_disabled", async () => {
    responses.app_settings = { data: { ...BILLING_ON, stripe_enabled: false }, error: null };
    responses.subscriptions = { data: sub({ plan_id: null, status: "cancelled", stripe_status: null }), error: null };
    const out = await loadCompanyAccess(makeDb(), "co-1");
    expect(out).toMatchObject({ planId: null, access: { allowed: true, reason: "billing_disabled" } });
  });

  it("a null companyId skips the subscriptions query", async () => {
    const out = await loadCompanyAccess(makeDb(), null);
    expect(out.planId).toBeNull();
    expect(calls.some((c) => c.table === "subscriptions")).toBe(false);
  });
});
