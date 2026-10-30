'use client';

import { useState, useMemo } from 'react';
import { Rocket } from 'lucide-react';
import type { Initiative } from '@/types';
import type { DifficultyDimensions } from '@/types/initiative-type.types';
import { findPerformerByName, type RankedPerformer } from '@/lib/top-performers';
import { InitiativeCard } from './initiative-card';
import { occurrenceCards, occurrenceLabel } from '@/lib/initiatives/occurrence-cards';
import { parseDateOnly, toDateOnly } from '@/lib/plan-dates';

/** Does a YYYY-MM-DD fall in any of the "Q1 2027" filters? No filter = yes. */
function inQuarters(date: string, quarters: readonly string[]): boolean {
  if (quarters.length === 0) return true;
  const year = Number(date.slice(0, 4));
  const q = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
  return quarters.some(f => f === `Q${q} ${year}`);
}
import { InitiativesFilters, type FilterOptions } from './initiatives-filters';
import { EmptyState } from '@/components/empty-state';
import { LoadingState } from '@/components/loading-state';

/** Initiative type fields the list needs: name and channel for display, difficulty for the cards. */
export interface InitiativeTypeOption {
  id: string;
  name: string;
  channel?: string;
  difficulty?: Partial<DifficultyDimensions>;
}

export interface InitiativesListProps {
  initiatives: Initiative[];
  initiativeTypes: InitiativeTypeOption[];
  products: Array<{ id: string; name: string }>;
  loading?: boolean;
  error?: string | null;
  /** Actual revenue and spend per initiative id, summed from this year's results. */
  actualsByInitiative?: Map<string, { revenue: number; spend: number }>;
  /** Last year's ranking, used to badge cards whose name matches a top performer. */
  lastYearRanking?: RankedPerformer[];
  onInitiativeClick?: (id: string) => void;
  onRemoveInitiative?: (id: string) => void;
  /** Plan horizon end: a recurring series shows one card per occurrence up to it. */
  planEnd?: string | null;
}

type SortOption = 'date-created' | 'status' | 'revenue';

/**
 * Main initiatives list component with filters, search, and sort
 * Displays initiatives in a responsive card grid
 */
export function InitiativesList({
  initiatives,
  initiativeTypes,
  products,
  loading = false,
  error = null,
  actualsByInitiative,
  lastYearRanking,
  onInitiativeClick,
  onRemoveInitiative,
  planEnd = null,
}: InitiativesListProps) {
  const [filters, setFilters] = useState<FilterOptions>({
    search: '',
    status: [],
    initiativeTypeId: [],
    productId: [],
    quarter: [],
  });

  const [sortBy, setSortBy] = useState<SortOption>('date-created');

  // Filter and search initiatives
  const filteredInitiatives = useMemo(() => {
    return initiatives.filter(initiative => {
      // Search filter
      if (filters.search) {
        const searchLower = filters.search.toLowerCase();
        const matchesName = initiative.name.toLowerCase().includes(searchLower);
        const matchesType = initiativeTypes
          .find(t => t.id === initiative.initiativeTypeId)
          ?.name.toLowerCase()
          .includes(searchLower);
        if (!matchesName && !matchesType) return false;
      }

      // Status filter
      if (filters.status.length > 0 && !filters.status.includes(initiative.status)) {
        return false;
      }

      // Initiative type filter
      if (
        filters.initiativeTypeId.length > 0 &&
        !filters.initiativeTypeId.includes(initiative.initiativeTypeId)
      ) {
        return false;
      }

      // Product filter
      if (
        filters.productId.length > 0 &&
        !filters.productId.includes(initiative.productId)
      ) {
        return false;
      }

      // Quarter filter. A recurring series is filtered per occurrence below.
      if (filters.quarter.length > 0 && initiative.kind !== 'recurring') {
        const eventDate = initiative.eventDate || initiative.activationDate;
        // Undated (unscheduled) initiatives are in no quarter.
        if (!eventDate) return false;
        const month = eventDate.getMonth() + 1;
        const year = eventDate.getFullYear();

        const matchesQuarter = filters.quarter.some(q => {
          const [qNum, qYear] = q.split(' ');
          const quarterNum = parseInt(qNum[1]);
          const quarterYearNum = parseInt(qYear);

          const quarterMonthStart = (quarterNum - 1) * 3 + 1;
          const quarterMonthEnd = quarterNum * 3;

          return (
            year === quarterYearNum &&
            month >= quarterMonthStart &&
            month <= quarterMonthEnd
          );
        });

        if (!matchesQuarter) return false;
      }

      return true;
    });
  }, [initiatives, filters, initiativeTypes]);

  // Sort initiatives
  const sortedInitiatives = useMemo(() => {
    const sorted = [...filteredInitiatives];

    switch (sortBy) {
      case 'date-created':
        return sorted.sort((a, b) => {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

      case 'status': {
        const statusOrder: Record<string, number> = {
          'in_progress': 0,
          'launched': 1,
          'planned': 2,
          'paused': 3,
          'completed': 4,
          'retired': 5,
        };
        return sorted.sort(
          (a, b) =>
            (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
        );
      }

      case 'revenue':
        return sorted.sort(
          (a, b) => b.revenueScenarios.best - a.revenueScenarios.best
        );

      default:
        return sorted;
    }
  }, [filteredInitiatives, sortBy]);

  if (loading) {
    return <LoadingState message="Loading initiatives..." fullPage />;
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-4 text-red-900">
        <p className="font-medium">Error loading initiatives</p>
        <p className="mt-1 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <InitiativesFilters
        filters={filters}
        onFiltersChange={setFilters}
        initiativeTypes={initiativeTypes}
        products={products}
      />

      {/* Sort options */}
      {sortedInitiatives.length > 0 && (
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="text-sm text-[hsl(var(--foreground-muted))]">
            Showing {sortedInitiatives.length} initiative
            {sortedInitiatives.length !== 1 ? 's' : ''}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="sort" className="text-sm font-medium text-[hsl(var(--foreground-muted))]">
              Sort by:
            </label>
            <select
              id="sort"
              value={sortBy}
              onChange={e => setSortBy(e.target.value as SortOption)}
              className="rounded-[var(--radius-md)] border border-border bg-card px-3 py-2 text-sm font-medium outline-none transition-colors hover:border-[hsl(var(--primary))] focus:border-[hsl(var(--primary))]"
            >
              <option value="date-created">Date Created</option>
              <option value="status">Status</option>
              <option value="revenue">Revenue (Best Case)</option>
            </select>
          </div>
        </div>
      )}

      {/* Initiatives grid or empty state */}
      {sortedInitiatives.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title={filters.search || Object.values(filters).some(arr => Array.isArray(arr) && arr.length > 0) ? 'No initiatives found' : 'No initiatives yet'}
          description={
            filters.search || Object.values(filters).some(arr => Array.isArray(arr) && arr.length > 0)
              ? 'Try adjusting your search or filters to find what you\'re looking for.'
              : 'Your initiative library will appear here. Create your first initiative to get started.'
          }
        />
      ) : (
        <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
          {sortedInitiatives.flatMap(initiative => {
            /*
             * A recurring series is shown as one card per occurrence (client,
             * Oct 2026), past ones included. It is still ONE initiative: every
             * card opens it, and only the first offers Remove (which removes
             * the series).
             */
            const today = toDateOnly(new Date());
            const cards = occurrenceCards(initiative, planEnd, today).filter(c => inQuarters(c.date, filters.quarter));
            if (cards.length === 0 && initiative.kind === 'recurring' && filters.quarter.length > 0) {
              const d = initiative.eventDate || initiative.activationDate;
              if (!d || !inQuarters(toDateOnly(d), filters.quarter)) return [];
            }
            return (cards.length > 0 ? cards : [null]).map(card => {
            const initiativeType = initiativeTypes.find(
              t => t.id === initiative.initiativeTypeId
            );
            const product = products.find(p => p.id === initiative.productId);
            // Name-based lookup into last year's ranking - see @/lib/top-performers.
            const lastYearPerformer = lastYearRanking
              ? findPerformerByName(lastYearRanking, initiative.name)
              : undefined;

            const shown = card
              ? { ...initiative, eventDate: parseDateOnly(card.date), revenueScenarios: card.scenarios }
              : initiative;
            return (
              <InitiativeCard
                key={card ? `${initiative.id}:${card.scheduled}` : initiative.id}
                initiative={shown}
                initiativeTypeName={initiativeType?.name || 'Unknown Type'}
                channel={initiativeType?.channel}
                difficulty={initiativeType?.difficulty}
                productName={product?.name || 'Unknown Product'}
                // Series actuals are not split by occurrence yet (needs migration 046).
                actuals={card ? undefined : actualsByInitiative?.get(initiative.id)}
                lastYear={
                  lastYearPerformer
                    ? { rank: lastYearPerformer.rank, revenue: lastYearPerformer.revenue }
                    : undefined
                }
                occurrence={card ? { label: occurrenceLabel(card), past: card.past } : undefined}
                onViewDetails={onInitiativeClick}
                onRemove={!card || card.index === 1 ? onRemoveInitiative : undefined}
              />
            );
            });
          })}
        </div>
      )}
    </div>
  );
}
