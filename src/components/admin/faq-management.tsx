"use client";

/**
 * FAQ admin editor (the FAQ tab of Content Management).
 *
 * Talks only to /api/admin/faq/** (service-role, any admin). Client-side
 * checks mirror `normaliseFaq*Input` so most mistakes are caught before a
 * round trip; the server's 400 `errors` are still shown field by field.
 *
 * Answers are plain text. The preview uses <FaqAnswer>, the same renderer as
 * the customer FAQ page, so what the admin sees is what customers get.
 */

import { useCallback, useEffect, useId, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  CreditCard,
  HelpCircle,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Rocket,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FAQ_LIMITS } from "@/lib/faq/faq";
import { FaqAnswer } from "@/components/help/faq-answer";
import {
  FAQ_ICONS,
  FAQ_STATUSES,
  type FaqCategory,
  type FaqIcon,
  type FaqItem,
  type FaqStatus,
} from "@/types/faq.types";

/* ------------------------------------------------------------------
   Types and constants
   ------------------------------------------------------------------ */

interface Catalogue {
  categories: FaqCategory[];
  items: FaqItem[];
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

type Mutate = <T>(url: string, init: RequestInit, success: string) => Promise<ApiResult<T>>;

const ICONS: Record<FaqIcon, React.ComponentType<{ className?: string }>> = {
  Rocket,
  CreditCard,
  Layers,
  ShieldCheck,
  HelpCircle,
  BookOpen,
  Settings,
  Users,
  BarChart3,
  Sparkles,
};

const STATUS_LABEL: Record<FaqStatus, string> = {
  draft: "Draft",
  published: "Published",
};

const STATUS_STYLE: Record<FaqStatus, string> = {
  draft: "bg-[hsl(var(--foreground-muted)/0.15)] text-[hsl(var(--foreground-muted))]",
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
  const res = await api<Catalogue>("/api/admin/faq");
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

/* ------------------------------------------------------------------
   Main component
   ------------------------------------------------------------------ */

export function FaqManagement() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [addingCategory, setAddingCategory] = useState(false);

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
  const mutate = useCallback<Mutate>(
    async <T,>(url: string, init: RequestInit, success: string): Promise<ApiResult<T>> => {
      setBusy(true);
      setActionError(null);
      setNotice(null);
      const res = await api<T>(url, init);
      if (res.ok) setNotice(success);
      else if (Object.keys(res.errors).length === 0) setActionError(res.message);
      // Reload after a 409/5xx too, so the screen reflects what is really stored.
      if (res.ok || res.status === 409 || res.status >= 500) await load();
      setBusy(false);
      return res;
    },
    [load]
  );

  if (state.kind === "loading") {
    return (
      <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
        <span className="sr-only">Loading FAQ…</span>
      </div>
    );
  }

  if (state.kind === "migration") {
    return (
      <div role="alert" className="rounded-[var(--radius-lg)] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        Migration 039 isn&apos;t applied yet. Apply{" "}
        <code className="font-mono text-xs">supabase/migrations/039_faq.sql</code> in the Supabase
        SQL editor, then reload. Until then customers see &ldquo;Help articles are being set up.&rdquo;
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div role="alert" className="rounded-[var(--radius-lg)] border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
        <p>Couldn&apos;t load the FAQ: {state.message}</p>
        <button type="button" onClick={() => { setState({ kind: "loading" }); void load(); }} className={cn(BTN_SECONDARY, "mt-3")}>
          Try again
        </button>
      </div>
    );
  }

  const { data } = state;
  const categories = [...data.categories].sort(byOrder((c) => c.name));
  const categoryIds = categories.map((c) => c.id);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          {categories.length} categor{categories.length === 1 ? "y" : "ies"} · {data.items.length} question
          {data.items.length === 1 ? "" : "s"}
        </p>
        {!addingCategory && (
          <button type="button" onClick={() => setAddingCategory(true)} className={BTN_PRIMARY} disabled={busy}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add category
          </button>
        )}
      </div>

      <div aria-live="polite" className="sr-only">{notice ?? ""}</div>
      {notice && <p className="text-xs text-green-700 dark:text-green-400">{notice}</p>}
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
            const res = await mutate<FaqCategory>(
              "/api/admin/faq/categories",
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
            No categories yet. Add one to start building the FAQ.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {categories.map((category, index) => (
          <li key={category.id}>
            <CategorySection
              category={category}
              categories={categories}
              items={data.items.filter((i) => i.categoryId === category.id).sort(byOrder((i) => i.question))}
              busy={busy}
              isFirst={index === 0}
              isLast={index === categories.length - 1}
              mutate={mutate}
              onMove={(delta) =>
                void mutate(
                  "/api/admin/faq/reorder",
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

/* ------------------------------------------------------------------
   Category section
   ------------------------------------------------------------------ */

interface CategorySectionProps {
  category: FaqCategory;
  categories: FaqCategory[];
  items: FaqItem[];
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  mutate: Mutate;
  onMove: (delta: -1 | 1) => void;
}

function CategorySection({ category, categories, items, busy, isFirst, isLast, mutate, onMove }: CategorySectionProps) {
  const [editing, setEditing] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const headingId = useId();
  const Icon = category.icon ? ICONS[category.icon] : HelpCircle;
  const itemIds = items.map((i) => i.id);
  const publishedCount = items.filter((i) => i.status === "published").length;

  async function handleDelete() {
    if (items.length > 0) {
      window.alert(
        `"${category.name}" still has ${items.length} question${items.length === 1 ? "" : "s"}. Move or delete them first.`
      );
      return;
    }
    if (!window.confirm(`Delete the category "${category.name}"? This cannot be undone.`)) return;
    await mutate(`/api/admin/faq/categories/${category.id}`, { method: "DELETE" }, `Category "${category.name}" deleted.`);
  }

  async function togglePublished() {
    await mutate(
      `/api/admin/faq/categories/${category.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: category.name, icon: category.icon, isPublished: !category.isPublished }),
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
            {items.length} question{items.length === 1 ? "" : "s"}
            {items.length > 0 && publishedCount !== items.length ? ` · ${publishedCount} published` : ""}
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
              aria-label={`Publish category ${category.name}`}
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

      {editing && (
        <div className="border-t border-border bg-[hsl(var(--background))] px-4 py-4">
          <CategoryForm
            initial={category}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => {
              const res = await mutate<FaqCategory>(
                `/api/admin/faq/categories/${category.id}`,
                { method: "PATCH", body: JSON.stringify(body) },
                `Category "${body.name}" saved.`
              );
              if (res.ok) setEditing(false);
              return res;
            }}
          />
        </div>
      )}

      <ul className="divide-y divide-border border-t border-border">
        {items.map((item, index) => (
          <li key={item.id}>
            {editingItemId === item.id ? (
              <div className="bg-[hsl(var(--background))] px-4 py-4">
                <ItemForm
                  initial={item}
                  defaultCategoryId={category.id}
                  categories={categories}
                  busy={busy}
                  onCancel={() => setEditingItemId(null)}
                  onSubmit={async (body) => {
                    const res = await mutate<FaqItem>(
                      `/api/admin/faq/items/${item.id}`,
                      { method: "PATCH", body: JSON.stringify(body) },
                      `"${body.question}" saved.`
                    );
                    if (res.ok) setEditingItemId(null);
                    return res;
                  }}
                />
              </div>
            ) : (
              <ItemRow
                item={item}
                busy={busy}
                isFirst={index === 0}
                isLast={index === items.length - 1}
                onEdit={() => setEditingItemId(item.id)}
                onDelete={async () => {
                  if (!window.confirm(`Delete the question "${item.question}"? This cannot be undone.`)) return;
                  await mutate(`/api/admin/faq/items/${item.id}`, { method: "DELETE" }, `"${item.question}" deleted.`);
                }}
                onMove={(delta) =>
                  void mutate(
                    "/api/admin/faq/reorder",
                    { method: "PUT", body: JSON.stringify({ kind: "item", ids: moveId(itemIds, index, delta) }) },
                    `Moved "${item.question}" ${delta < 0 ? "up" : "down"}.`
                  )
                }
              />
            )}
          </li>
        ))}
        {items.length === 0 && !addingItem && (
          <li className="px-4 py-3 text-xs text-[hsl(var(--foreground-muted))]">
            No questions yet. Customers won&apos;t see this category until it has a published one.
          </li>
        )}
      </ul>

      <div className="border-t border-border px-4 py-3">
        {addingItem ? (
          <ItemForm
            defaultCategoryId={category.id}
            categories={categories}
            busy={busy}
            onCancel={() => setAddingItem(false)}
            onSubmit={async (body) => {
              const res = await mutate<FaqItem>(
                "/api/admin/faq/items",
                { method: "POST", body: JSON.stringify(body) },
                `"${body.question}" added.`
              );
              if (res.ok) setAddingItem(false);
              return res;
            }}
          />
        ) : (
          <button type="button" className={BTN_SECONDARY} onClick={() => setAddingItem(true)} disabled={busy}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add question
          </button>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------
   Item row
   ------------------------------------------------------------------ */

interface ItemRowProps {
  item: FaqItem;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onMove: (delta: -1 | 1) => void;
}

function ItemRow({ item, busy, isFirst, isLast, onEdit, onDelete, onMove }: ItemRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm text-[hsl(var(--foreground))]">{item.question}</span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_STYLE[item.status])}>
          {STATUS_LABEL[item.status]}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" className={BTN_ICON} onClick={() => onMove(-1)} disabled={busy || isFirst} aria-label={`Move "${item.question}" up`}>
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" className={BTN_ICON} onClick={() => onMove(1)} disabled={busy || isLast} aria-label={`Move "${item.question}" down`}>
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" className={BTN_ICON} onClick={onEdit} disabled={busy} aria-label={`Edit "${item.question}"`}>
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" className={cn(BTN_ICON, "text-red-500 hover:text-red-700")} onClick={() => void onDelete()} disabled={busy} aria-label={`Delete "${item.question}"`}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
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
  icon: FaqIcon | null;
  isPublished: boolean;
}

interface CategoryFormProps {
  initial?: FaqCategory;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: CategoryBody) => Promise<ApiResult<FaqCategory>>;
}

function CategoryForm({ initial, busy, onCancel, onSubmit }: CategoryFormProps) {
  const id = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [icon, setIcon] = useState<FaqIcon | "">(initial?.icon ?? "");
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

    const res = await onSubmit({ name: name.trim(), icon: icon || null, isPublished });
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
            maxLength={FAQ_LIMITS.categoryNameMax}
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
            onChange={(e) => setIcon(e.target.value as FaqIcon | "")}
            aria-invalid={!!errors.icon}
            aria-describedby={errors.icon ? `${id}-icon-error` : undefined}
            className={INPUT}
          >
            <option value="">Default</option>
            {FAQ_ICONS.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
          <FieldError id={`${id}-icon-error`} message={errors.icon} />
        </div>
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
   Item form
   ------------------------------------------------------------------ */

interface ItemBody {
  categoryId: string;
  question: string;
  answer: string;
  status: FaqStatus;
  // No displayOrder: the server appends on create and keeps the order on edit
  // (appending when the category changes). Reordering uses the arrows.
}

interface ItemFormProps {
  initial?: FaqItem;
  defaultCategoryId: string;
  categories: FaqCategory[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: ItemBody) => Promise<ApiResult<FaqItem>>;
}

function ItemForm({ initial, defaultCategoryId, categories, busy, onCancel, onSubmit }: ItemFormProps) {
  const id = useId();
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? defaultCategoryId);
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [status, setStatus] = useState<FaqStatus>(initial?.status ?? "draft");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const local: FieldErrors = {};
    if (!categoryId) local.categoryId = "Choose a category.";
    if (!question.trim()) local.question = "Question is required.";
    else if (question.trim().length > FAQ_LIMITS.questionMax)
      local.question = `Question must be ${FAQ_LIMITS.questionMax} characters or fewer.`;
    if (!answer.trim()) local.answer = "Answer is required.";
    else if (answer.trim().length > FAQ_LIMITS.answerMax)
      local.answer = `Answer must be ${FAQ_LIMITS.answerMax} characters or fewer.`;
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length > 0) return;

    const res = await onSubmit({ categoryId, question: question.trim(), answer, status });
    if (!res.ok) {
      setErrors(res.errors);
      setFormError(formLevelError(res));
    }
  }

  const describedBy = (field: string, extra?: string) =>
    [errors[field] ? `${id}-${field}-error` : null, extra ?? null].filter(Boolean).join(" ") || undefined;

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      {!initial && <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">New question</h4>}
      <div>
        <label htmlFor={`${id}-question`} className={LABEL}>Question</label>
        <input
          id={`${id}-question`}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={FAQ_LIMITS.questionMax}
          aria-invalid={!!errors.question}
          aria-describedby={describedBy("question")}
          className={INPUT}
        />
        <FieldError id={`${id}-question-error`} message={errors.question} />
      </div>
      <div>
        <label htmlFor={`${id}-answer`} className={LABEL}>Answer</label>
        <textarea
          id={`${id}-answer`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={6}
          maxLength={FAQ_LIMITS.answerMax}
          aria-invalid={!!errors.answer}
          aria-describedby={describedBy("answer", `${id}-answer-hint`)}
          className={cn(INPUT, "resize-y")}
        />
        <p id={`${id}-answer-hint`} className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
          Plain text. Line breaks are kept; http(s) links become clickable. {answer.length}/{FAQ_LIMITS.answerMax}
        </p>
        <FieldError id={`${id}-answer-error`} message={errors.answer} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-category`} className={LABEL}>Category</label>
          <select
            id={`${id}-category`}
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            aria-invalid={!!errors.categoryId}
            aria-describedby={describedBy("categoryId")}
            className={INPUT}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.isPublished ? "" : " (hidden)"}
              </option>
            ))}
          </select>
          <FieldError id={`${id}-categoryId-error`} message={errors.categoryId} />
        </div>
        <div>
          <label htmlFor={`${id}-status`} className={LABEL}>Status</label>
          <select
            id={`${id}-status`}
            value={status}
            onChange={(e) => setStatus(e.target.value as FaqStatus)}
            aria-invalid={!!errors.status}
            aria-describedby={describedBy("status")}
            className={INPUT}
          >
            {FAQ_STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
          <FieldError id={`${id}-status-error`} message={errors.status} />
        </div>
      </div>
      <section aria-labelledby={`${id}-preview`} className="rounded-[var(--radius-md)] border border-dashed border-border bg-card p-3">
        <h5 id={`${id}-preview`} className="mb-2 text-xs font-medium text-[hsl(var(--foreground-muted))]">
          Preview (as customers see it)
        </h5>
        <p className="mb-1 text-sm font-medium text-[hsl(var(--foreground))]">
          {question.trim() || "Your question"}
        </p>
        {answer.trim() ? (
          <FaqAnswer text={answer.trim()} className="text-sm leading-relaxed text-[hsl(var(--foreground-muted))]" />
        ) : (
          <p className="text-sm italic text-[hsl(var(--foreground-muted))]">Your answer</p>
        )}
      </section>
      <FormError message={formError} />
      <div className="flex items-center gap-2">
        <button type="submit" className={BTN_PRIMARY} disabled={busy}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {initial ? "Save question" : "Add question"}
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
