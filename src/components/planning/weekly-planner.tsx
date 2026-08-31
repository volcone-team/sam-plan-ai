'use client';
import { formatDate, formatDateShort } from '@/lib/format-date';

import { useCompanyId } from '@/hooks/use-auth';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Target,
  ChevronLeft,
  ChevronRight,
  Rocket,
  ListTodo,
  Star,
  StickyNote,
  PlusCircle,
  Loader2,
  AlertCircle,
  Circle,
  Clock,
  CheckCircle2,
  Ban,
  AlertTriangle,
} from 'lucide-react';
import { planService } from '@/services/plan.service';
import { initiativeService } from '@/services/initiative.service';
import { taskService } from '@/services/task.service';
import { resultService } from '@/services/result.service';
import { updateInitiativeStatusFromTasks } from '@/lib/update-initiative-status';
import type { WeeklyPlan, Initiative, Task, TaskStatus, Result } from '@/types';


const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  launched: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-gray-100 text-gray-700',
  paused: 'bg-red-100 text-red-700',
  retired: 'bg-gray-100 text-gray-500',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-600',
  high: 'text-amber-600',
  medium: 'text-blue-600',
  low: 'text-gray-500',
};

const TASK_STATUS_ORDER: TaskStatus[] = ['not_started', 'in_progress', 'completed', 'blocked', 'cancelled'];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekEnd(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

// formatDateShort imported from @/lib/format-date

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toLocaleString()}`;
}

function getStatusIcon(status: TaskStatus) {
  switch (status) {
    case 'not_started':
      return Circle;
    case 'in_progress':
      return Clock;
    case 'completed':
      return CheckCircle2;
    case 'blocked':
      return AlertTriangle;
    case 'cancelled':
      return Ban;
    default:
      return Circle;
  }
}

function getStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'not_started':
      return 'text-gray-400 hover:text-blue-500';
    case 'in_progress':
      return 'text-amber-500 hover:text-emerald-500';
    case 'completed':
      return 'text-emerald-500 hover:text-gray-400';
    case 'blocked':
      return 'text-red-500 hover:text-amber-500';
    case 'cancelled':
      return 'text-gray-300 hover:text-gray-400';
    default:
      return 'text-gray-400';
  }
}

function cycleStatus(current: TaskStatus): TaskStatus {
  const idx = TASK_STATUS_ORDER.indexOf(current);
  // Cycle: not_started → in_progress → completed → not_started
  // blocked → in_progress, cancelled stays
  if (current === 'blocked') return 'in_progress';
  if (current === 'cancelled') return 'not_started';
  const nextIdx = (idx + 1) % 3; // only cycle through first 3
  return TASK_STATUS_ORDER[nextIdx];
}

interface TaskWithInitiative extends Task {
  initiativeName: string;
}

export function WeeklyPlanner() {
  const companyId = useCompanyId() || "";
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [weeklyPlan, setWeeklyPlan] = useState<WeeklyPlan | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [tasks, setTasks] = useState<TaskWithInitiative[]>([]);
  const [actualRevenue, setActualRevenue] = useState(0);
  const [actualSpend, setActualSpend] = useState(0);

  // Quick result entry form
  const [showResultForm, setShowResultForm] = useState(false);
  const [resultRevenue, setResultRevenue] = useState('');
  const [resultSpend, setResultSpend] = useState('');
  const [resultSaved, setResultSaved] = useState(false);

  const weekEnd = getWeekEnd(weekStart);

  const goToPrevWeek = useCallback(() => {
    const prev = new Date(weekStart);
    prev.setDate(prev.getDate() - 7);
    setWeekStart(prev);
  }, [weekStart, companyId]);

  const goToNextWeek = useCallback(() => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + 7);
    setWeekStart(next);
  }, [weekStart, companyId]);

  const goToThisWeek = useCallback(() => {
    setWeekStart(getWeekStart(new Date()));
  }, []);

  useEffect(() => {
    if (!companyId) return;
    const loadWeekData = async () => {
      try {
        setLoading(true);
        setError(null);
        setResultSaved(false);

        const end = getWeekEnd(weekStart);

        // Fetch plan and active initiatives in parallel
        const [plan, activeInitiatives, weekResults] = await Promise.all([
          planService.getWeeklyPlan(companyId, weekStart),
          initiativeService.getActiveInitiatives(companyId),
          resultService.getResultsByWeek(companyId, weekStart),
        ]);

        setWeeklyPlan(plan);

        // Filter initiatives active during this week
        const weekInitiatives = activeInitiatives.filter(init => {
          const activation = new Date(init.activationDate);
          const eventDate = init.eventDate ? new Date(init.eventDate) : null;

          if (init.kind === 'evergreen') {
            return activation <= end;
          }
          // One-time or recurring: check if activation is before week end and event is after week start
          if (eventDate) {
            return activation <= end && eventDate >= weekStart;
          }
          return activation <= end;
        });
        setInitiatives(weekInitiatives);

        console.log("[WeeklyPlanner] Loaded", weekInitiatives.length, "initiatives for week");

        // Load tasks for all active initiatives, filter those due this week
        const allTasks: TaskWithInitiative[] = [];
        for (const init of weekInitiatives) {
          const initTasks = await taskService.getTasksByInitiative(init.id);
          const dueThisWeek = initTasks.filter(t => {
            const due = new Date(t.dueDate);
            return due >= weekStart && due <= end;
          });
          dueThisWeek.forEach(t => {
            allTasks.push({ ...t, initiativeName: init.name });
          });
        }
        // Sort by priority (critical first) then due date
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        allTasks.sort((a, b) => {
          const pDiff = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
          if (pDiff !== 0) return pDiff;
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        });
        console.log("[WeeklyPlanner] Found", allTasks.length, "tasks due this week");
        setTasks(allTasks);

        // Calculate actuals from results
        const totalRevenue = weekResults.reduce((sum: number, r: Result) => sum + r.actualRevenue, 0);
        const totalSpend = weekResults.reduce((sum: number, r: Result) => sum + r.actualSpend, 0);
        setActualRevenue(totalRevenue);
        setActualSpend(totalSpend);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load weekly data';
        setError(message);
        console.error('Error loading weekly planner data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadWeekData();
  }, [weekStart, companyId]);

  const handleStatusToggle = async (taskId: string, currentStatus: TaskStatus) => {
    const newStatus = cycleStatus(currentStatus);
    console.log("[WeeklyPlanner] Task status toggle:", taskId, currentStatus, "→", newStatus);
    // Optimistic update
    setTasks(prev =>
      prev.map(t => (t.id === taskId ? { ...t, status: newStatus, completedAt: newStatus === 'completed' ? new Date() : t.completedAt } : t))
    );
    try {
      await taskService.updateTaskStatus(taskId, newStatus);
      console.log("[WeeklyPlanner] Status updated successfully");
      // Auto-update parent initiative status
      const changedTask = tasks.find(t => t.id === taskId);
      if (changedTask && (changedTask as any).initiativeId) {
        updateInitiativeStatusFromTasks((changedTask as any).initiativeId);
      }
    } catch (err: any) {
      // Revert on failure (e.g. RLS blocked a viewer)
      console.error('[WeeklyPlanner] Failed, reverting:', err?.message || err);
      setTasks(prev =>
        prev.map(t => (t.id === taskId ? { ...t, status: currentStatus } : t))
      );
      alert(err?.message || "You do not have permission to update this task.");
    }
  };

  const handleResultSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const revenue = parseFloat(resultRevenue) || 0;
    const spend = parseFloat(resultSpend) || 0;
    if (revenue === 0 && spend === 0) return;

    try {
      await resultService.createInitiativeResult({
        companyId: companyId,
        initiativeId: initiatives[0]?.id || 'general',
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        actualRevenue: revenue,
        actualSpend: spend,
        notes: 'Entered via weekly planner',
      });
      setActualRevenue(prev => prev + revenue);
      setActualSpend(prev => prev + spend);
      setResultRevenue('');
      setResultSpend('');
      setResultSaved(true);
      setShowResultForm(false);
    } catch (err) {
      console.error('Failed to save result:', err);
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

  const targetRevenue = weeklyPlan?.targetRevenue || 0;
  const progressPct = targetRevenue > 0 ? Math.min((actualRevenue / targetRevenue) * 100, 100) : 0;
  const isCurrentWeek = getWeekStart(new Date()).getTime() === weekStart.getTime();

  return (
    <div className="space-y-6">
      {/* Week Selector */}
      <div className="flex items-center gap-3">
        <button
          onClick={goToPrevWeek}
          className="p-2 rounded-[var(--radius-lg)] bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/80 transition-colors"
          aria-label="Previous week"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <p className="text-sm font-semibold">
            {formatDateShort(weekStart)} – {formatDateShort(weekEnd)}, {weekStart.getFullYear()}
          </p>
          <input
            type="date"
            value={weekStart.toISOString().split('T')[0]}
            onChange={e => {
              const d = new Date(e.target.value + 'T00:00:00');
              if (!isNaN(d.getTime())) setWeekStart(getWeekStart(d));
            }}
            className="mt-1 px-2 py-1 rounded-[var(--radius-md)] border border-border bg-background text-xs text-center outline-none focus:border-[hsl(var(--primary))] cursor-pointer"
          />
        </div>
        <button
          onClick={goToNextWeek}
          className="p-2 rounded-[var(--radius-lg)] bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/80 transition-colors"
          aria-label="Next week"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {!isCurrentWeek && (
          <button
            onClick={goToThisWeek}
            className="px-3 py-1.5 rounded-[var(--radius-lg)] text-xs font-medium bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity"
          >
            This Week
          </button>
        )}
      </div>

      {/* Weekly Revenue */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Step 1: Complete Results</h3>
          <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
            {actualRevenue > 0 ? '✓ Done' : 'Action needed'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-[var(--radius-lg)] border border-border p-3 space-y-1">
            <span className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Target</span>
            <p className="text-lg font-bold">
              {targetRevenue > 0 ? formatCurrency(targetRevenue) : '—'}
            </p>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-border p-3 space-y-1">
            <span className="text-xs font-medium text-emerald-500">Actual Revenue</span>
            <p className="text-lg font-bold">{formatCurrency(actualRevenue)}</p>
          </div>
          <div className="rounded-[var(--radius-lg)] border border-border p-3 space-y-1">
            <span className="text-xs font-medium text-amber-500">Spend</span>
            <p className="text-lg font-bold">{formatCurrency(actualSpend)}</p>
          </div>
        </div>

        {targetRevenue > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[hsl(var(--foreground-muted))]">Progress vs Target</span>
              <span className="font-medium">{progressPct.toFixed(0)}%</span>
            </div>
            <div className="h-3 bg-[hsl(var(--muted))] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-[hsl(var(--primary))] transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-[hsl(var(--foreground-muted))]">
              <span>{formatCurrency(actualRevenue)}</span>
              <span>{formatCurrency(targetRevenue)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Active Initiatives */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Rocket className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Step 2: See Where You Are</h3>
        </div>
        <p className="text-xs text-[hsl(var(--foreground-muted))]">
          Your active initiatives and their performance against plan.
        </p>

        {initiatives.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground-muted))] py-4 text-center">
            No initiatives active this week.
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
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-[hsl(var(--foreground-muted))] capitalize">
                      {initiative.kind.replace('_', ' ')}
                    </span>
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                    STATUS_COLORS[initiative.status] || 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {initiative.status.replace('_', ' ')}
                </span>
                <ChevronRight className="h-4 w-4 text-[hsl(var(--foreground-muted))] group-hover:text-[hsl(var(--primary))] shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tasks Due This Week */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Step 3: What&apos;s Moving</h3>
          <span className="ml-auto text-sm text-[hsl(var(--foreground-muted))]">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''} due
          </span>
        </div>

        {/* Slipping/overdue warning */}
        {tasks.filter(t => new Date(t.dueDate) < new Date() && t.status !== 'completed' && t.status !== 'cancelled').length > 0 && (
          <div className="rounded-[var(--radius-md)] bg-red-50 border border-red-200 p-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <span className="text-sm text-red-700">
              <strong>{tasks.filter(t => new Date(t.dueDate) < new Date() && t.status !== 'completed' && t.status !== 'cancelled').length} task(s) overdue</strong> — address these before they slip further
            </span>
          </div>
        )}

        {tasks.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground-muted))] py-4 text-center">
            No tasks due this week.
          </p>
        ) : (
          <div className="space-y-2">
            {tasks.map(task => {
              const StatusIcon = getStatusIcon(task.status);
              const dueDate = new Date(task.dueDate);
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
                  <span className="text-xs text-[hsl(var(--foreground-muted))] whitespace-nowrap">
                    {formatDateShort(dueDate)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Step 4: Adjust if Needed */}
      <div className="rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-6 space-y-3">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-[hsl(var(--foreground-muted))]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          <h3 className="text-lg font-semibold">Step 4: Adjust if Needed</h3>
        </div>
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          Review what&apos;s working and what isn&apos;t. Refine initiatives, adjust numbers, or resequence tasks as needed.
        </p>
        <button
          onClick={() => router.push('/initiatives')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-[var(--radius-md)] border border-border hover:border-[hsl(var(--primary))] text-sm font-medium transition-colors"
        >
          <Rocket className="h-4 w-4" />
          Review Initiatives
        </button>
      </div>

      {/* Top Priorities */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Star className="h-5 w-5 text-amber-500" />
          <h3 className="text-lg font-semibold">Step 5: Top Priorities This Week</h3>
        </div>

        {weeklyPlan && weeklyPlan.topPriorities.length > 0 ? (
          <ul className="space-y-2">
            {weeklyPlan.topPriorities.map((priority, idx) => {
              // Priorities might be initiative IDs — try to find matching initiative name
              const matchedInit = initiatives.find(i => i.id === priority || i.id.includes(priority));
              const displayText = matchedInit ? matchedInit.name : priority;
              return (
                <li
                  key={idx}
                  className="flex items-start gap-3 py-2 px-3 rounded-[var(--radius-lg)] bg-[hsl(var(--muted))]/50"
                >
                  <span className="shrink-0 w-6 h-6 rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] flex items-center justify-center text-xs font-bold">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-medium">{displayText}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="text-center py-4">
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              No priorities set for this week.
            </p>
            <p className="text-xs text-[hsl(var(--foreground-muted))] mt-1">
              Set 1–3 top priorities in your weekly plan to stay focused.
            </p>
          </div>
        )}
      </div>

      {/* Quick Result Entry */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
        <div className="flex items-center gap-2">
          <PlusCircle className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
          <h3 className="text-lg font-semibold">Quick Result Entry</h3>
        </div>

        {resultSaved && (
          <div className="rounded-[var(--radius-lg)] bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
            Result saved successfully!
          </div>
        )}

        {!showResultForm ? (
          <button
            onClick={() => setShowResultForm(true)}
            className="w-full py-4 rounded-[var(--radius-lg)] border-2 border-dashed border-border hover:border-[hsl(var(--primary))]/50 hover:bg-[hsl(var(--muted))]/30 transition-colors text-center"
          >
            <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">
              Enter this week&apos;s results
            </p>
            <p className="text-xs text-[hsl(var(--foreground-muted))] mt-1">
              Record revenue and spend to track progress
            </p>
          </button>
        ) : (
          <form onSubmit={handleResultSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="result-revenue" className="text-sm font-medium">
                  Revenue ($)
                </label>
                <input
                  id="result-revenue"
                  type="number"
                  min="0"
                  step="0.01"
                  value={resultRevenue}
                  onChange={e => setResultRevenue(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-[var(--radius-lg)] border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="result-spend" className="text-sm font-medium">
                  Spend ($)
                </label>
                <input
                  id="result-spend"
                  type="number"
                  min="0"
                  step="0.01"
                  value={resultSpend}
                  onChange={e => setResultSpend(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-[var(--radius-lg)] border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="px-4 py-2 rounded-[var(--radius-lg)] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Save Result
              </button>
              <button
                type="button"
                onClick={() => setShowResultForm(false)}
                className="px-4 py-2 rounded-[var(--radius-lg)] bg-[hsl(var(--muted))] text-sm font-medium hover:opacity-80 transition-opacity"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Weekly Notes */}
      {weeklyPlan?.notes && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-3">
          <div className="flex items-center gap-2">
            <StickyNote className="h-5 w-5 text-[hsl(var(--foreground-muted))]" />
            <h3 className="text-lg font-semibold">Weekly Notes</h3>
          </div>
          <p className="text-sm text-[hsl(var(--foreground-muted))] leading-relaxed">
            {weeklyPlan.notes}
          </p>
        </div>
      )}
    </div>
  );
}
