"use client";

/**
 * SAM University admin editor (the University tab of Content Management).
 *
 * Talks only to /api/admin/university/** (service-role, any admin). Client-side
 * checks mirror the server rules in `normaliseResourceInput` so most mistakes
 * are caught before a round trip; the server's 400 `errors` are still shown
 * field by field, because it is the authority.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  CalendarCheck,
  FileText,
  GraduationCap,
  Lightbulb,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  Sparkles,
  Target,
  Trash2,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NumberInputRaw } from "@/components/ui/number-input";
import { UNIVERSITY_LIMITS, videoEmbedUrl } from "@/lib/university/access";
import {
  UNIVERSITY_ICONS,
  UNIVERSITY_RESOURCE_TYPES,
  UNIVERSITY_STATUSES,
  type UniversityCategory,
  type UniversityIcon,
  type UniversityResource,
  type UniversityResourceType,
  type UniversityStatus,
  type UniversityBillingCycle,
} from "@/types/university.types";

/* ------------------------------------------------------------------
   Types and constants
   ------------------------------------------------------------------ */

interface AdminPlan {
  id: string;
  name: string;
  isActive: boolean;
  displayOrder: number;
}

interface Catalogue {
  categories: UniversityCategory[];
  resources: UniversityResource[];
  plans: AdminPlan[];
}

type FieldErrors = Record<string, string>;

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; message: string; errors: FieldErrors };

type LoadState =
  | { kind: "loading" }
  | { kind: "migration" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Catalogue };

const ICONS: Record<UniversityIcon, React.ComponentType<{ className?: string }>> = {
  BookOpen,
  GraduationCap,
  BarChart3,
  CalendarCheck,
  Sparkles,
  Video,
  FileText,
  Lightbulb,
  Target,
  Rocket,
};

const TYPE_LABEL: Record<UniversityResourceType, string> = {
  video: "Video",
  article: "Article",
  pdf: "PDF",
  link: "Link",
};

const STATUS_LABEL: Record<UniversityStatus, string> = {
  draft: "Draft",
  coming_soon: "Coming soon",
  published: "Published",
};

const STATUS_STYLE: Record<UniversityStatus, string> = {
  draft: "bg-[hsl(var(--foreground-muted)/0.15)] text-[hsl(var(--foreground-muted))]",
  coming_soon: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  published: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

const INPUT =
  "w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] outline-none focus:border-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]";
const LABEL = "block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1";
const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-2";
const BTN_SECONDARY =
  "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]";
const BTN_ICON =
  "inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background))] hover:text-[hsl(var(--foreground))] disabled:opacity-30 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]";

/* ------------------------------------------------------------------
   API helper
   ------------------------------------------------------------------ */

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      cache: "no-store",
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: body as T };
    const b = (body ?? {}) as { error?: unknown; message?: unknown; errors?: unknown };
    const errors =
      b.errors && typeof b.errors === "object" && !Array.isArray(b.errors)
        ? (b.errors as FieldErrors)
        : {};
    const error = typeof b.error === "string" ? b.error : "error";
    const message =
      typeof b.message === "string"
        ? b.message
        : error !== "error" && error !== "invalid"
          ? error
          : `Request failed (${res.status}).`;
    return { ok: false, status: res.status, error, message, errors };
  } catch {
    return { ok: false, status: 0, error: "network", message: "Network error. Check your connection and try again.", errors: {} };
  }
}

async function fetchCatalogue(): Promise<LoadState> {
  const res = await api<Catalogue>("/api/admin/university");
  if (res.ok) return { kind: "ready", data: res.data };
  if (res.status === 503 && res.error === "migration_not_applied") return { kind: "migration" };
  return { kind: "error", message: res.message };
}

function moveId(ids: string[], index: number, delta: -1 | 1): string[] {
  const next = [...ids];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

const byOrder = <T extends { displayOrder: number }>(key: (x: T) => string) => (a: T, b: T) =>
  a.displayOrder - b.displayOrder || key(a).localeCompare(key(b));

function accessSummary(r: UniversityResource, plans: AdminPlan[]): string {
  const cycle = r.billingCycle === "annual" ? " · Annual only" : r.billingCycle === "monthly" ? " · Monthly only" : "";
  if (r.isFree) return `Free${cycle}`;
  const names = plans
    .filter((p) => r.planIds.includes(p.id))
    .map((p) => (p.isActive ? p.name : `${p.name} (retired)`));
  return names.length > 0 ? `${names.join(", ")}${cycle}` : "Admins only";
}

/** Who sees a resource by billing cycle, as offered in the form. */
const BILLING_CYCLE_OPTIONS: { value: UniversityBillingCycle; label: string }[] = [
  { value: "any", label: "Monthly and annual customers" },
  { value: "annual", label: "Annual customers only" },
  { value: "monthly", label: "Monthly customers only" },
];

/* ------------------------------------------------------------------
   Main component
   ------------------------------------------------------------------ */

export function UniversityManagement() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);
  /** Resources ticked for bulk delete. Cleared after every bulk delete. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const load = useCallback(async () => {
    setState(await fetchCatalogue());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchCatalogue().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Run a mutation, then reload. Returns the result so forms can show field errors. */
  const mutate = useCallback(
    async <T,>(url: string, init: RequestInit, success: string): Promise<ApiResult<T>> => {
      setBusy(true);
      setActionError(null);
      setNotice(null);
      const res = await api<T>(url, init);
      if (res.ok) setNotice(success);
      else if (Object.keys(res.errors).length === 0) setActionError(res.message);
      // Reload even after a failure: plan_links_failed means the row DID save.
      if (res.ok || res.status >= 500) await load();
      setBusy(false);
      return res;
    },
    [load]
  );

  if (state.kind === "loading") {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
        <span className="sr-only">Loading SAM University…</span>
      </div>
    );
  }

  if (state.kind === "migration") {
    return (
      <div role="alert" className="rounded-[var(--radius-lg)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        Migration 038 isn&apos;t applied yet. Apply{" "}
        <code className="font-mono text-xs">supabase/migrations/038_sam_university.sql</code> in the
        Supabase SQL editor, then reload.
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div role="alert" className="rounded-[var(--radius-lg)] border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
        <p>Couldn&apos;t load SAM University: {state.message}</p>
        <button type="button" onClick={() => { setState({ kind: "loading" }); void load(); }} className={cn(BTN_SECONDARY, "mt-3")}>
          Try again
        </button>
      </div>
    );
  }

  const { data } = state;
  const categories = [...data.categories].sort(byOrder((c) => c.name));
  const categoryIds = categories.map((c) => c.id);
  // Ticks for resources that no longer exist (deleted elsewhere) are ignored.
  const liveIds = new Set(data.resources.map((r) => r.id));
  const selectedIds = [...selected].filter((id) => liveIds.has(id));

  const toggleSelected = (ids: readonly string[], checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  async function bulkDelete(target: "selected" | "all") {
    const count = target === "all" ? data.resources.length : selectedIds.length;
    if (count === 0) return;
    const message =
      target === "all"
        ? `Delete ALL ${count} resource${count === 1 ? "" : "s"} in SAM University? Categories are kept. This cannot be undone.`
        : `Delete the ${count} selected resource${count === 1 ? "" : "s"}? This cannot be undone.`;
    if (!window.confirm(message)) return;
    const res = await mutate<{ deleted: number }>(
      "/api/admin/university/resources/bulk-delete",
      { method: "POST", body: JSON.stringify(target === "all" ? { all: true } : { ids: selectedIds }) },
      `${count} resource${count === 1 ? "" : "s"} deleted.`
    );
    if (res.ok) setSelected(new Set());
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          {categories.length} categor{categories.length === 1 ? "y" : "ies"} · {data.resources.length} resource
          {data.resources.length === 1 ? "" : "s"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {data.resources.length > 0 && (
            <button
              type="button"
              onClick={() => void bulkDelete("all")}
              className={cn(BTN_SECONDARY, "text-red-600 hover:text-red-700 dark:text-red-400")}
              disabled={busy}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete all resources
            </button>
          )}
          {!addingCategory && (
            <button type="button" onClick={() => setAddingCategory(true)} className={BTN_PRIMARY} disabled={busy}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add category
            </button>
          )}
        </div>
      </div>

      {/* Bulk bar: appears once any resource is ticked */}
      {selectedIds.length > 0 && (
        <div
          role="region"
          aria-label="Selected resources"
          className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
        >
          <span>
            {selectedIds.length} resource{selectedIds.length === 1 ? "" : "s"} selected
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={() => setSelected(new Set())} disabled={busy}>
              Clear selection
            </button>
            <button
              type="button"
              className={cn(BTN_PRIMARY, "bg-red-600 hover:bg-red-700")}
              onClick={() => void bulkDelete("selected")}
              disabled={busy}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete selected
            </button>
          </div>
        </div>
      )}

      <div aria-live="polite" className="sr-only">{notice ?? ""}</div>
      {notice && (
        <p className="text-xs text-green-700 dark:text-green-400">{notice}</p>
      )}
      {actionError && (
        <div role="alert" className="flex items-start justify-between gap-2 rounded-[var(--radius-md)] border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className={BTN_ICON} aria-label="Dismiss error">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {addingCategory && (
        <CategoryForm
          busy={busy}
          onCancel={() => setAddingCategory(false)}
          onSubmit={async (body) => {
            const res = await mutate<UniversityCategory>(
              "/api/admin/university/categories",
              { method: "POST", body: JSON.stringify(body) },
              `Category "${body.name}" added.`
            );
            if (res.ok) setAddingCategory(false);
            return res;
          }}
        />
      )}

      {categories.length === 0 && !addingCategory && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-8 text-center">
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            No categories yet. Add one to start building SAM University.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {categories.map((category, index) => (
          <li key={category.id}>
            <CategorySection
              category={category}
              categories={categories}
              resources={data.resources.filter((r) => r.categoryId === category.id).sort(byOrder((r) => r.title))}
              plans={data.plans}
              busy={busy}
              isFirst={index === 0}
              isLast={index === categories.length - 1}
              mutate={mutate}
              selected={selected}
              onToggleSelected={toggleSelected}
              onMove={(delta) =>
                void mutate(
                  "/api/admin/university/reorder",
                  { method: "PUT", body: JSON.stringify({ kind: "category", ids: moveId(categoryIds, index, delta) }) },
                  `Moved "${category.name}" ${delta < 0 ? "up" : "down"}.`
                )
              }
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

type Mutate = <T>(url: string, init: RequestInit, success: string) => Promise<ApiResult<T>>;

/* ------------------------------------------------------------------
   Category section
   ------------------------------------------------------------------ */

interface CategorySectionProps {
  category: UniversityCategory;
  categories: UniversityCategory[];
  resources: UniversityResource[];
  plans: AdminPlan[];
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  mutate: Mutate;
  /** Ticked resource ids, across every category. */
  selected: ReadonlySet<string>;
  onToggleSelected: (ids: readonly string[], checked: boolean) => void;
  onMove: (delta: -1 | 1) => void;
}

function CategorySection({
  category,
  categories,
  resources,
  plans,
  busy,
  isFirst,
  isLast,
  mutate,
  selected,
  onToggleSelected,
  onMove,
}: CategorySectionProps) {
  const [editing, setEditing] = useState(false);
  const [addingResource, setAddingResource] = useState(false);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null);
  const headingId = useId();
  const Icon = category.icon ? ICONS[category.icon] : BookOpen;
  const resourceIds = resources.map((r) => r.id);

  async function handleDelete() {
    if (resources.length > 0) {
      window.alert(
        `"${category.name}" still has ${resources.length} resource${resources.length === 1 ? "" : "s"}. Move or delete them first.`
      );
      return;
    }
    if (!window.confirm(`Delete the category "${category.name}"? This cannot be undone.`)) return;
    await mutate(
      `/api/admin/university/categories/${category.id}`,
      { method: "DELETE" },
      `Category "${category.name}" deleted.`
    );
  }

  async function togglePublished() {
    await mutate(
      `/api/admin/university/categories/${category.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: category.name,
          description: category.description,
          icon: category.icon,
          isPublished: !category.isPublished,
        }),
      },
      `"${category.name}" is now ${category.isPublished ? "hidden" : "published"}.`
    );
  }

  return (
    <section aria-labelledby={headingId} className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--primary))]" aria-hidden="true" />
          <h3 id={headingId} className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
            {category.name}
          </h3>
          <span className="shrink-0 text-xs text-[hsl(var(--foreground-muted))]">
            {resources.length} resource{resources.length === 1 ? "" : "s"}
          </span>
          {!category.isPublished && (
            <span className="shrink-0 rounded-full bg-[hsl(var(--foreground-muted)/0.15)] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
              Hidden
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <label className="mr-2 inline-flex cursor-pointer items-center gap-1.5 text-xs text-[hsl(var(--foreground-muted))]">
            <input
              type="checkbox"
              role="switch"
              checked={category.isPublished}
              onChange={() => void togglePublished()}
              disabled={busy}
              className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
            />
            Published
          </label>
          <button type="button" className={BTN_ICON} onClick={() => onMove(-1)} disabled={busy || isFirst} aria-label={`Move category ${category.name} up`}>
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" className={BTN_ICON} onClick={() => onMove(1)} disabled={busy || isLast} aria-label={`Move category ${category.name} down`}>
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" className={BTN_ICON} onClick={() => setEditing((v) => !v)} disabled={busy} aria-label={`Edit category ${category.name}`} aria-expanded={editing}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" className={cn(BTN_ICON, "text-red-500 hover:text-red-700")} onClick={() => void handleDelete()} disabled={busy} aria-label={`Delete category ${category.name}`}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {category.description && !editing && (
        <p className="px-4 pb-3 -mt-1 text-xs text-[hsl(var(--foreground-muted))]">{category.description}</p>
      )}

      {editing && (
        <div className="border-t border-border bg-[hsl(var(--background))] px-4 py-4">
          <CategoryForm
            initial={category}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              const res = await mutate<UniversityCategory>(
                `/api/admin/university/categories/${category.id}`,
                { method: "PATCH", body: JSON.stringify(body) },
                `Category "${body.name}" saved.`
              );
              if (res.ok) setEditing(false);
              return res;
            }}
          />
        </div>
      )}

      {resources.length > 0 && (
        <label className="flex cursor-pointer items-center gap-2 border-t border-border bg-[hsl(var(--background))] px-4 py-1.5 text-xs text-[hsl(var(--foreground-muted))]">
          <input
            type="checkbox"
            checked={resourceIds.every((rid) => selected.has(rid))}
            ref={(el) => {
              if (el) {
                const some = resourceIds.some((rid) => selected.has(rid));
                el.indeterminate = some && !resourceIds.every((rid) => selected.has(rid));
              }
            }}
            onChange={(e) => onToggleSelected(resourceIds, e.target.checked)}
            disabled={busy}
            className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
          />
          Select all in {category.name}
        </label>
      )}
      <ul className="divide-y divide-border border-t border-border">
        {resources.map((resource, index) => (
          <li key={resource.id}>
            {editingResourceId === resource.id ? (
              <div className="bg-[hsl(var(--background))] px-4 py-4">
                <ResourceForm
                  initial={resource}
                  defaultCategoryId={category.id}
                  categories={categories}
                  plans={plans}
                  busy={busy}
                  onCancel={() => setEditingResourceId(null)}
                  onSubmit={async (body) => {
                    const res = await mutate<UniversityResource>(
                      `/api/admin/university/resources/${resource.id}`,
                      { method: "PATCH", body: JSON.stringify(body) },
                      `"${body.title}" saved.`
                    );
                    if (res.ok) setEditingResourceId(null);
                    return res;
                  }}
                />
              </div>
            ) : (
              <ResourceRow
                resource={resource}
                plans={plans}
                busy={busy}
                selected={selected.has(resource.id)}
                onSelect={(checked) => onToggleSelected([resource.id], checked)}
                isFirst={index === 0}
                isLast={index === resources.length - 1}
                onEdit={() => setEditingResourceId(resource.id)}
                onDelete={async () => {
                  if (!window.confirm(`Delete "${resource.title}"? This cannot be undone.`)) return;
                  await mutate(
                    `/api/admin/university/resources/${resource.id}`,
                    { method: "DELETE" },
                    `"${resource.title}" deleted.`
                  );
                }}
                onMove={(delta) =>
                  void mutate(
                    "/api/admin/university/reorder",
                    { method: "PUT", body: JSON.stringify({ kind: "resource", ids: moveId(resourceIds, index, delta) }) },
                    `Moved "${resource.title}" ${delta < 0 ? "up" : "down"}.`
                  )
                }
              />
            )}
          </li>
        ))}
        {resources.length === 0 && !addingResource && (
          <li className="px-4 py-3 text-xs text-[hsl(var(--foreground-muted))]">
            No resources yet. Customers won&apos;t see this category until it has one that isn&apos;t a draft.
          </li>
        )}
      </ul>

      <div className="border-t border-border px-4 py-3">
        {addingResource ? (
          <ResourceForm
            defaultCategoryId={category.id}
            categories={categories}
            plans={plans}
            busy={busy}
            onCancel={() => setAddingResource(false)}
            onSubmit={async (body) => {
              const res = await mutate<UniversityResource>(
                "/api/admin/university/resources",
                { method: "POST", body: JSON.stringify(body) },
                `"${body.title}" added.`
              );
              if (res.ok) setAddingResource(false);
              return res;
            }}
          />
        ) : (
          <button type="button" className={BTN_SECONDARY} onClick={() => setAddingResource(true)} disabled={busy}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add resource
          </button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------
   Resource row
   ------------------------------------------------------------------ */

interface ResourceRowProps {
  resource: UniversityResource;
  plans: AdminPlan[];
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  /** Ticked for bulk delete. */
  selected: boolean;
  onSelect: (checked: boolean) => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onMove: (delta: -1 | 1) => void;
}

function ResourceRow({ resource, plans, busy, isFirst, isLast, selected, onSelect, onEdit, onDelete, onMove }: ResourceRowProps) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 px-4 py-2.5", selected && "bg-red-50/60 dark:bg-red-950/20")}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelect(e.target.checked)}
          disabled={busy}
          aria-label={`Select ${resource.title}`}
          className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))]"
        />
        <span className="truncate text-sm text-[hsl(var(--foreground))]">{resource.title}</span>
        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
          {TYPE_LABEL[resource.type]}
        </span>
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_STYLE[resource.status])}>
          {STATUS_LABEL[resource.status]}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-[hsl(var(--foreground-muted))]">
          <span className="sr-only">Access: </span>
          {accessSummary(resource, plans)}
        </span>
        <span className="w-14 text-right text-xs tabular-nums text-[hsl(var(--foreground-muted))]">
          {resource.durationMinutes !== null ? `${resource.durationMinutes} min` : "—"}
        </span>
        <div className="flex items-center gap-1">
          <button type="button" className={BTN_ICON} onClick={() => onMove(-1)} disabled={busy || isFirst} aria-label={`Move ${resource.title} up`}>
            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" className={BTN_ICON} onClick={() => onMove(1)} disabled={busy || isLast} aria-label={`Move ${resource.title} down`}>
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" className={BTN_ICON} onClick={onEdit} disabled={busy} aria-label={`Edit ${resource.title}`}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" className={cn(BTN_ICON, "text-red-500 hover:text-red-700")} onClick={() => void onDelete()} disabled={busy} aria-label={`Delete ${resource.title}`}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Shared form bits
   ------------------------------------------------------------------ */

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

/** Text describing a failed save that had no field errors (shown in the form). */
function formLevelError<T>(res: ApiResult<T>): string | null {
  if (res.ok) return null;
  return Object.keys(res.errors).length > 0 ? "Please fix the highlighted fields." : res.message;
}

/* ------------------------------------------------------------------
   Category form
   ------------------------------------------------------------------ */

interface CategoryBody {
  name: string;
  description: string | null;
  icon: UniversityIcon | null;
  isPublished: boolean;
}

interface CategoryFormProps {
  initial?: UniversityCategory;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: CategoryBody) => Promise<ApiResult<UniversityCategory>>;
}

function CategoryForm({ initial, busy, onCancel, onSubmit }: CategoryFormProps) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [icon, setIcon] = useState<UniversityIcon | "">(initial?.icon ?? "");
  const [isPublished, setIsPublished] = useState(initial?.isPublished ?? true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const local: FieldErrors = {};
    if (!name.trim()) local.name = "Name is required.";
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    const res = await onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      icon: icon || null,
      isPublished,
    });
    if (!res.ok) {
      setErrors(res.errors);
      setFormError(formLevelError(res));
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={cn("space-y-3", !initial && "rounded-[var(--radius-lg)] border border-border bg-card p-4")}>
      {!initial && <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">New category</h3>}
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <div>
          <label htmlFor={`${id}-name`} className={LABEL}>Name</label>
          <input
            id={`${id}-name`}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={UNIVERSITY_LIMITS.categoryNameMax}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? `${id}-name-error` : undefined}
            className={INPUT}
          />
          <FieldError id={`${id}-name-error`} message={errors.name} />
        </div>
        <div>
          <label htmlFor={`${id}-icon`} className={LABEL}>Icon</label>
          <select
            id={`${id}-icon`}
            value={icon}
            onChange={(e) => setIcon(e.target.value as UniversityIcon | "")}
            aria-invalid={!!errors.icon}
            aria-describedby={errors.icon ? `${id}-icon-error` : undefined}
            className={INPUT}
          >
            <option value="">Default</option>
            {UNIVERSITY_ICONS.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
          <FieldError id={`${id}-icon-error`} message={errors.icon} />
        </div>
      </div>
      <div>
        <label htmlFor={`${id}-description`} className={LABEL}>Description (optional)</label>
        <textarea
          id={`${id}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={UNIVERSITY_LIMITS.categoryDescriptionMax}
          aria-invalid={!!errors.description}
          aria-describedby={errors.description ? `${id}-description-error` : undefined}
          className={cn(INPUT, "resize-y")}
        />
        <FieldError id={`${id}-description-error`} message={errors.description} />
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[hsl(var(--foreground))]">
        <input
          type="checkbox"
          checked={isPublished}
          onChange={(e) => setIsPublished(e.target.checked)}
          className="h-4 w-4 accent-[hsl(var(--primary))]"
        />
        Published (visible to customers)
      </label>
      <FormError message={formError} />
      <div className="flex items-center gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {initial ? "Save category" : "Add category"}
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------
   Resource form
   ------------------------------------------------------------------ */

interface ResourceBody {
  categoryId: string;
  title: string;
  description: string | null;
  type: UniversityResourceType;
  url: string | null;
  durationMinutes: number | null;
  status: UniversityStatus;
  isFree: boolean;
  planIds: string[];
  billingCycle: UniversityBillingCycle;
  // No displayOrder: the server appends on create and keeps the order on edit
  // (appending when the category changes). Reordering uses the arrows.
}

interface ResourceFormProps {
  initial?: UniversityResource;
  defaultCategoryId: string;
  categories: UniversityCategory[];
  plans: AdminPlan[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: ResourceBody) => Promise<ApiResult<UniversityResource>>;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && !!u.hostname;
  } catch {
    return false;
  }
}

function ResourceForm({ initial, defaultCategoryId, categories, plans, busy, onCancel, onSubmit }: ResourceFormProps) {
  const id = useId();
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? defaultCategoryId);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [type, setType] = useState<UniversityResourceType>(initial?.type ?? "video");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [duration, setDuration] = useState(
    initial?.durationMinutes !== null && initial?.durationMinutes !== undefined ? String(initial.durationMinutes) : ""
  );
  const [status, setStatus] = useState<UniversityStatus>(initial?.status ?? "draft");
  const [isFree, setIsFree] = useState(initial?.isFree ?? false);
  const [planIds, setPlanIds] = useState<string[]>(initial?.planIds ?? []);
  const [billingCycle, setBillingCycle] = useState<UniversityBillingCycle>(initial?.billingCycle ?? "any");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const trimmedUrl = url.trim();
  const embeddable = type === "video" && trimmedUrl !== "" && videoEmbedUrl(trimmedUrl) !== null;

  // Plans attached to this resource stay listed even if they vanish from the
  // plan list, so an admin can see and untick them.
  const knownIds = new Set(plans.map((p) => p.id));
  const orphanPlanIds = planIds.filter((p) => !knownIds.has(p));

  function togglePlan(planId: string, checked: boolean) {
    setPlanIds((prev) => (checked ? [...new Set([...prev, planId])] : prev.filter((p) => p !== planId)));
  }

  function validate(): FieldErrors {
    const e: FieldErrors = {};
    if (!categoryId) e.categoryId = "Choose a category.";
    if (!title.trim()) e.title = "Title is required.";
    else if (title.trim().length > UNIVERSITY_LIMITS.titleMax)
      e.title = `Title must be ${UNIVERSITY_LIMITS.titleMax} characters or fewer.`;
    if (trimmedUrl !== "" && !isHttpUrl(trimmedUrl)) e.url = "URL must be a full http:// or https:// link.";
    else if (status === "published" && trimmedUrl === "") e.url = "A published resource needs a URL.";
    if (duration !== "") {
      const n = Number(duration);
      if (!Number.isInteger(n) || n < 0 || n > UNIVERSITY_LIMITS.durationMax)
        e.durationMinutes = `Duration must be a whole number of minutes from 0 to ${UNIVERSITY_LIMITS.durationMax}.`;
    }
    if (!isFree && planIds.length === 0) e.planIds = "Mark it free, or choose at least one plan.";
    return e;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const local = validate();
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) {
      setFormError("Please fix the highlighted fields.");
      return;
    }

    const body: ResourceBody = {
      categoryId,
      title: title.trim(),
      description: description.trim() || null,
      type,
      url: trimmedUrl || null,
      durationMinutes: duration === "" ? null : Number(duration),
      status,
      isFree,
      planIds: isFree ? [] : planIds,
      billingCycle,
    };
    const res = await onSubmit(body);
    if (!res.ok) {
      setErrors(res.errors);
      setFormError(formLevelError(res));
    }
  }

  const describedBy = (field: string, hint?: string) =>
    [hint, errors[field] ? `${id}-${field}-error` : null].filter(Boolean).join(" ") || undefined;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">
        {initial ? `Edit "${initial.title}"` : "New resource"}
      </h4>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-categoryId`} className={LABEL}>Category</label>
          <select
            id={`${id}-categoryId`}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-invalid={!!errors.categoryId}
            aria-describedby={describedBy("categoryId")}
            className={INPUT}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <FieldError id={`${id}-categoryId-error`} message={errors.categoryId} />
        </div>
        <div>
          <label htmlFor={`${id}-title`} className={LABEL}>Title</label>
          <input
            id={`${id}-title`}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={UNIVERSITY_LIMITS.titleMax}
            aria-invalid={!!errors.title}
            aria-describedby={describedBy("title")}
            className={INPUT}
          />
          <FieldError id={`${id}-title-error`} message={errors.title} />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-description`} className={LABEL}>Description (optional)</label>
        <textarea
          id={`${id}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={UNIVERSITY_LIMITS.resourceDescriptionMax}
          aria-invalid={!!errors.description}
          aria-describedby={describedBy("description")}
          className={cn(INPUT, "resize-y")}
        />
        <FieldError id={`${id}-description-error`} message={errors.description} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`${id}-type`} className={LABEL}>Type</label>
          <select
            id={`${id}-type`}
            value={type}
            onChange={(e) => setType(e.target.value as UniversityResourceType)}
            aria-invalid={!!errors.type}
            aria-describedby={describedBy("type")}
            className={INPUT}
          >
            {UNIVERSITY_RESOURCE_TYPES.map((t) => (
              <option key={t} value={t}>{TYPE_LABEL[t]}</option>
            ))}
          </select>
          <FieldError id={`${id}-type-error`} message={errors.type} />
        </div>
        <div>
          <label htmlFor={`${id}-status`} className={LABEL}>Status</label>
          <select
            id={`${id}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value as UniversityStatus)}
            aria-invalid={!!errors.status}
            aria-describedby={describedBy("status", `${id}-status-hint`)}
            className={INPUT}
          >
            {UNIVERSITY_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <p id={`${id}-status-hint`} className="mt-1 text-[11px] text-[hsl(var(--foreground-muted))]">
            {status === "draft"
              ? "Hidden from customers."
              : status === "coming_soon"
                ? "Shown as a card with no link."
                : "Shown; the link opens for allowed plans."}
          </p>
          <FieldError id={`${id}-status-error`} message={errors.status} />
        </div>
        <div>
          <label htmlFor={`${id}-durationMinutes`} className={LABEL}>Duration (minutes)</label>
          <NumberInputRaw
            id={`${id}-durationMinutes`}
            value={duration}
            onValueChange={setDuration}
            placeholder="e.g. 10"
            error={!!errors.durationMinutes}
            aria-invalid={!!errors.durationMinutes}
            aria-describedby={describedBy("durationMinutes")}
            className={INPUT}
          />
          <FieldError id={`${id}-durationMinutes-error`} message={errors.durationMinutes} />
        </div>
      </div>

      <div>
        <label htmlFor={`${id}-url`} className={LABEL}>URL</label>
        <input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=…"
          maxLength={UNIVERSITY_LIMITS.urlMax}
          aria-invalid={!!errors.url}
          aria-describedby={describedBy("url", `${id}-url-hint`)}
          className={INPUT}
        />
        <p id={`${id}-url-hint`} className="mt-1 text-[11px] text-[hsl(var(--foreground-muted))]">
          A full https:// link. Required when published.
          {type === "video" && trimmedUrl !== "" && (
            <span className={cn("ml-1 font-medium", embeddable ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400")}>
              {embeddable ? "Plays inside SAM." : "Opens in a new tab."}
            </span>
          )}
          {type === "video" && trimmedUrl === "" && " YouTube, Vimeo and Loom links play inside SAM."}
        </p>
        <FieldError id={`${id}-url-error`} message={errors.url} />
      </div>

      <fieldset aria-describedby={errors.planIds ? `${id}-planIds-error` : undefined}>
        <legend className={LABEL}>Access</legend>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[hsl(var(--foreground))]">
            <input
              type="radio"
              name={`${id}-access`}
              checked={isFree}
              onChange={() => setIsFree(true)}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            Free for everyone
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[hsl(var(--foreground))]">
            <input
              type="radio"
              name={`${id}-access`}
              checked={!isFree}
              onChange={() => setIsFree(false)}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            Only these plans
          </label>
        </div>
        {!isFree && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 rounded-[var(--radius-md)] border border-border bg-card px-3 py-2">
            {plans.length === 0 && orphanPlanIds.length === 0 && (
              <p className="text-xs text-[hsl(var(--foreground-muted))]">No subscription plans exist yet.</p>
            )}
            {plans.map((p) => (
              <label key={p.id} className="inline-flex cursor-pointer items-center gap-2 text-sm text-[hsl(var(--foreground))]">
                <input
                  type="checkbox"
                  checked={planIds.includes(p.id)}
                  onChange={(e) => togglePlan(p.id, e.target.checked)}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                {p.name}
                {!p.isActive && <span className="text-xs text-[hsl(var(--foreground-muted))]">(retired)</span>}
              </label>
            ))}
            {orphanPlanIds.map((p) => (
              <label key={p} className="inline-flex cursor-pointer items-center gap-2 text-sm text-[hsl(var(--foreground-muted))]">
                <input
                  type="checkbox"
                  checked
                  onChange={(e) => togglePlan(p, e.target.checked)}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                Unknown plan
              </label>
            ))}
          </div>
        )}
        <FieldError id={`${id}-planIds-error`} message={errors.planIds} />
      </fieldset>

      {/* Migration 056: on top of the plan rule; the other cycle does not see it at all. */}
      <div>
        <label htmlFor={`${id}-billingCycle`} className={LABEL}>Show to</label>
        <select
          id={`${id}-billingCycle`}
          value={billingCycle}
          onChange={(e) => setBillingCycle(e.target.value as UniversityBillingCycle)}
          aria-describedby={`${id}-billingCycle-hint${errors.billingCycle ? ` ${id}-billingCycle-error` : ""}`}
          className={INPUT}
        >
          {BILLING_CYCLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p id={`${id}-billingCycle-hint`} className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
          Customers on the other billing cycle won&apos;t see this resource at all. Trials and free-access accounts count as monthly.
        </p>
        <FieldError id={`${id}-billingCycle-error`} message={errors.billingCycle} />
      </div>

      <FormError message={formError} />
      <div className="flex items-center gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {initial ? "Save resource" : "Add resource"}
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
