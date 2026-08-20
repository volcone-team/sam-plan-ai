'use client';

import { useState, useEffect } from 'react';
import { Save, CheckCircle } from 'lucide-react';
import { companyService } from '@/services/company.service';
import type { Company } from '@/types';

const STORAGE_KEY = 'sam-flow-company-settings';

interface CompanyFormData {
  name: string;
  fiscalYear: number;
  planningYear: number;
  currency: 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD';
  priorYearRevenue: number;
  baselineRevenue: number;
  stretchRevenue: number;
  operatingBudget: number;
  description: string;
  stageOfBusiness: string;
}

export function CompanySettings() {
  const [formData, setFormData] = useState<CompanyFormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    async function loadCompany() {
      try {
        // Check localStorage first
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          setFormData(JSON.parse(saved));
          setLoading(false);
          return;
        }

        const company: Company = await companyService.getCompany();
        setFormData({
          name: company.name,
          fiscalYear: company.fiscalYear,
          planningYear: company.planningYear,
          currency: company.currency,
          priorYearRevenue: company.priorYearRevenue,
          baselineRevenue: company.baselineRevenue,
          stretchRevenue: company.stretchRevenue,
          operatingBudget: company.operatingBudget,
          description: company.description,
          stageOfBusiness: 'Growing Business',
        });
      } catch {
        // Fallback defaults
        setFormData({
          name: 'Elevate Coaching',
          fiscalYear: 2026,
          planningYear: 2026,
          currency: 'USD',
          priorYearRevenue: 450000,
          baselineRevenue: 495000,
          stretchRevenue: 900000,
          operatingBudget: 346500,
          description: 'A premium coaching and consulting firm',
          stageOfBusiness: 'Growing Business',
        });
      } finally {
        setLoading(false);
      }
    }
    loadCompany();
  }, []);

  const handleSave = () => {
    if (!formData) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(formData));
    setShowSuccess(true);
    setTimeout(() => setShowSuccess(false), 3000);
  };

  const handleChange = (field: keyof CompanyFormData, value: string | number) => {
    if (!formData) return;
    setFormData({ ...formData, [field]: value });
  };

  const formatCurrency = (value: number): string => {
    return value.toLocaleString('en-US');
  };

  const parseCurrency = (value: string): number => {
    return Number(value.replace(/[^0-9.-]/g, '')) || 0;
  };

  if (loading || !formData) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[hsl(var(--primary))] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Success Toast */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <CheckCircle className="h-4 w-4" />
          Company settings saved successfully.
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {/* Company Name */}
        <div className="space-y-2 sm:col-span-2">
          <label className="text-sm font-medium">Company Name</label>
          <input
            type="text"
            value={formData.name}
            onChange={e => handleChange('name', e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
          />
        </div>

        {/* Fiscal Year */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Fiscal Year</label>
          <select
            value={formData.fiscalYear}
            onChange={e => handleChange('fiscalYear', Number(e.target.value))}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
          >
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
        </div>

        {/* Planning Year */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Planning Year</label>
          <select
            value={formData.planningYear}
            onChange={e => handleChange('planningYear', Number(e.target.value))}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
          >
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
          </select>
        </div>

        {/* Currency */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Currency</label>
          <select
            value={formData.currency}
            onChange={e => handleChange('currency', e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
          >
            <option value="USD">USD — US Dollar</option>
            <option value="EUR">EUR — Euro</option>
            <option value="GBP">GBP — British Pound</option>
            <option value="CAD">CAD — Canadian Dollar</option>
            <option value="AUD">AUD — Australian Dollar</option>
          </select>
        </div>

        {/* Business Stage */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Business Stage</label>
          <select
            value={formData.stageOfBusiness}
            onChange={e => handleChange('stageOfBusiness', e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
          >
            <option value="Solo">Solo</option>
            <option value="Small Team">Small Team</option>
            <option value="Growing Business">Growing Business</option>
            <option value="Established Business">Established Business</option>
          </select>
        </div>

        {/* Prior-Year Revenue */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Prior-Year Revenue</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[hsl(var(--foreground-muted))]">$</span>
            <input
              type="text"
              value={formatCurrency(formData.priorYearRevenue)}
              onChange={e => handleChange('priorYearRevenue', parseCurrency(e.target.value))}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            />
          </div>
        </div>

        {/* Target Revenue — Baseline */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Target Revenue — Baseline</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[hsl(var(--foreground-muted))]">$</span>
            <input
              type="text"
              value={formatCurrency(formData.baselineRevenue)}
              onChange={e => handleChange('baselineRevenue', parseCurrency(e.target.value))}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            />
          </div>
        </div>

        {/* Target Revenue — Stretch */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Target Revenue — Stretch</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[hsl(var(--foreground-muted))]">$</span>
            <input
              type="text"
              value={formatCurrency(formData.stretchRevenue)}
              onChange={e => handleChange('stretchRevenue', parseCurrency(e.target.value))}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            />
          </div>
        </div>

        {/* Operating Budget */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Operating Budget</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[hsl(var(--foreground-muted))]">$</span>
            <input
              type="text"
              value={formatCurrency(formData.operatingBudget)}
              onChange={e => handleChange('operatingBudget', parseCurrency(e.target.value))}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background pl-7 pr-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
            />
          </div>
        </div>

        {/* Customer Description */}
        <div className="space-y-2 sm:col-span-2">
          <label className="text-sm font-medium">Customer Description</label>
          <textarea
            value={formData.description}
            onChange={e => handleChange('description', e.target.value)}
            rows={3}
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))] resize-none"
          />
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end border-t border-border pt-6">
        <button
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
        >
          <Save className="h-4 w-4" />
          Save Changes
        </button>
      </div>
    </div>
  );
}
