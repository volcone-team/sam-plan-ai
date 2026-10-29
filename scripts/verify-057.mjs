/**
 * Is migration 057 (account_invites, 7-day invite links) applied?
 *
 * READ-ONLY. Counts invites by state. Writes nothing. Exits 1 when the table
 * is missing.
 *
 * Usage: node scripts/verify-057.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

console.log("\n7-day account invites (migration 057)\n");
const { data, error } = await db.from("account_invites").select("expires_at, revoked_at, accepted_at");
if (error) {
  console.log("  MISSING  account_invites");
  console.log(`           ${error.message}`);
  console.log(
    "\nmigration not applied — run supabase/migrations/057_account_invites.sql in the\n" +
      "Supabase SQL editor. Until then invites fall back to Supabase's own link,\n" +
      "which expires with the project's Email OTP setting (1 hour by default).\n"
  );
  process.exit(1);
}
const rows = data ?? [];
const now = Date.now();
const live = rows.filter((r) => !r.revoked_at && !r.accepted_at && Date.parse(r.expires_at) > now).length;
console.log("  ok       account_invites");
console.log(`           ${rows.length} invites: ${live} live, ${rows.filter((r) => r.accepted_at).length} accepted, ${rows.filter((r) => r.revoked_at).length} replaced\n`);
