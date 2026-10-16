/**
 * Property 1: Bug Condition (Unit A, Results tab)
 * Results tab records spend only as expenses, deletes for real, totals match rows.
 *
 * Bug-condition EXPLORATION tests. Written before the fix, so on unfixed code
 * they are EXPECTED TO FAIL; each failure is a counterexample proving the bug.
 * Task 4.5 re-runs this same file after the fix and expects it to pass.
 *
 * Scope: isBugCondition_A (design.md) — action ∈ {view, addResult, editResult,
 * deleteResult, reload}, or money shown without thousands separators.
 *
 * **Validates: Requirements 1.1, 1.3, 2.1, 2.3, 2.4**
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── Mocked Supabase ─────────────────────────────────────────────────────────
// Records the query chain the service builds so the test can assert on it.
type Call = { method: string; args: unknown[] };
let calls: Call[] = [];
let nextResponse: { data: unknown; error: unknown } = { data: null, error: null };

function makeBuilder() {
  const builder: Record<string, unknown> = {};
  for (const method of ["from", "delete", "eq", "select", "insert", "update", "single", "order", "is"]) {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    };
  }
  // Awaiting the chain resolves to the queued response.
  builder.then = (resolveFn: (v: unknown) => unknown, rejectFn?: (e: unknown) => unknown) =>
    Promise.resolve(nextResponse).then(resolveFn, rejectFn);
  return builder;
}

vi.mock("@/lib/supabase/db", () => ({
  isSupabaseConfigured: () => true,
  getSupabase: () => makeBuilder(),
}));

import { resultService } from "@/services/result.service";
import { summariseResultsTab } from "@/lib/results-tab-totals";

type DeletableService = { deleteResult?: (id: string) => Promise<unknown> };

function getDeleteResult() {
  const fn = (resultService as unknown as DeletableService).deleteResult;
  // Counterexample on unfixed code: "no deleteResult on ResultService".
  expect(typeof fn, "no deleteResult on ResultService").toBe("function");
  return fn!.bind(resultService);
}

beforeEach(() => {
  calls = [];
  nextResponse = { data: null, error: null };
});

describe("Property 1 (Bug Condition A): resultService.deleteResult", () => {
  it("issues delete().eq('id', id).select('id') on the results table", async () => {
    const deleteResult = getDeleteResult();
    nextResponse = { data: [{ id: "r-1" }], error: null };
    await deleteResult("r-1");

    const chain = calls.map(c => c.method);
    expect(calls.find(c => c.method === "from")?.args).toEqual(["results"]);
    expect(chain).toContain("delete");
    expect(calls.find(c => c.method === "eq")?.args).toEqual(["id", "r-1"]);
    expect(calls.find(c => c.method === "select")?.args).toEqual(["id"]);
    expect(chain.indexOf("delete")).toBeLessThan(chain.indexOf("eq"));
    expect(chain.indexOf("eq")).toBeLessThan(chain.indexOf("select"));
  });

  it("throws a permission error when RLS filters the row (zero rows, no error)", async () => {
    const deleteResult = getDeleteResult();
    nextResponse = { data: [], error: null };
    await expect(deleteResult("r-2")).rejects.toThrow("You don't have permission to delete results");
  });

  it("throws when Supabase returns an error", async () => {
    const deleteResult = getDeleteResult();
    nextResponse = { data: null, error: { message: "boom", code: "XX000" } };
    await expect(deleteResult("r-3")).rejects.toThrow();
  });
});

// ── Totals table ────────────────────────────────────────────────────────────
// Mirrors the summary cards in src/components/initiatives/initiative-results.tsx
// (the component cannot be rendered in this node test environment). Task 4.5
// swapped the old three-card fixture for the fixed logic: the cards are built
// from summariseResultsTab, exactly as the component now builds them.
type Row = { actualRevenue: number; actualSpend: number };
type Exp = { amount: number };
type Card = { label: string; value: number };

function tabCards(results: Row[], expenses: Exp[]): Card[] {
  const { totalRevenue, totalExpenses } = summariseResultsTab(results, expenses);
  return [
    { label: "Total Revenue", value: totalRevenue },
    { label: "Total Expenses", value: totalExpenses },
  ];
}

// Seeded generator (mulberry32) — no fast-check in this project.
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
  const kind = Math.floor(r() * 4);
  if (kind === 0) return 0;
  if (kind === 1) return Math.floor(r() * 100_000); // whole dollars
  return Math.round(r() * 10_000_000) / 100; // cents
}

function genTabState(r: () => number) {
  const results: Row[] = Array.from({ length: Math.floor(r() * 6) }, () => ({
    actualRevenue: genAmount(r),
    actualSpend: genAmount(r),
  }));
  const expenses: Exp[] = Array.from({ length: Math.floor(r() * 6) }, () => ({ amount: genAmount(r) }));
  return { results, expenses };
}

const centsSum = (xs: number[]) => xs.reduce((s, x) => s + Math.round(x * 100), 0) / 100;

describe("Property 1 (Bug Condition A): Results tab totals", () => {
  it("design example: one result (12,500 revenue / 300 spend) + one 450 expense → two cards only", () => {
    const cards = tabCards([{ actualRevenue: 12_500, actualSpend: 300 }], [{ amount: 450 }]);
    expect(cards.map(c => c.label), "Total Spend (Results) card present").toEqual([
      "Total Revenue",
      "Total Expenses",
    ]);
  });

  it("for generated tab states: exactly two cards, and each total equals Σ rows at 2 dp", () => {
    const r = rng(20261016);
    for (let i = 0; i < 200; i++) {
      const { results, expenses } = genTabState(r);
      const cards = tabCards(results, expenses);
      const ctx = JSON.stringify({ i, results, expenses });

      expect(cards.map(c => c.label), `Total Spend (Results) card present — ${ctx}`).toEqual([
        "Total Revenue",
        "Total Expenses",
      ]);
      expect(cards.filter(c => /spend|expense/i.test(c.label)).length, `two spend totals — ${ctx}`).toBe(1);
      expect(cards[0].value, `revenue total ≠ Σ rows — ${ctx}`).toBe(centsSum(results.map(x => x.actualRevenue)));
      expect(cards[1].value, `expense total ≠ Σ rows — ${ctx}`).toBe(centsSum(expenses.map(x => x.amount)));
    }
  });
});

// ── Component source checks ────────────────────────────────────────────────
// Lightweight guards on the real component (it cannot be rendered under the
// node test environment). They pin the add/edit/delete/format bug conditions.
describe("Property 1 (Bug Condition A): initiative-results.tsx", () => {
  const src = readFileSync(
    resolve(__dirname, "../../components/initiatives/initiative-results.tsx"),
    "utf8",
  );

  it("view: no 'Total Spend (Results)' card", () => {
    expect(src.includes("Total Spend (Results)"), "Total Spend (Results) card present").toBe(false);
  });

  it("addResult/editResult: no Spend input offered", () => {
    expect(/>\s*Spend(\s*\(\$\))?\s*</.test(src), "Spend label/input present in result form").toBe(false);
    expect(src.includes("setEditSpend"), "Spend edit state present in ResultRow").toBe(false);
  });

  it("deleteResult/reload: delete reaches the database", () => {
    const handler = src.match(/const handleDeleteResult[\s\S]*?\n {2}};/)?.[0] ?? "";
    expect(handler.includes("resultService.deleteResult"), "handleDeleteResult only filters local state").toBe(true);
  });

  it("money inputs show thousands separators (NumberInputRaw)", () => {
    expect(src.includes("NumberInputRaw"), "money inputs are raw <input type=\"number\">").toBe(true);
  });
});
