import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FaqAdminError,
  createFaqItem,
  deleteFaqCategory,
  loadFaqAdminCatalogue,
  normaliseFaqReorderInput,
  reorderFaq,
  updateFaqItem,
} from "./admin-repo";
import type { FaqItemInput } from "@/types/faq.types";

// ── Recorded Supabase stand-in (same approach as university/admin-repo.test) ─
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
const ITEM = "33333333-3333-4333-8333-333333333333";
const ITEM2 = "44444444-4444-4444-8444-444444444444";
const ADMIN = "88888888-8888-4888-8888-888888888888";

const categoryRow = {
  id: CAT, slug: "billing", name: "Billing", icon: "CreditCard",
  display_order: 10, is_published: true, created_at: "t", updated_at: "t",
};

function itemRow(over: Record<string, unknown> = {}) {
  return {
    id: ITEM, slug: "is-there-a-trial", category_id: CAT, question: "Is there a trial?",
    answer: "Yes.", status: "published", display_order: 10, created_at: "t", updated_at: "t",
    updated_by: ADMIN, ...over,
  };
}

function input(over: Partial<FaqItemInput> = {}): FaqItemInput {
  return { categoryId: CAT, question: "Is there a trial?", answer: "Yes.", status: "draft", displayOrder: 0, ...over };
}

function world(extra?: (q: Query) => Answer | undefined): (q: Query) => Answer {
  return (q) => {
    const custom = extra?.(q);
    if (custom) return custom;
    if (q.table === "faq_categories") return { data: has(q, "maybeSingle") ? categoryRow : [categoryRow] };
    if (q.table === "faq_items") {
      if (has(q, "insert") || has(q, "update")) {
        const payload = (arg(q, "insert") ?? arg(q, "update"))?.[0] as Record<string, unknown>;
        return { data: itemRow({ ...payload }) };
      }
      if (has(q, "maybeSingle")) return { data: itemRow() };
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

describe("missing tables", () => {
  it("loadFaqAdminCatalogue → 503 migration_not_applied", async () => {
    respond = () => ({ error: { code: "PGRST205", message: "Could not find the table 'public.faq_items'" } });
    await expect(loadFaqAdminCatalogue(makeDb())).rejects.toMatchObject({
      status: 503,
      code: "migration_not_applied",
    });
  });

  it("any other error → 500 db_error", async () => {
    respond = () => ({ error: { code: "57014", message: "timeout" } });
    await expect(loadFaqAdminCatalogue(makeDb())).rejects.toMatchObject({ status: 500, code: "db_error" });
  });
});

describe("deleteFaqCategory", () => {
  it("refuses with 409 while the category has items, and deletes nothing", async () => {
    respond = world((q) => (q.table === "faq_items" ? { data: [{ id: ITEM }] } : undefined));
    const err = await deleteFaqCategory(makeDb(), CAT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FaqAdminError);
    expect(err).toMatchObject({ status: 409, code: "category_not_empty" });
    expect(writes("faq_categories")).toHaveLength(0);
  });

  it("deletes an empty category", async () => {
    const deleted = await deleteFaqCategory(makeDb(), CAT);
    expect(deleted.name).toBe("Billing");
    const [del] = writes("faq_categories");
    expect(arg(del, "eq")).toEqual(["id", CAT]);
  });

  it("404s an unknown category", async () => {
    respond = world((q) => (q.table === "faq_categories" ? { data: null } : undefined));
    await expect(deleteFaqCategory(makeDb(), CAT)).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("createFaqItem", () => {
  it("derives a unique slug, appends to its category and sets updated_by", async () => {
    respond = world((q) => {
      if (q.table !== "faq_items" || has(q, "insert")) return undefined;
      if (arg(q, "select")?.[0] === "slug") return { data: [{ slug: "is-there-a-trial" }] };
      if (arg(q, "select")?.[0] === "display_order") return { data: [{ display_order: 30 }] };
      return undefined;
    });
    await createFaqItem(makeDb(), input(), ADMIN, { hasDisplayOrder: false });
    const [ins] = writes("faq_items");
    expect(arg(ins, "insert")?.[0]).toMatchObject({
      slug: "is-there-a-trial-2", display_order: 40, updated_by: ADMIN, status: "draft", category_id: CAT,
    });
  });

  it("rejects an unknown category before writing", async () => {
    respond = world((q) => (q.table === "faq_categories" ? { data: null } : undefined));
    await expect(createFaqItem(makeDb(), input(), ADMIN, { hasDisplayOrder: false })).rejects.toMatchObject({
      status: 400,
      errors: { categoryId: expect.any(String) },
    });
    expect(writes("faq_items")).toHaveLength(0);
  });
});

describe("updateFaqItem", () => {
  it("keeps the slug and order when staying in the same category", async () => {
    await updateFaqItem(makeDb(), ITEM, input({ status: "published" }), ADMIN, { hasDisplayOrder: false });
    const payload = arg(writes("faq_items")[0], "update")?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ display_order: 10, status: "published", updated_by: ADMIN });
    expect(payload).not.toHaveProperty("slug");
  });

  it("appends when moved to another category", async () => {
    respond = world((q) =>
      q.table === "faq_items" && arg(q, "select")?.[0] === "display_order" ? { data: [{ display_order: 70 }] } : undefined
    );
    await updateFaqItem(makeDb(), ITEM, input({ categoryId: CAT2 }), ADMIN, { hasDisplayOrder: false });
    const payload = arg(writes("faq_items")[0], "update")?.[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ display_order: 80, category_id: CAT2 });
  });
});

describe("reorder", () => {
  it("validates the body", () => {
    expect(normaliseFaqReorderInput({ kind: "resource", ids: [] }).ok).toBe(false);
    expect(normaliseFaqReorderInput({ kind: "item", ids: [ITEM, ITEM] }).ok).toBe(false);
    expect(normaliseFaqReorderInput({ kind: "item", ids: [ITEM.toUpperCase()] })).toEqual({
      ok: true, value: { kind: "item", ids: [ITEM] },
    });
  });

  it("writes 10, 20… for a complete item list of one category", async () => {
    respond = world((q) => {
      if (q.table !== "faq_items" || has(q, "update")) return undefined;
      if (has(q, "in")) return { data: [{ id: ITEM, category_id: CAT }, { id: ITEM2, category_id: CAT }] };
      return { data: [{ id: ITEM }, { id: ITEM2 }] };
    });
    await reorderFaq(makeDb(), { kind: "item", ids: [ITEM2, ITEM] });
    const ups = writes("faq_items").map((q) => [arg(q, "update")?.[0], arg(q, "eq")?.[1]]);
    expect(ups).toEqual([[{ display_order: 10 }, ITEM2], [{ display_order: 20 }, ITEM]]);
  });

  it("refuses a partial category list", async () => {
    respond = world((q) =>
      q.table === "faq_categories" ? { data: [{ id: CAT }, { id: CAT2 }] } : undefined
    );
    await expect(reorderFaq(makeDb(), { kind: "category", ids: [CAT] })).rejects.toMatchObject({ status: 400 });
    expect(writes("faq_categories")).toHaveLength(0);
  });
});
