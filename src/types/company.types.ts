/**
 * Company domain types
 * Root entity representing a business using SAM Flow AI
 */

export interface Company {
  id: string;
  name: string;
  description: string;
  fiscalYear: number;
  planningYear: number;
  currency: 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD';
  priorYearRevenue: number;
  targetRevenue: number;
  baselineRevenue: number;
  stretchRevenue: number;
  operatingBudget: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateCompanyDTO {
  name: string;
  description?: string;
  fiscalYear?: number;
  planningYear?: number;
  currency?: 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD';
  priorYearRevenue?: number;
  targetRevenue?: number;
  baselineRevenue?: number;
  stretchRevenue?: number;
  operatingBudget?: number;
}

export interface UpdateCompanyDTO {
  name?: string;
  description?: string;
  targetRevenue?: number;
  baselineRevenue?: number;
  stretchRevenue?: number;
  operatingBudget?: number;
  currency?: 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD';
}
