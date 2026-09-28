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

/** The whole selectable library. Small (tens of rows), so no filtering needed. */
export async function loadLibrary(db: SupabaseClient): Promise<LibraryEntry[]> {
  const { data, error } = await db
    .from("wb_initiative_library")
    .select("initiative_key, workbook_id, name, category, difficulty, speed_to_results, one_liner, own_or_ops, price_tier, needs_sales_team")
    .order("display_order", { ascending: true });
  if (error) {
    console.error("[workbook/read] loadLibrary failed:", error.message);
    return [];
  }
  return (data || []).map((r) => ({
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
