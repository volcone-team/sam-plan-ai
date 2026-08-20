'use client';
import { formatDate, formatDateShort } from '@/lib/format-date';

import { COMPANY_ID } from '@/lib/constants';
const companyId = COMPANY_ID;

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Rocket,
  ListTodo,
} from 'lucide-react';
import { initiativeService } from '@/services/initiative.service';
import { taskService } from '@/services/task.service';
import type { Initiative, Task } from '@/types';


const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface CalendarDay {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  initiatives: Initiative[];
  tasks: TaskWithInit[];
  overdueTasks: TaskWithInit[];
}

interface TaskWithInit extends Task {
  initiativeName: string;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate();
}

function getCalendarDays(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  // Find Monday before or on the first day
  let startDay = new Date(firstDay);
  const dayOfWeek = startDay.getDay();
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  startDay.setDate(startDay.getDate() + diff);

  const days: Date[] = [];
  const current = new Date(startDay);

  // Fill 6 rows × 7 cols = 42 days (but we can stop after last row that contains month days)
  while (days.length < 42) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
    // After we pass the last day and complete the row
    if (days.length >= 35 && current.getMonth() !== month && current.getDay() === 1) {
      break;
    }
  }

  return days;
}

export function CalendarView() {
  const router = useRouter();
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(() => new Date().getMonth());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [allTasks, setAllTasks] = useState<TaskWithInit[]>([]);
  const [selectedDay, setSelectedDay] = useState<CalendarDay | null>(null);

  const goToPrevMonth = useCallback(() => {
    setCurrentMonth(prev => {
      if (prev === 0) {
        setCurrentYear(y => y - 1);
        return 11;
      }
      return prev - 1;
    });
    setSelectedDay(null);
  }, []);

  const goToNextMonth = useCallback(() => {
    setCurrentMonth(prev => {
      if (prev === 11) {
        setCurrentYear(y => y + 1);
        return 0;
      }
      return prev + 1;
    });
    setSelectedDay(null);
  }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const allInitiatives = await initiativeService.getInitiativesByCompany(companyId);
        setInitiatives(allInitiatives);

        // Load tasks for all initiatives
        const tasks: TaskWithInit[] = [];
        for (const init of allInitiatives) {
          const initTasks = await taskService.getTasksByInitiative(init.id);
          initTasks.forEach(t => {
            tasks.push({ ...t, initiativeName: init.name });
          });
        }
        setAllTasks(tasks);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load calendar data';
        setError(message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const today = useMemo(() => new Date(), []);

  const calendarDays: CalendarDay[] = useMemo(() => {
    const days = getCalendarDays(currentYear, currentMonth);

    return days.map(date => {
      // Find initiatives with event dates on this day
      const dayInitiatives = initiatives.filter(init => {
        if (init.eventDate && isSameDay(new Date(init.eventDate), date)) return true;
        if (isSameDay(new Date(init.activationDate), date)) return true;
        return false;
      });

      // Find tasks due on this day
      const dayTasks = allTasks.filter(t => isSameDay(new Date(t.dueDate), date));

      // Overdue: due before today and not completed
      const overdue = dayTasks.filter(t => {
        const due = new Date(t.dueDate);
        return due < today && t.status !== 'completed' && t.status !== 'cancelled';
      });

      return {
        date,
        isCurrentMonth: date.getMonth() === currentMonth,
        isToday: isSameDay(date, today),
        initiatives: dayInitiatives,
        tasks: dayTasks.filter(t => !overdue.includes(t)),
        overdueTasks: overdue,
      };
    });
  }, [currentYear, currentMonth, initiatives, allTasks, today]);

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

  return (
    <div className="space-y-6">
      {/* Month Selector */}
      <div className="flex items-center gap-3">
        <button
          onClick={goToPrevMonth}
          className="p-2 rounded-[var(--radius-lg)] bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/80 transition-colors"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center">
          <p className="text-sm font-semibold">
            {MONTH_NAMES[currentMonth]} {currentYear}
          </p>
        </div>
        <button
          onClick={goToNextMonth}
          className="p-2 rounded-[var(--radius-lg)] bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/80 transition-colors"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
          <span className="text-[hsl(var(--foreground-muted))]">Initiative</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="text-[hsl(var(--foreground-muted))]">Task</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
          <span className="text-[hsl(var(--foreground-muted))]">Overdue</span>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-border">
          {DAY_LABELS.map(label => (
            <div
              key={label}
              className="px-2 py-2 text-center text-xs font-medium text-[hsl(var(--foreground-muted))] bg-[hsl(var(--muted))]/50"
            >
              {label}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {calendarDays.map((day, idx) => {
            const hasEvents = day.initiatives.length > 0 || day.tasks.length > 0 || day.overdueTasks.length > 0;
            const isSelected = selectedDay && isSameDay(day.date, selectedDay.date);

            return (
              <button
                key={idx}
                onClick={() => setSelectedDay(day)}
                className={`
                  relative min-h-[72px] p-1.5 border-b border-r border-border text-left transition-colors
                  ${day.isCurrentMonth ? '' : 'opacity-40'}
                  ${day.isToday ? 'bg-[hsl(var(--primary))]/5' : ''}
                  ${isSelected ? 'ring-2 ring-inset ring-[hsl(var(--primary))]' : ''}
                  ${hasEvents ? 'hover:bg-[hsl(var(--muted))]/50 cursor-pointer' : 'cursor-pointer hover:bg-[hsl(var(--muted))]/30'}
                `}
                aria-label={`${day.date.toDateString()}${day.initiatives.length > 0 ? `, ${day.initiatives.length} initiatives` : ''}${day.tasks.length > 0 ? `, ${day.tasks.length} tasks` : ''}`}
              >
                <span
                  className={`text-xs font-medium ${
                    day.isToday
                      ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] rounded-full w-5 h-5 flex items-center justify-center'
                      : ''
                  }`}
                >
                  {day.date.getDate()}
                </span>

                {/* Dots */}
                {hasEvents && (
                  <div className="flex flex-wrap gap-0.5 mt-1">
                    {day.initiatives.slice(0, 3).map((_, i) => (
                      <div key={`init-${i}`} className="h-2 w-2 rounded-full bg-blue-500" />
                    ))}
                    {day.tasks.slice(0, 3).map((_, i) => (
                      <div key={`task-${i}`} className="h-2 w-2 rounded-full bg-emerald-500" />
                    ))}
                    {day.overdueTasks.slice(0, 2).map((_, i) => (
                      <div key={`over-${i}`} className="h-2 w-2 rounded-full bg-red-500" />
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Day Detail Panel */}
      {selectedDay && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6 space-y-4">
          <h3 className="text-sm font-semibold">
            {formatDate(selectedDay.date)}
          </h3>

          {/* Initiatives */}
          {selectedDay.initiatives.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Rocket className="h-4 w-4 text-blue-500" />
                <span className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
                  Initiatives ({selectedDay.initiatives.length})
                </span>
              </div>
              {selectedDay.initiatives.map(init => (
                <button
                  key={init.id}
                  onClick={() => router.push(`/initiatives/${init.id}`)}
                  className="w-full text-left px-3 py-2 rounded-[var(--radius-lg)] border border-blue-200 bg-blue-50 hover:bg-blue-100 transition-colors"
                >
                  <p className="text-sm font-medium text-blue-900">{init.name}</p>
                  <p className="text-xs text-blue-700 capitalize">{init.status.replace('_', ' ')}</p>
                </button>
              ))}
            </div>
          )}

          {/* Tasks */}
          {selectedDay.tasks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <ListTodo className="h-4 w-4 text-emerald-500" />
                <span className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
                  Tasks ({selectedDay.tasks.length})
                </span>
              </div>
              {selectedDay.tasks.map(task => (
                <div
                  key={task.id}
                  className="px-3 py-2 rounded-[var(--radius-lg)] border border-emerald-200 bg-emerald-50"
                >
                  <p className="text-sm font-medium text-emerald-900">{task.name}</p>
                  <p className="text-xs text-emerald-700">{task.initiativeName}</p>
                </div>
              ))}
            </div>
          )}

          {/* Overdue Tasks */}
          {selectedDay.overdueTasks.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-500" />
                <span className="text-xs font-medium text-red-600">
                  Overdue ({selectedDay.overdueTasks.length})
                </span>
              </div>
              {selectedDay.overdueTasks.map(task => (
                <div
                  key={task.id}
                  className="px-3 py-2 rounded-[var(--radius-lg)] border border-red-200 bg-red-50"
                >
                  <p className="text-sm font-medium text-red-900">{task.name}</p>
                  <p className="text-xs text-red-700">{task.initiativeName}</p>
                </div>
              ))}
            </div>
          )}

          {/* Empty day */}
          {selectedDay.initiatives.length === 0 &&
            selectedDay.tasks.length === 0 &&
            selectedDay.overdueTasks.length === 0 && (
              <p className="text-sm text-[hsl(var(--foreground-muted))] py-2">
                Nothing scheduled for this day.
              </p>
            )}
        </div>
      )}
    </div>
  );
}
