/**
 * SAM University — server-side catalogue loading for one customer.
 *
 * Reads the three university tables, the plan list and the company's access
 * decision with a SERVICE-ROLE client, then hands everything to
 * `buildCustomerCatalogue` (./access). That builder is the only thing that
 * decides whether a url leaves the server; this module never builds a view
 * itself and never returns an admin row.
 *
 * Server-only. Kept free of Next so it can be tested with a fake client.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCompanyAccess } from "@/lib/billing/company-access";
import { isYearlyCycle, onboardingBookingCycle } from "@/lib/billing/booking";
import { isMissingColumnError } from "@/lib/supabase/missing-column";
import { isMissingTableError } from "./admin-repo";
import {
  buildCustomerCatalogue,
  categoryFromRow,
  groupPlanIds,
  resourceFromRow,
} from "./access";
import type {
  UniversityCategoryRow,
  UniversityCategoryView,
  UniversityPlanRef,
  UniversityResourcePlanRow,
  UniversityResourceRow,
  UniversityViewer,
} from "@/types/university.types";

/** Body of `GET /api/university`. */
export interface UniversityCatalogueResponse {
  categories: UniversityCategoryView[];
  viewer: {
    /** The company's plan name ("You're on Starter"), or `null` with no plan. */
    planName: string | null;
    /** The company has a plan AND access is allowed. */
    hasPaidPlan: boolean;
    /** `profiles.is_admin`. */
    isAdmin: boolean;
  };
}

/** Thrown when migration 038 has not been applied to this database. */
export class UniversityMigrationMissingError extends Error {
  constructor(detail: string) {
    super(`SAM University tables are missing (migration 038 not applied): ${detail}`);
    this.name = "UniversityMigrationMissingError";
  }
}

interface PostgrestLikeError {
  code?: string | null;
  message?: string | null;
}

/**
 * "The table does not exist" (PGRST205 / 42P01 / PostgREST message text).
 * One implementation, shared with the admin side.
 */
export { isMissingTableError };

/** Columns read from each table — exactly what the row mappers need. */
const CATEGORY_COLUMNS =
  "id, slug, name, description, icon, display_order, is_published, created_at, updated_at";
const RESOURCE_COLUMNS_BASE =
  "id, slug, category_id, title, description, resource_type, url, duration_minutes, " +
  "status, is_free, display_order, created_at, updated_at, updated_by";
/** With migration 056's billing_cycle; RESOURCE_COLUMNS_BASE is the fallback until it is applied. */
const RESOURCE_COLUMNS = `${RESOURCE_COLUMNS_BASE}, billing_cycle`;
const RESOURCE_PLAN_COLUMNS = "resource_id, plan_id";
const PLAN_COLUMNS = "id, name, is_active, display_order";

interface PlanRow {
  id: string;
  name: string;
  is_active: boolean | null;
  display_order: number | null;
}

/** Surface a query failure: missing table → typed error, anything else → Error. */
function check(table: string, error: PostgrestLikeError | null): void {
  if (!error) return;
  if (isMissingTableError(error)) {
    throw new UniversityMigrationMissingError(`${table}: ${error.message ?? error.code ?? "missing"}`);
  }
  throw new Error(`[university] ${table} query failed: ${error.message ?? error.code ?? "unknown error"}`);
}

/**
 * The gated catalogue for one signed-in user.
 *
 * `companyId` and `isAdmin` come from the caller's `profiles` row. Every role in
 * a company sees what the company's plan includes, so the role is not an input.
 *
 * @throws UniversityMigrationMissingError when a university table is missing.
 * @throws Error on any other query failure.
 */
export async function loadCatalogueForUser(
  db: SupabaseClient,
  { companyId, isAdmin }: { companyId: string | null; isAdmin: boolean }
): Promise<UniversityCatalogueResponse> {
  // Drafts are filtered in SQL too, so their urls never even reach this
  // process. buildCustomerCatalogue drops them again regardless.
  const loadResources = (columns: string) =>
    db.from("university_resources").select(columns).neq("status", "draft");
  const [companyAccess, cycleRes, categoriesRes, firstResourcesRes, linksRes, plansRes] = await Promise.all([
    loadCompanyAccess(db, companyId),
    // Separate from loadCompanyAccess so its shared select stays unchanged.
    companyId
      ? db.from("subscriptions").select("billing_cycle").eq("company_id", companyId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from("university_categories").select(CATEGORY_COLUMNS).eq("is_published", true),
    loadResources(RESOURCE_COLUMNS),
    db.from("university_resource_plans").select(RESOURCE_PLAN_COLUMNS),
    db.from("subscription_plans").select(PLAN_COLUMNS).order("display_order", { ascending: true }),
  ]);
  // Migration 056 not applied yet: read without billing_cycle (every resource is 'any').
  const resourcesRes = isMissingColumnError(firstResourcesRes.error)
    ? await loadResources(RESOURCE_COLUMNS_BASE)
    : firstResourcesRes;

  check("university_categories", categoriesRes.error);
  check("university_resources", resourcesRes.error);
  check("university_resource_plans", linksRes.error);
  if (plansRes.error) {
    throw new Error(`[university] subscription_plans query failed: ${plansRes.error.message}`);
  }

  const categoryRows = (categoriesRes.data ?? []) as unknown as UniversityCategoryRow[];
  const resourceRows = (resourcesRes.data ?? []) as unknown as UniversityResourceRow[];
  const linkRows = (linksRes.data ?? []) as unknown as UniversityResourcePlanRow[];
  const planRows = ((plansRes.data ?? []) as unknown as PlanRow[])
    .slice()
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  const planIdsByResource = groupPlanIds(linkRows);
  const categories = categoryRows.map(categoryFromRow);
  const resources = resourceRows.map((row) => resourceFromRow(row, planIdsByResource.get(row.id) ?? []));

  // Only plans still on sale are advertised in teasers. A retired plan still
  // unlocks what it lists (canAccessResource checks ids, not this list).
  const teaserPlans: UniversityPlanRef[] = planRows
    .filter((p) => p.is_active === true)
    .map((p) => ({ id: p.id, name: p.name }));

  const { planId, access } = companyAccess;
  // Only a PAID subscription's cycle is real (trial and comp rows carry the
  // column's 'monthly' default), the same rule as the welcome page.
  const paidCycle = onboardingBookingCycle({
    accessReason: access.reason,
    billingCycle: (cycleRes.data as { billing_cycle?: string | null } | null)?.billing_cycle ?? null,
  });
  const viewer: UniversityViewer = {
    isAdmin,
    planId,
    accessAllowed: access.allowed,
    billingDisabled: access.reason === "billing_disabled",
    billingCycle: isYearlyCycle(paidCycle) ? "annual" : "monthly",
  };

  // The company's own plan is named even if retired (existing subscribers keep it).
  const planName = planId ? planRows.find((p) => p.id === planId)?.name ?? null : null;

  return {
    categories: buildCustomerCatalogue(categories, resources, viewer, teaserPlans),
    viewer: {
      planName,
      hasPaidPlan: planId !== null && access.allowed,
      isAdmin,
    },
  };
}
