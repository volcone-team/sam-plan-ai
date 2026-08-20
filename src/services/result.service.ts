/**
 * Result Service
 * Manages initiative and evergreen results
 * Results are the weekly actuals that feed the core loop
 */

import type {
  InitiativeResult,
  EvergreenResult,
  Result,
  CreateInitiativeResultDTO,
  CreateEvergreenResultDTO,
  UpdateResultDTO,
} from '@/types';
import resultsData from '@/mock-data/results.json';

export class ResultService {
  /**
   * Get results for an initiative
   */
  async getResultsByInitiative(initiativeId: string): Promise<InitiativeResult[]> {
    await this.delay();
    
    return resultsData
      .filter((r): r is typeof resultsData[number] & { initiativeId: string } => 
        'initiativeId' in r && r.initiativeId === initiativeId
      )
      .map(r => this.transformInitiativeResult(r));
  }

  /**
   * Get results for a product (evergreen)
   */
  async getResultsByProduct(productId: string): Promise<EvergreenResult[]> {
    await this.delay();
    
    return resultsData
      .filter((r): r is typeof resultsData[number] & { productId: string } => 
        'productId' in r && r.productId === productId && !('initiativeId' in r)
      )
      .map(r => this.transformEvergreenResult(r));
  }

  /**
   * Get results for a week across all initiatives and products
   */
  async getResultsByWeek(
    companyId: string,
    weekStartDate: Date
  ): Promise<Result[]> {
    await this.delay();
    
    return resultsData
      .filter(r => {
        const startDate = new Date(r.weekStartDate);
        return startDate.getTime() === weekStartDate.getTime();
      })
      .map(r => this.transformResultData(r));
  }

  /**
   * Get results for a month
   */
  async getResultsByMonth(
    companyId: string,
    year: number,
    month: number
  ): Promise<Result[]> {
    await this.delay();
    
    return resultsData
      .filter(r => {
        const date = new Date(r.weekStartDate);
        return date.getFullYear() === year && date.getMonth() === month - 1;
      })
      .map(r => this.transformResultData(r));
  }

  /**
   * Get results for a date range
   */
  async getResultsByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<Result[]> {
    await this.delay();
    
    return resultsData
      .filter(r => {
        const date = new Date(r.weekStartDate);
        return date >= startDate && date <= endDate;
      })
      .sort((a, b) => 
        new Date(a.weekStartDate).getTime() - new Date(b.weekStartDate).getTime()
      )
      .map(r => this.transformResultData(r));
  }

  /**
   * Create initiative result
   */
  async createInitiativeResult(
    dto: CreateInitiativeResultDTO
  ): Promise<InitiativeResult> {
    await this.delay();
    
    const newResult = {
      id: `result-${Date.now()}`,
      ...dto,
      weekStartDate: dto.weekStartDate instanceof Date ? dto.weekStartDate.toISOString() : dto.weekStartDate,
      weekEndDate: dto.weekEndDate instanceof Date ? dto.weekEndDate.toISOString() : dto.weekEndDate,
      metrics: dto.metrics || {},
      source: 'manual' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (resultsData as any[]).push(newResult);
    return this.transformInitiativeResult(newResult);
  }

  /**
   * Create evergreen result
   */
  async createEvergreenResult(
    dto: CreateEvergreenResultDTO
  ): Promise<EvergreenResult> {
    await this.delay();
    
    const newResult = {
      id: `result-${Date.now()}`,
      ...dto,
      weekStartDate: dto.weekStartDate instanceof Date ? dto.weekStartDate.toISOString() : dto.weekStartDate,
      weekEndDate: dto.weekEndDate instanceof Date ? dto.weekEndDate.toISOString() : dto.weekEndDate,
      initiativeId: null,
      metrics: dto.metrics || {},
      source: 'manual' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (resultsData as any[]).push(newResult);
    return this.transformEvergreenResult(newResult);
  }

  /**
   * Update result
   */
  async updateResult(id: string, dto: UpdateResultDTO): Promise<Result> {
    await this.delay();
    
    const index = resultsData.findIndex(r => r.id === id);
    if (index === -1) {
      throw new Error(`Result ${id} not found`);
    }

    const updated = {
      ...resultsData[index],
      ...dto,
      updatedAt: new Date().toISOString(),
    };

    (resultsData as any[])[index] = updated;
    return this.transformResultData(updated as typeof resultsData[0]);
  }

  /**
   * Get aggregated revenue for an initiative
   */
  async getTotalRevenueByInitiative(initiativeId: string): Promise<number> {
    await this.delay();
    
    const results = await this.getResultsByInitiative(initiativeId);
    return results.reduce((sum, r) => sum + r.actualRevenue, 0);
  }

  /**
   * Get aggregated spend for an initiative
   */
  async getTotalSpendByInitiative(initiativeId: string): Promise<number> {
    await this.delay();
    
    const results = await this.getResultsByInitiative(initiativeId);
    return results.reduce((sum, r) => sum + r.actualSpend, 0);
  }

  /**
   * Get aggregated revenue for a product
   */
  async getTotalRevenueByProduct(productId: string): Promise<number> {
    await this.delay();
    
    const results = await this.getResultsByProduct(productId);
    return results.reduce((sum, r) => sum + r.actualRevenue, 0);
  }

  /**
   * Calculate ROI for an initiative result
   */
  calculateROI(revenue: number, spend: number): number | null {
    if (spend === 0) return null;
    return ((revenue - spend) / spend) * 100;
  }

  /**
   * Get weekly revenue (sum across all initiatives and products)
   */
  async getWeeklyRevenue(
    companyId: string,
    weekStartDate: Date
  ): Promise<number> {
    await this.delay();
    
    const results = await this.getResultsByWeek(companyId, weekStartDate);
    return results.reduce((sum, r) => sum + r.actualRevenue, 0);
  }

  /**
   * Get monthly revenue
   */
  async getMonthlyRevenue(
    companyId: string,
    year: number,
    month: number
  ): Promise<number> {
    await this.delay();
    
    const results = await this.getResultsByMonth(companyId, year, month);
    return results.reduce((sum, r) => sum + r.actualRevenue, 0);
  }

  /**
   * Get trending (revenue change week-over-week)
   */
  async getWeeklyTrend(
    companyId: string,
    currentWeekStart: Date
  ): Promise<number | null> {
    await this.delay();
    
    const prevWeekStart = new Date(currentWeekStart);
    prevWeekStart.setDate(prevWeekStart.getDate() - 7);

    const currentWeekRevenue = await this.getWeeklyRevenue(companyId, currentWeekStart);
    const prevWeekRevenue = await this.getWeeklyRevenue(companyId, prevWeekStart);

    if (prevWeekRevenue === 0) return null;
    return ((currentWeekRevenue - prevWeekRevenue) / prevWeekRevenue) * 100;
  }

  /**
   * Transform initiative result data
   */
  private transformInitiativeResult(data: any): InitiativeResult {
    return {
      id: data.id,
      companyId: data.companyId,
      initiativeId: data.initiativeId,
      weekStartDate: new Date(data.weekStartDate),
      weekEndDate: new Date(data.weekEndDate),
      actualRevenue: data.actualRevenue,
      actualSpend: data.actualSpend,
      metrics: data.metrics,
      source: data.source || 'manual',
      notes: data.notes,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Transform evergreen result data
   */
  private transformEvergreenResult(data: any): EvergreenResult {
    return {
      id: data.id,
      companyId: data.companyId,
      productId: data.productId,
      initiativeId: null,
      weekStartDate: new Date(data.weekStartDate),
      weekEndDate: new Date(data.weekEndDate),
      actualRevenue: data.actualRevenue,
      actualSpend: data.actualSpend,
      metrics: data.metrics,
      source: data.source || 'manual',
      notes: data.notes,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Transform result data (generic)
   */
  private transformResultData(data: typeof resultsData[0]): Result {
    if ('initiativeId' in data) {
      return this.transformInitiativeResult(data);
    }
    return this.transformEvergreenResult(data);
  }

  /**
   * Simulate network delay
   */
  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const resultService = new ResultService();
