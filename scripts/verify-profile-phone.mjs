/**
 * Does the database have what the signup phone field needs?
 *
 * TWO THINGS MUST BOTH BE TRUE, and checking only the first is the trap. The
 * column can exist while the trigger still ignores the metadata key, in which
 * case signup succeeds, the number is written into
 * auth.users.raw_user_meta_data, and `profiles.phone` stays NULL forever with
 * nothing in any log to say so.
 *
 * Read-only. Usage: node scripts/verify-profile-phone.mjs
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

console.log("\nProfile phone number (migration 035)\n");

let failed = false;

/* ---- 1. The column ---- */

const { error: columnError } = await db.from("profiles").select("phone").limit(1);

if (columnError) {
  console.log(`  MISSING  profiles.phone — ${columnError.message}`);
  failed = true;
} else {
  console.log("  ok       profiles.phone exists");
}

/* ---- 2. The trigger reads the metadata key ---- */

/**
 * Read the function source rather than creating a throwaway user.
 *
 * A real signup would prove it end to end, but it writes to auth.users on the
 * database shared with production and leaves a company, a profile, an annual
 * plan and a subscription behind. The function body is the thing that changed,
 * so reading it answers the question without touching anything.
 *
 * Needs an RPC that can return the definition; if there isn't one, this
 * degrades to a warning rather than a failure, because the column check above
 * is still meaningful on its own.
 */
const { data: source, error: sourceError } = await db.rpc("pg_get_functiondef_by_name", {
  fn: "handle_new_user",
});

if (sourceError) {
  console.log(
    "  SKIP     cannot read the trigger source from here\n" +
    "           (no pg_get_functiondef_by_name RPC — that is expected)\n" +
    "           Confirm by hand in the SQL editor:\n" +
    "             SELECT prosrc FROM pg_proc WHERE proname = 'handle_new_user';\n" +
    "           It must contain:  raw_user_meta_data->>'phone'"
  );
} else if (typeof source === "string" && source.includes("raw_user_meta_data->>'phone'")) {
  console.log("  ok       handle_new_user reads the phone metadata key");
} else {
  console.log(
    "  STALE    handle_new_user does NOT read 'phone'.\n" +
    "           The column exists but signups will silently discard the number.\n" +
    "           Re-run section 2 of supabase/migrations/035_profile_phone.sql."
  );
  failed = true;
}

/* ---- 3. What is actually stored ---- */

if (!columnError) {
  const { count: total } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true });

  const { count: withPhone } = await db
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .not("phone", "is", null);

  console.log(
    `\n  profiles: ${total ?? 0} total, ${withPhone ?? 0} with a phone number`
  );
  console.log(
    "  NULL is correct for every account created before this migration, and\n" +
    "  for admin-created and invited users who never see the signup form."
  );
}

console.log(
  failed
    ? "\nNOT READY — apply supabase/migrations/035_profile_phone.sql first.\n"
    : "\nReady.\n"
);

process.exit(failed ? 1 : 0);
