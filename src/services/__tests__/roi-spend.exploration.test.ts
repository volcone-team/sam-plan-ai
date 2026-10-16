/**
 * Property 3: Bug Condition (Unit B, Reports > ROI)
 * ROI and every "actual spend" use recorded expenses.
 *
 * isBugCondition_B(i): roiSpend(i) ≠ Σ expenses(i).
 *
 * CRITICAL: these tests are EXPECTED TO FAIL on unfixed code. Today's ROI
 * computation reads the hand-typed `initiative.actualSpend` and never loads
 * expenses, so every assertion that spend = Σ expenses fails. Failure confirms
 * the bug. Do not "fix" the tests to make them pass.
 *
 * All assertions go through `computeUnderTest`. Today it is a verbatim copy of
 * the spend/net/roi/sort/total logic in `src/components/reports/roi-report.tsx`.
 * Task 10.4 swaps its body for the new helper in `src/lib/initiative-spend.ts`:
 *
 *   const spendById = sumExpensesByInitiative(s.expenses);
 *   return buildRoiReport({ initiatives: s.initiatives, revenueById: s.revenueById,
 *     spendById, typeNameById: s.typeNameById,
 *     companyExpenseTotal: expensesReportTotal(s.expenses) });
 *
 * and re-runs this SAME file, which must then pass.
 *
 * **Validates: Requirements 1.6, 1.7, 1.8, 2.7, 2.8, 2.9**
 */
import { describe, it, expect } from "vitest";
import { buildRoiReport, sumExpensesByInitiative } from "@/lib/initiative-spend";

// ── Scenario shape (inputs both the fixture and the future helper can read) ─
interface ScenarioInitiative {
  id: string;
  name: string;
  status: string;
  initiativeTypeId: string;
  /** Hand-typed `initiatives.actual_spend`. D2: no longer a display source. */
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

interface RoiResult {
  rows: RoiRow[];
  totalRevenue: number;
  totalSpend: number;
}

// ── Fixture: verbatim copy of today's roi-report.tsx computation ───────────
// Only the data loading is replaced by the scenario. The spend line is the
// bug: `initiative.actualSpend || 0`, expenses are never consulted.
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
  return { rows: roiData, totalRevenue: totRev, totalSpend: totSpend };
}

// Task 10.4: body swapped for the new helper (see header).
function computeUnderTest(s: Scenario): RoiResult {
  const spendById = sumExpensesByInitiative(s.expenses);
  const { rows, totalRevenue, totalSpend } = buildRoiReport({
    initiatives: s.initiatives,
    revenueById: s.revenueById,
    spendById,
    typeNameById: s.typeNameById,
    companyExpenseTotal: expensesReportTotal(s.expenses),
  });
  return { rows, totalRevenue, totalSpend };
}

// ── Oracles ────────────────────────────────────────────────────────────────
/** Reports > Expenses "Total Expenses" (expenseService.getTotalExpenses). */
function expensesReportTotal(expenses: ScenarioExpense[]): number {
  return expenses.reduce((sum, row) => sum + Number(row.amount), 0);
}

/** Σ expenses for one initiative, in cents to avoid float drift. */
function expenseSpendFor(id: string, expenses: ScenarioExpense[]): number {
  const cents = expenses
    .filter((e) => e.initiativeId === id)
    .reduce((sum, e) => sum + Math.round(e.amount * 100), 0);
  return cents / 100;
}

const rowById = (r: RoiResult, id: string) => {
  const row = r.rows.find((x) => x.id === id);
  if (!row) throw new Error(`row ${id} missing`);
  return row;
};

const TYPES = new Map([["t1", "Webinar"], ["t2", "Email"]]);

function initiative(id: string, actualSpend: number, typeId = "t1"): ScenarioInitiative {
  return { id, name: `Initiative ${id}`, status: "in_progress", initiativeTypeId: typeId, actualSpend };
}

// ── Seeded generator (mulberry32), same pattern as result-preservation ─────
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

function genAmount(r: () => number): number {
  // Mix of whole dollars and cents, 0.01 .. 50,000.
  const whole = Math.floor(r() * 50_000);
  return r() < 0.5 ? Math.max(whole, 1) : Math.max(whole, 0) + Math.floor(r() * 100) / 100 || 0.01;
}

/** Scenarios where every expense belongs to an initiative in the list. */
function genScenario(seed: number): Scenario {
  const r = rng(seed);
  const n = 1 + Math.floor(r() * 6);
  const initiatives: ScenarioInitiative[] = [];
  const revenueById = new Map<string, number>();
  const expenses: ScenarioExpense[] = [];
  for (let k = 0; k < n; k++) {
    const id = `i${k}`;
    // Hand field is independent of expenses (often 0, sometimes a stale value).
    const hand = r() < 0.6 ? 0 : genAmount(r);
    initiatives.push(initiative(id, hand, r() < 0.5 ? "t1" : "t2"));
    revenueById.set(id, r() < 0.2 ? 0 : genAmount(r));
    const count = Math.floor(r() * 4);
    for (let e = 0; e < count; e++) expenses.push({ initiativeId: id, amount: genAmount(r) });
  }
  // Guarantee the scenario is inside the bug condition: at least one
  // initiative whose hand field differs from its expenses total.
  const first = initiatives[0];
  if (first.actualSpend === expenseSpendFor(first.id, expenses)) {
    expenses.push({ initiativeId: first.id, amount: 250 });
  }
  return { initiatives, revenueById, expenses, typeNameById: TYPES };
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe("Property 3: Bug Condition - ROI spend comes from recorded expenses", () => {
  it("expenses $2,000, hand field 0, revenue $5,000 → spend $2,000, net $3,000, ROI +150.0%", () => {
    const s: Scenario = {
      initiatives: [initiative("a", 0)],
      revenueById: new Map([["a", 5000]]),
      expenses: [
        { initiativeId: "a", amount: 1200 },
        { initiativeId: "a", amount: 800 },
      ],
      typeNameById: TYPES,
    };
    const row = rowById(computeUnderTest(s), "a");
    expect({ spend: row.spend, net: row.net, roi: row.roi }).toEqual({
      spend: 2000,
      net: 3000,
      roi: 150,
    });
    expect(`${row.roi! >= 0 ? "+" : ""}${row.roi!.toFixed(1)}%`).toBe("+150.0%");
  });

  it("hand field $1,000, no expenses → spend $0, ROI N/A (null)", () => {
    const s: Scenario = {
      initiatives: [initiative("b", 1000)],
      revenueById: new Map([["b", 4000]]),
      expenses: [],
      typeNameById: TYPES,
    };
    const row = rowById(computeUnderTest(s), "b");
    expect({ spend: row.spend, net: row.net, roi: row.roi }).toEqual({
      spend: 0,
      net: 4000,
      roi: null,
    });
  });

  it("ROI Total Spend equals the Expenses report total for the same company", () => {
    const s: Scenario = {
      initiatives: [initiative("a", 0), initiative("b", 1000, "t2")],
      revenueById: new Map([["a", 5000], ["b", 4000]]),
      expenses: [
        { initiativeId: "a", amount: 2000 },
        { initiativeId: "b", amount: 450 },
      ],
      typeNameById: TYPES,
    };
    const r = computeUnderTest(s);
    expect(r.totalSpend).toBeCloseTo(expensesReportTotal(s.expenses), 2);
  });

  it("generated scenarios (seeded): per-row spend = Σ expenses, net/ROI identities, totals match Expenses report", () => {
    const counterexamples: string[] = [];
    for (let seed = 1; seed <= 300; seed++) {
      const s = genScenario(seed);
      const r = computeUnderTest(s);
      for (const init of s.initiatives) {
        const row = rowById(r, init.id);
        const expected = expenseSpendFor(init.id, s.expenses);
        const revenue = s.revenueById.get(init.id) ?? 0;
        const expectedRoi = expected > 0 ? ((revenue - expected) / expected) * 100 : null;
        const ok =
          Math.abs(row.spend - expected) < 0.005 &&
          Math.abs(row.net - (revenue - expected)) < 0.005 &&
          (expectedRoi === null ? row.roi === null : row.roi !== null && Math.abs(row.roi - expectedRoi) < 1e-6);
        if (!ok && counterexamples.length < 5) {
          counterexamples.push(
            `seed ${seed} ${init.id}: hand=${init.actualSpend} expenses=${expected} revenue=${revenue} → spend=${row.spend} roi=${row.roi}`,
          );
        }
      }
      const total = expensesReportTotal(s.expenses);
      if (Math.abs(r.totalSpend - total) >= 0.005 && counterexamples.length < 5) {
        counterexamples.push(`seed ${seed}: ROI totalSpend=${r.totalSpend} ≠ Expenses report total=${total}`);
      }
    }
    expect(counterexamples).toEqual([]);
  });
});

// The original fixture is kept to document the bug: on the first unit
// counterexample it still reports the hand-typed field, not expenses.
describe("Original ROI logic (documented bug)", () => {
  it("old logic reports spend $0 / ROI null where expenses total $2,000", () => {
    const s: Scenario = {
      initiatives: [initiative("a", 0)],
      revenueById: new Map([["a", 5000]]),
      expenses: [
        { initiativeId: "a", amount: 1200 },
        { initiativeId: "a", amount: 800 },
      ],
      typeNameById: TYPES,
    };
    const old = rowById(roiReportOriginal(s), "a");
    expect({ spend: old.spend, roi: old.roi }).toEqual({ spend: 0, roi: null });
    expect(rowById(computeUnderTest(s), "a").spend).toBe(2000);
  });
});
