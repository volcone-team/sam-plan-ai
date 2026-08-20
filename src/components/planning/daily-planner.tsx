'use client';
import { formatDate, formatDateShort } from '@/lib/format-date';

import { COMPANY_ID } from '@/lib/constants';
const companyId = COMPANY_ID;

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Star,
  Rocket,
  ListTodo,
  Loader2,
  AlertCircle,
  Circle,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import { initiativeService } from '@/services/initiative.service';
import { taskService } from '@/services/task.service';
import { planService } from '@/services/plan.service';
import type { Initiative, Task, TaskStatus, WeeklyPlan } from '@/types';


const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-600',
  high: 'text-amber-600',
  medium: 'text-blue-600',
  low: 'text-gray-500',
};

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  launched: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-gray-100 text-gray-700',
  paused: 'bg-red-100 text-red-700',
  retired: 'bg-gray-100 text-gray-500',
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
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskWithInitiative[]>([]);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(null);

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
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [activeInitiatives, plan] = await Promise.all([
          initiativeService.getActiveInitiatives(companyId),
          planService.getWeeklyPlan(companyId, getWeekStart(selectedDate)),
        ]);

        setWeeklyPlan(plan);

        // Filter initiatives active on the selected date
        const dayInitiatives = activeInitiatives.filter(init => {
          const activation = new Date(init.activationDate);
          const eventDate = init.eventDate ? new Date(init.eventDate) : null;

          if (init.kind === 'evergreen') {
            return activation <= selectedDate;
          }
          if (eventDate) {
            return activation <= selectedDate && eventDate >= selectedDate;
          }
          return activation <= selectedDate;
        });
        setInitiatives(dayInitiatives);

        // Get tasks due on the selected date
        const allTasks: TaskWithInitiative[] = [];
        for (const init of dayInitiatives) {
          const initTasks = await taskService.getTasksByInitiative(init.id);
          const dueToday = initTasks.filter(t => isSameDay(new Date(t.dueDate), selectedDate));
          dueToday.forEach(t => {
            allTasks.push({ ...t, initiativeName: init.name });
          });
        }

        // Sort by priority then status
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        allTasks.sort((a, b) => {
          const pDiff = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
          return pDiff;
        });
        setTasks(allTasks);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load daily data';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [selectedDate]);

  const handleStatusToggle = async (taskId: string, currentStatus: TaskStatus) => {
    const newStatus = cycleStatus(currentStatus);
    try {
      await taskService.updateTaskStatus(taskId, newStatus);
      setTasks(prev =>
        prev.map(t => (t.id === taskId ? { ...t, status: newStatus } : t))
      );
    } catch (err) {
      console.error('Failed to update task status:', err);
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
  const topPriorityInitiative = topPriority
    ? initiatives.find(i => i.id === topPriority || i.id.includes(topPriority))
    : null;

  return (
    <div className="space-y-6">
      {/* Date Selector */}
      <div className="flex items-center gap-3">
        <button
          onClick={goToPrevDay}
          className="p-2 rounded-[var(--radius-lg)] bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/80 transition-colors"
          aria-label="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <p className="text-sm font-semibold">
            {formatDate(selectedDate)}
          </p>
          <input
            type="date"
            value={selectedDate.toISOString().split('T')[0]}
            onChange={e => {
              const d = new Date(e.target.value + 'T00:00:00');
              if (!isNaN(d.getTime())) setSelectedDate(d);
            }}
            className="mt-1 px-2 py-1 rounded-[var(--radius-md)] border border-border bg-background text-xs text-center outline-none focus:border-[hsl(var(--primary))] cursor-pointer"
          />
        </div>
        <button
          onClick={goToNextDay}
          className="p-2 rounded-[var(--radius-lg)] bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/80 transition-colors"
          aria-label="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {!isToday && (
          <button
            onClick={goToToday}
            className="px-3 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
          >
            Today
          </button>
        )}
      </div>

      {/* Today's Focus */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-3">
        <div className="flex items-center gap-2">
          <Star className="h-5 w-5 text-amber-500" />
          <h3 className="text-lg font-semibold">Today&apos;s Focus</h3>
        </div>
        {topPriorityInitiative ? (
          <div className="rounded-[var(--radius-lg)] bg-amber-50 border border-amber-200 p-4">
            <p className="text-sm font-semibold text-amber-900">
              #1 Priority: {topPriorityInitiative.name}
            </p>
            <p className="text-xs text-amber-700 mt-1">
              {topPriorityInitiative.description?.slice(0, 100)}
              {(topPriorityInitiative.description?.length || 0) > 100 ? '…' : ''}
            </p>
          </div>
        ) : topPriority ? (
          <div className="rounded-[var(--radius-lg)] bg-amber-50 border border-amber-200 p-4">
            <p className="text-sm font-semibold text-amber-900">
              #1 Priority: {topPriority}
            </p>
          </div>
        ) : (
          <p className="text-sm text-[hsl(var(--foreground-muted))] py-2">
            No focus set for this week. Set top priorities in your weekly plan.
          </p>
        )}
      </div>

      {/* Today's Tasks */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Today&apos;s Tasks</h3>
          <span className="ml-auto text-sm text-[hsl(var(--foreground-muted))]">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </span>
        </div>

        {tasks.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground-muted))] py-4 text-center">
            No tasks due {isToday ? 'today' : 'on this day'}.
          </p>
        ) : (
          <div className="space-y-2">
            {tasks.map(task => {
              const StatusIcon = getStatusIcon(task.status);
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-3 py-2 px-3 rounded-[var(--radius-lg)] border border-border hover:bg-[hsl(var(--muted))]/30 transition-colors"
                >
                  <button
                    onClick={() => handleStatusToggle(task.id, task.status)}
                    className={`shrink-0 transition-colors ${getStatusColor(task.status)}`}
                    title={`Status: ${task.status.replace('_', ' ')} — click to change`}
                    aria-label={`Toggle status for ${task.name}`}
                  >
                    <StatusIcon className="h-5 w-5" />
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${task.status === 'completed' ? 'line-through text-[hsl(var(--foreground-muted))]' : ''}`}>
                      {task.name}
                    </p>
                    <p className="text-xs text-[hsl(var(--foreground-muted))] truncate">
                      {task.initiativeName}
                    </p>
                  </div>
                  <span className={`text-xs font-medium capitalize ${PRIORITY_COLORS[task.priority] || ''}`}>
                    {task.priority}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[task.status] || 'bg-gray-100 text-gray-700'}`}
                  >
                    {task.status.replace('_', ' ')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Initiatives */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Active Initiatives</h3>
          <span className="ml-auto text-sm text-[hsl(var(--foreground-muted))]">
            {initiatives.length} active
          </span>
        </div>

        {initiatives.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground-muted))] py-4 text-center">
            No initiatives active {isToday ? 'today' : 'on this day'}.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {initiatives.map(initiative => (
              <button
                key={initiative.id}
                onClick={() => router.push(`/initiatives/${initiative.id}`)}
                className="w-full flex items-center gap-3 py-3 px-2 text-left hover:bg-[hsl(var(--muted))]/50 rounded-[var(--radius-lg)] transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-[hsl(var(--primary))]">
                    {initiative.name}
                  </p>
                  <span className="text-xs text-[hsl(var(--foreground-muted))] capitalize">
                    {initiative.kind.replace('_', ' ')}
                  </span>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${STATUS_COLORS[initiative.status] || 'bg-gray-100 text-gray-700'}`}
                >
                  {initiative.status.replace('_', ' ')}
                </span>
                <ChevronRight className="h-4 w-4 text-[hsl(var(--foreground-muted))] group-hover:text-[hsl(var(--primary))] shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
