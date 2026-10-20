/**
 * The single answer to "what tasks does this initiative get?".
 *
 * THE BUG THIS FIXES. Every create path wrote
 * `templates.length > 0 ? materialiseTasks(...) : []` (or the model's own
 * four-task guess, where one happened to be available). The workbook has task
 * templates for about 14 library rows out of ~87, so an initiative like
 * "Past-Buyer Reactivation Campaign" or "Event Sponsorship & Exhibitor Sales"
 * was saved onto a customer's plan with ZERO tasks: scheduled, forecast, and
 * nothing to do.
 *
 * THREE SOURCES, IN STRICT ORDER OF AUTHORITY:
 *
 *   1. `template` — the workbook's authored task list, including the
 *      variant-to-base fallback in `loadTaskTemplates`. The client's authored
 *      knowledge always wins; nothing here can override or "improve" it.
 *   2. `ai` — Claude writes 8-15 tasks for the initiatives the workbook has
 *      nothing for, from the library row, its AI Context and a couple of real
 *      templates as format examples. ONE batched call per build, validated by
 *      `parseAiTaskBatch`.
 *   3. `starter` — the generic six-step template. Used when the AI is not
 *      configured, fails, times out, or returns nothing usable for a key.
 *
 * TWO PROMISES TO CALLERS:
 *
 *   - A BUILD NEVER FAILS BECAUSE OF THIS. Every AI failure mode ends at the
 *     starter template. Nothing here throws; nothing here returns an empty
 *     list for a key that was asked about.
 *   - THESE CALLS DO NOT COUNT AGAINST ai_uses_month. The customer asked for a
 *     plan, not for us to write tasks because the workbook is unfinished.
 *     There is deliberately no `recordUsage` in this file. Token spend IS
 *     logged (generation_events, event type `task_generation`) so the cost is
 *     visible in /admin/ai-usage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  materialiseTasks,
  type MaterialisedTask,
  type TaskTemplate,
} from "@/lib/workbook/materialise";
import {
  parseAiTaskBatch,
  TARGET_AI_TASKS_MAX,
  TARGET_AI_TASKS_MIN,
} from "@/lib/workbook/ai-tasks";
import { starterTemplate, STARTER_RUNWAY_DAYS } from "@/lib/workbook/starter-template";
import {
  loadAiContext,
  loadLibrary,
  loadTaskTemplates,
  type ContextEntry,
  type LibraryEntry,
} from "@/lib/workbook/read";
import { logGenerationEvent } from "@/lib/generation-events";
import { aiFailureLogDetail } from "@/lib/ai-errors";

export type TaskSource = "template" | "ai" | "starter";

/** One initiative to resolve tasks for. */
export interface ResolveTasksItem {
  libraryKey: string;
  /** The event the tasks count back from. */
  eventDate: Date | string;
  /** No task may be due before this (today, in practice). */
  floor: Date | string;
}

export interface ResolvedTasks {
  tasks: MaterialisedTask[];
  source: TaskSource;
}

export interface ResolvedTemplates {
  templates: TaskTemplate[];
  source: TaskSource;
}

export interface ResolveTasksOptions {
  /** Logged with the token spend. Omitted means no logging. */
  companyId?: string | null;
  userId?: string | null;
  /** Injected in tests. Defaults to the batched Claude call below. */
  generate?: TaskGenerator;
  /** Injected in tests, as in materialiseTasks. */
  newId?: () => string;
  /** Label for log lines, e.g. "[intake/build]". */
  logLabel?: string;
}

/* ------------------------------------------------------------------ *
 * The resolver
 * ------------------------------------------------------------------ */

/**
 * Tasks for each requested library key, keyed by that key.
 *
 * ONE ENTRY PER DISTINCT KEY. If the same key is passed twice with different
 * dates, the FIRST item's dates are used — callers that schedule several
 * initiatives from one key should use `resolveTaskTemplates` and materialise
 * per initiative, so each gets its own dates and its own task ids.
 */
export async function resolveTasks(
  db: SupabaseClient,
  items: readonly ResolveTasksItem[],
  options: ResolveTasksOptions = {}
): Promise<Map<string, ResolvedTasks>> {
  const out = new Map<string, ResolvedTasks>();
  const resolved = await resolveTaskTemplates(
    db,
    items.map((i) => i.libraryKey),
    options
  );

  for (const item of items) {
    if (out.has(item.libraryKey)) continue;
    const entry = resolved.get(item.libraryKey);
    if (!entry) continue;
    out.set(item.libraryKey, {
      tasks: materialiseTasks(entry.templates, {
        eventDate: item.eventDate,
        floor: item.floor,
        newId: options.newId,
      }),
      source: entry.source,
    });
  }
  return out;
}

/**
 * The same resolution, stopping at templates.
 *
 * For callers that already materialise per initiative (generate-plan, intake
 * build) because each initiative has its own event date, and because
 * `materialiseTasks` resolves dependencies to the ids IT generated — sharing
 * one materialised list across rows would point every copy's dependencies at
 * the first row's tasks.
 *
 * Every requested key is present in the result, always with at least the
 * starter template.
 */
export async function resolveTaskTemplates(
  db: SupabaseClient,
  keys: readonly string[],
  options: ResolveTasksOptions = {}
): Promise<Map<string, ResolvedTemplates>> {
  const label = options.logLabel ?? "[tasks-for-initiatives]";
  const unique = [...new Set(keys.filter((k) => typeof k === "string" && k !== ""))];
  const out = new Map<string, ResolvedTemplates>();
  if (unique.length === 0) return out;

  // 1. The workbook, which always wins.
  const templatesByKey = await loadTaskTemplates(db, unique);
  for (const key of unique) {
    const templates = templatesByKey.get(key);
    if (templates && templates.length > 0) {
      out.set(key, { templates, source: "template" });
    }
  }

  const untemplated = unique.filter((k) => !out.has(k));
  if (untemplated.length === 0) return out;

  console.log(
    label,
    "no workbook template for",
    untemplated.length,
    "of",
    unique.length,
    "initiatives:",
    untemplated.join(", ")
  );

  // 2. One batched AI call for all of them. Never throws.
  const library = await loadLibraryEntries(db);
  const aiByKey = await generateAiTemplates(db, {
    keys: untemplated,
    library,
    examples: await loadExamples(db, templatesByKey, library, unique),
    options,
  });

  // 3. Whatever the AI did not cover falls back to the starter template.
  for (const key of untemplated) {
    const ai = aiByKey.get(key);
    if (ai && ai.length > 0) {
      out.set(key, { templates: ai, source: "ai" });
    } else {
      out.set(key, {
        templates: starterTemplate(library.get(key)?.name ?? key),
        source: "starter",
      });
    }
  }
  return out;
}

/**
 * The scheduling runway for a key BEFORE its tasks are known.
 *
 * Scheduling happens first: intake build sequences event dates from each
 * initiative's runway, and the AI task list does not exist yet at that point
 * (and may never, if the call fails). So an untemplated initiative is
 * scheduled with the STARTER template's runway — a known, modest 30 days —
 * rather than a guess at what the AI will return.
 *
 * The consequence is stated plainly: if the AI writes a task with a longer
 * lead than that, `materialiseTasks` floors it at today rather than moving the
 * event. The alternative — waiting for the AI before scheduling — would make
 * the whole build's dates depend on a call that is allowed to fail, and would
 * shift every plan's dates when it did.
 */
export function runwayForUntemplated(): number {
  return STARTER_RUNWAY_DAYS;
}

/** The whole library, keyed, including inactive rows. Empty on failure. */
async function loadLibraryEntries(db: SupabaseClient): Promise<Map<string, LibraryEntry>> {
  const out = new Map<string, LibraryEntry>();
  try {
    /**
     * `includeInactive`: an initiative already chosen for a plan still needs
     * its tasks, even if an admin switched the library row off in between.
     * Filtering here would describe it to the model as "unknown key" and lose
     * its name and guidance.
     */
    for (const entry of await loadLibrary(db, { includeInactive: true })) {
      out.set(entry.initiativeKey, entry);
    }
  } catch (err: unknown) {
    console.error(
      "[tasks-for-initiatives] library load failed, falling back to starter tasks:",
      err instanceof Error ? err.message : String(err)
    );
  }
  return out;
}

/**
 * One or two REAL authored templates, used as format examples.
 *
 * Taken from the templates already loaded for this build, so no extra query:
 * the model is shown how the client's own task lists are written (granularity,
 * lead times, roles) instead of being asked to invent a house style.
 */
function pickExamples(templatesByKey: ReadonlyMap<string, TaskTemplate[]>): TaskTemplate[][] {
  const examples: TaskTemplate[][] = [];
  for (const templates of templatesByKey.values()) {
    if (templates.length >= 4) examples.push(templates.slice(0, 12));
    if (examples.length === 2) break;
  }
  return examples;
}

/** How many other library keys to look at when no example is already loaded. */
const EXAMPLE_SEARCH_KEYS = 20;

/**
 * Format examples, from this build where possible.
 *
 * A build that mixes templated and untemplated initiatives already has real
 * templates in hand, so they cost nothing. A build where NOTHING is templated
 * (one hand-added initiative, say) would otherwise send no example at all, so
 * a second lookup goes and finds a couple from elsewhere in the workbook —
 * only in that case, and bounded to a handful of keys.
 */
async function loadExamples(
  db: SupabaseClient,
  templatesByKey: ReadonlyMap<string, TaskTemplate[]>,
  library: ReadonlyMap<string, LibraryEntry>,
  alreadyAsked: readonly string[]
): Promise<TaskTemplate[][]> {
  const fromThisBuild = pickExamples(templatesByKey);
  if (fromThisBuild.length > 0) return fromThisBuild;

  const asked = new Set(alreadyAsked);
  const candidates = [...library.keys()].filter((k) => !asked.has(k)).slice(0, EXAMPLE_SEARCH_KEYS);
  if (candidates.length === 0) return [];

  try {
    return pickExamples(await loadTaskTemplates(db, candidates));
  } catch (err: unknown) {
    console.error(
      "[tasks-for-initiatives] example template load failed:",
      err instanceof Error ? err.message : String(err)
    );
    return [];
  }
}

/* ------------------------------------------------------------------ *
 * The AI call
 * ------------------------------------------------------------------ */

/**
 * HAIKU, NOT THE PLAN-GENERATION MODEL, and measured rather than assumed.
 *
 * Writing task lists is a formatting job, not a reasoning one, and the call
 * sits in the middle of a foreground build. Measured against the real library,
 * three untemplated initiatives took:
 *
 *   claude-sonnet-4-5  94s  (~5,000 output tokens)
 *   claude-haiku-4-5   26s  (~2,900 output tokens)
 *
 * Sonnet is not "better but slower" here — at 94s it never finishes inside any
 * sane request budget, so every initiative would silently get the starter
 * template and the feature would not exist. Haiku's lists were specific and
 * correctly sequenced. It is also ~4x cheaper.
 *
 * Overridable on its own variable: plan generation keeps ANTHROPIC_MODEL, and
 * rotating that must not drag this call back to a model it cannot afford.
 */
const MODEL =
  process.env.ANTHROPIC_TASK_MODEL ||
  process.env.ANTHROPIC_TASK_GENERATION_MODEL ||
  "claude-haiku-4-5-20251001";
/**
 * 30s per call. A build is a foreground request: better a starter template now
 * than a perfect task list after the user has given up. The SDK aborts the
 * request itself, so nothing is left running.
 */
export const AI_TASK_TIMEOUT_MS = 30_000;
/**
 * Initiatives per call.
 *
 * ONE ROUND TRIP, BUT NOT ONE REQUEST, and the difference is latency: a call's
 * duration is driven by how many output tokens it has to produce, so a single
 * call for ten initiatives would take three times as long as one for three and
 * blow the timeout — leaving ALL ten on the starter template. The chunks are
 * issued together and awaited together, so wall-clock time stays at roughly
 * one call however many initiatives a build has, and a chunk that fails costs
 * only its own three initiatives rather than the whole set.
 */
export const AI_TASK_CHUNK_SIZE = 3;
/** ~12 compact tasks x AI_TASK_CHUNK_SIZE initiatives of JSON, with headroom. */
const MAX_OUTPUT_TOKENS = 5000;

/** What the batched call returns. Injectable so tests never touch the network. */
export interface TaskGeneratorResult {
  /** Raw model text, parsed and validated by the caller. */
  text: string | null;
  model?: string | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  durationMs?: number | null;
  error?: string | null;
}

export type TaskGenerator = (args: {
  keys: readonly string[];
  library: ReadonlyMap<string, LibraryEntry>;
  context: ReadonlyMap<string, ContextEntry>;
  examples: readonly TaskTemplate[][];
}) => Promise<TaskGeneratorResult>;

/**
 * Validated AI templates per key. Absent key = use the starter template.
 * Swallows every failure: an AI problem must never fail a build.
 */
async function generateAiTemplates(
  db: SupabaseClient,
  args: {
    keys: readonly string[];
    library: ReadonlyMap<string, LibraryEntry>;
    examples: readonly TaskTemplate[][];
    options: ResolveTasksOptions;
  }
): Promise<Map<string, TaskTemplate[]>> {
  const { keys, library, examples, options } = args;
  const generate = options.generate ?? callClaudeForTasks;
  const label = options.logLabel ?? "[tasks-for-initiatives]";
  const context = await loadContextByKey(db);

  // Issued together, awaited together: see AI_TASK_CHUNK_SIZE.
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += AI_TASK_CHUNK_SIZE) {
    chunks.push(keys.slice(i, i + AI_TASK_CHUNK_SIZE));
  }

  const results = await Promise.all(
    chunks.map(async (chunk): Promise<TaskGeneratorResult> => {
      try {
        return await generate({ keys: chunk, library, context, examples });
      } catch (err: unknown) {
        // A generator is not supposed to throw, but a build must survive it doing so.
        console.error(label, "task generation threw:", aiFailureLogDetail(err));
        return { text: null, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );

  const parsed = new Map<string, TaskTemplate[]>();
  for (const [i, result] of results.entries()) {
    if (!result.text) continue;
    // Each chunk may only answer for the keys IT was asked about.
    for (const [key, templates] of parseAiTaskBatch(result.text, chunks[i])) {
      parsed.set(key, templates);
    }
  }

  const result = mergeResults(results);

  if (options.companyId) {
    /**
     * Token spend only — see the file header. recordUsage is deliberately NOT
     * called here. logGenerationEvent never throws.
     */
    await logGenerationEvent(
      {
        companyId: options.companyId,
        userId: options.userId ?? null,
        eventType: "task_generation",
        status: parsed.size > 0 ? "success" : "failed",
        initiativesCreated: parsed.size,
        durationMs: result.durationMs ?? null,
        model: result.model ?? MODEL,
        tokensInput: result.tokensInput ?? null,
        tokensOutput: result.tokensOutput ?? null,
        errorMessage: result.error ?? (parsed.size === 0 ? "No usable task lists returned" : null),
      },
      db
    );
  }

  const missing = keys.filter((k) => !parsed.has(k));
  if (missing.length > 0) {
    console.warn(
      label,
      "falling back to the starter template for",
      missing.length,
      "of",
      keys.length,
      "initiatives:",
      missing.join(", "),
      result.error ? `(${result.error})` : ""
    );
  }
  return parsed;
}

/**
 * The chunks' results as one, for logging: tokens summed, duration taken as
 * the longest (they ran concurrently, so that is the wall-clock cost), and the
 * first error kept as the reason.
 */
function mergeResults(results: readonly TaskGeneratorResult[]): TaskGeneratorResult {
  const sum = (pick: (r: TaskGeneratorResult) => number | null | undefined): number | null => {
    let total: number | null = null;
    for (const r of results) {
      const v = pick(r);
      if (typeof v === "number" && Number.isFinite(v)) total = (total ?? 0) + v;
    }
    return total;
  };

  return {
    text: null, // already parsed per chunk
    model: results.find((r) => r.model)?.model ?? null,
    tokensInput: sum((r) => r.tokensInput),
    tokensOutput: sum((r) => r.tokensOutput),
    durationMs: results.reduce((max, r) => Math.max(max, r.durationMs ?? 0), 0) || null,
    error: results.find((r) => r.error)?.error ?? null,
  };
}

/** AI Context by key. Sparse in the workbook — most rows are unauthored. */
async function loadContextByKey(db: SupabaseClient): Promise<Map<string, ContextEntry>> {
  try {
    return new Map((await loadAiContext(db)).map((c) => [c.initiativeKey, c]));
  } catch (err: unknown) {
    console.error(
      "[tasks-for-initiatives] AI context load failed:",
      err instanceof Error ? err.message : String(err)
    );
    return new Map();
  }
}

const SYSTEM_PROMPT =
  "You write the project plan for a sales or marketing initiative: the concrete " +
  "tasks it takes to run it, and how many days before the event each one must happen.\n\n" +
  "Return ONLY a JSON object, no preamble and no code fence, mapping each " +
  "initiative key given to its task list:\n" +
  '{"<initiative_key>":[{"name":"string","description":"string",' +
  '"daysBeforeEvent":number,"estimatedHours":number,"role":"string",' +
  '"dependsOn":[number]}]}\n\n' +
  "Rules:\n" +
  "- Use ONLY the keys given, every one of them, exactly once. Never invent a key.\n" +
  `- ${TARGET_AI_TASKS_MIN}-${TARGET_AI_TASKS_MAX} tasks per initiative. Fewer is not a plan; more is noise.\n` +
  "- `daysBeforeEvent` is a COUNT OF DAYS BEFORE the event and must be positive " +
  "(0 for work done on the day). Order each list from the LARGEST " +
  "daysBeforeEvent to the smallest.\n" +
  "- `dependsOn` lists the 1-based POSITIONS in this same list that must finish " +
  "first. Reference earlier positions only, and leave it empty for the first task.\n" +
  "- `estimatedHours` is realistic hands-on time for one person, typically 1-8.\n" +
  "- `role` is who does it, e.g. Owner, Marketing, Sales, Designer.\n" +
  "- `name` is an instruction a business owner can act on, specific to THIS " +
  "initiative, not a generic phase label. Under 10 words.\n" +
  "- `description` is one sentence on what doing it well looks like. Under 15 words.\n" +
  "- Be COMPACT. No extra fields, no commentary, no code fence.\n" +
  "- Cover the whole arc: decide and set the target, prepare the offer, build the " +
  "assets, promote, run it, then follow up and record results.\n" +
  "- Respect the initiative's NEEDS and AVOID guidance where it is given.\n" +
  "- Never quote a number that is not in the data given.";

/** The real batched call. Returns `text: null` on any failure; never throws. */
export const callClaudeForTasks: TaskGenerator = async ({
  keys,
  library,
  context,
  examples,
}) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Not an error worth alarming about: the starter template covers it.
    return { text: null, error: "ANTHROPIC_API_KEY not set" };
  }

  const started = Date.now();
  try {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT + renderExamples(examples),
        messages: [
          { role: "user", content: renderRequest(keys, library, context) },
        ],
      },
      {
        // The SDK aborts the request itself at this point.
        timeout: AI_TASK_TIMEOUT_MS,
        // One retry at most: this is in the path of a foreground build.
        maxRetries: 1,
      }
    );

    const durationMs = Date.now() - started;
    const block = response.content.find((b) => b.type === "text");
    const text = block && block.type === "text" ? block.text : null;

    if (response.stop_reason === "max_tokens") {
      // The JSON is likely truncated; parseAiTaskBatch keeps whatever survives.
      console.warn("[tasks-for-initiatives] output hit the token cap - JSON may be truncated");
    }

    return {
      text,
      model: MODEL,
      tokensInput: response.usage?.input_tokens ?? null,
      tokensOutput: response.usage?.output_tokens ?? null,
      durationMs,
      error: text ? null : "The AI returned nothing usable.",
    };
  } catch (err: unknown) {
    console.error("[tasks-for-initiatives] Claude call failed:", aiFailureLogDetail(err));
    return {
      text: null,
      model: MODEL,
      durationMs: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/** One line per initiative: what it is, plus its authored guidance. */
export function renderRequest(
  keys: readonly string[],
  library: ReadonlyMap<string, LibraryEntry>,
  context: ReadonlyMap<string, ContextEntry>
): string {
  const trim = (v: string | null | undefined, max: number): string | null =>
    v ? v.replace(/\s+/g, " ").slice(0, max) : null;

  const blocks = keys.map((key) => {
    const l = library.get(key);
    const c = context.get(key);
    const bits = [
      `key=${key}`,
      l?.name ?? key,
      l?.category ? `category ${l.category}` : null,
      l?.ownOrOps ? `type ${l.ownOrOps}` : null,
      l?.difficulty ? `difficulty ${l.difficulty}/5` : null,
      l?.speedToResults ? `speed ${l.speedToResults}` : null,
      l?.speedScore !== null && l?.speedScore !== undefined
        ? `SCORE speed ${l.speedScore}/5, cost ${l.costScore ?? "?"}/5, odds ` +
          `${l.oddsScore ?? "?"}/5, revenue ${l.revenueScore ?? "?"}/5, ease ${l.easeScore ?? "?"}/5`
        : null,
      trim(l?.oneLiner, 240),
      trim(l?.metricsRaw, 200) ? `TRACKS: ${trim(l?.metricsRaw, 200)}` : null,
      trim(c?.whenToUse, 300) ? `WHEN: ${trim(c?.whenToUse, 300)}` : null,
      trim(c?.whyItWorks, 240) ? `WHY: ${trim(c?.whyItWorks, 240)}` : null,
      trim(c?.minAssets, 200) ? `NEEDS: ${trim(c?.minAssets, 200)}` : null,
      trim(c?.whatToAvoid, 200) ? `AVOID: ${trim(c?.whatToAvoid, 200)}` : null,
      trim(c?.sequencingNotes, 200) ? `SEQUENCE: ${trim(c?.sequencingNotes, 200)}` : null,
    ].filter(Boolean);
    return `- ${bits.join(" | ")}`;
  });

  return (
    `Write the task list for each of these ${keys.length} initiative` +
    `${keys.length === 1 ? "" : "s"}. Return one entry per key.\n\n${blocks.join("\n")}`
  );
}

/** Real authored templates, shown as the house format. */
function renderExamples(examples: readonly TaskTemplate[][]): string {
  if (examples.length === 0) return "";
  const render = (templates: readonly TaskTemplate[]): string =>
    templates
      .map(
        (t) =>
          `  - ${t.name} | ${t.leadDays} days before | ` +
          `${t.durationHours ?? "?"}h | ${t.role ?? "unassigned"}` +
          (t.dependsOn.length > 0 ? ` | after ${t.dependsOn.join(", ")}` : "")
      )
      .join("\n");

  return (
    "\n\nEXAMPLES of task lists authored by hand for other initiatives. Match " +
    "their granularity, lead times and tone. Do NOT copy their content:\n" +
    examples.map((e, i) => `Example ${i + 1}:\n${render(e)}`).join("\n\n")
  );
}
