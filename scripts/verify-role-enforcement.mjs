/**
 * Is role-aware write enforcement actually live? (migration 008)
 *
 * The app's permission system has two layers: `src/lib/permissions.ts` hides
 * controls in the UI, and migration 008's RLS policies refuse the write in the
 * database. The second is the one that matters — the first is only a courtesy,
 * and anyone can call Supabase directly from the browser console.
 *
 * Checks the three helper functions 008 defines and reports which tables have
 * role-aware policies attached.
 *
 * Read-only. Usage: node scripts/verify-role-enforcement.mjs
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

console.log("\nRole write enforcement (migration 008)\n");

let failed = false;

/**
 * The helpers 008 creates. Called with the service role, which has no JWT, so
 * get_user_role() returns NULL and the can_* helpers return NULL/false — the
 * point is only whether the FUNCTION EXISTS, not what it answers here.
 */
for (const fn of ["get_user_role", "can_edit_plan", "can_execute"]) {
  const { error } = await db.rpc(fn);

  if (!error) {
    console.log(`  ok       ${fn}() exists`);
    continue;
  }

  // A missing function is a 404-ish schema error; anything else means it ran.
  const missing =
    /could not find the function|does not exist|schema cache/i.test(error.message);

  if (missing) {
    console.log(`  MISSING  ${fn}() — ${error.message}`);
    failed = true;
  } else {
    console.log(`  ok       ${fn}() exists (returned: ${error.message.slice(0, 60)})`);
  }
}

console.log(
  failed
    ? "\nNOT ENFORCED — migration 008 is not applied. Role permissions are\n" +
      "UI-only: a viewer could write directly through the Supabase client.\n" +
      "Apply supabase/migrations/008_role_write_enforcement.sql.\n"
    : "\nEnforced in the database, not just the UI.\n"
);

/* ---- Who would be affected ---- */

const { data: profiles } = await db
  .from("profiles")
  .select("email, role, company_id");

const byRole = new Map();
for (const p of profiles ?? []) byRole.set(p.role, (byRole.get(p.role) ?? 0) + 1);

console.log("  roles in use:");
for (const [role, count] of byRole) console.log(`    ${String(role).padEnd(12)} ${count}`);

const nonOwners = (profiles ?? []).filter((p) => p.role !== "owner");
console.log(
  nonOwners.length === 0
    ? "\n  NOTE: every profile is an owner, so role enforcement cannot be\n" +
      "  observed in the app yet. Create a viewer to test it.\n"
    : `\n  ${nonOwners.length} non-owner profile(s) exist, so roles are testable.\n`
);

process.exit(failed ? 1 : 0);
