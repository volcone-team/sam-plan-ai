'use client';

import { useEffect, useState } from 'react';
import {
  Plus,
  DollarSign,
  TrendingUp,
  Calendar,
  FileText,
  Loader2,
  X,
  BarChart3,
  Receipt,
} from 'lucide-react';
import type { InitiativeResult, ExpenseCategory } from '@/types';
import type { Expense } from '@/types/expense.types';
import { resultService } from '@/services/result.service';
import { expenseService } from '@/services/expense.service';
import { initiativeService } from '@/services/initiative.service';
import { initiativeTypeService } from '@/services/initiative-type.service';

export interface InitiativeResultsProps {
  initiativeId: string;
}

const companyId = 'comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d';

const categoryLabels: Record<ExpenseCategory, string> = {
  advertising: 'Advertising',
  talent: 'Talent',
  tools: 'Tools',
  production: 'Production',
  venue: 'Venue',
  fulfillment: 'Fulfillment',
  other: 'Other',
};

const categoryColors: Record<ExpenseCategory, string> = {
  advertising: 'bg-purple-100 text-purple-700',
  talent: 'bg-blue-100 text-blue-700',
  tools: 'bg-indigo-100 text-indigo-700',
  production: 'bg-amber-100 text-amber-700',
  venue: 'bg-green-100 text-green-700',
  fulfillment: 'bg-teal-100 text-teal-700',
  other: 'bg-gray-100 text-gray-700',
};

export function InitiativeResults({ initiativeId }: InitiativeResultsProps) {
  const [results, setResults] = useState<InitiativeResult[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddResult, setShowAddResult] = useState(false);
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [metricKeys, setMetricKeys] = useState<string[]>([]);

  useEffect(() => {
    loadData();
  }, [initiativeId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [resultsData, expensesData] = await Promise.all([
        resultService.getResultsByInitiative(initiativeId),
        expenseService.getExpensesByInitiative(initiativeId),
      ]);
      setResults(resultsData.sort((a, b) => new Date(b.weekStartDate).getTime() - new Date(a.weekStartDate).getTime()));
      setExpenses(expensesData.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));

      // Load initiative type to get benchmark metric keys
      try {
        const initiative = await initiativeService.getInitiative(initiativeId);
        const initType = await initiativeTypeService.getInitiativeType(initiative.initiativeTypeId);
        setMetricKeys(Object.keys(initType.benchmarks));
      } catch {
        // If we can't load type, just show empty metrics
      }
    } catch (err) {
      console.error('Failed to load results/expenses:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddResult = async (data: ResultFormData) => {
    try {
      const newResult = await resultService.createInitiativeResult({
        companyId: companyId,
        initiativeId,
        weekStartDate: new Date(data.weekStartDate),
        weekEndDate: new Date(data.weekEndDate),
        actualRevenue: data.actualRevenue,
        actualSpend: data.actualSpend,
        metrics: data.metrics,
        notes: data.notes,
      });
      setResults(prev => [newResult, ...prev]);
      setShowAddResult(false);
    } catch (err) {
      console.error('Failed to add result:', err);
    }
  };

  const handleUpdateResult = async (id: string, updates: { actualRevenue: number; actualSpend: number; metrics: Record<string, number>; notes: string }) => {
    try {
      await resultService.updateResult(id, updates);
      setResults(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    } catch (err) {
      console.error('Failed to update result:', err);
    }
  };

  const handleDeleteResult = (id: string) => {
    setResults(prev => prev.filter(r => r.id !== id));
  };

  const handleDeleteExpense = async (id: string) => {
    try {
      await expenseService.deleteExpense(id);
      setExpenses(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      console.error('Failed to delete expense:', err);
    }
  };

  const handleAddExpense = async (data: ExpenseFormData) => {
    try {
      const newExpense = await expenseService.createExpense({
        companyId: companyId,
        initiativeId,
        category: data.category,
        description: data.description,
        amount: data.amount,
        date: new Date(data.date),
      });
      setExpenses(prev => [newExpense, ...prev]);
      setShowAddExpense(false);
    } catch (err) {
      console.error('Failed to add expense:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        <span className="ml-2 text-sm text-[hsl(var(--foreground-muted))]">Loading results...</span>
      </div>
    );
  }

  // Aggregate totals
  const totalRevenue = results.reduce((sum, r) => sum + r.actualRevenue, 0);
  const totalSpend = results.reduce((sum, r) => sum + r.actualSpend, 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-8">
      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard icon={TrendingUp} label="Total Revenue" value={totalRevenue} color="text-green-600" />
        <SummaryCard icon={DollarSign} label="Total Spend (Results)" value={totalSpend} color="text-blue-600" />
        <SummaryCard icon={Receipt} label="Total Expenses" value={totalExpenses} color="text-orange-600" />
      </div>

      {/* Results Log */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-[hsl(var(--primary))]" />
            Results Log ({results.length})
          </h2>
          <button
            onClick={() => setShowAddResult(true)}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            Add Result
          </button>
        </div>

        {showAddResult && (
          <ResultForm metricKeys={metricKeys} onSubmit={handleAddResult} onCancel={() => setShowAddResult(false)} />
        )}

        {results.length === 0 && !showAddResult ? (
          <EmptySection message="No results recorded yet. Add weekly results to track initiative performance." />
        ) : (
          <div className="space-y-2">
            {results.map(result => (
              <ResultRow key={result.id} result={result} metricKeys={metricKeys} onUpdate={handleUpdateResult} onDelete={handleDeleteResult} />
            ))}
          </div>
        )}
      </section>

      {/* Expenses */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
            <Receipt className="h-5 w-5 text-[hsl(var(--primary))]" />
            Expenses ({expenses.length})
          </h2>
          <button
            onClick={() => setShowAddExpense(true)}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            Add Expense
          </button>
        </div>

        {showAddExpense && (
          <ExpenseForm onSubmit={handleAddExpense} onCancel={() => setShowAddExpense(false)} />
        )}

        {expenses.length === 0 && !showAddExpense ? (
          <EmptySection message="No expenses recorded yet. Track costs to calculate ROI." />
        ) : (
          <div className="space-y-2">
            {expenses.map(expense => (
              <ExpenseRow key={expense.id} expense={expense} onDelete={handleDeleteExpense} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────────────────────────────
 * Summary Card
 * ───────────────────────────────────────────────── */

function SummaryCard({ icon: Icon, label, value, color }: { icon: typeof DollarSign; label: string; value: number; color: string }) {
  const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(value);
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-xs font-medium text-[hsl(var(--foreground-muted))]">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{formatted}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────
 * Result Row
 * ───────────────────────────────────────────────── */

function ResultRow({ result, metricKeys, onUpdate, onDelete }: { result: InitiativeResult; metricKeys: string[]; onUpdate: (id: string, updates: { actualRevenue: number; actualSpend: number; metrics: Record<string, number>; notes: string }) => void; onDelete: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [editRevenue, setEditRevenue] = useState(result.actualRevenue);
  const [editSpend, setEditSpend] = useState(result.actualSpend);
  const [editMetrics, setEditMetrics] = useState<Record<string, number>>(result.metrics as Record<string, number> || {});
  const [editNotes, setEditNotes] = useState(result.notes || '');

  const formatDate = (date: Date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const formatCurrency = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);

  function handleSave() {
    onUpdate(result.id, { actualRevenue: editRevenue, actualSpend: editSpend, metrics: editMetrics, notes: editNotes });
    setEditing(false);
  }

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-[hsl(var(--foreground-muted))] inline-flex items-center gap-1">
          <Calendar className="h-3 w-3" />
          {formatDate(result.weekStartDate)} – {formatDate(result.weekEndDate)}
        </span>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditing(!editing)} className="text-xs text-[hsl(var(--primary))] hover:underline">
            {editing ? 'Cancel' : 'Edit'}
          </button>
          <button onClick={() => { if (window.confirm('Delete this result?')) onDelete(result.id); }} className="text-xs text-red-500 hover:underline">
            Delete
          </button>
        </div>
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[hsl(var(--foreground-muted))] mb-1">Revenue</label>
              <input type="number" value={editRevenue} onChange={e => setEditRevenue(parseFloat(e.target.value) || 0)} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-[hsl(var(--primary))]" />
            </div>
            <div>
              <label className="block text-xs text-[hsl(var(--foreground-muted))] mb-1">Spend</label>
              <input type="number" value={editSpend} onChange={e => setEditSpend(parseFloat(e.target.value) || 0)} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-[hsl(var(--primary))]" />
            </div>
          </div>
          {metricKeys.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {metricKeys.map(key => (
                <div key={key}>
                  <label className="block text-xs text-[hsl(var(--foreground-muted))] mb-1 capitalize">{key.replace(/_/g, ' ')}</label>
                  <input type="number" step="any" value={editMetrics[key] || ''} onChange={e => setEditMetrics(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-[hsl(var(--primary))]" />
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="block text-xs text-[hsl(var(--foreground-muted))] mb-1">Notes</label>
            <input type="text" value={editNotes} onChange={e => setEditNotes(e.target.value)} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-[hsl(var(--primary))]" />
          </div>
          <button onClick={handleSave} className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90">Save</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Revenue</p>
              <p className="text-sm font-bold text-green-600">{formatCurrency(result.actualRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Spend</p>
              <p className="text-sm font-bold text-blue-600">{formatCurrency(result.actualSpend)}</p>
            </div>
            {Object.keys(result.metrics).length > 0 && (
              <div>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">Metrics</p>
                <div className="flex flex-wrap gap-1.5 mt-0.5">
                  {Object.entries(result.metrics).slice(0, 3).map(([key, val]) => (
                    <span key={key} className="text-xs bg-[hsl(var(--background-muted))] px-1.5 py-0.5 rounded">
                      {key.replace(/_/g, ' ')}: {typeof val === 'number' && val < 1 ? `${(val * 100).toFixed(0)}%` : val}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          {result.notes && (
            <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))] flex items-start gap-1">
              <FileText className="h-3 w-3 mt-0.5 shrink-0" />
              {result.notes}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────
 * Expense Row
 * ───────────────────────────────────────────────── */

function ExpenseRow({ expense, onDelete }: { expense: Expense; onDelete: (id: string) => void }) {
  const formatDate = (date: Date) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  const formatCurrency = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n);
  const catConfig = categoryColors[expense.category] || categoryColors.other;

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${catConfig}`}>
            {categoryLabels[expense.category]}
          </span>
          <span className="text-xs text-[hsl(var(--foreground-muted))]">{formatDate(expense.date)}</span>
        </div>
        <p className="text-sm text-[hsl(var(--foreground))]">{expense.description}</p>
        {expense.sourceDetails && (
          <p className="text-xs text-[hsl(var(--foreground-muted))] mt-0.5">{expense.sourceDetails}</p>
        )}
      </div>
      <p className="text-sm font-bold text-[hsl(var(--foreground))] shrink-0">{formatCurrency(expense.amount)}</p>
      <button
        onClick={() => { if (window.confirm('Delete this expense?')) onDelete(expense.id); }}
        className="text-xs text-red-500 hover:underline shrink-0"
      >
        Delete
      </button>
    </div>
  );
}

/* ─────────────────────────────────────────────────
 * Empty Section
 * ───────────────────────────────────────────────── */

function EmptySection({ message }: { message: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-8 text-center">
      <p className="text-sm text-[hsl(var(--foreground-muted))]">{message}</p>
    </div>
  );
}

/* ─────────────────────────────────────────────────
 * Result Form
 * ───────────────────────────────────────────────── */

interface ResultFormData {
  weekStartDate: string;
  weekEndDate: string;
  actualRevenue: number;
  actualSpend: number;
  metrics: Record<string, number>;
  notes: string;
}

function ResultForm({ metricKeys, onSubmit, onCancel }: { metricKeys: string[]; onSubmit: (data: ResultFormData) => void; onCancel: () => void }) {
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay() + 1); // Monday
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6); // Sunday

  const [formData, setFormData] = useState<ResultFormData>({
    weekStartDate: weekStart.toISOString().split('T')[0],
    weekEndDate: weekEnd.toISOString().split('T')[0],
    actualRevenue: 0,
    actualSpend: 0,
    metrics: {},
    notes: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const handleMetricChange = (key: string, value: number) => {
    setFormData(p => ({ ...p, metrics: { ...p.metrics, [key]: value } }));
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-[var(--radius-lg)] border border-border bg-card p-5 space-y-4 mb-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Add Weekly Result</h3>
        <button type="button" onClick={onCancel} className="p-1 rounded hover:bg-[hsl(var(--background-muted))]">
          <X className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Week Start</label>
          <input type="date" value={formData.weekStartDate} onChange={e => setFormData(p => ({ ...p, weekStartDate: e.target.value }))} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Week End</label>
          <input type="date" value={formData.weekEndDate} onChange={e => setFormData(p => ({ ...p, weekEndDate: e.target.value }))} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Revenue ($)</label>
          <input type="number" min="0" step="1" value={formData.actualRevenue} onChange={e => setFormData(p => ({ ...p, actualRevenue: parseFloat(e.target.value) || 0 }))} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Spend ($)</label>
          <input type="number" min="0" step="1" value={formData.actualSpend} onChange={e => setFormData(p => ({ ...p, actualSpend: parseFloat(e.target.value) || 0 }))} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]" />
        </div>
      </div>

      {/* Dynamic Metrics based on initiative type */}
      {metricKeys.length > 0 && (
        <div>
          <label className="block text-xs font-semibold text-[hsl(var(--foreground))] mb-2">Conversion Metrics</label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metricKeys.map(key => (
              <div key={key}>
                <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1 capitalize">
                  {key.replace(/_/g, ' ')}
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formData.metrics[key] || ''}
                  onChange={e => handleMetricChange(key, parseFloat(e.target.value) || 0)}
                  placeholder="0"
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Notes</label>
        <textarea rows={2} value={formData.notes} onChange={e => setFormData(p => ({ ...p, notes: e.target.value }))} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] resize-none" placeholder="What happened this week..." />
      </div>

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] border border-border hover:bg-[hsl(var(--background-muted))]">Cancel</button>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90">Add Result</button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────────
 * Expense Form
 * ───────────────────────────────────────────────── */

interface ExpenseFormData {
  category: ExpenseCategory;
  description: string;
  amount: number;
  date: string;
}

function ExpenseForm({ onSubmit, onCancel }: { onSubmit: (data: ExpenseFormData) => void; onCancel: () => void }) {
  const [formData, setFormData] = useState<ExpenseFormData>({
    category: 'other',
    description: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.description.trim()) return;
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-[var(--radius-lg)] border border-border bg-card p-5 space-y-4 mb-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Add Expense</h3>
        <button type="button" onClick={onCancel} className="p-1 rounded hover:bg-[hsl(var(--background-muted))]">
          <X className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Category</label>
          <select value={formData.category} onChange={e => setFormData(p => ({ ...p, category: e.target.value as ExpenseCategory }))} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]">
            {Object.entries(categoryLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Amount ($)</label>
          <input type="number" min="0" step="1" value={formData.amount} onChange={e => setFormData(p => ({ ...p, amount: parseFloat(e.target.value) || 0 }))} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]" />
        </div>
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Date</label>
          <input type="date" value={formData.date} onChange={e => setFormData(p => ({ ...p, date: e.target.value }))} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]" />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Description *</label>
        <input type="text" required value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]" placeholder="What was this expense for..." />
      </div>

      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] border border-border hover:bg-[hsl(var(--background-muted))]">Cancel</button>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-[var(--radius-md)] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90">Add Expense</button>
      </div>
    </form>
  );
}
