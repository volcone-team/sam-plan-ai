/**
 * Is migration 047 (intake v3 toggle) applied?
 *
 * READ-ONLY: selects one column of the app_settings singleton. Writes
 * nothing. Exits 1 when the migration is missing.
 *
 * Usage: node scripts/verify-047.mjs
 */
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log("\nIntake v3 toggle (migration 047)\n");
const { data, error } = await db
  .from("app_settings")
  .select("intake_v3_enabled")
  .eq("id", "global")
  .maybeSingle();

if (error) {
  console.log("  MISSING  app_settings.intake_v3_enabled");
  console.log(`           ${error.message}`);
  console.log("\nNOT applied.\n");
  process.exit(1);
}
console.log(`  ok       app_settings.intake_v3_enabled = ${data?.intake_v3_enabled ?? "(no global row)"}`);
console.log("\nApplied.\n");
process.exit(0);
