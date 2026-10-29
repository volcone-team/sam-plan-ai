import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadCallGateSettings,
  readCallGateSettings,
  stampCallUnlockForNewCompany,
  NEW_COMPANY_STAMP_GRACE_MS,
  CALL_GATE_OFF,
} from "./call-gate-settings";

/* ── Mocked Supabase ─────────────────────────────────────────────────────────
 * Records every query chain and answers by table, so a test can assert both
 * what was asked and what was decided. Same shape as
 * src/lib/billing/company-access.test.ts.
 */
type Call = { table: string; method: string; args: unknown[] };
let calls: Call[] = [];
let responses: Record<string, { data: unknown; error: unknown }> = {};
let updates: { table: string; values: unknown }[] = [];

function makeDb(): SupabaseClient {
  const db = {
    from(table: string) {
      calls.push({ table, method: "from", args: [table] });
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "not"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.update = (values: unknown) => {
        calls.push({ table, method: "update", args: [values] });
        updates.push({ table, values });
        // An update resolves when awaited; .eq()/.is() keep chaining first.
        const chain: Record<string, unknown> = {};
        for (const method of ["eq", "is"]) {
          chain[method] = (...args: unknown[]) => {
            calls.push({ table, method, args });
            return chain;
          };
        }
        chain.then = (
          resolve: (v: { data: unknown; error: unknown }) => unknown
        ) => resolve(responses[`${table}:update`] ?? { data: null, error: null });
        return chain;
      };
      builder.maybeSingle = () => {
        calls.push({ table, method: "maybeSingle", args: [] });
        // A response keyed by the exact column list wins, so a test can answer
        // the with-048 select and the 043-only retry differently.
        const lastSelect = [...calls]
          .reverse()
          .find((c) => c.table === table && c.method === "select");
        const byColumns = lastSelect ? responses[`${table}|${String(lastSelect.args[0])}`] : undefined;
        return Promise.resolve(byColumns ?? responses[table] ?? { data: null, error: null });
      };
      return builder;
    },
  };
  return db as unknown as SupabaseClient;
}

/** PostgREST's "column does not exist" — what an unapplied 043 looks like. */
const MISSING_COLUMN = {
  code: "42703",
  message: "column app_settings.require_call_before_access does not exist",
};

const BOOKING = "https://calendar.example.com/sam/onboarding";

beforeEach(() => {
  calls = [];
  updates = [];
  responses = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadCallGateSettings", () => {
  it("reads the switch and the booking link off the singleton", async () => {
    responses.app_settings = {
      data: { require_call_before_access: true, onboarding_call_url: BOOKING },
      error: null,
    };

    expect(await loadCallGateSettings(makeDb())).toEqual({
      requireCall: true,
      bookingUrl: BOOKING,
      bookingUrlYearly: null,
    });

    const settingsCalls = calls.filter((c) => c.table === "app_settings");
    expect(settingsCalls.find((c) => c.method === "eq")?.args).toEqual(["id", "global"]);
  });

  it("is off when the switch is off", async () => {
    responses.app_settings = {
      data: { require_call_before_access: false, onboarding_call_url: BOOKING },
      error: null,
    };
    expect(await loadCallGateSettings(makeDb())).toEqual({
      requireCall: false,
      bookingUrl: BOOKING,
      bookingUrlYearly: null,
    });
  });

  /**
   * The case that matters most: migration 043 is applied by hand, so this code
   * ships before the columns exist. Nobody may be gated by a migration that
   * has not been run.
   */
  it("defaults to off when the column does not exist", async () => {
    responses.app_settings = { data: null, error: MISSING_COLUMN };
    expect(await loadCallGateSettings(makeDb())).toEqual(CALL_GATE_OFF);
  });

  it("defaults to off when the read fails for any other reason", async () => {
    responses.app_settings = { data: null, error: { code: "08006", message: "connection failure" } };
    expect(await loadCallGateSettings(makeDb())).toEqual(CALL_GATE_OFF);
  });

  it("defaults to off when there is no singleton row", async () => {
    responses.app_settings = { data: null, error: null };
    expect(await loadCallGateSettings(makeDb())).toEqual(CALL_GATE_OFF);
  });

  it("defaults to off when the client throws", async () => {
    const db = {
      from() {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    expect(await loadCallGateSettings(db)).toEqual(CALL_GATE_OFF);
  });

  it("treats a null switch as off rather than on", async () => {
    responses.app_settings = {
      data: { require_call_before_access: null, onboarding_call_url: null },
      error: null,
    };
    expect((await loadCallGateSettings(makeDb())).requireCall).toBe(false);
  });

  /**
   * Re-validated on the way out: the value is typed into an admin field and
   * rendered as a link a paying customer clicks.
   */
  it("drops a booking URL it would not render", async () => {
    for (const url of ["javascript:alert(1)", "http://insecure.example.com", "not a url", "", 42]) {
      responses.app_settings = {
        data: { require_call_before_access: true, onboarding_call_url: url },
        error: null,
      };
      expect((await loadCallGateSettings(makeDb())).bookingUrl).toBeNull();
    }
  });

  it("trims the booking URL it stores", async () => {
    responses.app_settings = {
      data: { require_call_before_access: true, onboarding_call_url: `  ${BOOKING}  ` },
      error: null,
    };
    expect((await loadCallGateSettings(makeDb())).bookingUrl).toBe(BOOKING);
  });
});

describe("the yearly booking link (migration 048)", () => {
  const YEARLY = "https://calendar.example.com/sam/onboarding-yearly";
  const WITH_048 =
    "app_settings|require_call_before_access, onboarding_call_url, onboarding_call_url_yearly";
  const WITHOUT_048 = "app_settings|require_call_before_access, onboarding_call_url";
  const MISSING_YEARLY = {
    code: "42703",
    message: "column app_settings.onboarding_call_url_yearly does not exist",
  };

  it("reads the yearly link alongside the monthly one", async () => {
    responses.app_settings = {
      data: {
        require_call_before_access: true,
        onboarding_call_url: BOOKING,
        onboarding_call_url_yearly: `  ${YEARLY}  `,
      },
      error: null,
    };
    expect(await readCallGateSettings(makeDb())).toEqual({
      requireCall: true,
      bookingUrl: BOOKING,
      bookingUrlYearly: YEARLY,
      available: true,
      yearlyAvailable: true,
    });
  });

  it("drops a yearly link it would not render", async () => {
    responses.app_settings = {
      data: {
        require_call_before_access: true,
        onboarding_call_url: BOOKING,
        onboarding_call_url_yearly: "javascript:alert(1)",
      },
      error: null,
    };
    expect((await loadCallGateSettings(makeDb())).bookingUrlYearly).toBeNull();
  });

  /**
   * The case that matters: before 048 is applied the combined select fails,
   * and that must not read as "settings unreadable, gate off".
   */
  for (const [label, missing] of [
    ["42703", MISSING_YEARLY],
    [
      "PGRST204",
      {
        code: "PGRST204",
        message: "Could not find the 'onboarding_call_url_yearly' column of 'app_settings' in the schema cache",
      },
    ],
  ] as const) {
    it(`keeps the gate and the monthly link when the yearly column is missing (${label})`, async () => {
      responses[WITH_048] = { data: null, error: missing };
      responses[WITHOUT_048] = {
        data: { require_call_before_access: true, onboarding_call_url: BOOKING },
        error: null,
      };

      expect(await readCallGateSettings(makeDb())).toEqual({
        requireCall: true,
        bookingUrl: BOOKING,
        bookingUrlYearly: null,
        available: true,
        yearlyAvailable: false,
      });
      expect(console.error).not.toHaveBeenCalled();
    });
  }

  it("still stamps new companies when only 048 is missing", async () => {
    responses[WITH_048] = { data: null, error: MISSING_YEARLY };
    responses[WITHOUT_048] = {
      data: { require_call_before_access: true, onboarding_call_url: BOOKING },
      error: null,
    };
    responses.companies = {
      data: {
        id: "co-1",
        created_at: new Date().toISOString(),
        requires_call_unlock: false,
        portal_access_granted_at: null,
      },
      error: null,
    };

    expect((await stampCallUnlockForNewCompany(makeDb(), "co-1")).stamped).toBe(true);
  });

  it("does not retry on a failure that is not a missing column", async () => {
    responses.app_settings = { data: null, error: { code: "08006", message: "connection failure" } };
    expect(await readCallGateSettings(makeDb())).toMatchObject({
      requireCall: false,
      available: true,
      yearlyAvailable: true,
    });
    expect(calls.filter((c) => c.table === "app_settings" && c.method === "select")).toHaveLength(1);
  });
});

describe("readCallGateSettings", () => {
  it("reports the migration as missing so the admin screen can say so", async () => {
    responses.app_settings = { data: null, error: MISSING_COLUMN };
    expect(await readCallGateSettings(makeDb())).toMatchObject({
      requireCall: false,
      available: false,
      yearlyAvailable: false,
    });
  });

  it("reports available when the columns exist", async () => {
    responses.app_settings = {
      data: { require_call_before_access: false, onboarding_call_url: null },
      error: null,
    };
    expect((await readCallGateSettings(makeDb())).available).toBe(true);
  });
});

describe("stampCallUnlockForNewCompany", () => {
  const NOW = Date.parse("2026-10-12T12:00:00Z");

  function switchOn() {
    responses.app_settings = {
      data: { require_call_before_access: true, onboarding_call_url: BOOKING },
      error: null,
    };
  }

  function company(over: Record<string, unknown> = {}) {
    responses.companies = {
      data: {
        id: "co-1",
        created_at: new Date(NOW - 1000).toISOString(),
        requires_call_unlock: false,
        portal_access_granted_at: null,
        ...over,
      },
      error: null,
    };
  }

  it("stamps true when the switch is on", async () => {
    switchOn();
    company();

    const out = await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW });

    expect(out).toEqual({ stamped: true, requireCall: true, reason: "stamped" });
    expect(updates).toEqual([{ table: "companies", values: { requires_call_unlock: true } }]);
  });

  it("stamps nothing when the switch is off, and does not even read the company", async () => {
    responses.app_settings = {
      data: { require_call_before_access: false, onboarding_call_url: null },
      error: null,
    };
    company();

    const out = await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW });

    expect(out).toEqual({ stamped: false, requireCall: false, reason: "switch_off" });
    expect(updates).toEqual([]);
    expect(calls.some((c) => c.table === "companies")).toBe(false);
  });

  /** An unapplied migration must gate nobody. */
  it("stamps nothing when the setting column is missing", async () => {
    responses.app_settings = { data: null, error: MISSING_COLUMN };
    company();

    const out = await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW });

    expect(out).toEqual({ stamped: false, requireCall: false, reason: "switch_off" });
    expect(updates).toEqual([]);
  });

  /**
   * The rule that protects existing customers. The public signup's company row
   * is written by a database trigger, so the stamp happens on the account's
   * first server-side request — which an ESTABLISHED customer also makes.
   */
  it("stamps a company of any age by default (no ten-minute window, Oct 2026)", async () => {
    // A customer who registered and paid later must still be gated.
    switchOn();
    company({ created_at: new Date(NOW - 36 * 60 * 1000).toISOString() });

    const out = await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW });

    expect(out).toEqual({ stamped: true, requireCall: true, reason: "stamped" });
  });

  it("still honours an explicit age window from a caller", async () => {
    switchOn();
    company({ created_at: new Date(NOW - NEW_COMPANY_STAMP_GRACE_MS - 1).toISOString() });

    const out = await stampCallUnlockForNewCompany(makeDb(), "co-1", {
      now: NOW,
      maxAgeMs: NEW_COMPANY_STAMP_GRACE_MS,
    });

    expect(out).toEqual({ stamped: false, requireCall: true, reason: "too_old" });
    expect(updates).toEqual([]);
  });

  it("stamps a company created just inside the grace window", async () => {
    switchOn();
    company({ created_at: new Date(NOW - NEW_COMPANY_STAMP_GRACE_MS + 1000).toISOString() });

    expect((await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW })).stamped).toBe(true);
  });

  it("with an explicit window, refuses a company whose created_at cannot be read", async () => {
    switchOn();
    company({ created_at: null });

    expect(
      (await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW, maxAgeMs: NEW_COMPANY_STAMP_GRACE_MS })).reason
    ).toBe("too_old");
  });

  it("skips the age check for a caller that just created the row", async () => {
    // The admin create-company route: the age check has nothing to tell it.
    switchOn();
    company({ created_at: new Date(NOW - 10 * NEW_COMPANY_STAMP_GRACE_MS).toISOString() });

    const out = await stampCallUnlockForNewCompany(makeDb(), "co-1", {
      now: NOW,
      maxAgeMs: null,
    });

    expect(out.stamped).toBe(true);
  });

  it("does not re-stamp a company that is already flagged", async () => {
    switchOn();
    company({ requires_call_unlock: true });

    const out = await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW });

    expect(out).toEqual({ stamped: false, requireCall: true, reason: "already_decided" });
    expect(updates).toEqual([]);
  });

  /** Re-running must never re-lock someone who has already had their call. */
  it("does not touch a company that has already been granted access", async () => {
    switchOn();
    company({ requires_call_unlock: false, portal_access_granted_at: "2026-10-11T09:00:00Z" });

    const out = await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW });

    expect(out.reason).toBe("already_decided");
    expect(updates).toEqual([]);
  });

  it("re-asserts the no-grant condition in the update itself", async () => {
    switchOn();
    company();
    await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW });

    const guarded = calls.some(
      (c) =>
        c.table === "companies" &&
        c.method === "is" &&
        Array.isArray(c.args) &&
        c.args[0] === "portal_access_granted_at"
    );
    expect(guarded).toBe(true);
  });

  it("reports unavailable rather than throwing when the company cannot be read", async () => {
    switchOn();
    responses.companies = { data: null, error: { code: "42703", message: "column does not exist" } };

    const out = await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW });

    expect(out).toEqual({ stamped: false, requireCall: true, reason: "unavailable" });
    expect(updates).toEqual([]);
  });

  it("reports unavailable rather than throwing when the update fails", async () => {
    switchOn();
    company();
    responses["companies:update"] = { data: null, error: { code: "42703", message: "no column" } };

    const out = await stampCallUnlockForNewCompany(makeDb(), "co-1", { now: NOW });

    expect(out).toEqual({ stamped: false, requireCall: true, reason: "unavailable" });
  });

  it("never throws, whatever the client does", async () => {
    const db = {
      from(table: string) {
        if (table === "app_settings") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
              data: { require_call_before_access: true, onboarding_call_url: null },
              error: null,
            }) }) }),
          };
        }
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;

    await expect(stampCallUnlockForNewCompany(db, "co-1")).resolves.toEqual({
      stamped: false,
      requireCall: true,
      reason: "unavailable",
    });
  });
});
