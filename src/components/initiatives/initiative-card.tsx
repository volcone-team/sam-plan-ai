'use client';
import { formatDate } from "@/lib/format-date";

import { useState } from 'react';
import { ChevronRight, TrendingUp, DollarSign, AlertCircle, Trash2 } from 'lucide-react';
import type { Initiative } from '@/types';

export interface InitiativeCardProps {
  initiative: Initiative;
  initiativeTypeName: string;
  productName: string;
  onViewDetails?: (id: string) => void;
  onRemove?: (id: string) => void;
}

/**
 * Individual initiative card component
 * Displays: name, type, status, revenue scenarios, budget, and date
 * Responsive design works on mobile/tablet/desktop
 */
export function InitiativeCard({
  initiative,
  initiativeTypeName,
  productName,
  onViewDetails,
  onRemove,
}: InitiativeCardProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
    planned: {
      bg: 'bg-[hsl(var(--slate-50))]',
      text: 'text-[hsl(var(--slate-700))]',
      label: 'Planned',
    },
    in_progress: {
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      label: 'In Progress',
    },
    launched: {
      bg: 'bg-green-50',
      text: 'text-green-700',
      label: 'Launched',
    },
    completed: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      label: 'Completed',
    },
    paused: {
      bg: 'bg-yellow-50',
      text: 'text-yellow-700',
      label: 'Paused',
    },
    retired: {
      bg: 'bg-gray-50',
      text: 'text-gray-700',
      label: 'Retired',
    },
  };

  const status = statusStyles[initiative.status] || statusStyles.planned;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const bestRevenueScenario = initiative.revenueScenarios.best;
  const budgetRemaining = initiative.plannedBudget - initiative.actualSpend;
  const isOverBudget = budgetRemaining < 0;

  return (
    <div className="group flex flex-col rounded-[var(--radius-lg)] border border-border bg-card transition-all hover:shadow-md hover:border-[hsl(var(--primary))] cursor-pointer h-full">
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* Header: name and status */}
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <button
              onClick={() => onViewDetails?.(initiative.id)}
              className="text-left"
            >
              <h3 className="font-semibold text-[hsl(var(--foreground))] line-clamp-2 group-hover:text-[hsl(var(--primary))] hover:text-[hsl(var(--primary))] transition-colors">
                {initiative.name}
              </h3>
            </button>
            <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))] line-clamp-1">
              {initiativeTypeName}
            </p>
          </div>
          <span
            className={`flex-shrink-0 inline-block px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${status.bg} ${status.text}`}
          >
            {status.label}
          </span>
        </div>

        {/* Product and description */}
        <div className="mb-4">
          <p className="text-xs text-[hsl(var(--foreground-muted))]">
            <span className="font-medium">Product:</span> {productName}
          </p>
          {initiative.description && (
            <p className="mt-1 line-clamp-2 text-sm text-[hsl(var(--foreground-muted))]">
              {initiative.description}
            </p>
          )}
        </div>

        {/* Revenue Scenarios */}
        <div className="mb-4 grid grid-cols-3 gap-2 rounded-[var(--radius-md)] bg-background p-3">
          <div className="text-center">
            <div className="text-xs text-[hsl(var(--foreground-muted))] mb-1">
              Good
            </div>
            <div className="text-sm font-semibold text-[hsl(var(--foreground))]">
              {formatCurrency(initiative.revenueScenarios.good)}
            </div>
          </div>
          <div className="border-l border-r border-border">
            <div className="text-center text-xs text-[hsl(var(--foreground-muted))] mb-1">
              Better
            </div>
            <div className="text-center text-sm font-semibold text-[hsl(var(--foreground))]">
              {formatCurrency(initiative.revenueScenarios.better)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-xs text-[hsl(var(--foreground-muted))] mb-1">
              Best
            </div>
            <div className="text-sm font-semibold text-[hsl(var(--primary))]">
              {formatCurrency(initiative.revenueScenarios.best)}
            </div>
          </div>
        </div>

        {/* Budget information */}
        <div className="mb-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-[hsl(var(--foreground-muted))] flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5" />
              Budget
            </span>
            <span className="font-medium text-[hsl(var(--foreground))]">
              {formatCurrency(initiative.plannedBudget)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[hsl(var(--foreground-muted))]">Spent</span>
            <span
              className={`font-medium ${
                isOverBudget
                  ? 'text-red-600'
                  : 'text-[hsl(var(--foreground))]'
              }`}
            >
              {formatCurrency(initiative.actualSpend)}
              {isOverBudget && (
                <span className="ml-1 inline-flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Over
                </span>
              )}
            </span>
          </div>
        </div>

        {/* Date information */}
        <div className="flex-1" />
        <div className="space-y-1 border-t border-border pt-3 text-xs text-[hsl(var(--foreground-muted))]">
          <div className="flex justify-between">
            <span>Activation:</span>
            <span className="font-medium">{formatDate(initiative.activationDate)}</span>
          </div>
          {initiative.eventDate && (
            <div className="flex justify-between">
              <span>Event:</span>
              <span className="font-medium">{formatDate(initiative.eventDate)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Action footer */}
      <div className="flex items-center border-t border-border">
        <button
          onClick={() => onViewDetails?.(initiative.id)}
          className="flex flex-1 items-center justify-between bg-background px-4 py-3 text-sm font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))] hover:text-[hsl(var(--primary-foreground))] transition-colors sm:px-5"
        >
          <span>View details</span>
          <ChevronRight className="h-4 w-4" />
        </button>
        {onRemove && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowConfirm(true);
            }}
            className="flex items-center justify-center border-l border-border bg-background px-3 py-3 text-[hsl(var(--foreground-muted))] hover:bg-red-50 hover:text-red-600 transition-colors"
            aria-label="Remove initiative"
            title="Remove from plan"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Remove confirmation dialog */}
      {showConfirm && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/30"
            onClick={() => setShowConfirm(false)}
            aria-hidden="true"
          />
          <div className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-[hsl(var(--foreground))]">
              Remove Initiative
            </h3>
            <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
              Are you sure you want to remove <strong>{initiative.name}</strong> from the plan? This action cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowConfirm(false)}
                className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-background"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowConfirm(false);
                  onRemove?.(initiative.id);
                }}
                className="rounded-[var(--radius-md)] bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
              >
                Remove
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
