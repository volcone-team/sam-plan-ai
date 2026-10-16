import { describe, it, expect } from "vitest";
import type { Expense } from "@/types/expense.types";
import type { Initiative } from "@/types";
import {
  buildRoiReport,
  sumExpensesByInitiative,
  type RoiInitiativeInput,
  type SpendExpenseRow,
} from "./initiative-spend";

// Seeded generator (mulberry32), same pattern as the other spec tests.
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

const cents = (n: number) => Math.round(n * 100);
const TYPES = new Map([["t1", "Webinar"], ["t2", "Email"]]);
const init = (id: string, typeId = "t1"): RoiInitiativeInput => ({
  id,
  name: `Initiative ${id}`,
  status: "in_progress",
  initiativeTypeId: typeId,
});

describe("sumExpensesByInitiative", () => {
  it("sums in cents: 0.1 + 0.2 = 0.3 exactly", () => {
    const m = sumExpensesByInitiative([
      { initiativeId: "a", amount: 0.1 },
      { initiativeId: "a", amount: 0.2 },
    ]);
    expect(m.get("a")).toBe(0.3);
  });

  it("skips rows with no initiative; non-finite and unparsable amounts count as 0; numeric strings parse", () => {
    const m = sumExpensesByInitiative([
      { initiativeId: null, amount: 100 },
      { initiativeId: undefined, amount: 50 },
      { initiativeId: "", amount: 25 },
      { initiativeId: "a", amount: Number.NaN },
      { initiativeId: "a", amount: Number.POSITIVE_INFINITY },
      { initiativeId: "a", amount: "abc" },
      { initiativeId: "a", amount: "12.50" },
    ]);
    expect(Array.from(m.keys())).toEqual(["a"]);
    expect(m.get("a")).toBe(12.5);
  });
});

describe("buildRoiReport", () => {
  it("spend from spendById, never the hand field; net and ROI per formula", () => {
    const withHand = { ...init("a"), actualSpend: 999 };
    const r = buildRoiReport({
      initiatives: [withHand],
      revenueById: new Map([["a", 5000]]),
      spendById: new Map([["a", 2000]]),
      typeNameById: TYPES,
      companyExpenseTotal: 2000,
    });
    expect(r.rows[0]).toMatchObject({ spend: 2000, net: 3000, roi: 150, typeName: "Webinar" });
    expect(r.unattributedSpend).toBe(0);
  });

  it("no expenses → spend 0, ROI null, sorted last; unknown type → 'Unknown'", () => {
    const r = buildRoiReport({
      initiatives: [init("z", "missing"), init("a")],
      revenueById: new Map([["z", 4000], ["a", 100]]),
      spendById: new Map([["a", 50]]),
      typeNameById: TYPES,
      companyExpenseTotal: 50,
    });
    expect(r.rows.map((x) => x.id)).toEqual(["a", "z"]);
    expect(r.rows[1]).toMatchObject({ spend: 0, roi: null, typeName: "Unknown" });
    expect(r.typeRows.map((t) => [t.typeId, t.typeName])).toEqual([
      ["Webinar", "Webinar"],
      ["Unknown", "Unknown"],
    ]);
  });

  it("null-initiative expenses are counted as unattributed", () => {
    const expenses: SpendExpenseRow[] = [
      { initiativeId: "a", amount: 300 },
      { initiativeId: null, amount: 120.55 },
      { initiativeId: "not-listed", amount: 10 },
    ];
    const r = buildRoiReport({
      initiatives: [init("a")],
      revenueById: new Map(),
      spendById: sumExpensesByInitiative(expenses),
      typeNameById: TYPES,
      companyExpenseTotal: expenses.reduce((s, e) => s + Number(e.amount), 0),
    });
    expect(r.totalSpend).toBe(300);
    expect(r.unattributedSpend).toBe(130.55);
  });

  it("accepts the real Expense and Initiative types without mapping", () => {
    // Compile-time check: these must type-check as inputs.
    const expenses: Expense[] = [];
    const initiatives: Initiative[] = [];
    const r = buildRoiReport({
      initiatives,
      revenueById: new Map(),
      spendById: sumExpensesByInitiative(expenses),
      typeNameById: new Map(),
      companyExpenseTotal: 0,
    });
    expect(r).toEqual({ rows: [], typeRows: [], totalRevenue: 0, totalSpend: 0, unattributedSpend: 0 });
  });

  it("seeded: totalSpend = Σ rows.spend and totalSpend + unattributedSpend = companyExpenseTotal", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const n = Math.floor(r() * 7); // 0..6
      const initiatives = Array.from({ length: n }, (_, k) => init(`i${k}`, r() < 0.5 ? "t1" : "t2"));
      const expenses: SpendExpenseRow[] = [];
      const ec = Math.floor(r() * 12);
      for (let e = 0; e < ec; e++) {
        const pick = r();
        const initiativeId =
          n > 0 && pick < 0.8 ? `i${Math.floor(r() * n)}` : pick < 0.9 ? null : "elsewhere";
        // Whole dollars or cents, 0.01 .. 50,000.
        const amount = r() < 0.5 ? 1 + Math.floor(r() * 50_000) : (1 + Math.floor(r() * 5_000_000)) / 100;
        expenses.push({ initiativeId, amount });
      }
      const revenueById = new Map(initiatives.map((i) => [i.id, Math.floor(r() * 100_000) / 100]));
      const companyExpenseTotal = expenses.reduce((s, e) => s + Number(e.amount), 0);

      const rep = buildRoiReport({
        initiatives,
        revenueById,
        spendById: sumExpensesByInitiative(expenses),
        typeNameById: TYPES,
        companyExpenseTotal,
      });

      expect(rep.rows).toHaveLength(n);
      expect(cents(rep.totalSpend)).toBe(rep.rows.reduce((s, x) => s + cents(x.spend), 0));
      expect(cents(rep.totalSpend) + cents(rep.unattributedSpend)).toBe(cents(companyExpenseTotal));
      expect(cents(rep.typeRows.reduce((s, t) => s + t.totalSpend, 0))).toBe(cents(rep.totalSpend));
      for (const row of rep.rows) {
        expect(row.net).toBeCloseTo(row.revenue - row.spend, 6);
        if (row.spend <= 0) expect(row.roi).toBeNull();
        else expect(row.roi).toBeCloseTo(((row.revenue - row.spend) / row.spend) * 100, 6);
      }
    }
  });
});
