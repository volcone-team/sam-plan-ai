/**
 * Expense domain types
 * Per-initiative cost line items
 * v1: simplified planned vs. actual on Initiative
 * Future: itemized expense tracking with category breakdown
 */

export type ExpenseCategory =
  | 'advertising'
  | 'talent'
  | 'tools'
  | 'production'
  | 'venue'
  | 'fulfillment'
  | 'other';

export type ExpenseSource = 'manual' | 'integration';

export interface Expense {
  id: string;
  companyId: string;
  initiativeId: string;
  // Categorization
  category: ExpenseCategory;
  description: string;
  // Amount
  amount: number;
  // Date
  date: Date;
  // Source
  source: ExpenseSource;
  sourceDetails?: string; // e.g., integration name, payment method
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateExpenseDTO {
  companyId: string;
  initiativeId: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: Date;
  source?: ExpenseSource;
  sourceDetails?: string;
}

export interface UpdateExpenseDTO {
  category?: ExpenseCategory;
  description?: string;
  amount?: number;
  date?: Date;
  sourceDetails?: string;
}

/**
 * InitiativeExpenseSummary
 * Aggregated expense view for an initiative
 */
export interface InitiativeExpenseSummary {
  initiativeId: string;
  totalExpenses: number;
  byCategory: {
    category: ExpenseCategory;
    amount: number;
    count: number;
  }[];
  expenses: Expense[];
}
