/**
 * Backfill `initiatives.metric_set` for initiatives created before metric
 * sets existed.
 *
 * Candidates: `metric_set IS NULL` and EITHER `library_key` is set OR the
 * initiative type's `channel` equals a library key (the stable match used by
 * src/lib/workbook/initiative-type.ts). The set is the library default
 * (every group, every optional metric) via `defaultLibraryMetricSet`, the
 * same function every create path uses.
 *
 * DRY RUN BY DEFAULT: prints what it would do and writes nothing.
 * `--apply` writes, and only to rows whose metric_set is STILL null (the
 * update filters `metric_set IS NULL`), so it is idempotent and never
 * overwrites a set chosen since. `library_key` is filled too when it was
 * null, matched by channel.
 *
 * Prints ids (first 8 chars), initiative names and library keys only. Never
 * emails or secrets.
 *
 * Usage:
 *   node_modules/.bin/vite-node -c vitest.config.ts scripts/backfill-metric-sets.mts
 *   node_modules/.bin/vite-node -c vitest.config.ts scripts/backfill-metric-sets.mts --apply
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { loadLibrary } from "@/lib/workbook/read";
import { defaultLibraryMetricSet } from "@/lib/metrics/library-metric-set";
import { enteredMetricKeys, type InitiativeMetricSet } from "@/lib/metrics/metric-set";

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

interface InitiativeRow {
  id: string;
  name: string | null;
  company_id: string | null;
  initiative_type_id: string | null;
  library_key: string | null;
}

async function fetchAll<T>(table: string, columns: string, nullCol?: string): Promise<T[]> {
  const out: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let q = db.from(table).select(columns).order("id", { ascending: true }).range(from, from + page - 1);
    if (nullCol) q = q.is(nullCol, null);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as unknown as T[]));
    if (!data || data.length < page) return out;
  }
}

const short = (id: string | null) => (id ?? "").slice(0, 8);
const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

// Inactive rows too: an initiative already running keeps its metrics.
const library = await loadLibrary(db, { includeInactive: true });
const byKey = new Map(library.map((e) => [e.initiativeKey, e]));

const [initiatives, types, totalWithSet] = await Promise.all([
  fetchAll<InitiativeRow>("initiatives", "id, name, company_id, initiative_type_id, library_key", "metric_set"),
  fetchAll<{ id: string; channel: string | null }>("initiative_types", "id, channel"),
  db.from("initiatives").select("id", { count: "exact", head: true }).not("metric_set", "is", null),
]);
const channelOf = new Map(types.map((t) => [t.id, t.channel]));

interface Plan {
  row: InitiativeRow;
  libraryKey: string;
  via: "library_key" | "channel";
  set: InitiativeMetricSet | null;
}
const plans: Plan[] = [];
let legacy = 0;
let unknownLibraryKey = 0;

for (const row of initiatives) {
  let libraryKey: string | null = null;
  let via: Plan["via"] = "library_key";
  if (row.library_key) {
    if (byKey.has(row.library_key)) libraryKey = row.library_key;
    else unknownLibraryKey++;
  }
  if (!libraryKey) {
    const ch = row.initiative_type_id ? channelOf.get(row.initiative_type_id) : null;
    if (ch && byKey.has(ch)) { libraryKey = ch; via = "channel"; }
  }
  if (!libraryKey) { legacy++; continue; }
  plans.push({ row, libraryKey, via, set: defaultLibraryMetricSet(libraryKey, byKey.get(libraryKey)) });
}

console.log(`\nBackfill metric sets — ${APPLY ? "APPLY" : "DRY RUN (no writes)"}\n`);
console.log(`Library rows: ${library.length}`);
console.log(`Initiatives already with a metric set: ${totalWithSet.count ?? "?"}`);
console.log(`Initiatives with metric_set null: ${initiatives.length}\n`);

if (plans.length > 0) {
  console.log(`${pad("initiative", 10)} ${pad("name", 34)} ${pad("company", 10)} ${pad("library key", 28)} ${pad("via", 12)} metrics`);
  for (const p of plans) {
    const n = p.set ? enteredMetricKeys(p.set).length : 0;
    const derived = p.set ? p.set.groups.reduce((s, g) => s + g.metrics.length, 0) - n : 0;
    console.log(
      `${pad(short(p.row.id), 10)} ${pad(p.row.name ?? "", 34)} ${pad(short(p.row.company_id), 10)} ` +
      `${pad(p.libraryKey, 28)} ${pad(p.via, 12)} ${p.set ? `${n} entered + ${derived} derived` : "none (stays legacy)"}`
    );
  }
}

const withSet = plans.filter((p) => p.set);
console.log(`\nWould receive a metric set: ${withSet.length}`);
console.log(`Matched to a library key but the library row has no metrics: ${plans.length - withSet.length}`);
console.log(`No library_key and no matching channel (stay legacy): ${legacy}`);
if (unknownLibraryKey > 0) console.log(`library_key not found in the library: ${unknownLibraryKey}`);

if (!APPLY) {
  console.log("\nDry run: nothing written. Re-run with --apply to write.\n");
  process.exit(0);
}

let written = 0;
let skipped = 0;
for (const p of withSet) {
  const patch: Record<string, unknown> = { metric_set: p.set };
  if (!p.row.library_key) patch.library_key = p.libraryKey;
  const { data, error } = await db
    .from("initiatives")
    .update(patch)
    .eq("id", p.row.id)
    .is("metric_set", null) // idempotent: never overwrite a set
    .select("id");
  if (error) { console.error(`  ${short(p.row.id)} failed: ${error.message}`); continue; }
  if (data && data.length > 0) written++; else skipped++;
}
console.log(`\nWritten: ${written}. Skipped (already had a set): ${skipped}.\n`);
