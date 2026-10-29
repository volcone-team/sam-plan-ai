/**
 * Is migration 059 (app_settings.support_email / support_phone) applied?
 *
 * READ-ONLY. Selects the new columns and prints what the footer will show.
 * Exits 1 when the columns are missing.
 *
 * Usage: node scripts/verify-059.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("\nSupport contact details (migration 059)\n");
const { data, error } = await db
  .from("app_settings")
  .select("support_email, support_phone")
  .eq("id", "global")
  .maybeSingle();
if (error) {
  console.log("  MISSING  app_settings.support_email / support_phone");
  console.log(`           ${error.message}`);
  console.log(
    "\nmigration not applied — run supabase/migrations/059_support_contact.sql in the\n" +
      "Supabase SQL editor. Until then the footer shows its hardcoded defaults.\n"
  );
  process.exit(1);
}
console.log("  ok       app_settings.support_email / support_phone");
console.log(`           email: ${data?.support_email ?? "(unset, footer default)"}`);
console.log(`           phone: ${data?.support_phone ?? "(unset, footer default)"}\n`);
