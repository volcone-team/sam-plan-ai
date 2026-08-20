/**
 * Initiative Service
 * Manages initiatives (one-time, recurring, evergreen)
 * This is the core execution engine
 */

import type {
  Initiative,
  CreateInitiativeDTO,
  UpdateInitiativeDTO,
  InitiativeStatus,
  InitiativeKind,
  RecurringTemplate,
  CreateRecurringTemplateDTO,
} from '@/types';
import initiativesData from '@/mock-data/initiatives.json';

export class InitiativeService {
  /**
   * Get all initiatives for a company
   */
  async getInitiativesByCompany(companyId: string): Promise<Initiative[]> {
    await this.delay();
    
    return initiativesData
      .filter(i => i.companyId === companyId)
      .map(i => this.transformInitiativeData(i));
  }

  /**
   * Get a specific initiative
   */
  async getInitiative(id: string): Promise<Initiative> {
    await this.delay();
    
    const initiative = initiativesData.find(i => i.id === id);
    if (!initiative) {
      throw new Error(`Initiative ${id} not found`);
    }

    return this.transformInitiativeData(initiative);
  }

  /**
   * Get initiatives by status
   */
  async getInitiativesByStatus(
    companyId: string,
    status: InitiativeStatus
  ): Promise<Initiative[]> {
    await this.delay();
    
    return initiativesData
      .filter(i => i.companyId === companyId && i.status === status)
      .map(i => this.transformInitiativeData(i));
  }

  /**
   * Get active initiatives
   * Active = planned, in_progress, or launched
   */
  async getActiveInitiatives(companyId: string): Promise<Initiative[]> {
    await this.delay();
    
    const activeStatuses: InitiativeStatus[] = ['planned', 'in_progress', 'launched'];
    return initiativesData
      .filter(i => i.companyId === companyId && activeStatuses.includes(i.status as InitiativeStatus))
      .map(i => this.transformInitiativeData(i));
  }

  /**
   * Get initiatives by type
   */
  async getInitiativesByType(
    companyId: string,
    initiativeTypeId: string
  ): Promise<Initiative[]> {
    await this.delay();
    
    return initiativesData
      .filter(i => i.companyId === companyId && i.initiativeTypeId === initiativeTypeId)
      .map(i => this.transformInitiativeData(i));
  }

  /**
   * Get initiatives by kind (one-time, recurring, evergreen)
   */
  async getInitiativesByKind(
    companyId: string,
    kind: InitiativeKind
  ): Promise<Initiative[]> {
    await this.delay();
    
    return initiativesData
      .filter(i => i.companyId === companyId && i.kind === kind)
      .map(i => this.transformInitiativeData(i));
  }

  /**
   * Get initiatives for a product
   */
  async getInitiativesByProduct(
    companyId: string,
    productId: string
  ): Promise<Initiative[]> {
    await this.delay();
    
    return initiativesData
      .filter(i => i.companyId === companyId && i.productId === productId)
      .map(i => this.transformInitiativeData(i));
  }

  /**
   * Get initiatives within a date range
   * For planning horizons (week, month, quarter)
   */
  async getInitiativesByDateRange(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Initiative[]> {
    await this.delay();
    
    return initiativesData
      .filter(i => {
        if (i.companyId !== companyId) return false;

        const data = i as any;
        
        // One-time: check if event date falls within range
        if (data.kind === 'one-time' && data.eventDate) {
          const eventDate = new Date(data.eventDate);
          return eventDate >= startDate && eventDate <= endDate;
        }

        // Recurring: check if any instance overlaps
        if (data.kind === 'recurring' && data.recurringTemplate?.eventDates) {
          return data.recurringTemplate.eventDates.some((d: string) => {
            const date = new Date(d);
            return date >= startDate && date <= endDate;
          });
        }

        // Evergreen: check if activated during range
        if (data.kind === 'evergreen') {
          const activationDate = new Date(data.activationDate);
          const retirementDate = data.retirementDate ? new Date(data.retirementDate) : null;
          const isActive = activationDate <= endDate && (!retirementDate || retirementDate >= startDate);
          return isActive;
        }

        return false;
      })
      .map(i => this.transformInitiativeData(i));
  }

  /**
   * Create a new initiative
   */
  async createInitiative(dto: CreateInitiativeDTO): Promise<Initiative> {
    await this.delay();
    
    const newInitiative = {
      id: `init-${Date.now()}`,
      ...dto,
      status: 'planned' as InitiativeStatus,
      roi: null,
      plannedBudget: dto.plannedBudget || 0,
      actualSpend: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    initiativesData.push(newInitiative as any);
    return this.transformInitiativeData(newInitiative as any);
  }

  /**
   * Update initiative
   */
  async updateInitiative(
    id: string,
    dto: UpdateInitiativeDTO
  ): Promise<Initiative> {
    await this.delay();
    
    const index = initiativesData.findIndex(i => i.id === id);
    if (index === -1) {
      throw new Error(`Initiative ${id} not found`);
    }

    const data = initiativesData[index] as any;
    const updated = {
      ...data,
      ...dto,
      activationDate: dto.activationDate ? (dto.activationDate instanceof Date ? dto.activationDate.toISOString() : dto.activationDate) : data.activationDate,
      eventDate: dto.eventDate ? (dto.eventDate instanceof Date ? dto.eventDate.toISOString() : dto.eventDate) : data.eventDate,
      updatedAt: new Date().toISOString(),
    };

    initiativesData[index] = updated;
    return this.transformInitiativeData(updated);
  }

  /**
   * Update initiative status
   */
  async updateInitiativeStatus(
    id: string,
    status: InitiativeStatus
  ): Promise<Initiative> {
    return this.updateInitiative(id, { status });
  }

  /**
   * Launch an initiative
   */
  async launchInitiative(id: string): Promise<Initiative> {
    return this.updateInitiativeStatus(id, 'launched');
  }

  /**
   * Pause an initiative
   */
  async pauseInitiative(id: string): Promise<Initiative> {
    return this.updateInitiativeStatus(id, 'paused');
  }

  /**
   * Complete an initiative
   */
  async completeInitiative(id: string): Promise<Initiative> {
    return this.updateInitiativeStatus(id, 'completed');
  }

  /**
   * Retire an evergreen initiative
   */
  async retireInitiative(id: string): Promise<Initiative> {
    const initiative = await this.getInitiative(id);
    if (initiative.kind !== 'evergreen') {
      throw new Error('Can only retire evergreen initiatives');
    }

    const index = initiativesData.findIndex(i => i.id === id);
    if (index === -1) {
      throw new Error(`Initiative ${id} not found`);
    }

    const data = initiativesData[index] as any;
    const updated = {
      ...data,
      retirementDate: new Date().toISOString(),
      status: 'retired',
      updatedAt: new Date().toISOString(),
    };

    initiativesData[index] = updated;
    return this.transformInitiativeData(updated);
  }

  /**
   * Delete an initiative
   */
  async deleteInitiative(id: string): Promise<void> {
    await this.delay();

    const index = initiativesData.findIndex(i => i.id === id);
    if (index === -1) {
      throw new Error(`Initiative ${id} not found`);
    }

    initiativesData.splice(index, 1);
  }

  /**
   * Calculate ROI for an initiative
   * ROI = (Revenue - Spend) / Spend * 100
   */
  calculateROI(revenue: number, spend: number): number | null {
    if (spend === 0) return null;
    return ((revenue - spend) / spend) * 100;
  }

  /**
   * Transform initiative data
   */
  private transformInitiativeData(data: typeof initiativesData[0]): Initiative {
    return {
      id: data.id,
      companyId: data.companyId,
      annualPlanId: (data as any).annualPlanId || '',
      initiativeTypeId: data.initiativeTypeId,
      productId: data.productId,
      name: data.name,
      description: data.description,
      kind: data.kind as InitiativeKind,
      status: data.status as InitiativeStatus,
      activationDate: new Date(data.activationDate),
      eventDate: data.eventDate ? new Date(data.eventDate) : undefined,
      trafficInput: (data as any).trafficInput,
      plannedBudget: data.plannedBudget,
      actualSpend: data.actualSpend,
      revenueScenarios: data.revenueScenarios,
      roi: (data as any).roi,
      displayOrder: (data as any).displayOrder || 0,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    } as Initiative;
  }

  /**
   * Simulate network delay
   */
  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const initiativeService = new InitiativeService();
