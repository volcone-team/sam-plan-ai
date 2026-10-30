/**
 * Property 2: Preservation — all other suggestion behaviour unchanged.
 *
 * Observation-first: every expectation below was recorded from the unfixed
 * code (F) for inputs where isBugCondition is false (no target_change), and
 * must keep holding after the fix.
 *
 * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.9**
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  loadLibrary: vi.fn(),
  loadCompanyFit: vi.fn(),
  rejectionReason: vi.fn(),
  checkLiveLimit: vi.fn(),
  resolveSuggestionInitiative: vi.fn(),
  resolveTaskTemplates: vi.fn(),
  insertWithLibraryKey: vi.fn(),
}));

vi.mock("@/lib/workbook/read", () => ({ loadLibrary: mocks.loadLibrary }));
vi.mock("@/lib/recommend/company-eligibility", () => ({
  loadCompanyFit: mocks.loadCompanyFit,
  rejectionReason: mocks.rejectionReason,
}));
vi.mock("@/lib/billing/live-limits", () => ({ checkLiveLimit: mocks.checkLiveLimit }));
vi.mock("@/lib/initiatives/suggestion-initiative", async (orig) => ({
  ...(await orig<any>()),
  resolveSuggestionInitiative: mocks.resolveSuggestionInitiative,
}));
vi.mock("@/lib/workbook/tasks-for-initiatives", async (orig) => ({
  ...(await orig<any>()),
  resolveTaskTemplates: mocks.resolveTaskTemplates,
}));
vi.mock("@/lib/workbook/initiative-type", async (orig) => ({
  ...(await orig<any>()),
  insertWithLibraryKey: mocks.insertWithLibraryKey,
}));

import { applySuggestion, SuggestionRejected, SuggestionOverLimit } from "./apply-suggestion";
import { buildSuggestionRows, toClientSuggestions } from "./suggestion-rows";
import { buildPlanSummary } from "./enhance-prompt";

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
const int = (r: Rand, n: number) => Math.floor(r() * n);
function money(r: Rand): number | string {
  const n = pick(r, [0, int(r, 5000), int(r, 500_000), 1_000_000 + int(r, 9_000_000)] as const);
  return r() < 0.3 ? String(n) : n;
}
function text(r: Rand, max: number): string {
  return "x".repeat(int(r, max));
}

const RUNS = 50;
const NON_GOAL_TYPES = ["new_initiative", "budget_change", "date_change", "product_update"] as const;

/** Local calendar day as YYYY-MM-DD, computed independently of plan-dates. */
function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function today(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

// ---------- fake db recording writes and their filters ----------

type Write = {
  table: string;
  op: "update" | "insert" | "delete" | "upsert";
  payload?: any;
  filters: [string, unknown][];
};

function fakeDb(results: Record<string, unknown> = {}) {
  const writes: Write[] = [];
  const from = (table: string) => {
    let current: Write | null = null;
    const result = { data: results[table] ?? null, error: null };
    const write = (op: Write["op"], payload?: unknown) => {
      current = { table, op, payload, filters: [] };
      writes.push(current);
      return b;
    };
    const b: any = {
      select: () => b,
      eq: (col: string, val: unknown) => { current?.filters.push([col, val]); return b; },
      order: () => b,
      limit: () => b,
      single: () => b,
      maybeSingle: () => b,
      update: (p: unknown) => write("update", p),
      insert: (p: unknown) => write("insert", p),
      upsert: (p: unknown) => write("upsert", p),
      delete: () => write("delete"),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad),
    };
    return b;
  };
  return { db: { from } as any, writes };
}

const goalWrites = (writes: Write[]) =>
  writes.filter((w) => (w.table === "annual_plans" || w.table === "companies") && w.op !== "insert");

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

// ---------- applySuggestion: change types ----------

describe("Property 2: applySuggestion preserves non-goal writes", () => {
  it("budget_change: one initiatives.update({ planned_budget }) scoped by id and company (3.2)", async () => {
    const r = rng(10);
    for (let i = 0; i < RUNS; i++) {
      const raw = r() < 0.1 ? pick(r, [null, "abc", undefined] as const) : money(r);
      const row = { suggestion_type: "budget_change", target_id: `init-${i}`, proposed_value: { plannedBudget: raw } };
      const { db, writes } = fakeDb();
      await applySuggestion(db, "company-1", row);
      expect(writes).toEqual([
        {
          table: "initiatives",
          op: "update",
          payload: { planned_budget: Number(raw) || 0 },
          filters: [["id", `init-${i}`], ["company_id", "company-1"]],
        },
      ]);
    }
  });

  it("budget_change without a target throws and writes nothing", async () => {
    const { db, writes } = fakeDb();
    await expect(
      applySuggestion(db, "company-1", { suggestion_type: "budget_change", target_id: null, proposed_value: { plannedBudget: 5 } })
    ).rejects.toThrow("No target initiative for budget change");
    expect(writes).toEqual([]);
  });

  it("date_change: ISO and month-number inputs set activation_date floored at today (3.3)", async () => {
    const r = rng(11);
    const t = today();
    const year = new Date().getFullYear();
    for (let i = 0; i < RUNS; i++) {
      let raw: string | number;
      let expected: string;
      const kind = pick(r, ["past-iso", "future-iso", "iso-time", "month", "month-string"] as const);
      if (kind === "past-iso") {
        raw = `${2000 + int(r, 20)}-0${1 + int(r, 9)}-1${int(r, 9)}`;
        expected = ymd(t);
      } else if (kind === "future-iso" || kind === "iso-time") {
        const d = `${2090 + int(r, 9)}-0${1 + int(r, 9)}-2${int(r, 8)}`;
        raw = kind === "iso-time" ? `${d}T10:00:00Z` : d;
        expected = d;
      } else {
        const m = 1 + int(r, 12);
        raw = kind === "month" ? m : String(m);
        const first = new Date(year, m - 1, 1);
        expected = ymd(first < t ? t : first);
      }
      const row = { suggestion_type: "date_change", target_id: `init-${i}`, proposed_value: { activationMonth: raw } };
      const { db, writes } = fakeDb();
      await applySuggestion(db, "company-1", row);
      expect(writes, `${kind} ${raw}`).toEqual([
        {
          table: "initiatives",
          op: "update",
          payload: { activation_date: expected },
          filters: [["id", `init-${i}`], ["company_id", "company-1"]],
        },
      ]);
    }
  });

  it("date_change with an invalid month throws and writes nothing", async () => {
    for (const raw of [0, 13, "abc", null]) {
      const { db, writes } = fakeDb();
      await expect(
        applySuggestion(db, "company-1", { suggestion_type: "date_change", target_id: "init-1", proposed_value: { activationMonth: raw } })
      ).rejects.toThrow("Invalid activation month");
      expect(writes).toEqual([]);
    }
  });

  it("product_update: one products.update({ price }) scoped by id and company (3.4)", async () => {
    const r = rng(12);
    for (let i = 0; i < RUNS; i++) {
      const price = money(r);
      const row = {
        suggestion_type: "product_update",
        target_id: `prod-${i}`,
        proposed_value: r() < 0.5 ? { price } : { price, note: "bundle it" },
      };
      const { db, writes } = fakeDb();
      await applySuggestion(db, "company-1", row);
      expect(writes).toEqual([
        {
          table: "products",
          op: "update",
          payload: { price: Number(price) || 0 },
          filters: [["id", `prod-${i}`], ["company_id", "company-1"]],
        },
      ]);
    }
  });

  it("product_update with no price throws and writes nothing", async () => {
    const { db, writes } = fakeDb();
    await expect(
      applySuggestion(db, "company-1", { suggestion_type: "product_update", target_id: "prod-1", proposed_value: { note: "x" } })
    ).rejects.toThrow("No product changes to apply");
    expect(writes).toEqual([]);
  });
});

// ---------- applySuggestion: new_initiative ----------

describe("Property 2: applySuggestion new_initiative (3.1)", () => {
  const TEMPLATES = [
    { taskNumber: 1, name: "Plan", leadDays: 30, dependsOn: [], displayOrder: 0 },
    { taskNumber: 2, name: "Promote", leadDays: 14, dependsOn: [1], displayOrder: 1 },
    { taskNumber: 3, name: "Run", leadDays: 0, dependsOn: [2], displayOrder: 2 },
  ];

  function stubCollaborators(opts: { reason?: string | null; limitOk?: boolean } = {}) {
    mocks.loadLibrary.mockResolvedValue([{ initiativeKey: "webinar" }]);
    mocks.loadCompanyFit.mockResolvedValue({ ctx: {} });
    mocks.rejectionReason.mockReturnValue(opts.reason ?? null);
    mocks.checkLiveLimit.mockResolvedValue(
      opts.limitOk === false
        ? { ok: false, code: "limit_reached", key: "max_initiatives", limit: 3, used: 3, adding: 1, remaining: 0, message: "Plan limit reached" }
        : { ok: true, code: "ok", key: "max_initiatives", limit: null, used: 0, adding: 1, remaining: null, message: "" }
    );
    mocks.resolveSuggestionInitiative.mockResolvedValue({ typeId: "type-1", libraryKey: "webinar", metricSet: null });
    mocks.resolveTaskTemplates.mockImplementation(async (_db: unknown, keys: string[]) =>
      new Map(keys.map((k) => [k, { templates: TEMPLATES, source: "template" }]))
    );
    mocks.insertWithLibraryKey.mockImplementation(async (row: any, _key: unknown, insert: (r: any) => unknown) => insert(row));
  }

  const dbResults = {
    annual_plans: { id: "plan-1", year: 2027 },
    products: [{ id: "prod-1" }],
    initiatives: { id: "init-new" },
  };

  it("inserts one initiative and its tasks, and never updates goals", async () => {
    const r = rng(13);
    const t = ymd(today());
    for (let i = 0; i < RUNS; i++) {
      for (const m of Object.values(mocks)) m.mockReset();
      stubCollaborators();
      const revenueBetter = int(r, 200_000);
      const plannedBudget = int(r, 20_000);
      const activationMonth = pick(r, [
        `2099-0${1 + int(r, 9)}-15`,
        `2001-0${1 + int(r, 9)}-15`,
        1 + int(r, 12),
      ] as const);
      const row = {
        suggestion_type: "new_initiative",
        title: "New webinar",
        proposed_value: { name: `Webinar ${i}`, libraryKey: "webinar", activationMonth, plannedBudget, revenueBetter },
      };
      const { db, writes } = fakeDb(dbResults);
      await applySuggestion(db, "company-1", row);

      expect(goalWrites(writes)).toEqual([]);
      const inits = writes.filter((w) => w.table === "initiatives");
      expect(inits).toHaveLength(1);
      expect(inits[0].op).toBe("insert");
      expect(inits[0].payload).toMatchObject({
        company_id: "company-1",
        annual_plan_id: "plan-1",
        product_id: "prod-1",
        initiative_type_id: "type-1",
        name: `Webinar ${i}`,
        kind: "one-time",
        status: "planned",
        planned_budget: plannedBudget,
        revenue_better: revenueBetter,
        revenue_good: Math.round(revenueBetter * 0.7),
        revenue_best: Math.round(revenueBetter * 1.3),
        actual_spend: 0,
      });
      expect(inits[0].payload.activation_date >= t).toBe(true);
      expect(inits[0].payload.event_date >= inits[0].payload.activation_date).toBe(true);

      const tasks = writes.filter((w) => w.table === "tasks");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].op).toBe("insert");
      expect(tasks[0].payload).toHaveLength(TEMPLATES.length);
      for (const task of tasks[0].payload) {
        expect(task).toMatchObject({ initiative_id: "init-new", company_id: "company-1", status: "not_started" });
        expect(task.due_date >= t).toBe(true);
      }
      expect(mocks.checkLiveLimit).toHaveBeenCalledWith(db, "company-1", "max_initiatives", 1, {
        annualPlanId: "plan-1",
        year: 2027,
      });
    }
  });

  it("FIT refusal throws SuggestionRejected with the rule's reason and writes nothing", async () => {
    stubCollaborators({ reason: "Not offered for your business" });
    const { db, writes } = fakeDb(dbResults);
    const p = applySuggestion(db, "company-1", {
      suggestion_type: "new_initiative",
      proposed_value: { name: "X", libraryKey: "webinar", activationMonth: "2099-01-01" },
    });
    await expect(p).rejects.toBeInstanceOf(SuggestionRejected);
    await expect(p).rejects.toThrow("Not offered for your business");
    expect(writes).toEqual([]);
    expect(mocks.checkLiveLimit).not.toHaveBeenCalled();
  });

  it("limit refusal throws SuggestionOverLimit carrying the result and writes nothing", async () => {
    stubCollaborators({ limitOk: false });
    const { db, writes } = fakeDb(dbResults);
    const err = await applySuggestion(db, "company-1", {
      suggestion_type: "new_initiative",
      proposed_value: { name: "X", libraryKey: "webinar", activationMonth: "2099-01-01" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SuggestionOverLimit);
    expect(err.message).toBe("Plan limit reached");
    expect(err.result.ok).toBe(false);
    expect(writes).toEqual([]);
    expect(mocks.insertWithLibraryKey).not.toHaveBeenCalled();
  });
});

// ---------- buildSuggestionRows / toClientSuggestions ----------

const INITIATIVES = [
  { id: "init-1", name: "Spring Webinar" },
  { id: "init-2", name: "Summit Booth" },
];
const PRODUCTS = [
  { id: "prod-1", name: "Coaching" },
  { id: "prod-2", name: "Course" },
];

/** F's mapping for non-goal types, recorded from the unfixed code. */
function expectedRow(s: any, companyId: string, batchId: string) {
  const name = (s.targetName || "").toLowerCase();
  let targetId: string | null = null;
  if (s.type === "product_update") targetId = PRODUCTS.find((p) => p.name.toLowerCase() === name)?.id ?? null;
  else if (s.type !== "new_initiative") targetId = INITIATIVES.find((i) => i.name.toLowerCase() === name)?.id ?? null;
  return {
    company_id: companyId,
    batch_id: batchId,
    suggestion_type: s.type,
    target_id: targetId,
    target_label: s.targetName || null,
    title: String(s.title || "Suggestion").slice(0, 300),
    rationale: String(s.rationale || "").slice(0, 500),
    current_value: s.current || {},
    proposed_value: s.proposed || {},
    status: "pending",
  };
}

function aiSuggestion(r: Rand): any {
  const type = r() < 0.15 ? pick(r, ["delete_initiative", "unknown", ""] as const) : pick(r, NON_GOAL_TYPES);
  const names = type === "product_update"
    ? ["Coaching", "COURSE", "Missing product", null]
    : ["Spring Webinar", "summit booth", "Unknown", null];
  const s: any = {
    type,
    targetName: pick(r, names),
    title: r() < 0.15 ? undefined : text(r, 400),
    rationale: r() < 0.15 ? undefined : text(r, 700),
  };
  if (r() < 0.8) s.current = { plannedBudget: int(r, 1000) };
  if (r() < 0.8) s.proposed = { libraryKey: pick(r, ["webinar", "blocked"] as const), plannedBudget: int(r, 1000) };
  return s;
}

describe("Property 2: buildSuggestionRows / toClientSuggestions for non-goal types", () => {
  it("buildSuggestionRows maps target ids, truncates text and drops FIT failures as F does", () => {
    const r = rng(14);
    for (let i = 0; i < RUNS; i++) {
      const ai = Array.from({ length: 1 + int(r, 8) }, () => aiSuggestion(r));
      const passesFit = (s: any) => !(s.type === "new_initiative" && s.proposed?.libraryKey === "blocked");
      const rows = buildSuggestionRows(ai, {
        companyId: "company-1",
        batchId: `batch-${i}`,
        initiatives: INITIATIVES,
        products: PRODUCTS,
        passesFit,
      });
      const expected = ai
        .filter((s) => (NON_GOAL_TYPES as readonly string[]).includes(s.type))
        .filter(passesFit)
        .map((s) => expectedRow(s, "company-1", `batch-${i}`));
      expect(rows).toEqual(expected);
    }
  });

  it("buildSuggestionRows tolerates missing initiatives and products", () => {
    const rows = buildSuggestionRows(
      [{ type: "budget_change", targetName: "Spring Webinar" }, { type: "product_update", targetName: "Coaching" }],
      { companyId: "c", batchId: "b", initiatives: null, products: undefined, passesFit: () => true }
    );
    expect(rows.map((x) => x.target_id)).toEqual([null, null]);
    expect(rows.map((x) => x.title)).toEqual(["Suggestion", "Suggestion"]);
  });

  it("toClientSuggestions maps non-goal rows field for field", () => {
    const r = rng(15);
    for (let i = 0; i < RUNS; i++) {
      const rows = Array.from({ length: int(r, 6) }, (_, j) => ({
        id: `s-${i}-${j}`,
        batch_id: `batch-${int(r, 3)}`,
        company_id: "company-1",
        suggestion_type: pick(r, NON_GOAL_TYPES),
        target_id: r() < 0.5 ? `init-${j}` : null,
        target_label: r() < 0.5 ? "Spring Webinar" : null,
        title: text(r, 20),
        rationale: text(r, 20),
        current_value: { plannedBudget: int(r, 100) },
        proposed_value: { plannedBudget: int(r, 100) },
        status: "pending",
        created_at: "2026-10-27T00:00:00Z",
      }));
      expect(toClientSuggestions(rows)).toEqual(
        rows.map((s) => ({
          id: s.id,
          batchId: s.batch_id,
          type: s.suggestion_type,
          targetId: s.target_id,
          targetLabel: s.target_label,
          title: s.title,
          rationale: s.rationale,
          current: s.current_value,
          proposed: s.proposed_value,
          status: s.status,
        }))
      );
    }
    expect(toClientSuggestions(null)).toEqual([]);
    expect(toClientSuggestions(undefined)).toEqual([]);
  });
});

// ---------- buildPlanSummary ----------

describe("Property 2: buildPlanSummary keeps the goals as context (3.9)", () => {
  it("lists Baseline and Stretch from the annual plan, falling back to the company", () => {
    const r = rng(16);
    for (let i = 0; i < RUNS; i++) {
      const plan = r() < 0.7 ? { baseline_revenue: money(r), stretch_revenue: money(r), operating_budget: money(r) } : null;
      const company = { baseline_revenue: money(r), stretch_revenue: money(r), operating_budget: money(r), target_revenue: money(r) };
      const out = buildPlanSummary({
        today: "2026-10-27",
        planYear: 2027,
        company,
        annualPlan: plan,
        products: [{ name: "Coaching", price: 500, revenue_type: "one_time" }],
        initiatives: [{ name: "Spring Webinar", status: "planned", activation_date: "2027-03-01", planned_budget: 100, revenue_better: 1000 }],
      });
      const baseline = plan?.baseline_revenue || company.baseline_revenue || 0;
      const stretch = plan?.stretch_revenue || company.stretch_revenue || 0;
      expect(out).toContain("Revenue Targets:");
      expect(out).toContain(`- Baseline: $${baseline}\n`);
      expect(out).toContain(`- Stretch: $${stretch}\n`);
    }
  });
});
