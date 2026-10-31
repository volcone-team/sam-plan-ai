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
import { activeInWeek } from '@/lib/initiatives/schedule';
import { formatMoney } from '@/lib/format-money';
import { NumberInputRaw } from '@/components/ui/number-input';
import { MetricInputs } from '@/components/initiatives/metric-inputs';
import { metricGroupsOf, parseMetricDraft } from '@/lib/metrics/result-metrics';
import type { WeeklyPlan, Initiative, Task, TaskStatus, Result } from '@/types';
import { weekTarget } from '@/lib/planning/period-totals';
import { loadMonthTargets } from '@/lib/planning/load-period-targets';


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

// Full comma-separated figures — see lib/format-money.
const formatCurrency = formatMoney;

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
  /** This week's share of the plan goal. */
  const [weekTargetRevenue, setWeekTargetRevenue] = useState(0);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [tasks, setTasks] = useState<TaskWithInitiative[]>([]);
  const [actualRevenue, setActualRevenue] = useState(0);
  const [actualSpend, setActualSpend] = useState(0);

  // Quick result entry form
  const [showResultForm, setShowResultForm] = useState(false);
  const [resultRevenue, setResultRevenue] = useState('');
  /** Which initiative the result is for; '' means the company as a whole. */
  const [resultInitiativeId, setResultInitiativeId] = useState('');
  const [resultError, setResultError] = useState<string | null>(null);
  const [resultSpend, setResultSpend] = useState('');
  const [resultSaved, setResultSaved] = useState(false);
  /** Raw metric text by field id; only used when the chosen initiative has a metric set. */
  const [resultMetrics, setResultMetrics] = useState<Record<string, string>>({});

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
        // The week's target is derived from the annual plan: each day takes its
        // share of its month's target (lib/planning/period-totals). The
        // weekly_plans table is not written by the current intake, so reading
        // its target left the card blank. A week across New Year needs both years.
        const weekYears = [...new Set([weekStart.getFullYear(), end.getFullYear()])];
        const [plan, activeInitiatives, weekResults, ...yearTargets] = await Promise.all([
          planService.getWeeklyPlan(companyId, weekStart),
          initiativeService.getActiveInitiatives(companyId),
          resultService.getResultsByWeek(companyId, weekStart),
          ...weekYears.map(y => loadMonthTargets(companyId, y)),
        ]);

        setWeeklyPlan(plan);
        const targetsByYear = new Map(weekYears.map((y, i) => [y, yearTargets[i] as number[]]));
        setWeekTargetRevenue(
          weekTarget(weekStart, (y, m) => targetsByYear.get(y)?.[m - 1] ?? 0)
        );

        // Filter initiatives active during this week. activeInWeek keeps this
        // planner's old rule for legacy rows verbatim; new-intake rows use
        // launch -> revenue close, and month-only / undated ones are excluded
        // because they were never given the days that would place them in a week.
        const weekInitiatives = activeInitiatives.filter(init => activeInWeek(init, weekStart, end));
        setInitiatives(weekInitiatives);

        console.log("[WeeklyPlanner] Loaded", weekInitiatives.length, "initiatives for week");

        // Tasks due this week, for the WHOLE COMPANY.
        //
        // This used to loop `weekInitiatives` and pull tasks per initiative, so
        // a task due this week whose initiative activates months later could
        // never appear - the reported "I set tasks due for the week and they
        // don't show up in weekly, daily or monthly". Inclusion now depends on
        // the task's own due date and nothing else.
        const weekTasks = await taskService.getTasksByCompanyDueBetween(
          companyId, weekStart, end
        );
        // Names come from every active initiative, not just this week's, or a
        // task from an out-of-window initiative would render unlabelled.
        const nameById = new Map(activeInitiatives.map(i => [i.id, i.name]));
        const allTasks: TaskWithInitiative[] = weekTasks.map(t => ({
          ...t,
          initiativeName: nameById.get(t.initiativeId) || 'Unassigned',
        }));
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

  /**
   * A result for the whole company (no initiative) is confirmed first
   * (client, Oct 2026): revenue an initiative already tracks would be counted
   * twice. Holds the pending save while the dialog is open.
   */
  const [confirmCompanyResult, setConfirmCompanyResult] = useState(false);
  useEffect(() => {
    if (!confirmCompanyResult) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirmCompanyResult(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmCompanyResult]);

  const handleResultSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resultInitiativeId) {
      // Nothing to save yet: no dialog for an empty form.
      if ((parseFloat(resultRevenue) || 0) === 0 && (parseFloat(resultSpend) || 0) === 0) return;
      setConfirmCompanyResult(true);
      return;
    }
    await saveResult();
  };

  const saveResult = async () => {
    setConfirmCompanyResult(false);
    const revenue = parseFloat(resultRevenue) || 0;
    const spend = parseFloat(resultSpend) || 0;
    // Metrics only for a result logged against an initiative with a metric set.
    const metricSet = initiatives.find(i => i.id === resultInitiativeId)?.metricSet ?? null;
    let metrics: Record<string, number> | undefined;
    if (metricSet) {
      const draft = parseMetricDraft(metricGroupsOf(metricSet), resultMetrics);
      if (Object.keys(draft.errors).length > 0) {
        setResultError('Fix the highlighted metrics before saving.');
        return;
      }
      if (Object.keys(draft.values).length > 0) metrics = draft.values;
    }
    if (revenue === 0 && spend === 0 && !metrics) return;

    setResultError(null);

    try {
      await resultService.createInitiativeResult({
        companyId: companyId,
        /*
         * The chosen initiative, or NULL for a company-level result.
         *
         * This used to fall back to the literal string 'general', which is not
         * a UUID: Postgres rejected the insert with a 400 every time a week
         * had no initiatives, and the error was reported as "Not found".
         * `results.initiative_id` is nullable, so NULL is the honest value.
         * It also silently pinned every result to the FIRST initiative of the
         * week when there were several; the user now chooses.
         */
        initiativeId: resultInitiativeId || null,
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        actualRevenue: revenue,
        actualSpend: spend,
        ...(metrics ? { metrics } : {}),
        notes: 'Entered via weekly planner',
      });
      setActualRevenue(prev => prev + revenue);
      setActualSpend(prev => prev + spend);
      setResultRevenue('');
      setResultSpend('');
      setResultMetrics({});
      setResultSaved(true);
      setShowResultForm(false);
    } catch (err) {
      console.error('Failed to save result:', err);
      // Shown to the user: the save used to fail with no feedback at all.
      setResultError(err instanceof Error ? err.message : 'Could not save this result.');
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

  const targetRevenue = weekTargetRevenue;
  // The label shows the real figure (e.g. 302%); only the bar stops at full.
  const actualPct = targetRevenue > 0 ? (actualRevenue / targetRevenue) * 100 : 0;
  const progressPct = Math.min(actualPct, 100);
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

      {/* Quick Result Entry: at the top, under the week selector (client, Oct 2026) */}
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
            {/* Only offered when there is something to attribute it to. */}
            {initiatives.length > 0 && (
              <div className="space-y-1.5">
                <label htmlFor="result-initiative" className="text-sm font-medium">
                  Initiative
                </label>
                <select
                  id="result-initiative"
                  value={resultInitiativeId}
                  onChange={e => { setResultInitiativeId(e.target.value); setResultMetrics({}); }}
                  className="w-full px-3 py-2 rounded-[var(--radius-lg)] border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                >
                  <option value="">Whole company (not a specific initiative)</option>
                  {initiatives.map(init => (
                    <option key={init.id} value={init.id}>{init.name}</option>
                  ))}
                </select>
                {!resultInitiativeId && (
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">
                    Only for results not tracked to an initiative. Results for a specific initiative go on its Results tab.
                  </p>
                )}
              </div>
            )}
            {resultError && (
              <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{resultError}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="result-revenue" className="text-sm font-medium">
                  Revenue ($)
                </label>
                <NumberInputRaw
                  id="result-revenue"
                  value={resultRevenue}
                  onValueChange={setResultRevenue}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-[var(--radius-lg)] border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="result-spend" className="text-sm font-medium">
                  Spend ($)
                </label>
                <NumberInputRaw
                  id="result-spend"
                  value={resultSpend}
                  onValueChange={setResultSpend}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-[var(--radius-lg)] border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/50"
                />
              </div>
            </div>
            {(() => {
              const set = initiatives.find(i => i.id === resultInitiativeId)?.metricSet;
              return set ? (
                <MetricInputs set={set} values={resultMetrics} onChange={setResultMetrics} idPrefix="planner-result" />
              ) : null;
            })()}
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
              <span className="font-medium">{actualPct.toFixed(0)}%</span>
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

      {/* Company-level result: confirm it is not already tracked to an initiative. */}
      {confirmCompanyResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" aria-hidden="true" onClick={() => setConfirmCompanyResult(false)} />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="company-result-title"
            aria-describedby="company-result-body"
            className="relative w-full max-w-md space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-lg"
          >
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
              <div className="space-y-2">
                <h2 id="company-result-title" className="text-base font-semibold">
                  Is this result tracked to an initiative?
                </h2>
                <p id="company-result-body" className="text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
                  Only add revenue here in the Quick Results that is not being tracked to an initiative or you
                  will double count your results. If you want to enter revenue or other results from specific
                  initiatives, please visit the initiative tab.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => { setConfirmCompanyResult(false); router.push('/initiatives'); }}
                className="px-4 py-2 rounded-[var(--radius-lg)] border border-border text-sm font-medium hover:bg-[hsl(var(--muted))] transition-colors"
              >
                Go to Initiatives
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setConfirmCompanyResult(false)}
                className="px-4 py-2 rounded-[var(--radius-lg)] bg-[hsl(var(--muted))] text-sm font-medium hover:opacity-80 transition-opacity"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveResult()}
                className="px-4 py-2 rounded-[var(--radius-lg)] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] text-sm font-medium hover:opacity-90 transition-opacity"
              >
                Save anyway
              </button>
            </div>
          </div>
        </div>
      )}

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
