/**
 * FAQ — pure row mapping, admin input validation, public view building,
 * client-side search and safe answer linkification.
 *
 * No database, no Next. `buildPublicFaq` is the ONLY place the customer view is
 * built, so it is the only place that decides what a customer can read:
 *
 *   A public item exists ONLY IF it is published AND its category is published.
 *
 * Answers are plain text. `linkifySegments` splits one into text and link
 * pieces so a renderer can show validated http(s) urls as anchors without ever
 * interpreting HTML.
 */
import { isUuid, normaliseExternalUrl } from "@/lib/university/access";
import {
  FAQ_ICONS,
  FAQ_STATUSES,
  type FaqAnswerSegment,
  type FaqCategory,
  type FaqCategoryInput,
  type FaqCategoryRow,
  type FaqIcon,
  type FaqItem,
  type FaqItemInput,
  type FaqItemRow,
  type FaqPublicCategory,
  type FaqStatus,
  type FaqValidationResult,
} from "@/types/faq.types";

// Re-exported so FAQ callers need not reach into the university module.
export { isUuid };

// ─── Limits (exported so admin forms can mirror them; match the SQL CHECKs) ──

export const FAQ_LIMITS = {
  categoryNameMax: 100,
  questionMax: 300,
  answerMax: 5000,
  displayOrderMax: 100000,
} as const;

// ─── Type guards ─────────────────────────────────────────────────────────────

export function isFaqIcon(value: unknown): value is FaqIcon {
  return typeof value === "string" && (FAQ_ICONS as readonly string[]).includes(value);
}

export function isFaqStatus(value: unknown): value is FaqStatus {
  return typeof value === "string" && (FAQ_STATUSES as readonly string[]).includes(value);
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

/** `faq_categories` row → admin type. An unknown icon reads as `null`. */
export function faqCategoryFromRow(row: FaqCategoryRow): FaqCategory {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    icon: isFaqIcon(row.icon) ? row.icon : null,
    displayOrder: row.display_order,
    isPublished: row.is_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `faq_items` row → admin type. */
export function faqItemFromRow(row: FaqItemRow): FaqItem {
  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.category_id,
    question: row.question,
    answer: row.answer,
    status: row.status,
    displayOrder: row.display_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

// ─── Public view ─────────────────────────────────────────────────────────────

const sortCategories = (a: FaqCategory, b: FaqCategory): number =>
  a.displayOrder - b.displayOrder || a.name.localeCompare(b.name);

const sortItems = (a: FaqItem, b: FaqItem): number =>
  a.displayOrder - b.displayOrder || a.question.localeCompare(b.question);

/**
 * The customer FAQ.
 *
 * - Unpublished categories are hidden.
 * - Drafts are dropped; categories left with no published items are hidden.
 * - Categories sort by displayOrder then name; items by displayOrder then question.
 * - Only id, question and answer leave the server for an item.
 */
export function buildPublicFaq(
  categories: readonly FaqCategory[],
  items: readonly FaqItem[]
): FaqPublicCategory[] {
  const byCategory = new Map<string, FaqItem[]>();
  for (const item of items) {
    if (item.status !== "published") continue;
    const list = byCategory.get(item.categoryId);
    if (list) list.push(item);
    else byCategory.set(item.categoryId, [item]);
  }

  const out: FaqPublicCategory[] = [];
  for (const category of [...categories].sort(sortCategories)) {
    if (!category.isPublished) continue;
    const visible = (byCategory.get(category.id) ?? []).slice().sort(sortItems);
    if (visible.length === 0) continue;
    out.push({
      id: category.id,
      name: category.name,
      icon: category.icon,
      items: visible.map((i) => ({ id: i.id, question: i.question, answer: i.answer })),
    });
  }
  return out;
}

/**
 * Client-side search over the public FAQ. Every whitespace-separated term must
 * appear (case-insensitive) in the question or the answer. A blank query
 * returns the input unchanged. Categories with no matches are dropped.
 */
export function filterFaq(
  categories: readonly FaqPublicCategory[],
  query: string
): FaqPublicCategory[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...categories];
  const out: FaqPublicCategory[] = [];
  for (const c of categories) {
    const items = c.items.filter((i) => {
      const hay = `${i.question}\n${i.answer}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    if (items.length > 0) out.push({ ...c, items });
  }
  return out;
}

/** Total items across categories. */
export function countFaqItems(categories: readonly FaqPublicCategory[]): number {
  return categories.reduce((n, c) => n + c.items.length, 0);
}

// ─── Answer linkification ────────────────────────────────────────────────────

/** Candidate urls: an explicit http:// or https:// up to whitespace or a quote/angle. */
const URL_CANDIDATE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?'"\]}>]$/;

/** Drop sentence punctuation (and an unbalanced closing paren) from the end. */
function trimUrlTail(candidate: string): string {
  let s = candidate;
  for (;;) {
    if (TRAILING_PUNCTUATION.test(s)) {
      s = s.slice(0, -1);
      continue;
    }
    if (s.endsWith(")")) {
      const open = (s.match(/\(/g) ?? []).length;
      const close = (s.match(/\)/g) ?? []).length;
      if (close > open) {
        s = s.slice(0, -1);
        continue;
      }
    }
    return s;
  }
}

/**
 * Split plain text into text and link segments.
 *
 * Guarantees:
 * - Joining every segment's `value` gives back `text` exactly.
 * - A `link` segment's `href` is a validated http: or https: url with a host
 *   and no credentials (`normaliseExternalUrl`). Nothing else is ever a link.
 * - Adjacent text is merged; empty segments are never produced.
 */
export function linkifySegments(text: string): FaqAnswerSegment[] {
  const out: FaqAnswerSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.type === "text") last.value += value;
    else out.push({ type: "text", value });
  };

  let cursor = 0;
  for (const match of text.matchAll(URL_CANDIDATE)) {
    const start = match.index ?? 0;
    const candidate = trimUrlTail(match[0]);
    const href = candidate ? normaliseExternalUrl(candidate) : null;
    if (!href) continue; // stays part of the surrounding text
    pushText(text.slice(cursor, start));
    out.push({ type: "link", value: candidate, href });
    cursor = start + candidate.length;
  }
  pushText(text.slice(cursor));
  return out;
}

// ─── Admin input validation ──────────────────────────────────────────────────

type Raw = Record<string, unknown>;

function asObject(raw: unknown): Raw {
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Raw) : {};
}

/** Integer in [min, max], or null when absent. `undefined` = invalid. */
function optionalInt(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) return undefined;
  return n;
}

/** Control characters other than tab and newline. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Normalise an answer: CRLF/CR → LF, strip control characters, trim the ends.
 * Internal blank lines (paragraphs) are kept.
 */
export function normaliseAnswerText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "").trim();
}

/** A question is one line: any run of whitespace (newlines included) becomes one space. */
function normaliseQuestionText(value: string): string {
  return value.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
}

/**
 * Validate admin input for a category.
 *
 * Accepted keys: name, icon, displayOrder, isPublished. A blank icon is `null`;
 * any other value must be in FAQ_ICONS. `isPublished` defaults to true.
 */
export function normaliseFaqCategoryInput(raw: unknown): FaqValidationResult<FaqCategoryInput> {
  const r = asObject(raw);
  const errors: Partial<Record<keyof FaqCategoryInput, string>> = {};

  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (name.length < 1) errors.name = "Name is required.";
  else if (name.length > FAQ_LIMITS.categoryNameMax)
    errors.name = `Name must be ${FAQ_LIMITS.categoryNameMax} characters or fewer.`;

  let icon: FaqIcon | null = null;
  if (r.icon !== undefined && r.icon !== null) {
    const iconText = typeof r.icon === "string" ? r.icon.trim() : null;
    if (iconText === null || (iconText !== "" && !isFaqIcon(iconText)))
      errors.icon = `Icon must be one of: ${FAQ_ICONS.join(", ")}.`;
    else if (iconText !== "") icon = iconText as FaqIcon;
  }

  const displayOrder = optionalInt(r.displayOrder, 0, FAQ_LIMITS.displayOrderMax);
  if (displayOrder === undefined)
    errors.displayOrder = `Display order must be a whole number from 0 to ${FAQ_LIMITS.displayOrderMax}.`;

  let isPublished = true;
  if (r.isPublished !== undefined && r.isPublished !== null) {
    if (typeof r.isPublished !== "boolean") errors.isPublished = "isPublished must be true or false.";
    else isPublished = r.isPublished;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, icon, displayOrder: displayOrder ?? 0, isPublished } };
}

/**
 * Validate admin input for an item.
 *
 * Accepted keys: categoryId, question, answer, status, displayOrder.
 * Question: one line, 1–300 chars. Answer: plain text, 1–5000 chars after
 * normalisation (line breaks kept). Status defaults to `draft` when absent.
 */
export function normaliseFaqItemInput(raw: unknown): FaqValidationResult<FaqItemInput> {
  const r = asObject(raw);
  const errors: Partial<Record<keyof FaqItemInput, string>> = {};

  const categoryId = typeof r.categoryId === "string" ? r.categoryId.trim().toLowerCase() : "";
  if (!isUuid(categoryId)) errors.categoryId = "Choose a category.";

  const question = typeof r.question === "string" ? normaliseQuestionText(r.question) : "";
  if (question.length < 1) errors.question = "Question is required.";
  else if (question.length > FAQ_LIMITS.questionMax)
    errors.question = `Question must be ${FAQ_LIMITS.questionMax} characters or fewer.`;

  const answer = typeof r.answer === "string" ? normaliseAnswerText(r.answer) : "";
  if (answer.length < 1) errors.answer = "Answer is required.";
  else if (answer.length > FAQ_LIMITS.answerMax)
    errors.answer = `Answer must be ${FAQ_LIMITS.answerMax} characters or fewer.`;

  let status: FaqStatus = "draft";
  if (r.status !== undefined && r.status !== null) {
    const s = typeof r.status === "string" ? r.status.trim() : r.status;
    if (!isFaqStatus(s)) errors.status = `Status must be one of: ${FAQ_STATUSES.join(", ")}.`;
    else status = s;
  }

  const displayOrder = optionalInt(r.displayOrder, 0, FAQ_LIMITS.displayOrderMax);
  if (displayOrder === undefined)
    errors.displayOrder = `Display order must be a whole number from 0 to ${FAQ_LIMITS.displayOrderMax}.`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { categoryId, question, answer, status, displayOrder: displayOrder ?? 0 },
  };
}
