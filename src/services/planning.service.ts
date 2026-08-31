/**
 * Planning Service
 * Manages planning intake and questionnaire.
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type {
  PlanningInput,
  CreatePlanningInputDTO,
  UpdatePlanningInputDTO,
  IntakeRoute,
} from '@/types';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';

export class PlanningService {
  async getPlanningInput(id: string): Promise<PlanningInput> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('planning_inputs')
          .select('*')
          .eq('id', id)
          .single();

        if (!error && data) return this.mapRow(data);
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[planning] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async getPlanningInputByCompany(companyId: string): Promise<PlanningInput | null> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('planning_inputs')
          .select('*')
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) return this.mapRow(data);
        return null;
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[planning] No data in Supabase, returning empty");
    return null as any;
  }

  async createPlanningInput(dto: CreatePlanningInputDTO): Promise<PlanningInput> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          company_id: dto.companyId,
          intake_route: dto.intakeRoute || 'full',
          revenue_goal: dto.revenueGoal || 0,
          revenue_timeframe: dto.revenueTimeframe || 12,
          product_ids: dto.productIds || [],
          successful_initiative_types: dto.successfulInitiativeTypes || [],
          failed_initiatives: dto.failedInitiatives || '',
          ideal_customer_description: dto.idealCustomerDescription || '',
          current_assets: dto.currentAssets || { emailListSize: 0, socialFollowing: 0, websiteMonthlyVisitors: 0, existingCustomers: 0 },
          monthly_marketing_budget: dto.monthlyMarketingBudget || 0,
          team_size: dto.teamSize || 1,
          team_roles: dto.teamRoles || [],
        };

        const { data, error } = await supabase
          .from('planning_inputs')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) return this.mapRow(data);
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[planning] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async updatePlanningInput(id: string, dto: UpdatePlanningInputDTO): Promise<PlanningInput> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const d = dto as any; const updateData: Record<string, unknown> = {};
        if (d.intakeRoute !== undefined) updateData.intake_route = d.intakeRoute;
        if (d.revenueGoal !== undefined) updateData.revenue_goal = d.revenueGoal;
        if (d.revenueTimeframe !== undefined) updateData.revenue_timeframe = d.revenueTimeframe;
        if (d.productIds !== undefined) updateData.product_ids = d.productIds;
        if (d.successfulInitiativeTypes !== undefined) updateData.successful_initiative_types = d.successfulInitiativeTypes;
        if (d.failedInitiatives !== undefined) updateData.failed_initiatives = d.failedInitiatives;
        if (d.idealCustomerDescription !== undefined) updateData.ideal_customer_description = d.idealCustomerDescription;
        if (d.currentAssets !== undefined) updateData.current_assets = d.currentAssets;
        if (d.monthlyMarketingBudget !== undefined) updateData.monthly_marketing_budget = d.monthlyMarketingBudget;
        if (d.teamSize !== undefined) updateData.team_size = d.teamSize;
        if (d.teamRoles !== undefined) updateData.team_roles = d.teamRoles;

        const { data, error } = await supabase
          .from('planning_inputs')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (!error && data) return this.mapRow(data);
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[planning] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async completePlanningInput(id: string): Promise<PlanningInput> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('planning_inputs')
          .update({ completed_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .single();

        if (!error && data) return this.mapRow(data);
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[planning] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async getCompletionPercentage(id: string): Promise<number> {
    const input = await this.getPlanningInput(id);
    const fields = ['revenueGoal', 'revenueTimeframe', 'productIds', 'successfulInitiativeTypes', 'idealCustomerDescription', 'currentAssets', 'monthlyMarketingBudget', 'teamSize'];
    const filled = fields.filter(f => {
      const val = (input as any)[f];
      if (val == null) return false;
      if (typeof val === 'string' && val === '') return false;
      if (Array.isArray(val) && val.length === 0) return false;
      if (typeof val === 'number' && val === 0) return false;
      return true;
    }).length;
    return Math.round((filled / fields.length) * 100);
  }

  async getPlanningInputsByRoute(companyId: string, route: 'quickstart' | 'full' | 'foundation'): Promise<PlanningInput[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('planning_inputs')
          .select('*')
          .eq('company_id', companyId)
          .eq('intake_route', route);

        if (!error && data) return data.map(row => this.mapRow(row));
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[planning] No data in Supabase, returning empty");
    console.log("[planning] No data, returning []"); return [];
  }

  private mapRow(row: Record<string, unknown>): PlanningInput {
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      intakeRoute: (row.intake_route as IntakeRoute) || 'full',
      revenueGoal: Number(row.revenue_goal) || 0,
      revenueTimeframe: ((row.revenue_timeframe as number) || 12) as any,
      productIds: (row.product_ids as string[]) || [],
      successfulInitiativeTypes: (row.successful_initiative_types as string[]) || [],
      failedInitiatives: (row.failed_initiatives as string) || '',
      idealCustomerDescription: (row.ideal_customer_description as string) || '',
      currentAssets: (row.current_assets as any) || { emailListSize: 0, socialFollowing: 0, websiteMonthlyVisitors: 0, existingCustomers: 0 },
      monthlyMarketingBudget: Number(row.monthly_marketing_budget) || 0,
      teamSize: (row.team_size as number) || 1,
      teamRoles: (row.team_roles as string[]) || [],
      completedAt: row.completed_at ? new Date(row.completed_at as string) : undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }



  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const planningService = new PlanningService();
