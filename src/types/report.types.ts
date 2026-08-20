/**
 * Report domain types
 * Business reporting and analytics
 */

export type ReportType =
  | 'revenue_summary'
  | 'revenue_by_product'
  | 'revenue_by_initiative'
  | 'expense_summary'
  | 'roi_analysis'
  | 'weekly_status'
  | 'monthly_review'
  | 'quarterly_review'
  | 'annual_review';

export interface RevenueByProduct {
  productId: string;
  productName: string;
  revenue: number;
  percentOfTotal: number;
}

export interface RevenueByInitiative {
  initiativeId: string;
  initiativeName: string;
  revenue: number;
  percentOfTotal: number;
  roi?: number;
}

export interface ExpenseByCategory {
  category: string;
  amount: number;
  percentOfTotal: number;
}

export interface ROIAnalysis {
  initiativeId: string;
  initiativeName: string;
  revenue: number;
  expenses: number;
  netRevenue: number;
  roi: number;
  roiPercentage: number;
}

export interface Report {
  id: string;
  companyId: string;
  reportType: ReportType;
  // Date range
  startDate: Date;
  endDate: Date;
  // Summary metrics
  totalRevenue: number;
  totalExpenses: number;
  netRevenue: number;
  grossMargin: number; // (totalRevenue - totalExpenses) / totalRevenue * 100
  // Breakdowns
  revenueByProduct?: RevenueByProduct[];
  revenueByInitiative?: RevenueByInitiative[];
  expenseByCategory?: ExpenseByCategory[];
  roiAnalyses?: ROIAnalysis[];
  // Summary
  summary?: string;
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateReportDTO {
  companyId: string;
  reportType: ReportType;
  startDate: Date;
  endDate: Date;
  summary?: string;
}

export interface ReportSummary {
  period: string; // e.g., "Q2 2024", "Week of June 17"
  totalRevenue: number;
  totalExpenses: number;
  netRevenue: number;
  topInitiative: {
    name: string;
    revenue: number;
  } | null;
  topProduct: {
    name: string;
    revenue: number;
  } | null;
}
