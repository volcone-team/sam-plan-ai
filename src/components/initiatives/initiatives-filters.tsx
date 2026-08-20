'use client';

import { useState } from 'react';
import { Search, X } from 'lucide-react';
import type { InitiativeStatus } from '@/types';

export interface FilterOptions {
  search: string;
  status: InitiativeStatus[];
  initiativeTypeId: string[];
  productId: string[];
  quarter: string[];
}

export interface InitiativesFiltersProps {
  filters: FilterOptions;
  onFiltersChange: (filters: FilterOptions) => void;
  initiativeTypes: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string }>;
}

/**
 * Initiatives filter bar with search, status, type, product, and quarter filters
 * Displays as a horizontal filter bar with collapsible/expandable options
 */
export function InitiativesFilters({
  filters,
  onFiltersChange,
  initiativeTypes,
  products,
}: InitiativesFiltersProps) {
  const [expanded, setExpanded] = useState(false);

  const handleSearchChange = (search: string) => {
    onFiltersChange({ ...filters, search });
  };

  const handleStatusToggle = (status: InitiativeStatus) => {
    const newStatus = filters.status.includes(status)
      ? filters.status.filter(s => s !== status)
      : [...filters.status, status];
    onFiltersChange({ ...filters, status: newStatus });
  };

  const handleTypeToggle = (typeId: string) => {
    const newTypes = filters.initiativeTypeId.includes(typeId)
      ? filters.initiativeTypeId.filter(t => t !== typeId)
      : [...filters.initiativeTypeId, typeId];
    onFiltersChange({ ...filters, initiativeTypeId: newTypes });
  };

  const handleProductToggle = (productId: string) => {
    const newProducts = filters.productId.includes(productId)
      ? filters.productId.filter(p => p !== productId)
      : [...filters.productId, productId];
    onFiltersChange({ ...filters, productId: newProducts });
  };

  const handleQuarterToggle = (quarter: string) => {
    const newQuarters = filters.quarter.includes(quarter)
      ? filters.quarter.filter(q => q !== quarter)
      : [...filters.quarter, quarter];
    onFiltersChange({ ...filters, quarter: newQuarters });
  };

  const handleClearAll = () => {
    onFiltersChange({
      search: '',
      status: [],
      initiativeTypeId: [],
      productId: [],
      quarter: [],
    });
  };

  const activeFilterCount =
    filters.status.length +
    filters.initiativeTypeId.length +
    filters.productId.length +
    filters.quarter.length;

  const statuses: InitiativeStatus[] = [
    'planned',
    'in_progress',
    'launched',
    'completed',
    'paused',
    'retired',
  ];

  const quarters = ['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026'];

  return (
    <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-4">
      {/* Search input */}
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-background px-3 py-2">
        <Search className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
        <input
          type="text"
          placeholder="Search initiatives by name or type..."
          value={filters.search}
          onChange={e => handleSearchChange(e.target.value)}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-[hsl(var(--foreground-muted))]"
        />
        {filters.search && (
          <button
            onClick={() => handleSearchChange('')}
            className="text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Expandable filter section */}
      <details
        open={expanded}
        onToggle={e => setExpanded(e.currentTarget.open)}
        className="group"
      >
        <summary className="flex cursor-pointer items-center justify-between py-2 text-sm font-medium hover:text-[hsl(var(--primary))]">
          <span>
            Filters {activeFilterCount > 0 && `(${activeFilterCount})`}
          </span>
          <span className="text-xs text-[hsl(var(--foreground-muted))]">
            {expanded ? 'Hide' : 'Show'}
          </span>
        </summary>

        {/* Filter grid */}
        <div className="space-y-4 border-t border-border pt-4">
          {/* Status filter */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
              Status
            </h4>
            <div className="flex flex-wrap gap-2">
              {statuses.map(status => (
                <button
                  key={status}
                  onClick={() => handleStatusToggle(status)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filters.status.includes(status)
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                      : 'border border-border bg-background text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]'
                  }`}
                >
                  {status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Initiative type filter */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
              Initiative Type
            </h4>
            <div className="flex flex-wrap gap-2">
              {initiativeTypes.map(type => (
                <button
                  key={type.id}
                  onClick={() => handleTypeToggle(type.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filters.initiativeTypeId.includes(type.id)
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                      : 'border border-border bg-background text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]'
                  }`}
                >
                  {type.name}
                </button>
              ))}
            </div>
          </div>

          {/* Product filter */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
              Product
            </h4>
            <div className="flex flex-wrap gap-2">
              {products.map(product => (
                <button
                  key={product.id}
                  onClick={() => handleProductToggle(product.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filters.productId.includes(product.id)
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                      : 'border border-border bg-background text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]'
                  }`}
                >
                  {product.name}
                </button>
              ))}
            </div>
          </div>

          {/* Quarter filter */}
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
              Quarter
            </h4>
            <div className="flex flex-wrap gap-2">
              {quarters.map(quarter => (
                <button
                  key={quarter}
                  onClick={() => handleQuarterToggle(quarter)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    filters.quarter.includes(quarter)
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                      : 'border border-border bg-background text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary))]'
                  }`}
                >
                  {quarter}
                </button>
              ))}
            </div>
          </div>

          {/* Clear filters button */}
          {activeFilterCount > 0 && (
            <button
              onClick={handleClearAll}
              className="mt-4 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
