import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseWorkbook, type RawSheet, type ParsedWorkbook } from "@/lib/workbook/parse";

/**
 * Workbook ingest: parse the uploaded sheets into the wb_* tables that
 * generation reads (migration 018).
 *
 * These tables are DERIVED. Every upload replaces them wholesale, so there is
 * no merge logic and no drift: `workbook_data` stays the raw source of truth and
 * the wb_* tables are a queryable projection of it.
 *
 * Writes go through the SERVICE ROLE, because the tables are read-only to
 * users. Ingest never throws: a parse or write failure must not lose the upload
 * itself, which has already been stored. Failures are returned to the caller so
 * the admin UI can surface them.
 */

export interface IngestResult {
  ok: boolean;
  counts: { library: number; benchmarks: number; taskTemplates: number; aiContext: number };
  /** Data-quality notes from the parser: unmatched names, empty guidance, duplicates. */
  warnings: string[];
  /** Populated only when ingest could not complete. */
  error?: string;
}

const EMPTY = { library: 0, benchmarks: 0, taskTemplates: 0, aiContext: 0 };

export async function ingestWorkbook(
  sheets: RawSheet[],
  db?: SupabaseClient
): Promise<IngestResult> {
  let parsed: ParsedWorkbook;
  try {
    parsed = parseWorkbook(sheets || []);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[workbook/ingest] parse failed:", message);
    return { ok: false, counts: EMPTY, warnings: [], error: `Parse failed: ${message}` };
  }

  const client =
    db ??
    createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

  const counts = {
    library: parsed.library.length,
    benchmarks: parsed.benchmarks.length,
    taskTemplates: parsed.taskTemplates.length,
    aiContext: parsed.aiContext.length,
  };

  try {
    // Replace wholesale. Order doesn't matter: there are no FKs between these
    // tables, they join on initiative_key by convention so a partially-filled
    // workbook still ingests.
    for (const table of ["wb_task_templates", "wb_benchmarks", "wb_ai_context", "wb_initiative_library"]) {
      const { error } = await client.from(table).delete().neq("initiative_key", "\u0000");
      if (error) throw new Error(`clearing ${table}: ${error.message}`);
    }

    const inserts: Array<[string, Record<string, unknown>[]]> = [
      ["wb_initiative_library", parsed.library.map((r) => ({
        initiative_key: r.initiativeKey, workbook_id: r.workbookId, name: r.name,
        category: r.category, difficulty: r.difficulty, speed_to_results: r.speedToResults,
        one_liner: r.oneLiner, description: r.description, needs_sales_team: r.needsSalesTeam,
        price_tier: r.priceTier, own_or_ops: r.ownOrOps, display_order: r.displayOrder,
      }))],
      ["wb_benchmarks", parsed.benchmarks.map((r) => ({
        initiative_key: r.initiativeKey, metric: r.metric, conservative: r.conservative,
        moderate: r.moderate, aggressive: r.aggressive, unit: r.unit, source: r.source,
        is_placeholder: r.isPlaceholder, rule_of_thumb: r.ruleOfThumb,
      }))],
      ["wb_task_templates", parsed.taskTemplates.map((r) => ({
        initiative_key: r.initiativeKey, task_number: r.taskNumber, name: r.name,
        category: r.category, lead_days: r.leadDays, duration_hours: r.durationHours,
        role: r.role, depends_on: r.dependsOn, notes: r.notes, display_order: r.displayOrder,
      }))],
      ["wb_ai_context", parsed.aiContext.map((r) => ({
        initiative_key: r.initiativeKey, when_to_use: r.whenToUse, best_fit: r.bestFit,
        min_budget: r.minBudget, min_assets: r.minAssets, why_it_works: r.whyItWorks,
        what_to_avoid: r.whatToAvoid, sequencing_notes: r.sequencingNotes,
      }))],
    ];

    // Chunked: 655 task templates in one request is large enough to be worth
    // splitting, and a single oversized insert is the kind of thing that fails
    // only in production.
    const CHUNK = 200;
    for (const [table, rows] of inserts) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await client.from(table).insert(rows.slice(i, i + CHUNK));
        if (error) throw new Error(`inserting ${table}: ${error.message}`);
      }
    }

    console.log("[workbook/ingest] ok:", JSON.stringify(counts), "| warnings:", parsed.warnings.length);
    return { ok: true, counts, warnings: parsed.warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[workbook/ingest] write failed:", message);
    return { ok: false, counts, warnings: parsed.warnings, error: message };
  }
}
