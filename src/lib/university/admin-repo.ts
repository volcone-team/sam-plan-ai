/**
 * SAM University — admin database access (service-role only).
 *
 * Every function takes a SERVICE-ROLE `SupabaseClient`. The three university
 * tables have RLS on and no policies (migration 038), so nothing else can read
 * them. Validation of the request body lives in `./access` (`normalise*Input`);
 * this module adds the checks that need the database: category and plan ids
 * exist, slugs are unique, a category is empty before it is deleted.
 *
 * Failures are thrown as `UniversityAdminError`, carrying the HTTP status and a
 * stable `code` so routes can map them to responses without string-matching.
 *
 * NOT TRANSACTIONAL. supabase-js has no multi-statement transaction, so a
 * resource save is two steps: the resource row, then its plan links (delete
 * all, insert the new set). The row is written FIRST on purpose: if the link
 * step fails, a restricted resource is left with fewer (or no) plan rows, which
 * means fewer people can open it — admins only at worst — never more. The
 * caller gets a 500 `plan_links_failed` and can simply save again.
 */
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/db-errors";
import {
  categoryFromRow,
  groupPlanIds,
  isUuid,
  resourceFromRow,
  slugify,
  uniqueSlug,
} from "./access";
import type {
  UniversityCategory,
  UniversityCategoryInput,
  UniversityCategoryRow,
  UniversityResource,
  UniversityResourceInput,
  UniversityResourcePlanRow,
  UniversityResourceRow,
} from "@/types/university.types";

// ─── Types ───────────────────────────────────────────────────────────────────

/** A subscription plan as the admin editor needs it. Retired = `!isActive`. */
export interface UniversityAdminPlan {
  id: string;
  name: string;
  isActive: boolean;
  displayOrder: number;
}

export interface UniversityAdminCatalogue {
  categories: UniversityCategory[];
  resources: UniversityResource[];
  plans: UniversityAdminPlan[];
}

export type UniversityReorderKind = "category" | "resource";

export interface UniversityReorderInput {
  kind: UniversityReorderKind;
  ids: string[];
}

export type UniversityAdminErrorCode =
  | "migration_not_applied"
  | "invalid"
  | "not_found"
  | "category_not_empty"
  | "plan_links_failed"
  | "db_error";

/** A failure with an HTTP status. `errors` is field-keyed, for `invalid`. */
export class UniversityAdminError extends Error {
  readonly status: number;
  readonly code: UniversityAdminErrorCode;
  readonly errors?: Record<string, string>;

  constructor(
    status: number,
    code: UniversityAdminErrorCode,
    message: string,
    errors?: Record<string, string>
  ) {
    super(message);
    this.name = "UniversityAdminError";
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const CATEGORY_SELECT =
  "id, slug, name, description, icon, display_order, is_published, created_at, updated_at";

export const RESOURCE_SELECT =
  "id, slug, category_id, title, description, resource_type, url, duration_minutes, status, is_free, display_order, created_at, updated_at, updated_by";
/** RESOURCE_SELECT plus migration 056's billing_cycle. Reads fall back to RESOURCE_SELECT until it is applied. */
export const RESOURCE_SELECT_WITH_CYCLE = `${RESOURCE_SELECT}, billing_cycle`;

export const CYCLE_MIGRATION_MESSAGE =
  "Showing a resource only to monthly or annual customers needs migration 056. Apply supabase/migrations/056_university_billing_cycle.sql in the Supabase SQL editor, then save again.";

/**
 * Run a resources query with the billing_cycle column, and once more without
 * it when migration 056 is not applied yet. `withCycle` tells a write whether
 * it may include the column.
 */
async function withCycleColumn<R extends { error: DbError | null }>(
  run: (select: string, withCycle: boolean) => PromiseLike<R>
): Promise<R> {
  const first = await run(RESOURCE_SELECT_WITH_CYCLE, true);
  if (!isMissingColumnError(first.error)) return first;
  return run(RESOURCE_SELECT, false);
}

/** Gap between consecutive display_order values written by reorder/append. */
export const ORDER_STEP = 10;

export const MIGRATION_MESSAGE =
  "Migration 038 isn't applied yet. Apply supabase/migrations/038_sam_university.sql in the Supabase SQL editor, then reload.";

// ─── Error helpers ───────────────────────────────────────────────────────────

interface DbError {
  code?: string | null;
  message?: string | null;
}

/**
 * Is this error "the university tables do not exist" (migration 038 not
 * applied)? Lives in `@/lib/db-errors` (shared with the FAQ); re-exported here
 * so existing imports keep working.
 */
export { isMissingTableError };

/** Throw the right `UniversityAdminError` for a database error. */
function fail(err: DbError, context: string): never {
  if (isMissingTableError(err)) {
    throw new UniversityAdminError(503, "migration_not_applied", MIGRATION_MESSAGE);
  }
  const message = err.message || "Database error";
  console.error(`[university/admin-repo] ${context}:`, message);
  throw new UniversityAdminError(500, "db_error", `${context}: ${message}`);
}

function invalid(errors: Record<string, string>): never {
  throw new UniversityAdminError(400, "invalid", "Please fix the highlighted fields.", errors);
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Every subscription plan, active and retired, in display order. */
export async function loadAdminPlans(db: SupabaseClient): Promise<UniversityAdminPlan[]> {
  const { data, error } = await db
    .from("subscription_plans")
    .select("id, name, is_active, display_order")
    .order("display_order");
  if (error) fail(error, "Plans read failed");
  return ((data ?? []) as { id: string; name: string; is_active: boolean; display_order: number }[]).map(
    (p) => ({ id: p.id, name: p.name, isActive: p.is_active, displayOrder: p.display_order })
  );
}

/** The whole catalogue, sorted by display order, with every plan. */
export async function loadAdminCatalogue(db: SupabaseClient): Promise<UniversityAdminCatalogue> {
  const [cats, res, links, plans] = await Promise.all([
    db.from("university_categories").select(CATEGORY_SELECT).order("display_order").order("name"),
    withCycleColumn((select) =>
      db.from("university_resources").select(select).order("display_order").order("title")
    ),
    db.from("university_resource_plans").select("resource_id, plan_id"),
    loadAdminPlans(db),
  ]);
  if (cats.error) fail(cats.error, "Categories read failed");
  if (res.error) fail(res.error, "Resources read failed");
  if (links.error) fail(links.error, "Plan links read failed");

  const planIds = groupPlanIds((links.data ?? []) as UniversityResourcePlanRow[]);
  return {
    categories: ((cats.data ?? []) as UniversityCategoryRow[]).map(categoryFromRow),
    resources: ((res.data ?? []) as unknown as UniversityResourceRow[]).map((r) =>
      resourceFromRow(r, planIds.get(r.id) ?? [])
    ),
    plans,
  };
}

async function loadCategoryRow(db: SupabaseClient, id: string): Promise<UniversityCategoryRow | null> {
  const { data, error } = await db
    .from("university_categories")
    .select(CATEGORY_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) fail(error, "Category read failed");
  return (data as UniversityCategoryRow | null) ?? null;
}

async function loadResourceRow(db: SupabaseClient, id: string): Promise<UniversityResourceRow | null> {
  const { data, error } = await withCycleColumn((select) =>
    db.from("university_resources").select(select).eq("id", id).maybeSingle()
  );
  if (error) fail(error, "Resource read failed");
  return (data as UniversityResourceRow | null) ?? null;
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

// ─── Existence checks ────────────────────────────────────────────────────────

/** 400 `errors.categoryId` unless the category exists. */
export async function assertCategoryExists(db: SupabaseClient, categoryId: string): Promise<void> {
  const row = await loadCategoryRow(db, categoryId);
  if (!row) invalid({ categoryId: "That category no longer exists. Reload and choose another." });
}

/** 400 `errors.planIds` unless every id is a row in `subscription_plans`. */
export async function assertPlansExist(db: SupabaseClient, planIds: readonly string[]): Promise<void> {
  if (planIds.length === 0) return;
  const { data, error } = await db.from("subscription_plans").select("id").in("id", [...planIds]);
  if (error) fail(error, "Plans read failed");
  const found = new Set(((data ?? []) as { id: string }[]).map((p) => p.id.toLowerCase()));
  const unknown = planIds.filter((id) => !found.has(id.toLowerCase()));
  if (unknown.length > 0) {
    invalid({
      planIds:
        unknown.length === 1
          ? "One of the chosen plans no longer exists. Reload and choose again."
          : `${unknown.length} of the chosen plans no longer exist. Reload and choose again.`,
    });
  }
}

// ─── Categories ──────────────────────────────────────────────────────────────

/**
 * Create a category. Slug comes from the name, made unique. When the caller
 * gave no display order, the category is appended after the last one.
 */
export async function createCategory(
  db: SupabaseClient,
  input: UniversityCategoryInput,
  opts: { hasDisplayOrder: boolean }
): Promise<UniversityCategory> {
  const slug = uniqueSlug(slugify(input.name), await loadSlugs(db, "university_categories"));
  const displayOrder = opts.hasDisplayOrder ? input.displayOrder : await nextOrder(db, "university_categories");

  const { data, error } = await db
    .from("university_categories")
    .insert({
      slug,
      name: input.name,
      description: input.description,
      icon: input.icon,
      display_order: displayOrder,
      is_published: input.isPublished,
    })
    .select(CATEGORY_SELECT)
    .single();
  if (error) fail(error, "Category create failed");
  return categoryFromRow(data as UniversityCategoryRow);
}

/** Update a category. The slug never changes. Missing display order keeps the current one. */
export async function updateCategory(
  db: SupabaseClient,
  id: string,
  input: UniversityCategoryInput,
  opts: { hasDisplayOrder: boolean }
): Promise<UniversityCategory> {
  const existing = await loadCategoryRow(db, id);
  if (!existing) throw new UniversityAdminError(404, "not_found", "Category not found.");

  const { data, error } = await db
    .from("university_categories")
    .update({
      name: input.name,
      description: input.description,
      icon: input.icon,
      display_order: opts.hasDisplayOrder ? input.displayOrder : existing.display_order,
      is_published: input.isPublished,
    })
    .eq("id", id)
    .select(CATEGORY_SELECT)
    .single();
  if (error) fail(error, "Category update failed");
  return categoryFromRow(data as UniversityCategoryRow);
}

/**
 * Delete an EMPTY category. The FK is ON DELETE CASCADE, so deleting a
 * category with resources would silently delete them too — refused with 409
 * `category_not_empty` instead. Returns the deleted category (for the log).
 */
export async function deleteCategory(db: SupabaseClient, id: string): Promise<UniversityCategory> {
  const existing = await loadCategoryRow(db, id);
  if (!existing) throw new UniversityAdminError(404, "not_found", "Category not found.");

  // A real select, not head:true — a HEAD against a missing table reports no error.
  const { data: inside, error: countError } = await db
    .from("university_resources")
    .select("id")
    .eq("category_id", id)
    .limit(1);
  if (countError) fail(countError, "Resource check failed");
  if ((inside ?? []).length > 0) {
    throw new UniversityAdminError(
      409,
      "category_not_empty",
      "This category still has resources. Move or delete them first."
    );
  }

  const { error } = await db.from("university_categories").delete().eq("id", id);
  if (error) fail(error, "Category delete failed");
  return categoryFromRow(existing);
}

// ─── Resources ───────────────────────────────────────────────────────────────

/**
 * Make the plan links for one resource exactly `planIds` (none when `isFree`).
 * Delete-then-insert; see the module note on why this is safe to fail midway.
 */
export async function replacePlanLinks(
  db: SupabaseClient,
  resourceId: string,
  isFree: boolean,
  planIds: readonly string[]
): Promise<void> {
  const wanted = isFree ? [] : [...new Set(planIds)];

  const { error: delError } = await db
    .from("university_resource_plans")
    .delete()
    .eq("resource_id", resourceId);
  if (delError) linkFail(delError, resourceId);

  if (wanted.length === 0) return;

  const { error: insError } = await db
    .from("university_resource_plans")
    .insert(wanted.map((plan_id) => ({ resource_id: resourceId, plan_id })));
  if (insError) linkFail(insError, resourceId);
}

function linkFail(err: DbError, resourceId: string): never {
  if (isMissingTableError(err)) {
    throw new UniversityAdminError(503, "migration_not_applied", MIGRATION_MESSAGE);
  }
  console.error(
    "[university/admin-repo] Plan links failed for resource", resourceId, ":", err.message
  );
  throw new UniversityAdminError(
    500,
    "plan_links_failed",
    "The resource was saved, but its plan access could not be updated. It may be visible to fewer plans than intended (admins only at worst). Save it again to retry."
  );
}

/**
 * The row columns for a resource. `withCycle` false (migration 056 not
 * applied) leaves billing_cycle out — and refuses a monthly/annual choice
 * rather than silently showing the resource to everyone.
 */
function resourceColumns(input: UniversityResourceInput, userId: string, withCycle: boolean) {
  if (!withCycle && input.billingCycle !== "any") {
    throw new UniversityAdminError(503, "migration_not_applied", CYCLE_MIGRATION_MESSAGE);
  }
  return {
    ...(withCycle ? { billing_cycle: input.billingCycle } : {}),
    category_id: input.categoryId,
    title: input.title,
    description: input.description,
    resource_type: input.type,
    url: input.url,
    duration_minutes: input.durationMinutes,
    status: input.status,
    is_free: input.isFree,
    updated_by: userId,
  };
}

/**
 * Create a resource and its plan links. Category and plans are checked first.
 * Appended to the end of its category when no display order was given.
 */
export async function createResource(
  db: SupabaseClient,
  input: UniversityResourceInput,
  userId: string,
  opts: { hasDisplayOrder: boolean }
): Promise<UniversityResource> {
  await assertCategoryExists(db, input.categoryId);
  if (!input.isFree) await assertPlansExist(db, input.planIds);

  const slug = uniqueSlug(slugify(input.title), await loadSlugs(db, "university_resources"));
  const displayOrder = opts.hasDisplayOrder
    ? input.displayOrder
    : await nextOrder(db, "university_resources", { column: "category_id", value: input.categoryId });

  const { data, error } = await withCycleColumn((select, withCycle) =>
    db
      .from("university_resources")
      .insert({ ...resourceColumns(input, userId, withCycle), slug, display_order: displayOrder })
      .select(select)
      .single()
  );
  if (error) fail(error, "Resource create failed");
  const row = data as unknown as UniversityResourceRow;

  await replacePlanLinks(db, row.id, input.isFree, input.planIds);
  return resourceFromRow(row, input.isFree ? [] : input.planIds);
}

/**
 * Update a resource and replace its plan links. The slug never changes.
 * Missing display order keeps the current one; a resource moved to another
 * category without an order is appended there.
 */
export async function updateResource(
  db: SupabaseClient,
  id: string,
  input: UniversityResourceInput,
  userId: string,
  opts: { hasDisplayOrder: boolean }
): Promise<UniversityResource> {
  const existing = await loadResourceRow(db, id);
  if (!existing) throw new UniversityAdminError(404, "not_found", "Resource not found.");

  await assertCategoryExists(db, input.categoryId);
  if (!input.isFree) await assertPlansExist(db, input.planIds);

  let displayOrder = existing.display_order;
  if (opts.hasDisplayOrder) displayOrder = input.displayOrder;
  else if (existing.category_id !== input.categoryId) {
    displayOrder = await nextOrder(db, "university_resources", {
      column: "category_id",
      value: input.categoryId,
    });
  }

  const { data, error } = await withCycleColumn((select, withCycle) =>
    db
      .from("university_resources")
      .update({ ...resourceColumns(input, userId, withCycle), display_order: displayOrder })
      .eq("id", id)
      .select(select)
      .single()
  );
  if (error) fail(error, "Resource update failed");

  await replacePlanLinks(db, id, input.isFree, input.planIds);
  return resourceFromRow(data as unknown as UniversityResourceRow, input.isFree ? [] : input.planIds);
}

/**
 * Delete many resources at once (their plan links cascade). `ids` is a list
 * of resource ids, or "all" for every resource in the catalogue. Returns the
 * deleted resources, for the log; ids that no longer exist are ignored.
 */
export async function deleteResources(
  db: SupabaseClient,
  ids: readonly string[] | "all"
): Promise<UniversityResource[]> {
  const read = await withCycleColumn((select) => {
    const q = db.from("university_resources").select(select);
    return ids === "all" ? q : q.in("id", [...ids]);
  });
  if (read.error) fail(read.error, "Resource read failed");
  const rows = (read.data ?? []) as unknown as UniversityResourceRow[];
  if (rows.length === 0) return [];
  const { error } = await db
    .from("university_resources")
    .delete()
    .in("id", rows.map((r) => r.id));
  if (error) fail(error, "Resource delete failed");
  return rows.map((r) => resourceFromRow(r, []));
}

/** Delete a resource (its plan links cascade). Returns it, for the log. */
export async function deleteResource(db: SupabaseClient, id: string): Promise<UniversityResource> {
  const existing = await loadResourceRow(db, id);
  if (!existing) throw new UniversityAdminError(404, "not_found", "Resource not found.");

  const { error } = await db.from("university_resources").delete().eq("id", id);
  if (error) fail(error, "Resource delete failed");
  return resourceFromRow(existing, []);
}

// ─── Reorder ─────────────────────────────────────────────────────────────────

/**
 * Validate a reorder body: `{ kind: "category" | "resource", ids: uuid[] }`,
 * non-empty, no duplicates. Ids are lower-cased.
 */
export function normaliseReorderInput(
  raw: unknown
): { ok: true; value: UniversityReorderInput } | { ok: false; errors: Record<string, string> } {
  const r = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const errors: Record<string, string> = {};

  const kind = r.kind;
  if (kind !== "category" && kind !== "resource") errors.kind = 'kind must be "category" or "resource".';

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
  return { ok: true, value: { kind: kind as UniversityReorderKind, ids } };
}

/**
 * Write display_order = 10, 20, 30… in the given order.
 *
 * The list must be COMPLETE: every category, or every resource of exactly one
 * category. A partial list would leave the unlisted rows on their old numbers,
 * interleaved unpredictably with the new ones.
 *
 * One UPDATE per row (an upsert would trip NOT NULL columns), so a failure
 * midway leaves a mixed order — harmless, and fixed by reordering again.
 */
export async function reorder(db: SupabaseClient, input: UniversityReorderInput): Promise<void> {
  const table = input.kind === "category" ? "university_categories" : "university_resources";

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
    if (rows.length !== input.ids.length) invalid({ ids: "One of these resources no longer exists. Reload and try again." });
    const categories = new Set(rows.map((r) => r.category_id));
    if (categories.size !== 1) invalid({ ids: "Resources can only be reordered within one category." });
    const [categoryId] = [...categories];

    const { data: siblings, error: sibError } = await db.from(table).select("id").eq("category_id", categoryId);
    if (sibError) fail(sibError, "Reorder read failed");
    if ((siblings ?? []).length !== input.ids.length) {
      invalid({ ids: "The list must include every resource in the category. Reload and try again." });
    }
  }

  const results = await Promise.all(
    input.ids.map((id, i) =>
      db.from(table).update({ display_order: (i + 1) * ORDER_STEP }).eq("id", id)
    )
  );
  const firstError = results.find((r) => r.error)?.error;
  if (firstError) fail(firstError, "Reorder write failed");
}
