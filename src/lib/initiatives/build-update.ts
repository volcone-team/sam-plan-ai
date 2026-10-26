/**
 * UpdateInitiativeDTO -> `initiatives` row patch.
 *
 * Pure, so the column rules are testable without Supabase. Every rule here
 * exists because a value that is valid in a form is not valid in Postgres:
 *
 *   - An unselected <select> is "". Sent to a UUID column that is a 22P02
 *     (`invalid input syntax for type uuid: ""`). A new-intake initiative has
 *     product_id NULL (migration 045), so the overview edit form sent
 *     product_id "" on every save, including a save that only changed a date.
 *   - product_id is NULLABLE (045): "" / null clears it.
 *   - initiative_type_id is NOT NULL (001, never relaxed): "" / null is
 *     skipped, never sent, so the existing type is kept.
 *   - activation_date (045) and event_date are nullable: "" / null clears.
 *   - The *_date_precision columns (045, NOT NULL, 'day' | 'month') are only
 *     written when the caller says so. A month-precision row keeps 'month'
 *     unless its date is edited with a day-precision input.
 */
import type { UpdateInitiativeDTO } from '@/types';
import { toDateOnly } from '@/lib/plan-dates';

type DateValue = Date | string | null | undefined;

/** "" / whitespace / null -> null; anything else is kept as given. */
function blankToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

/** A date for a nullable DATE column. Blank, null or unparseable -> null. */
function dateOrNull(value: DateValue): string | null {
  if (value === null || value === undefined || value === '') return null;
  const s = toDateOnly(value);
  return s === '' ? null : s;
}

function isPrecision(v: unknown): v is 'day' | 'month' {
  return v === 'day' || v === 'month';
}

export function buildInitiativeUpdate(dto: UpdateInitiativeDTO): Record<string, unknown> {
  const d = dto as UpdateInitiativeDTO & Record<string, unknown>;
  const row: Record<string, unknown> = {};

  if (d.name !== undefined) row.name = d.name;
  if (d.description !== undefined) row.description = d.description;
  if (d.status !== undefined) row.status = d.status;
  if (d.kind !== undefined) row.kind = d.kind;

  // NOT NULL uuid: only a real value is written.
  if (d.initiativeTypeId !== undefined) {
    const typeId = blankToNull(d.initiativeTypeId);
    if (typeId !== null) row.initiative_type_id = typeId;
  }
  // Nullable uuid: blank clears.
  if (d.productId !== undefined) row.product_id = blankToNull(d.productId);

  if (d.activationDate !== undefined) row.activation_date = dateOrNull(d.activationDate as DateValue);
  if (d.eventDate !== undefined) row.event_date = dateOrNull(d.eventDate as DateValue);
  if (isPrecision(d.activationDatePrecision)) row.activation_date_precision = d.activationDatePrecision;
  if (isPrecision(d.eventDatePrecision)) row.event_date_precision = d.eventDatePrecision;

  if (d.trafficInput !== undefined) row.traffic_input = d.trafficInput;
  if (d.plannedBudget !== undefined) row.planned_budget = d.plannedBudget;
  if (d.actualSpend !== undefined) row.actual_spend = d.actualSpend;
  if (d.revenueScenarios !== undefined) {
    row.revenue_good = d.revenueScenarios.good;
    row.revenue_better = d.revenueScenarios.better;
    row.revenue_best = d.revenueScenarios.best;
  }
  if (d.displayOrder !== undefined) row.display_order = d.displayOrder;

  return row;
}
