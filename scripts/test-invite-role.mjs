/**
 * Does the invite flow's profile update actually apply the role?
 *
 * Replays the exact sequence from /api/team/create-member against a throwaway
 * user: create the auth user (which fires handle_new_user), wait, read the
 * trigger-made profile, then run the same UPDATE. Reads the role back and
 * reports whether it stuck.
 *
 * SENDS NO EMAIL and does NOT call the HTTP route, so no invite goes out.
 * Creates exactly one auth user and deletes it again, including the company
 * the trigger made for it.
 *
 * Usage: node scripts/test-invite-role.mjs
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

const email = `invite-role-probe+${Date.now()}@example.invalid`;
const WANTED_ROLE = "viewer";

let userId = null;
let triggerCompanyId = null;

try {
  console.log("\nInvite role probe\n");

  // A real company to join, so the update mirrors the route exactly.
  const { data: host } = await db
    .from("companies")
    .select("id, name")
    .limit(1)
    .maybeSingle();

  if (!host) {
    console.log("  No company exists to join. Nothing to test.");
    process.exit(0);
  }
  console.log(`  joining company: ${host.name} (${host.id.slice(0, 8)})`);

  /* ---- 1. Same createUser call the route makes ---- */
  const { data: created, error: createErr } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      needs_password: true,
      first_name: "Probe",
      last_name: "User",
      company_name: null,
    },
  });

  if (createErr || !created?.user) {
    console.log(`  createUser failed: ${createErr?.message}`);
    process.exit(1);
  }

  userId = created.user.id;
  console.log(`  created auth user ${userId.slice(0, 8)}`);

  /* ---- 2. The route's 500ms wait for the trigger ---- */
  await new Promise((r) => setTimeout(r, 500));

  const { data: autoProfile } = await db
    .from("profiles")
    .select("company_id, role")
    .eq("id", userId)
    .maybeSingle();

  triggerCompanyId = autoProfile?.company_id ?? null;
  console.log(
    `  trigger made profile: role=${autoProfile?.role} company=${String(triggerCompanyId).slice(0, 8)}`
  );

  /* ---- 3. The route's update, verbatim ---- */
  const { data: updated, error: updateErr } = await db
    .from("profiles")
    .update({
      company_id: host.id,
      first_name: "Probe",
      last_name: "User",
      role: WANTED_ROLE,
      is_admin: false,
    })
    .eq("id", userId)
    .select("role, company_id, first_name");

  console.log(
    `  update returned: ${updateErr ? `ERROR ${updateErr.message}` : `${updated?.length ?? 0} row(s)`}`
  );
  if (updated?.[0]) console.log(`    -> ${JSON.stringify(updated[0])}`);

  /* ---- 4. Read it back fresh ---- */
  const { data: after } = await db
    .from("profiles")
    .select("role, company_id")
    .eq("id", userId)
    .maybeSingle();

  console.log(`\n  role after update: ${after?.role}  (wanted ${WANTED_ROLE})`);
  console.log(
    after?.role === WANTED_ROLE
      ? "\n  RESULT: the update DOES apply the role. The live owner rows came from somewhere else.\n"
      : "\n  RESULT: the update does NOT apply the role — this reproduces the bug.\n"
  );
} finally {
  /* ---- Clean up: the user, and the company the trigger created ---- */
  if (userId) {
    const { error } = await db.auth.admin.deleteUser(userId);
    console.log(`  cleanup: deleted auth user ${error ? `FAILED ${error.message}` : "ok"}`);
  }
  if (triggerCompanyId) {
    const { error } = await db.from("companies").delete().eq("id", triggerCompanyId);
    console.log(`  cleanup: deleted trigger company ${error ? `FAILED ${error.message}` : "ok"}`);
  }
}
