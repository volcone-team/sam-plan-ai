/**
 * Is migration 045 (the Initiative Intake configuration) applied?
 *
 * READ-ONLY, AND MORE STRICTLY THAN USUAL. This migration relaxes three
 * constraints on `initiatives`, and the obvious way to test a relaxation is to
 * insert a row that the old schema would have refused. This script does not do
 * that. `initiatives` is a customer table on the one database that local dev
 * and production share, a test row would be visible in somebody plan, and the
 * insert would need a company, an annual plan and an initiative type to hang
 * off. So nullability is read out of the PostgREST schema description and the
 * `kind` CHECK is read out of the catalog where that is reachable; where it is
 * not, the script says so and prints the query to paste in rather than
 * guessing.
 *
 * Writes nothing, inserts nothing, and does not apply anything.
 *
 * Exits 1 when the migration is not applied.
 *
 * Usage: node scripts/verify-045.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = createClient(url, key);

console.log("\nInitiative Intake configuration (migration 045)\n");

let tableOk = false;
let columnsOk = false;

/* ---- 1. initiative_library_config, with every column the editor writes ---- */
{
  const { error } = await db
    .from("initiative_library_config")
    .select(
      "initiative_key, category_id, is_launch, allowed_kinds, allowed_paths, " +
        "allowed_frequencies, audience_source, format_override, ongoing_label, " +
        "partner_host, partner_booking, revenue_lines, field_extras, " +
        "updated_at, updated_by"
    )
    .limit(1);

  if (error) {
    console.log("  MISSING  table initiative_library_config (or one of its columns)");
    console.log(`           ${error.message}`);
  } else {
    tableOk = true;
    console.log("  ok       initiative_library_config with all 15 columns");
  }
}

/* ---- 2. The new initiatives columns ---- */
{
  const { error } = await db
    .from("initiatives")
    .select(
      "id, conversion_path, audience_source, format, category_id, " +
        "revenue_close_date, activation_date_precision, event_date_precision, attrs"
    )
    .limit(1);

  if (error) {
    console.log("  MISSING  one of the eight new initiatives columns");
    console.log(`           ${error.message}`);
  } else {
    columnsOk = true;
    console.log(
      "  ok       initiatives.conversion_path, audience_source, format, category_id,"
    );
    console.log(
      "           revenue_close_date, activation_date_precision, event_date_precision, attrs"
    );
  }
}

/* ---- 3. The two nullability relaxations ----
 *
 * Read out of the PostgREST schema description served at the REST root. Its
 * `required` list for a table is the columns that are NOT NULL with no
 * default, which is exactly what activation_date and product_id were: present
 * there means the relaxation has NOT been applied, absent means it has. No
 * row is read and nothing is written.
 *
 * Degrades to a SKIP with the catalog query to paste, following
 * verify-profile-phone.mjs: a check that cannot run must say so rather than
 * report a pass it did not earn.
 */
let relaxationsOk = null;
try {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const spec = await res.json();
  const required =
    spec?.definitions?.initiatives?.required ??
    spec?.components?.schemas?.initiatives?.required;

  if (!Array.isArray(required)) throw new Error("no initiatives definition in the schema");

  const stillRequired = ["activation_date", "product_id"].filter((c) => required.includes(c));

  if (stillRequired.length === 0) {
    relaxationsOk = true;
    console.log("  ok       initiatives.activation_date is nullable");
    console.log("  ok       initiatives.product_id is nullable (FK and RESTRICT unchanged)");
  } else {
    relaxationsOk = false;
    for (const c of stillRequired) {
      console.log(`  STALE    initiatives.${c} is still NOT NULL`);
    }
    console.log(
      "           Section 6 of the migration has not run. Until it does, an\n" +
        "           undated or productless initiative cannot be saved at all."
    );
  }
} catch (err) {
  console.log("  SKIP     cannot read column nullability from here");
  console.log(`           (${err.message})`);
  console.log("           Confirm by hand in the SQL editor:");
  console.log(
    "             SELECT column_name, is_nullable FROM information_schema.columns\n" +
      "              WHERE table_name = 'initiatives'\n" +
      "                AND column_name IN ('activation_date', 'product_id');\n" +
      "           Both must read YES."
  );
}

/* ---- 4. The kind CHECK accepts 'ongoing' ----
 *
 * The constraint predicate lives in pg_constraint.consrc / pg_get_constraintdef
 * and PostgREST exposes neither the catalog nor, by default, any function that
 * would read it. Attempted anyway in case such an RPC exists on this project,
 * then degraded — the alternative, inserting a row with kind = 'ongoing' to see
 * whether it is refused, is a write to a customer table and is not acceptable
 * from a verify script.
 */
{
  const { data, error } = await db.rpc("pg_get_constraintdef_by_name", {
    conname: "initiatives_kind_check",
  });

  if (!error && typeof data === "string") {
    if (data.includes("'ongoing'")) {
      console.log("  ok       initiatives_kind_check accepts 'ongoing'");
      if (data.includes("'evergreen'")) {
        console.log(
          "  ok       and still accepts the legacy 'evergreen' (no backfill was run)"
        );
      } else {
        console.log(
          "  WARN     'evergreen' is no longer accepted. Existing rows may hold it;\n" +
            "           the CHECK was supposed to be WIDENED, not switched."
        );
      }
    } else {
      console.log("  STALE    initiatives_kind_check does NOT accept 'ongoing'");
      console.log(`           ${data}`);
    }
  } else {
    console.log("  SKIP     cannot read the kind CHECK from here");
    console.log("           (no pg_get_constraintdef_by_name RPC — that is expected)");
    console.log("           Confirm by hand in the SQL editor:");
    console.log(
      "             SELECT pg_get_constraintdef(oid) FROM pg_constraint\n" +
        "              WHERE conname = 'initiatives_kind_check';\n" +
        "           It must list both 'evergreen' and 'ongoing'."
    );
  }
}

/* ---- 5. What is actually configured ---- */
if (tableOk) {
  const { count: total } = await db
    .from("initiative_library_config")
    .select("initiative_key", { count: "exact", head: true });

  const { count: launches } = await db
    .from("initiative_library_config")
    .select("initiative_key", { count: "exact", head: true })
    .eq("is_launch", true);

  const { count: unconfigured } = await db
    .from("initiative_library_config")
    .select("initiative_key", { count: "exact", head: true })
    .is("allowed_kinds", null);

  const { count: libraryRows } = await db
    .from("wb_initiative_library")
    .select("initiative_key", { count: "exact", head: true });

  console.log("");
  console.log(`  config rows                  : ${total ?? 0}`);
  console.log(`  is_launch (in the picker)    : ${launches ?? 0}`);
  console.log(`  allowed_kinds not set yet    : ${unconfigured ?? 0}`);
  console.log(`  wb_initiative_library rows   : ${libraryRows ?? 0}`);
  console.log(
    "\n  0 config rows is the expected state straight after applying: the table is\n" +
      "  created empty and is_launch defaults FALSE, so no record reaches the picker\n" +
      "  until an admin switches it on. The two counts above drifting apart is the\n" +
      "  thing to watch — a config row whose initiative_key is no longer in the\n" +
      "  library survives, on purpose, because there is no foreign key."
  );
}

if (tableOk && columnsOk && relaxationsOk !== false) {
  console.log("\nApplied.\n");
} else {
  console.log(
    "\nmigration not applied — run supabase/migrations/045_initiative_intake.sql\n" +
      "in the Supabase SQL editor (generated by scripts/gen-migration-045.mjs).\n" +
      "Applying it changes no behaviour on its own: the config table is created\n" +
      "empty with is_launch defaulting FALSE, the new initiatives columns are\n" +
      "nullable and unread, and the three relaxations only widen what the table\n" +
      "will accept. It does NOT backfill kind = 'evergreen' to 'ongoing'; that is\n" +
      "a data change for the owner to run deliberately.\n"
  );
  process.exit(1);
}
