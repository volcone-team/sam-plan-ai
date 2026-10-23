/**
 * Companies with NO subscriptions row.
 *
 * POST /api/admin/companies/create inserted its own company and deleted the one
 * the signup trigger made — and the trigger's subscriptions row went with it.
 * Every billing writer updates by company_id, so for these companies Checkout
 * could not store a customer id, the webhook could not record a payment, and
 * the admin table hid "Grant access".
 *
 * DRY RUN BY DEFAULT: lists the companies (id, name, created_at, owner email).
 *   node scripts/backfill-missing-subscriptions.mjs
 *
 * --apply inserts the default row for each. ONLY INSERTS, NEVER UPDATES: the
 * write is INSERT ... ON CONFLICT (company_id) DO NOTHING, so a row created
 * between the read and the write is left alone.
 *   node scripts/backfill-missing-subscriptions.mjs --apply
 *
 * The default row is the trigger's TRIALS-OFF row — no trial, no plan, no
 * access — and must match defaultSubscriptionRow in
 * src/lib/billing/subscription-row.ts. Access is then given deliberately with
 * "Grant access" in /admin/companies.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}

const APPLY = process.argv.includes("--apply");

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** Mirror of defaultSubscriptionRow (src/lib/billing/subscription-row.ts). */
function defaultRow(companyId) {
  return {
    company_id: companyId,
    tier: "none",
    status: "cancelled",
    billing_cycle: "monthly",
    plan_id: null,
    is_trial_active: false,
    trial_ends_at: null,
    start_date: new Date().toISOString(),
  };
}

async function all(table, columns) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999);
    if (error) {
      console.error(`Could not read ${table}:`, error.message);
      process.exit(1);
    }
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

const companies = await all("companies", "id, name, created_at");
const subs = await all("subscriptions", "company_id");
const withRow = new Set(subs.map((s) => s.company_id));
const missing = companies
  .filter((c) => !withRow.has(c.id))
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

const owners = missing.length
  ? (
      await db
        .from("profiles")
        .select("company_id, email, role")
        .in("company_id", missing.map((c) => c.id))
    ).data ?? []
  : [];
const ownerEmail = new Map();
for (const p of owners) {
  if (p.role === "owner" || !ownerEmail.has(p.company_id)) ownerEmail.set(p.company_id, p.email);
}

console.log(`\nCompanies: ${companies.length} | with subscriptions row: ${withRow.size} | missing: ${missing.length}`);
console.log(APPLY ? "Mode: APPLY (insert only)\n" : "Mode: DRY RUN (nothing written; pass --apply to insert)\n");

for (const c of missing) {
  console.log(
    `  ${c.id}  ${JSON.stringify(c.name ?? "")}  created ${c.created_at}  owner ${ownerEmail.get(c.id) ?? "(none)"}`
  );
}

if (!APPLY || missing.length === 0) {
  if (missing.length === 0) console.log("  Nothing to do.");
  process.exit(0);
}

let inserted = 0;
let skipped = 0;
for (const c of missing) {
  const { data, error } = await db
    .from("subscriptions")
    .upsert(defaultRow(c.id), { onConflict: "company_id", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error(`  FAILED ${c.id}: ${error.message}`);
  } else if (data && data.length > 0) {
    inserted++;
    console.log(`  inserted ${c.id}`);
  } else {
    skipped++;
    console.log(`  skipped ${c.id} (row appeared meanwhile; left untouched)`);
  }
}
console.log(`\nInserted ${inserted}, skipped ${skipped}, failed ${missing.length - inserted - skipped}.`);
