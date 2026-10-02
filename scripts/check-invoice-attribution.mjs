/**
 * Read-only audit of billing_invoices attribution.
 *
 * Confirms no invoice is left unattributed. An invoice with a null company_id
 * belongs to no company in this database, yet still counted towards "Collected
 * to date" and appeared in admin payment history with a blank Company column —
 * which is how a clean install reported $6,945 of revenue it never took.
 *
 * READS ONLY. Run after purge-orphan-invoices.sql to verify, and any time the
 * revenue figures look wrong.
 *
 *   node scripts/check-invoice-attribution.mjs
 */

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Amounts are stored in minor units (cents), as Stripe sends them.
const usd = (minor) => `$${(minor / 100).toFixed(2)}`;

const { data: invoices, error } = await db
  .from("billing_invoices")
  .select("company_id, amount_paid, status");

if (error) {
  console.log(`\nFAIL  billing_invoices unreadable: ${error.message}\n`);
  process.exit(1);
}

const rows = invoices ?? [];
const orphans = rows.filter((i) => !i.company_id);
const attributed = rows.filter((i) => i.company_id);

const paidTotal = (set) =>
  set.filter((i) => i.status === "paid").reduce((s, i) => s + (i.amount_paid ?? 0), 0);

console.log("\nInvoice attribution\n");
console.log(`  total invoices        ${rows.length}`);
console.log(`  attributed            ${attributed.length}  (${usd(paidTotal(attributed))} paid)`);
console.log(`  unattributed          ${orphans.length}  (${usd(paidTotal(orphans))} paid)`);

// This figure should match "Collected to date" on the admin Overview tab, which
// now filters on company_id NOT NULL.
console.log(`\n  Collected to date     ${usd(paidTotal(attributed))}`);

if (orphans.length > 0) {
  console.log(
    `\n  ${orphans.length} unattributed invoice(s) remain, inflating revenue by ` +
    `${usd(paidTotal(orphans))}.\n  Run supabase/scripts/purge-orphan-invoices.sql to clear them.\n`
  );
  process.exit(1);
}

console.log("\n  ok — every invoice belongs to a company.\n");
