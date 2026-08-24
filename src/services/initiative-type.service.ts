/**
 * Initiative Type Service
 * Manages initiative types with benchmarks, templates, and difficulty dimensions.
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type {
  InitiativeType,
  CreateInitiativeTypeDTO,
  UpdateInitiativeTypeDTO,
} from '@/types';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';
import initiativeTypesData from '@/mock-data/initiative-types.json';

export class InitiativeTypeService {
  /**
   * Get all initiative types
   */
  async getAllInitiativeTypes(): Promise<InitiativeType[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiative_types')
          .select('*')
          .eq('is_active', true)
          .order('tier', { ascending: true })
          .order('display_order', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRowToType(row));
        }
      } catch { /* fall through */ }
    }

    await this.delay();
    return initiativeTypesData
      .filter((t: any) => t.isActive !== false)
      .sort((a: any, b: any) => a.tier !== b.tier ? a.tier - b.tier : (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((t: any) => this.transformMockData(t));
  }

  /**
   * Get initiative types by tier
   */
  async getInitiativeTypesByTier(tier: 1 | 2 | 3): Promise<InitiativeType[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiative_types')
          .select('*')
          .eq('tier', tier)
          .eq('is_active', true)
          .order('display_order', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRowToType(row));
        }
      } catch { /* fall through */ }
    }

    await this.delay();
    return initiativeTypesData
      .filter((t: any) => t.tier === tier && t.isActive !== false)
      .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((t: any) => this.transformMockData(t));
  }

  async getTier1InitiativeTypes(): Promise<InitiativeType[]> {
    return this.getInitiativeTypesByTier(1);
  }

  async getTier2InitiativeTypes(): Promise<InitiativeType[]> {
    return this.getInitiativeTypesByTier(2);
  }

  async getTier3InitiativeTypes(): Promise<InitiativeType[]> {
    return this.getInitiativeTypesByTier(3);
  }

  /**
   * Get a specific initiative type
   */
  async getInitiativeType(id: string): Promise<InitiativeType> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiative_types')
          .select('*')
          .eq('id', id)
          .single();

        if (!error && data) {
          return this.mapRowToType(data);
        }
      } catch { /* fall through */ }
    }

    await this.delay();
    const type = initiativeTypesData.find((t: any) => t.id === id);
    if (!type) throw new Error(`Initiative type ${id} not found`);
    return this.transformMockData(type);
  }

  /**
   * Get initiative types by channel
   */
  async getInitiativeTypesByChannel(channel: string): Promise<InitiativeType[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('initiative_types')
          .select('*')
          .eq('channel', channel)
          .eq('is_active', true)
          .order('display_order', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRowToType(row));
        }
      } catch { /* fall through */ }
    }

    await this.delay();
    return initiativeTypesData
      .filter((t: any) => t.channel === channel && t.isActive !== false)
      .sort((a: any, b: any) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
      .map((t: any) => this.transformMockData(t));
  }

  async getActiveInitiativeTypes(): Promise<InitiativeType[]> {
    return this.getAllInitiativeTypes();
  }

  /**
   * Create a new initiative type
   */
  async createInitiativeType(dto: CreateInitiativeTypeDTO): Promise<InitiativeType> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          name: dto.name,
          channel: dto.channel,
          description: dto.description || '',
          owner: 'user',
          benchmarks: dto.benchmarks || {},
          project_template: dto.projectTemplate || { tasks: [], totalEstimatedHours: 0 },
          difficulty: dto.difficulty || { effortToImplement: 5, skillExpertiseRequired: 5, timeToResults: 5, costToRun: 5 },
          ai_context: dto.aiContext || { description: '', sizingGuidance: '', recommendationWeights: {} },
          tier: dto.tier || 1,
          display_order: dto.displayOrder ?? 0,
          is_active: true,
        };

        const { data, error } = await supabase
          .from('initiative_types')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) {
          return this.mapRowToType(data);
        }
      } catch { /* fall through */ }
    }

    await this.delay();
    const newType = {
      id: `${Date.now()}`,
      ...dto,
      owner: 'user' as const,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return this.transformMockData(newType);
  }

  /**
   * Update initiative type
   */
  async updateInitiativeType(id: string, dto: UpdateInitiativeTypeDTO): Promise<InitiativeType> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const d = dto as any; const updateData: Record<string, unknown> = {};
        if (d.name !== undefined) updateData.name = d.name;
        if (((dto as any).channel) !== undefined) updateData.channel = (dto as any).channel;
        if (((dto as any).description) !== undefined) updateData.description = (dto as any).description;
        if (d.benchmarks !== undefined) updateData.benchmarks = d.benchmarks;
        if (d.projectTemplate !== undefined) updateData.project_template = d.projectTemplate;
        if (d.difficulty !== undefined) updateData.difficulty = d.difficulty;
        if (d.aiContext !== undefined) updateData.ai_context = d.aiContext;
        if (d.tier !== undefined) updateData.tier = d.tier;
        if (d.displayOrder !== undefined) updateData.display_order = d.displayOrder;
        if (d.isActive !== undefined) updateData.is_active = d.isActive;

        const { data, error } = await supabase
          .from('initiative_types')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (!error && data) {
          return this.mapRowToType(data);
        }
      } catch { /* fall through */ }
    }

    await this.delay();
    const index = initiativeTypesData.findIndex((t: any) => t.id === id);
    if (index === -1) throw new Error(`Initiative type ${id} not found`);
    const updated = { ...(initiativeTypesData[index] as any), ...dto, updatedAt: new Date().toISOString() };
    return this.transformMockData(updated);
  }

  async deactivateInitiativeType(id: string): Promise<InitiativeType> {
    return this.updateInitiativeType(id, { isActive: false });
  }

  /**
   * Map Supabase row to InitiativeType
   */
  private mapRowToType(row: Record<string, unknown>): InitiativeType {
    return {
      id: row.id as string,
      name: row.name as string,
      channel: row.channel as string,
      description: (row.description as string) || '',
      owner: (row.owner as 'system' | 'user') || 'system',
      benchmarks: row.benchmarks as any || {},
      projectTemplate: row.project_template as any || { tasks: [], totalEstimatedHours: 0 },
      difficulty: row.difficulty as any || {},
      aiContext: row.ai_context as any || {},
      tier: ((row.tier as number) || 1) as 1 | 2 | 3,
      displayOrder: (row.display_order as number) ?? 0,
      isActive: row.is_active as boolean ?? true,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  /**
   * Transform mock JSON to InitiativeType
   */
  private transformMockData(data: any): InitiativeType {
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

  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const initiativeTypeService = new InitiativeTypeService();
