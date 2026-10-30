/**
 * One-off: record "per occurrence" on existing recurring initiatives.
 *
 * Client, Oct 2026: recurring revenue is PER OCCURRENCE ("$75,000 per
 * webinar, not in total"), and the series runs first -> last occurrence, not
 * to the cart close date. Rows saved before that change need converting:
 *
 *   ADD-FORM ROWS (attrs.revenue_mode set): the user typed Good thinking per
 *     occurrence, but it was saved as the total. Per occurrence = the typed
 *     Good; the total becomes per occurrence x occurrences (Better / Best
 *     scaled by the same factor). Their cart close date used to cut the
 *     series to one occurrence, so this is where the totals change.
 *   INTAKE-BUILT ROWS: the stored total already was per run x runs. Per
 *     occurrence = total / occurrences; the total is unchanged.
 *
 * Occurrences are counted exactly as the app now counts them (runDates, to
 * the last occurrence or the plan end). Rows already carrying a per-occurrence
 * figure are skipped, so it is safe to re-run.
 *
 * DRY RUN BY DEFAULT: prints before / after and writes nothing.
 *   node_modules/.bin/vite-node --config vitest.config.ts scripts/convert-recurring-per-occurrence.mts
 *   ... --apply   to write (owner's go-ahead only; production database)
 *
 * Writes revenue_per_occurrence (migration 061) when the column exists, else
 * attrs.revenue_per_occurrence, plus revenue_good / better / best.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { horizonEnd, runDates } from "@/lib/planning/revenue-spread";
import { perOccurrenceOf, withOccurrenceFallback } from "@/lib/initiatives/occurrences";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const APPLY = process.argv.includes("--apply");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

type Row = Record<string, any>;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const cents = (n: number) => Math.round(n * 100) / 100;

const { data: rows, error } = await db.from("initiatives").select("*").eq("kind", "recurring");
if (error) throw new Error(error.message);

const horizonByCompany = new Map<string, string | null>();
async function planEndFor(companyId: string): Promise<string | null> {
  if (horizonByCompany.has(companyId)) return horizonByCompany.get(companyId)!;
  const { data } = await db
    .from("planning_inputs")
    .select("plan_start_month, horizon_months")
    .eq("company_id", companyId)
    // Same row the app reads (planService.getPlanHorizon).
    .eq("intake_version", 2)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const end = horizonEnd(data?.plan_start_month ?? null, data?.horizon_months ?? null);
  horizonByCompany.set(companyId, end);
  return end;
}

console.log(`\n${APPLY ? "APPLYING" : "DRY RUN"}: ${rows?.length ?? 0} recurring initiatives\n`);
let changed = 0;
let skipped = 0;

for (const r of (rows ?? []) as Row[]) {
  const attrs = (r.attrs && typeof r.attrs === "object" ? r.attrs : {}) as Row;
  const frequency = r.repeat_frequency ?? attrs.repeat_frequency ?? null;
  const row = {
    kind: "recurring",
    repeatFrequency: frequency,
    activationDate: r.activation_date,
    eventDate: r.event_date,
    categoryId: r.category_id,
    activationDatePrecision: r.activation_date_precision,
    eventDatePrecision: r.event_date_precision,
    lastOccurrenceDate: r.last_occurrence_date ?? null,
    revenuePerOccurrence: r.revenue_per_occurrence ?? null,
    attrs,
  };
  if (perOccurrenceOf(row) !== null) {
    skipped += 1;
    continue;
  }
  const n = runDates(row, await planEndFor(r.company_id)).length;
  const good = Number(r.revenue_good) || 0;
  if (n === 0 || good <= 0) {
    skipped += 1;
    console.log(`  skip  ${r.name}: ${n === 0 ? "no frequency / first occurrence" : "no revenue"}`);
    continue;
  }

  const fromAddForm = typeof attrs.revenue_mode === "string";
  const perOccurrence = fromAddForm ? good : cents(good / n);
  const factor = fromAddForm ? n : 1;
  const next = {
    revenue_good: cents(good * factor),
    revenue_better: cents((Number(r.revenue_better) || 0) * factor),
    revenue_best: cents((Number(r.revenue_best) || 0) * factor),
    revenue_per_occurrence: perOccurrence,
  };

  changed += 1;
  console.log(
    `  ${fromAddForm ? "form  " : "intake"} ${r.name} (${frequency}, ${n} occurrences): ` +
      `${money(perOccurrence)} per occurrence; Good ${money(good)} -> ${money(next.revenue_good)}`
  );

  if (APPLY) {
    const { error: writeError } = await withOccurrenceFallback(
      next,
      (p) => db.from("initiatives").update(p).eq("id", r.id),
      "[convert-recurring]",
      async () => attrs
    );
    if (writeError) console.log(`         FAILED: ${writeError.message}`);
  }
}

console.log(`\n${changed} to convert, ${skipped} skipped.${APPLY ? "" : " Nothing written (dry run). Add --apply to write."}\n`);
