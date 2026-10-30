/**
 * Property 1: Bug Condition — goal change suggestions never change goals.
 *
 * Scoped to isBugCondition(X) from the design: AI suggestions with
 * type "target_change", pending rows with suggestion_type "target_change",
 * and accept requests for them. On the unfixed code every block below fails.
 *
 * **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.4, 2.5, 2.6**
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { applySuggestion } from "./apply-suggestion";
import { buildSuggestionRows, toClientSuggestions } from "./suggestion-rows";
import { ENHANCE_SYSTEM_PROMPT } from "./enhance-prompt";
import { isGoalChangeType, isAcceptableSuggestionType } from "./suggestion-policy";

// ---------- seeded generator ----------

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

type Rand = () => number;
const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

function money(r: Rand): number | string {
  const n = pick(r, [
    0,
    Math.round(r() * 5000),
    Math.round(r() * 500_000),
    Math.round(1_000_000 + r() * 9_000_000),
  ] as const);
  return r() < 0.3 ? String(n) : n;
}

/** Goal values with baseline, stretch, or both present. */
function goals(r: Rand): Record<string, number | string> {
  const which = pick(r, ["baseline", "stretch", "both"] as const);
  const out: Record<string, number | string> = {};
  if (which !== "stretch") out.baselineRevenue = money(r);
  if (which !== "baseline") out.stretchRevenue = money(r);
  return out;
}

function storedTargetChangeRow(r: Rand, i: number) {
  return {
    id: `sugg-${i}`,
    batch_id: `batch-${Math.floor(r() * 3)}`,
    company_id: "company-1",
    suggestion_type: "target_change",
    target_id: null,
    target_label: null,
    title: "Adjust revenue goals",
    rationale: "Fit goals to the current initiatives",
    current_value: goals(r),
    proposed_value: goals(r),
    status: "pending",
  };
}

const RUNS = 50;

// ---------- fake db recording writes ----------

type Write = { table: string; op: "update" | "insert" | "delete" | "upsert"; payload?: unknown };

function fakeDb() {
  const writes: Write[] = [];
  const from = (table: string) => {
    const result = { data: table === "annual_plans" ? { id: "plan-newest", year: 2027 } : null, error: null };
    const b: any = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      single: () => b,
      maybeSingle: () => b,
      update: (payload: unknown) => { writes.push({ table, op: "update", payload }); return b; },
      insert: (payload: unknown) => { writes.push({ table, op: "insert", payload }); return b; },
      upsert: (payload: unknown) => { writes.push({ table, op: "upsert", payload }); return b; },
      delete: () => { writes.push({ table, op: "delete" }); return b; },
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad),
    };
    return b;
  };
  return { db: { from } as any, writes };
}

// ---------- tests ----------

describe("Property 1: goal change suggestions never change goals", () => {
  it("applySuggestion on a target_change row writes nothing to annual_plans or companies", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = rng(1);
    const counterexamples: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      const row = storedTargetChangeRow(r, i);
      const { db, writes } = fakeDb();
      try {
        await applySuggestion(db, "company-1", row);
      } catch {
        // A refusal is acceptable; only goal writes are a failure.
      }
      const goalWrites = writes.filter(
        (w) => (w.table === "annual_plans" || w.table === "companies") && w.op === "update"
      );
      if (goalWrites.length > 0) {
        counterexamples.push(
          `target_change ${JSON.stringify(row.proposed_value)} → ` +
            goalWrites.map((w) => `${w.table}.update(${JSON.stringify(w.payload)})`).join(" + ")
        );
      }
    }
    expect(counterexamples).toEqual([]);
  });

  it("buildSuggestionRows stores no target_change from mixed AI output", () => {
    const r = rng(2);
    const initiatives = [{ id: "init-1", name: "Webinar" }];
    const products = [{ id: "prod-1", name: "Coaching" }];
    for (let i = 0; i < RUNS; i++) {
      const ai: any[] = [
        { type: "budget_change", targetName: "Webinar", title: "More budget", current: { plannedBudget: 100 }, proposed: { plannedBudget: 200 } },
        { type: "target_change", targetName: null, title: "Lower goals", current: goals(r), proposed: goals(r) },
        { type: "product_update", targetName: "Coaching", title: "Raise price", current: { price: 1 }, proposed: { price: 2 } },
      ];
      if (r() < 0.5) ai.push({ type: "target_change", targetName: "Goals", current: goals(r), proposed: goals(r) });
      const rows = buildSuggestionRows(ai, {
        companyId: "company-1",
        batchId: `batch-${i}`,
        initiatives,
        products,
        passesFit: () => true,
      });
      const bad = rows.filter((row) => row.suggestion_type === "target_change");
      expect(bad, `run ${i}: stored ${JSON.stringify(bad.map((b) => b.proposed_value))}`).toEqual([]);
    }
  });

  it("toClientSuggestions returns no pending target_change rows", () => {
    const r = rng(3);
    for (let i = 0; i < RUNS; i++) {
      const rows = [
        { id: `b-${i}`, batch_id: "batch", suggestion_type: "budget_change", target_id: "init-1", target_label: "Webinar", title: "t", rationale: "r", current_value: {}, proposed_value: { plannedBudget: 1 }, status: "pending" },
        storedTargetChangeRow(r, i),
      ];
      const out = toClientSuggestions(rows);
      const bad = out.filter((s) => s.type === "target_change");
      expect(bad, `run ${i}: returned ${JSON.stringify(bad.map((b) => b.id))}`).toEqual([]);
    }
  });

  it("ENHANCE_SYSTEM_PROMPT offers no target_change and states goals are fixed", () => {
    expect(ENHANCE_SYSTEM_PROMPT).not.toContain("target_change");
    expect(ENHANCE_SYSTEM_PROMPT).toMatch(/goals?[^.]{0,80}\bfixed\b|\bfixed\b[^.]{0,80}goals?/i);
  });

  it("route guard: target_change is a goal change and never an acceptable type", () => {
    // The accept route returns 409 goal_change_retired when isGoalChangeType is
    // true, before applySuggestion or the status update run.
    expect(isGoalChangeType("target_change")).toBe(true);
    expect(isAcceptableSuggestionType("target_change")).toBe(false);
    for (const t of ["new_initiative", "budget_change", "date_change", "product_update"]) {
      expect(isGoalChangeType(t)).toBe(false);
      expect(isAcceptableSuggestionType(t)).toBe(true);
    }
  });
});
