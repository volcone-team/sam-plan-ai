/**
 * SAM University domain types (migration 038).
 *
 * Two families, kept deliberately separate:
 *
 *   ADMIN ROW TYPES (`UniversityCategory`, `UniversityResource`) — the full
 *   record, including every url. Only ever handled server-side and by the
 *   admin screens (`requireAdmin`).
 *
 *   CUSTOMER VIEW TYPES (`UniversityCategoryView`, `UniversityResourceView`) —
 *   what a customer's browser receives. Built ONLY by `toResourceView` /
 *   `buildCustomerCatalogue` in `@/lib/university/access`, which strip the url
 *   of anything locked or not yet published. Never construct these by hand in
 *   an API route.
 *
 * GATING: a resource is EITHER free for everyone (`isFree`) OR unlocked by an
 * explicit list of plans (`planIds`). There is no plan ranking.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

/** Matches the CHECK on university_resources.resource_type. */
export const UNIVERSITY_RESOURCE_TYPES = ["video", "article", "pdf", "link"] as const;
export type UniversityResourceType = (typeof UNIVERSITY_RESOURCE_TYPES)[number];

/**
 * Matches the CHECK on university_resources.status.
 *   draft        never shown to customers.
 *   coming_soon  shown as a teaser card with no url, even when unlocked.
 *   published    shown; url included only when unlocked. Requires a url.
 */
export const UNIVERSITY_STATUSES = ["draft", "coming_soon", "published"] as const;
export type UniversityStatus = (typeof UNIVERSITY_STATUSES)[number];

/** The statuses a customer can ever see. */
export type UniversityCustomerStatus = Exclude<UniversityStatus, "draft">;

/**
 * lucide-react icon names a category may use. Enforced here rather than in SQL
 * so adding one is a code change, not a migration. The UI maps each key to its
 * lucide component; an unknown value from the database reads as `null`.
 */
export const UNIVERSITY_ICONS = [
  "BookOpen",
  "GraduationCap",
  "BarChart3",
  "CalendarCheck",
  "Sparkles",
  "Video",
  "FileText",
  "Lightbulb",
  "Target",
  "Rocket",
] as const;
export type UniversityIcon = (typeof UNIVERSITY_ICONS)[number];

// ─── Database rows (snake_case, as returned by supabase-js) ──────────────────

/** A row of `university_categories`. */
export interface UniversityCategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  display_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

/** A row of `university_resources`. Plan ids live in `university_resource_plans`. */
export interface UniversityResourceRow {
  id: string;
  slug: string;
  category_id: string;
  title: string;
  description: string | null;
  resource_type: UniversityResourceType;
  url: string | null;
  duration_minutes: number | null;
  status: UniversityStatus;
  is_free: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

/** A row of `university_resource_plans`. */
export interface UniversityResourcePlanRow {
  resource_id: string;
  plan_id: string;
}

// ─── Admin row types (camelCase) ─────────────────────────────────────────────

export interface UniversityCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  /** `null` when unset or not in UNIVERSITY_ICONS. */
  icon: UniversityIcon | null;
  displayOrder: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UniversityResource {
  id: string;
  slug: string;
  categoryId: string;
  title: string;
  description: string | null;
  type: UniversityResourceType;
  /** External http(s) url. Admin-only: never send this to a customer directly. */
  url: string | null;
  durationMinutes: number | null;
  status: UniversityStatus;
  isFree: boolean;
  /**
   * Plans that unlock this resource. Ignored when `isFree`. Empty and not free
   * means admins only.
   */
  planIds: string[];
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

// ─── Customer view types ─────────────────────────────────────────────────────

export interface UniversityResourceView {
  id: string;
  title: string;
  description: string | null;
  type: UniversityResourceType;
  durationMinutes: number | null;
  /** Never `draft` — drafts are filtered out before a view is built. */
  status: UniversityCustomerStatus;
  /** True when this viewer's plan does not unlock it. Shown as a teaser. */
  locked: boolean;
  /**
   * The content link. ALWAYS `null` when `locked` is true OR `status` is
   * `coming_soon`. Only a published, unlocked resource carries a url.
   */
  url: string | null;
  /**
   * Names of the plans that unlock this resource, in plan order, for the
   * "Available on Pro" teaser. Empty when `isFree`. Only plans passed to the
   * builder are named, so callers decide which plans to advertise.
   */
  unlockPlanNames: string[];
  isFree: boolean;
}

export interface UniversityCategoryView {
  id: string;
  name: string;
  description: string | null;
  icon: UniversityIcon | null;
  /** Never empty: categories with nothing visible are dropped. */
  resources: UniversityResourceView[];
}

// ─── Viewer and inputs ───────────────────────────────────────────────────────

/**
 * Who is looking. Build it from `loadCompanyAccess` (`@/lib/billing/company-access`)
 * plus `profiles.is_admin`:
 *   { isAdmin, planId, accessAllowed: access.allowed,
 *     billingDisabled: access.reason === "billing_disabled" }
 */
export interface UniversityViewer {
  /** `profiles.is_admin` — super admins see everything unlocked. */
  isAdmin: boolean;
  /** `subscriptions.plan_id`; `null` means free items only. */
  planId: string | null;
  /** `AccessDecision.allowed`. False means free items only. */
  accessAllowed: boolean;
  /** `AccessDecision.reason === "billing_disabled"` — everything unlocked. */
  billingDisabled: boolean;
}

/** Minimal plan shape the catalogue builder needs, in display order. */
export interface UniversityPlanRef {
  id: string;
  name: string;
}

/** Validated admin input for creating/updating a resource. Slug is derived separately. */
export interface UniversityResourceInput {
  categoryId: string;
  title: string;
  description: string | null;
  type: UniversityResourceType;
  url: string | null;
  durationMinutes: number | null;
  status: UniversityStatus;
  isFree: boolean;
  /** Always `[]` when `isFree`; otherwise non-empty, de-duplicated, lower-case. */
  planIds: string[];
  displayOrder: number;
}

/** Validated admin input for creating/updating a category. Slug is derived separately. */
export interface UniversityCategoryInput {
  name: string;
  description: string | null;
  icon: UniversityIcon | null;
  displayOrder: number;
  isPublished: boolean;
}

/** Result of the `normalise*Input` validators. `errors` is keyed by input field. */
export type UniversityValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Partial<Record<keyof T, string>> };
