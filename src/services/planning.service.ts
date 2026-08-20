/**
 * Planning Service
 * Manages planning intake and questionnaire
 */

import type {
  PlanningInput,
  CreatePlanningInputDTO,
  UpdatePlanningInputDTO,
  IntakeRoute,
} from '@/types';
import planningInputsData from '@/mock-data/planning-inputs.json';

export class PlanningService {
  /**
   * Get planning input by ID
   */
  async getPlanningInput(id: string): Promise<PlanningInput> {
    await this.delay();
    
    const input = planningInputsData.find(p => p.id === id);
    if (!input) {
      throw new Error(`Planning input ${id} not found`);
    }

    return this.transformPlanningInput(input);
  }

  /**
   * Get planning input for a company
   */
  async getPlanningInputByCompany(companyId: string): Promise<PlanningInput | null> {
    await this.delay();
    
    const input = planningInputsData.find(p => p.companyId === companyId);
    return input ? this.transformPlanningInput(input) : null;
  }

  /**
   * Create new planning input (questionnaire)
   */
  async createPlanningInput(dto: CreatePlanningInputDTO): Promise<PlanningInput> {
    await this.delay();
    
    // Check if company already has input
    const existing = planningInputsData.find(p => p.companyId === dto.companyId);
    if (existing) {
      throw new Error(`Planning input already exists for company ${dto.companyId}`);
    }

    const newInput = {
      id: `planninginput-${Date.now()}`,
      ...dto,
      completedAt: null as any,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    planningInputsData.push(newInput as any);
    return this.transformPlanningInput(newInput as any);
  }

  /**
   * Update planning input (partial save during form fill)
   */
  async updatePlanningInput(
    id: string,
    dto: UpdatePlanningInputDTO
  ): Promise<PlanningInput> {
    await this.delay();
    
    const index = planningInputsData.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`Planning input ${id} not found`);
    }

    const updated = {
      ...planningInputsData[index],
      ...dto,
      updatedAt: new Date().toISOString(),
    } as any;

    planningInputsData[index] = updated;
    return this.transformPlanningInput(updated);
  }

  /**
   * Mark planning input as completed
   */
  async completePlanningInput(id: string): Promise<PlanningInput> {
    await this.delay();
    
    const index = planningInputsData.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`Planning input ${id} not found`);
    }

    const updated = {
      ...planningInputsData[index],
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    planningInputsData[index] = updated;
    return this.transformPlanningInput(updated);
  }

  /**
   * Get completion percentage
   * Checks how many fields are filled in
   */
  async getCompletionPercentage(id: string): Promise<number> {
    await this.delay();
    
    const input = planningInputsData.find(p => p.id === id) as any;
    if (!input) {
      throw new Error(`Planning input ${id} not found`);
    }

    const fields: string[] = [
      'revenueGoal',
      'revenueTimeframe',
      'productIds',
      'successfulInitiativeTypes',
      'idealCustomerDescription',
      'currentAssets',
      'monthlyMarketingBudget',
      'teamSize',
    ];

    const filledFields = fields.filter(field => input[field] != null && input[field] !== '').length;
    return Math.round((filledFields / fields.length) * 100);
  }

  /**
   * Get inputs by route
   */
  async getPlanningInputsByRoute(
    companyId: string,
    route: 'quickstart' | 'full' | 'foundation'
  ): Promise<PlanningInput[]> {
    await this.delay();
    
    return planningInputsData
      .filter(p => p.companyId === companyId && p.intakeRoute === route)
      .map(p => this.transformPlanningInput(p));
  }

  /**
   * Transform planning input data
   */
  private transformPlanningInput(data: typeof planningInputsData[0]): PlanningInput {
    return {
      id: data.id,
      companyId: data.companyId,
      intakeRoute: data.intakeRoute as IntakeRoute,
      revenueGoal: (data as any).revenueGoal,
      revenueTimeframe: (data as any).revenueTimeframe,
      productIds: (data as any).productIds || [],
      successfulInitiativeTypes: (data as any).successfulInitiativeTypes || [],
      failedInitiatives: (data as any).failedInitiatives || '',
      idealCustomerDescription: (data as any).idealCustomerDescription || '',
      currentAssets: (data as any).currentAssets,
      monthlyMarketingBudget: (data as any).monthlyMarketingBudget,
      teamSize: (data as any).teamSize,
      teamRoles: (data as any).teamRoles || [],
      completedAt: (data as any).completedAt ? new Date((data as any).completedAt) : undefined,
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

export const planningService = new PlanningService();
