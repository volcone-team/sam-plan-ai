/**
 * Request parsing for the recurring-instance routes:
 *
 *   POST /api/initiatives/[id]/instances  { instanceDate, outcome, actualRevenue? }
 *   POST /api/initiatives/[id]/correction { action }
 *
 * Pure: no database, no Next. The routes call these before touching anything,
 * so a malformed body is a 400 and never reaches Postgres.
 */
import type { CorrectionAction, InstanceOutcome } from './recurring';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** NUMERIC(12,2): ten integer digits. */
const MAX_REVENUE = 9_999_999_999.99;

export const INSTANCE_OUTCOMES: readonly InstanceOutcome[] = Object.freeze(['ran', 'skipped', 'not-yet']);
export const CORRECTION_ACTIONS: readonly CorrectionAction[] = Object.freeze([
  'change-frequency',
  'pause',
  'retire',
  'keep',
]);

/** A route `[id]` segment that can be an initiative id. Anything else is a 404, not a Postgres cast error. */
export function isInitiativeId(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

/** A real calendar day written as `YYYY-MM-DD`, or null. */
export function parseCalendarDay(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = DATE_ONLY.exec(v);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return null;
  return v;
}

export interface InstanceRequest {
  instanceDate: string;
  outcome: InstanceOutcome;
  /**
   * Absent: leave whatever is stored alone. null: clear it (unknown, not $0).
   * A number: whole cents, 0 or more.
   */
  actualRevenue?: number | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseInstanceRequest(body: unknown): Parsed<InstanceRequest> {
  if (!isRecord(body)) return { ok: false, error: 'Invalid request body.' };

  const instanceDate = parseCalendarDay(body.instanceDate);
  if (!instanceDate) return { ok: false, error: 'instanceDate must be a calendar day (YYYY-MM-DD).' };

  const outcome = body.outcome;
  if (typeof outcome !== 'string' || !(INSTANCE_OUTCOMES as readonly string[]).includes(outcome)) {
    return { ok: false, error: "outcome must be 'ran', 'skipped' or 'not-yet'." };
  }

  const value: InstanceRequest = { instanceDate, outcome: outcome as InstanceOutcome };

  if ('actualRevenue' in body && body.actualRevenue !== undefined) {
    const raw = body.actualRevenue;
    if (raw === null) {
      value.actualRevenue = null;
    } else if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= MAX_REVENUE) {
      value.actualRevenue = Math.round(raw * 100) / 100;
    } else {
      return { ok: false, error: 'actualRevenue must be a number of 0 or more, or null.' };
    }
  }

  return { ok: true, value };
}

export function parseCorrectionRequest(body: unknown): Parsed<{ action: CorrectionAction }> {
  if (!isRecord(body)) return { ok: false, error: 'Invalid request body.' };
  const action = body.action;
  if (typeof action !== 'string' || !(CORRECTION_ACTIONS as readonly string[]).includes(action)) {
    return { ok: false, error: "action must be 'change-frequency', 'pause', 'retire' or 'keep'." };
  }
  return { ok: true, value: { action: action as CorrectionAction } };
}
