/**
 * Does the database have what the AI allowlist needs? (migration 034)
 *
 * Reports which initiatives the AI may currently use, and cross-checks the
 * settings against the uploaded workbook library. Also flags the two conditions
 * that look identical on screen but have opposite fixes: an empty library (no
 * workbook uploaded) and an all-off library (everything toggled off).
 *
 * Read-only. Usage: node scripts/verify-initiative-settings.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

let failed = false;

console.log("\nInitiative settings (migration 034)\n");

const COLUMNS = [
  "initiative_key",
  "is_active",
  "max_per_plan",
  "notes",
  "updated_by",
  "updated_at",
];

for (const column of COLUMNS) {
  const { error } = await db.from("initiative_settings").select(column).limit(1);
  if (error) {
    console.log(`  MISSING  initiative_settings.${column}  — ${error.message}`);
    failed = true;
  } else {
    console.log(`  ok       initiative_settings.${column}`);
  }
}

if (failed) {
  console.log(
    "\nNOT READY — apply supabase/migrations/034_initiative_settings.sql first.\n" +
    "Until then loadLibrary FAILS OPEN: every initiative stays available to the\n" +
    "AI, which is the safe direction but means the allowlist is not in force.\n"
  );
  process.exit(1);
}

// ---------------------------------------------------------------
// What the AI may actually use
// ---------------------------------------------------------------
const [{ data: settings }, { data: library }] = await Promise.all([
  db.from("initiative_settings").select("initiative_key, is_active, notes"),
  db.from("wb_initiative_library").select("initiative_key, name").order("display_order"),
]);

const disabled = new Set(
  (settings ?? []).filter((r) => r.is_active === false).map((r) => r.initiative_key)
);
const settingsKeys = new Set((settings ?? []).map((r) => r.initiative_key));
const libraryRows = library ?? [];

console.log("\n=== What the AI may recommend ===\n");

if (libraryRows.length === 0) {
  console.log(
    "  LIBRARY IS EMPTY — no workbook has been ingested.\n" +
    "  This is NOT the same as everything being switched off: upload a workbook\n" +
    "  on /admin/ai-workbook. The toggles have nothing to apply to until then."
  );
} else {
  const active = libraryRows.filter((r) => !disabled.has(r.initiative_key));

  for (const row of libraryRows) {
    const on = !disabled.has(row.initiative_key);
    const known = settingsKeys.has(row.initiative_key);
    console.log(
      `  ${on ? "ACTIVE  " : "off     "} ${row.initiative_key.padEnd(36)} ${row.name}` +
      (known ? "" : "   (no settings row — defaults to active)")
    );
  }

  console.log(`\n  active: ${active.length} of ${libraryRows.length}`);

  if (active.length === 0) {
    console.log(
      "\n  WARNING: nothing is active. The AI has no vocabulary — recommendations\n" +
      "           will be empty for every customer."
    );
  } else if (active.length < 3) {
    console.log(
      `\n  WARNING: only ${active.length} active. Eligibility rules (budget, hours,\n` +
      "           sales model, already-planned) can exclude one or two of a small\n" +
      "           set and leave a customer with an empty shortlist."
    );
  }

  // A setting with no library row: harmless, but invisible later.
  const orphans = [...settingsKeys].filter(
    (k) => !libraryRows.some((r) => r.initiative_key === k)
  );
  if (orphans.length > 0) {
    console.log(
      `\n  note: ${orphans.length} setting(s) refer to initiatives not in the current\n` +
      `        workbook (${orphans.join(", ")}). They apply again if those return.`
    );
  }
}

// ---------------------------------------------------------------
// The duplicate initiative_types rows the old lookup produced
// ---------------------------------------------------------------
const { data: types } = await db
  .from("initiative_types")
  .select("id, channel, is_active")
  .order("created_at", { ascending: true });

const perChannel = new Map();
for (const row of types ?? []) {
  perChannel.set(row.channel, (perChannel.get(row.channel) ?? 0) + 1);
}
const dupes = [...perChannel.entries()].filter(([, n]) => n > 1);

console.log("\n=== initiative_types (the OTHER list — plans attach to these) ===\n");
console.log(`  rows: ${(types ?? []).length} across ${perChannel.size} channels`);
if (dupes.length > 0) {
  console.log(
    `  ${dupes.length} channel(s) hold duplicates, left by the old lookup that\n` +
    "  filtered on is_active and inserted a clone when it missed:"
  );
  for (const [channel, n] of dupes) console.log(`    ${channel}: ${n} rows`);
  console.log(
    "  Harmless now — every lookup takes the oldest row — but worth tidying by\n" +
    "  hand if you want the admin list readable."
  );
} else {
  console.log("  no duplicates");
}

console.log("\nReady.\n");
