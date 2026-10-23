/**
 * Is migration 049 (require email verification) applied?
 *
 * READ-ONLY: selects one column of the app_settings singleton. Writes
 * nothing. Exits 1 when the migration is missing.
 *
 * Usage: node scripts/verify-049.mjs
 */
import { createClient } from "@supabase/supabase-js";
process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
console.log("\nRequire email verification (migration 049)\n");
const { data, error } = await db
  .from("app_settings")
  .select("require_email_verification")
  .eq("id", "global")
  .maybeSingle();
if (error) {
  console.log("  MISSING  app_settings.require_email_verification");
  console.log(`           ${error.message}`);
  console.log("\nNOT applied.\n");
  process.exit(1);
}
console.log(
  `  ok       app_settings.require_email_verification = ${data?.require_email_verification ?? "(no global row)"}`
);
console.log("\nApplied.\n");
process.exit(0);
