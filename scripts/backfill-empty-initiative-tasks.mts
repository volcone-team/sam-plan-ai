/**
 * Find (and optionally fix) initiatives that were saved with NO tasks.
 *
 * Every create path now resolves a task list three ways — workbook template,
 * AI-written, generic starter (src/lib/workbook/tasks-for-initiatives.ts) —
 * but that only helps initiatives created from now on. Anything already on a
 * customer's plan whose library key had no workbook task template still has an
 * empty task list. This finds those and can fill them.
 *
 * CANDIDATES: an initiative with ZERO rows in `tasks` AND a resolvable library
 * key — either `initiatives.library_key`, or the initiative type's `channel`
 * matching a library key (the stable match used by
 * src/lib/workbook/initiative-type.ts). An initiative with no library key at
 * all is a custom one; its tasks are the user's business, so it is counted and
 * left alone.
 *
 * DRY RUN BY DEFAULT: prints what it would do, writes nothing, and makes no AI
 * call.
 *
 *   --apply   write the tasks. Each initiative is re-checked immediately
 *             before the insert and skipped if it has acquired any tasks since
 *             the scan, so the script is idempotent and can never double up.
 *   --ai      let Claude write the task list for initiatives the workbook has
 *             no template for, instead of using the generic starter template.
 *             Costs tokens. Only has an effect together with --apply.
 *
 * Prints ids (first 8 chars), initiative names and library keys only. Never
 * emails or secrets.
 *
 * Usage:
 *   node_modules/.bin/vite-node -c vitest.config.ts scripts/backfill-empty-initiative-tasks.mts
 *   node_modules/.bin/vite-node -c vitest.config.ts scripts/backfill-empty-initiative-tasks.mts --apply
 *   node_modules/.bin/vite-node -c vitest.config.ts scripts/backfill-empty-initiative-tasks.mts --apply --ai
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { loadLibrary, loadTaskTemplates } from "@/lib/workbook/read";
import { materialiseTasks, templateRunwayDays } from "@/lib/workbook/materialise";
import { starterTemplate, STARTER_TASK_COUNT } from "@/lib/workbook/starter-template";
import {
  resolveTaskTemplates,
  type ResolvedTemplates,
} from "@/lib/workbook/tasks-for-initiatives";
import { todayDateOnly, toDateOnly } from "@/lib/plan-dates";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
const db = createClient(url, key);
const APPLY = process.argv.includes("--apply");
const USE_AI = process.argv.includes("--ai");

interface InitiativeRow {
  id: string;
  name: string | null;
  company_id: string | null;
  initiative_type_id: string | null;
  library_key: string | null;
  activation_date: string | null;
  event_date: string | null;
}

async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < page) return out;
  }
}

const short = (id: string | null) => (id ?? "").slice(0, 8);
const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

// Inactive library rows included: an initiative already on a plan still needs
// its tasks even if an admin has since switched the library row off.
const library = await loadLibrary(db, { includeInactive: true });
const byKey = new Map(library.map((e) => [e.initiativeKey, e]));

const [initiatives, types, taskRows] = await Promise.all([
  fetchAll<InitiativeRow>(
    "initiatives",
    "id, name, company_id, initiative_type_id, library_key, activation_date, event_date"
  ),
  fetchAll<{ id: string; channel: string | null }>("initiative_types", "id, channel"),
  fetchAll<{ initiative_id: string | null }>("tasks", "initiative_id"),
]);

const channelOf = new Map(types.map((t) => [t.id, t.channel]));
const taskCount = new Map<string, number>();
for (const t of taskRows) {
  if (!t.initiative_id) continue;
  taskCount.set(t.initiative_id, (taskCount.get(t.initiative_id) ?? 0) + 1);
}

/** Workbook templates for every library key an empty initiative resolves to. */
interface Candidate {
  row: InitiativeRow;
  libraryKey: string;
  via: "library_key" | "channel";
  /** The date tasks count back from: the event, or activation when there is none. */
  anchor: string;
}

const candidates: Candidate[] = [];
let custom = 0;
let unknownLibraryKey = 0;

for (const row of initiatives) {
  if ((taskCount.get(row.id) ?? 0) > 0) continue;

  let libraryKey: string | null = null;
  let via: Candidate["via"] = "library_key";
  if (row.library_key) {
    if (byKey.has(row.library_key)) libraryKey = row.library_key;
    else unknownLibraryKey++;
  }
  if (!libraryKey) {
    const ch = row.initiative_type_id ? channelOf.get(row.initiative_type_id) : null;
    if (ch && byKey.has(ch)) {
      libraryKey = ch;
      via = "channel";
    }
  }
  if (!libraryKey) {
    custom++;
    continue;
  }

  // No date at all: anchor on today, so the whole list lands on the floor
  // rather than being skipped.
  const anchor = row.event_date || row.activation_date || toDateOnly(todayDateOnly());
  candidates.push({ row, libraryKey, via, anchor });
}

const keys = [...new Set(candidates.map((c) => c.libraryKey))];
const templatesByKey = await loadTaskTemplates(db, keys);

const empties = initiatives.filter((i) => (taskCount.get(i.id) ?? 0) === 0);

console.log(`\nBackfill empty initiative task lists — ${APPLY ? "APPLY" : "DRY RUN (no writes)"}`);
console.log(`Untemplated initiatives would get: ${USE_AI ? "AI-written tasks, else the starter template" : "the generic starter template"}`);
if (USE_AI && !APPLY) console.log("(--ai has no effect in a dry run: no AI call is made)");
console.log("");
console.log(`Initiatives: ${initiatives.length}`);
console.log(`With no tasks at all: ${empties.length}`);
console.log(`  of those, custom / unmatchable (left alone): ${custom}`);
console.log(`  of those, fixable here: ${candidates.length}`);
console.log(`Library rows: ${library.length} | distinct keys among the empties: ${keys.length}`);
console.log(`Workbook templates available for: ${[...templatesByKey.keys()].length} of those keys\n`);

if (candidates.length > 0) {
  console.log(
    `${pad("initiative", 10)} ${pad("name", 34)} ${pad("company", 10)} ` +
    `${pad("library key", 28)} ${pad("via", 11)} ${pad("anchor", 11)} would add`
  );
  for (const c of candidates) {
    const templates = templatesByKey.get(c.libraryKey) ?? [];
    const plan = templates.length > 0
      ? `${templates.length} workbook tasks (runway ${templateRunwayDays(templates)}d)`
      : USE_AI
        ? `AI tasks, else ${STARTER_TASK_COUNT} starter tasks`
        : `${STARTER_TASK_COUNT} starter tasks`;
    console.log(
      `${pad(short(c.row.id), 10)} ${pad(c.row.name ?? "", 34)} ${pad(short(c.row.company_id), 10)} ` +
      `${pad(c.libraryKey, 28)} ${pad(c.via, 11)} ${pad(c.anchor, 11)} ${plan}`
    );
  }
}

const templated = candidates.filter((c) => (templatesByKey.get(c.libraryKey) ?? []).length > 0);
console.log(`\nWould get workbook tasks: ${templated.length}`);
console.log(`Would get ${USE_AI ? "AI or starter" : "starter"} tasks: ${candidates.length - templated.length}`);
if (unknownLibraryKey > 0) console.log(`library_key not found in the library: ${unknownLibraryKey}`);

/** Distinct keys by how many empty initiatives use them — where the damage is. */
const byKeyCount = new Map<string, number>();
for (const c of candidates) byKeyCount.set(c.libraryKey, (byKeyCount.get(c.libraryKey) ?? 0) + 1);
if (byKeyCount.size > 0) {
  console.log("\nBy library key:");
  for (const [k, n] of [...byKeyCount.entries()].sort((a, b) => b[1] - a[1])) {
    const has = (templatesByKey.get(k) ?? []).length;
    console.log(`  ${pad(k, 30)} ${String(n).padStart(4)} initiative(s)  ${has > 0 ? `${has} workbook tasks` : "no template"}`);
  }
}

if (!APPLY) {
  console.log("\nDry run: nothing written, no AI call made. Re-run with --apply to write.\n");
  process.exit(0);
}

/* ---- Writes ---- */

const floor = todayDateOnly();

/**
 * Resolved templates per key. With --ai this is the same helper every create
 * path uses (workbook template, else AI, else starter); without it, the
 * workbook template or the starter, with no AI call.
 */
const resolved: Map<string, ResolvedTemplates> = USE_AI
  ? await resolveTaskTemplates(db, keys, { logLabel: "[backfill]" })
  : new Map(
      keys.map((k): [string, ResolvedTemplates] => {
        const templates = templatesByKey.get(k) ?? [];
        return templates.length > 0
          ? [k, { templates, source: "template" }]
          : [k, { templates: starterTemplate(byKey.get(k)?.name ?? k), source: "starter" }];
      })
    );

let written = 0;
let skipped = 0;
let failed = 0;

for (const c of candidates) {
  const entry = resolved.get(c.libraryKey);
  if (!entry || entry.templates.length === 0) {
    console.error(`  ${short(c.row.id)} no tasks resolved for ${c.libraryKey}`);
    failed++;
    continue;
  }

  // Re-checked immediately before the insert: only still-empty initiatives are
  // written, so a re-run (or a plan edited since the scan) cannot double up.
  const { count, error: countError } = await db
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("initiative_id", c.row.id);
  if (countError) {
    console.error(`  ${short(c.row.id)} count failed: ${countError.message}`);
    failed++;
    continue;
  }
  if ((count ?? 0) > 0) {
    skipped++;
    continue;
  }

  const tasks = materialiseTasks(entry.templates, { eventDate: c.anchor, floor });
  const { error } = await db.from("tasks").insert(
    tasks.map((t) => ({
      id: t.id,
      initiative_id: c.row.id,
      company_id: c.row.company_id,
      name: t.name,
      description: t.description,
      due_date: t.dueDate,
      estimated_hours: t.estimatedHours,
      status: "not_started",
      priority: t.priority,
      display_order: t.displayOrder,
      dependency_ids: t.dependencyIds,
    }))
  );
  if (error) {
    console.error(`  ${short(c.row.id)} insert failed: ${error.message}`);
    failed++;
    continue;
  }
  console.log(`  ${short(c.row.id)} +${tasks.length} ${entry.source} tasks`);
  written++;
}

console.log(`\nWritten: ${written}. Skipped (tasks appeared since the scan): ${skipped}. Failed: ${failed}.\n`);
