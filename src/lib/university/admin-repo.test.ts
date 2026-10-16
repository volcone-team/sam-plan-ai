import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  UniversityAdminError,
  assertPlansExist,
  createResource,
  deleteCategory,
  isMissingTableError,
  loadAdminCatalogue,
  normaliseReorderInput,
  reorder,
  replacePlanLinks,
  updateResource,
} from "./admin-repo";
import type { UniversityResourceInput } from "@/types/university.types";

// ── Mocked Supabase ─────────────────────────────────────────────────────────
// Every query chain is recorded as { table, ops }. When the chain is awaited
// (or ends in single/maybeSingle) the `respond` hook answers it, so a test can
// assert both what was asked and what was decided.
type Op = { method: string; args: unknown[] };
type Query = { table: string; ops: Op[] };
type Answer = { data?: unknown; error?: unknown };

let queries: Query[] = [];
let respond: (q: Query) => Answer = () => ({ data: null, error: null });

const CHAIN = ["select", "eq", "in", "order", "limit", "insert", "update", "delete"];

function makeDb(): SupabaseClient {
  const db = {
    from(table: string) {
      const q: Query = { table, ops: [] };
      queries.push(q);
      const settle = () => {
        const a = respond(q);
        return Promise.resolve({ data: a.data ?? null, error: a.error ?? null });
      };
      const builder: Record<string, unknown> = {};
      for (const method of CHAIN) {
        builder[method] = (...args: unknown[]) => {
          q.ops.push({ method, args });
          return builder;
        };
      }
      for (const method of ["single", "maybeSingle"]) {
        builder[method] = () => {
          q.ops.push({ method, args: [] });
          return settle();
        };
      }
      builder.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => settle().then(ok, bad);
      return builder;
    },
  };
  return db as unknown as SupabaseClient;
}

const has = (q: Query, method: string) => q.ops.some((o) => o.method === method);
const arg = (q: Query, method: string) => q.ops.find((o) => o.method === method)?.args;
const writes = (table: string) =>
  queries.filter((q) => q.table === table && (has(q, "insert") || has(q, "update") || has(q, "delete")));

// ── Fixtures ────────────────────────────────────────────────────────────────
const CAT = "11111111-1111-4111-8111-111111111111";
const CAT2 = "22222222-2222-4222-8222-222222222222";
const RES = "33333333-3333-4333-8333-333333333333";
const RES2 = "44444444-4444-4444-8444-444444444444";
const PRO = "55555555-5555-4555-8555-555555555555";
const STARTER = "66666666-6666-4666-8666-666666666666";
const UNKNOWN = "77777777-7777-4777-8777-777777777777";
const ADMIN = "88888888-8888-4888-8888-888888888888";

const categoryRow = {
  id: CAT, slug: "getting-started", name: "Getting Started", description: null, icon: "BookOpen",
  display_order: 10, is_published: true, created_at: "t", updated_at: "t",
};

function resourceRow(over: Record<string, unknown> = {}) {
  return {
    id: RES, slug: "intro", category_id: CAT, title: "Intro", description: null,
    resource_type: "video", url: "https://youtu.be/dQw4w9WgXcQ", duration_minutes: 5,
    status: "published", is_free: false, display_order: 10, created_at: "t", updated_at: "t",
    updated_by: ADMIN, ...over,
  };
}

function input(over: Partial<UniversityResourceInput> = {}): UniversityResourceInput {
  return {
    categoryId: CAT, title: "Intro", description: null, type: "video",
    url: "https://youtu.be/dQw4w9WgXcQ", durationMinutes: 5, status: "published",
    isFree: false, planIds: [PRO], displayOrder: 0, ...over,
  };
}

/** Default world: one category, one resource, plans PRO and STARTER exist. */
function world(extra?: (q: Query) => Answer | undefined): (q: Query) => Answer {
  return (q) => {
    const custom = extra?.(q);
    if (custom) return custom;
    if (q.table === "subscription_plans") {
      const ids = (arg(q, "in")?.[1] as string[] | undefined) ?? [];
      return { data: [PRO, STARTER].filter((p) => ids.includes(p)).map((id) => ({ id })) };
    }
    if (q.table === "university_categories") return { data: categoryRow };
    if (q.table === "university_resources") {
      if (has(q, "insert") || has(q, "update")) {
        const payload = (arg(q, "insert") ?? arg(q, "update"))?.[0] as Record<string, unknown>;
        return { data: resourceRow({ ...payload }) };
      }
      if (has(q, "maybeSingle")) return { data: resourceRow() };
      return { data: [] };
    }
    return { data: null };
  };
}

beforeEach(() => {
  queries = [];
  respond = world();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── Plan-link replacement ───────────────────────────────────────────────────
describe("replacePlanLinks", () => {
  it("deletes the resource's links, then inserts the new set", async () => {
    await replacePlanLinks(makeDb(), RES, false, [PRO, STARTER, PRO]);
    const [del, ins] = writes("university_resource_plans");
    expect(has(del, "delete")).toBe(true);
    expect(arg(del, "eq")).toEqual(["resource_id", RES]);
    expect(arg(ins, "insert")?.[0]).toEqual([
      { resource_id: RES, plan_id: PRO },
      { resource_id: RES, plan_id: STARTER },
    ]);
  });

  it("removes every link and inserts nothing when the resource is free", async () => {
    await replacePlanLinks(makeDb(), RES, true, [PRO]);
    const w = writes("university_resource_plans");
    expect(w).toHaveLength(1);
    expect(has(w[0], "delete")).toBe(true);
  });

  it("reports plan_links_failed (500) when the insert fails", async () => {
    respond = world((q) =>
      q.table === "university_resource_plans" && has(q, "insert")
        ? { error: { code: "23503", message: "fk violation" } }
        : undefined
    );
    await expect(replacePlanLinks(makeDb(), RES, false, [PRO])).rejects.toMatchObject({
      status: 500,
      code: "plan_links_failed",
    });
  });

  it("writes the resource row before the links on update, and links are cleared when it becomes free", async () => {
    const saved = await updateResource(makeDb(), RES, input({ isFree: true, planIds: [] }), ADMIN, {
      hasDisplayOrder: false,
    });
    const order = queries.filter((q) => has(q, "update") || has(q, "delete") || has(q, "insert"));
    expect(order.map((q) => q.table)).toEqual(["university_resources", "university_resource_plans"]);
    const payload = arg(order[0], "update")?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ is_free: true, updated_by: ADMIN, display_order: 10 });
    expect(payload).not.toHaveProperty("slug");
    expect(saved.planIds).toEqual([]);
  });
});

// ── Plan existence ──────────────────────────────────────────────────────────
describe("unknown plan ids", () => {
  it("are rejected with a field error on planIds", async () => {
    const err = await assertPlansExist(makeDb(), [PRO, UNKNOWN]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UniversityAdminError);
    expect(err).toMatchObject({ status: 400, code: "invalid" });
    expect((err as UniversityAdminError).errors?.planIds).toBeTruthy();
  });

  it("stop a create before anything is written", async () => {
    await expect(
      createResource(makeDb(), input({ planIds: [UNKNOWN] }), ADMIN, { hasDisplayOrder: false })
    ).rejects.toMatchObject({ status: 400, errors: { planIds: expect.any(String) } });
    expect(writes("university_resources")).toHaveLength(0);
    expect(writes("university_resource_plans")).toHaveLength(0);
  });

  it("are not checked for a free resource", async () => {
    await createResource(makeDb(), input({ isFree: true, planIds: [] }), ADMIN, { hasDisplayOrder: false });
    expect(queries.some((q) => q.table === "subscription_plans")).toBe(false);
  });
});

describe("createResource", () => {
  it("derives a unique slug, appends to its category and sets updated_by", async () => {
    respond = world((q) => {
      if (q.table !== "university_resources" || has(q, "insert")) return undefined;
      if (arg(q, "select")?.[0] === "slug") return { data: [{ slug: "intro" }] };
      if (arg(q, "select")?.[0] === "display_order") return { data: [{ display_order: 30 }] };
      return undefined;
    });
    const saved = await createResource(makeDb(), input(), ADMIN, { hasDisplayOrder: false });
    const ins = writes("university_resources")[0];
    expect(arg(ins, "insert")?.[0]).toMatchObject({
      slug: "intro-2", display_order: 40, updated_by: ADMIN, category_id: CAT,
    });
    expect(saved.planIds).toEqual([PRO]);
  });

  it("rejects a category that does not exist", async () => {
    respond = world((q) =>
      q.table === "university_categories" ? { data: null } : undefined
    );
    await expect(
      createResource(makeDb(), input(), ADMIN, { hasDisplayOrder: false })
    ).rejects.toMatchObject({ status: 400, errors: { categoryId: expect.any(String) } });
  });
});

// ── Category delete ─────────────────────────────────────────────────────────
describe("deleteCategory", () => {
  it("refuses with 409 category_not_empty while resources remain", async () => {
    respond = world((q) =>
      q.table === "university_resources" ? { data: [{ id: RES }] } : undefined
    );
    await expect(deleteCategory(makeDb(), CAT)).rejects.toMatchObject({
      status: 409,
      code: "category_not_empty",
    });
    expect(writes("university_categories")).toHaveLength(0);
  });

  it("deletes an empty category", async () => {
    const deleted = await deleteCategory(makeDb(), CAT);
    expect(deleted.name).toBe("Getting Started");
    expect(arg(writes("university_categories")[0], "eq")).toEqual(["id", CAT]);
  });

  it("is 404 for an unknown category", async () => {
    respond = world((q) => (q.table === "university_categories" ? { data: null } : undefined));
    await expect(deleteCategory(makeDb(), CAT)).rejects.toMatchObject({ status: 404 });
  });
});

// ── Reorder ─────────────────────────────────────────────────────────────────
describe("normaliseReorderInput", () => {
  it("accepts a kind and unique uuids, lower-casing them", () => {
    expect(normaliseReorderInput({ kind: "resource", ids: [RES.toUpperCase(), RES2] })).toEqual({
      ok: true,
      value: { kind: "resource", ids: [RES, RES2] },
    });
  });

  it.each([
    [{ kind: "tag", ids: [RES] }, "kind"],
    [{ kind: "category", ids: [] }, "ids"],
    [{ kind: "category" }, "ids"],
    [{ kind: "category", ids: ["not-a-uuid"] }, "ids"],
    [{ kind: "category", ids: [CAT, CAT] }, "ids"],
    [null, "kind"],
  ])("rejects %j on %s", (raw, field) => {
    const out = normaliseReorderInput(raw);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.errors[field]).toBeTruthy();
  });
});

describe("reorder", () => {
  it("writes display_order in steps of 10 for every category", async () => {
    respond = world((q) =>
      q.table === "university_categories" && !has(q, "update")
        ? { data: [{ id: CAT }, { id: CAT2 }] }
        : undefined
    );
    await reorder(makeDb(), { kind: "category", ids: [CAT2, CAT] });
    const ups = writes("university_categories");
    expect(ups.map((q) => [arg(q, "update")?.[0], arg(q, "eq")])).toEqual([
      [{ display_order: 10 }, ["id", CAT2]],
      [{ display_order: 20 }, ["id", CAT]],
    ]);
  });

  it("refuses resources from more than one category", async () => {
    respond = world((q) =>
      q.table === "university_resources" && has(q, "in")
        ? { data: [{ id: RES, category_id: CAT }, { id: RES2, category_id: CAT2 }] }
        : undefined
    );
    await expect(reorder(makeDb(), { kind: "resource", ids: [RES, RES2] })).rejects.toMatchObject({
      status: 400,
      errors: { ids: expect.stringMatching(/one category/) },
    });
    expect(writes("university_resources")).toHaveLength(0);
  });

  it("refuses a partial list of a category's resources", async () => {
    respond = world((q) => {
      if (q.table !== "university_resources") return undefined;
      if (has(q, "in")) return { data: [{ id: RES, category_id: CAT }] };
      return { data: [{ id: RES }, { id: RES2 }] };
    });
    await expect(reorder(makeDb(), { kind: "resource", ids: [RES] })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("refuses an id that does not exist", async () => {
    respond = world((q) =>
      q.table === "university_categories" ? { data: [{ id: CAT }] } : undefined
    );
    await expect(reorder(makeDb(), { kind: "category", ids: [CAT, CAT2] })).rejects.toMatchObject({
      status: 400,
    });
  });
});

// ── Migration detection ─────────────────────────────────────────────────────
describe("isMissingTableError", () => {
  it.each([
    { code: "PGRST205", message: "Could not find the table 'public.university_categories' in the schema cache" },
    { code: "42P01", message: 'relation "university_resources" does not exist' },
    { message: "Could not find the table 'public.university_resource_plans'" },
  ])("recognises %j", (err) => {
    expect(isMissingTableError(err)).toBe(true);
  });

  it.each([null, undefined, "boom", { code: "23505", message: "duplicate key" }, { message: "timeout" }])(
    "ignores %j",
    (err) => {
      expect(isMissingTableError(err)).toBe(false);
    }
  );

  it("turns a missing table into 503 migration_not_applied", async () => {
    respond = (q) =>
      q.table === "university_categories"
        ? { error: { code: "PGRST205", message: "Could not find the table 'public.university_categories'" } }
        : { data: [] };
    await expect(loadAdminCatalogue(makeDb())).rejects.toMatchObject({
      status: 503,
      code: "migration_not_applied",
    });
  });
});
