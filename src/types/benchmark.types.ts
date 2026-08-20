/**
 * Benchmark domain types
 * Industry and historical conversion/cost data per initiative type
 * The moat of the product
 */

export type BenchmarkSource =
  | 'first_party' // our own launches
  | 'partner_shared' // operators who shared data
  | 'published' // HubSpot, WordStream, etc.
  | 'industry_report'; // Statista, Forrester, etc.

export interface BenchmarkData {
  conservative: number;
  moderate: number;
  aggressive: number;
}

/**
 * ConversionBenchmark
 * E.g., webinar: registration_rate, show_rate, offer_conversion
 */
export interface ConversionBenchmark {
  id: string;
  initiativeTypeId: string;
  fieldName: string; // e.g., 'registration_rate', 'show_rate'
  fieldDescription?: string;
  data: BenchmarkData;
  source: BenchmarkSource;
  sourceDetails?: string; // e.g., citation, date range, sample size
  initiativeTypeVersion: string; // track versioning for historical data
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * CostBenchmark
 * E.g., typical CPA by channel, cost to run a webinar
 */
export interface CostBenchmark {
  id: string;
  initiativeTypeId: string;
  costMetric: string; // e.g., 'cost_per_lead', 'total_cost_to_run'
  costMetricDescription?: string;
  data: BenchmarkData;
  source: BenchmarkSource;
  sourceDetails?: string;
  initiativeTypeVersion: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type Benchmark = ConversionBenchmark | CostBenchmark;

export interface CreateConversionBenchmarkDTO {
  initiativeTypeId: string;
  fieldName: string;
  fieldDescription?: string;
  data: BenchmarkData;
  source: BenchmarkSource;
  sourceDetails?: string;
  initiativeTypeVersion?: string;
}

export interface CreateCostBenchmarkDTO {
  initiativeTypeId: string;
  costMetric: string;
  costMetricDescription?: string;
  data: BenchmarkData;
  source: BenchmarkSource;
  sourceDetails?: string;
  initiativeTypeVersion?: string;
}

export interface UpdateBenchmarkDTO {
  data?: Partial<BenchmarkData>;
  source?: BenchmarkSource;
  sourceDetails?: string;
  isActive?: boolean;
}

/**
 * BenchmarkLibrary
 * Summary of all benchmarks for a given initiative type
 */
export interface BenchmarkLibrary {
  initiativeTypeId: string;
  initiativeTypeName: string;
  conversions: ConversionBenchmark[];
  costs: CostBenchmark[];
  lastUpdated: Date;
}
