import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FaqMigrationMissingError, loadPublicFaq } from "./public";
import type { FaqCategoryRow, FaqItemRow } from "@/types/faq.types";

// In-memory stand-in: from().select().eq(), then await. Filters are really
// applied, so the test proves the SQL-side filtering too.
type Row = Record<string, unknown>;
interface FakeError { code: string; message: string }

function fakeDb(tables: Record<string, readonly object[]>, errors: Record<string, FakeError> = {}): SupabaseClient {
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    const result = () =>
      errors[table]
        ? { data: null, error: errors[table] }
        : { data: ((tables[table] ?? []) as readonly Row[]).filter((r) => filters.every((f) => f(r))), error: null };
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b; },
      then: <T>(resolve: (v: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve),
    };
    return b;
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient;
}

const cat = (id: string, is_published = true, display_order = 0): FaqCategoryRow => ({
  id, slug: id, name: `Cat ${id}`, icon: "Rocket", display_order, is_published, created_at: "t", updated_at: "t",
});
const item = (id: string, category_id: string, status: "draft" | "published", display_order = 0): FaqItemRow => ({
  id, slug: id, category_id, question: `Q ${id}`, answer: `answer-${id}`, status, display_order,
  created_at: "t", updated_at: "t", updated_by: "admin-uuid",
});

describe("loadPublicFaq", () => {
  it("returns published items of published categories only, sorted, without admin fields", async () => {
    const res = await loadPublicFaq(fakeDb({
      faq_categories: [cat("b", true, 20), cat("a", true, 10), cat("hidden", false)],
      faq_items: [
        item("a2", "a", "published", 20), item("a1", "a", "published", 10), item("a3", "a", "draft"),
        item("b1", "b", "published"), item("h1", "hidden", "published"),
      ],
    }));
    expect(res.categories.map((c) => c.id)).toEqual(["a", "b"]);
    expect(res.categories[0].items.map((i) => i.id)).toEqual(["a1", "a2"]);
    const json = JSON.stringify(res);
    expect(json).not.toContain("answer-a3");
    expect(json).not.toContain("answer-h1");
    expect(json).not.toContain("admin-uuid");
    expect(json).not.toContain("slug");
  });

  it("missing table → FaqMigrationMissingError", async () => {
    const db = fakeDb({}, { faq_items: { code: "PGRST205", message: "Could not find the table 'public.faq_items'" } });
    await expect(loadPublicFaq(db)).rejects.toBeInstanceOf(FaqMigrationMissingError);
  });

  it("other errors are plain Errors", async () => {
    const db = fakeDb({}, { faq_categories: { code: "57014", message: "statement timeout" } });
    const p = loadPublicFaq(db);
    await expect(p).rejects.toThrow(/timeout/);
    await expect(p).rejects.not.toBeInstanceOf(FaqMigrationMissingError);
  });
});
