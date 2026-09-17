/**
 * Result Service
 * Manages initiative and evergreen results.
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type {
  InitiativeResult,
  EvergreenResult,
  Result,
  CreateInitiativeResultDTO,
  CreateEvergreenResultDTO,
  UpdateResultDTO,
} from '@/types';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';

export class ResultService {
  async getResultsByInitiative(initiativeId: string): Promise<InitiativeResult[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('results')
          .select('*')
          .eq('initiative_id', initiativeId)
          .order('week_start_date', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRow(row) as InitiativeResult);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[result] No data in Supabase, returning empty");
    console.log("[result] No data, returning []"); return [];
  }

  async getResultsByProduct(productId: string): Promise<EvergreenResult[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('results')
          .select('*')
          .eq('product_id', productId)
          .is('initiative_id', null)
          .order('week_start_date', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRow(row) as EvergreenResult);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[result] No data in Supabase, returning empty");
    console.log("[result] No data, returning []"); return [];
  }

  async getResultsByWeek(companyId: string, weekStartDate: Date): Promise<Result[]> {
    if (!companyId) { console.log("[result] getResultsByWeek - no companyId"); return []; }
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const dateStr = weekStartDate.toISOString().split('T')[0];
        const { data, error } = await supabase
          .from('results')
          .select('*')
          .eq('company_id', companyId)
          .eq('week_start_date', dateStr);

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[result] No data in Supabase, returning empty");
    console.log("[result] No data, returning []"); return [];
  }

  async getResultsByMonth(companyId: string, year: number, month: number): Promise<Result[]> {
    if (!companyId) { console.log("[result] getResultsByMonth - no companyId"); return []; }
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const startDate = new Date(year, month - 1, 1).toISOString().split('T')[0];
        const endDate = new Date(year, month, 0).toISOString().split('T')[0];
        const { data, error } = await supabase
          .from('results')
          .select('*')
          .eq('company_id', companyId)
          .gte('week_start_date', startDate)
          .lte('week_start_date', endDate)
          .order('week_start_date', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[result] No data in Supabase, returning empty");
    console.log("[result] Not found in Supabase"); throw new Error("Not found");
  }

  /**
   * Results within a date range.
   * Pass companyId to scope the query at the database level - without it the
   * query relies solely on RLS and scans more rows than necessary.
   */
  async getResultsByDateRange(startDate: Date, endDate: Date, companyId?: string): Promise<Result[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        let query = supabase
          .from('results')
          .select('*')
          .gte('week_start_date', startDate.toISOString().split('T')[0])
          .lte('week_start_date', endDate.toISOString().split('T')[0]);
        if (companyId) query = query.eq('company_id', companyId);
        const { data, error } = await query.order('week_start_date', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[result] No data in Supabase, returning empty");
    console.log("[result] No data, returning []"); return [];
  }

  async createInitiativeResult(dto: CreateInitiativeResultDTO): Promise<InitiativeResult> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          company_id: dto.companyId,
          initiative_id: dto.initiativeId,
          product_id: null,
          week_start_date: dto.weekStartDate instanceof Date ? dto.weekStartDate.toISOString().split('T')[0] : dto.weekStartDate,
          week_end_date: dto.weekEndDate instanceof Date ? dto.weekEndDate.toISOString().split('T')[0] : dto.weekEndDate,
          actual_revenue: dto.actualRevenue,
          actual_spend: dto.actualSpend,
          metrics: dto.metrics || {},
          source: 'manual',
          notes: dto.notes || null,
        };

        const { data, error } = await supabase
          .from('results')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) {
          return this.mapRow(data) as InitiativeResult;
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[result] No data in Supabase, returning empty");
    console.log("[result] Not found in Supabase"); throw new Error("Not found");
  }

  async createEvergreenResult(dto: CreateEvergreenResultDTO): Promise<EvergreenResult> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          company_id: dto.companyId,
          initiative_id: null,
          product_id: dto.productId,
          week_start_date: dto.weekStartDate instanceof Date ? dto.weekStartDate.toISOString().split('T')[0] : dto.weekStartDate,
          week_end_date: dto.weekEndDate instanceof Date ? dto.weekEndDate.toISOString().split('T')[0] : dto.weekEndDate,
          actual_revenue: dto.actualRevenue,
          actual_spend: dto.actualSpend,
          metrics: dto.metrics || {},
          source: 'manual',
          notes: dto.notes || null,
        };

        const { data, error } = await supabase
          .from('results')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) {
          return this.mapRow(data) as EvergreenResult;
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[result] No data in Supabase, returning empty");
    console.log("[result] Not found in Supabase"); throw new Error("Not found");
  }

  async updateResult(id: string, dto: UpdateResultDTO): Promise<Result> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const updateData: Record<string, unknown> = {};
        if (dto.actualRevenue !== undefined) updateData.actual_revenue = dto.actualRevenue;
        if (dto.actualSpend !== undefined) updateData.actual_spend = dto.actualSpend;
        if (dto.metrics !== undefined) updateData.metrics = dto.metrics;
        if (dto.notes !== undefined) updateData.notes = dto.notes;

        const { data, error } = await supabase
          .from('results')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (!error && data) {
          return this.mapRow(data);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[result] No data in Supabase, returning empty");
    console.log("[result] Not found in Supabase"); throw new Error("Not found");
  }

  async getTotalRevenueByInitiative(initiativeId: string): Promise<number> {
    const results = await this.getResultsByInitiative(initiativeId);
    return results.reduce((sum, r) => sum + r.actualRevenue, 0);
  }

  async getTotalSpendByInitiative(initiativeId: string): Promise<number> {
    const results = await this.getResultsByInitiative(initiativeId);
    return results.reduce((sum, r) => sum + r.actualSpend, 0);
  }

  async getTotalRevenueByProduct(productId: string): Promise<number> {
    const results = await this.getResultsByProduct(productId);
    return results.reduce((sum, r) => sum + r.actualRevenue, 0);
  }

  calculateROI(revenue: number, spend: number): number | null {
    if (spend === 0) return null;
    return ((revenue - spend) / spend) * 100;
  }

  async getWeeklyRevenue(companyId: string, weekStartDate: Date): Promise<number> {
    const results = await this.getResultsByWeek(companyId, weekStartDate);
    return results.reduce((sum, r) => sum + r.actualRevenue, 0);
  }

  async getMonthlyRevenue(companyId: string, year: number, month: number): Promise<number> {
    const results = await this.getResultsByMonth(companyId, year, month);
    return results.reduce((sum, r) => sum + r.actualRevenue, 0);
  }

  async getWeeklyTrend(companyId: string, currentWeekStart: Date): Promise<number | null> {
    const prevWeekStart = new Date(currentWeekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);
    const current = await this.getWeeklyRevenue(companyId, currentWeekStart);
    const prev = await this.getWeeklyRevenue(companyId, prevWeekStart);
    if (prev === 0) return null;
    return ((current - prev) / prev) * 100;
  }

  private mapRow(row: Record<string, unknown>): Result {
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      initiativeId: (row.initiative_id as string) || null,
      productId: (row.product_id as string) || undefined,
      weekStartDate: new Date(row.week_start_date as string),
      weekEndDate: new Date(row.week_end_date as string),
      actualRevenue: Number(row.actual_revenue) || 0,
      actualSpend: Number(row.actual_spend) || 0,
      metrics: (row.metrics as any) || {},
      source: (row.source as string) || 'manual',
      notes: (row.notes as string) || undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    } as Result;
  }

  private transformMock(data: any): Result {
    return {
      id: data.id,
      companyId: data.companyId,
      initiativeId: data.initiativeId || null,
      productId: data.productId || undefined,
      weekStartDate: new Date(data.weekStartDate),
      weekEndDate: new Date(data.weekEndDate),
      actualRevenue: data.actualRevenue,
      actualSpend: data.actualSpend,
      metrics: data.metrics || {},
      source: data.source || 'manual',
      notes: data.notes,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    } as Result;
  }

  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const resultService = new ResultService();
