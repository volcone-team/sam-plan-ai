/**
 * Result domain types
 * Captures actual outcomes (actuals) entered weekly for initiatives and products
 */

export type ResultSource = 'manual' | 'integration';

export interface InitiativeResult {
  id: string;
  companyId: string;
  initiativeId: string;
  weekStartDate: Date;
  weekEndDate: Date;
  // Revenue
  actualRevenue: number;
  // Spending
  actualSpend: number;
  // Initiative-specific metrics (e.g., registrants, show rate, conversion)
  metrics: {
    [key: string]: number;
  };
  // Metadata
  source: ResultSource;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * EvergreenResult
 * For evergreen initiatives that don't have an event date.
 * Links to product, not initiative (null initiativeId means it's evergreen).
 */
export interface EvergreenResult {
  id: string;
  companyId: string;
  productId: string;
  initiativeId?: null; // explicitly null for evergreen
  weekStartDate: Date;
  weekEndDate: Date;
  // Revenue
  actualRevenue: number;
  // Spending
  actualSpend: number;
  // Metrics
  metrics: {
    [key: string]: number;
  };
  // Metadata
  source: ResultSource;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type Result = InitiativeResult | EvergreenResult;

export interface CreateInitiativeResultDTO {
  companyId: string;
  /**
   * The initiative this result belongs to, or null for a company-level result
   * not tied to any one initiative. `results.initiative_id` is nullable.
   */
  initiativeId: string | null;
  weekStartDate: Date;
  weekEndDate: Date;
  actualRevenue: number;
  /**
   * Optional: the Results tab records spend as expenses, not on the result.
   * Planner and onboarding still pass it. Defaults to 0 when omitted.
   */
  actualSpend?: number;
  metrics?: {
    [key: string]: number;
  };
  notes?: string;
}

export interface CreateEvergreenResultDTO {
  companyId: string;
  productId: string;
  weekStartDate: Date;
  weekEndDate: Date;
  actualRevenue: number;
  actualSpend: number;
  metrics?: {
    [key: string]: number;
  };
  notes?: string;
}

export interface UpdateResultDTO {
  actualRevenue?: number;
  actualSpend?: number;
  metrics?: Partial<{ [key: string]: number }>;
  notes?: string;
}
