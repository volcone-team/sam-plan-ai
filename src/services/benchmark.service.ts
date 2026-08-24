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
import benchmarksData from '@/mock-data/benchmarks.json';

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

    await this.delay();
    return benchmarksData.map(b => this.transformMock(b));
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

    await this.delay();
    return benchmarksData
      .filter(b => b.initiativeTypeId === initiativeTypeId)
      .map(b => this.transformMock(b));
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

    await this.delay();
    return benchmarksData
      .filter(b => b.initiativeTypeId === initiativeTypeId && 'fieldName' in b)
      .map(b => this.transformMock(b) as ConversionBenchmark);
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

    await this.delay();
    return benchmarksData
      .filter(b => b.initiativeTypeId === initiativeTypeId && 'costMetric' in b)
      .map(b => this.transformMock(b) as CostBenchmark);
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

    await this.delay();
    const benchmark = benchmarksData.find(b => b.id === id);
    if (!benchmark) throw new Error(`Benchmark ${id} not found`);
    return this.transformMock(benchmark);
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

    await this.delay();
    const b = benchmarksData.find(
      b => b.initiativeTypeId === initiativeTypeId && (b as any).fieldName === fieldName
    );
    return b ? this.transformMock(b) as ConversionBenchmark : null;
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

    await this.delay();
    const b = benchmarksData.find(
      b => b.initiativeTypeId === initiativeTypeId && (b as any).costMetric === costMetric
    );
    return b ? this.transformMock(b) as CostBenchmark : null;
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

    await this.delay();
    return benchmarksData
      .filter(b => b.source === source)
      .map(b => this.transformMock(b));
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

    await this.delay();
    const newB = { id: `${Date.now()}`, ...dto, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    return this.transformMock(newB as any) as ConversionBenchmark;
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

    await this.delay();
    const newB = { id: `${Date.now()}`, ...dto, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    return this.transformMock(newB as any) as CostBenchmark;
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

    await this.delay();
    const index = benchmarksData.findIndex(b => b.id === id);
    if (index === -1) throw new Error(`Benchmark ${id} not found`);
    const updated = { ...benchmarksData[index], ...dto, updatedAt: new Date().toISOString() };
    return this.transformMock(updated as any);
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
