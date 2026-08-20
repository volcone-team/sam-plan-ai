/**
 * Plan Service
 * Manages the planning hierarchy: Annual → Quarterly → Monthly → Weekly
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
import plansData from '@/mock-data/plans.json';

export class PlanService {
  /**
   * Get the annual plan for a year
   */
  async getAnnualPlan(companyId: string, year: number): Promise<AnnualPlan> {
    await this.delay();
    
    const plan = (plansData.annualPlans as any[]).find(
      p => p.companyId === companyId && p.year === year
    );
    
    if (!plan) {
      throw new Error(`Annual plan for ${year} not found`);
    }

    return this.transformAnnualPlan(plan);
  }

  /**
   * Create annual plan
   */
  async createAnnualPlan(dto: CreateAnnualPlanDTO): Promise<AnnualPlan> {
    await this.delay();
    
    const newPlan = {
      id: `plan-annual-${Date.now()}`,
      ...dto,
      status: 'draft' as PlanStatus,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (plansData.annualPlans as any[]).push(newPlan);
    return this.transformAnnualPlan(newPlan);
  }

  /**
   * Update annual plan
   */
  async updateAnnualPlan(
    id: string,
    dto: UpdateAnnualPlanDTO
  ): Promise<AnnualPlan> {
    await this.delay();
    
    const data = plansData.annualPlans as any[];
    const index = data.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`Annual plan ${id} not found`);
    }

    const updated = {
      ...data[index],
      ...dto,
      updatedAt: new Date().toISOString(),
    };

    data[index] = updated;
    return this.transformAnnualPlan(updated);
  }

  /**
   * Get quarterly plans for a year
   */
  async getQuarterlyPlans(companyId: string, year: number): Promise<QuarterlyPlan[]> {
    await this.delay();
    
    // Quarterly plans may not have companyId — link via annualPlanId
    const annualPlan = (plansData.annualPlans as any[]).find(
      p => p.companyId === companyId && p.year === year
    );

    if (!annualPlan) {
      return [];
    }

    return (plansData.quarterlyPlans as any[])
      .filter(p => p.annualPlanId === annualPlan.id && p.year === year)
      .map(p => this.transformQuarterlyPlan(p));
  }

  /**
   * Get a specific quarterly plan
   */
  async getQuarterlyPlan(
    companyId: string,
    year: number,
    quarter: number
  ): Promise<QuarterlyPlan> {
    await this.delay();
    
    const plan = (plansData.quarterlyPlans as any[]).find(
      p => p.companyId === companyId && p.year === year && p.quarter === quarter
    );
    
    if (!plan) {
      throw new Error(`Q${quarter} ${year} plan not found`);
    }

    return this.transformQuarterlyPlan(plan);
  }

  /**
   * Get monthly plans for a quarter
   */
  async getMonthlyPlans(
    companyId: string,
    year: number,
    quarter: number
  ): Promise<MonthlyPlan[]> {
    await this.delay();
    
    return (plansData.monthlyPlans as any[])
      .filter(
        p =>
          p.companyId === companyId &&
          p.year === year &&
          p.quarter === quarter
      )
      .sort((a, b) => a.month - b.month)
      .map(p => this.transformMonthlyPlan(p));
  }

  /**
   * Get weekly plans for a month
   */
  async getWeeklyPlans(
    companyId: string,
    year: number,
    month: number
  ): Promise<WeeklyPlan[]> {
    await this.delay();
    
    return (plansData.weeklyPlans as any[])
      .filter(
        p => p.companyId === companyId && p.year === year && p.month === month
      )
      .sort((a, b) => a.weekNumber - b.weekNumber)
      .map(p => this.transformWeeklyPlan(p));
  }

  /**
   * Get a specific weekly plan
   */
  async getWeeklyPlan(
    companyId: string,
    weekStartDate: Date
  ): Promise<WeeklyPlan | null> {
    await this.delay();
    
    const plan = (plansData.weeklyPlans as any[]).find(
      p =>
        p.companyId === companyId &&
        new Date(p.weekStartDate).getTime() === weekStartDate.getTime()
    );

    return plan ? this.transformWeeklyPlan(plan) : null;
  }

  /**
   * Get the current week plan
   */
  async getCurrentWeekPlan(companyId: string): Promise<WeeklyPlan | null> {
    await this.delay();
    
    const today = new Date();
    const weekStart = this.getWeekStart(today);

    return this.getWeeklyPlan(companyId, weekStart);
  }

  /**
   * Get upcoming weeks (next 4-6 weeks)
   */
  async getUpcomingWeeks(companyId: string, count: number = 6): Promise<WeeklyPlan[]> {
    await this.delay();
    
    const today = new Date();
    const weekStart = this.getWeekStart(today);
    const upcoming: WeeklyPlan[] = [];

    for (let i = 0; i < count; i++) {
      const weekDate = new Date(weekStart);
      weekDate.setDate(weekDate.getDate() + i * 7);
      
      const plan = (plansData.weeklyPlans as any[]).find(
        p =>
          p.companyId === companyId &&
          new Date(p.weekStartDate).getTime() === weekDate.getTime()
      );

      if (plan) {
        upcoming.push(this.transformWeeklyPlan(plan));
      }
    }

    return upcoming;
  }

  /**
   * Get plans by status
   */
  async getPlansByStatus(
    companyId: string,
    status: PlanStatus
  ): Promise<AnnualPlan[]> {
    await this.delay();
    
    return (plansData.annualPlans as any[])
      .filter(p => p.companyId === companyId && p.status === status)
      .map(p => this.transformAnnualPlan(p));
  }

  /**
   * Get week start date (Monday)
   */
  private getWeekStart(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff));
  }

  /**
   * Transform annual plan data
   */
  private transformAnnualPlan(data: any): AnnualPlan {
    return {
      id: data.id,
      companyId: data.companyId,
      year: data.year,
      status: data.status,
      baselineRevenue: data.baselineRevenue,
      stretchRevenue: data.stretchRevenue,
      operatingBudget: data.operatingBudget,
      notes: data.notes,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Transform quarterly plan data
   */
  private transformQuarterlyPlan(data: any): QuarterlyPlan {
    return {
      id: data.id,
      annualPlanId: (data as any).annualPlanId,
      quarter: data.quarter,
      year: data.year,
      targetRevenue: (data as any).targetRevenue,
      notes: data.notes,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Transform monthly plan data
   */
  private transformMonthlyPlan(data: any): MonthlyPlan {
    return {
      id: data.id,
      quarterlyPlanId: (data as any).quarterlyPlanId,
      month: data.month,
      year: data.year,
      targetRevenue: (data as any).targetRevenue,
      notes: data.notes,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Transform weekly plan data
   */
  private transformWeeklyPlan(data: any): WeeklyPlan {
    return {
      id: data.id,
      monthlyPlanId: (data as any).monthlyPlanId,
      weekStartDate: new Date(data.weekStartDate),
      weekEndDate: new Date(data.weekEndDate),
      targetRevenue: (data as any).targetRevenue,
      topPriorities: (data as any).topPriorities || [],
      notes: data.notes,
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

export const planService = new PlanService();
