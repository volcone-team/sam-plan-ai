/**
 * Initiative Service
 * Manages initiatives (one-time, recurring, evergreen).
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type {
  Initiative,
  UpdateInitiativeDTO,
  InitiativeStatus,
  InitiativeKind,
} from '@/types';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';
import { toDateOnly, parseDateOnly } from '@/lib/plan-dates';
import { readMetricSet } from '@/lib/metrics/metric-set';
import { overlapsPeriod } from '@/lib/initiatives/schedule';
import { isRepeatFrequency } from '@/lib/intake-forecast';

/** repeat_frequency column, else attrs.repeat_frequency; null when neither is a known slug. */
function readRepeatFrequency(row: Record<string, unknown>): string | null {
  if (isRepeatFrequency(row.repeat_frequency)) return row.repeat_frequency;
  const attrs = row.attrs;
  if (typeof attrs === 'object' && attrs !== null && !Array.isArray(attrs)) {
    const value = (attrs as Record<string, unknown>).repeat_frequency;
    if (isRepeatFrequency(value)) return value;
  }
  return null;
}
import { LEAD_HANDOFF_ATTR, handoffCleanup } from '@/lib/initiatives/lead-handoff';
import { buildInitiativeUpdate } from '@/lib/initiatives/build-update';
import { initiativeFrequencyFallback, isCheckViolation } from '@/lib/initiatives/frequency-fallback';

export class InitiativeService {
  /**
   * Get all initiatives for a company
   */
  async getInitiativesByCompany(companyId: string): Promise<Initiative[]> {
    if (!companyId) {
      console.log("[initiative] getInitiativesByCompany - no companyId, returning []");
      return [];
    }
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiatives')
          .select('*')
          .eq('company_id', companyId)
          .order('display_order', { ascending: true });

        if (error) console.error("[Supabase initiatives]", (error as any).message, "|details:", (error as any).details, "|hint:", (error as any).hint, "|code:", (error as any).code);

        if (!error && data) {
          return data.map(row => this.mapRowToInitiative(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    console.log("[initiative] No data, returning []"); return [];
  }

  /**
   * Get a specific initiative
   */
  /**
   * One initiative by id.
   *
   * THROWS A MESSAGE THAT SAYS WHAT HAPPENED. This used to swallow the real
   * Supabase error — logging it to the console and then throwing a bare
   * "Not found" — so three different situations arrived at the UI
   * indistinguishable:
   *
   *   - the initiative does not exist;
   *   - it exists but belongs to another company, so RLS hides it
   *     (`initiatives` SELECT is scoped to `get_user_company_id()`);
   *   - the query itself failed.
   *
   * The second is the common one in practice and the most confusing, because
   * the row is plainly there in the database when an operator goes looking.
   * Naming it costs nothing and saves the next person a round of probing.
   *
   * Still throws rather than returning null: all three callers are written
   * around a throw, and changing that contract here would silently turn their
   * error paths into "render nothing".
   */
  async getInitiative(id: string): Promise<Initiative> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiatives')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (error) {
          console.error("[Supabase initiatives]", (error as any).message, "|details:", (error as any).details, "|hint:", (error as any).hint, "|code:", (error as any).code);
          throw new Error(
            `Could not load this initiative: ${(error as any).message || 'the lookup failed'}`
          );
        }

        if (data) return this.mapRowToInitiative(data);

        /**
         * `maybeSingle` rather than `single`, so zero rows is a null instead of
         * an error — which is what lets this case be reported honestly.
         *
         * Zero rows means EITHER no such initiative OR one this account cannot
         * see. The client cannot tell the difference and must not guess: saying
         * "it does not exist" to someone looking at the right id on the wrong
         * account sends them hunting for a data bug that is not there.
         */
        throw new Error(
          "This initiative could not be found on your account. It may belong " +
          "to a different company, or it may have been removed."
        );
      } catch (e) {
        // Re-thrown as-is: the messages above are already the useful ones, and
        // wrapping them again would bury what went wrong.
        if (e instanceof Error) throw e;
        throw new Error(String(e));
      }
    }

    throw new Error("Initiatives are unavailable because the database is not configured.");
  }

  /**
   * Get initiatives by status
   */
  async getInitiativesByStatus(companyId: string, status: InitiativeStatus): Promise<Initiative[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiatives')
          .select('*')
          .eq('company_id', companyId)
          .eq('status', status)
          .order('display_order', { ascending: true });

        if (error) console.error("[Supabase initiatives]", (error as any).message, "|details:", (error as any).details, "|hint:", (error as any).hint, "|code:", (error as any).code);

        if (!error && data) {
          return data.map(row => this.mapRowToInitiative(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    console.log("[initiative] No data, returning []"); return [];
  }

  /**
   * Get active initiatives (planned, in_progress, launched)
   */
  async getActiveInitiatives(companyId: string): Promise<Initiative[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiatives')
          .select('*')
          .eq('company_id', companyId)
          .in('status', ['planned', 'in_progress', 'launched'])
          .order('display_order', { ascending: true });

        if (error) console.error("[Supabase initiatives]", (error as any).message, "|details:", (error as any).details, "|hint:", (error as any).hint, "|code:", (error as any).code);

        if (!error && data) {
          return data.map(row => this.mapRowToInitiative(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    console.log("[initiative] No data, returning []"); return [];
  }

  /**
   * Get initiatives by type
   */
  async getInitiativesByType(companyId: string, initiativeTypeId: string): Promise<Initiative[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiatives')
          .select('*')
          .eq('company_id', companyId)
          .eq('initiative_type_id', initiativeTypeId);

        if (error) console.error("[Supabase initiatives]", (error as any).message, "|details:", (error as any).details, "|hint:", (error as any).hint, "|code:", (error as any).code);

        if (!error && data) {
          return data.map(row => this.mapRowToInitiative(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    console.log("[initiative] No data, returning []"); return [];
  }

  /**
   * Get initiatives by kind
   */
  async getInitiativesByKind(companyId: string, kind: InitiativeKind): Promise<Initiative[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiatives')
          .select('*')
          .eq('company_id', companyId)
          .eq('kind', kind);

        if (error) console.error("[Supabase initiatives]", (error as any).message, "|details:", (error as any).details, "|hint:", (error as any).hint, "|code:", (error as any).code);

        if (!error && data) {
          return data.map(row => this.mapRowToInitiative(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    console.log("[initiative] No data, returning []"); return [];
  }

  /**
   * Get initiatives for a product
   */
  async getInitiativesByProduct(companyId: string, productId: string): Promise<Initiative[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiatives')
          .select('*')
          .eq('company_id', companyId)
          .eq('product_id', productId);

        if (error) console.error("[Supabase initiatives]", (error as any).message, "|details:", (error as any).details, "|hint:", (error as any).hint, "|code:", (error as any).code);

        if (!error && data) {
          return data.map(row => this.mapRowToInitiative(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    console.log("[initiative] No data, returning []"); return [];
  }

  /**
   * Get initiatives within a date range
   */
  async getInitiativesByDateRange(companyId: string, startDate: Date, endDate: Date): Promise<Initiative[]> {
    if (!companyId) {
      console.log("[initiative] getInitiativesByDateRange - no companyId, returning []");
      return [];
    }
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const startStr = toDateOnly(startDate);
        const endStr = toDateOnly(endDate);

        /**
         * The database narrows to a SUPERSET (anything launching by the period
         * end, plus rows with no activation date, which only the new intake
         * writes) and `overlapsPeriod` decides. For a legacy row that rule is
         * the old filter exactly - activation <= end AND (event >= start OR
         * no event) - so the result is unchanged; a new-intake row is judged
         * launch -> revenue close instead of by its event date.
         */
        const { data, error } = await supabase
          .from('initiatives')
          .select('*')
          .eq('company_id', companyId)
          .or(`activation_date.lte.${endStr},activation_date.is.null`);

        if (error) console.error("[Supabase initiatives]", (error as any).message, "|details:", (error as any).details, "|hint:", (error as any).hint, "|code:", (error as any).code);

        if (!error && data) {
          return data
            .map(row => this.mapRowToInitiative(row))
            .filter(i => overlapsPeriod(i, startStr, endStr));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    return [];
  }

  async updateInitiative(id: string, dto: UpdateInitiativeDTO): Promise<Initiative> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        // Never "" into a uuid/date column; see build-update.ts.
        const updateData = buildInitiativeUpdate(dto);

        const run = (payload: Record<string, unknown>) =>
          supabase.from('initiatives').update(payload).eq('id', id).select().single();
        let { data, error } = await run(updateData);
        // A frequency the CHECK does not accept yet (migration 051 not applied):
        // keep it in attrs instead, merged over the row's current attrs.
        if (isCheckViolation(error)) {
          const { data: current } = await supabase.from('initiatives').select('attrs').eq('id', id).maybeSingle();
          const retry = initiativeFrequencyFallback(updateData, (current?.attrs as Record<string, unknown> | null) ?? null);
          if (retry) ({ data, error } = await run(retry));
        }

        if (error) console.error("[Supabase initiatives]", (error as any).message, "|details:", (error as any).details, "|hint:", (error as any).hint, "|code:", (error as any).code);

        if (!error && data) {
          return this.mapRowToInitiative(data);
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async updateInitiativeStatus(id: string, status: InitiativeStatus): Promise<Initiative> {
    return this.updateInitiative(id, { status });
  }

  async launchInitiative(id: string): Promise<Initiative> {
    return this.updateInitiativeStatus(id, 'launched');
  }

  async pauseInitiative(id: string): Promise<Initiative> {
    return this.updateInitiativeStatus(id, 'paused');
  }

  async completeInitiative(id: string): Promise<Initiative> {
    return this.updateInitiativeStatus(id, 'completed');
  }

  async retireInitiative(id: string): Promise<Initiative> {
    return this.updateInitiativeStatus(id, 'retired');
  }

  /**
   * Delete an initiative
   */
  async deleteInitiative(id: string): Promise<void> {
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('initiatives')
        .delete()
        .eq('id', id);

      if (error) {
        throw new Error(error.message);
      }
      await this.clearLeadHandoffsTo(id);
      return;
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    console.log("[initiative] No data"); return;
  }

  /**
   * After a delete: clear attrs.lead_handoff_to on every initiative that sent
   * its leads to the deleted one, so it reverts to "no handoff" rather than
   * pointing at nothing. RLS scopes the lookup to the caller's company.
   *
   * BEST-EFFORT. The delete has already happened; a failure here is logged
   * and swallowed, and readers treat a dangling id as blank anyway.
   */
  private async clearLeadHandoffsTo(deletedId: string): Promise<void> {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('initiatives')
        .select('id, attrs')
        .eq(`attrs->>${LEAD_HANDOFF_ATTR}`, deletedId);
      if (error) {
        console.error('[initiative] lead handoff cleanup lookup failed:', error.message);
        return;
      }
      for (const row of handoffCleanup((data ?? []) as Array<{ id: string; attrs: unknown }>, deletedId)) {
        const { error: updateError } = await supabase
          .from('initiatives')
          .update({ attrs: row.attrs })
          .eq('id', row.id);
        if (updateError) {
          console.error('[initiative] lead handoff cleanup failed for', row.id, updateError.message);
        }
      }
    } catch (e) {
      console.error('[initiative] lead handoff cleanup failed:', e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Map Supabase row to Initiative
   */
  private mapRowToInitiative(row: Record<string, unknown>): Initiative {
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      annualPlanId: row.annual_plan_id as string,
      initiativeTypeId: row.initiative_type_id as string,
      // Migration 040; absent column or null reads as null.
      libraryKey: typeof row.library_key === 'string' && row.library_key !== '' ? row.library_key : null,
      metricSet: readMetricSet(row.metric_set),
      productId: row.product_id as string,
      name: row.name as string,
      description: (row.description as string) || '',
      kind: row.kind as InitiativeKind,
      status: row.status as InitiativeStatus,
      // Nullable since migration 045 (an unscheduled new-intake row). Parsing
      // null would yield 1 Jan 1970 and file the initiative there.
      activationDate: row.activation_date ? parseDateOnly(row.activation_date as string) : null,
      eventDate: row.event_date ? parseDateOnly(row.event_date as string) : undefined,
      // Migration 045; an absent column reads as the column default.
      revenueCloseDate: row.revenue_close_date ? parseDateOnly(row.revenue_close_date as string) : null,
      activationDatePrecision: row.activation_date_precision === 'month' ? 'month' : 'day',
      eventDatePrecision: row.event_date_precision === 'month' ? 'month' : 'day',
      categoryId: typeof row.category_id === 'string' && row.category_id !== '' ? row.category_id : null,
      conversionPath: typeof row.conversion_path === 'string' && row.conversion_path !== '' ? row.conversion_path : null,
      attrs:
        typeof row.attrs === 'object' && row.attrs !== null && !Array.isArray(row.attrs)
          ? (row.attrs as Record<string, unknown>)
          : {},
      // Migration 036 column first, then attrs (where POST /api/initiatives
      // writes it) — the same order as frequencyOf in recurring-state.ts.
      repeatFrequency: readRepeatFrequency(row),
      trafficInput: row.traffic_input as number | undefined,
      revenueScenarios: {
        good: Number(row.revenue_good) || 0,
        better: Number(row.revenue_better) || 0,
        best: Number(row.revenue_best) || 0,
      },
      plannedBudget: Number(row.planned_budget) || 0,
      actualSpend: Number(row.actual_spend) || 0,
      displayOrder: (row.display_order as number) || 0,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    } as Initiative;
  }


  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const initiativeService = new InitiativeService();
