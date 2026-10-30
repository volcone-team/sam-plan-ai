/**
 * Rebuild existing initiatives' task lists with the new task rules.
 *
 * Phase 4 (client, Oct 2026): workbook sections, answers choosing sections,
 * no merged tabs, one task per name, date order. Tasks already created keep
 * the old lists until rebuilt. RUN THIS ONLY AFTER THE WORKBOOK HAS BEEN
 * RE-UPLOADED with the new code deployed, because it reads the stored task
 * templates (wb_task_templates); before that it would rebuild from the old,
 * merged templates.
 *
 * Safety:
 *   - Only initiatives with a workbook template are touched (no AI calls).
 *   - An initiative with ANY task already started (status other than
 *     not_started) is skipped, so nobody's progress is lost. --force to include.
 *   - Dry run by default: prints old -> new task counts, writes nothing.
 *
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/rebuild-initiative-tasks.mts
 *   ... --apply [--force] [--company <uuid>]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { loadTaskTemplates } from "@/lib/workbook/read";
import { materialiseTasks, type TaskTemplate } from "@/lib/workbook/materialise";
import { answersFromInitiative, extraTemplateKeys, selectTemplates } from "@/lib/workbook/task-rules";
import { taskAnchorDate } from "@/lib/initiatives/schedule";
import { todayDateOnly, toDateOnly } from "@/lib/plan-dates";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");
const companyArg = process.argv.indexOf("--company");
const COMPANY = companyArg > 0 ? process.argv[companyArg + 1] : null;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

let query = db.from("initiatives").select("*").not("library_key", "is", null);
if (COMPANY) query = query.eq("company_id", COMPANY);
const { data: initiatives, error } = await query;
if (error) throw new Error(error.message);

const keys = [...new Set((initiatives ?? []).map((i) => i.library_key as string))];
const answersById = new Map((initiatives ?? []).map((i) => [
  i.id as string,
  answersFromInitiative({ conversionPath: i.conversion_path, format: i.format, categoryId: i.category_id, attrs: i.attrs }),
]));
const extraKeys = [...new Set((initiatives ?? []).flatMap((i) => extraTemplateKeys(i.library_key, answersById.get(i.id)!)))];
const templates = await loadTaskTemplates(db, [...new Set([...keys, ...extraKeys])]);

const floor = toDateOnly(todayDateOnly());
console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"}: ${initiatives?.length ?? 0} library initiatives\n`);
let rebuilt = 0;
let skipped = 0;

for (const i of initiatives ?? []) {
  const own = templates.get(i.library_key) ?? [];
  if (own.length === 0) { skipped++; continue; } // AI / starter lists are left alone

  const { data: current } = await db.from("tasks").select("id, status").eq("initiative_id", i.id);
  const started = (current ?? []).filter((t) => t.status !== "not_started").length;
  if (started > 0 && !FORCE) {
    skipped++;
    console.log(`  skip  ${i.name}: ${started} task(s) already started`);
    continue;
  }

  const answers = answersById.get(i.id)!;
  const extras = new Map<string, TaskTemplate[]>(
    extraTemplateKeys(i.library_key, answers)
      .map((k) => [k, templates.get(k) ?? []] as [string, TaskTemplate[]])
      .filter(([, rows]) => rows.length > 0)
  );
  const tasks = materialiseTasks(selectTemplates({ ownKey: i.library_key, own, extras, answers }), {
    eventDate: taskAnchorDate({ eventDate: i.event_date, activationDate: i.activation_date }),
    cartOpens: answers.cartOpens ?? null,
    floor,
  });
  rebuilt++;
  console.log(`  ${i.name}: ${current?.length ?? 0} -> ${tasks.length} tasks`);

  if (APPLY) {
    const { error: del } = await db.from("tasks").delete().eq("initiative_id", i.id);
    if (del) { console.log(`     FAILED to clear: ${del.message}`); continue; }
    const { error: ins } = await db.from("tasks").insert(
      tasks.map((t) => ({
        id: t.id, initiative_id: i.id, company_id: i.company_id, name: t.name, description: t.description,
        due_date: t.dueDate, estimated_hours: t.estimatedHours, status: "not_started", priority: t.priority,
        display_order: t.displayOrder, dependency_ids: t.dependencyIds,
      }))
    );
    if (ins) console.log(`     FAILED to insert: ${ins.message}`);
  }
}

console.log(`\n${rebuilt} to rebuild, ${skipped} skipped.${APPLY ? "" : " Nothing written (dry run)."}\n`);
