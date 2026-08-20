'use client';

import { useState } from 'react';
import { BarChart3, Package, Receipt, PieChart } from 'lucide-react';
import { RevenueReport } from './revenue-report';
import { ProductsReport } from './products-report';
import { ExpensesReport } from './expenses-report';
import { ROIReport } from './roi-report';

type ReportTab = 'revenue' | 'products' | 'expenses' | 'roi';

interface TabConfig {
  id: ReportTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: TabConfig[] = [
  { id: 'revenue', label: 'Revenue', icon: BarChart3 },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'expenses', label: 'Expenses', icon: Receipt },
  { id: 'roi', label: 'ROI', icon: PieChart },
];

export function ReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>('revenue');

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-border">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Report tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                    : 'border-transparent text-[hsl(var(--foreground-muted))] hover:border-border hover:text-[hsl(var(--foreground))]'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'revenue' && <RevenueReport />}
        {activeTab === 'products' && <ProductsReport />}
        {activeTab === 'expenses' && <ExpensesReport />}
        {activeTab === 'roi' && <ROIReport />}
      </div>
    </div>
  );
}
