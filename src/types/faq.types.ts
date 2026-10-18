/**
 * FAQ domain types (migration 039).
 *
 * ADMIN types (`FaqCategory`, `FaqItem`) carry everything, drafts included, and
 * are only returned by `/api/admin/faq/**` (`requireAdmin`).
 *
 * PUBLIC types (`FaqPublicCategory`, `FaqPublicItem`) are what a customer's
 * browser receives. Built ONLY by `buildPublicFaq` in `@/lib/faq/faq`, which
 * drops drafts, unpublished categories and empty categories.
 *
 * No plan gating: every signed-in user sees the same published FAQ.
 * Answers are PLAIN TEXT; nothing is ever rendered as HTML or markdown.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

/** Matches the CHECK on faq_items.status. */
export const FAQ_STATUSES = ["draft", "published"] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];

/**
 * lucide-react icon names a category may use. Enforced in TypeScript, not SQL,
 * so adding one is a code change. An unknown value from the database reads as
 * `null`.
 */
export const FAQ_ICONS = [
  "Rocket",
  "CreditCard",
  "Layers",
  "ShieldCheck",
  "HelpCircle",
  "BookOpen",
  "Settings",
  "Users",
  "BarChart3",
  "Sparkles",
] as const;
export type FaqIcon = (typeof FAQ_ICONS)[number];

// ─── Database rows (snake_case) ──────────────────────────────────────────────

export interface FaqCategoryRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  display_order: number;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface FaqItemRow {
  id: string;
  slug: string;
  category_id: string;
  question: string;
  answer: string;
  status: FaqStatus;
  display_order: number;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

// ─── Admin types (camelCase) ─────────────────────────────────────────────────

export interface FaqCategory {
  id: string;
  slug: string;
  name: string;
  /** `null` when unset or not in FAQ_ICONS. */
  icon: FaqIcon | null;
  displayOrder: number;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FaqItem {
  id: string;
  slug: string;
  categoryId: string;
  question: string;
  /** Plain text; blank lines separate paragraphs. */
  answer: string;
  status: FaqStatus;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
}

// ─── Public view types ───────────────────────────────────────────────────────

export interface FaqPublicItem {
  id: string;
  question: string;
  answer: string;
}

export interface FaqPublicCategory {
  id: string;
  name: string;
  icon: FaqIcon | null;
  /** Never empty: categories with no published items are dropped. */
  items: FaqPublicItem[];
}

/** Body of `GET /api/faq`. */
export interface FaqPublicResponse {
  categories: FaqPublicCategory[];
}

// ─── Admin inputs ────────────────────────────────────────────────────────────

/** Validated admin input for a category. Slug is derived separately. */
export interface FaqCategoryInput {
  name: string;
  icon: FaqIcon | null;
  displayOrder: number;
  isPublished: boolean;
}

/** Validated admin input for an item. Slug is derived separately. */
export interface FaqItemInput {
  categoryId: string;
  question: string;
  answer: string;
  status: FaqStatus;
  displayOrder: number;
}

/** Result of the `normaliseFaq*Input` validators. `errors` is keyed by input field. */
export type FaqValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Partial<Record<keyof T, string>> };

/** One piece of an answer, for safe rendering. Links are validated http(s) only. */
export type FaqAnswerSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };
