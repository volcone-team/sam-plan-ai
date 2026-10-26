/**
 * Server-side get-or-create for `annual_plans`, one row per (company, year).
 *
 * Moved out of intake build so POST /api/initiatives files a new initiative
 * under the plan for ITS launch year with the same rule. Callers pass a
 * service-role client, so the company scoping here is the only scoping:
 * every query filters on `company_id`.
 *
 * `UNIQUE(company_id, year)` (migration 001) makes a concurrent create safe:
 * the loser's insert fails with 23505 and it re-reads the winner's row.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type AnnualPlanStatus = 'draft' | 'active' | 'archived';

export interface AnnualPlanRef {
  id: string;
  year: number;
  /** True when this call inserted the row. */
  created: boolean;
}

/** The company's plan row for `year`, or null when there is none (or the read failed). */
export async function findAnnualPlan(
  db: SupabaseClient,
  companyId: string,
  year: number
): Promise<{ id: string; year: number } | null> {
  const { data } = await db
    .from('annual_plans')
    .select('id, year')
    .eq('company_id', companyId)
    .eq('year', year)
    .maybeSingle();
  return data?.id ? { id: data.id as string, year } : null;
}

/**
 * The company's plan row for `year`, inserted with `init` when absent.
 *
 * `init` applies ONLY to a row this call creates; an existing row is returned
 * untouched, so its targets and status are never overwritten here.
 */
export async function getOrCreateAnnualPlan(
  db: SupabaseClient,
  companyId: string,
  year: number,
  init: { status: AnnualPlanStatus; baselineRevenue?: number; stretchRevenue?: number },
  logLabel = '[annual-plans]'
): Promise<AnnualPlanRef | null> {
  if (!Number.isInteger(year)) return null;

  const existing = await findAnnualPlan(db, companyId, year);
  if (existing) return { ...existing, created: false };

  const { data: created, error } = await db
    .from('annual_plans')
    .insert({
      company_id: companyId,
      year,
      status: init.status,
      baseline_revenue: init.baselineRevenue ?? 0,
      stretch_revenue: init.stretchRevenue ?? 0,
    })
    .select('id')
    .single();

  if (error) {
    // Someone else created it between our read and insert.
    if (error.code === '23505') {
      const raced = await findAnnualPlan(db, companyId, year);
      if (raced) return { ...raced, created: false };
    }
    console.error(logLabel, 'annual plan insert failed:', error.message);
    return null;
  }

  return created?.id ? { id: created.id as string, year, created: true } : null;
}
