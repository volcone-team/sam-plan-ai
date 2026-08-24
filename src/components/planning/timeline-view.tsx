'use client';
import { formatDate, formatDateShort } from '@/lib/format-date';

import { useCompanyId } from '@/hooks/use-auth';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  AlertCircle,
  Filter,
} from 'lucide-react';
import { initiativeService } from '@/services/initiative.service';
import { productService } from '@/services/product.service';
import type { Initiative, Product } from '@/types';


const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-slate-400',
  in_progress: 'bg-blue-500',
  launched: 'bg-emerald-500',
  completed: 'bg-purple-500',
  paused: 'bg-amber-500',
  retired: 'bg-gray-400',
};

const STATUS_LABELS: Record<string, string> = {
  planned: 'Planned',
  in_progress: 'In Progress',
  launched: 'Launched',
  completed: 'Completed',
  paused: 'Paused',
  retired: 'Retired',
};

interface QuarterGroup {
  label: string;
  quarter: number;
  initiatives: Initiative[];
}

function getMonthPosition(date: Date): number {
  const month = date.getMonth();
  const day = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), month + 1, 0).getDate();
  return month + (day / daysInMonth);
}

function getQuarterForDate(date: Date): number {
  return Math.floor(date.getMonth() / 3) + 1;
}

export function TimelineView() {
  const companyId = useCompanyId() || "";
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>('all');

  useEffect(() => {
    if (!companyId) return;
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [allInitiatives, allProducts] = await Promise.all([
          initiativeService.getInitiativesByCompany(companyId),
          productService.getProductsByCompany(companyId),
        ]);

        setInitiatives(allInitiatives);
        setProducts(allProducts);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load timeline data';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [companyId]);

  const filteredInitiatives = useMemo(() => {
    if (selectedProduct === 'all') return initiatives;
    return initiatives.filter(i => i.productId === selectedProduct);
  }, [initiatives, selectedProduct]);

  const quarterGroups: QuarterGroup[] = useMemo(() => {
    const groups: QuarterGroup[] = [
      { label: 'Q1 (Jan – Mar)', quarter: 1, initiatives: [] },
      { label: 'Q2 (Apr – Jun)', quarter: 2, initiatives: [] },
      { label: 'Q3 (Jul – Sep)', quarter: 3, initiatives: [] },
      { label: 'Q4 (Oct – Dec)', quarter: 4, initiatives: [] },
    ];

    filteredInitiatives.forEach(init => {
      const activationQ = getQuarterForDate(new Date(init.activationDate));
      const groupIdx = activationQ - 1;
      if (groupIdx >= 0 && groupIdx < 4) {
        groups[groupIdx].initiatives.push(init);
      }
    });

    // Sort within each quarter by activation date
    groups.forEach(g => {
      g.initiatives.sort(
        (a, b) => new Date(a.activationDate).getTime() - new Date(b.activationDate).getTime()
      );
    });

    return groups;
  }, [filteredInitiatives]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--foreground-muted))]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-destructive/50 bg-destructive/5 p-6 text-center">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Product Filter */}
      <div className="flex items-center gap-3">
        <Filter className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
        <label htmlFor="product-filter" className="text-sm font-medium">
          Product:
        </label>
        <select
          id="product-filter"
          value={selectedProduct}
          onChange={e => setSelectedProduct(e.target.value)}
          className="px-3 py-1.5 rounded-[var(--radius-lg)] border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
        >
          <option value="all">All Products</option>
          {products.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-[hsl(var(--foreground-muted))]">
          {filteredInitiatives.length} initiative{filteredInitiatives.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Status Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded-sm ${STATUS_COLORS[key]}`} />
            <span className="text-[hsl(var(--foreground-muted))]">{label}</span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-8 overflow-x-auto">
        {/* Month headers */}
        <div className="min-w-[800px]">
          <div className="flex">
            <div className="w-52 shrink-0" />
            <div className="flex-1 grid grid-cols-12 gap-0">
              {MONTH_LABELS.map(label => (
                <div
                  key={label}
                  className="text-[10px] font-medium text-[hsl(var(--foreground-muted))] text-center"
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quarter Groups */}
        {quarterGroups.map(group => (
          <div key={group.quarter} className="min-w-[800px] space-y-3">
            <h4 className="text-sm font-semibold text-[hsl(var(--foreground-muted))] border-b border-border pb-2">
              {group.label}
            </h4>

            {group.initiatives.length === 0 ? (
              <p className="text-xs text-[hsl(var(--foreground-muted))] py-2 pl-2">
                No initiatives in this quarter.
              </p>
            ) : (
              <div className="space-y-2">
                {group.initiatives.map(initiative => {
                  const startPos = getMonthPosition(new Date(initiative.activationDate));
                  const endDate = initiative.eventDate
                    ? new Date(initiative.eventDate)
                    : new Date(2026, 11, 31);
                  const endPos = getMonthPosition(endDate);

                  const leftPct = (startPos / 12) * 100;
                  const widthPct = Math.max(((endPos - startPos) / 12) * 100, 2);
                  const colorClass = STATUS_COLORS[initiative.status] || 'bg-slate-400';

                  return (
                    <div
                      key={initiative.id}
                      className="flex items-center group cursor-pointer"
                      onClick={() => router.push(`/initiatives/${initiative.id}`)}
                    >
                      <div className="w-52 shrink-0 pr-3">
                        <span
                          className="text-xs font-medium truncate block group-hover:text-[hsl(var(--primary))] transition-colors"
                          title={initiative.name}
                        >
                          {initiative.name.length > 32
                            ? initiative.name.slice(0, 32) + '…'
                            : initiative.name}
                        </span>
                        <span className="text-[10px] text-[hsl(var(--foreground-muted))] capitalize">
                          {initiative.status.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="flex-1 relative h-7 bg-[hsl(var(--muted))]/30 rounded">
                        {/* Month grid lines */}
                        <div className="absolute inset-0 grid grid-cols-12">
                          {Array.from({ length: 11 }).map((_, i) => (
                            <div key={i} className="border-r border-border/30" />
                          ))}
                        </div>
                        {/* Initiative bar */}
                        <div
                          className={`absolute top-1 bottom-1 rounded ${colorClass} opacity-80 group-hover:opacity-100 transition-opacity`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        />
                        {/* Event date marker */}
                        {initiative.eventDate && (
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-gray-800/60"
                            style={{ left: `${(getMonthPosition(new Date(initiative.eventDate)) / 12) * 100}%` }}
                            title={`Event: ${formatDate(initiative.eventDate)}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {filteredInitiatives.length === 0 && (
          <p className="text-sm text-[hsl(var(--foreground-muted))] text-center py-8">
            No initiatives found for the selected filter.
          </p>
        )}
      </div>
    </div>
  );
}
