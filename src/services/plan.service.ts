/**
 * Plan Service
 * Manages the planning hierarchy: Annual → Quarterly → Monthly → Weekly.
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type {
  AnnualPlan,
  QuarterlyPlan,
  MonthlyPlan,
  WeeklyPlan,
  PlanStatus,
  CreateAnnualPlanDTO,
  UpdateAnnualPlanDTO,
} from '@/types';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';

export class PlanService {
  async getAnnualPlan(companyId: string, year: number): Promise<AnnualPlan | null> {
    if (!companyId) { console.log("[plan] getAnnualPlan - no companyId"); return null; }
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('annual_plans')
          .select('*')
          .eq('company_id', companyId)
          .eq('year', year)
          .single();

        if (!error && data) {
          return this.mapAnnualRow(data);
        }
      } catch { /* fall through */ }
    }

    console.log("[plan] getAnnualPlan - no plan found for year", year);
    return null;
  }

  async createAnnualPlan(dto: CreateAnnualPlanDTO): Promise<AnnualPlan> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          company_id: dto.companyId,
          year: dto.year,
          baseline_revenue: dto.baselineRevenue || 0,
          stretch_revenue: dto.stretchRevenue || 0,
          operating_budget: dto.operatingBudget || 0,
          status: 'draft',
          notes: dto.notes || '',
        };

        const { data, error } = await supabase
          .from('annual_plans')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) return this.mapAnnualRow(data);
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[plan] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async updateAnnualPlan(id: string, dto: UpdateAnnualPlanDTO): Promise<AnnualPlan> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const updateData: Record<string, unknown> = {};
        if (dto.baselineRevenue !== undefined) updateData.baseline_revenue = dto.baselineRevenue;
        if (dto.stretchRevenue !== undefined) updateData.stretch_revenue = dto.stretchRevenue;
        if (dto.operatingBudget !== undefined) updateData.operating_budget = dto.operatingBudget;
        if (dto.status !== undefined) updateData.status = dto.status;
        if (dto.notes !== undefined) updateData.notes = dto.notes;

        const { data, error } = await supabase
          .from('annual_plans')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (!error && data) return this.mapAnnualRow(data);
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[plan] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async getQuarterlyPlans(companyId: string, year: number): Promise<QuarterlyPlan[]> {
    if (!companyId) { console.log("[plan] getQuarterlyPlans - no companyId"); return []; }
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        // Get annual plan first to find its ID
        const { data: annualPlan } = await supabase
          .from('annual_plans')
          .select('id')
          .eq('company_id', companyId)
          .eq('year', year)
          .single();

        if (annualPlan) {
          const { data, error } = await supabase
            .from('quarterly_plans')
            .select('*')
            .eq('annual_plan_id', annualPlan.id)
            .order('quarter', { ascending: true });

          if (!error && data) {
            return data.map(row => this.mapQuarterlyRow(row));
          }
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[plan] No data in Supabase, returning empty");
    return [];
  }

  async getQuarterlyPlan(companyId: string, year: number, quarter: number): Promise<QuarterlyPlan> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data: annualPlan } = await supabase
          .from('annual_plans')
          .select('id')
          .eq('company_id', companyId)
          .eq('year', year)
          .single();

        if (annualPlan) {
          const { data, error } = await supabase
            .from('quarterly_plans')
            .select('*')
            .eq('annual_plan_id', annualPlan.id)
            .eq('quarter', quarter)
            .single();

          if (!error && data) return this.mapQuarterlyRow(data);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[plan] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async getMonthlyPlans(companyId: string, year: number, quarter: number): Promise<MonthlyPlan[]> {
    if (!companyId) { console.log("[plan] getMonthlyPlans - no companyId"); return []; }
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        // Get quarterly plan for this quarter
        const { data: annualPlan } = await supabase
          .from('annual_plans')
          .select('id')
          .eq('company_id', companyId)
          .eq('year', year)
          .single();

        if (annualPlan) {
          const { data: qPlan } = await supabase
            .from('quarterly_plans')
            .select('id')
            .eq('annual_plan_id', annualPlan.id)
            .eq('quarter', quarter)
            .single();

          if (qPlan) {
            const { data, error } = await supabase
              .from('monthly_plans')
              .select('*')
              .eq('quarterly_plan_id', qPlan.id)
              .order('month', { ascending: true });

            if (!error && data) {
              return data.map(row => this.mapMonthlyRow(row));
            }
          }
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[plan] No data in Supabase, returning empty");
    return [];
  }

  async getWeeklyPlans(companyId: string, year: number, month: number): Promise<WeeklyPlan[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
        const endDate = new Date(year, month, 0).toISOString().split('T')[0];

        const { data, error } = await supabase
          .from('weekly_plans')
          .select('*')
          .gte('week_start_date', startDate)
          .lte('week_start_date', endDate)
          .order('week_start_date', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapWeeklyRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[plan] No data in Supabase, returning empty");
    return [];
  }

  async getWeeklyPlan(companyId: string, weekStartDate: Date): Promise<WeeklyPlan | null> {
    if (!companyId) { console.log("[plan] getWeeklyPlan - no companyId"); return null as any; }
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const dateStr = weekStartDate.toISOString().split('T')[0];
        const { data, error } = await supabase
          .from('weekly_plans')
          .select('*')
          .eq('week_start_date', dateStr)
          .maybeSingle();

        if (!error && data) {
          return this.mapWeeklyRow(data);
        }
        return null;
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[plan] No data in Supabase, returning empty");
    return null as any;
  }

  async getCurrentWeekPlan(companyId: string): Promise<WeeklyPlan | null> {
    return this.getWeeklyPlan(companyId, this.getWeekStart(new Date()));
  }

  async getUpcomingWeeks(companyId: string, count: number = 6): Promise<WeeklyPlan[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const startDate = this.getWeekStart(new Date()).toISOString().split('T')[0];
        const { data, error } = await supabase
          .from('weekly_plans')
          .select('*')
          .gte('week_start_date', startDate)
          .order('week_start_date', { ascending: true })
          .limit(count);

        if (!error && data) {
          return data.map(row => this.mapWeeklyRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[plan] No data in Supabase, returning empty");
    return [];
  }

  async getPlansByStatus(companyId: string, status: PlanStatus): Promise<AnnualPlan[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('annual_plans')
          .select('*')
          .eq('company_id', companyId)
          .eq('status', status);

        if (!error && data) {
          return data.map(row => this.mapAnnualRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[plan] No data in Supabase, returning empty");
    return [];
  }

  // --- Row mappers ---

  private mapAnnualRow(row: Record<string, unknown>): AnnualPlan {
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      year: row.year as number,
      status: (row.status as PlanStatus) || 'draft',
      baselineRevenue: Number(row.baseline_revenue) || 0,
      stretchRevenue: Number(row.stretch_revenue) || 0,
      operatingBudget: Number(row.operating_budget) || 0,
      notes: (row.notes as string) || '',
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private mapQuarterlyRow(row: Record<string, unknown>): QuarterlyPlan {
    return {
      id: row.id as string,
      annualPlanId: row.annual_plan_id as string,
      quarter: (row.quarter as number) as any,
      year: row.year as number,
      targetRevenue: Number(row.target_revenue) || 0,
      notes: (row.notes as string) || '',
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private mapMonthlyRow(row: Record<string, unknown>): MonthlyPlan {
    return {
      id: row.id as string,
      quarterlyPlanId: row.quarterly_plan_id as string,
      month: row.month as number,
      year: row.year as number,
      targetRevenue: Number(row.target_revenue) || 0,
      notes: (row.notes as string) || '',
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private mapWeeklyRow(row: Record<string, unknown>): WeeklyPlan {
    return {
      id: row.id as string,
      monthlyPlanId: row.monthly_plan_id as string,
      weekStartDate: new Date(row.week_start_date as string),
      weekEndDate: new Date(row.week_end_date as string),
      targetRevenue: Number(row.target_revenue) || 0,
      topPriorities: (row.top_priorities as string[]) || [],
      notes: (row.notes as string) || '',
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  // --- Mock transformers ---

  private transformAnnualMock(data: any): AnnualPlan {
    return {
      id: data.id, companyId: data.companyId, year: data.year, status: data.status || 'draft',
      baselineRevenue: data.baselineRevenue || 0, stretchRevenue: data.stretchRevenue || 0,
      operatingBudget: data.operatingBudget || 0, notes: data.notes || '',
      createdAt: new Date(data.createdAt), updatedAt: new Date(data.updatedAt),
    };
  }

  private transformQuarterlyMock(data: any): QuarterlyPlan {
    return {
      id: data.id, annualPlanId: data.annualPlanId, quarter: data.quarter, year: data.year,
      targetRevenue: data.targetRevenue || 0, notes: data.notes || '',
      createdAt: new Date(data.createdAt), updatedAt: new Date(data.updatedAt),
    };
  }

  private transformMonthlyMock(data: any): MonthlyPlan {
    return {
      id: data.id, quarterlyPlanId: data.quarterlyPlanId, month: data.month, year: data.year,
      targetRevenue: data.targetRevenue || 0, notes: data.notes || '',
      createdAt: new Date(data.createdAt), updatedAt: new Date(data.updatedAt),
    };
  }

  private transformWeeklyMock(data: any): WeeklyPlan {
    return {
      id: data.id, monthlyPlanId: data.monthlyPlanId,
      weekStartDate: new Date(data.weekStartDate), weekEndDate: new Date(data.weekEndDate),
      targetRevenue: data.targetRevenue || 0, topPriorities: data.topPriorities || [],
      notes: data.notes || '', createdAt: new Date(data.createdAt), updatedAt: new Date(data.updatedAt),
    };
  }

  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const planService = new PlanService();
