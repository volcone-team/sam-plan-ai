import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingColumnError } from "@/lib/workbook/read";
import type { InitiativeMetricSet } from "@/lib/metrics/metric-set";

/**
 * Library key -> `initiative_types` row, and writing `initiatives.library_key`.
 *
 * ONE HELPER FOR EVERY SERVER PATH THAT CREATES AN INITIATIVE FROM THE LIBRARY:
 * the intake build, generate-plan and the customer Add Initiative route. Each
 * used to carry its own copy of this lookup, and the copies drifted — the
 * original generate-plan one filtered on `is_active`, so deactivating a type
 * made the next plan insert an active duplicate of it.
 *
 * THE RULE
 *
 *   1. `initiative_types.channel` equal to the library key is THE match. The
 *      library key is unique per library row, and every auto-created type has
 *      been written with `channel = libraryKey`, so this is the stable key.
 *   2. Active or inactive does NOT matter, and the row is never reactivated.
 *      `initiative_types.is_active` is not the control over what the AI or the
 *      pickers offer — `initiative_settings` is (see loadLibrary). An admin
 *      who switched a type off did so for the /admin/initiatives list, and
 *      silently flipping it back on would undo their decision.
 *   3. When several rows share the channel, the OLDEST wins: it is the row
 *      existing plans already point at, and choosing it every time means the
 *      answer is stable.
 *   4. Only when no row has the channel is one created — once, from the
 *      library entry. Created rows are cached per call site so a plan with two
 *      webinars inserts one type, not two.
 *
 * NOT MATCHED BY NAME, deliberately. Names are not unique in either table:
 * the workbook lists the same name twice as OWN / OPS variants ("Live
 * Webinar"), and `initiative_types` holds ten "Custom Initiative" rows. A name
 * match would attach the OWN variant to the OPS type.
 *
 * RACES. There is no unique constraint on `channel`, so two requests creating
 * the same new key at the same instant could both insert. After inserting we
 * re-read the oldest row for the channel and return THAT, so both callers
 * converge on one id and at worst one unused row is left behind. A partial
 * unique index on `channel` would close it fully; that is a migration for the
 * owner to decide on.
 */

/** The library fields a new type is built from. */
export interface TypeSource {
  name: string;
  oneLiner: string | null;
  /** Workbook 1-5 scale. */
  difficulty: number | null;
}

/** Storage port, so the rule is testable against an in-memory table. */
export interface InitiativeTypeStore {
  /** Oldest row id whose channel equals `channel`, regardless of is_active. */
  findOldestByChannel(channel: string): Promise<string | null>;
  /** Insert and return the new id, or null on failure. */
  insert(row: InitiativeTypeInsert): Promise<string | null>;
}

export interface InitiativeTypeInsert {
  name: string;
  channel: string;
  description: string;
  owner: "system";
  benchmarks: Record<string, never>;
  project_template: { tasks: never[]; totalEstimatedHours: number };
  difficulty: {
    effortToImplement: number;
    skillExpertiseRequired: number;
    timeToResults: number;
    costToRun: number;
  };
  ai_context: Record<string, never>;
  tier: number;
  display_order: number;
  is_active: boolean;
}

/** The row created for a library key that has no type yet. Pure. */
export function typeInsertFor(libraryKey: string, source: TypeSource | null): InitiativeTypeInsert {
  const raw = Number(source?.difficulty);
  // Workbook scale is 1-5; 3 is the neutral default when it is blank.
  const difficulty = Number.isFinite(raw) && raw >= 1 && raw <= 5 ? raw : 3;
  return {
    name: source?.name?.trim() || libraryKey.charAt(0).toUpperCase() + libraryKey.slice(1),
    channel: libraryKey,
    description: source?.oneLiner ?? "",
    owner: "system",
    benchmarks: {},
    project_template: { tasks: [], totalEstimatedHours: 0 },
    difficulty: {
      effortToImplement: difficulty,
      skillExpertiseRequired: difficulty,
      timeToResults: difficulty,
      costToRun: difficulty,
    },
    ai_context: {},
    tier: 1,
    display_order: 99,
    // A brand-new row is active; an existing row is never touched (rule 2).
    is_active: true,
  };
}

/**
 * Pick the type for `channel` from rows already loaded. Pure.
 * Oldest by `created_at`, active or not; null when none matches.
 */
export function pickTypeIdForChannel(
  rows: ReadonlyArray<{ id: string; channel: string | null; created_at?: string | null }>,
  channel: string
): string | null {
  let best: { id: string; at: string } | null = null;
  for (const row of rows) {
    if (row.channel !== channel) continue;
    const at = row.created_at ?? "";
    if (!best || at < best.at) best = { id: row.id, at };
  }
  return best?.id ?? null;
}

/**
 * Resolve (or create once) the type for a library key. See the header.
 *
 * `cache` is optional and per caller: pass one Map for a whole plan so
 * repeated keys cost one lookup.
 */
export async function resolveInitiativeTypeId(
  store: InitiativeTypeStore,
  libraryKey: string,
  source: TypeSource | null,
  cache?: Map<string, string>
): Promise<string | null> {
  const key = libraryKey.trim();
  if (!key) return null;

  const cached = cache?.get(key);
  if (cached) return cached;

  const existing = await store.findOldestByChannel(key);
  if (existing) {
    cache?.set(key, existing);
    return existing;
  }

  const inserted = await store.insert(typeInsertFor(key, source));
  if (!inserted) return null;

  // Converge with any concurrent insert: the oldest row is the answer.
  const settled = (await store.findOldestByChannel(key)) ?? inserted;
  cache?.set(key, settled);
  return settled;
}

/** The Supabase-backed store. Needs the service role (RLS blocks customers). */
export function supabaseTypeStore(db: SupabaseClient, logTag = "[initiative-type]"): InitiativeTypeStore {
  return {
    async findOldestByChannel(channel) {
      // ORDER + LIMIT, not maybeSingle(): duplicates exist, and maybeSingle
      // errors on more than one row.
      const { data, error } = await db
        .from("initiative_types")
        .select("id")
        .eq("channel", channel)
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) {
        console.error(logTag, "type lookup failed:", error.message);
        return null;
      }
      const id = (data?.[0] as { id?: unknown } | undefined)?.id;
      return typeof id === "string" ? id : null;
    },
    async insert(row) {
      const { data, error } = await db.from("initiative_types").insert(row).select("id").single();
      if (error || !data) {
        console.error(logTag, "type insert failed:", error?.message);
        return null;
      }
      const id = (data as { id?: unknown }).id;
      return typeof id === "string" ? id : null;
    },
  };
}

/* ------------------------------------------------------------------ *
 * initiatives.library_key (migration 040), tolerated when absent
 * ------------------------------------------------------------------ */

let warnedMissingLibraryKey = false;

/** Test hook: forget that the missing-column warning was logged. */
export function resetLibraryKeyWarning(): void {
  warnedMissingLibraryKey = false;
}

/** Anything shaped like a PostgREST response; the caller's own type flows through. */
type InsertResult = { error: { code?: string | null; message?: string | null } | null };

/**
 * Insert an initiative row carrying `library_key` and `metric_set` (both
 * migration 040), retrying WITHOUT them when a column does not exist.
 * Logged once per process.
 *
 * `run` performs the insert for a given row so each caller keeps its own
 * `.select(...)` shape. A null / empty key and a null metric set are simply
 * omitted (the column defaults to null).
 */
export async function insertWithLibraryKey<R extends InsertResult>(
  row: Record<string, unknown>,
  libraryKey: string | null | undefined,
  run: (row: Record<string, unknown>) => PromiseLike<R>,
  metricSet?: InitiativeMetricSet | null
): Promise<R> {
  const key = typeof libraryKey === "string" ? libraryKey.trim() : "";
  const extra: Record<string, unknown> = {};
  if (key) extra.library_key = key;
  if (metricSet) extra.metric_set = metricSet;
  if (Object.keys(extra).length === 0) return run(row);

  const first = await run({ ...row, ...extra });
  if (!first.error || !isMissingColumnError(first.error)) return first;

  if (!warnedMissingLibraryKey) {
    warnedMissingLibraryKey = true;
    console.warn(
      "[initiatives] library_key / metric_set column missing (migration 040 not applied); " +
      "creating initiatives without them."
    );
  }
  return run(row);
}
