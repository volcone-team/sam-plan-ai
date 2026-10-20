/**
 * Validation of AI-written task lists.
 *
 * The workbook has task templates for about 14 of its ~87 library rows. For
 * the rest, Claude is asked to write the project plan once, at build time
 * (see tasks-for-initiatives.ts). This module is the gate between what the
 * model returns and what reaches the customer's plan.
 *
 * THE MODEL PROPOSES, THIS DISPOSES — the same rule the recommendation route
 * already follows. Output is validated, not trusted:
 *   - keys that were not requested are ignored (it cannot add initiatives);
 *   - a task with no name is dropped;
 *   - lead days and durations are clamped to the limits `materialise.ts`
 *     already enforces, so an AI task cannot be dated three years out or
 *     estimated at 46,000 hours;
 *   - dependencies resolve only WITHIN the returned list;
 *   - a list shorter than MIN_AI_TASKS is discarded whole, so the caller
 *     falls back to the starter template instead of saving two vague tasks.
 *
 * Output is `TaskTemplate[]`, not finished tasks, so AI lists go through
 * `materialiseTasks` exactly like authored workbook ones: identical date
 * handling, dependency ids and derived priority.
 *
 * Pure: text in, templates out. No database, no network, no clock.
 */

import { MAX_TASK_HOURS, type TaskTemplate } from "@/lib/workbook/materialise";

/** Fewer than this and the list is not a project plan; fall back to the starter. */
export const MIN_AI_TASKS = 3;
/** More than this is noise on a plan; the extras are dropped. */
export const MAX_AI_TASKS = 20;
/**
 * What the prompt asks for. Inside [MIN_AI_TASKS, MAX_AI_TASKS] by
 * construction, and deliberately at the bottom of the 8-15 range: output
 * tokens are what the call's latency is made of, and a build is a foreground
 * request. Measured against the real library, asking for 8-12 compact tasks
 * costs about 1,000 output tokens per initiative; asking for 8-15 verbose ones
 * cost 1,700 and pushed a three-initiative call past a minute.
 */
export const TARGET_AI_TASKS_MIN = 8;
export const TARGET_AI_TASKS_MAX = 12;
/**
 * A year of runway is already generous for a single initiative. Beyond this
 * the model is guessing, and a task due 2,000 days before the event would
 * floor at today anyway while wrecking the scheduling runway.
 */
export const MAX_AI_LEAD_DAYS = 365;
/** Used when a task's duration is missing or unusable — same default as materialiseAiTasks. */
export const DEFAULT_AI_TASK_HOURS = 2;

/** One task as the model is asked to return it. All fields are untrusted. */
interface RawAiTask {
  name?: unknown;
  description?: unknown;
  daysBeforeEvent?: unknown;
  estimatedHours?: unknown;
  role?: unknown;
  dependsOn?: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * JSON object out of a model response, tolerating a markdown code fence and
 * surrounding chatter. Same two-step the generate-plan route uses.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const attempt = (s: string): Record<string, unknown> | null => {
    try {
      const parsed: unknown = JSON.parse(s);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const direct = attempt(raw.trim());
  if (direct) return direct;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const inner = attempt(fenced[1].trim());
    if (inner) return inner;
  }

  // Last resort: the outermost braces.
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return attempt(raw.slice(start, end + 1));
  return null;
}

/** Lead days: magnitude, whole days, clamped. Garbage becomes `null` (unusable). */
function leadDays(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(Math.abs(Math.trunc(n)), MAX_AI_LEAD_DAYS);
}

/** Hours: clamped to the materialise ceiling; anything unusable gets the default. */
function durationHours(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_AI_TASK_HOURS;
  return Math.min(n, MAX_TASK_HOURS);
}

/** Task numbers this task depends on, as given. Filtered to the list later. */
function rawDependsOn(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && Number.isInteger(n) && n > 0) out.push(n);
  }
  return out;
}

/**
 * One initiative's task list, validated.
 *
 * Returns `null` when the list cannot be used at all (not an array, or fewer
 * than MIN_AI_TASKS survive validation) — the caller then uses the starter
 * template rather than a half-written plan.
 *
 * Task numbers are assigned HERE from the surviving order (1..n) and
 * `dependsOn` is remapped onto them, so dropping a malformed task cannot leave
 * a dependency pointing at the wrong step. A dependency on a task that did not
 * survive, on a later task, or on itself is dropped rather than guessed at:
 * tasks are ordered earliest-first, so a backwards edge is model error.
 */
export function validateAiTaskList(raw: unknown): TaskTemplate[] | null {
  if (!Array.isArray(raw)) return null;

  // Pass 1: keep the usable tasks, remembering the number the model gave each
  // one (its 1-based position in the ORIGINAL list) so dependencies can be
  // remapped after drops.
  const kept: { task: RawAiTask; originalNumber: number }[] = [];
  for (const [i, entry] of raw.entries()) {
    if (!isRecord(entry)) continue;
    if (text(entry.name) === "") continue;
    kept.push({ task: entry as RawAiTask, originalNumber: i + 1 });
    if (kept.length >= MAX_AI_TASKS) break;
  }

  if (kept.length < MIN_AI_TASKS) return null;

  const newNumberByOriginal = new Map<number, number>();
  kept.forEach((k, i) => newNumberByOriginal.set(k.originalNumber, i + 1));

  return kept.map(({ task }, i) => {
    const taskNumber = i + 1;
    const lead = leadDays(task.daysBeforeEvent);
    const role = text(task.role);

    return {
      taskNumber,
      name: text(task.name),
      // Not a model field: the stage is ours, and marks these tasks as
      // AI-written wherever the description is shown.
      category: "AI plan",
      /**
       * A missing lead time is spread across the runway rather than defaulting
       * to a single value: if every unusable lead became 7, half a plan would
       * pile onto one day. Earliest task first, so position 0 gets the longest
       * lead.
       */
      leadDays: lead ?? Math.max(0, (kept.length - i - 1) * 3),
      durationHours: durationHours(task.estimatedHours),
      role: role === "" ? null : role,
      dependsOn: rawDependsOn(task.dependsOn)
        .map((n) => newNumberByOriginal.get(n))
        .filter((n): n is number => n !== undefined && n < taskNumber),
      notes: text(task.description) || null,
      displayOrder: i,
    };
  });
}

/**
 * The whole batched response: `{ "<libraryKey>": [task, ...], ... }`, or
 * `{ "initiatives": { ... } }` / `{ "tasks": { ... } }` if the model wraps it.
 *
 * ONLY REQUESTED KEYS come back. A key we did not ask about is ignored, and a
 * requested key whose list does not validate is simply absent from the result
 * — absent means "use the starter template", which is also what a missing key
 * means. One rule for both, so a partial response needs no special case.
 */
export function parseAiTaskBatch(
  raw: string,
  requestedKeys: readonly string[]
): Map<string, TaskTemplate[]> {
  const out = new Map<string, TaskTemplate[]>();
  const wanted = new Set(requestedKeys);
  if (wanted.size === 0) return out;

  const parsed = parseJsonObject(raw);
  if (!parsed) return out;

  const body = pickBody(parsed, wanted);

  for (const [key, value] of Object.entries(body)) {
    if (!wanted.has(key)) continue;
    const tasks = validateAiTaskList(value);
    if (tasks) out.set(key, tasks);
  }
  return out;
}

/**
 * The object holding the per-key lists. Prefers the top level, and unwraps a
 * single `initiatives` / `tasks` / `plans` wrapper when the model adds one.
 */
function pickBody(
  parsed: Record<string, unknown>,
  wanted: ReadonlySet<string>
): Record<string, unknown> {
  const hasWantedKey = Object.keys(parsed).some((k) => wanted.has(k));
  if (hasWantedKey) return parsed;

  for (const wrapper of ["initiatives", "tasks", "plans"]) {
    const inner = parsed[wrapper];
    if (isRecord(inner)) return inner;
  }
  return parsed;
}
