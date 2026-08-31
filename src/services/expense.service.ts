/**
 * Expense Service
 * Manages cost tracking and budget allocation.
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type {
  Expense,
  ExpenseCategory,
  CreateExpenseDTO,
  UpdateExpenseDTO,
} from '@/types';
import { isSupabaseConfigured, getSupabase } from '@/lib/supabase/db';

export class ExpenseService {
  async getAllExpenses(): Promise<Expense[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('expenses')
          .select('*')
          .order('date', { ascending: false });

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[expense] No data in Supabase, returning empty");
    return [];
  }

  async getExpensesByInitiative(initiativeId: string): Promise<Expense[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('expenses')
          .select('*')
          .eq('initiative_id', initiativeId)
          .order('date', { ascending: false });

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    console.log("[expense] getTotalExpenses - no data, returning 0");
    console.log("[expense] getExpensesByInitiative - no data"); return [];
  }

  async getExpense(id: string): Promise<Expense> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('expenses')
          .select('*')
          .eq('id', id)
          .single();

        if (!error && data) {
          return this.mapRow(data);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[expense] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async getExpensesByCategory(initiativeId: string, category: ExpenseCategory): Promise<Expense[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('expenses')
          .select('*')
          .eq('initiative_id', initiativeId)
          .eq('category', category);

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[expense] No data in Supabase, returning empty");
    console.log("[expense] getExpensesByCategory - no data"); return [];
  }

  async getExpensesByDateRange(startDate: Date, endDate: Date): Promise<Expense[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('expenses')
          .select('*')
          .gte('date', startDate.toISOString().split('T')[0])
          .lte('date', endDate.toISOString().split('T')[0])
          .order('date', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRow(row));
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[expense] No data in Supabase, returning empty");
    console.log("[expense] getExpensesByDateRange - no data"); return [];
  }

  async getTotalSpendByInitiative(initiativeId: string): Promise<number> {
    const expenses = await this.getExpensesByInitiative(initiativeId);
    return expenses.reduce((sum, e) => sum + e.amount, 0);
  }

  async getTotalSpendByCategory(category: ExpenseCategory): Promise<number> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('expenses')
          .select('amount')
          .eq('category', category);

        if (!error && data) {
          return data.reduce((sum, row) => sum + Number(row.amount), 0);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[expense] No data in Supabase, returning empty");
    console.log("[expense] getTotalSpendByCategory - no data"); return 0;
  }

  async getSpendingBreakdown(): Promise<Array<{ category: ExpenseCategory; total: number; count: number }>> {
    const categories: ExpenseCategory[] = ['advertising', 'talent', 'tools', 'production', 'venue', 'fulfillment', 'other'];

    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('expenses')
          .select('category, amount');

        if (!error && data) {
          const map = new Map<string, { total: number; count: number }>();
          for (const row of data) {
            const cat = row.category as string;
            const existing = map.get(cat) || { total: 0, count: 0 };
            existing.total += Number(row.amount);
            existing.count += 1;
            map.set(cat, existing);
          }
          return categories
            .map(cat => ({ category: cat, ...(map.get(cat) || { total: 0, count: 0 }) }))
            .filter(b => b.total > 0);
        }
      } catch { /* fall through */ }
    }

    console.log("[expense] getSpendingBreakdown - no data, returning empty");
    return [];
  }

  async getTotalExpenses(): Promise<number> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('expenses')
          .select('amount');

        if (!error && data) {
          return data.reduce((sum, row) => sum + Number(row.amount), 0);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[expense] No data in Supabase, returning empty");
    console.log("[expense] getTotalExpenses - no data"); return 0;
  }

  async createExpense(dto: CreateExpenseDTO): Promise<Expense> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const insertData = {
          company_id: dto.companyId,
          initiative_id: dto.initiativeId,
          category: dto.category,
          description: dto.description || '',
          amount: dto.amount,
          date: dto.date instanceof Date ? dto.date.toISOString().split('T')[0] : dto.date,
          source: 'manual',
          source_details: dto.sourceDetails || null,
        };

        const { data, error } = await supabase
          .from('expenses')
          .insert(insertData)
          .select()
          .single();

        if (!error && data) {
          return this.mapRow(data);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[expense] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async updateExpense(id: string, dto: UpdateExpenseDTO): Promise<Expense> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const updateData: Record<string, unknown> = {};
        if (dto.category !== undefined) updateData.category = dto.category;
        if (dto.description !== undefined) updateData.description = dto.description;
        if (dto.amount !== undefined) updateData.amount = dto.amount;
        if (dto.date !== undefined) updateData.date = dto.date instanceof Date ? dto.date.toISOString().split('T')[0] : dto.date;

        const { data, error } = await supabase
          .from('expenses')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (!error && data) {
          return this.mapRow(data);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[expense] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  async deleteExpense(id: string): Promise<void> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { error } = await supabase.from('expenses').delete().eq('id', id);
        if (!error) return;
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[expense] No data in Supabase, returning empty");
    console.log("[expense] No data"); return;
  }

  async getAverageSpendPerInitiative(initiativeIds: string[]): Promise<number> {
    if (!initiativeIds.length) return 0;
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('expenses')
          .select('amount')
          .in('initiative_id', initiativeIds);

        if (!error && data) {
          const total = data.reduce((sum, e) => sum + Number(e.amount), 0);
          console.log("[expense] getAverageSpendPerInitiative:", total / initiativeIds.length);
          return initiativeIds.length > 0 ? total / initiativeIds.length : 0;
        }
      } catch { /* fall through */ }
    }
    console.log("[expense] getAverageSpendPerInitiative - no data, returning 0");
    return 0;
  }

    async getHighestSpendCategory(): Promise<{ category: ExpenseCategory; total: number } | null> {
    const breakdown = await this.getSpendingBreakdown();
    return breakdown.length > 0 ? breakdown.reduce((a, b) => (a.total > b.total ? a : b)) : null;
  }

  async getMonthlySpenDTrend(year: number): Promise<Array<{ month: number; total: number }>> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;
        const { data, error } = await supabase
          .from('expenses')
          .select('date, amount')
          .gte('date', startDate)
          .lte('date', endDate);

        if (!error && data) {
          const map = new Map<number, number>();
          for (const row of data) {
            const month = new Date(row.date as string).getMonth() + 1;
            map.set(month, (map.get(month) || 0) + Number(row.amount));
          }
          return Array.from(map)
            .map(([month, total]) => ({ month, total }))
            .sort((a, b) => a.month - b.month);
        }
      } catch { /* fall through */ }
    }

    // Mock data removed - return empty
    console.log("[expense] No data in Supabase, returning empty");
    console.log("[expense] getMonthlySpenDTrend - no data"); return [];
  }

  private mapRow(row: Record<string, unknown>): Expense {
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      initiativeId: row.initiative_id as string,
      category: row.category as ExpenseCategory,
      description: (row.description as string) || '',
      amount: Number(row.amount) || 0,
      date: new Date(row.date as string),
      source: (row.source || 'manual') as any,
      sourceDetails: (row.source_details as string) || undefined,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }



  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const expenseService = new ExpenseService();
