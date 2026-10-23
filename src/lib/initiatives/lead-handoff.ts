/**
 * Lead handoff: a leads-path initiative collects leads and hands them to the
 * initiative that converts them. The receiving initiative books the revenue;
 * the lead-gen one runs at $0, so nothing is counted twice.
 *
 * STORED IN attrs, NOT A COLUMN: `initiatives.attrs.lead_handoff_to` holds the
 * receiving initiative's id. There is no foreign key, so a deleted receiver
 * leaves a dangling id behind until the delete cleanup clears it; every reader
 * here treats an id that does not resolve as blank.
 *
 * PURE. No React, no database, no network.
 */

import { formatDate } from '@/lib/format-date';
import { parseDateOnly } from '@/lib/plan-dates';
import { launchDate, type ScheduleFields } from './schedule';

/** attrs key holding the receiving initiative's id. */
export const LEAD_HANDOFF_ATTR = 'lead_handoff_to';

/** attrs key holding the lead-count goal on the leads path. */
export const LEAD_GOAL_ATTR = 'lead_goal';

/** The warning for a lead-gen initiative with nowhere to send its leads. */
export const NO_HANDOFF_WARNING = 'No initiative is set to convert these leads. It will run at $0 revenue.';

/** The fields these helpers read. A full Initiative satisfies it. */
export interface HandoffInitiative extends ScheduleFields {
  id: string;
  name: string;
  annualPlanId?: string | null;
  conversionPath?: string | null;
  attrs?: Readonly<Record<string, unknown>> | null;
}

/** For the "Where do these leads go?" select. */
export interface HandoffOption {
  id: string;
  label: string;
}

/** The raw id in attrs, or null when absent or not a non-empty string. */
export function readHandoffId(attrs: Readonly<Record<string, unknown>> | null | undefined): string | null {
  const v = attrs?.[LEAD_HANDOFF_ATTR];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** Does this initiative collect leads (the leads conversion path)? */
export function isLeadGen(i: Pick<HandoffInitiative, 'conversionPath'>): boolean {
  return i.conversionPath === 'leads';
}

/**
 * The initiative this one hands its leads to, or null.
 *
 * Null when unset, when the id is dangling (not among `all`, e.g. deleted),
 * or when it points at itself. `all` is the company's initiatives as loaded,
 * so an id from another company cannot resolve either.
 */
export function resolveHandoff<T extends HandoffInitiative>(
  leadGen: Pick<HandoffInitiative, 'id' | 'attrs'>,
  all: readonly T[]
): T | null {
  const id = readHandoffId(leadGen.attrs);
  if (id === null || id === leadGen.id) return null;
  return all.find((i) => i.id === id) ?? null;
}

/** The initiatives whose leads go to `receiving`. */
export function leadSources<T extends HandoffInitiative>(
  receiving: Pick<HandoffInitiative, 'id'>,
  all: readonly T[]
): T[] {
  return all.filter((i) => i.id !== receiving.id && readHandoffId(i.attrs) === receiving.id);
}

/** "Name (MM/DD/YYYY)", "Name (MM/YYYY)" for a month-only start, or "Name (no date)". */
export function handoffLabel(i: Pick<HandoffInitiative, 'name'> & ScheduleFields): string {
  const launch = launchDate(i);
  if (launch === null) return `${i.name} (no date)`;
  const date =
    i.activationDatePrecision === 'month' || (!i.activationDate && i.eventDatePrecision === 'month')
      ? `${launch.slice(5, 7)}/${launch.slice(0, 4)}`
      : formatDate(parseDateOnly(launch));
  return `${i.name} (${date})`;
}

/**
 * What a lead-gen initiative may hand its leads to: the company's other
 * initiatives in the same plan, never itself. Earliest start first; undated
 * last, then by name.
 */
export function handoffOptions(
  all: readonly HandoffInitiative[],
  self: { id?: string | null; annualPlanId: string }
): HandoffOption[] {
  return all
    .filter((i) => i.id !== self.id && i.annualPlanId === self.annualPlanId)
    .map((i) => ({ i, launch: launchDate(i) }))
    .sort((a, b) => {
      if (a.launch !== b.launch) {
        if (a.launch === null) return 1;
        if (b.launch === null) return -1;
        return a.launch < b.launch ? -1 : 1;
      }
      return a.i.name.localeCompare(b.i.name);
    })
    .map(({ i }) => ({ id: i.id, label: handoffLabel(i) }));
}

/**
 * Warnings about a handoff. Never blocking.
 *
 *   receiving null           -> NO_HANDOFF_WARNING
 *   receiving starts earlier -> "The leads won't exist yet — ..."
 *
 * Dates compare by launchDate; either side undated says nothing about order.
 */
export function handoffWarnings(
  leadGen: Pick<HandoffInitiative, 'name'> & ScheduleFields,
  receiving: (Pick<HandoffInitiative, 'name'> & ScheduleFields) | null
): string[] {
  if (receiving === null) return [NO_HANDOFF_WARNING];
  const from = launchDate(leadGen);
  const to = launchDate(receiving);
  if (from !== null && to !== null && to < from) {
    return [`The leads won't exist yet — ${receiving.name} starts before ${leadGen.name}.`];
  }
  return [];
}

/**
 * attrs with the handoff set to `id`, or removed when `id` is null. A new
 * object; the input is not changed.
 */
export function withHandoff(
  attrs: Readonly<Record<string, unknown>> | null | undefined,
  id: string | null
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(attrs ?? {}) };
  if (id === null) delete next[LEAD_HANDOFF_ATTR];
  else next[LEAD_HANDOFF_ATTR] = id;
  return next;
}

/**
 * The delete cleanup's pure part: for each row whose handoff points at the
 * deleted initiative, the attrs to write back (handoff removed). Rows that do
 * not point at it are left out.
 */
export function handoffCleanup(
  rows: ReadonlyArray<{ id: string; attrs: unknown }>,
  deletedId: string
): Array<{ id: string; attrs: Record<string, unknown> }> {
  const out: Array<{ id: string; attrs: Record<string, unknown> }> = [];
  for (const row of rows) {
    if (row.id === deletedId) continue;
    const attrs =
      typeof row.attrs === 'object' && row.attrs !== null && !Array.isArray(row.attrs)
        ? (row.attrs as Record<string, unknown>)
        : null;
    if (readHandoffId(attrs) !== deletedId) continue;
    out.push({ id: row.id, attrs: withHandoff(attrs, null) });
  }
  return out;
}

/**
 * The PATCH /api/initiatives/[id]/handoff body: `{ handoffTo: string | null }`.
 * Null (or blank) clears it. The id's shape and ownership are the route's.
 */
export function parseHandoffPatch(
  body: unknown
): { ok: true; handoffTo: string | null } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null || Array.isArray(body) || !('handoffTo' in body)) {
    return { ok: false, error: 'Say where the leads go, or null for nowhere.' };
  }
  const v = (body as { handoffTo: unknown }).handoffTo;
  if (v === null) return { ok: true, handoffTo: null };
  if (typeof v !== 'string') return { ok: false, error: 'Invalid initiative.' };
  const t = v.trim();
  return { ok: true, handoffTo: t === '' ? null : t };
}
