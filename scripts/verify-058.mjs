/**
 * Is migration 058 (invite consent) applied?
 *
 * READ-ONLY. Checks profiles.terms_accepted_via is selectable and, where the
 * catalog is readable, that ghl_events.event_type accepts 'consent'. Inserts
 * nothing: dev and production share one database, and a test outbox row could
 * be delivered to the client's CRM.
 *
 * Exits 1 when the column is missing or the CHECK is readable and stale.
 *
 * Usage: node scripts/verify-058.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const NAME = "ghl_events_event_type_check";

console.log("\nInvite consent (migration 058)\n");

const { error: colError } = await db.from("profiles").select("id, terms_accepted_via").limit(1);
if (colError) {
  console.log("  MISSING  profiles.terms_accepted_via");
  console.log(`           ${colError.message}`);
  console.log(
    "\nmigration not applied — run supabase/migrations/058_invite_consent.sql in the\n" +
      "Supabase SQL editor. Until then invited users' terms acceptance is not recorded\n" +
      "and no consent tag is queued.\n"
  );
  process.exit(1);
}
console.log("  ok       profiles.terms_accepted_via");

const { data, error } = await db.rpc("pg_get_constraintdef_by_name", { conname: NAME });
if (error || typeof data !== "string") {
  console.log(`  SKIP     ${NAME} (cannot read the catalog from here)`);
  console.log(
    "\n  Confirm by hand in the SQL editor:\n" +
      "    SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint\n" +
      "     WHERE contype = 'c' AND conrelid = 'public.ghl_events'::regclass\n" +
      "       AND pg_get_constraintdef(oid) ILIKE '%event_type%';\n" +
      "  Exactly one row, and it must list 'consent'.\n"
  );
  process.exit(0);
}

if (data.includes("'consent'")) {
  console.log(`  ok       ${NAME} accepts 'consent'\n\nApplied.\n`);
} else {
  console.log(`  STALE    ${NAME} does not list 'consent'\n           ${data}\n`);
  process.exit(1);
}
