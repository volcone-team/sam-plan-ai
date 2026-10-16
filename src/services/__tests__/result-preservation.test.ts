/**
 * Property 2: Preservation (Unit A, Results tab)
 * Results revenue, metrics, notes, expenses and planner behavior unchanged.
 *
 * Written BEFORE the fix by observing today's service outputs for inputs
 * outside isBugCondition_A, then locking them in with seeded generators.
 * EXPECTED OUTCOME on unfixed code: PASS. Task 4.6 re-runs this file after
 * the fix and expects it to still pass.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Mocked Supabase ─────────────────────────────────────────────────────────
// Chainable builder that records every call; awaiting resolves `nextResponse`.
type Call = { method: string; args: unknown[] };
let calls: Call[] = [];
let nextResponse: { data: unknown; error: unknown } = { data: null, error: null };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const method of [
    "from", "delete", "eq", "select", "insert", "update", "single",
    "order", "is", "gte", "lte", "in",
  ]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  builder.then = (resolveFn: (v: unknown) => unknown, rejectFn?: (e: unknown) => unknown) =>
    Promise.resolve(nextResponse).then(resolveFn, rejectFn);
  return builder;
}

vi.mock("@/lib/supabase/db", () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => makeBuilder(),
}));

import { resultService } from "@/services/result.service";
import { expenseService } from "@/services/expense.service";
import type { ExpenseCategory } from "@/types";

beforeEach(() => {
  calls = [];
  nextResponse = { data: null, error: null };
});

const argsOf = (method: string) => calls.filter(c => c.method === method).map(c => c.args);

// ── Seeded generators (mulberry32) — no fast-check in this project ──────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

function genAmount(r: () => number): number {
  const kind = Math.floor(r() * 3);
  if (kind === 0) return 0;
  if (kind === 1) return Math.floor(r() * 100_000); // whole dollars
  return Math.round(r() * 10_000_000) / 100; // cents
}

/** Raw DB value for actual_revenue: numbers, numeric strings, and NaN-producing junk. */
function genRawRevenue(r: () => number): unknown {
  const kind = Math.floor(r() * 6);
  if (kind === 0) return genAmount(r);
  if (kind === 1) return String(genAmount(r)); // Postgres numeric arrives as string
  if (kind === 2) return null;
  if (kind === 3) return "not-a-number";
  if (kind === 4) return undefined;
  return genAmount(r);
}

function genDate(r: () => number): { date: Date; iso: string } {
  const y = 2024 + Math.floor(r() * 4);
  const m = Math.floor(r() * 12);
  const d = 1 + Math.floor(r() * 28);
  const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { date: new Date(y, m, d), iso };
}

function genMetrics(r: () => number): Record<string, number> | undefined {
  if (r() < 0.25) return undefined;
  const keys = ["leads", "attendees", "conversionRate", "calls", "sales"];
  const out: Record<string, number> = {};
  for (const k of keys) if (r() < 0.5) out[k] = r() < 0.5 ? Math.floor(r() * 2000) : Math.round(r() * 100) / 100;
  return out;
}

const genNotes = (r: () => number) => pick(r, [undefined, "", "Webinar week", "Follow-ups sent"] as const);

function dbRow(insert: Record<string, unknown>, id = "row-1") {
  return { id, ...insert, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
}

// ── 3.3 Revenue sums consumed by other screens ──────────────────────────────
describe("Property 2 (Preservation A): results revenue sums", () => {
  // Oracle: today's mapRow guard (Number(x) || 0) followed by the original reduce.
  const oracle = (rows: Array<{ actual_revenue: unknown }>) =>
    rows.map(r => Number(r.actual_revenue) || 0).reduce((sum, x) => sum + x, 0);

  it("observed examples: whole, fractional, empty and NaN-guarded rows", async () => {
    const cases: Array<[unknown[], number]> = [
      [[], 0],
      [[12_500, 300], 12_800],
      [["1250.50", 0.25], 1250.75],
      [[null, "abc", undefined, 100], 100],
    ];
    for (const [revs, expected] of cases) {
      nextResponse = { data: revs.map((v, i) => ({ id: `r${i}`, actual_revenue: v })), error: null };
      expect(await resultService.getTotalRevenueByInitiative("init-1")).toBe(expected);
    }
  });

  it("for generated result sets: initiative, product and weekly totals equal the original reduce", async () => {
    const r = rng(20261017);
    for (let i = 0; i < 200; i++) {
      const rows = Array.from({ length: Math.floor(r() * 8) }, (_, j) => ({
        id: `r${j}`,
        actual_revenue: genRawRevenue(r),
        actual_spend: genAmount(r),
      }));
      const expected = oracle(rows);
      const ctx = JSON.stringify({ i, rows });
      nextResponse = { data: rows, error: null };
      expect(await resultService.getTotalRevenueByInitiative("init-1"), ctx).toBe(expected);
      expect(await resultService.getTotalRevenueByProduct("prod-1"), ctx).toBe(expected);
      expect(await resultService.getWeeklyRevenue("co-1", new Date(2026, 9, 12)), ctx).toBe(expected);
    }
  });

  it("getResultsByInitiative still maps revenue, dates, metrics and notes", async () => {
    nextResponse = {
      data: [{
        id: "r1", company_id: "co-1", initiative_id: "init-1", product_id: null,
        week_start_date: "2026-10-05", week_end_date: "2026-10-11",
        actual_revenue: "12500.50", actual_spend: "300", metrics: { leads: 40 },
        source: "manual", notes: "Webinar week",
        created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z",
      }],
      error: null,
    };
    const [res] = await resultService.getResultsByInitiative("init-1");
    expect(argsOf("from")).toEqual([["results"]]);
    expect(argsOf("eq")).toEqual([["initiative_id", "init-1"]]);
    expect(res.actualRevenue).toBe(12500.5);
    expect(res.actualSpend).toBe(300);
    expect(res.metrics).toEqual({ leads: 40 });
    expect(res.notes).toBe("Webinar week");
    expect(res.weekStartDate).toEqual(new Date(2026, 9, 5));
    expect(res.weekEndDate).toEqual(new Date(2026, 9, 11));
  });
});

// ── 3.1 / 3.4 createInitiativeResult (planner + onboarding callers) ─────────
describe("Property 2 (Preservation A): createInitiativeResult payload", () => {
  it("observed example: planner company-level result inserts with no initiative", async () => {
    const dto = {
      companyId: "co-1", initiativeId: null,
      weekStartDate: new Date(2026, 9, 5), weekEndDate: new Date(2026, 9, 11),
      actualRevenue: 4200, actualSpend: 150, metrics: { calls: 12 }, notes: "Planner",
    };
    const expectedInsert = {
      company_id: "co-1", initiative_id: null, product_id: null,
      week_start_date: "2026-10-05", week_end_date: "2026-10-11",
      actual_revenue: 4200, actual_spend: 150, metrics: { calls: 12 },
      source: "manual", notes: "Planner",
    };
    nextResponse = { data: dbRow(expectedInsert), error: null };
    const res = await resultService.createInitiativeResult(dto);
    expect(argsOf("from")).toEqual([["results"]]);
    expect(argsOf("insert")).toEqual([[expectedInsert]]);
    expect(res.initiativeId).toBeNull();
    expect(res.actualSpend).toBe(150);
  });

  it("for generated DTOs with actualSpend supplied: insert payload is unchanged", async () => {
    const r = rng(3141592);
    for (let i = 0; i < 200; i++) {
      const start = genDate(r);
      const end = genDate(r);
      const initiativeId = r() < 0.4 ? null : `init-${Math.floor(r() * 1000)}`;
      const metrics = genMetrics(r);
      const notes = genNotes(r);
      const dto = {
        companyId: `co-${i}`, initiativeId,
        weekStartDate: start.date, weekEndDate: end.date,
        actualRevenue: genAmount(r), actualSpend: genAmount(r),
        ...(metrics !== undefined ? { metrics } : {}),
        ...(notes !== undefined ? { notes } : {}),
      };
      const expectedInsert = {
        company_id: dto.companyId,
        initiative_id: initiativeId,
        product_id: null,
        week_start_date: start.iso,
        week_end_date: end.iso,
        actual_revenue: dto.actualRevenue,
        actual_spend: dto.actualSpend,
        metrics: metrics || {},
        source: "manual",
        notes: notes || null,
      };
      calls = [];
      nextResponse = { data: dbRow(expectedInsert, `row-${i}`), error: null };
      const res = await resultService.createInitiativeResult(dto);
      const ctx = JSON.stringify({ i, dto });
      expect(argsOf("insert"), ctx).toEqual([[expectedInsert]]);
      expect(res.actualRevenue, ctx).toBe(dto.actualRevenue);
      expect(res.actualSpend, ctx).toBe(dto.actualSpend);
      expect(res.initiativeId, ctx).toBe(initiativeId);
      expect(res.metrics, ctx).toEqual(metrics || {});
      expect(res.notes, ctx).toBe(notes || undefined);
    }
  });
});

// ── 3.1 updateResult: revenue / metrics / notes edits ───────────────────────
describe("Property 2 (Preservation A): updateResult payload for revenue, metrics, notes", () => {
  it("for generated edits without actualSpend: payload holds only the supplied fields", async () => {
    const r = rng(271828);
    for (let i = 0; i < 200; i++) {
      const dto: { actualRevenue?: number; metrics?: Record<string, number>; notes?: string } = {};
      if (r() < 0.8) dto.actualRevenue = genAmount(r);
      const metrics = genMetrics(r);
      if (metrics !== undefined) dto.metrics = metrics;
      const notes = genNotes(r);
      if (notes !== undefined) dto.notes = notes;

      const expectedUpdate: Record<string, unknown> = {};
      if (dto.actualRevenue !== undefined) expectedUpdate.actual_revenue = dto.actualRevenue;
      if (dto.metrics !== undefined) expectedUpdate.metrics = dto.metrics;
      if (dto.notes !== undefined) expectedUpdate.notes = dto.notes;

      calls = [];
      nextResponse = {
        data: dbRow({
          company_id: "co-1", initiative_id: "init-1", week_start_date: "2026-10-05",
          week_end_date: "2026-10-11", actual_revenue: dto.actualRevenue ?? 0, actual_spend: 0,
          metrics: dto.metrics ?? {}, notes: dto.notes ?? null,
        }, `r-${i}`),
        error: null,
      };
      await resultService.updateResult(`r-${i}`, dto);
      const ctx = JSON.stringify({ i, dto });
      expect(argsOf("update"), ctx).toEqual([[expectedUpdate]]);
      expect(argsOf("eq"), ctx).toEqual([["id", `r-${i}`]]);
      expect(Object.keys(argsOf("update")[0][0] as object), ctx).not.toContain("actual_spend");
    }
  });
});

// ── 3.2 Expenses: create / delete payloads ──────────────────────────────────
describe("Property 2 (Preservation A): expense create/delete payloads", () => {
  const categories: ExpenseCategory[] = [
    "advertising", "talent", "tools", "production", "venue", "fulfillment", "other",
  ];

  it("observed example: one $450 advertising expense", async () => {
    const insert = {
      company_id: "co-1", initiative_id: "init-1", category: "advertising",
      description: "Facebook ads", amount: 450, date: "2026-10-07",
      source: "manual", source_details: null,
    };
    nextResponse = { data: dbRow(insert, "e-1"), error: null };
    const res = await expenseService.createExpense({
      companyId: "co-1", initiativeId: "init-1", category: "advertising",
      description: "Facebook ads", amount: 450, date: new Date(2026, 9, 7),
    });
    expect(argsOf("from")).toEqual([["expenses"]]);
    expect(argsOf("insert")).toEqual([[insert]]);
    expect(res.amount).toBe(450);
    expect(res.category).toBe("advertising");
    expect(res.date).toEqual(new Date(2026, 9, 7));
  });

  it("for generated expenses: create inserts category, description, amount and date unchanged", async () => {
    const r = rng(1618033);
    for (let i = 0; i < 200; i++) {
      const d = genDate(r);
      const description = pick(r, ["", "Ads", "Venue hire", "Copywriter, 2 days"] as const);
      const dto = {
        companyId: `co-${i}`, initiativeId: `init-${i}`,
        category: pick(r, categories), description, amount: genAmount(r), date: d.date,
      };
      const expectedInsert = {
        company_id: dto.companyId, initiative_id: dto.initiativeId, category: dto.category,
        description: description || "", amount: dto.amount, date: d.iso,
        source: "manual", source_details: null,
      };
      calls = [];
      nextResponse = { data: dbRow(expectedInsert, `e-${i}`), error: null };
      const res = await expenseService.createExpense(dto);
      const ctx = JSON.stringify({ i, dto });
      expect(argsOf("insert"), ctx).toEqual([[expectedInsert]]);
      expect(res.amount, ctx).toBe(dto.amount);
      expect(res.category, ctx).toBe(dto.category);
      expect(res.description, ctx).toBe(description);
      expect(res.date, ctx).toEqual(d.date);
    }
  });

  it("for generated ids: delete issues delete().eq('id', id) on expenses", async () => {
    const r = rng(42);
    for (let i = 0; i < 50; i++) {
      const id = `e-${Math.floor(r() * 1e9)}`;
      calls = [];
      nextResponse = { data: null, error: null };
      await expect(expenseService.deleteExpense(id)).resolves.toBeUndefined();
      expect(calls.map(c => c.method), id).toEqual(["from", "delete", "eq"]);
      expect(argsOf("from"), id).toEqual([["expenses"]]);
      expect(argsOf("eq"), id).toEqual([["id", id]]);
    }
  });

  it("expense totals still equal the original reduce over amounts", async () => {
    const r = rng(777);
    for (let i = 0; i < 100; i++) {
      const rows = Array.from({ length: Math.floor(r() * 8) }, (_, j) => ({
        id: `e${j}`, amount: genRawRevenue(r), date: "2026-10-07",
      }));
      nextResponse = { data: rows, error: null };
      const expected = rows.map(x => Number(x.amount) || 0).reduce((s, x) => s + x, 0);
      expect(await expenseService.getTotalSpendByInitiative("init-1"), JSON.stringify(rows)).toBe(expected);
    }
  });
});

// ── 3.1 / 3.4 Results tab edit path never sends actualSpend (task 4.6) ──────
// The component cannot render under node, so the SENT shapes are checked at
// source level. Reads of result.actualSpend (legacy chip, D1) are allowed;
// only the outgoing payloads and their types are guarded. Comments are
// stripped first so explanatory notes don't count as sent fields.
describe("Property 2 (Preservation A): Results tab edit payload never contains actualSpend", () => {
  const raw = readFileSync(
    resolve(__dirname, "../../components/initiatives/initiative-results.tsx"),
    "utf8",
  );
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const block = (re: RegExp, name: string) => {
    const m = src.match(re)?.[0];
    expect(m, `${name} not found in initiative-results.tsx`).toBeTruthy();
    return m as string;
  };

  it("ResultUpdates/ResultFormData types and handleSave/handleUpdateResult/handleAddResult send no actualSpend", () => {
    const sent = {
      ResultUpdates: block(/interface ResultUpdates\s*\{[\s\S]*?\}/, "ResultUpdates"),
      ResultFormData: block(/interface ResultFormData\s*\{[\s\S]*?\}/, "ResultFormData"),
      handleSave: block(/function handleSave\(\)\s*\{[\s\S]*?\n {2}\}/, "handleSave"),
      handleUpdateResult: block(/const handleUpdateResult[\s\S]*?\n {2}};/, "handleUpdateResult"),
      handleAddResult: block(/const handleAddResult[\s\S]*?\n {2}};/, "handleAddResult"),
    };
    for (const [name, code] of Object.entries(sent)) {
      expect(/actualSpend|actual_spend/.test(code), `${name} sends actualSpend:\n${code}`).toBe(false);
    }
    // handleSave builds exactly { actualRevenue, metrics, notes }.
    const payload = sent.handleSave.match(/onUpdate\(\s*result\.id\s*,\s*\{([^}]*)\}/)?.[1] ?? "";
    const keys = payload.split(",").map(s => s.split(":")[0].trim()).filter(Boolean).sort();
    expect(keys).toEqual(["actualRevenue", "metrics", "notes"]);
  });

  it("for generated edits shaped like handleSave on legacy rows: no actual_spend written, legacy value survives", async () => {
    const r = rng(46);
    for (let i = 0; i < 200; i++) {
      const legacySpend = genAmount(r);
      // Exactly the ResultUpdates shape handleSave produces.
      const updates = { actualRevenue: genAmount(r), metrics: genMetrics(r) ?? {}, notes: genNotes(r) ?? "" };
      calls = [];
      nextResponse = {
        data: dbRow({
          company_id: "co-1", initiative_id: "init-1", week_start_date: "2026-10-05",
          week_end_date: "2026-10-11", actual_revenue: updates.actualRevenue,
          actual_spend: legacySpend, metrics: updates.metrics, notes: updates.notes || null,
        }, `r-${i}`),
        error: null,
      };
      const res = await resultService.updateResult(`r-${i}`, updates);
      const ctx = JSON.stringify({ i, legacySpend, updates });
      expect(argsOf("update"), ctx).toEqual([[{
        actual_revenue: updates.actualRevenue, metrics: updates.metrics, notes: updates.notes,
      }]]);
      expect(res.actualSpend, ctx).toBe(legacySpend);
    }
  });
});
