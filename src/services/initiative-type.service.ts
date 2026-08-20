/**
 * Initiative Type Service
 * Manages initiative types with benchmarks, templates, and difficulty dimensions
 * Initiative types are stored as data, not code
 */

import type {
  InitiativeType,
  CreateInitiativeTypeDTO,
  UpdateInitiativeTypeDTO,
} from '@/types';
import initiativeTypesData from '@/mock-data/initiative-types.json';

export class InitiativeTypeService {
  /**
   * Get all initiative types
   */
  async getAllInitiativeTypes(): Promise<InitiativeType[]> {
    await this.delay();

    return initiativeTypesData
      .filter((t: any) => t.isActive !== false)
      .sort((a: any, b: any) => {
        // Sort by tier first (1, 2, 3), then by displayOrder
        if (a.tier !== b.tier) {
          return a.tier - b.tier;
        }
        return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
      })
      .map((t: any) => this.transformInitiativeTypeData(t));
  }

  /**
   * Get initiative types by tier
   */
  async getInitiativeTypesByTier(tier: 1 | 2 | 3): Promise<InitiativeType[]> {
    await this.delay();

    return initiativeTypesData
      .filter((t: any) => t.tier === tier && t.isActive !== false)
      .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((t: any) => this.transformInitiativeTypeData(t));
  }

  /**
   * Get Tier 1 initiative types (core library)
   */
  async getTier1InitiativeTypes(): Promise<InitiativeType[]> {
    return this.getInitiativeTypesByTier(1);
  }

  /**
   * Get Tier 2 initiative types (expanded library)
   */
  async getTier2InitiativeTypes(): Promise<InitiativeType[]> {
    return this.getInitiativeTypesByTier(2);
  }

  /**
   * Get Tier 3 initiative types (specialized)
   */
  async getTier3InitiativeTypes(): Promise<InitiativeType[]> {
    return this.getInitiativeTypesByTier(3);
  }

  /**
   * Get a specific initiative type
   */
  async getInitiativeType(id: string): Promise<InitiativeType> {
    await this.delay();

    const type = initiativeTypesData.find((t: any) => t.id === id);
    if (!type) {
      throw new Error(`Initiative type ${id} not found`);
    }

    return this.transformInitiativeTypeData(type);
  }

  /**
   * Get initiative types by channel
   */
  async getInitiativeTypesByChannel(channel: string): Promise<InitiativeType[]> {
    await this.delay();

    return initiativeTypesData
      .filter((t: any) => t.channel === channel && t.isActive !== false)
      .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((t: any) => this.transformInitiativeTypeData(t));
  }

  /**
   * Get active initiative types (available for new initiatives)
   */
  async getActiveInitiativeTypes(): Promise<InitiativeType[]> {
    return this.getAllInitiativeTypes();
  }

  /**
   * Create a new initiative type
   */
  async createInitiativeType(
    dto: CreateInitiativeTypeDTO
  ): Promise<InitiativeType> {
    await this.delay();

    const newType = {
      id: `inittype-${Date.now()}`,
      ...dto,
      owner: 'user' as const,
      isActive: true,
      displayOrder: (dto.displayOrder ?? 0),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (initiativeTypesData as any[]).push(newType);
    return this.transformInitiativeTypeData(newType);
  }

  /**
   * Update initiative type
   */
  async updateInitiativeType(
    id: string,
    dto: UpdateInitiativeTypeDTO
  ): Promise<InitiativeType> {
    await this.delay();

    const index = initiativeTypesData.findIndex((t: any) => t.id === id);
    if (index === -1) {
      throw new Error(`Initiative type ${id} not found`);
    }

    const updated = {
      ...(initiativeTypesData[index] as any),
      ...dto,
      updatedAt: new Date().toISOString(),
    };

    (initiativeTypesData as any[])[index] = updated;
    return this.transformInitiativeTypeData(updated);
  }

  /**
   * Deactivate initiative type
   */
  async deactivateInitiativeType(id: string): Promise<InitiativeType> {
    return this.updateInitiativeType(id, { isActive: false });
  }

  /**
   * Transform raw initiative type data to domain type
   */
  private transformInitiativeTypeData(data: any): InitiativeType {
    return {
      id: data.id,
      name: data.name,
      channel: data.channel,
      description: data.description,
      owner: data.owner || 'system',
      benchmarks: data.benchmarks,
      projectTemplate: data.projectTemplate,
      difficulty: data.difficulty,
      aiContext: data.aiContext,
      tier: data.tier || 1,
      displayOrder: data.displayOrder ?? 0,
      isActive: data.isActive !== false,
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

export const initiativeTypeService = new InitiativeTypeService();
