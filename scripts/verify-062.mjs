/**
 * Is migration 062 (open / close new registration) applied?
 *
 * READ-ONLY. Reads app_settings.registration_open. The auth.users trigger is
 * not visible through the API, so the SQL to confirm it by hand is printed.
 *
 * Exits 1 when the column is missing.
 *
 * Usage: node scripts/verify-062.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("\nOpen / close new registration (migration 062)\n");
const { data, error } = await db
  .from("app_settings")
  .select("registration_open")
  .eq("id", "global")
  .maybeSingle();
if (error) {
  console.log("  MISSING  app_settings.registration_open");
  console.log(`           ${error.message}`);
  console.log("\nNOT applied.\n");
  process.exit(1);
}
console.log(`  ok       app_settings.registration_open = ${data?.registration_open ?? "(no global row)"}`);
console.log("\nConfirm the trigger by hand in the SQL editor:");
console.log(
  "  SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND tgname = 'block_signup_when_closed';"
);
console.log("  (expect one row, tgenabled = O)\n");
