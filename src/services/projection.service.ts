/**
 * Projection Service
 * Manages revenue forecasting (Good/Better/Best scenarios).
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type {
  Projection,
  ProjectionSummary,
  ScenarioType,
  ProjectionPeriod,
  CreateProjectionDTO,
  UpdateProjectionDTO,
} from '@/types';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';
import projectionsData from '@/mock-data/projections.json';

export class ProjectionService {
  async getProjectionsByCompany(companyId: string): Promise<Projection[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('projections')
          .select('*')
          .eq('company_id', companyId);

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    await this.delay();
    return projectionsData
      .filter(p => p.companyId === companyId)
      .map(p => this.transformMock(p));
  }

  async getProjectionsByScenario(companyId: string, scenario: ScenarioType): Promise<Projection[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('projections')
          .select('*')
          .eq('company_id', companyId)
          .eq('scenario', scenario);

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    await this.delay();
    return projectionsData
      .filter(p => p.companyId === companyId && p.scenario === scenario)
      .map(p => this.transformMock(p));
  }

  async getProjection(id: string): Promise<Projection> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('projections')
          .select('*')
          .eq('id', id)
          .single();

        if (!error && data) return this.mapRow(data);
      } catch { /* fall through */ }
    }

    await this.delay();
    const projection = projectionsData.find(p => p.id === id);
    if (!projection) throw new Error(`Projection ${id} not found`);
    return this.transformMock(projection);
  }

  async getProjectionSummary(companyId: string, period: 'monthly' | 'quarterly' | 'annual'): Promise<ProjectionSummary> {
    const scenarios = await Promise.all([
      this.getProjectionsByScenario(companyId, 'good'),
      this.getProjectionsByScenario(companyId, 'better'),
      this.getProjectionsByScenario(companyId, 'best'),
    ]);

    const calcTotal = (projs: Projection[]) =>
      projs.reduce((sum, p) => sum + (p.byProduct || []).reduce((s, bp) => s + bp.revenue, 0), 0);

    return {
      companyId,
      annualPlanId: scenarios[0][0]?.annualPlanId || '',
      good: calcTotal(scenarios[0]),
      better: calcTotal(scenarios[1]),
      best: calcTotal(scenarios[2]),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getAnnualProjectionTotal(companyId: string, scenario: ScenarioType): Promise<number> {
    const projections = await this.getProjectionsByScenario(companyId, scenario);
    return projections.reduce((sum, p) => sum + (p.byProduct || []).reduce((s, bp) => s + bp.revenue, 0), 0);
  }

  async getProjectedRevenueByProduct(companyId: string, scenario: ScenarioType): Promise<Array<{ productId: string; revenue: number }>> {
    const projections = await this.getProjectionsByScenario(companyId, scenario);
    const map = new Map<string, number>();
    for (const proj of projections) {
      for (const item of (proj.byProduct || [])) {
        map.set(item.productId, (map.get(item.productId) || 0) + item.revenue);
      }
    }
    return Array.from(map).map(([productId, revenue]) => ({ productId, revenue }));
  }

  async getProjectedRevenueByInitiative(companyId: string, scenario: ScenarioType): Promise<Array<{ initiativeId: string; revenue: number }>> {
    const projections = await this.getProjectionsByScenario(companyId, scenario);
    const map = new Map<string, number>();
    for (const proj of projections) {
      for (const item of (proj.byInitiative || [])) {
        map.set(item.initiativeId, (map.get(item.initiativeId) || 0) + item.revenue);
      }
    }
    return Array.from(map).map(([initiativeId, revenue]) => ({ initiativeId, revenue }));
  }

  async createProjection(dto: CreateProjectionDTO): Promise<Projection> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          company_id: dto.companyId,
          annual_plan_id: dto.annualPlanId,
          scenario: dto.scenario,
          period: dto.period || 'monthly',
          by_product: dto.byProduct || [],
          by_initiative: dto.byInitiative || [],
          monthly: dto.monthly || null,
          quarterly: dto.quarterly || null,
          annual: dto.annual || null,
        };

        const { data, error } = await supabase
          .from('projections')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) return this.mapRow(data);
      } catch { /* fall through */ }
    }

    await this.delay();
    const newProj = { id: `${Date.now()}`, ...dto, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    return this.transformMock(newProj as any);
  }

  async updateProjection(id: string, dto: UpdateProjectionDTO): Promise<Projection> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const d = dto as any; const updateData: Record<string, unknown> = {};
        if (d.byProduct !== undefined) updateData.by_product = d.byProduct;
        if (d.byInitiative !== undefined) updateData.by_initiative = d.byInitiative;
        if (d.monthly !== undefined) updateData.monthly = d.monthly;
        if (d.quarterly !== undefined) updateData.quarterly = d.quarterly;
        if (d.annual !== undefined) updateData.annual = d.annual;

        const { data, error } = await supabase
          .from('projections')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (!error && data) return this.mapRow(data);
      } catch { /* fall through */ }
    }

    await this.delay();
    const index = projectionsData.findIndex(p => p.id === id);
    if (index === -1) throw new Error(`Projection ${id} not found`);
    const updated = { ...projectionsData[index], ...dto, updatedAt: new Date().toISOString() };
    return this.transformMock(updated as any);
  }

  async getVariance(companyId: string, scenario: ScenarioType, actualRevenue: number): Promise<number> {
    const projected = await this.getAnnualProjectionTotal(companyId, scenario);
    return actualRevenue - projected;
  }

  async getVariancePercentage(companyId: string, scenario: ScenarioType, actualRevenue: number): Promise<number | null> {
    const projected = await this.getAnnualProjectionTotal(companyId, scenario);
    if (projected === 0) return null;
    return ((actualRevenue - projected) / projected) * 100;
  }

  private mapRow(row: Record<string, unknown>): Projection {
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      annualPlanId: row.annual_plan_id as string,
      scenario: (row.scenario as ScenarioType) || 'good',
      period: (row.period as ProjectionPeriod) || 'monthly',
      byProduct: (row.by_product as any[]) || [],
      byInitiative: (row.by_initiative as any[]) || [],
      monthly: row.monthly as any,
      quarterly: row.quarterly as any,
      annual: row.annual as any,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  private transformMock(data: any): Projection {
    return {
      id: data.id,
      companyId: data.companyId,
      annualPlanId: data.annualPlanId,
      scenario: (data.scenario as ScenarioType) || 'good',
      period: (data.period as ProjectionPeriod) || 'monthly',
      byProduct: data.byProduct || [],
      byInitiative: data.byInitiative || [],
      monthly: data.monthly,
      quarterly: data.quarterly,
      annual: data.annual,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const projectionService = new ProjectionService();
