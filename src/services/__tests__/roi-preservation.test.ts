/**
 * Property 4: Preservation (Unit B, Reports > ROI)
 * ROI revenue, zero-spend handling, report columns and planned budget unchanged.
 *
 * Written BEFORE the fix by observing today's behavior for inputs outside
 * isBugCondition_B, then locking it in with seeded generators. Every scenario
 * here keeps the hand-typed `actualSpend` EQUAL to Σ expenses for each
 * initiative, so today's spend source and the D2 source (Σ expenses) agree and
 * the outputs must be identical before and after the fix. Spend-independent
 * properties (revenue, ordering, null ROI on zero spend, ranking exclusion,
 * CSV headers, planned_budget write) are asserted directly.
 *
 * EXPECTED OUTCOME on unfixed code: PASS.
 *
 * All ROI assertions go through `computeUnderTest`. Today it calls the
 * verbatim fixture `roiReportOriginal`. Task 10.5 swaps its body for the new
 * helper in `src/lib/initiative-spend.ts`:
 *
 *   const spendById = sumExpensesByInitiative(s.expenses);
 *   const r = buildRoiReport({ initiatives: s.initiatives, revenueById: s.revenueById,
 *     spendById, typeNameById: s.typeNameById,
 *     companyExpenseTotal: s.expenses.reduce((a, e) => a + e.amount, 0) });
 *   return { rows: r.rows, typeRows: r.typeRows, totalRevenue: r.totalRevenue, totalSpend: r.totalSpend };
 *
 * and re-runs this SAME file, which must still pass. The oracle
 * (`roiReportOriginal`) stays unchanged.
 *
 * **Validates: Requirements 3.5, 3.6, 3.7, 3.8, 3.9**
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Mocked Supabase (same chainable-recorder pattern as result-preservation) ─
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

import { initiativeService } from "@/services/initiative.service";
import { buildRoiReport, sumExpensesByInitiative } from "@/lib/initiative-spend";

beforeEach(() => {
  calls = [];
  nextResponse = { data: null, error: null };
});

const argsOf = (method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

// ── Scenario shape (shared with roi-spend.exploration.test.ts) ─────────────
interface ScenarioInitiative {
  id: string;
  name: string;
  status: string;
  initiativeTypeId: string;
  actualSpend: number;
}
interface ScenarioExpense {
  initiativeId: string;
  amount: number;
}
interface Scenario {
  initiatives: ScenarioInitiative[];
  revenueById: Map<string, number>;
  expenses: ScenarioExpense[];
  typeNameById: Map<string, string>;
}
interface RoiRow {
  id: string;
  name: string;
  typeName: string;
  revenue: number;
  spend: number;
  net: number;
  roi: number | null;
  status: string;
}
interface TypeRow {
  typeId: string;
  typeName: string;
  totalRevenue: number;
  totalSpend: number;
  roi: number | null;
}
interface RoiResult {
  rows: RoiRow[];
  typeRows: TypeRow[];
  totalRevenue: number;
  totalSpend: number;
}

// ── Oracle: verbatim copy of today's roi-report.tsx computation ────────────
// Data loading replaced by the scenario; everything else copied as-is.
function roiReportOriginal(s: Scenario): RoiResult {
  const roiData: RoiRow[] = s.initiatives.map((initiative) => {
    const revenue = s.revenueById.get(initiative.id) ?? 0;
    const spend = initiative.actualSpend || 0;
    const net = revenue - spend;
    const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : null;
    const typeName = s.typeNameById.get(initiative.initiativeTypeId);
    return {
      id: initiative.id,
      name: initiative.name,
      typeName: typeName || "Unknown",
      revenue,
      spend,
      net,
      roi,
      status: initiative.status,
    };
  });

  roiData.sort((a, b) => {
    if (a.roi === null && b.roi === null) return 0;
    if (a.roi === null) return 1;
    if (b.roi === null) return -1;
    return b.roi - a.roi;
  });

  const totRev = roiData.reduce((sum, r) => sum + r.revenue, 0);
  const totSpend = roiData.reduce((sum, r) => sum + r.spend, 0);

  const typeGroups = new Map<string, { typeName: string; revenue: number; spend: number }>();
  for (const item of roiData) {
    const existing = typeGroups.get(item.typeName) || { typeName: item.typeName, revenue: 0, spend: 0 };
    existing.revenue += item.revenue;
    existing.spend += item.spend;
    typeGroups.set(item.typeName, existing);
  }

  const typeRoiData: TypeRow[] = Array.from(typeGroups.entries()).map(([key, val]) => ({
    typeId: key,
    typeName: val.typeName,
    totalRevenue: val.revenue,
    totalSpend: val.spend,
    roi: val.spend > 0 ? ((val.revenue - val.spend) / val.spend) * 100 : null,
  }));

  typeRoiData.sort((a, b) => {
    if (a.roi === null && b.roi === null) return 0;
    if (a.roi === null) return 1;
    if (b.roi === null) return -1;
    return b.roi - a.roi;
  });

  return { rows: roiData, typeRows: typeRoiData, totalRevenue: totRev, totalSpend: totSpend };
}

/** Verbatim copy of the component's ranking filter (rankedInitiatives useMemo). */
function rankOriginal(rows: RoiRow[]): RoiRow[] {
  return rows.filter((i) => i.spend > 0 && i.roi !== null);
}

/** Verbatim copy of today's ResultService.getTotalRevenueByInitiative reduce. */
function revenueReduceOriginal(results: { actualRevenue: number }[]): number {
  return results.reduce((sum, r) => sum + r.actualRevenue, 0);
}

// Task 10.5: replace the body with the buildRoiReport call shown in the header.
function computeUnderTest(s: Scenario): RoiResult {
  const spendById = sumExpensesByInitiative(s.expenses);
  const r = buildRoiReport({
    initiatives: s.initiatives,
    revenueById: s.revenueById,
    spendById,
    typeNameById: s.typeNameById,
    companyExpenseTotal: s.expenses.reduce((a, e) => a + e.amount, 0),
  });
  return { rows: r.rows, typeRows: r.typeRows, totalRevenue: r.totalRevenue, totalSpend: r.totalSpend };
}

// ── Seeded generator (mulberry32) ──────────────────────────────────────────
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

/** Amount in whole cents (returned as cents) so sums are exact. */
function genCents(r: () => number): number {
  return r() < 0.5 ? (1 + Math.floor(r() * 50_000)) * 100 : 1 + Math.floor(r() * 5_000_000);
}

const STATUSES = ["planned", "in_progress", "launched", "completed", "paused", "retired"] as const;
const TYPE_IDS = ["t1", "t2", "t3", "missing"] as const;
const TYPES = new Map([["t1", "Webinar"], ["t2", "Email"], ["t3", "Referral"]]);

/**
 * Preservation scenario: for every initiative the hand field equals Σ its
 * expenses (often both 0), so both spend definitions agree. Each initiative's
 * revenue is Σ of generated results revenue.
 */
function genScenario(seed: number): Scenario & { resultsById: Map<string, { actualRevenue: number }[]> } {
  const r = rng(seed);
  const n = Math.floor(r() * 8); // 0..7, includes empty company
  const initiatives: ScenarioInitiative[] = [];
  const revenueById = new Map<string, number>();
  const resultsById = new Map<string, { actualRevenue: number }[]>();
  const expenses: ScenarioExpense[] = [];
  for (let k = 0; k < n; k++) {
    const id = `i${k}`;
    const results: { actualRevenue: number }[] = [];
    const rc = Math.floor(r() * 4);
    for (let j = 0; j < rc; j++) results.push({ actualRevenue: r() < 0.15 ? 0 : genCents(r) / 100 });
    resultsById.set(id, results);
    revenueById.set(id, revenueReduceOriginal(results));

    let spendCents = 0;
    const ec = r() < 0.4 ? 0 : 1 + Math.floor(r() * 3); // ~40% zero-spend
    for (let e = 0; e < ec; e++) {
      const c = genCents(r);
      spendCents += c;
      expenses.push({ initiativeId: id, amount: c / 100 });
    }
    initiatives.push({
      id,
      name: `Initiative ${id}`,
      status: STATUSES[Math.floor(r() * STATUSES.length)],
      initiativeTypeId: TYPE_IDS[Math.floor(r() * TYPE_IDS.length)],
      actualSpend: spendCents / 100,
    });
  }
  return { initiatives, revenueById, expenses, typeNameById: TYPES, resultsById };
}

const SEEDS = 300;

// ── Tests ──────────────────────────────────────────────────────────────────
describe("Property 4: Preservation - ROI outputs unchanged where spend sources agree", () => {
  it("revenue per initiative = Σ results revenue; totalRevenue = Σ rows (3.5)", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = genScenario(seed);
      const r = computeUnderTest(s);
      expect(r.rows.length).toBe(s.initiatives.length);
      for (const row of r.rows) {
        expect(row.revenue).toBeCloseTo(revenueReduceOriginal(s.resultsById.get(row.id)!), 2);
      }
      expect(r.totalRevenue).toBeCloseTo(r.rows.reduce((a, x) => a + x.revenue, 0), 2);
    }
  });

  it("zero spend → ROI null, excluded from ranking; ranking = original filter (3.6)", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = genScenario(seed);
      const r = computeUnderTest(s);
      for (const row of r.rows) {
        if (row.spend === 0) expect(row.roi).toBeNull();
      }
      const ranked = rankOriginal(r.rows);
      expect(ranked.every((x) => x.spend > 0 && x.roi !== null)).toBe(true);
      expect(ranked.map((x) => x.id)).toEqual(rankOriginal(roiReportOriginal(s).rows).map((x) => x.id));
    }
  });

  it("rows, type rows, sort orders and totals equal the original (3.7)", () => {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const s = genScenario(seed);
      const got = computeUnderTest(s);
      const want = roiReportOriginal(s);

      expect(got.rows.map((x) => x.id)).toEqual(want.rows.map((x) => x.id));
      got.rows.forEach((row, i) => {
        const w = want.rows[i];
        expect({ name: row.name, typeName: row.typeName, status: row.status }).toEqual({
          name: w.name, typeName: w.typeName, status: w.status,
        });
        expect(row.revenue).toBeCloseTo(w.revenue, 2);
        expect(row.spend).toBeCloseTo(w.spend, 2);
        expect(row.net).toBeCloseTo(w.net, 2);
        if (w.roi === null) expect(row.roi).toBeNull();
        else expect(row.roi).toBeCloseTo(w.roi, 6);
      });

      expect(got.typeRows.map((x) => x.typeId)).toEqual(want.typeRows.map((x) => x.typeId));
      got.typeRows.forEach((t, i) => {
        const w = want.typeRows[i];
        expect(t.typeName).toBe(w.typeName);
        expect(t.totalRevenue).toBeCloseTo(w.totalRevenue, 2);
        expect(t.totalSpend).toBeCloseTo(w.totalSpend, 2);
        if (w.roi === null) expect(t.roi).toBeNull();
        else expect(t.roi).toBeCloseTo(w.roi, 6);
      });

      expect(got.totalRevenue).toBeCloseTo(want.totalRevenue, 2);
      expect(got.totalSpend).toBeCloseTo(want.totalSpend, 2);
    }
  });

  it("unknown initiative type falls back to 'Unknown'", () => {
    const s: Scenario = {
      initiatives: [{ id: "x", name: "X", status: "planned", initiativeTypeId: "nope", actualSpend: 0 }],
      revenueById: new Map([["x", 100]]),
      expenses: [],
      typeNameById: TYPES,
    };
    const r = computeUnderTest(s);
    expect(r.rows[0].typeName).toBe("Unknown");
    expect(r.typeRows.map((t) => t.typeName)).toEqual(["Unknown"]);
  });
});

describe("ROI CSV export (3.7, superseded)", () => {
  it("roi-report.tsx no longer offers a CSV export", () => {
    // 3.7 pinned the CSV header list. The client then asked for Export CSV to be
    // removed from every screen (Oct 2026), so this now guards the removal.
    const src = readFileSync(resolve(__dirname, "../../components/reports/roi-report.tsx"), "utf8");
    expect(src).not.toContain("exportToCSV");
    expect(src).not.toContain("Export CSV");
  });
});

describe("Property 4: Preservation - planned_budget still written (3.9)", () => {
  const row = (plannedBudget: number) => ({
    id: "init-1",
    company_id: "c1",
    annual_plan_id: "p1",
    initiative_type_id: "t1",
    product_id: "prod1",
    name: "N",
    description: "",
    kind: "one_time",
    status: "planned",
    activation_date: "2026-01-05",
    event_date: null,
    planned_budget: plannedBudget,
    actual_spend: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });

  it("updateInitiative maps plannedBudget → planned_budget for generated amounts", async () => {
    const r = rng(42);
    for (let k = 0; k < 50; k++) {
      calls = [];
      const amount = k === 0 ? 0 : genCents(r) / 100;
      nextResponse = { data: row(amount), error: null };
      const updated = await initiativeService.updateInitiative("init-1", { plannedBudget: amount });
      const updates = argsOf("update");
      expect(updates).toHaveLength(1);
      expect((updates[0][0] as Record<string, unknown>).planned_budget).toBe(amount);
      expect(argsOf("eq")[0]).toEqual(["id", "init-1"]);
      expect(updated.plannedBudget).toBe(amount);
    }
  });

  it("initiative-overview.tsx still sends plannedBudget in the Overview update", () => {
    const src = readFileSync(resolve(__dirname, "../../components/initiatives/initiative-overview.tsx"), "utf8");
    expect(src).toMatch(/plannedBudget:\s*toNumber\(plannedBudget\)/);
    expect(src).toMatch(/initiativeService\.updateInitiative\(initiative\.id,\s*dto\)/);
  });
});
