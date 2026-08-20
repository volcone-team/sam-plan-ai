/**
 * Benchmark Service
 * Manages industry and historical benchmarks
 * The moat: conversion rates, cost benchmarks, and historical data
 */

import type {
  Benchmark,
  ConversionBenchmark,
  CostBenchmark,
  CreateConversionBenchmarkDTO,
  CreateCostBenchmarkDTO,
  UpdateBenchmarkDTO,
} from '@/types';
import benchmarksData from '@/mock-data/benchmarks.json';

export class BenchmarkService {
  /**
   * Get all benchmarks
   */
  async getAllBenchmarks(): Promise<Benchmark[]> {
    await this.delay();
    
    return benchmarksData.map(b => this.transformBenchmarkData(b));
  }

  /**
   * Get benchmarks for an initiative type
   */
  async getBenchmarksByInitiativeType(initiativeTypeId: string): Promise<Benchmark[]> {
    await this.delay();
    
    return benchmarksData
      .filter(b => b.initiativeTypeId === initiativeTypeId)
      .map(b => this.transformBenchmarkData(b));
  }

  /**
   * Get conversion benchmarks for an initiative type
   */
  async getConversionBenchmarks(
    initiativeTypeId: string
  ): Promise<ConversionBenchmark[]> {
    await this.delay();
    
    return benchmarksData
      .filter((b): b is typeof benchmarksData[number] & { fieldName: string } => 
        b.initiativeTypeId === initiativeTypeId && 'fieldName' in b
      )
      .map(b => this.transformConversionBenchmark(b));
  }

  /**
   * Get cost benchmarks for an initiative type
   */
  async getCostBenchmarks(initiativeTypeId: string): Promise<CostBenchmark[]> {
    await this.delay();
    
    return benchmarksData
      .filter((b): b is typeof benchmarksData[number] & { costMetric: string } => 
        b.initiativeTypeId === initiativeTypeId && 'costMetric' in b
      )
      .map(b => this.transformCostBenchmark(b));
  }

  /**
   * Get a specific benchmark
   */
  async getBenchmark(id: string): Promise<Benchmark> {
    await this.delay();
    
    const benchmark = benchmarksData.find(b => b.id === id);
    if (!benchmark) {
      throw new Error(`Benchmark ${id} not found`);
    }

    return this.transformBenchmarkData(benchmark);
  }

  /**
   * Get benchmark data for a specific metric
   */
  async getBenchmarkByMetric(
    initiativeTypeId: string,
    fieldName: string
  ): Promise<ConversionBenchmark | null> {
    await this.delay();
    
    const benchmark = benchmarksData.find(
      b => b.initiativeTypeId === initiativeTypeId && 'fieldName' in b && (b as any).fieldName === fieldName
    );

    return benchmark ? this.transformConversionBenchmark(benchmark as any) : null;
  }

  /**
   * Get benchmark by cost metric
   */
  async getBenchmarkByCostMetric(
    initiativeTypeId: string,
    costMetric: string
  ): Promise<CostBenchmark | null> {
    await this.delay();
    
    const benchmark = benchmarksData.find(
      b => b.initiativeTypeId === initiativeTypeId && 'costMetric' in b && (b as any).costMetric === costMetric
    );

    return benchmark ? this.transformCostBenchmark(benchmark as any) : null;
  }

  /**
   * Get benchmarks by source
   */
  async getBenchmarksBySource(
    source: 'first_party' | 'partner_shared' | 'published' | 'industry_report'
  ): Promise<Benchmark[]> {
    await this.delay();
    
    return benchmarksData
      .filter(b => b.source === source)
      .map(b => this.transformBenchmarkData(b));
  }

  /**
   * Create conversion benchmark
   */
  async createConversionBenchmark(
    dto: CreateConversionBenchmarkDTO
  ): Promise<ConversionBenchmark> {
    await this.delay();
    
    const newBenchmark = {
      id: `bench-${Date.now()}`,
      ...dto,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    benchmarksData.push(newBenchmark as typeof benchmarksData[0]);
    return this.transformConversionBenchmark(newBenchmark as any);
  }

  /**
   * Create cost benchmark
   */
  async createCostBenchmark(dto: CreateCostBenchmarkDTO): Promise<CostBenchmark> {
    await this.delay();
    
    const newBenchmark = {
      id: `bench-${Date.now()}`,
      ...dto,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    benchmarksData.push(newBenchmark as typeof benchmarksData[0]);
    return this.transformCostBenchmark(newBenchmark as any);
  }

  /**
   * Update benchmark
   */
  async updateBenchmark(id: string, dto: UpdateBenchmarkDTO): Promise<Benchmark> {
    await this.delay();
    
    const index = benchmarksData.findIndex(b => b.id === id);
    if (index === -1) {
      throw new Error(`Benchmark ${id} not found`);
    }

    const existing = benchmarksData[index];
    const updated = {
      ...existing,
      ...dto,
      // Preserve data integrity when partial data is provided
      data: dto.data ? { ...existing.data, ...dto.data } : existing.data,
      updatedAt: new Date().toISOString(),
    };

    benchmarksData[index] = updated;
    return this.transformBenchmarkData(updated);
  }

  /**
   * Get benchmark conservative estimate
   */
  async getConservativeEstimate(
    initiativeTypeId: string,
    fieldName: string
  ): Promise<number | null> {
    await this.delay();
    
    const benchmark = await this.getBenchmarkByMetric(initiativeTypeId, fieldName);
    return benchmark?.data?.conservative ?? null;
  }

  /**
   * Get benchmark moderate estimate
   */
  async getModerateEstimate(
    initiativeTypeId: string,
    fieldName: string
  ): Promise<number | null> {
    await this.delay();
    
    const benchmark = await this.getBenchmarkByMetric(initiativeTypeId, fieldName);
    return benchmark?.data?.moderate ?? null;
  }

  /**
   * Get benchmark aggressive estimate
   */
  async getAggressiveEstimate(
    initiativeTypeId: string,
    fieldName: string
  ): Promise<number | null> {
    await this.delay();
    
    const benchmark = await this.getBenchmarkByMetric(initiativeTypeId, fieldName);
    return benchmark?.data?.aggressive ?? null;
  }

  /**
   * Compare benchmarks across initiative types
   */
  async compareBenchmarks(
    initiativeTypeId1: string,
    initiativeTypeId2: string,
    fieldName: string
  ): Promise<{ type1: number | null; type2: number | null; difference: number | null }> {
    await this.delay();
    
    const value1 = await this.getModerateEstimate(initiativeTypeId1, fieldName);
    const value2 = await this.getModerateEstimate(initiativeTypeId2, fieldName);

    return {
      type1: value1,
      type2: value2,
      difference: value1 && value2 ? value2 - value1 : null,
    };
  }

  /**
   * Transform benchmark data
   */
  private transformBenchmarkData(data: typeof benchmarksData[0]): Benchmark {
    if ('fieldName' in data) {
      return this.transformConversionBenchmark(data as any);
    }
    return this.transformCostBenchmark(data as any);
  }

  /**
   * Transform conversion benchmark
   */
  private transformConversionBenchmark(data: any): ConversionBenchmark {
    return {
      id: data.id,
      initiativeTypeId: data.initiativeTypeId,
      fieldName: data.fieldName,
      fieldDescription: data.fieldDescription,
      data: {
        conservative: data.data.conservative,
        moderate: data.data.moderate,
        aggressive: data.data.aggressive,
      },
      source: data.source,
      sourceDetails: data.sourceDetails,
      initiativeTypeVersion: data.initiativeTypeVersion,
      isActive: data.isActive ?? true,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Transform cost benchmark
   */
  private transformCostBenchmark(data: any): CostBenchmark {
    return {
      id: data.id,
      initiativeTypeId: data.initiativeTypeId,
      costMetric: data.costMetric,
      costMetricDescription: data.costMetricDescription,
      data: {
        conservative: data.data.conservative,
        moderate: data.data.moderate,
        aggressive: data.data.aggressive,
      },
      source: data.source,
      sourceDetails: data.sourceDetails,
      initiativeTypeVersion: data.initiativeTypeVersion,
      isActive: data.isActive ?? true,
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

export const benchmarkService = new BenchmarkService();
