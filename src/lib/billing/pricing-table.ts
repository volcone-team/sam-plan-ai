/**
 * The plan comparison table (migration 050): pure model, maths and admin input
 * validation. No I/O — the loader is load-pricing-table.ts, the admin writes
 * are /api/admin/pricing-table.
 *
 * MONEY IS INTEGER CENTS throughout, unlike subscription_plans.monthly_price
 * (NUMERIC dollars). These are display figures summed into column totals, and
 * integer cents keep the sums exact.
 *
 * CELL SEMANTICS (one cell per row × plan, pricing_row_plans):
 *   no cell, or included = false      → "excluded" (the value is ignored)
 *   included, value_cents null        → "included" (a tick)
 *   included, value_cents set         → "value" (that figure instead of a tick)
 *
 * TOTALS: a plan's section total is the sum, over the rows that plan includes,
 * of the cell's own figure if it has one, else the row's figure, else 0.
 */

export const PRICING_SECTIONS = ["included", "bonus"] as const;
export type PricingSection = (typeof PRICING_SECTIONS)[number];

export type BillingCycle = "monthly" | "annual";

/** A pricing_rows row, as read. */
export interface PricingRowRecord {
  id: string;
  section: PricingSection;
  label: string;
  sublabel: string | null;
  /** The row-level "Value" figure. Null = none. */
  value_cents: number | null;
  display_order: number;
  is_active: boolean;
}

/** A pricing_row_plans row, as read. */
export interface PricingCellRecord {
  row_id: string;
  plan_id: string;
  included: boolean;
  value_cents: number | null;
}

/** The subscription_plans fields the table needs. */
export interface PricingPlanRecord {
  id: string;
  name: string;
  /** Dollars (NUMERIC in the database), as everywhere else in billing. */
  monthly_price: number;
  annual_price: number;
  compare_at_monthly_cents: number | null;
  price_label: string | null;
  display_order?: number;
}

export type PricingCellState = "included" | "excluded" | "value";

export interface PricingCell {
  state: PricingCellState;
  /** Set only for state "value": the figure shown in the plan's column. */
  valueCents: number | null;
}

export interface PricingTableRow {
  id: string;
  label: string;
  sublabel: string | null;
  valueCents: number | null;
  displayOrder: number;
  /** Keyed by plan id. Every plan passed to buildPricingTable has an entry. */
  cells: Record<string, PricingCell>;
}

export interface PricingTableSection {
  section: PricingSection;
  rows: PricingTableRow[];
}

export interface PricingTable {
  plans: PricingPlanRecord[];
  /** Always both sections, in PRICING_SECTIONS order (a section may be empty). */
  sections: PricingTableSection[];
}

/** One cell's display state. Exported for the admin editor's cell control. */
export function cellFor(cell: PricingCellRecord | undefined): PricingCell {
  if (!cell || !cell.included) return { state: "excluded", valueCents: null };
  if (cell.value_cents != null) return { state: "value", valueCents: cell.value_cents };
  return { state: "included", valueCents: null };
}

function byOrder(a: { display_order: number; label: string }, b: { display_order: number; label: string }) {
  return a.display_order - b.display_order || a.label.localeCompare(b.label);
}

/**
 * Assemble the table. Inactive rows are dropped; rows are ordered by
 * display_order (label as tie-break); plans by display_order when present,
 * otherwise in the order given. Cells for plans not passed in are ignored.
 */
export function buildPricingTable(
  rows: readonly PricingRowRecord[],
  cells: readonly PricingCellRecord[],
  plans: readonly PricingPlanRecord[]
): PricingTable {
  const orderedPlans = plans
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (a.p.display_order ?? a.i) - (b.p.display_order ?? b.i) || a.i - b.i)
    .map(({ p }) => p);

  const cellIndex = new Map<string, PricingCellRecord>();
  for (const c of cells) cellIndex.set(`${c.row_id}|${c.plan_id}`, c);

  const sections = PRICING_SECTIONS.map((section) => ({
    section,
    rows: rows
      .filter((r) => r.is_active && r.section === section)
      .slice()
      .sort(byOrder)
      .map((r) => {
        const rowCells: Record<string, PricingCell> = {};
        for (const p of orderedPlans) rowCells[p.id] = cellFor(cellIndex.get(`${r.id}|${p.id}`));
        return {
          id: r.id,
          label: r.label,
          sublabel: r.sublabel,
          valueCents: r.value_cents,
          displayOrder: r.display_order,
          cells: rowCells,
        };
      }),
  }));

  return { plans: orderedPlans, sections };
}

/**
 * A plan's total for one section: over the rows it includes, the cell's own
 * figure, else the row's figure, else 0.
 */
export function sectionTotal(section: PricingTableSection, planId: string): number {
  let total = 0;
  for (const row of section.rows) {
    const cell = row.cells[planId];
    if (!cell || cell.state === "excluded") continue;
    total += cell.valueCents ?? row.valueCents ?? 0;
  }
  return total;
}

/**
 * The crossed-out price for a cycle, in cents, or null when the plan has none.
 * Annual is the monthly figure × 12 ("what twelve months would cost").
 */
export function compareAt(
  plan: Pick<PricingPlanRecord, "compare_at_monthly_cents">,
  cycle: BillingCycle
): number | null {
  const monthly = plan.compare_at_monthly_cents;
  if (monthly == null) return null;
  return cycle === "annual" ? monthly * 12 : monthly;
}

/* ───────────────────────── Admin input validation ───────────────────────── */

export const LABEL_MAX = 200;
export const SUBLABEL_MAX = 300;
export const PRICE_LABEL_MAX = 60;
export const ANNUAL_NOTE_MAX = 300;
/** 100,000,000 dollars. Far above any real figure; catches a typo'd zero run. */
export const MAX_CENTS = 10_000_000_000;

export type FieldErrors = Record<string, string>;
export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

/**
 * Optional integer cents: null/undefined/"" → null. Anything else must be a
 * whole number from 0 to MAX_CENTS. Returns undefined plus an error otherwise.
 */
export function parseOptionalCents(
  raw: unknown,
  field: string,
  errors: FieldErrors
): number | null | undefined {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_CENTS) {
    errors[field] = "Must be a whole number of cents from 0 to 10,000,000,000.";
    return undefined;
  }
  return n;
}

/**
 * Dollars as typed in the admin form ("497", "1,200", "4.5") → integer cents,
 * or null for a blank field. NaN for anything that is not a number, which the
 * server validators then reject.
 */
export function dollarsToCents(input: string): number | null {
  const s = input.replace(/[,\s]/g, "").replace(/^\$/, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/** Cents → the plain dollar string the admin form edits ("497", "4.50"). */
export function centsToDollarsInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

function optionalText(
  raw: unknown,
  field: string,
  max: number,
  errors: FieldErrors
): string | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    errors[field] = "Must be text.";
    return undefined;
  }
  const t = raw.trim();
  if (t.length > max) {
    errors[field] = `At most ${max} characters.`;
    return undefined;
  }
  return t === "" ? null : t;
}

export interface PricingRowInput {
  section: PricingSection;
  label: string;
  sublabel: string | null;
  valueCents: number | null;
  isActive: boolean;
}

/**
 * A row as the admin submits it: { section, label, sublabel?, valueCents?,
 * isActive? }. Label required (trimmed, ≤ 200), sublabel ≤ 300 (blank → null),
 * valueCents optional integer cents, section from PRICING_SECTIONS.
 */
export function validatePricingRowInput(body: unknown): Validated<PricingRowInput> {
  const errors: FieldErrors = {};
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const section = b.section;
  if (typeof section !== "string" || !(PRICING_SECTIONS as readonly string[]).includes(section)) {
    errors.section = "Must be included or bonus.";
  }

  let label = "";
  if (typeof b.label !== "string" || b.label.trim() === "") {
    errors.label = "Required.";
  } else if (b.label.trim().length > LABEL_MAX) {
    errors.label = `At most ${LABEL_MAX} characters.`;
  } else {
    label = b.label.trim();
  }

  const sublabel = optionalText(b.sublabel, "sublabel", SUBLABEL_MAX, errors);
  const valueCents = parseOptionalCents(b.valueCents, "valueCents", errors);

  let isActive = true;
  if (b.isActive !== undefined) {
    if (typeof b.isActive !== "boolean") errors.isActive = "Must be true or false.";
    else isActive = b.isActive;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      section: section as PricingSection,
      label,
      sublabel: sublabel ?? null,
      valueCents: valueCents ?? null,
      isActive,
    },
  };
}

export interface PricingCellInput {
  rowId: string;
  planId: string;
  state: PricingCellState;
  /** Required (non-null) for "value", always null otherwise. */
  valueCents: number | null;
}

/** Map a cell input to the pricing_row_plans columns it stores. */
export function cellInputToRecord(input: PricingCellInput): PricingCellRecord {
  return {
    row_id: input.rowId,
    plan_id: input.planId,
    included: input.state !== "excluded",
    value_cents: input.state === "value" ? input.valueCents : null,
  };
}

export function validatePricingCellInput(body: unknown): Validated<PricingCellInput> {
  const errors: FieldErrors = {};
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.rowId !== "string" || b.rowId === "") errors.rowId = "Required.";
  if (typeof b.planId !== "string" || b.planId === "") errors.planId = "Required.";
  const state = b.state;
  if (state !== "included" && state !== "excluded" && state !== "value") {
    errors.state = "Must be included, excluded or value.";
  }
  let valueCents: number | null = null;
  if (state === "value") {
    const v = parseOptionalCents(b.valueCents, "valueCents", errors);
    if (v === null) errors.valueCents = "Enter the figure to show.";
    else if (v !== undefined) valueCents = v;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { rowId: b.rowId as string, planId: b.planId as string, state: state as PricingCellState, valueCents },
  };
}

export interface PricingPlanExtrasInput {
  planId: string;
  /** Only the fields present in the body; undefined = leave unchanged. */
  priceLabel?: string | null;
  compareAtMonthlyCents?: number | null;
}

export function validatePlanExtrasInput(body: unknown): Validated<PricingPlanExtrasInput> {
  const errors: FieldErrors = {};
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.planId !== "string" || b.planId === "") errors.planId = "Required.";
  const value: PricingPlanExtrasInput = { planId: (b.planId as string) ?? "" };
  if ("priceLabel" in b) {
    const t = optionalText(b.priceLabel, "priceLabel", PRICE_LABEL_MAX, errors);
    if (t !== undefined) value.priceLabel = t;
  }
  if ("compareAtMonthlyCents" in b) {
    const c = parseOptionalCents(b.compareAtMonthlyCents, "compareAtMonthlyCents", errors);
    if (c !== undefined) value.compareAtMonthlyCents = c;
  }
  if (!("priceLabel" in b) && !("compareAtMonthlyCents" in b)) {
    errors.body = "Nothing to update.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

export interface AnnualNoteInput {
  text?: string | null;
  valueCents?: number | null;
}

export function validateAnnualNoteInput(body: unknown): Validated<AnnualNoteInput> {
  const errors: FieldErrors = {};
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const value: AnnualNoteInput = {};
  if ("text" in b) {
    const t = optionalText(b.text, "text", ANNUAL_NOTE_MAX, errors);
    if (t !== undefined) value.text = t;
  }
  if ("valueCents" in b) {
    const c = parseOptionalCents(b.valueCents, "valueCents", errors);
    if (c !== undefined) value.valueCents = c;
  }
  if (!("text" in b) && !("valueCents" in b)) errors.body = "Nothing to update.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value };
}

/**
 * The display orders to write after moving one row up or down within its
 * section: the section's rows renumbered 10, 20, 30… in the new order.
 * Returns null when the move is impossible (unknown row, already at the edge).
 */
export function reorderAfterMove(
  rows: readonly Pick<PricingRowRecord, "id" | "section" | "display_order" | "label">[],
  rowId: string,
  direction: "up" | "down"
): { id: string; display_order: number }[] | null {
  const target = rows.find((r) => r.id === rowId);
  if (!target) return null;
  const list = rows.filter((r) => r.section === target.section).slice().sort(byOrder);
  const i = list.findIndex((r) => r.id === rowId);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return null;
  [list[i], list[j]] = [list[j], list[i]];
  return list.map((r, k) => ({ id: r.id, display_order: (k + 1) * 10 }));
}
