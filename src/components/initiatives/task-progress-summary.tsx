'use client';

import type { Task } from '@/types';

/**
 * Progress summary for an initiative's tasks: percent complete, a progress
 * bar, and counts by status plus hours.
 *
 * Shared by the Tasks tab (which feeds it live task state) and the hidden
 * Project Plan tab.
 */
export function TaskProgressSummary({ tasks }: { tasks: Task[] }) {
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === 'completed').length;
  const inProgress = tasks.filter(t => t.status === 'in_progress').length;
  const blocked = tasks.filter(t => t.status === 'blocked').length;
  const percentComplete = total > 0 ? Math.round((completed / total) * 100) : 0;

  const totalEstimatedHours = tasks.reduce((sum, t) => sum + t.estimatedHours, 0);
  const totalActualHours = tasks.reduce((sum, t) => sum + (t.actualHours || 0), 0);

  return (
    <section aria-labelledby="progress-heading">
      <h2 id="progress-heading" className="text-lg font-semibold text-[hsl(var(--foreground))]">
        Progress
      </h2>

      <div className="mt-4 rounded-[var(--radius-lg)] border border-border bg-card p-5">
        {/* Main progress bar */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-[hsl(var(--foreground))]">
            {percentComplete}% Complete
          </span>
          <span className="text-sm text-[hsl(var(--foreground-muted))]">
            {completed} of {total} tasks
          </span>
        </div>
        <div className="h-3 w-full rounded-full bg-[hsl(var(--background-muted))]">
          <div
            className="h-full rounded-full bg-green-500 transition-all"
            style={{ width: `${percentComplete}%` }}
            role="progressbar"
            aria-valuenow={percentComplete}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Initiative progress"
          />
        </div>

        {/* Stats row */}
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="Completed" value={completed} color="text-green-600" />
          <StatCard label="In Progress" value={inProgress} color="text-blue-600" />
          <StatCard label="Blocked" value={blocked} color="text-red-600" />
          <StatCard
            label="Hours"
            value={`${totalActualHours.toFixed(1)} / ${totalEstimatedHours}`}
            color="text-[hsl(var(--foreground))]"
          />
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="text-center">
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-[hsl(var(--foreground-muted))]">{label}</p>
    </div>
  );
}
