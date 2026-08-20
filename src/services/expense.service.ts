/**
 * Expense Service
 * Manages cost tracking and budget allocation
 */

import type {
  Expense,
  ExpenseCategory,
  CreateExpenseDTO,
  UpdateExpenseDTO,
} from '@/types';
import expensesData from '@/mock-data/expenses.json';

export class ExpenseService {
  /**
   * Get all expenses
   */
  async getAllExpenses(): Promise<Expense[]> {
    await this.delay();
    
    return expensesData.map(e => this.transformExpenseData(e));
  }

  /**
   * Get expenses by initiative
   */
  async getExpensesByInitiative(initiativeId: string): Promise<Expense[]> {
    await this.delay();
    
    return expensesData
      .filter(e => e.initiativeId === initiativeId)
      .map(e => this.transformExpenseData(e));
  }

  /**
   * Get a specific expense
   */
  async getExpense(id: string): Promise<Expense> {
    await this.delay();
    
    const expense = expensesData.find(e => e.id === id);
    if (!expense) {
      throw new Error(`Expense ${id} not found`);
    }

    return this.transformExpenseData(expense);
  }

  /**
   * Get expenses by category
   */
  async getExpensesByCategory(
    initiativeId: string,
    category: ExpenseCategory
  ): Promise<Expense[]> {
    await this.delay();
    
    return expensesData
      .filter(e => e.initiativeId === initiativeId && e.category === category)
      .map(e => this.transformExpenseData(e));
  }

  /**
   * Get expenses by date range
   */
  async getExpensesByDateRange(
    startDate: Date,
    endDate: Date
  ): Promise<Expense[]> {
    await this.delay();
    
    return expensesData
      .filter(e => {
        const date = new Date(e.date);
        return date >= startDate && date <= endDate;
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(e => this.transformExpenseData(e));
  }

  /**
   * Get total spending by initiative
   */
  async getTotalSpendByInitiative(initiativeId: string): Promise<number> {
    await this.delay();
    
    const expenses = await this.getExpensesByInitiative(initiativeId);
    return expenses.reduce((sum, e) => sum + e.amount, 0);
  }

  /**
   * Get total spending by category
   */
  async getTotalSpendByCategory(category: ExpenseCategory): Promise<number> {
    await this.delay();
    
    const categoryExpenses = expensesData.filter(e => e.category === category);
    return categoryExpenses.reduce((sum, e) => sum + e.amount, 0);
  }

  /**
   * Get spending breakdown by category
   */
  async getSpendingBreakdown(): Promise<
    Array<{ category: ExpenseCategory; total: number; count: number }>
  > {
    await this.delay();
    
    const categories: ExpenseCategory[] = [
      'advertising',
      'talent',
      'tools',
      'production',
      'venue',
      'fulfillment',
      'other',
    ];

    const breakdown = await Promise.all(
      categories.map(async category => ({
        category,
        total: await this.getTotalSpendByCategory(category),
        count: expensesData.filter(e => e.category === category).length,
      }))
    );

    return breakdown.filter(b => b.total > 0);
  }

  /**
   * Get total expenses across company
   */
  async getTotalExpenses(): Promise<number> {
    await this.delay();
    
    return expensesData.reduce((sum, e) => sum + e.amount, 0);
  }

  /**
   * Create an expense
   */
  async createExpense(dto: CreateExpenseDTO): Promise<Expense> {
    await this.delay();
    
    const newExpense = {
      id: `exp-${Date.now()}`,
      ...dto,
      date: dto.date.toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expensesData.push(newExpense as any);
    return this.transformExpenseData(newExpense as any);
  }

  /**
   * Update expense
   */
  async updateExpense(id: string, dto: UpdateExpenseDTO): Promise<Expense> {
    await this.delay();
    
    const index = expensesData.findIndex(e => e.id === id);
    if (index === -1) {
      throw new Error(`Expense ${id} not found`);
    }

    const updated = {
      ...expensesData[index],
      ...dto,
      date: dto.date ? dto.date.toISOString() : expensesData[index].date,
      updatedAt: new Date().toISOString(),
    };

    expensesData[index] = updated as any;
    return this.transformExpenseData(updated as any);
  }

  /**
   * Delete an expense
   */
  async deleteExpense(id: string): Promise<void> {
    await this.delay();
    
    const index = expensesData.findIndex(e => e.id === id);
    if (index === -1) {
      throw new Error(`Expense ${id} not found`);
    }

    expensesData.splice(index, 1);
  }

  /**
   * Get average spending per initiative
   */
  async getAverageSpendPerInitiative(initiativeIds: string[]): Promise<number> {
    await this.delay();
    
    const totalSpend = await Promise.all(
      initiativeIds.map(id => this.getTotalSpendByInitiative(id))
    );

    const sum = totalSpend.reduce((a, b) => a + b, 0);
    return initiativeIds.length > 0 ? sum / initiativeIds.length : 0;
  }

  /**
   * Get highest spend category
   */
  async getHighestSpendCategory(): Promise<{ category: ExpenseCategory; total: number } | null> {
    await this.delay();
    
    const breakdown = await this.getSpendingBreakdown();
    return breakdown.length > 0
      ? breakdown.reduce((a, b) => (a.total > b.total ? a : b))
      : null;
  }

  /**
   * Get monthly spend trend
   */
  async getMonthlySpenDTrend(year: number): Promise<
    Array<{ month: number; total: number }>
  > {
    await this.delay();
    
    const monthlySpend = new Map<number, number>();

    expensesData.forEach(e => {
      const date = new Date(e.date);
      if (date.getFullYear() === year) {
        const month = date.getMonth() + 1;
        monthlySpend.set(month, (monthlySpend.get(month) || 0) + e.amount);
      }
    });

    return Array.from(monthlySpend)
      .map(([month, total]) => ({ month, total }))
      .sort((a, b) => a.month - b.month);
  }

  /**
   * Transform expense data
   */
  private transformExpenseData(data: typeof expensesData[0]): Expense {
    return {
      id: data.id,
      companyId: (data as any).companyId,
      initiativeId: data.initiativeId,
      category: data.category as ExpenseCategory,
      description: (data as any).description || '',
      amount: data.amount,
      date: new Date(data.date),
      source: (data.source as any) || 'manual',
      sourceDetails: (data as any).sourceDetails,
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

export const expenseService = new ExpenseService();
