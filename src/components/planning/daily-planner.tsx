'use client';
import { formatDate, formatDateShort } from '@/lib/format-date';

import { useCompanyId } from '@/hooks/use-auth';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Star,
  ListTodo,
  Loader2,
  AlertCircle,
  Circle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Ban,
  Download,
  Plus,
  ArrowRight,
} from 'lucide-react';
import { initiativeService } from '@/services/initiative.service';
import { taskService } from '@/services/task.service';
import { planService } from '@/services/plan.service';
import { updateInitiativeStatusFromTasks } from '@/lib/update-initiative-status';
import { PaceCards } from '@/components/planning/pace-cards';
import type { Initiative, Task, TaskStatus, WeeklyPlan } from '@/types';


const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-600',
  high: 'text-amber-600',
  medium: 'text-blue-600',
  low: 'text-gray-500',
};

const TASK_STATUS_ORDER: TaskStatus[] = ['not_started', 'in_progress', 'completed', 'blocked', 'cancelled'];

function getStatusIcon(status: TaskStatus) {
  switch (status) {
    case 'not_started': return Circle;
    case 'in_progress': return Clock;
    case 'completed': return CheckCircle2;
    case 'blocked': return AlertTriangle;
    case 'cancelled': return Ban;
    default: return Circle;
  }
}

function getStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'not_started': return 'text-gray-400 hover:text-blue-500';
    case 'in_progress': return 'text-amber-500 hover:text-emerald-500';
    case 'completed': return 'text-emerald-500 hover:text-gray-400';
    case 'blocked': return 'text-red-500 hover:text-amber-500';
    case 'cancelled': return 'text-gray-300 hover:text-gray-400';
    default: return 'text-gray-400';
  }
}

function cycleStatus(current: TaskStatus): TaskStatus {
  if (current === 'blocked') return 'in_progress';
  if (current === 'cancelled') return 'not_started';
  const idx = TASK_STATUS_ORDER.indexOf(current);
  const nextIdx = (idx + 1) % 3;
  return TASK_STATUS_ORDER[nextIdx];
}

// formatDate imported from @/lib/format-date

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

interface TaskWithInitiative extends Task {
  initiativeName: string;
}

export function DailyPlanner() {
  const companyId = useCompanyId() || "";
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskWithInitiative[]>([]);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(null);
  /** Past due and still open. The plan's real backlog. */
  const [slipped, setSlipped] = useState<TaskWithInitiative[]>([]);
  /** The next three days, so nothing sneaks up. */
  const [upcoming, setUpcoming] = useState<TaskWithInitiative[]>([]);

  const goToPrevDay = useCallback(() => {
    setSelectedDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 1);
      return d;
    });
  }, []);

  const goToNextDay = useCallback(() => {
    setSelectedDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 1);
      return d;
    });
  }, []);

  const goToToday = useCallback(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setSelectedDate(today);
  }, []);

  const isToday = isSameDay(selectedDate, new Date());

  useEffect(() => {
    if (!companyId) return;
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [activeInitiatives, plan] = await Promise.all([
          initiativeService.getActiveInitiatives(companyId),
          planService.getWeeklyPlan(companyId, getWeekStart(selectedDate)),
        ]);

        setWeeklyPlan(plan);

        // Tasks due today, for the WHOLE COMPANY. Same fix as the weekly view:
        // a task's own due date decides whether it shows, not whether its
        // parent initiative happens to overlap today.
        const dayTasks = await taskService.getTasksByCompanyDueBetween(
          companyId, selectedDate, selectedDate
        );
        const nameById = new Map(activeInitiatives.map(i => [i.id, i.name]));
        const allTasks: TaskWithInitiative[] = dayTasks.map(t => ({
          ...t,
          initiativeName: nameById.get(t.initiativeId) || 'Unassigned',
        }));

        // Sort by priority then status
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        allTasks.sort((a, b) => {
          const pDiff = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
          return pDiff;
        });
        console.log("[DailyPlanner] Found", allTasks.length, "tasks for today");
        setTasks(allTasks);

        // Slipped: due before the selected day and still open. Anything already
        // closed out is not slipping, so completed/cancelled are excluded.
        const backlogStart = new Date(selectedDate);
        backlogStart.setFullYear(backlogStart.getFullYear() - 2);
        const before = new Date(selectedDate);
        before.setDate(before.getDate() - 1);
        const past = await taskService.getTasksByCompanyDueBetween(companyId, backlogStart, before);
        setSlipped(
          past
            .filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
            .map((t) => ({ ...t, initiativeName: nameById.get(t.initiativeId) || 'Unassigned' }))
            .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
        );

        // Next three days, excluding the selected day itself.
        const soonStart = new Date(selectedDate);
        soonStart.setDate(soonStart.getDate() + 1);
        const soonEnd = new Date(selectedDate);
        soonEnd.setDate(soonEnd.getDate() + 3);
        const soon = await taskService.getTasksByCompanyDueBetween(companyId, soonStart, soonEnd);
        setUpcoming(
          soon
            .filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
            .map((t) => ({ ...t, initiativeName: nameById.get(t.initiativeId) || 'Unassigned' }))
            .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load daily data';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [selectedDate, companyId]);

  const handleStatusToggle = async (taskId: string, currentStatus: TaskStatus) => {
    const newStatus = cycleStatus(currentStatus);
    console.log("[DailyPlanner] Task status toggle:", taskId, currentStatus, "→", newStatus);
    // Optimistic update
    setTasks(prev =>
      prev.map(t => (t.id === taskId ? { ...t, status: newStatus, completedAt: newStatus === 'completed' ? new Date() : t.completedAt } : t))
    );
    try {
      await taskService.updateTaskStatus(taskId, newStatus);
      console.log("[DailyPlanner] Status updated successfully");
      const changedTask = tasks.find(t => t.id === taskId);
      if (changedTask && (changedTask as any).initiativeId) {
        updateInitiativeStatusFromTasks((changedTask as any).initiativeId);
      }
    } catch (err: any) {
      console.error('[DailyPlanner] Failed, reverting:', err?.message || err);
      setTasks(prev =>
        prev.map(t => (t.id === taskId ? { ...t, status: currentStatus } : t))
      );
      alert(err?.message || "You do not have permission to update this task.");
    }
  };

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

  // Get top priority from weekly plan
  const topPriority = weeklyPlan?.topPriorities?.[0] || null;

  /**
   * The single task the day is about. Prefers the week's stated top priority when
   * it matches a task due today, otherwise the highest-priority open task - so the
   * card is never empty while there is work on the board.
   */
  const focusTask =
    tasks.find((t) => topPriority && t.name === topPriority) ||
    tasks.find((t) => t.status !== 'completed' && t.status !== 'cancelled') ||
    null;

  /** Today's board as CSV: what was due, for whom, and where it stands. */
  const exportCsv = () => {
    const rows = [
      ['Task', 'Initiative', 'Status', 'Priority', 'Due date'],
      ...[...tasks, ...slipped, ...upcoming].map((t) => [
        t.name,
        t.initiativeName,
        t.status,
        t.priority,
        formatDateShort(new Date(t.dueDate)),
      ]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `sam-daily-${formatDateShort(selectedDate).replace(/\s+/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const doneToday = tasks.filter((t) => t.status === 'completed').length;
  const donePct = tasks.length > 0 ? Math.round((doneToday / tasks.length) * 100) : 0;

  /** Whole days between a due date and the day being viewed. */
  const daysOverdue = (due: Date | string): number => {
    const d = new Date(due);
    d.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((selectedDate.getTime() - d.getTime()) / 86_400_000));
  };

  return (
    <div className="space-y-6">
      {/* Header: title, day nav, actions */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
            {formatDate(selectedDate)}
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Today &mdash; what moves the plan</h1>
          <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
            The day-level operating view. One focus, what&apos;s due, what slipped.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={goToPrevDay}
            aria-label="Previous day"
            className="rounded-[var(--radius-md)] border border-border p-1.5 transition-colors hover:bg-[hsl(var(--background-muted))]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={goToToday}
            disabled={isToday}
            className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
          >
            Today
          </button>
          <button
            onClick={goToNextDay}
            aria-label="Next day"
            className="rounded-[var(--radius-md)] border border-border p-1.5 transition-colors hover:bg-[hsl(var(--background-muted))]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[hsl(var(--background-muted))]"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            onClick={() => router.push('/initiatives')}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            New initiative
          </button>
        </div>
      </div>

      {/* The one thing that matters today */}
      <section className="rounded-[var(--radius-lg)] bg-[hsl(var(--foreground))] p-6 text-[hsl(var(--background))]">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider opacity-70">
          <Star className="h-3.5 w-3.5" />
          The top priority for today
        </p>
        {focusTask ? (
          <>
            <h2 className="mt-2 text-xl font-bold">{focusTask.name}</h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm opacity-70">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {focusTask.initiativeName}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleStatusToggle(focusTask.id, focusTask.status)}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {focusTask.status === 'completed' ? 'Done' : 'Mark done'}
              </button>
              <span className="text-sm opacity-70">
                {focusTask.status === 'in_progress' ? 'Working on it' : 'Not started'}
              </span>
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm opacity-70">
            {topPriority
              ? topPriority
              : 'Nothing set. Pick a focus in the weekly planner and it shows here.'}
          </p>
        )}
      </section>

      {/* Done / Overdue */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Done today
          </p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight">
            {doneToday} / {tasks.length}
          </p>
          <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">{donePct}% complete</p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
            <Clock className="h-3.5 w-3.5" />
            Overdue
          </p>
          <p className="mt-1.5 text-2xl font-bold tracking-tight">{slipped.length}</p>
          <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
            {slipped.length > 0 ? 'Triage below' : 'Nothing slipping'}
          </p>
        </div>
      </div>

      {/* Where you are - shared with Year-at-a-Glance */}
      <PaceCards companyId={companyId} asOf={selectedDate} />

      {/* Due today */}
      <TaskGroup
        icon={<ListTodo className="h-4 w-4" />}
        title="Due today"
        subtitle={tasks.length === 0 ? 'Empty board. Pull from upcoming.' : 'What the plan asks of you today.'}
        tasks={tasks}
        onToggle={handleStatusToggle}
      />

      {/* Slipped */}
      <TaskGroup
        icon={<AlertTriangle className="h-4 w-4" />}
        title="Slipped"
        subtitle="Past due and still open. Close them out or push the date."
        tasks={slipped}
        onToggle={handleStatusToggle}
        trailing={(t) => (
          <span className="shrink-0 text-xs font-medium text-red-600">
            {daysOverdue(t.dueDate)}d overdue
          </span>
        )}
      />

      {/* Next 3 days */}
      <TaskGroup
        icon={<ArrowRight className="h-4 w-4" />}
        title="Next 3 days"
        subtitle="So nothing sneaks up on you."
        tasks={upcoming}
        onToggle={handleStatusToggle}
        trailing={(t) => (
          <span className="shrink-0 text-xs text-[hsl(var(--foreground-muted))]">
            {formatDateShort(new Date(t.dueDate))}
          </span>
        )}
      />
    </div>
  );
}

/**
 * One list of tasks with a heading. Used for Due today / Slipped / Next 3 days so
 * the three sections behave identically - same checkbox, same empty state.
 */
function TaskGroup({
  icon,
  title,
  subtitle,
  tasks,
  onToggle,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  tasks: TaskWithInitiative[];
  onToggle: (id: string, status: TaskStatus) => void;
  trailing?: (task: TaskWithInitiative) => React.ReactNode;
}) {
  return (
    <section>
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        {icon}
        {title}
      </p>
      <p className="mt-0.5 text-sm text-[hsl(var(--foreground-muted))]">{subtitle}</p>

      {tasks.length === 0 ? (
        <div className="mt-3 rounded-[var(--radius-lg)] border border-border bg-card py-10 text-center text-sm text-[hsl(var(--foreground-muted))]">
          Nothing here.
        </div>
      ) : (
        <div className="mt-3 divide-y divide-border overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          {tasks.map((task) => {
            const StatusIcon = getStatusIcon(task.status);
            const done = task.status === 'completed';
            return (
              <div key={task.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => onToggle(task.id, task.status)}
                  className={getStatusColor(task.status) + ' shrink-0 transition-colors'}
                  aria-label={`Mark ${task.name} as ${cycleStatus(task.status).replace('_', ' ')}`}
                >
                  <StatusIcon className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      'truncate text-sm font-medium ' +
                      (done ? 'text-[hsl(var(--foreground-muted))] line-through' : '')
                    }
                  >
                    {task.name}
                  </p>
                  <p className="truncate text-xs text-[hsl(var(--foreground-muted))]">
                    {task.initiativeName}
                    {task.priority !== 'medium' && (
                      <span className={'ml-2 ' + (PRIORITY_COLORS[task.priority] || '')}>
                        {task.priority}
                      </span>
                    )}
                  </p>
                </div>
                {trailing?.(task)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
