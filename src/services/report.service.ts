/**
 * Report Service
 * Generates business analytics and insights
 */

import type { Report, ReportType } from '@/types';
import reportsData from '@/mock-data/reports.json';
import { resultService } from './result.service';
import { expenseService } from './expense.service';
import { initiativeService } from './initiative.service';

export class ReportService {
  /**
   * Get all reports
   */
  async getAllReports(): Promise<Report[]> {
    await this.delay();
    
    return reportsData.map(r => this.transformReportData(r));
  }

  /**
   * Get a specific report
   */
  async getReport(id: string): Promise<Report> {
    await this.delay();
    
    const report = reportsData.find(r => r.id === id);
    if (!report) {
      throw new Error(`Report ${id} not found`);
    }

    return this.transformReportData(report);
  }

  /**
   * Get reports by type
   */
  async getReportsByType(type: ReportType): Promise<Report[]> {
    await this.delay();
    
    return reportsData
      .filter(r => r.reportType === type)
      .map(r => this.transformReportData(r));
  }

  /**
   * Get reports by period
   */
  async getReportsByPeriod(
    startDate: Date,
    endDate: Date
  ): Promise<Report[]> {
    await this.delay();
    
    return reportsData
      .filter(r => {
        const date = new Date(r.createdAt);
        return date >= startDate && date <= endDate;
      })
      .sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )
      .map(r => this.transformReportData(r));
  }

  /**
   * Get latest report by type
   */
  async getLatestReportByType(type: ReportType): Promise<Report | null> {
    await this.delay();
    
    const reports = reportsData
      .filter(r => r.reportType === type)
      .sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    return reports.length > 0 ? this.transformReportData(reports[0]) : null;
  }

  /**
   * Generate revenue summary report
   */
  async generateRevenueSummary(
    companyId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Report> {
    await this.delay();
    
    const results = await resultService.getResultsByDateRange(startDate, endDate);
    const totalRevenue = results.reduce((sum, r) => sum + r.actualRevenue, 0);
    const totalExpenses = results.reduce((sum, r) => sum + r.actualSpend, 0);

    const report: Omit<Report, 'id' | 'createdAt' | 'updatedAt'> = {
      companyId,
      reportType: 'revenue_summary',
      startDate,
      endDate,
      totalRevenue,
      totalExpenses,
      netRevenue: totalRevenue - totalExpenses,
      grossMargin: totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue) * 100 : 0,
    };

    return this.createReport(report);
  }

  /**
   * Generate ROI analysis report
   */
  async generateROIAnalysis(
    companyId: string,
    initiativeId: string
  ): Promise<Report> {
    await this.delay();
    
    const totalRevenue = await resultService.getTotalRevenueByInitiative(initiativeId);
    const totalSpend = await resultService.getTotalSpendByInitiative(initiativeId);
    const roi = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : 0;
    const roiPercentage = totalSpend > 0 ? ((totalRevenue - totalSpend) / totalSpend) * 100 : 0;
    
    const initiative = await initiativeService.getInitiative(initiativeId);

    const report: Omit<Report, 'id' | 'createdAt' | 'updatedAt'> = {
      companyId,
      reportType: 'roi_analysis',
      startDate: new Date(),
      endDate: new Date(),
      totalRevenue,
      totalExpenses: totalSpend,
      netRevenue: totalRevenue - totalSpend,
      grossMargin: totalRevenue > 0 ? ((totalRevenue - totalSpend) / totalRevenue) * 100 : 0,
      roiAnalyses: [
        {
          initiativeId,
          initiativeName: initiative.name,
          revenue: totalRevenue,
          expenses: totalSpend,
          netRevenue: totalRevenue - totalSpend,
          roi,
          roiPercentage,
        },
      ],
    };

    return this.createReport(report);
  }

  /**
   * Generate weekly status report
   */
  async generateWeeklyStatus(
    companyId: string,
    weekStartDate: Date
  ): Promise<Report> {
    await this.delay();
    
    const weekEndDate = new Date(weekStartDate);
    weekEndDate.setDate(weekEndDate.getDate() + 6);

    const weekRevenue = await resultService.getWeeklyRevenue(companyId, weekStartDate);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const trend = await resultService.getWeeklyTrend(companyId, weekStartDate);

    const report: Omit<Report, 'id' | 'createdAt' | 'updatedAt'> = {
      companyId,
      reportType: 'weekly_status',
      startDate: weekStartDate,
      endDate: weekEndDate,
      totalRevenue: weekRevenue,
      totalExpenses: 0,
      netRevenue: weekRevenue,
      grossMargin: 100,
    };

    return this.createReport(report);
  }

  /**
   * Create a report record
   */
  private async createReport(
    dto: Omit<Report, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<Report> {
    const newReport = {
      id: `report-${Date.now()}`,
      ...dto,
      startDate: dto.startDate instanceof Date ? dto.startDate.toISOString() : dto.startDate,
      endDate: dto.endDate instanceof Date ? dto.endDate.toISOString() : dto.endDate,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    (reportsData as any[]).push(newReport);
    return this.transformReportData(newReport as any);
  }

  /**
   * Transform report data
   */
  private transformReportData(data: typeof reportsData[0]): Report {
    return {
      id: data.id,
      companyId: (data as any).companyId,
      reportType: ((data as any).reportType || (data as any).type) as ReportType,
      startDate: new Date((data as any).startDate || (data as any).period?.startDate),
      endDate: new Date((data as any).endDate || (data as any).period?.endDate),
      totalRevenue: (data as any).totalRevenue || 0,
      totalExpenses: (data as any).totalExpenses || 0,
      netRevenue: (data as any).netRevenue || 0,
      grossMargin: (data as any).grossMargin || 0,
      revenueByProduct: (data as any).revenueByProduct,
      revenueByInitiative: (data as any).revenueByInitiative,
      expenseByCategory: (data as any).expenseByCategory,
      roiAnalyses: (data as any).roiAnalyses,
      summary: (data as any).summary,
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

export const reportService = new ReportService();
