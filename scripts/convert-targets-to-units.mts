/**
 * One-off: give existing initiatives a units x price target.
 *
 * Client "Initiative Target Setting" spec (Oct 2026): one target per
 * initiative, Good = units x price, Better / Best = +10% / +20%. Initiatives
 * saved before it have dollars only. For each one with a priced product and no
 * units yet:
 *
 *   units  = round(Good per occurrence / product price)   (targets.unitsFromDollars)
 *   price  = the product's current price (unit_price_at_set)
 *   source = "migrated"
 *   Good / Better / Best are NOT changed here. Many intake-built rows carry
 *   Better = forecast and Best = 1.3x (the old build's spread); the dry run
 *   lists them so the owner can decide whether to reset them to +10% / +20%
 *   (pass --reset-scenarios with --apply).
 *
 * Rows with no product, no product price, no revenue, or units already set
 * are skipped. Safe to re-run.
 *
 * DRY RUN BY DEFAULT: reads only, prints what would change.
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/convert-targets-to-units.mts
 *   ... --apply [--reset-scenarios]   WRITES. Live database: owner's go-ahead only.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { unitsFromDollars } from "@/lib/planning/targets";
import { autoBest, autoBetter } from "@/lib/intake-v3/revenue";
import { perOccurrenceOf } from "@/lib/initiatives/occurrences";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const APPLY = process.argv.includes("--apply");
const RESET = process.argv.includes("--reset-scenarios");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

const [{ data: rows, error }, { data: products, error: pErr }] = await Promise.all([
  db.from("initiatives").select("*"),
  db.from("products").select("id, name, price"),
]);
if (error || pErr) throw new Error((error ?? pErr)!.message);
const priceById = new Map((products ?? []).map((p) => [p.id as string, Number(p.price) || 0]));

console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"}: ${rows?.length ?? 0} initiatives\n`);
let convert = 0;
let skip = 0;
let offSpread = 0;

for (const r of rows ?? []) {
  const price = priceById.get(r.product_id) ?? 0;
  const good = Number(r.revenue_good) || 0;
  if (r.units_goal !== null && r.units_goal !== undefined) { skip++; continue; }
  if (!r.product_id || price <= 0 || good <= 0) { skip++; continue; }

  // Recurring: units are per occurrence (Phase 2), so divide by the recorded figure.
  const perOcc = r.kind === "recurring" ? perOccurrenceOf({ revenuePerOccurrence: r.revenue_per_occurrence, attrs: r.attrs }) : null;
  const units = perOcc !== null ? unitsFromDollars({ good: perOcc, price }) : unitsFromDollars({ good, price });
  const better = Number(r.revenue_better) || 0;
  const best = Number(r.revenue_best) || 0;
  const spreadOff = Math.abs(better - autoBetter(good)) > 1 || Math.abs(best - autoBest(good)) > 1;
  if (spreadOff) offSpread++;
  convert++;
  console.log(
    `  ${r.name}: ${money(perOcc ?? good)} / ${money(price)} = ${units} unit(s)` +
      (spreadOff ? `  [Better ${money(better)} / Best ${money(best)} not +10%/+20%]` : "")
  );

  if (APPLY) {
    const patch: Record<string, unknown> = { units_goal: units, unit_price_at_set: price, target_source: "migrated" };
    if (RESET) { patch.revenue_better = autoBetter(good); patch.revenue_best = autoBest(good); }
    const { error: e } = await db.from("initiatives").update(patch).eq("id", r.id);
    if (e) console.log(`     FAILED: ${e.message}`);
  }
}

console.log(
  `\n${convert} to convert, ${skip} skipped, ${offSpread} with Better/Best off the +10%/+20% rule.` +
    (APPLY ? "" : " Nothing written (dry run).") + "\n"
);
