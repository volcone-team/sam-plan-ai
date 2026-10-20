/** Temporary read-only smoke test of the real batched task generation. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolveTaskTemplates } from "@/lib/workbook/tasks-for-initiatives";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Five keys: one templated, four not, so chunking and the mix are both exercised.
const keys = [
  "live-webinar-own",
  "past-buyer-reactivation-campaign",
  "event-sponsorship-exhibitor-sales",
  "challenge-bootcamp-paid-own",
  "referral-program-own",
];
const started = Date.now();
const out = await resolveTaskTemplates(db, keys, { logLabel: "[smoke]" });
console.log(`\nresolved in ${Date.now() - started}ms`);
for (const key of keys) {
  const entry = out.get(key);
  console.log(`\n${key}: ${entry?.source} | ${entry?.templates.length} tasks`);
  for (const t of entry?.templates.slice(0, 3) ?? []) {
    console.log(`  ${t.leadDays}d | ${t.durationHours}h | ${t.role ?? "-"} | ${t.name} | after ${JSON.stringify(t.dependsOn)}`);
  }
}
