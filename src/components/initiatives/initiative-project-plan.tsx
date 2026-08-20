'use client';
import { formatDate } from "@/lib/format-date";

import { useEffect, useState } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  Circle,
  Loader2,
  Ban,
  AlertTriangle,
  ArrowRight,
  User,
  ListTodo,
} from 'lucide-react';
import type { Task, TaskStatus } from '@/types';
import { taskService } from '@/services/task.service';

export interface InitiativeProjectPlanProps {
  initiativeId: string;
}

const statusConfig: Record<TaskStatus, { icon: typeof Circle; color: string; bgColor: string; label: string }> = {
  not_started: { icon: Circle, color: 'text-gray-400', bgColor: 'bg-gray-100', label: 'Not Started' },
  in_progress: { icon: Loader2, color: 'text-blue-500', bgColor: 'bg-blue-50', label: 'In Progress' },
  completed: { icon: CheckCircle2, color: 'text-green-500', bgColor: 'bg-green-50', label: 'Completed' },
  blocked: { icon: AlertTriangle, color: 'text-red-500', bgColor: 'bg-red-50', label: 'Blocked' },
  cancelled: { icon: Ban, color: 'text-gray-400', bgColor: 'bg-gray-50', label: 'Cancelled' },
};

/**
 * Project Plan tab content.
 * Displays task timeline, progress summary, and dependency information.
 */
export function InitiativeProjectPlan({ initiativeId }: InitiativeProjectPlanProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadTasks = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await taskService.getTasksByInitiative(initiativeId);
        // Sort by due date then display order
        data.sort((a, b) => {
          const dateDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          if (dateDiff !== 0) return dateDiff;
          return a.displayOrder - b.displayOrder;
        });
        setTasks(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load tasks';
        setError(message);
      } finally {
        setLoading(false);
      }
    };
    loadTasks();
  }, [initiativeId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        <span className="ml-2 text-sm text-[hsl(var(--foreground-muted))]">Loading project plan...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
        <p className="text-sm text-red-600">{error}</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
        <ListTodo className="h-10 w-10 text-[hsl(var(--foreground-muted))]" />
        <h3 className="mt-3 text-base font-semibold text-[hsl(var(--foreground))]">No tasks yet</h3>
        <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))] max-w-sm">
          Tasks will appear here once they are created for this initiative.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Progress Summary */}
      <ProgressSummary tasks={tasks} />

      {/* Task Timeline */}
      <TaskTimeline tasks={tasks} />

      {/* Dependencies */}
      <DependencyView tasks={tasks} />
    </div>
  );
}

/* ─────────────────────────────────────────────────
 * Progress Summary
 * ───────────────────────────────────────────────── */

function ProgressSummary({ tasks }: { tasks: Task[] }) {
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

/* ─────────────────────────────────────────────────
 * Task Timeline
 * ───────────────────────────────────────────────── */

function TaskTimeline({ tasks }: { tasks: Task[] }) {
  return (
    <section aria-labelledby="timeline-heading">
      <h2 id="timeline-heading" className="text-lg font-semibold text-[hsl(var(--foreground))]">
        Task Timeline
      </h2>

      <div className="mt-4 space-y-2">
        {tasks.map((task) => {
          const config = statusConfig[task.status];
          const Icon = config.icon;
          const isCancelled = task.status === 'cancelled';

          return (
            <div
              key={task.id}
              className="rounded-[var(--radius-lg)] border border-border bg-card p-4 hover:border-[hsl(var(--border-strong))] transition-colors"
            >
              <div className="flex items-start gap-3">
                {/* Status icon */}
                <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${config.bgColor}`}>
                  <Icon className={`h-4 w-4 ${config.color}`} />
                </div>

                {/* Task info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3
                      className={`text-sm font-medium text-[hsl(var(--foreground))] ${
                        isCancelled ? 'line-through text-[hsl(var(--foreground-muted))]' : ''
                      }`}
                    >
                      {task.name}
                    </h3>
                    <span
                      className={`shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${config.bgColor} ${config.color}`}
                    >
                      {config.label}
                    </span>
                  </div>

                  {/* Meta row */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-[hsl(var(--foreground-muted))]">
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formatDate(task.dueDate)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {task.estimatedHoursRange
                        ? `${task.estimatedHoursRange.min}–${task.estimatedHoursRange.max}h`
                        : `${task.estimatedHours}h`}
                      {task.actualHours != null && task.actualHours > 0 && (
                        <span className="text-[hsl(var(--foreground))] font-medium">
                          ({task.actualHours}h actual)
                        </span>
                      )}
                    </span>
                    {task.assignedToUserId && (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" />
                        Assigned
                      </span>
                    )}
                  </div>

                  {/* Timeline bar indicator */}
                  <div className="mt-2.5 h-1.5 w-full rounded-full bg-[hsl(var(--background-muted))]">
                    <div
                      className={`h-full rounded-full transition-all ${getBarColor(task.status)}`}
                      style={{
                        width: task.status === 'completed'
                          ? '100%'
                          : task.status === 'in_progress'
                            ? `${Math.min(Math.max(((task.actualHours || 0) / task.estimatedHours) * 100, 15), 85)}%`
                            : '0%',
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────
 * Dependency View
 * ───────────────────────────────────────────────── */

function DependencyView({ tasks }: { tasks: Task[] }) {
  const taskMap = new Map(tasks.map(t => [t.id, t]));
  const tasksWithDeps = tasks.filter(t => t.dependencyIds.length > 0);

  if (tasksWithDeps.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="deps-heading">
      <h2 id="deps-heading" className="text-lg font-semibold text-[hsl(var(--foreground))]">
        Dependencies
      </h2>
      <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
        Tasks with prerequisites that must be completed first
      </p>

      <div className="mt-4 space-y-3">
        {tasksWithDeps.map(task => {
          const config = statusConfig[task.status];
          const isBlocked = task.dependencyIds.some(depId => {
            const dep = taskMap.get(depId);
            return dep && dep.status !== 'completed';
          });

          return (
            <div
              key={task.id}
              className={`rounded-[var(--radius-lg)] border bg-card p-4 ${
                isBlocked ? 'border-red-200 bg-red-50/30' : 'border-border'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {isBlocked && (
                  <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                )}
                <h4 className="text-sm font-medium text-[hsl(var(--foreground))]">
                  {task.name}
                </h4>
                {isBlocked && (
                  <span className="text-xs font-medium text-red-600 bg-red-100 px-1.5 py-0.5 rounded">
                    Blocked
                  </span>
                )}
              </div>

              <div className="ml-6 space-y-1.5">
                {task.dependencyIds.map(depId => {
                  const dep = taskMap.get(depId);
                  if (!dep) return null;
                  const depConfig = statusConfig[dep.status];
                  const DepIcon = depConfig.icon;
                  const isComplete = dep.status === 'completed';

                  return (
                    <div key={depId} className="flex items-center gap-2 text-xs">
                      <DepIcon className={`h-3.5 w-3.5 ${depConfig.color}`} />
                      <span className={isComplete ? 'text-green-700' : 'text-[hsl(var(--foreground-muted))]'}>
                        {dep.name}
                      </span>
                      <ArrowRight className="h-3 w-3 text-[hsl(var(--foreground-muted))]" />
                      <span className="text-[hsl(var(--foreground))] font-medium">{task.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────
 * Utilities
 * ───────────────────────────────────────────────── */

// formatDate imported from @/lib/format-date

function getBarColor(status: TaskStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-green-500';
    case 'in_progress':
      return 'bg-blue-500';
    case 'blocked':
      return 'bg-red-500';
    case 'cancelled':
      return 'bg-gray-300';
    default:
      return 'bg-gray-300';
  }
}
