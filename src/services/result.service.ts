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
import resultsData from '@/mock-data/results.json';

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

    await this.delay();
    return resultsData
      .filter((r: any) => r.initiativeId === initiativeId)
      .map(r => this.transformMock(r) as InitiativeResult);
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

    await this.delay();
    return resultsData
      .filter((r: any) => r.productId === productId && !r.initiativeId)
      .map(r => this.transformMock(r) as EvergreenResult);
  }

  async getResultsByWeek(companyId: string, weekStartDate: Date): Promise<Result[]> {
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

    await this.delay();
    return resultsData
      .filter(r => new Date(r.weekStartDate).getTime() === weekStartDate.getTime())
      .map(r => this.transformMock(r));
  }

  async getResultsByMonth(companyId: string, year: number, month: number): Promise<Result[]> {
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

    await this.delay();
    return resultsData
      .filter(r => {
        const d = new Date(r.weekStartDate);
        return d.getFullYear() === year && d.getMonth() === month - 1;
      })
      .map(r => this.transformMock(r));
  }

  async getResultsByDateRange(startDate: Date, endDate: Date): Promise<Result[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('results')
          .select('*')
          .gte('week_start_date', startDate.toISOString().split('T')[0])
          .lte('week_start_date', endDate.toISOString().split('T')[0])
          .order('week_start_date', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    await this.delay();
    return resultsData
      .filter(r => {
        const d = new Date(r.weekStartDate);
        return d >= startDate && d <= endDate;
      })
      .sort((a, b) => new Date(a.weekStartDate).getTime() - new Date(b.weekStartDate).getTime())
      .map(r => this.transformMock(r));
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

    await this.delay();
    const newResult = {
      id: `${Date.now()}`,
      ...dto,
      weekStartDate: dto.weekStartDate instanceof Date ? dto.weekStartDate.toISOString() : dto.weekStartDate,
      weekEndDate: dto.weekEndDate instanceof Date ? dto.weekEndDate.toISOString() : dto.weekEndDate,
      metrics: dto.metrics || {},
      source: 'manual' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this.transformMock(newResult as any) as InitiativeResult;
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

    await this.delay();
    const newResult = {
      id: `${Date.now()}`,
      ...dto,
      initiativeId: null,
      weekStartDate: dto.weekStartDate instanceof Date ? dto.weekStartDate.toISOString() : dto.weekStartDate,
      weekEndDate: dto.weekEndDate instanceof Date ? dto.weekEndDate.toISOString() : dto.weekEndDate,
      metrics: dto.metrics || {},
      source: 'manual' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this.transformMock(newResult as any) as EvergreenResult;
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

    await this.delay();
    const index = resultsData.findIndex(r => r.id === id);
    if (index === -1) throw new Error(`Result ${id} not found`);
    const updated = { ...resultsData[index], ...dto, updatedAt: new Date().toISOString() };
    return this.transformMock(updated as any);
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
