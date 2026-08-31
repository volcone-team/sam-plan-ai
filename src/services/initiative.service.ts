/**
 * Initiative Service
 * Manages initiatives (one-time, recurring, evergreen).
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type {
  Initiative,
  CreateInitiativeDTO,
  UpdateInitiativeDTO,
  InitiativeStatus,
  InitiativeKind,
} from '@/types';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  async getInitiative(id: string): Promise<Initiative> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiatives')
          .select('*')
          .eq('id', id)
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
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

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

  /**
   * Create a new initiative
   */
  async createInitiative(dto: CreateInitiativeDTO): Promise<Initiative> {
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();

      // The "Custom Initiative" flow hands us a client-side id like
      // "custom-1699999999". initiative_type_id is a UUID FK, so persist a
      // real user-owned type first and use its id.
      let typeId = dto.initiativeTypeId;
      if (!UUID_RE.test(typeId || '')) {
        const { data: newType, error: typeError } = await supabase
          .from('initiative_types')
          .insert({
            name: dto.name || 'Custom Initiative',
            channel: 'custom',
            description: dto.description || '',
            owner: 'user',
            benchmarks: {},
            project_template: { tasks: [], totalEstimatedHours: 0 },
            difficulty: { effortToImplement: 5, skillExpertiseRequired: 5, timeToResults: 5, costToRun: 5 },
            ai_context: { description: '', sizingGuidance: '', recommendationWeights: {} },
            tier: 1,
            display_order: 999,
            is_active: true,
          })
          .select('id')
          .single();

        if (typeError || !newType) {
          console.error('[Supabase createInitiativeType]', (typeError as any)?.message, (typeError as any)?.details);
          throw new Error('Could not create the custom initiative type. Please try again.');
        }
        typeId = newType.id as string;
      }

      // product_id is NOT NULL. A brand-new company has no products yet.
      if (!UUID_RE.test(dto.productId || '')) {
        throw new Error('Add a product first — every initiative must be tied to a product.');
      }

      const insertData = {
        company_id: dto.companyId,
        annual_plan_id: dto.annualPlanId,
        product_id: dto.productId,
        initiative_type_id: typeId,
        name: dto.name,
        description: dto.description || '',
        kind: dto.kind,
        status: 'planned',
        activation_date: dto.activationDate instanceof Date ? dto.activationDate.toISOString().split('T')[0] : dto.activationDate,
        event_date: dto.eventDate ? (dto.eventDate instanceof Date ? dto.eventDate.toISOString().split('T')[0] : dto.eventDate) : null,
        traffic_input: dto.trafficInput || null,
        revenue_good: dto.revenueScenarios?.good || 0,
        revenue_better: dto.revenueScenarios?.better || 0,
        revenue_best: dto.revenueScenarios?.best || 0,
        planned_budget: dto.plannedBudget || 0,
        actual_spend: 0,
        display_order: dto.displayOrder || 0,
      };

      const { data, error } = await supabase
        .from('initiatives')
        .insert(insertData)
        .select()
        .single();

      // Surface write failures instead of silently returning throwaway mock data.
      if (error || !data) {
        console.error('[Supabase createInitiative]', (error as any)?.message, '|details:', (error as any)?.details, '|hint:', (error as any)?.hint, insertData);
        throw new Error((error as any)?.message || 'Could not save the initiative.');
      }

      return this.mapRowToInitiative(data);
    }

    // Mock data removed - return empty
    console.log("[initiative] No data in Supabase, returning empty");
    throw new Error("Not found");
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
        if (d.activationDate !== undefined) updateData.activation_date = d.activationDate instanceof Date ? d.activationDate.toISOString().split('T')[0] : d.activationDate;
        if (d.eventDate !== undefined) updateData.event_date = d.eventDate instanceof Date ? d.eventDate.toISOString().split('T')[0] : d.eventDate;
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
      productId: row.product_id as string,
      name: row.name as string,
      description: (row.description as string) || '',
      kind: row.kind as InitiativeKind,
      status: row.status as InitiativeStatus,
      activationDate: new Date(row.activation_date as string),
      eventDate: row.event_date ? new Date(row.event_date as string) : undefined,
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
