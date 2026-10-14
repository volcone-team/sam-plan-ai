import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskTemplate } from "@/lib/workbook/materialise";

/**
 * Reads of the workbook tables (migration 018) for plan generation.
 *
 * Generation used to receive the first 3 sheets x 8 rows of the raw workbook as
 * prompt text, which meant every task template was discarded. These helpers let
 * it look up exactly the initiatives it needs instead.
 */

export interface LibraryEntry {
  initiativeKey: string;
  workbookId: string | null;
  name: string;
  category: string | null;
  difficulty: number | null;     // workbook scale: 1-5
  speedToResults: string | null;
  oneLiner: string | null;
  ownOrOps: string | null;
  priceTier: string | null;
  needsSalesTeam: string | null;
}

export interface BenchmarkEntry {
  initiativeKey: string; metric: string;
  conservative: number | null; moderate: number | null; aggressive: number | null;
  unit: string | null; isPlaceholder: boolean; ruleOfThumb: string | null;
}

export interface ContextEntry {
  initiativeKey: string; whenToUse: string | null; bestFit: string | null;
  minBudget: string | null; minAssets: string | null; whyItWorks: string | null;
  whatToAvoid: string | null; sequencingNotes: string | null;
}

/**
 * Which initiative keys the AI is allowed to reference.
 *
 * Reads `initiative_settings` (migration 034), which lives OUTSIDE the wb_*
 * tables because those are deleted and rebuilt by every workbook upload.
 *
 * ABSENT MEANS ACTIVE, in two different situations and for the same reason — an
 * initiative should never vanish from the product because a bookkeeping row is
 * missing:
 *
 *   - no settings row for a key: a freshly uploaded workbook is usable before
 *     anyone visits the admin screen;
 *   - the table cannot be read at all (not yet migrated, or a transient
 *     failure): `null` is returned and the caller falls back to the FULL
 *     library rather than an empty one.
 *
 * That second case is deliberate and worth stating plainly: failing open gives
 * the AI too MANY initiatives, failing closed gives it none — and none means
 * recommendations, plan generation, Enhance and the chatbot all silently stop
 * working. A slightly-too-wide library is a far cheaper failure.
 *
 * RETURNS THE DISABLED SET, NOT THE ALLOWED ONE. That inversion is what makes
 * "absent means active" actually work: filtering by an allow-list would drop
 * every initiative that has no settings row yet, which is precisely the
 * newly-uploaded case this is supposed to protect.
 */
export async function loadInactiveInitiativeKeys(
  db: SupabaseClient
): Promise<Set<string> | null> {
  const { data, error } = await db
    .from("initiative_settings")
    .select("initiative_key, is_active");

  if (error) {
    console.error(
      "[workbook/read] loadInactiveInitiativeKeys failed, falling back to the full library:",
      error.message
    );
    return null;
  }

  return new Set(
    (data || [])
      // Explicitly disabled only. A missing row, or is_active null, is active.
      .filter((r) => r.is_active === false)
      .map((r) => r.initiative_key as string)
  );
}

/**
 * The selectable library. Small (tens of rows), so no pagination needed.
 *
 * FILTERED TO THE ACTIVE SET BY DEFAULT, and this is the single chokepoint that
 * makes the admin toggles real: recommendations, the intake picker, plan
 * generation, Enhance and the chatbot all call this function, so narrowing it
 * here narrows all five at once.
 *
 * `includeInactive` is for the admin screen, which has to show the whole
 * library in order to offer a toggle for each row.
 */
export async function loadLibrary(
  db: SupabaseClient,
  opts?: { includeInactive?: boolean }
): Promise<LibraryEntry[]> {
  const { data, error } = await db
    .from("wb_initiative_library")
    .select("initiative_key, workbook_id, name, category, difficulty, speed_to_results, one_liner, own_or_ops, price_tier, needs_sales_team")
    .order("display_order", { ascending: true });
  if (error) {
    console.error("[workbook/read] loadLibrary failed:", error.message);
    return [];
  }

  let rows = data || [];

  if (!opts?.includeInactive) {
    const inactive = await loadInactiveInitiativeKeys(db);
    // null means "could not determine" — keep everything rather than starve
    // the AI of its whole vocabulary.
    if (inactive && inactive.size > 0) {
      const before = rows.length;
      rows = rows.filter((r) => !inactive.has(r.initiative_key as string));

      if (rows.length === 0 && before > 0) {
        /**
         * Everything is switched off. Honoured rather than overridden — an
         * admin may genuinely have disabled the lot — but logged loudly,
         * because the symptom downstream is "the AI recommends nothing" with
         * no other clue as to why.
         */
        console.warn(
          `[workbook/read] Every one of the ${before} library initiatives is ` +
          "inactive. The AI has nothing to recommend. Check /admin/ai-workbook."
        );
      }
    }
  }

  return rows.map((r) => ({
    initiativeKey: r.initiative_key as string,
    workbookId: (r.workbook_id as string) ?? null,
    name: r.name as string,
    category: (r.category as string) ?? null,
    difficulty: (r.difficulty as number) ?? null,
    speedToResults: (r.speed_to_results as string) ?? null,
    oneLiner: (r.one_liner as string) ?? null,
    ownOrOps: (r.own_or_ops as string) ?? null,
    priceTier: (r.price_tier as string) ?? null,
    needsSalesTeam: (r.needs_sales_team as string) ?? null,
  }));
}

/** Task templates for the given initiatives, grouped by key and ordered. */
export async function loadTaskTemplates(
  db: SupabaseClient,
  keys: string[]
): Promise<Map<string, TaskTemplate[]>> {
  const out = new Map<string, TaskTemplate[]>();
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return out;

  const { data, error } = await db
    .from("wb_task_templates")
    .select("initiative_key, task_number, name, category, lead_days, duration_hours, role, depends_on, notes, display_order")
    .in("initiative_key", unique)
    .order("display_order", { ascending: true });
  if (error) {
    console.error("[workbook/read] loadTaskTemplates failed:", error.message);
    return out;
  }
  for (const r of data || []) {
    const key = r.initiative_key as string;
    const list = out.get(key) || [];
    list.push({
      taskNumber: (r.task_number as number) ?? null,
      name: r.name as string,
      category: (r.category as string) ?? null,
      leadDays: Number(r.lead_days) || 0,
      durationHours: r.duration_hours === null ? null : Number(r.duration_hours),
      role: (r.role as string) ?? null,
      dependsOn: (r.depends_on as number[]) || [],
      notes: (r.notes as string) ?? null,
      displayOrder: Number(r.display_order) || 0,
    });
    out.set(key, list);
  }
  return out;
}

export async function loadBenchmarks(
  db: SupabaseClient,
  keys: string[]
): Promise<Map<string, BenchmarkEntry[]>> {
  const out = new Map<string, BenchmarkEntry[]>();
  const unique = [...new Set(keys.filter(Boolean))];
  if (unique.length === 0) return out;

  const { data, error } = await db
    .from("wb_benchmarks")
    .select("initiative_key, metric, conservative, moderate, aggressive, unit, is_placeholder, rule_of_thumb")
    .in("initiative_key", unique);
  if (error) {
    console.error("[workbook/read] loadBenchmarks failed:", error.message);
    return out;
  }
  for (const r of data || []) {
    const key = r.initiative_key as string;
    const list = out.get(key) || [];
    list.push({
      initiativeKey: key,
      metric: r.metric as string,
      conservative: r.conservative === null ? null : Number(r.conservative),
      moderate: r.moderate === null ? null : Number(r.moderate),
      aggressive: r.aggressive === null ? null : Number(r.aggressive),
      unit: (r.unit as string) ?? null,
      isPlaceholder: !!r.is_placeholder,
      ruleOfThumb: (r.rule_of_thumb as string) ?? null,
    });
    out.set(key, list);
  }
  return out;
}

/** Selection guidance. Currently sparse in the workbook - only some rows are authored. */
export async function loadAiContext(db: SupabaseClient): Promise<ContextEntry[]> {
  const { data, error } = await db
    .from("wb_ai_context")
    .select("initiative_key, when_to_use, best_fit, min_budget, min_assets, why_it_works, what_to_avoid, sequencing_notes");
  if (error) {
    console.error("[workbook/read] loadAiContext failed:", error.message);
    return [];
  }
  return (data || []).map((r) => ({
    initiativeKey: r.initiative_key as string,
    whenToUse: (r.when_to_use as string) ?? null,
    bestFit: (r.best_fit as string) ?? null,
    minBudget: (r.min_budget as string) ?? null,
    minAssets: (r.min_assets as string) ?? null,
    whyItWorks: (r.why_it_works as string) ?? null,
    whatToAvoid: (r.what_to_avoid as string) ?? null,
    sequencingNotes: (r.sequencing_notes as string) ?? null,
  }));
}

/**
 * The library rendered for the prompt: compact enough to send in full, so the
 * model SELECTS from your catalogue instead of inventing channels. Guidance from
 * AI Context is attached where it has been authored.
 */
export function renderLibraryForPrompt(
  library: LibraryEntry[],
  context: ContextEntry[]
): string {
  const ctxByKey = new Map(context.map((c) => [c.initiativeKey, c]));
  const lines = library.map((l) => {
    const c = ctxByKey.get(l.initiativeKey);
    const bits = [
      `key=${l.initiativeKey}`,
      l.name,
      l.difficulty ? `difficulty ${l.difficulty}/5` : null,
      l.speedToResults ? `speed ${l.speedToResults}` : null,
      l.priceTier ? `price tier ${l.priceTier}` : null,
      l.ownOrOps ? `type ${l.ownOrOps}` : null,
      l.oneLiner,
      c?.whenToUse ? `WHEN: ${c.whenToUse.replace(/\s+/g, " ").slice(0, 240)}` : null,
      c?.minAssets ? `NEEDS: ${c.minAssets.replace(/\s+/g, " ").slice(0, 120)}` : null,
      c?.whatToAvoid ? `AVOID: ${c.whatToAvoid.replace(/\s+/g, " ").slice(0, 120)}` : null,
    ].filter(Boolean);
    return `- ${bits.join(" | ")}`;
  });
  return lines.join("\n");
}
