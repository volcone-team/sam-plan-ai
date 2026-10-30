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

import {
  computeSignedTaskDueDate,
  computeTaskDueDate,
  clampNotBefore,
  toDateOnly,
  type DateOnly,
} from '@/lib/plan-dates';

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
  /** Workbook section heading (migration 061). Null = no heading. */
  section?: string | null;
  /**
   * Which template this row came from, when several are combined (the
   * initiative's own plus sections pulled in by intake answers). Task numbers
   * restart per group and section, so dependencies resolve within one.
   */
  group?: string | null;
  /** "cart": counts back from when the cart opens, not from the event (sales funnels). */
  anchor?: 'cart' | null;
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
  /** When the cart opens; tasks anchored to it count back from here. */
  cartOpens?: Date | string | null;
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

  // Source order: groups in the order they were combined, then sheet order.
  const groupRank = new Map<string, number>();
  for (const t of templates) {
    const g = t.group ?? '';
    if (!groupRank.has(g)) groupRank.set(g, groupRank.size);
  }
  const ordered = templates
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        (groupRank.get(a.t.group ?? '') ?? 0) - (groupRank.get(b.t.group ?? '') ?? 0) ||
        a.t.displayOrder - b.t.displayOrder ||
        a.i - b.i
    )
    .map((x) => x.t);

  /*
   * Task numbers restart in every section and every combined template (the
   * OPS tab numbers its "selling" section 18-37 again), so a dependency is
   * looked up within its own group and section. Looking it up across the
   * whole list pointed later sections at the first section's tasks.
   */
  const scope = (t: TaskTemplate) => `${t.group ?? ''}\u0000${t.section ?? ''}`;
  const idByNumber = new Map<string, string>();
  const ids = ordered.map((t) => {
    const id = newId();
    if (t.taskNumber !== null) {
      const k = `${scope(t)}\u0000${t.taskNumber}`;
      if (!idByNumber.has(k)) idByNumber.set(k, id);
    }
    return id;
  });

  const blockers = new Set<string>();
  for (const t of ordered) for (const d of t.dependsOn) blockers.add(`${scope(t)}\u0000${d}`);

  const built = ordered.map((t, i) => ({
    id: ids[i],
    name: t.name,
    description: buildDescription(t),
    // Counted from the event (positive lead = before, negative = after),
    // floored so nothing is due before the plan exists. The lead time is the
    // workbook's, not the model's.
    dueDate: toDateOnly(
      clampNotBefore(
        computeSignedTaskDueDate(t.anchor === 'cart' && options.cartOpens ? options.cartOpens : options.eventDate, t.leadDays),
        options.floor
      )
    ),
    estimatedHours: typeof t.durationHours === 'number' && Number.isFinite(t.durationHours)
      ? t.durationHours
      : 0,
    // Priority is derived, not a workbook column: a task others wait on is high.
    priority: (t.taskNumber !== null && blockers.has(`${scope(t)}\u0000${t.taskNumber}`) ? 'high' : 'medium') as MaterialisedTask['priority'],
    // A dependency on a task number that isn't in this section is dropped
    // rather than guessed at.
    dependencyIds: t.dependsOn
      .map((n) => idByNumber.get(`${scope(t)}\u0000${n}`))
      .filter((v): v is string => !!v),
    order: i,
  }));

  /*
   * ONE TASK PER NAME (client: "so much task duplication"). Combined sections
   * repeat steps ("Define pricing" in OPS and in Funnels); the one due
   * EARLIEST is kept, the rest are dropped and anything depending on them
   * depends on the kept one instead.
   */
  const keepByName = new Map<string, (typeof built)[number]>();
  const replacedBy = new Map<string, string>();
  for (const task of built) {
    const k = task.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const kept = keepByName.get(k);
    if (!kept) { keepByName.set(k, task); continue; }
    const [winner, loser] = task.dueDate < kept.dueDate ? [task, kept] : [kept, task];
    keepByName.set(k, winner);
    replacedBy.set(loser.id, winner.id);
    if (loser.priority === 'high') winner.priority = 'high';
  }
  const resolve = (id: string) => { let cur = id; while (replacedBy.has(cur)) cur = replacedBy.get(cur)!; return cur; };

  // In date order, so the list reads as the plan runs.
  return [...keepByName.values()]
    .sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : a.order - b.order))
    .map(({ order: _o, ...task }, i) => {
      void _o;
      const deps = [...new Set(task.dependencyIds.map(resolve))].filter((d) => d !== task.id);
      return { ...task, dependencyIds: deps, displayOrder: i };
    });
}

/**
 * The preparation window an initiative needs: its longest authored lead time.
 * Workbook equivalent of `requiredRunwayDays`, but reading authored data instead
 * of AI output.
 */
export function templateRunwayDays(templates: readonly TaskTemplate[]): number {
  let max = 0;
  for (const t of templates || []) {
    // Only work BEFORE the event needs runway; a follow-up (negative lead)
    // happens after it and must not push the event later.
    const lead = Math.max(0, Math.trunc(t.leadDays || 0));
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
/**
 * Same ceiling the workbook parser applies, for the same reason. Exported so
 * AI task validation (src/lib/workbook/ai-tasks.ts) clamps to the SAME limit
 * rather than inventing a second one that disagrees with this module.
 */
export const MAX_TASK_HOURS = 200;

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
