'use client';

import { useRouter } from 'next/navigation';
import { Calendar, ChevronRight } from 'lucide-react';

interface TimelineInitiative {
  id: string;
  name: string;
  status: string;
  activationDate: Date;
  eventDate?: Date;
}

interface InitiativeTimelineProps {
  initiatives: TimelineInitiative[];
}

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

function getMonthIndex(date: Date): number {
  return date.getMonth(); // 0-indexed
}

function getMonthPosition(date: Date): number {
  const month = date.getMonth();
  const day = date.getDate();
  const daysInMonth = new Date(date.getFullYear(), month + 1, 0).getDate();
  return month + (day / daysInMonth);
}

export function InitiativeTimeline({ initiatives }: InitiativeTimelineProps) {
  const router = useRouter();

  // Sort initiatives by activation date
  const sorted = [...initiatives].sort(
    (a, b) => a.activationDate.getTime() - b.activationDate.getTime()
  );

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Initiative Timeline</h3>
        </div>
        <button
          onClick={() => router.push('/initiatives')}
          className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--primary))] hover:underline"
        >
          View All Initiatives
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Status Legend */}
      <div className="flex flex-wrap items-center gap-3 mb-6 text-sm">
        {Object.entries(STATUS_LABELS).slice(0, 4).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className={`h-3 w-3 rounded-sm ${STATUS_COLORS[key]}`} />
            <span className="text-[hsl(var(--foreground-muted))]">{label}</span>
          </div>
        ))}
      </div>

      {/* Month headers */}
      <div className="mb-4">
        <div className="flex">
          <div className="w-48 shrink-0" />
          <div className="flex-1 grid grid-cols-12 gap-0">
            {MONTH_LABELS.map((label) => (
              <div key={label} className="text-[10px] font-medium text-[hsl(var(--foreground-muted))] text-center">
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline bars */}
      <div className="space-y-3">
        {sorted.map((initiative) => {
          const startPos = getMonthPosition(initiative.activationDate);
          const endDate = initiative.eventDate || new Date(2026, 11, 31);
          const endPos = getMonthPosition(endDate);
          
          // Calculate percentages (0-100% across 12 months)
          const leftPct = (startPos / 12) * 100;
          const widthPct = Math.max(((endPos - startPos) / 12) * 100, 2);

          const colorClass = STATUS_COLORS[initiative.status] || 'bg-slate-400';

          return (
            <div key={initiative.id} className="flex items-center group cursor-pointer" onClick={() => router.push(`/initiatives/${initiative.id}`)}>
              <div className="w-48 shrink-0 pr-3">
                <span className="text-xs font-medium truncate block hover:text-[hsl(var(--primary))] transition-colors" title={initiative.name}>
                  {initiative.name.length > 28 ? initiative.name.slice(0, 28) + '…' : initiative.name}
                </span>
              </div>
              <div className="flex-1 relative h-6 bg-[hsl(var(--muted))]/30 rounded">
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
