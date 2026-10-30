import type { SupabaseClient } from "@supabase/supabase-js";
import type { TaskTemplate } from "@/lib/workbook/materialise";
import type { LibraryInitiative } from "@/lib/intake/library";
import { readStoredMetrics, type StoredMetrics } from "@/lib/metrics/parse-metrics";
import { isMissingColumnError } from "@/lib/supabase/missing-column";

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
  /*
   * Migration 040. On a database without it these read as null / [] — see
   * loadLibrary — so every caller can rely on the shape either way.
   */
  /** The initiative this is a variant of ("webinar" for "webinar-own"); null on a base listing. */
  baseKey: string | null;
  /** S/C/O/R/E, each 1-5 where 5 is best. */
  speedScore: number | null;
  costScore: number | null;
  oddsScore: number | null;
  revenueScore: number | null;
  easeScore: number | null;
  scoreTotal: number | null;
  idealIndustries: string[];
  ctaOptions: string[];
  training: string[];
  /** The workbook's Metrics cell verbatim. */
  metricsRaw: string | null;
  /** Parsed Metrics cell (migration 040 `metrics`). Null when never parsed (stored `[]`) or malformed. */
  metrics: StoredMetrics | null;
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
  const select = (columns: string) =>
    db.from("wb_initiative_library").select(columns).order("display_order", { ascending: true });

  let { data, error } = await select(`${LIBRARY_COLUMNS}, ${LIBRARY_COLUMNS_040}`);
  if (error && isMissingColumnError(error)) {
    // Migration 040 not applied yet: read the old columns, new fields default.
    ({ data, error } = await select(LIBRARY_COLUMNS));
  }
  if (error) {
    console.error("[workbook/read] loadLibrary failed:", error.message);
    return [];
  }

  let rows = (data ?? []) as unknown as Record<string, unknown>[];

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

  return rows.map(toLibraryEntry);
}

const LIBRARY_COLUMNS =
  "initiative_key, workbook_id, name, category, difficulty, speed_to_results, one_liner, own_or_ops, price_tier, needs_sales_team";
const LIBRARY_COLUMNS_040 =
  "base_key, speed_score, cost_score, odds_score, revenue_score, ease_score, score_total, " +
  "ideal_industries, cta_options, training, metrics_raw, metrics";

/**
 * "This column does not exist" — PostgREST PGRST204 or Postgres 42703.
 *
 * MOVED to src/lib/supabase/missing-column.ts and re-exported here so the
 * dozen existing `from "@/lib/workbook/read"` imports keep working. The
 * middleware needs the same predicate for migration 043's columns, and
 * importing it from this module pulled the workbook and metrics-dictionary
 * graph into the Edge bundle.
 */
export { isMissingColumnError } from "@/lib/supabase/missing-column";

const textOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const textList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];

/**
 * One wb_initiative_library row to a LibraryEntry. Exported for tests.
 * Tolerant of a row from before migration 040: absent columns become null / [].
 */
export function toLibraryEntry(r: Record<string, unknown>): LibraryEntry {
  return {
    initiativeKey: r.initiative_key as string,
    workbookId: textOrNull(r.workbook_id),
    name: r.name as string,
    category: textOrNull(r.category),
    difficulty: numOrNull(r.difficulty),
    speedToResults: textOrNull(r.speed_to_results),
    oneLiner: textOrNull(r.one_liner),
    ownOrOps: textOrNull(r.own_or_ops),
    priceTier: textOrNull(r.price_tier),
    needsSalesTeam: textOrNull(r.needs_sales_team),
    baseKey: textOrNull(r.base_key),
    speedScore: numOrNull(r.speed_score),
    costScore: numOrNull(r.cost_score),
    oddsScore: numOrNull(r.odds_score),
    revenueScore: numOrNull(r.revenue_score),
    easeScore: numOrNull(r.ease_score),
    scoreTotal: numOrNull(r.score_total),
    idealIndustries: textList(r.ideal_industries),
    ctaOptions: textList(r.cta_options),
    training: textList(r.training),
    metricsRaw: textOrNull(r.metrics_raw),
    // `[]` (column default / pre-task-3 rows) and malformed values read as null.
    metrics: readStoredMetrics(r.metrics),
  };
}

/**
 * LibraryEntry to the shape the intake picker and eligibility rules consume.
 * `idealIndustries` rides along, so passesIndustry reads the real column.
 */
export function toLibraryInitiative(entry: LibraryEntry): LibraryInitiative {
  return {
    key: entry.initiativeKey,
    name: entry.name,
    category: entry.category,
    oneLiner: entry.oneLiner,
    ownOrOps: entry.ownOrOps,
    priceTier: entry.priceTier,
    difficulty: entry.difficulty,
    speedToResults: entry.speedToResults,
    needsSalesTeam: entry.needsSalesTeam,
    idealIndustries: entry.idealIndustries,
    workbookId: entry.workbookId,
    baseKey: entry.baseKey,
    speedScore: entry.speedScore,
    costScore: entry.costScore,
    oddsScore: entry.oddsScore,
    revenueScore: entry.revenueScore,
    easeScore: entry.easeScore,
    scoreTotal: entry.scoreTotal,
    ctaOptions: entry.ctaOptions,
    training: entry.training,
    metricsRaw: entry.metricsRaw,
    metrics: entry.metrics,
  };
}

/* ------------------------------------------------------------------ *
 * Variant fallback for task templates and benchmarks
 * ------------------------------------------------------------------ */

/**
 * Base key for each of `keys` that is a variant (migration 040 `base_key`).
 *
 * Empty when nothing is a variant, and ALSO when the column does not exist
 * yet: without 040 no variant link is stored, so there is nothing to fall
 * back to and behaviour is exactly as before.
 */
async function loadBaseKeys(db: SupabaseClient, keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;
  const { data, error } = await db
    .from("wb_initiative_library")
    .select("initiative_key, base_key")
    .in("initiative_key", keys);
  if (error) {
    if (!isMissingColumnError(error)) {
      console.error("[workbook/read] loadBaseKeys failed:", error.message);
    }
    return out;
  }
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const key = textOrNull(r.initiative_key);
    const base = textOrNull(r.base_key);
    if (key && base && base !== key) out.set(key, base);
  }
  return out;
}

/**
 * Rows per requested key, falling back to the BASE initiative's rows for a
 * variant that has none of its own.
 *
 * Templates and benchmarks join to the library by NAME, so "Live Webinar"
 * listed twice (OPS and OWN) puts every template row on "webinar" and none on
 * "webinar-own". Resolved here at read time from the stored `base_key` rather
 * than by duplicating rows at ingest, so one upload holds one copy.
 *
 * A variant's OWN rows always win; the base is only consulted when the variant
 * has none. The result is keyed by the requested key only.
 */
export async function withBaseFallback<T>(
  db: SupabaseClient,
  keys: string[],
  fetchRows: (keys: string[]) => Promise<Map<string, T[]>>,
  rekey: (row: T, key: string) => T = (row) => row
): Promise<Map<string, T[]>> {
  const unique = [...new Set(keys.filter(Boolean))];
  const out = await fetchRows(unique);
  const missing = unique.filter((k) => !out.has(k));
  if (missing.length === 0) return out;

  const bases = await loadBaseKeys(db, missing);
  if (bases.size === 0) return out;

  const baseRows = await fetchRows([...new Set(bases.values())]);
  for (const [key, base] of bases) {
    const rows = baseRows.get(base);
    if (rows && rows.length > 0) out.set(key, rows.map((row) => rekey(row, key)));
  }
  return out;
}

/**
 * Task templates for the given initiatives, grouped by key and ordered.
 * A variant with no templates of its own gets its base initiative's.
 */
export async function loadTaskTemplates(
  db: SupabaseClient,
  keys: string[]
): Promise<Map<string, TaskTemplate[]>> {
  return withBaseFallback(db, keys, (unique) => fetchTaskTemplates(db, unique));
}

async function fetchTaskTemplates(
  db: SupabaseClient,
  unique: string[]
): Promise<Map<string, TaskTemplate[]>> {
  const out = new Map<string, TaskTemplate[]>();
  if (unique.length === 0) return out;

  const columns = "initiative_key, task_number, name, category, lead_days, duration_hours, role, depends_on, notes, display_order";
  const run = (cols: string) =>
    db.from("wb_task_templates").select(cols).in("initiative_key", unique).order("display_order", { ascending: true });
  // `section` is migration 061; without it every task reads as unsectioned.
  let { data, error } = await run(`${columns}, section`);
  if (error && isMissingColumnError(error)) ({ data, error } = await run(columns));
  if (error) {
    console.error("[workbook/read] loadTaskTemplates failed:", error.message);
    return out;
  }
  for (const r of ((data ?? []) as unknown as Record<string, unknown>[])) {
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
      section: typeof r.section === "string" ? r.section : null,
    });
    out.set(key, list);
  }
  return out;
}

/**
 * Benchmarks for the given initiatives, grouped by key. A variant with none of
 * its own gets its base initiative's, re-keyed to the variant so a caller
 * grouping by `initiativeKey` sees them where it asked.
 */
export async function loadBenchmarks(
  db: SupabaseClient,
  keys: string[]
): Promise<Map<string, BenchmarkEntry[]>> {
  return withBaseFallback(
    db,
    keys,
    (unique) => fetchBenchmarks(db, unique),
    (row, key) => ({ ...row, initiativeKey: key })
  );
}

async function fetchBenchmarks(
  db: SupabaseClient,
  unique: string[]
): Promise<Map<string, BenchmarkEntry[]>> {
  const out = new Map<string, BenchmarkEntry[]>();
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

const AI_CONTEXT_COLUMNS =
  "initiative_key, when_to_use, best_fit, min_budget, min_assets, why_it_works, what_to_avoid, sequencing_notes";

function toContextEntry(r: Record<string, unknown>): ContextEntry {
  return {
    initiativeKey: r.initiative_key as string,
    whenToUse: (r.when_to_use as string) ?? null,
    bestFit: (r.best_fit as string) ?? null,
    minBudget: (r.min_budget as string) ?? null,
    minAssets: (r.min_assets as string) ?? null,
    whyItWorks: (r.why_it_works as string) ?? null,
    whatToAvoid: (r.what_to_avoid as string) ?? null,
    sequencingNotes: (r.sequencing_notes as string) ?? null,
  };
}

/** Selection guidance. Currently sparse in the workbook - only some rows are authored. */
export async function loadAiContext(db: SupabaseClient): Promise<ContextEntry[]> {
  const { data, error } = await db.from("wb_ai_context").select(AI_CONTEXT_COLUMNS);
  if (error) {
    console.error("[workbook/read] loadAiContext failed:", error.message);
    return [];
  }
  return (data || []).map(toContextEntry);
}

/**
 * The AI Context row for one library key, or null when none is authored.
 * THROWS on a read error (unlike loadAiContext), so a caller can tell
 * "nothing written for this initiative" from "the lookup failed".
 */
export async function loadAiContextForKey(db: SupabaseClient, initiativeKey: string): Promise<ContextEntry | null> {
  const { data, error } = await db
    .from("wb_ai_context")
    .select(AI_CONTEXT_COLUMNS)
    .eq("initiative_key", initiativeKey)
    .maybeSingle();
  if (error) throw new Error(`wb_ai_context lookup failed: ${error.message}`);
  return data ? toContextEntry(data as Record<string, unknown>) : null;
}

/** The five S/C/O/R/E scores of one library row, as read (not validated). */
export type LibraryScores = Pick<
  LibraryEntry,
  "speedScore" | "costScore" | "oddsScore" | "revenueScore" | "easeScore" | "scoreTotal"
>;

/**
 * The SCORE columns of the wb_initiative_library row for one key, or null when
 * there is no such row. A database without migration 040 has no score columns:
 * that reads as null too (nothing to show), not as an error.
 * THROWS on any other read error.
 *
 * Deliberately NOT filtered by initiative_settings: an initiative already in a
 * plan keeps showing its scores even if an admin has since switched it off.
 */
export async function loadLibraryScoresForKey(
  db: SupabaseClient,
  initiativeKey: string
): Promise<LibraryScores | null> {
  const { data, error } = await db
    .from("wb_initiative_library")
    .select("speed_score, cost_score, odds_score, revenue_score, ease_score, score_total")
    .eq("initiative_key", initiativeKey)
    .maybeSingle();
  if (error) {
    if (isMissingColumnError(error)) return null;
    throw new Error(`wb_initiative_library score lookup failed: ${error.message}`);
  }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    speedScore: numOrNull(r.speed_score),
    costScore: numOrNull(r.cost_score),
    oddsScore: numOrNull(r.odds_score),
    revenueScore: numOrNull(r.revenue_score),
    easeScore: numOrNull(r.ease_score),
    scoreTotal: numOrNull(r.score_total),
  };
}

/**
 * The library rendered for the prompt: compact enough to send in full, so the
 * model SELECTS from your catalogue instead of inventing channels. Guidance from
 * AI Context is attached where it has been authored.
 */
export function renderLibraryForPrompt(
  library: ReadonlyArray<Pick<LibraryEntry,
    "initiativeKey" | "name" | "difficulty" | "speedToResults" | "priceTier" | "ownOrOps" | "oneLiner">>,
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
