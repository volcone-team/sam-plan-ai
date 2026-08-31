/**
 * Benchmark Service
 * Manages industry and historical benchmarks.
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type {
  Benchmark,
  ConversionBenchmark,
  CostBenchmark,
  CreateConversionBenchmarkDTO,
  CreateCostBenchmarkDTO,
  UpdateBenchmarkDTO,
} from '@/types';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';

export class BenchmarkService {
  async getAllBenchmarks(): Promise<Benchmark[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('benchmarks')
          .select('*')
          .eq('is_active', true);

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    return [];
  }

  async getBenchmarksByInitiativeType(initiativeTypeId: string): Promise<Benchmark[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('benchmarks')
          .select('*')
          .eq('initiative_type_id', initiativeTypeId)
          .eq('is_active', true);

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    console.log("[benchmark] No data, returning []"); return [];
  }

  async getConversionBenchmarks(initiativeTypeId: string): Promise<ConversionBenchmark[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('benchmarks')
          .select('*')
          .eq('initiative_type_id', initiativeTypeId)
          .eq('benchmark_type', 'conversion')
          .eq('is_active', true);

        if (!error && data) {
          return data.map(row => this.mapRow(row) as ConversionBenchmark);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    console.log("[benchmark] No data, returning []"); return [];
  }

  async getCostBenchmarks(initiativeTypeId: string): Promise<CostBenchmark[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('benchmarks')
          .select('*')
          .eq('initiative_type_id', initiativeTypeId)
          .eq('benchmark_type', 'cost')
          .eq('is_active', true);

        if (!error && data) {
          return data.map(row => this.mapRow(row) as CostBenchmark);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    console.log("[benchmark] No data, returning []"); return [];
  }

  async getBenchmark(id: string): Promise<Benchmark> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('benchmarks')
          .select('*')
          .eq('id', id)
          .single();

        if (!error && data) return this.mapRow(data);
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async getBenchmarkByMetric(initiativeTypeId: string, fieldName: string): Promise<ConversionBenchmark | null> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('benchmarks')
          .select('*')
          .eq('initiative_type_id', initiativeTypeId)
          .eq('field_name', fieldName)
          .eq('is_active', true)
          .maybeSingle();

        if (!error && data) return this.mapRow(data) as ConversionBenchmark;
        return null;
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    return null as any;
  }

  async getBenchmarkByCostMetric(initiativeTypeId: string, costMetric: string): Promise<CostBenchmark | null> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('benchmarks')
          .select('*')
          .eq('initiative_type_id', initiativeTypeId)
          .eq('field_name', costMetric)
          .eq('benchmark_type', 'cost')
          .eq('is_active', true)
          .maybeSingle();

        if (!error && data) return this.mapRow(data) as CostBenchmark;
        return null;
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    return null as any;
  }

  async getBenchmarksBySource(source: 'first_party' | 'partner_shared' | 'published' | 'industry_report'): Promise<Benchmark[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('benchmarks')
          .select('*')
          .eq('source', source)
          .eq('is_active', true);

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    console.log("[benchmark] No data, returning []"); return [];
  }

  async createConversionBenchmark(dto: CreateConversionBenchmarkDTO): Promise<ConversionBenchmark> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          initiative_type_id: dto.initiativeTypeId,
          benchmark_type: 'conversion',
          field_name: dto.fieldName,
          field_description: dto.fieldDescription || null,
          data_conservative: dto.data.conservative,
          data_moderate: dto.data.moderate,
          data_aggressive: dto.data.aggressive,
          source: dto.source || 'published',
          source_details: dto.sourceDetails || null,
          is_active: true,
        };

        const { data, error } = await supabase
          .from('benchmarks')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) return this.mapRow(data) as ConversionBenchmark;
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async createCostBenchmark(dto: CreateCostBenchmarkDTO): Promise<CostBenchmark> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          initiative_type_id: dto.initiativeTypeId,
          benchmark_type: 'cost',
          field_name: dto.costMetric,
          field_description: dto.costMetricDescription || null,
          data_conservative: dto.data.conservative,
          data_moderate: dto.data.moderate,
          data_aggressive: dto.data.aggressive,
          source: dto.source || 'published',
          source_details: dto.sourceDetails || null,
          is_active: true,
        };

        const { data, error } = await supabase
          .from('benchmarks')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) return this.mapRow(data) as CostBenchmark;
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async updateBenchmark(id: string, dto: UpdateBenchmarkDTO): Promise<Benchmark> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const updateData: Record<string, unknown> = {};
        if (dto.data) {
          if (dto.data.conservative !== undefined) updateData.data_conservative = dto.data.conservative;
          if (dto.data.moderate !== undefined) updateData.data_moderate = dto.data.moderate;
          if (dto.data.aggressive !== undefined) updateData.data_aggressive = dto.data.aggressive;
        }
        if (dto.source !== undefined) updateData.source = dto.source;
        if (dto.sourceDetails !== undefined) updateData.source_details = dto.sourceDetails;
        if (dto.isActive !== undefined) updateData.is_active = dto.isActive;

        const { data, error } = await supabase
          .from('benchmarks')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (!error && data) return this.mapRow(data);
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[benchmark] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async getConservativeEstimate(initiativeTypeId: string, fieldName: string): Promise<number | null> {
    const b = await this.getBenchmarkByMetric(initiativeTypeId, fieldName);
    return b?.data?.conservative ?? null;
  }

  async getModerateEstimate(initiativeTypeId: string, fieldName: string): Promise<number | null> {
    const b = await this.getBenchmarkByMetric(initiativeTypeId, fieldName);
    return b?.data?.moderate ?? null;
  }

  async getAggressiveEstimate(initiativeTypeId: string, fieldName: string): Promise<number | null> {
    const b = await this.getBenchmarkByMetric(initiativeTypeId, fieldName);
    return b?.data?.aggressive ?? null;
  }

  async compareBenchmarks(id1: string, id2: string, fieldName: string): Promise<{ type1: number | null; type2: number | null; difference: number | null }> {
    const v1 = await this.getModerateEstimate(id1, fieldName);
    const v2 = await this.getModerateEstimate(id2, fieldName);
    return { type1: v1, type2: v2, difference: v1 && v2 ? v2 - v1 : null };
  }

  private mapRow(row: Record<string, unknown>): Benchmark {
    const isCost = row.benchmark_type === 'cost';
    const base = {
      id: row.id as string,
      initiativeTypeId: row.initiative_type_id as string,
      data: {
        conservative: Number(row.data_conservative) || 0,
        moderate: Number(row.data_moderate) || 0,
        aggressive: Number(row.data_aggressive) || 0,
      },
      source: (row.source as string) || 'published',
      sourceDetails: (row.source_details as string) || undefined,
      initiativeTypeVersion: (row.initiative_type_version as string) || '1.0',
      isActive: row.is_active as boolean ?? true,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };

    if (isCost) {
      return { ...base, costMetric: row.field_name as string, costMetricDescription: (row.field_description as string) || '' } as CostBenchmark;
    }
    return { ...base, fieldName: row.field_name as string, fieldDescription: (row.field_description as string) || '' } as ConversionBenchmark;
  }

  private transformMock(data: any): Benchmark {
    const base = {
      id: data.id,
      initiativeTypeId: data.initiativeTypeId,
      data: data.data || { conservative: 0, moderate: 0, aggressive: 0 },
      source: data.source || 'published',
      sourceDetails: data.sourceDetails,
      initiativeTypeVersion: data.initiativeTypeVersion || '1.0',
      isActive: data.isActive ?? true,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };

    if ('costMetric' in data) {
      return { ...base, costMetric: data.costMetric, costMetricDescription: data.costMetricDescription || '' } as CostBenchmark;
    }
    return { ...base, fieldName: data.fieldName, fieldDescription: data.fieldDescription || '' } as ConversionBenchmark;
  }

  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const benchmarkService = new BenchmarkService();
