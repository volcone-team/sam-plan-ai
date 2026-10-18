/**
 * FAQ — admin database access (service-role only).
 *
 * Every function takes a SERVICE-ROLE `SupabaseClient`. Both FAQ tables have
 * RLS on and no policies (migration 039), so nothing else can read them.
 * Body validation lives in `./faq` (`normaliseFaq*Input`); this module adds the
 * checks that need the database: the category exists, slugs are unique, a
 * category is empty before it is deleted, reorder lists are complete.
 *
 * Failures are thrown as `FaqAdminError` with an HTTP status and a stable
 * `code`, so routes map them without string-matching. Same shape as the SAM
 * University admin repo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/db-errors";
import { slugify, uniqueSlug } from "@/lib/university/access";
import { faqCategoryFromRow, faqItemFromRow, isUuid } from "./faq";
import type {
  FaqCategory,
  FaqCategoryInput,
  FaqCategoryRow,
  FaqItem,
  FaqItemInput,
  FaqItemRow,
} from "@/types/faq.types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FaqAdminCatalogue {
  categories: FaqCategory[];
  items: FaqItem[];
}

export type FaqReorderKind = "category" | "item";

export interface FaqReorderInput {
  kind: FaqReorderKind;
  ids: string[];
}

export type FaqAdminErrorCode =
  | "migration_not_applied"
  | "invalid"
  | "not_found"
  | "category_not_empty"
  | "db_error";

/** A failure with an HTTP status. `errors` is field-keyed, for `invalid`. */
export class FaqAdminError extends Error {
  readonly status: number;
  readonly code: FaqAdminErrorCode;
  readonly errors?: Record<string, string>;

  constructor(status: number, code: FaqAdminErrorCode, message: string, errors?: Record<string, string>) {
    super(message);
    this.name = "FaqAdminError";
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const FAQ_CATEGORY_SELECT =
  "id, slug, name, icon, display_order, is_published, created_at, updated_at";

export const FAQ_ITEM_SELECT =
  "id, slug, category_id, question, answer, status, display_order, created_at, updated_at, updated_by";

/** Gap between consecutive display_order values written by reorder/append. */
export const ORDER_STEP = 10;

export const FAQ_MIGRATION_MESSAGE =
  "Migration 039 isn't applied yet. Apply supabase/migrations/039_faq.sql in the Supabase SQL editor, then reload.";

// ─── Error helpers ───────────────────────────────────────────────────────────

interface DbError {
  code?: string | null;
  message?: string | null;
}

function fail(err: DbError, context: string): never {
  if (isMissingTableError(err)) {
    throw new FaqAdminError(503, "migration_not_applied", FAQ_MIGRATION_MESSAGE);
  }
  const message = err.message || "Database error";
  console.error(`[faq/admin-repo] ${context}:`, message);
  throw new FaqAdminError(500, "db_error", `${context}: ${message}`);
}

function invalid(errors: Record<string, string>): never {
  throw new FaqAdminError(400, "invalid", "Please fix the highlighted fields.", errors);
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Everything, drafts and unpublished categories included, in display order. */
export async function loadFaqAdminCatalogue(db: SupabaseClient): Promise<FaqAdminCatalogue> {
  const [cats, items] = await Promise.all([
    db.from("faq_categories").select(FAQ_CATEGORY_SELECT).order("display_order").order("name"),
    db.from("faq_items").select(FAQ_ITEM_SELECT).order("display_order").order("question"),
  ]);
  if (cats.error) fail(cats.error, "Categories read failed");
  if (items.error) fail(items.error, "Items read failed");
  return {
    categories: ((cats.data ?? []) as FaqCategoryRow[]).map(faqCategoryFromRow),
    items: ((items.data ?? []) as FaqItemRow[]).map(faqItemFromRow),
  };
}

async function loadCategoryRow(db: SupabaseClient, id: string): Promise<FaqCategoryRow | null> {
  const { data, error } = await db.from("faq_categories").select(FAQ_CATEGORY_SELECT).eq("id", id).maybeSingle();
  if (error) fail(error, "Category read failed");
  return (data as FaqCategoryRow | null) ?? null;
}

async function loadItemRow(db: SupabaseClient, id: string): Promise<FaqItemRow | null> {
  const { data, error } = await db.from("faq_items").select(FAQ_ITEM_SELECT).eq("id", id).maybeSingle();
  if (error) fail(error, "Item read failed");
  return (data as FaqItemRow | null) ?? null;
}

async function loadSlugs(db: SupabaseClient, table: string): Promise<string[]> {
  const { data, error } = await db.from(table).select("slug");
  if (error) fail(error, "Slug read failed");
  return ((data ?? []) as { slug: string }[]).map((r) => r.slug);
}

/** Next display_order after the current maximum (for appending). */
async function nextOrder(
  db: SupabaseClient,
  table: string,
  filter?: { column: string; value: string }
): Promise<number> {
  let query = db.from(table).select("display_order");
  if (filter) query = query.eq(filter.column, filter.value);
  const { data, error } = await query.order("display_order", { ascending: false }).limit(1);
  if (error) fail(error, "Order read failed");
  const top = ((data ?? []) as { display_order: number }[])[0]?.display_order;
  return typeof top === "number" ? top + ORDER_STEP : ORDER_STEP;
}

/** 400 `errors.categoryId` unless the category exists. */
export async function assertFaqCategoryExists(db: SupabaseClient, categoryId: string): Promise<void> {
  const row = await loadCategoryRow(db, categoryId);
  if (!row) invalid({ categoryId: "That category no longer exists. Reload and choose another." });
}

// ─── Categories ──────────────────────────────────────────────────────────────

/** Create a category. Slug from the name, made unique; appended when no order given. */
export async function createFaqCategory(
  db: SupabaseClient,
  input: FaqCategoryInput,
  opts: { hasDisplayOrder: boolean }
): Promise<FaqCategory> {
  const slug = uniqueSlug(slugify(input.name), await loadSlugs(db, "faq_categories"));
  const displayOrder = opts.hasDisplayOrder ? input.displayOrder : await nextOrder(db, "faq_categories");

  const { data, error } = await db
    .from("faq_categories")
    .insert({
      slug,
      name: input.name,
      icon: input.icon,
      display_order: displayOrder,
      is_published: input.isPublished,
    })
    .select(FAQ_CATEGORY_SELECT)
    .single();
  if (error) fail(error, "Category create failed");
  return faqCategoryFromRow(data as FaqCategoryRow);
}

/** Update a category. The slug never changes; missing display order keeps the current one. */
export async function updateFaqCategory(
  db: SupabaseClient,
  id: string,
  input: FaqCategoryInput,
  opts: { hasDisplayOrder: boolean }
): Promise<FaqCategory> {
  const existing = await loadCategoryRow(db, id);
  if (!existing) throw new FaqAdminError(404, "not_found", "Category not found.");

  const { data, error } = await db
    .from("faq_categories")
    .update({
      name: input.name,
      icon: input.icon,
      display_order: opts.hasDisplayOrder ? input.displayOrder : existing.display_order,
      is_published: input.isPublished,
    })
    .eq("id", id)
    .select(FAQ_CATEGORY_SELECT)
    .single();
  if (error) fail(error, "Category update failed");
  return faqCategoryFromRow(data as FaqCategoryRow);
}

/**
 * Delete an EMPTY category. The FK cascades, so deleting one with items would
 * silently delete them too — refused with 409 `category_not_empty` instead.
 */
export async function deleteFaqCategory(db: SupabaseClient, id: string): Promise<FaqCategory> {
  const existing = await loadCategoryRow(db, id);
  if (!existing) throw new FaqAdminError(404, "not_found", "Category not found.");

  // A real select, not head:true — a HEAD against a missing table reports no error.
  const { data: inside, error: countError } = await db
    .from("faq_items")
    .select("id")
    .eq("category_id", id)
    .limit(1);
  if (countError) fail(countError, "Item check failed");
  if ((inside ?? []).length > 0) {
    throw new FaqAdminError(409, "category_not_empty", "This category still has questions. Move or delete them first.");
  }

  const { error } = await db.from("faq_categories").delete().eq("id", id);
  if (error) fail(error, "Category delete failed");
  return faqCategoryFromRow(existing);
}

// ─── Items ───────────────────────────────────────────────────────────────────

function itemColumns(input: FaqItemInput, userId: string) {
  return {
    category_id: input.categoryId,
    question: input.question,
    answer: input.answer,
    status: input.status,
    updated_by: userId,
  };
}

/** Create an item. Category checked first; appended to its category when no order given. */
export async function createFaqItem(
  db: SupabaseClient,
  input: FaqItemInput,
  userId: string,
  opts: { hasDisplayOrder: boolean }
): Promise<FaqItem> {
  await assertFaqCategoryExists(db, input.categoryId);

  const slug = uniqueSlug(slugify(input.question), await loadSlugs(db, "faq_items"));
  const displayOrder = opts.hasDisplayOrder
    ? input.displayOrder
    : await nextOrder(db, "faq_items", { column: "category_id", value: input.categoryId });

  const { data, error } = await db
    .from("faq_items")
    .insert({ ...itemColumns(input, userId), slug, display_order: displayOrder })
    .select(FAQ_ITEM_SELECT)
    .single();
  if (error) fail(error, "Item create failed");
  return faqItemFromRow(data as FaqItemRow);
}

/**
 * Update an item. The slug never changes. Missing display order keeps the
 * current one; an item moved to another category without an order is appended there.
 */
export async function updateFaqItem(
  db: SupabaseClient,
  id: string,
  input: FaqItemInput,
  userId: string,
  opts: { hasDisplayOrder: boolean }
): Promise<FaqItem> {
  const existing = await loadItemRow(db, id);
  if (!existing) throw new FaqAdminError(404, "not_found", "Question not found.");

  await assertFaqCategoryExists(db, input.categoryId);

  let displayOrder = existing.display_order;
  if (opts.hasDisplayOrder) displayOrder = input.displayOrder;
  else if (existing.category_id !== input.categoryId) {
    displayOrder = await nextOrder(db, "faq_items", { column: "category_id", value: input.categoryId });
  }

  const { data, error } = await db
    .from("faq_items")
    .update({ ...itemColumns(input, userId), display_order: displayOrder })
    .eq("id", id)
    .select(FAQ_ITEM_SELECT)
    .single();
  if (error) fail(error, "Item update failed");
  return faqItemFromRow(data as FaqItemRow);
}

/** Delete an item. Returns it, for the log. */
export async function deleteFaqItem(db: SupabaseClient, id: string): Promise<FaqItem> {
  const existing = await loadItemRow(db, id);
  if (!existing) throw new FaqAdminError(404, "not_found", "Question not found.");

  const { error } = await db.from("faq_items").delete().eq("id", id);
  if (error) fail(error, "Item delete failed");
  return faqItemFromRow(existing);
}

// ─── Reorder ─────────────────────────────────────────────────────────────────

/** Validate `{ kind: "category" | "item", ids: uuid[] }`: non-empty, no duplicates. */
export function normaliseFaqReorderInput(
  raw: unknown
): { ok: true; value: FaqReorderInput } | { ok: false; errors: Record<string, string> } {
  const r = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};

  const kind = r.kind;
  if (kind !== "category" && kind !== "item") errors.kind = 'kind must be "category" or "item".';

  let ids: string[] = [];
  if (!Array.isArray(r.ids) || r.ids.length === 0) {
    errors.ids = "ids must be a non-empty list.";
  } else {
    const cleaned = r.ids.map((v) => (typeof v === "string" ? v.trim().toLowerCase() : v));
    if (!cleaned.every(isUuid)) errors.ids = "Every id must be a valid id.";
    else if (new Set(cleaned).size !== cleaned.length) errors.ids = "An id appears more than once.";
    else ids = cleaned as string[];
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { kind: kind as FaqReorderKind, ids } };
}

/**
 * Write display_order = 10, 20, 30… in the given order. The list must be
 * COMPLETE: every category, or every item of exactly one category.
 *
 * One UPDATE per row, not transactional: a failure midway leaves a mixed but
 * harmless order, fixed by reordering again.
 */
export async function reorderFaq(db: SupabaseClient, input: FaqReorderInput): Promise<void> {
  const table = input.kind === "category" ? "faq_categories" : "faq_items";

  if (input.kind === "category") {
    const { data, error } = await db.from(table).select("id");
    if (error) fail(error, "Reorder read failed");
    const all = new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
    if (input.ids.some((id) => !all.has(id))) invalid({ ids: "One of these categories no longer exists. Reload and try again." });
    if (all.size !== input.ids.length) invalid({ ids: "The list must include every category. Reload and try again." });
  } else {
    const { data, error } = await db.from(table).select("id, category_id").in("id", input.ids);
    if (error) fail(error, "Reorder read failed");
    const rows = (data ?? []) as { id: string; category_id: string }[];
    if (rows.length !== input.ids.length) invalid({ ids: "One of these questions no longer exists. Reload and try again." });
    const categories = new Set(rows.map((r) => r.category_id));
    if (categories.size !== 1) invalid({ ids: "Questions can only be reordered within one category." });
    const [categoryId] = [...categories];

    const { data: siblings, error: sibError } = await db.from(table).select("id").eq("category_id", categoryId);
    if (sibError) fail(sibError, "Reorder read failed");
    if ((siblings ?? []).length !== input.ids.length) {
      invalid({ ids: "The list must include every question in the category. Reload and try again." });
    }
  }

  const results = await Promise.all(
    input.ids.map((id, i) => db.from(table).update({ display_order: (i + 1) * ORDER_STEP }).eq("id", id))
  );
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) fail(firstError, "Reorder write failed");
}
