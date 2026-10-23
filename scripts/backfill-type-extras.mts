/**
 * Backfill the spec's type extras (pitch day, webinar date, the offer owner's
 * cart dates, the dinner's guest list) into initiative_library_config rows the
 * seed already wrote.
 *
 * WHY THIS EXISTS: field_extras is NOT NULL DEFAULT '[]' (migration 045) and a
 * saved row's value is authoritative (config-repo ROW_AUTHORITATIVE), so the
 * extras deriveConfig now proposes never reach a record whose row was seeded
 * with []. This fills exactly those.
 *
 * WHAT IT TOUCHES: only rows whose field_extras is currently an EMPTY ARRAY
 * and whose library name is in TYPE_EXTRAS_BY_NAME (src/lib/intake-v3/
 * type-extras.ts, the same table deriveConfig reads). The plan is
 * planTypeExtrasBackfill, tested in type-extras.test.ts. A row with any extras
 * is an admin's decision and is reported, never replaced. The write also
 * filters `field_extras = '[]'`, so a row an admin saved between our read and
 * our write is left alone. Idempotent: a second run finds nothing to do.
 *
 * DRY RUN BY DEFAULT. `--apply` writes. Prints keys and record names only.
 *
 * WHY .mts AND NOT .mjs: the extras table is TypeScript under src/ with the
 * "@/" alias, and one copy of it is the point. Same arrangement as
 * scripts/backfill-metric-sets.mts.
 *
 * Usage:
 *   node_modules/.bin/vite-node -c vitest.config.ts scripts/backfill-type-extras.mts
 *   node_modules/.bin/vite-node -c vitest.config.ts scripts/backfill-type-extras.mts --apply
 */
import { createClient } from "@supabase/supabase-js";
import { planTypeExtrasBackfill, type BackfillConfigRow, type BackfillLibraryRow } from "@/lib/intake-v3/type-extras";

process.loadEnvFile(".env.local");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local.");
  process.exit(1);
}
const apply = process.argv.includes("--apply");
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  const [lib, cfg] = await Promise.all([
    db.from("wb_initiative_library").select("initiative_key, name").order("display_order", { ascending: true }),
    db.from("initiative_library_config").select("initiative_key, field_extras"),
  ]);
  if (lib.error) throw new Error(`wb_initiative_library: ${lib.error.message}`);
  if (cfg.error) throw new Error(`initiative_library_config: ${cfg.error.message}`);

  const plan = planTypeExtrasBackfill(
    (lib.data ?? []) as BackfillLibraryRow[],
    (cfg.data ?? []) as BackfillConfigRow[]
  );

  console.log(apply ? "APPLY" : "DRY RUN (pass --apply to write)");
  console.log(`Library rows: ${lib.data?.length ?? 0}. Config rows: ${cfg.data?.length ?? 0}.`);
  console.log(`Would set field_extras on ${plan.updates.length} row(s):`);
  for (const u of plan.updates) {
    const extras = u.fieldExtras
      .map((e) => `${e.key} (${e.type ?? "text"}${e.binds ? `, binds ${e.binds}` : ""}${e.derives ? `, derives ${e.derives}` : ""})`)
      .join("; ");
    console.log(`  ${u.initiativeKey}  "${u.name}"  ->  ${extras}`);
  }
  if (plan.skipped.length > 0) {
    console.log(`Skipped ${plan.skipped.length}:`);
    for (const s of plan.skipped) console.log(`  ${s.initiativeKey}  "${s.name}"  (${s.reason})`);
  }
  if (!apply || plan.updates.length === 0) return;

  let written = 0;
  for (const u of plan.updates) {
    const { data, error } = await db
      .from("initiative_library_config")
      .update({ field_extras: u.fieldExtras, updated_at: new Date().toISOString() })
      .eq("initiative_key", u.initiativeKey)
      .eq("field_extras", "[]")
      .select("initiative_key");
    if (error) {
      console.error(`  ${u.initiativeKey}: ${error.message}`);
      continue;
    }
    if ((data ?? []).length === 0) console.log(`  ${u.initiativeKey}: changed since the read, left alone.`);
    else written += 1;
  }
  console.log(`Wrote ${written} of ${plan.updates.length}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
