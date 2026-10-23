/**
 * Database reads shared by the recurring-instance routes. Server only.
 *
 * Every read here can meet a database without migration 046. Those errors are
 * returned as `{ kind: 'disabled' }` so the routes answer `{ enabled: false }`
 * instead of a 500; any other error is `{ kind: 'error' }`.
 *
 * The routes use the service role, so every query is scoped to the caller's
 * company here rather than by RLS.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { MaterialisedInstance } from './recurring';
import { isRecurringMigrationMissing } from './recurring-migration';
import { instanceFromDb, RECURRING_ROW_COLUMNS, rowFromDb, type RecurringRow } from './recurring-state';

export type Loaded<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'disabled' }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

export interface LoadedInitiative {
  row: RecurringRow;
  planYear: number;
}

type DbError = { code?: string | null; message?: string | null } | null;

function fail<T>(err: DbError, label: string): Loaded<T> {
  if (isRecurringMigrationMissing(err)) return { kind: 'disabled' };
  console.error(`[initiatives/recurring] ${label} failed:`, err?.message);
  return { kind: 'error', message: err?.message ?? 'unknown error' };
}

/** The initiative (this company's only) and the year of its plan. */
export async function loadRecurringInitiative(
  db: SupabaseClient,
  companyId: string,
  initiativeId: string
): Promise<Loaded<LoadedInitiative>> {
  const { data, error } = await db
    .from('initiatives')
    .select(RECURRING_ROW_COLUMNS)
    .eq('id', initiativeId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) return fail(error, 'initiative load');
  if (!data) return { kind: 'not-found' };
  const raw = data as unknown as Record<string, unknown>;

  const { data: plan, error: planErr } = await db
    .from('annual_plans')
    .select('year')
    .eq('id', raw.annual_plan_id as string)
    .eq('company_id', companyId)
    .maybeSingle();
  if (planErr) return fail(planErr, 'plan load');
  const year = Number(plan?.year);
  return {
    kind: 'ok',
    value: { row: rowFromDb(raw), planYear: Number.isInteger(year) ? year : new Date().getFullYear() },
  };
}

/** Every materialised run of the initiative. */
export async function loadInstances(
  db: SupabaseClient,
  companyId: string,
  initiativeId: string
): Promise<Loaded<MaterialisedInstance[]>> {
  const { data, error } = await db
    .from('initiative_instances')
    .select('id, instance_date, outcome, actual_revenue, updated_at')
    .eq('initiative_id', initiativeId)
    .eq('company_id', companyId)
    .order('instance_date', { ascending: true });
  if (error) return fail(error, 'instances load');
  return { kind: 'ok', value: (data ?? []).map((r) => instanceFromDb(r as Record<string, unknown>)) };
}

/**
 * The latest day an actual covers: the newest results row's week_end_date.
 * Any logged week counts, $0 included — the user said something about it.
 */
export async function loadLastActualDate(
  db: SupabaseClient,
  companyId: string,
  initiativeId: string
): Promise<Loaded<string | null>> {
  const { data, error } = await db
    .from('results')
    .select('week_end_date')
    .eq('initiative_id', initiativeId)
    .eq('company_id', companyId)
    .order('week_end_date', { ascending: false })
    .limit(1);
  if (error) return fail(error, 'results load');
  const d = data?.[0]?.week_end_date;
  return { kind: 'ok', value: typeof d === 'string' ? d : null };
}
