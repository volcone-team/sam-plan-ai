import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  deriveLegacyFields,
  parseWorkbook,
  type LibraryRow,
  type RawSheet,
  type ParsedWorkbook,
} from "@/lib/workbook/parse";
import { isMissingColumnError } from "@/lib/workbook/read";
import { parseMetricsCell, toStoredMetrics } from "@/lib/metrics/parse-metrics";
import { MIGRATION_040_WARNING, metricsWarnings } from "@/lib/workbook/ingest-messages";

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

  /** Tables fully written so far, for an honest message if a later one fails. */
  const written: string[] = [];
  let stage = "clearing the wb_* tables";

  try {
    // Replace wholesale. Order doesn't matter: there are no FKs between these
    // tables, they join on initiative_key by convention so a partially-filled
    // workbook still ingests.
    for (const table of ["wb_task_templates", "wb_benchmarks", "wb_ai_context", "wb_initiative_library"]) {
      const { error } = await client.from(table).delete().neq("initiative_key", "\u0000");
      if (error) throw new Error(`clearing ${table}: ${error.message}`);
    }

    // ---- Library first, with the migration-040 columns when they exist ----
    stage = "inserting wb_initiative_library";
    const library = parsed.library.map(deriveLegacyFields);
    const libraryRows = library.map(libraryRow);
    const withScores = await insertLibrary(client, libraryRows);
    if (!withScores) {
      parsed.warnings.push(MIGRATION_040_WARNING);
      console.warn("[workbook/ingest] migration 040 columns missing; library stored without scores.");
    }
    // Reported with or without 040: the cell needs fixing either way.
    parsed.warnings.push(...metricsWarnings(library));
    written.push("wb_initiative_library");

    // Seeded straight after the library, so a failure in a LATER table cannot
    // leave new initiatives without a toggle row.
    await seedInitiativeSettings(client, parsed);

    const inserts: Array<[string, Record<string, unknown>[]]> = [
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

    for (const [table, rows] of inserts) {
      stage = `inserting ${table}`;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await client.from(table).insert(rows.slice(i, i + CHUNK));
        if (error) throw new Error(`inserting ${table}: ${error.message}`);
      }
      written.push(table);
    }

    console.log("[workbook/ingest] ok:", JSON.stringify(counts), "| warnings:", parsed.warnings.length);
    return { ok: true, counts, warnings: parsed.warnings };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[workbook/ingest] write failed:", message);
    /*
     * There is no transaction across PostgREST calls. Everything was cleared
     * up front, so a failure here leaves the tables written so far complete and
     * the rest EMPTY or partly filled. Say exactly which, so the admin knows
     * the AI is running on a partial library until the upload is retried.
     */
    const untouched = ALL_TABLES.filter((t) => !written.includes(t));
    parsed.warnings.push(
      `Ingest stopped while ${stage}. ` +
      (written.length > 0 ? `Fully written: ${written.join(", ")}. ` : "Nothing was written. ") +
      `Empty or incomplete: ${untouched.join(", ")}. ` +
      "The uploaded workbook itself is saved; upload it again to retry."
    );
    return { ok: false, counts, warnings: parsed.warnings, error: message };
  }
}

const ALL_TABLES = ["wb_initiative_library", "wb_benchmarks", "wb_task_templates", "wb_ai_context"];

// Chunked: 655 task templates in one request is large enough to be worth
// splitting, and a single oversized insert is the kind of thing that fails
// only in production.
const CHUNK = 200;

// Both live in a pure module so the browser-side upload preview can use them.
export { MIGRATION_040_WARNING, metricsWarnings };

/** Columns that exist only once migration 040 is applied. */
const MIGRATION_040_COLUMNS = [
  "base_key", "speed_score", "cost_score", "odds_score", "revenue_score", "ease_score",
  "score_total", "ideal_industries", "cta_options", "training", "metrics_raw", "metrics",
] as const;

function libraryRow(r: LibraryRow): Record<string, unknown> {
  return {
    initiative_key: r.initiativeKey, workbook_id: r.workbookId, name: r.name,
    category: r.category, difficulty: r.difficulty, speed_to_results: r.speedToResults,
    one_liner: r.oneLiner, description: r.description, needs_sales_team: r.needsSalesTeam,
    price_tier: r.priceTier, own_or_ops: r.ownOrOps, display_order: r.displayOrder,
    // ---- migration 040 ----
    base_key: r.baseKey ?? null,
    speed_score: r.speedScore ?? null, cost_score: r.costScore ?? null,
    odds_score: r.oddsScore ?? null, revenue_score: r.revenueScore ?? null,
    ease_score: r.easeScore ?? null, score_total: r.scoreTotal ?? null,
    ideal_industries: r.idealIndustries ?? [], cta_options: r.ctaOptions ?? [],
    training: r.training ?? [], metrics_raw: r.metricsRaw ?? null,
    // Parsed from metrics_raw, versioned so it can be re-parsed later.
    metrics: toStoredMetrics(parseMetricsCell(r.metricsRaw ?? null)),
  };
}

function withoutMigration040(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const c of MIGRATION_040_COLUMNS) delete out[c];
  return out;
}

/**
 * Insert the library, preferring the full (migration 040) column set.
 *
 * The first chunk decides: if it is rejected for a missing column, it and every
 * later chunk go in with the pre-040 columns instead, so an upload made before
 * the owner applies 040 still lands. Returns whether the 040 columns were used.
 * Any other error throws, as before.
 */
async function insertLibrary(
  client: SupabaseClient,
  rows: Record<string, unknown>[]
): Promise<boolean> {
  let full = true;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    let { error } = await client.from("wb_initiative_library").insert(full ? chunk : chunk.map(withoutMigration040));
    if (error && full && i === 0 && isMissingColumnError(error)) {
      full = false;
      ({ error } = await client.from("wb_initiative_library").insert(chunk.map(withoutMigration040)));
    }
    if (error) throw new Error(`inserting wb_initiative_library: ${error.message}`);
  }
  return full;
}

async function seedInitiativeSettings(client: SupabaseClient, parsed: ParsedWorkbook): Promise<void> {
    /**
     * Give every initiative a settings row, WITHOUT touching existing ones.
     *
     * `initiative_settings` decides which initiatives the AI may reference. It
     * deliberately lives outside the wb_* tables, because those are wiped and
     * rebuilt above — a toggle stored on the library row would be destroyed by
     * the very next upload.
     *
     * `ignoreDuplicates` is the whole point: an initiative the admin has
     * already switched off must stay off across a re-upload, so this only ever
     * ADDS rows for keys it has not seen. Anything new a workbook introduces
     * arrives ACTIVE, which is the safe direction — a new initiative is usable
     * and visible until someone decides otherwise, rather than silently absent.
     *
     * Best effort. The library is already written by this point, and a failure
     * here would leave the admin thinking the upload failed when the data
     * landed. An initiative with no settings row still reads as active, so the
     * worst case is a missing toggle, not a broken library.
     */
    const settingsKeys = [...new Set(parsed.library.map((r) => r.initiativeKey))];
    if (settingsKeys.length > 0) {
      const { error: settingsError } = await client
        .from("initiative_settings")
        .upsert(
          settingsKeys.map((initiative_key) => ({ initiative_key })),
          { onConflict: "initiative_key", ignoreDuplicates: true }
        );

      if (settingsError) {
        // Most likely migration 034 not applied yet.
        console.error(
          "[workbook/ingest] Could not seed initiative_settings:",
          settingsError.message
        );
        parsed.warnings.push(
          "Could not record settings rows for the uploaded initiatives, so new " +
          "ones may not appear in the admin toggle list. The library itself " +
          "ingested fine."
        );
      }
    }
}
