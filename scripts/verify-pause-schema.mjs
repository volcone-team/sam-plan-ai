/**
 * Does the database have what the pause feature needs?
 *
 * The middleware reads `subscriptions.is_paused` on EVERY request, so if that
 * column is missing after deploy, every page load fails for every customer —
 * not just paused ones. This check is the gate before pushing.
 *
 * Read-only. Usage: node scripts/verify-pause-schema.mjs
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

const COLUMNS = [
  "is_paused",
  "paused_at",
  "paused_by",
  "pause_reason",
  "pause_resumes_at",
];

console.log("\nPause billing schema (migration 027)\n");

let failed = false;

// Selected individually: a combined select fails on the FIRST missing column
// and would not say which others are absent.
for (const column of COLUMNS) {
  const { error } = await db.from("subscriptions").select(column).limit(1);
  if (error) {
    console.log(`  MISSING  subscriptions.${column}  — ${error.message}`);
    failed = true;
  } else {
    console.log(`  ok       subscriptions.${column}`);
  }
}

/**
 * The exact read the middleware performs. Proves the whole gate works rather
 * than just that the columns exist.
 */
if (!failed) {
  const { error } = await db
    .from("subscriptions")
    .select("company_id, is_paused")
    .eq("is_paused", true)
    .limit(5);

  if (error) {
    console.log(`\n  MIDDLEWARE READ FAILED — ${error.message}`);
    failed = true;
  } else {
    const { count } = await db
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("is_paused", true);
    console.log(`\n  ok       middleware read works | currently paused: ${count ?? 0}`);
  }
}

// The contact address the paused page shows. Not fatal — the page degrades to
// generic wording — but a pause with no way to get in touch is a dead end.
const { data: settings } = await db
  .from("app_settings")
  .select("chat_contact_email")
  .eq("id", "global")
  .maybeSingle();

const email = settings?.chat_contact_email ?? null;
console.log(
  email
    ? `  ok       contact email for the paused page: ${email}`
    : "  WARN     no chat_contact_email set — the paused page will show generic wording.\n" +
      "           Set it on /admin/ai-tools so paused customers know who to contact."
);

console.log(
  failed
    ? "\nNOT READY — do not deploy. Apply supabase/migrations/027_pause_billing.sql first.\n"
    : "\nReady to deploy.\n"
);

process.exit(failed ? 1 : 0);
