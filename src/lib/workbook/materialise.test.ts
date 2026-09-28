import { describe, it, expect } from 'vitest';
import { materialiseTasks, materialiseAiTasks, templateRunwayDays, type TaskTemplate } from '@/lib/workbook/materialise';

let n = 0;
const newId = () => `id-${++n}`;
const reset = () => { n = 0; };

const tpl = (o: Partial<TaskTemplate> & { name: string; displayOrder: number }): TaskTemplate => ({
  taskNumber: null, leadDays: 0, dependsOn: [], ...o,
});

// Mirrors the real Live Webinar template: tasks 1-3 at 35 days, promotion at 7.
const webinar: TaskTemplate[] = [
  tpl({ taskNumber: 1, name: 'Decide the product', leadDays: 35, durationHours: 3, role: 'Owner', category: 'Build', notes: 'Offer first.', displayOrder: 0 }),
  tpl({ taskNumber: 2, name: 'Decide pricing', leadDays: 35, durationHours: 3, dependsOn: [1], displayOrder: 1 }),
  tpl({ taskNumber: 3, name: 'Promote', leadDays: 7, durationHours: 2, dependsOn: [2], displayOrder: 2 }),
];

describe('materialiseTasks', () => {
  it('counts each task back from the event using the workbook lead time', () => {
    reset();
    const out = materialiseTasks(webinar, { eventDate: '2026-12-01', floor: '2026-09-27', newId });
    expect(out.map((t) => t.dueDate)).toEqual(['2026-10-27', '2026-10-27', '2026-11-24']);
  });

  it('resolves dependencies to real ids in one pass', () => {
    reset();
    const out = materialiseTasks(webinar, { eventDate: '2026-12-01', floor: '2026-09-27', newId });
    expect(out[0].dependencyIds).toEqual([]);
    expect(out[1].dependencyIds).toEqual([out[0].id]);
    expect(out[2].dependencyIds).toEqual([out[1].id]);
  });

  it('drops a dependency on a task number outside the template', () => {
    reset();
    const out = materialiseTasks([tpl({ taskNumber: 1, name: 'A', leadDays: 5, dependsOn: [99], displayOrder: 0 })],
      { eventDate: '2026-12-01', floor: '2026-09-27', newId });
    expect(out[0].dependencyIds).toEqual([]);
  });

  it('marks blocking tasks high and leaf tasks medium', () => {
    reset();
    const out = materialiseTasks(webinar, { eventDate: '2026-12-01', floor: '2026-09-27', newId });
    expect(out.map((t) => t.priority)).toEqual(['high', 'high', 'medium']);
  });

  it('never returns a due date before the floor', () => {
    reset();
    const out = materialiseTasks(webinar, { eventDate: '2026-10-01', floor: '2026-09-27', newId });
    for (const t of out) expect(t.dueDate >= '2026-09-27').toBe(true);
  });

  it('carries duration into estimated hours and defaults to 0', () => {
    reset();
    const out = materialiseTasks(
      [tpl({ name: 'A', leadDays: 1, durationHours: 2.5, displayOrder: 0 }), tpl({ name: 'B', leadDays: 1, displayOrder: 1 })],
      { eventDate: '2026-12-01', floor: '2026-09-27', newId });
    expect(out.map((t) => t.estimatedHours)).toEqual([2.5, 0]);
  });

  it('folds notes, role and stage into the description', () => {
    reset();
    const out = materialiseTasks(webinar, { eventDate: '2026-12-01', floor: '2026-09-27', newId });
    expect(out[0].description).toContain('Offer first.');
    expect(out[0].description).toContain('Role: Owner');
    expect(out[0].description).toContain('Stage: Build');
  });

  it('sorts by display order and renumbers from zero', () => {
    reset();
    const out = materialiseTasks(
      [tpl({ name: 'second', leadDays: 1, displayOrder: 5 }), tpl({ name: 'first', leadDays: 1, displayOrder: 1 })],
      { eventDate: '2026-12-01', floor: '2026-09-27', newId });
    expect(out.map((t) => t.name)).toEqual(['first', 'second']);
    expect(out.map((t) => t.displayOrder)).toEqual([0, 1]);
  });

  it('returns nothing for an initiative with no template', () => {
    expect(materialiseTasks([], { eventDate: '2026-12-01', floor: '2026-09-27' })).toEqual([]);
  });
});

describe('templateRunwayDays', () => {
  it('is the longest authored lead time', () => {
    expect(templateRunwayDays(webinar)).toBe(35);
  });
  it('is zero with no tasks', () => {
    expect(templateRunwayDays([])).toBe(0);
  });
});

describe('materialiseAiTasks (fallback where the workbook is unfilled)', () => {
  const opts = { eventDate: '2026-12-01', floor: '2026-09-27', newId: () => `ai-${++n}` };

  it('schedules AI tasks with the same date rules as authored ones', () => {
    reset();
    const out = materialiseAiTasks(
      [{ name: 'Draft outline', daysBeforeEvent: 14, estimatedHours: 3, priority: 'high' }], opts);
    expect(out[0].dueDate).toBe('2026-11-17');
    expect(out[0].priority).toBe('high');
    expect(out[0].estimatedHours).toBe(3);
  });

  it('never trusts a wrong sign or an implausible duration', () => {
    reset();
    const out = materialiseAiTasks(
      [{ name: 'A', daysBeforeEvent: -14, estimatedHours: 46025 }], opts);
    expect(out[0].dueDate).toBe('2026-11-17');   // magnitude, still before the event
    expect(out[0].estimatedHours).toBe(2);        // implausible value replaced
  });

  it('floors due dates at today', () => {
    reset();
    const out = materialiseAiTasks(
      [{ name: 'A', daysBeforeEvent: 999 }], { ...opts, eventDate: '2026-10-01' });
    expect(out[0].dueDate).toBe('2026-09-27');
  });

  it('drops unnamed tasks and defaults an invalid priority', () => {
    reset();
    const out = materialiseAiTasks(
      [{ name: '  ' }, { name: 'Real', priority: 'urgent' }], opts);
    expect(out).toHaveLength(1);
    expect(out[0].priority).toBe('medium');
  });

  it('never invents dependencies', () => {
    reset();
    const out = materialiseAiTasks([{ name: 'A', daysBeforeEvent: 1 }], opts);
    expect(out[0].dependencyIds).toEqual([]);
  });

  it('is empty for missing input', () => {
    expect(materialiseAiTasks(undefined, opts)).toEqual([]);
    expect(materialiseAiTasks([], opts)).toEqual([]);
  });
});
