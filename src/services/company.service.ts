/**
 * Company Service
 * Handles all company data operations.
 *
 * Strategy: real data only. Mock JSON is served ONLY when mock mode is
 * explicitly opted into for local development (SAM_USE_MOCK_DATA=1).
 *
 * Previously this fell back to mock data whenever Supabase was unconfigured OR
 * a query failed, which meant a misconfigured production deploy silently
 * served fabricated records ("Elevate Coaching", $750k target) as if they were
 * the user's own. Misconfiguration must fail loudly instead.
 */

import type { Company, UpdateCompanyDTO } from '@/types';
import { assertSupabaseConfigured, isMockDataEnabled, getSupabase, snakeToCamel, camelToSnake } from '@/lib/supabase/db';
import companyData from '@/mock-data/company.json';

export class CompanyService {
  /**
   * Get the company profile by ID
   */
  async getCompany(id?: string): Promise<Company> {
    // Dev-only escape hatch, explicitly opted into.
    if (isMockDataEnabled()) {
      await this.delay();
      return this.transformMockData(companyData);
    }

    // Throws ConfigurationError rather than fabricating data.
    assertSupabaseConfigured();

    const supabase = getSupabase();
    let query = supabase.from('companies').select('*');
    if (id) {
      query = query.eq('id', id);
    }

    const { data, error } = await query.limit(1).single();
    if (error) throw error;
    if (!data) throw new Error('Company not found');

    return this.mapRowToCompany(data);
  }

  /**
   * Update company details
   */
  async updateCompany(id: string, dto: UpdateCompanyDTO): Promise<Company> {
    if (isMockDataEnabled()) {
      await this.delay();
      return this.transformMockData({ ...companyData, ...dto, updatedAt: new Date().toISOString() });
    }

    assertSupabaseConfigured();

    const supabase = getSupabase();
    const updateData = camelToSnake(dto as unknown as Record<string, unknown>);

    const { data, error } = await supabase
      .from('companies')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) throw new Error('Company not found');

    return this.mapRowToCompany(data);
  }

  /**
   * Get company revenue metrics
   */
  async getRevenueMetrics(id: string) {
    const company = await this.getCompany(id);
    return {
      priorYearRevenue: company.priorYearRevenue,
      targetRevenue: company.targetRevenue,
      baselineRevenue: company.baselineRevenue,
      stretchRevenue: company.stretchRevenue,
      operatingBudget: company.operatingBudget,
      growthTargetPercent: company.priorYearRevenue > 0
        ? ((company.targetRevenue - company.priorYearRevenue) / company.priorYearRevenue) * 100
        : 0,
    };
  }

  /**
   * Get company fiscal configuration
   */
  async getFiscalConfig(id: string) {
    const company = await this.getCompany(id);
    return {
      fiscalYear: company.fiscalYear,
      planningYear: company.planningYear,
      currency: company.currency,
    };
  }

  /**
   * Map a Supabase row (snake_case) to Company type (camelCase)
   */
  private mapRowToCompany(row: Record<string, unknown>): Company {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) || '',
      fiscalYear: row.fiscal_year as number,
      planningYear: row.planning_year as number,
      currency: (row.currency as Company['currency']) || 'USD',
      priorYearRevenue: Number(row.prior_year_revenue) || 0,
      targetRevenue: Number(row.target_revenue) || 0,
      baselineRevenue: Number(row.baseline_revenue) || 0,
      stretchRevenue: Number(row.stretch_revenue) || 0,
      operatingBudget: Number(row.operating_budget) || 0,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  /**
   * Transform mock JSON data to Company type
   */
  private transformMockData(data: typeof companyData): Company {
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      fiscalYear: data.fiscalYear,
      planningYear: data.planningYear,
      currency: (data.currency as Company['currency']) || 'USD',
      priorYearRevenue: data.priorYearRevenue,
      targetRevenue: data.targetRevenue,
      baselineRevenue: data.baselineRevenue,
      stretchRevenue: data.stretchRevenue,
      operatingBudget: data.operatingBudget,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  private delay(ms: number = 100): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const companyService = new CompanyService();
