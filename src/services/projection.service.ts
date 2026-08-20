/**
 * Projection Service
 * Manages revenue forecasting (Good/Better/Best scenarios)
 */

import type {
  Projection,
  ProjectionSummary,
  ScenarioType,
  ProjectionPeriod,
  CreateProjectionDTO,
  UpdateProjectionDTO,
} from '@/types';
import projectionsData from '@/mock-data/projections.json';

export class ProjectionService {
  /**
   * Get all projections for a company
   */
  async getProjectionsByCompany(companyId: string): Promise<Projection[]> {
    await this.delay();
    
    return projectionsData
      .filter(p => p.companyId === companyId)
      .map(p => this.transformProjectionData(p));
  }

  /**
   * Get projections by scenario
   */
  async getProjectionsByScenario(
    companyId: string,
    scenario: ScenarioType
  ): Promise<Projection[]> {
    await this.delay();
    
    return projectionsData
      .filter(p => p.companyId === companyId && p.scenario === scenario)
      .map(p => this.transformProjectionData(p));
  }

  /**
   * Get a specific projection
   */
  async getProjection(id: string): Promise<Projection> {
    await this.delay();
    
    const projection = projectionsData.find(p => p.id === id);
    if (!projection) {
      throw new Error(`Projection ${id} not found`);
    }

    return this.transformProjectionData(projection);
  }

  /**
   * Get projection summary (all 3 scenarios)
   * Good (conservative), Better (moderate), Best (aggressive)
   */
  async getProjectionSummary(
    companyId: string,
    period: 'monthly' | 'quarterly' | 'annual'
  ): Promise<ProjectionSummary> {
    await this.delay();
    
    const scenarios = await Promise.all([
      this.getProjectionsByScenario(companyId, 'good'),
      this.getProjectionsByScenario(companyId, 'better'),
      this.getProjectionsByScenario(companyId, 'best'),
    ]);

    const calculateTotal = (projections: Projection[]) =>
      projections.reduce((sum, p) => sum + p.byProduct.reduce((s, bp) => s + bp.revenue, 0), 0);

    const goodTotal = calculateTotal(scenarios[0]);
    const betterTotal = calculateTotal(scenarios[1]);
    const bestTotal = calculateTotal(scenarios[2]);

    return {
      companyId,
      annualPlanId: scenarios[0][0]?.annualPlanId || '',
      good: goodTotal,
      better: betterTotal,
      best: bestTotal,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Get annual projection total
   */
  async getAnnualProjectionTotal(
    companyId: string,
    scenario: ScenarioType
  ): Promise<number> {
    await this.delay();
    
    const projections = await this.getProjectionsByScenario(companyId, scenario);
    return projections.reduce((sum, p) => sum + p.byProduct.reduce((s, bp) => s + bp.revenue, 0), 0);
  }

  /**
   * Get projected revenue by product
   */
  async getProjectedRevenueByProduct(
    companyId: string,
    scenario: ScenarioType
  ): Promise<Array<{ productId: string; revenue: number }>> {
    await this.delay();
    
    const projections = await this.getProjectionsByScenario(companyId, scenario);
    
    const byProduct = new Map<string, number>();
    for (const proj of projections) {
      if (proj.byProduct && Array.isArray(proj.byProduct)) {
        for (const item of proj.byProduct) {
          byProduct.set(item.productId, (byProduct.get(item.productId) || 0) + item.revenue);
        }
      }
    }

    return Array.from(byProduct).map(([productId, revenue]) => ({
      productId,
      revenue,
    }));
  }

  /**
   * Get projected revenue by initiative
   */
  async getProjectedRevenueByInitiative(
    companyId: string,
    scenario: ScenarioType
  ): Promise<Array<{ initiativeId: string; revenue: number }>> {
    await this.delay();
    
    const projections = await this.getProjectionsByScenario(companyId, scenario);
    
    const byInitiative = new Map<string, number>();
    for (const proj of projections) {
      if (proj.byInitiative && Array.isArray(proj.byInitiative)) {
        for (const item of proj.byInitiative) {
          byInitiative.set(item.initiativeId, (byInitiative.get(item.initiativeId) || 0) + item.revenue);
        }
      }
    }

    return Array.from(byInitiative).map(([initiativeId, revenue]) => ({
      initiativeId,
      revenue,
    }));
  }

  /**
   * Create a projection
   */
  async createProjection(dto: CreateProjectionDTO): Promise<Projection> {
    await this.delay();
    
    const newProjection = {
      id: `proj-${Date.now()}`,
      ...dto,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    projectionsData.push(newProjection as typeof projectionsData[0]);
    return this.transformProjectionData(newProjection as typeof projectionsData[0]);
  }

  /**
   * Update projection
   */
  async updateProjection(
    id: string,
    dto: UpdateProjectionDTO
  ): Promise<Projection> {
    await this.delay();
    
    const index = projectionsData.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`Projection ${id} not found`);
    }

    const updated = {
      ...projectionsData[index],
      ...dto,
      updatedAt: new Date().toISOString(),
    };

    projectionsData[index] = updated;
    return this.transformProjectionData(updated);
  }

  /**
   * Get variance (projected vs actual)
   * For retrospective analysis
   */
  async getVariance(
    companyId: string,
    scenario: ScenarioType,
    actualRevenue: number
  ): Promise<number> {
    await this.delay();
    
    const projected = await this.getAnnualProjectionTotal(companyId, scenario);
    return actualRevenue - projected;
  }

  /**
   * Get variance percentage
   */
  async getVariancePercentage(
    companyId: string,
    scenario: ScenarioType,
    actualRevenue: number
  ): Promise<number | null> {
    await this.delay();
    
    const projected = await this.getAnnualProjectionTotal(companyId, scenario);
    if (projected === 0) return null;
    return ((actualRevenue - projected) / projected) * 100;
  }

  /**
   * Transform projection data
   */
  private transformProjectionData(data: typeof projectionsData[0]): Projection {
    return {
      id: data.id,
      companyId: data.companyId,
      annualPlanId: (data as any).annualPlanId,
      scenario: (data.scenario as ScenarioType) || 'good',
      period: (data.period as ProjectionPeriod) || 'annual',
      byProduct: (data as any).byProduct || [],
      byInitiative: (data as any).byInitiative || [],
      monthly: (data as any).monthly,
      quarterly: (data as any).quarterly,
      annual: (data as any).annual,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Simulate network delay
   */
  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const projectionService = new ProjectionService();
