/**
 * Turn workbook task templates into concrete task rows.
 *
 * The workbook authors, per initiative, the tasks it takes to run it and how
 * many days before the event each one must happen. That is domain knowledge the
 * AI was previously asked to invent. This module instantiates it instead, so a
 * generated plan's task list and its lead times come from the workbook.
 *
 * Pure: takes templates and an event date, returns rows. No database.
 */

import { computeTaskDueDate, clampNotBefore, toDateOnly, type DateOnly } from '@/lib/plan-dates';

export interface TaskTemplate {
  taskNumber: number | null;
  name: string;
  category?: string | null;
  leadDays: number;
  durationHours?: number | null;
  role?: string | null;
  dependsOn: number[];
  notes?: string | null;
  displayOrder: number;
}

export interface MaterialisedTask {
  id: string;
  name: string;
  description: string;
  dueDate: DateOnly;
  estimatedHours: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  dependencyIds: string[];
  displayOrder: number;
}

export interface MaterialiseOptions {
  /** Event the tasks count back from. */
  eventDate: Date | string;
  /** No task may be due before this (today, in practice). */
  floor: Date | string;
  /** Supplies ids so dependencies resolve in a single pass. Injectable for tests. */
  newId?: () => string;
}

/**
 * Priority is not a workbook column, so it is DERIVED from the dependency graph
 * rather than invented: a task other tasks wait on is blocking, and blocking
 * work matters more than leaf work. Everything else stays medium.
 */
function derivePriority(template: TaskTemplate, blockers: Set<number>): MaterialisedTask['priority'] {
  if (template.taskNumber !== null && blockers.has(template.taskNumber)) return 'high';
  return 'medium';
}

/** Role has no column on `tasks`, so it is folded into the description. */
function buildDescription(t: TaskTemplate): string {
  const parts: string[] = [];
  if (t.notes) parts.push(t.notes);
  if (t.role) parts.push(`Role: ${t.role}`);
  if (t.category) parts.push(`Stage: ${t.category}`);
  return parts.join('\n\n');
}

export function materialiseTasks(
  templates: readonly TaskTemplate[],
  options: MaterialiseOptions
): MaterialisedTask[] {
  if (!templates || templates.length === 0) return [];
  const newId = options.newId ?? (() => crypto.randomUUID());

  const ordered = [...templates].sort((a, b) => a.displayOrder - b.displayOrder);

  // Ids first, so `dependsOn` task numbers can be turned into real ids without a
  // second database round trip.
  const idByTaskNumber = new Map<number, string>();
  const ids = ordered.map((t) => {
    const id = newId();
    if (t.taskNumber !== null && !idByTaskNumber.has(t.taskNumber)) {
      idByTaskNumber.set(t.taskNumber, id);
    }
    return id;
  });

  // Task numbers that something else depends on.
  const blockers = new Set<number>();
  for (const t of ordered) for (const d of t.dependsOn) blockers.add(d);

  return ordered.map((t, i) => ({
    id: ids[i],
    name: t.name,
    description: buildDescription(t),
    // Counted back from the event, floored so nothing is due before the plan
    // exists. The lead time is the workbook's, not the model's.
    dueDate: toDateOnly(clampNotBefore(computeTaskDueDate(options.eventDate, t.leadDays), options.floor)),
    estimatedHours: typeof t.durationHours === 'number' && Number.isFinite(t.durationHours)
      ? t.durationHours
      : 0,
    priority: derivePriority(t, blockers),
    // A dependency on a task number that isn't in this template is dropped
    // rather than guessed at.
    dependencyIds: t.dependsOn.map((n) => idByTaskNumber.get(n)).filter((v): v is string => !!v),
    displayOrder: i,
  }));
}

/**
 * The preparation window an initiative needs: its longest authored lead time.
 * Workbook equivalent of `requiredRunwayDays`, but reading authored data instead
 * of AI output.
 */
export function templateRunwayDays(templates: readonly TaskTemplate[]): number {
  let max = 0;
  for (const t of templates || []) {
    const lead = Math.abs(Math.trunc(t.leadDays || 0));
    if (lead > max) max = lead;
  }
  return max;
}

/**
 * Fallback for initiatives the workbook has no template for.
 *
 * The workbook is still being authored: 4 library initiatives currently have no
 * task list. Rather than saving those with no project plan at all, the model's
 * own task suggestions are used. They go through exactly the same date handling
 * as authored tasks - lead time magnitude, count back from the event, floor at
 * today - so a fallback plan is scheduled as correctly as a real one. The only
 * difference is where the task list came from.
 */
export interface AiTask {
  name?: string;
  description?: string;
  daysBeforeEvent?: unknown;
  estimatedHours?: unknown;
  priority?: string;
}

const VALID_PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
/** Same ceiling the workbook parser applies, for the same reason. */
const MAX_TASK_HOURS = 200;

export function materialiseAiTasks(
  tasks: readonly AiTask[] | undefined | null,
  options: MaterialiseOptions
): MaterialisedTask[] {
  if (!tasks || tasks.length === 0) return [];
  const newId = options.newId ?? (() => crypto.randomUUID());

  return tasks
    .filter((t) => String(t?.name ?? '').trim() !== '')
    .map((t, i) => {
      const hours = Number(t.estimatedHours);
      return {
        id: newId(),
        name: String(t.name).trim(),
        description: String(t.description ?? ''),
        dueDate: toDateOnly(
          clampNotBefore(computeTaskDueDate(options.eventDate, t.daysBeforeEvent), options.floor)
        ),
        estimatedHours: Number.isFinite(hours) && hours >= 0 && hours <= MAX_TASK_HOURS ? hours : 2,
        priority: (VALID_PRIORITIES.has(String(t.priority)) ? t.priority : 'medium') as MaterialisedTask['priority'],
        // The model is not asked for dependencies; only the workbook has them.
        dependencyIds: [],
        displayOrder: i,
      };
    });
}
