/**
 * Is migration 046 (recurring instances) applied?
 *
 * READ-ONLY: selects at most one row from each table. Inserts nothing,
 * updates nothing, applies nothing. Exits 1 when the migration is missing.
 *
 * Usage: node scripts/verify-046.mjs
 */
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log("\nRecurring instances (migration 046)\n");
let ok = true;

{
  const { error } = await db
    .from("initiative_instances")
    .select("id, initiative_id, company_id, instance_date, outcome, actual_revenue, materialised_at, updated_at")
    .limit(1);
  if (error) {
    ok = false;
    console.log("  MISSING  table initiative_instances (or one of its columns)");
    console.log(`           ${error.message}`);
  } else {
    console.log("  ok       initiative_instances with all 8 columns");
  }
}

{
  const { error } = await db.from("initiatives").select("id, correction_kept_at").limit(1);
  if (error) {
    ok = false;
    console.log("  MISSING  initiatives.correction_kept_at");
    console.log(`           ${error.message}`);
  } else {
    console.log("  ok       initiatives.correction_kept_at");
  }
}

console.log(
  "\n  Not checked from here (needs the catalog): the outcome CHECK, RLS policies and the\n" +
    "  updated_at trigger. In the SQL editor:\n" +
    "    SELECT polname FROM pg_policy WHERE polrelid = 'initiative_instances'::regclass;\n" +
    "    SELECT conname FROM pg_constraint WHERE conrelid = 'initiative_instances'::regclass;\n" +
    "    SELECT tgname FROM pg_trigger WHERE tgrelid = 'initiative_instances'::regclass AND NOT tgisinternal;\n"
);
console.log(ok ? "Applied.\n" : "NOT applied.\n");
process.exit(ok ? 0 : 1);
