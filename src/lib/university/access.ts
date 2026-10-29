/**
 * SAM University — pure access rules, view building and admin input validation.
 *
 * No database, no Next. API routes load rows with the service-role client,
 * then pass them through here. This module is the ONLY place a customer view
 * is built, so it is the only place that decides whether a url leaves the
 * server. The invariant everything else depends on:
 *
 *   A resource view has a url ONLY IF it is published AND unlocked.
 *
 * Gating has no ranking: a resource is free for everyone, or unlocked by an
 * explicit list of plan ids. Super admins and billing-disabled deployments see
 * everything unlocked; a locked-out account (access not allowed) sees free
 * items only.
 */
import {
  UNIVERSITY_BILLING_CYCLES,
  UNIVERSITY_ICONS,
  UNIVERSITY_RESOURCE_TYPES,
  UNIVERSITY_STATUSES,
  type UniversityBillingCycle,
  type UniversityCategory,
  type UniversityCategoryInput,
  type UniversityCategoryRow,
  type UniversityCategoryView,
  type UniversityIcon,
  type UniversityPlanRef,
  type UniversityResource,
  type UniversityResourceInput,
  type UniversityResourcePlanRow,
  type UniversityResourceRow,
  type UniversityResourceType,
  type UniversityResourceView,
  type UniversityStatus,
  type UniversityViewer,
  type UniversityValidationResult,
} from "@/types/university.types";

// ─── Limits (exported so admin forms can mirror them) ────────────────────────

export const UNIVERSITY_LIMITS = {
  titleMax: 200,
  resourceDescriptionMax: 2000,
  categoryNameMax: 100,
  categoryDescriptionMax: 1000,
  urlMax: 2048,
  durationMax: 1000,
  displayOrderMax: 100000,
  slugMax: 80,
} as const;

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isUniversityIcon(value: unknown): value is UniversityIcon {
  return typeof value === "string" && (UNIVERSITY_ICONS as readonly string[]).includes(value);
}

export function isUniversityResourceType(value: unknown): value is UniversityResourceType {
  return typeof value === "string" && (UNIVERSITY_RESOURCE_TYPES as readonly string[]).includes(value);
}

export function isUniversityStatus(value: unknown): value is UniversityStatus {
  return typeof value === "string" && (UNIVERSITY_STATUSES as readonly string[]).includes(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

/** `university_categories` row → admin type. An unknown icon reads as `null`. */
export function categoryFromRow(row: UniversityCategoryRow): UniversityCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: isUniversityIcon(row.icon) ? row.icon : null,
    displayOrder: row.display_order,
    isPublished: row.is_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `university_resources` row + its plan ids → admin type. */
export function resourceFromRow(row: UniversityResourceRow, planIds: readonly string[]): UniversityResource {
  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.category_id,
    title: row.title,
    description: row.description,
    type: row.resource_type,
    url: row.url,
    durationMinutes: row.duration_minutes,
    status: row.status,
    isFree: row.is_free,
    planIds: [...planIds],
    billingCycle: readBillingCycle(row.billing_cycle),
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

/** A stored billing_cycle; anything unknown or absent (pre-056) is 'any'. */
export function readBillingCycle(value: unknown): UniversityBillingCycle {
  return value === "monthly" || value === "annual" ? value : "any";
}

/** Group `university_resource_plans` rows by resource id. */
export function groupPlanIds(links: readonly UniversityResourcePlanRow[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const { resource_id, plan_id } of links) {
    const list = out.get(resource_id);
    if (list) list.push(plan_id);
    else out.set(resource_id, [plan_id]);
  }
  return out;
}

// ─── Access ──────────────────────────────────────────────────────────────────

/**
 * May this viewer open this resource?
 *
 * Precedence: super admin > billing disabled > free > locked-out account >
 * plan match. A locked-out account keeps free items (the middleware normally
 * redirects them first; this is the defensive case).
 */
export function canAccessResource(
  resource: Pick<UniversityResource, "isFree" | "planIds">,
  viewer: UniversityViewer
): boolean {
  if (viewer.isAdmin) return true;
  if (viewer.billingDisabled) return true;
  if (resource.isFree) return true;
  if (!viewer.accessAllowed) return false;
  if (!viewer.planId) return false;
  return resource.planIds.includes(viewer.planId);
}

/**
 * Does this viewer's billing cycle see this resource at all (migration 056)?
 *
 * A VISIBILITY rule, on top of canAccessResource: a resource for the other
 * cycle is hidden, not shown locked. Super admins and billing-disabled see
 * everything; a viewer with no cycle reads as monthly.
 */
export function isVisibleForCycle(
  resource: Pick<UniversityResource, "billingCycle">,
  viewer: UniversityViewer
): boolean {
  if (viewer.isAdmin || viewer.billingDisabled) return true;
  const cycle = resource.billingCycle ?? "any";
  if (cycle === "any") return true;
  return (viewer.billingCycle ?? "monthly") === cycle;
}

/**
 * Build the customer-facing view of one resource, or `null` for a draft or a
 * resource for the other billing cycle.
 *
 * The url is included only when the resource is published AND unlocked.
 * `planNameById` supplies teaser names in its iteration order; plan ids not in
 * it still grant access but are not advertised (e.g. a retired plan).
 */
export function toResourceView(
  resource: UniversityResource,
  viewer: UniversityViewer,
  planNameById: ReadonlyMap<string, string>
): UniversityResourceView | null {
  if (resource.status === "draft") return null;
  if (!isVisibleForCycle(resource, viewer)) return null;

  const locked = !canAccessResource(resource, viewer);
  const url = !locked && resource.status === "published" ? resource.url : null;

  const unlockPlanNames: string[] = [];
  if (!resource.isFree) {
    const wanted = new Set(resource.planIds);
    for (const [id, name] of planNameById) {
      if (wanted.has(id)) unlockPlanNames.push(name);
    }
  }

  return {
    id: resource.id,
    title: resource.title,
    description: resource.description,
    type: resource.type,
    durationMinutes: resource.durationMinutes,
    status: resource.status,
    locked,
    url,
    unlockPlanNames,
    isFree: resource.isFree,
  };
}

const sortResources = (a: UniversityResource, b: UniversityResource): number =>
  a.displayOrder - b.displayOrder || a.title.localeCompare(b.title);

const sortCategories = (a: UniversityCategory, b: UniversityCategory): number =>
  a.displayOrder - b.displayOrder || a.name.localeCompare(b.name);

/**
 * The whole customer catalogue.
 *
 * - Unpublished categories are hidden.
 * - Drafts are dropped; categories left with no visible resources are hidden.
 * - Categories sort by displayOrder then name; resources by displayOrder then title.
 * - `plans` is the list whose names may appear in teasers, in display order.
 *   Pass only plans you want advertised (typically active ones).
 */
export function buildCustomerCatalogue(
  categories: readonly UniversityCategory[],
  resources: readonly UniversityResource[],
  viewer: UniversityViewer,
  plans: readonly UniversityPlanRef[]
): UniversityCategoryView[] {
  const planNameById = new Map(plans.map((p) => [p.id, p.name] as const));

  const byCategory = new Map<string, UniversityResource[]>();
  for (const r of resources) {
    const list = byCategory.get(r.categoryId);
    if (list) list.push(r);
    else byCategory.set(r.categoryId, [r]);
  }

  const out: UniversityCategoryView[] = [];
  for (const category of [...categories].sort(sortCategories)) {
    if (!category.isPublished) continue;

    const views = (byCategory.get(category.id) ?? [])
      .slice()
      .sort(sortResources)
      .map((r) => toResourceView(r, viewer, planNameById))
      .filter((v): v is UniversityResourceView => v !== null);

    if (views.length === 0) continue;

    out.push({
      id: category.id,
      name: category.name,
      description: category.description,
      icon: category.icon,
      resources: views,
    });
  }
  return out;
}

// ─── Admin input validation ──────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function asObject(raw: unknown): Raw {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Raw) : {};
}

/** Trimmed string, `null` for absent/blank, `undefined` when not a string at all. */
function optionalText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t === "" ? null : t;
}

/** Integer in [min, max], or null when absent. `undefined` = invalid. */
function optionalInt(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

/**
 * A safe external url, normalised, or `null` if invalid. Only http/https with a
 * host; rejects `javascript:`, `data:`, relative paths and embedded credentials.
 */
export function normaliseExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > UNIVERSITY_LIMITS.urlMax) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.hostname) return null;
  if (parsed.username || parsed.password) return null;
  return parsed.href;
}

/**
 * Validate admin input for a resource.
 *
 * Accepted keys: categoryId, title, description, type, url, durationMinutes,
 * status, isFree, planIds, displayOrder. Strings are trimmed; blank optional
 * strings become `null`. When `isFree` is true, `planIds` is ignored and
 * returned as `[]`.
 */
export function normaliseResourceInput(raw: unknown): UniversityValidationResult<UniversityResourceInput> {
  const r = asObject(raw);
  const errors: Partial<Record<keyof UniversityResourceInput, string>> = {};

  const categoryId = typeof r.categoryId === "string" ? r.categoryId.trim().toLowerCase() : "";
  if (!isUuid(categoryId)) errors.categoryId = "Choose a category.";

  const title = typeof r.title === "string" ? r.title.trim() : "";
  if (title.length < 1) errors.title = "Title is required.";
  else if (title.length > UNIVERSITY_LIMITS.titleMax)
    errors.title = `Title must be ${UNIVERSITY_LIMITS.titleMax} characters or fewer.`;

  const description = optionalText(r.description);
  if (description === undefined) errors.description = "Description must be text.";
  else if (description && description.length > UNIVERSITY_LIMITS.resourceDescriptionMax)
    errors.description = `Description must be ${UNIVERSITY_LIMITS.resourceDescriptionMax} characters or fewer.`;

  const type = typeof r.type === "string" ? r.type.trim() : r.type;
  if (!isUniversityResourceType(type))
    errors.type = `Type must be one of: ${UNIVERSITY_RESOURCE_TYPES.join(", ")}.`;

  const status = typeof r.status === "string" ? r.status.trim() : r.status;
  if (!isUniversityStatus(status))
    errors.status = `Status must be one of: ${UNIVERSITY_STATUSES.join(", ")}.`;

  const urlText = optionalText(r.url);
  let url: string | null = null;
  if (urlText === undefined) errors.url = "URL must be text.";
  else if (urlText !== null) {
    url = normaliseExternalUrl(urlText);
    if (url === null) errors.url = "URL must be a full http:// or https:// link.";
  }
  if (status === "published" && urlText === null && !errors.url)
    errors.url = "A published resource needs a URL.";

  const durationMinutes = optionalInt(r.durationMinutes, 0, UNIVERSITY_LIMITS.durationMax);
  if (durationMinutes === undefined)
    errors.durationMinutes = `Duration must be a whole number of minutes from 0 to ${UNIVERSITY_LIMITS.durationMax}.`;

  const displayOrder = optionalInt(r.displayOrder, 0, UNIVERSITY_LIMITS.displayOrderMax);
  if (displayOrder === undefined)
    errors.displayOrder = `Display order must be a whole number from 0 to ${UNIVERSITY_LIMITS.displayOrderMax}.`;

  let isFree = false;
  if (r.isFree !== undefined && r.isFree !== null) {
    if (typeof r.isFree !== "boolean") errors.isFree = "isFree must be true or false.";
    else isFree = r.isFree;
  }

  let planIds: string[] = [];
  if (!isFree && !errors.isFree) {
    const list = Array.isArray(r.planIds) ? r.planIds : null;
    const cleaned = (list ?? []).map((p) => (typeof p === "string" ? p.trim().toLowerCase() : p));
    if (!list || cleaned.length === 0) {
      errors.planIds = "Mark it free, or choose at least one plan.";
    } else if (!cleaned.every(isUuid)) {
      errors.planIds = "Every plan id must be a valid id.";
    } else {
      planIds = [...new Set(cleaned as string[])];
    }
  }

  let billingCycle: UniversityBillingCycle = "any";
  if (r.billingCycle !== undefined && r.billingCycle !== null) {
    if (typeof r.billingCycle !== "string" || !(UNIVERSITY_BILLING_CYCLES as readonly string[]).includes(r.billingCycle))
      errors.billingCycle = "Billing cycle must be any, monthly or annual.";
    else billingCycle = r.billingCycle as UniversityBillingCycle;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      categoryId,
      title,
      description: description ?? null,
      type: type as UniversityResourceType,
      url,
      durationMinutes: durationMinutes ?? null,
      status: status as UniversityStatus,
      isFree,
      planIds,
      billingCycle,
      displayOrder: displayOrder ?? 0,
    },
  };
}

/**
 * Validate admin input for a category.
 *
 * Accepted keys: name, description, icon, displayOrder, isPublished. A blank
 * icon is `null`; any other value must be in UNIVERSITY_ICONS. `isPublished`
 * defaults to true.
 */
export function normaliseCategoryInput(raw: unknown): UniversityValidationResult<UniversityCategoryInput> {
  const r = asObject(raw);
  const errors: Partial<Record<keyof UniversityCategoryInput, string>> = {};

  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (name.length < 1) errors.name = "Name is required.";
  else if (name.length > UNIVERSITY_LIMITS.categoryNameMax)
    errors.name = `Name must be ${UNIVERSITY_LIMITS.categoryNameMax} characters or fewer.`;

  const description = optionalText(r.description);
  if (description === undefined) errors.description = "Description must be text.";
  else if (description && description.length > UNIVERSITY_LIMITS.categoryDescriptionMax)
    errors.description = `Description must be ${UNIVERSITY_LIMITS.categoryDescriptionMax} characters or fewer.`;

  const iconText = optionalText(r.icon);
  let icon: UniversityIcon | null = null;
  if (iconText === undefined || (iconText !== null && !isUniversityIcon(iconText)))
    errors.icon = `Icon must be one of: ${UNIVERSITY_ICONS.join(", ")}.`;
  else if (iconText !== null) icon = iconText as UniversityIcon;

  const displayOrder = optionalInt(r.displayOrder, 0, UNIVERSITY_LIMITS.displayOrderMax);
  if (displayOrder === undefined)
    errors.displayOrder = `Display order must be a whole number from 0 to ${UNIVERSITY_LIMITS.displayOrderMax}.`;

  let isPublished = true;
  if (r.isPublished !== undefined && r.isPublished !== null) {
    if (typeof r.isPublished !== "boolean") errors.isPublished = "isPublished must be true or false.";
    else isPublished = r.isPublished;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      description: description ?? null,
      icon,
      displayOrder: displayOrder ?? 0,
      isPublished,
    },
  };
}

// ─── Slugs ───────────────────────────────────────────────────────────────────

/**
 * URL-safe slug: lower-case ascii, hyphen-separated, ≤ 80 chars. Same rule the
 * seed in scripts/gen-migration-038.mjs uses. Never empty: falls back to "item".
 */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, UNIVERSITY_LIMITS.slugMax)
    .replace(/-+$/g, "");
  return s || "item";
}

/**
 * `base`, or `base-2`, `base-3`, … — the first not in `taken`. The base is
 * trimmed so the suffixed slug still fits in 80 chars.
 */
export function uniqueSlug(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const head = base.slice(0, UNIVERSITY_LIMITS.slugMax - suffix.length).replace(/-+$/g, "");
    const candidate = `${head}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

// ─── Video embeds ────────────────────────────────────────────────────────────

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Turn a YouTube, Vimeo or Loom page url into an embeddable player url, or
 * `null` for anything else (render those as a plain external link).
 *
 * YouTube embeds use youtube-nocookie.com (no tracking cookies until play).
 * Only call this on a url the viewer is allowed to see — i.e. a view's `url`.
 */
export function videoEmbedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const safe = normaliseExternalUrl(url);
  if (!safe) return null;
  const u = new URL(safe);
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  const parts = u.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    let id: string | null = null;
    if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (parts[0] === "embed" || parts[0] === "shorts" || parts[0] === "live") id = parts[1] ?? null;
    return id && YT_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }
  if (host === "youtu.be") {
    const id = parts[0];
    return id && YT_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }

  if (host === "vimeo.com") {
    const id = parts[0];
    if (!id || !/^\d+$/.test(id)) return null;
    const hash = parts[1] && /^[0-9a-f]+$/i.test(parts[1]) ? parts[1] : null;
    return `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ""}`;
  }
  if (host === "player.vimeo.com") {
    const id = parts[0] === "video" ? parts[1] : null;
    if (!id || !/^\d+$/.test(id)) return null;
    const h = u.searchParams.get("h");
    return `https://player.vimeo.com/video/${id}${h && /^[0-9a-f]+$/i.test(h) ? `?h=${h}` : ""}`;
  }

  if (host === "loom.com") {
    const id = parts[0] === "share" || parts[0] === "embed" ? parts[1] : null;
    return id && /^[0-9a-f]{32}$/i.test(id) ? `https://www.loom.com/embed/${id}` : null;
  }

  return null;
}
