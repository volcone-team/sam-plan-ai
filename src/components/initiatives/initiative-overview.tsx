'use client';
import { formatDate } from "@/lib/format-date";

import { Calendar, Package, Tag, Clock, Zap } from 'lucide-react';
import type { Initiative } from '@/types';
import type { InitiativeType } from '@/types/initiative-type.types';

export interface InitiativeOverviewProps {
  initiative: Initiative;
  initiativeType: InitiativeType | null;
  productName: string;
}

const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
  planned: { bg: 'bg-[hsl(var(--secondary))]', text: 'text-[hsl(var(--foreground))]', label: 'Planned' },
  in_progress: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'In Progress' },
  launched: { bg: 'bg-green-50', text: 'text-green-700', label: 'Launched' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Completed' },
  paused: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Paused' },
  retired: { bg: 'bg-gray-50', text: 'text-gray-700', label: 'Retired' },
};

const kindLabels: Record<string, string> = {
  'one-time': 'One-time',
  recurring: 'Recurring',
  evergreen: 'Evergreen',
};

/**
 * Overview section: name, status, type, dates, product, kind, description
 */
export function InitiativeOverview({
  initiative,
  initiativeType,
  productName,
}: InitiativeOverviewProps) {
  const status = statusStyles[initiative.status] || statusStyles.planned;


  return (
    <section aria-labelledby="overview-heading">
      <h2 id="overview-heading" className="text-lg font-semibold text-[hsl(var(--foreground))]">
        Overview
      </h2>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {/* Left column: key details */}
        <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-5">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[hsl(var(--foreground-muted))]">Status</span>
            <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${status.bg} ${status.text}`}>
              {status.label}
            </span>
          </div>

          {/* Type */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
              <Tag className="h-3.5 w-3.5" />
              Type
            </span>
            <span className="text-sm font-medium text-[hsl(var(--foreground))]">
              {initiativeType?.name || 'Unknown'}
            </span>
          </div>

          {/* Kind */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
              <Zap className="h-3.5 w-3.5" />
              Kind
            </span>
            <span className="text-sm font-medium text-[hsl(var(--foreground))]">
              {kindLabels[initiative.kind] || initiative.kind}
            </span>
          </div>

          {/* Product */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
              <Package className="h-3.5 w-3.5" />
              Product
            </span>
            <span className="text-sm font-medium text-[hsl(var(--foreground))]">
              {productName}
            </span>
          </div>

          {/* Activation date */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
              <Clock className="h-3.5 w-3.5" />
              Activation
            </span>
            <span className="text-sm font-medium text-[hsl(var(--foreground))]">
              {formatDate(initiative.activationDate)}
            </span>
          </div>

          {/* Event date */}
          {initiative.eventDate && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
                <Calendar className="h-3.5 w-3.5" />
                Event Date
              </span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                {formatDate(initiative.eventDate)}
              </span>
            </div>
          )}

          {/* Traffic Input */}
          {initiative.trafficInput && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--foreground-muted))]">
                Expected Registrants
              </span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                {initiative.trafficInput.toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {/* Right column: description */}
        <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Description</h3>
          <p className="text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
            {initiative.description || 'No description provided.'}
          </p>

          {/* Date range summary */}
          <div className="mt-4 pt-4 border-t border-border">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-2">Date Range</h3>
            <div className="flex items-center gap-3 text-sm text-[hsl(var(--foreground-muted))]">
              <span>{formatDate(initiative.activationDate)}</span>
              {initiative.eventDate && (
                <>
                  <span className="text-[hsl(var(--border-strong))]">→</span>
                  <span>{formatDate(initiative.eventDate)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
