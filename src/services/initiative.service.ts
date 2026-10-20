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

        const { data, error } = await supabase
          .from('initiatives')
          .select('*')
          .eq('company_id', companyId)
          .lte('activation_date', endStr)
          .or(`event_date.gte.${startStr},event_date.is.null`);

        if (error) console.error("[Supabase initiatives]", (error as any).message, "|details:", (error as any).details, "|hint:", (error as any).hint, "|code:", (error as any).code);

        if (!error && data) {
          return data.map(row => this.mapRowToInitiative(row));
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
        const d = dto as any; const updateData: Record<string, unknown> = {};
        if (d.name !== undefined) updateData.name = d.name;
        if (d.description !== undefined) updateData.description = d.description;
        if (d.status !== undefined) updateData.status = d.status;
        if (d.kind !== undefined) updateData.kind = d.kind;
        if (d.initiativeTypeId !== undefined) updateData.initiative_type_id = d.initiativeTypeId;
        if (d.productId !== undefined) updateData.product_id = d.productId;
        if (d.activationDate !== undefined) updateData.activation_date = toDateOnly(d.activationDate);
        if (d.eventDate !== undefined) updateData.event_date = toDateOnly(d.eventDate);
        if (d.trafficInput !== undefined) updateData.traffic_input = d.trafficInput;
        if (d.plannedBudget !== undefined) updateData.planned_budget = d.plannedBudget;
        if (d.actualSpend !== undefined) updateData.actual_spend = d.actualSpend;
        if (d.revenueScenarios !== undefined) {
          updateData.revenue_good = d.revenueScenarios.good;
          updateData.revenue_better = d.revenueScenarios.better;
          updateData.revenue_best = d.revenueScenarios.best;
        }
        if (d.displayOrder !== undefined) updateData.display_order = d.displayOrder;

        const { data, error } = await supabase
          .from('initiatives')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

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
      return;
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    console.log("[initiative] No data"); return;
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
      activationDate: parseDateOnly(row.activation_date as string),
      eventDate: row.event_date ? parseDateOnly(row.event_date as string) : undefined,
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
