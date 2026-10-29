/**
 * Import the "Stage to Scale" course sheet into SAM University as DRAFT
 * resources, one row each, under the "Stage To Scale" category.
 *
 * WHY A SCRIPT. The sheet failed as a Supabase CSV import: its `id` and `slug`
 * columns are blank (both NOT NULL / UNIQUE), and its `category_id` column was
 * auto-incremented by the spreadsheet (…39d81, …39d82, …, …39d170), so none of
 * them is the real category and the ones past …39d99 are not even valid UUIDs.
 * Here every row gets the real category (…39d80 "Stage To Scale"), a generated
 * id, and a unique slug.
 *
 * Kept from the sheet: title, description, resource_type, url, status 'draft',
 * is_free FALSE, billing_cycle 'annual', updated_by. display_order is the
 * sheet's ORDER (10, 20, 30 …) rather than its value (every row said 10), so
 * the course reads in sequence. created_at/updated_at are left to the
 * database (the sheet's values carried one timezone per row).
 *
 * IDEMPOTENT: a row whose title AND url already exist in the category is
 * skipped, so running it twice adds nothing.
 *
 *   node scripts/import-stage-to-scale.mjs           dry run, writes nothing
 *   node scripts/import-stage-to-scale.mjs --apply   insert
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes("--apply");

const CATEGORY_ID = "59a652fb-dd11-482d-8f56-83f7ddc39d80";
const UPDATED_BY = "737e68cd-4075-45fb-8881-ef2e319ae03c";
const TYPES = new Set(["video", "article", "pdf", "link"]);

// Same rule as slugify / uniqueSlug in src/lib/university/access.ts.
function slugify(text) {
  const s = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/g, "");
  return s || "item";
}
function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, 80 - suffix.length).replace(/-+$/g, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

const lines = readFileSync("scripts/data/stage-to-scale-resources.tsv", "utf8").split("\n").filter((l) => l.trim());
const rows = lines.slice(1).map((l) => {
  const [title, description, type, url] = l.split("\t");
  return { title: title.trim(), description: description?.trim() || null, type: type.trim(), url: url.trim() };
});

const { data: category, error: catErr } = await db.from("university_categories").select("id, name").eq("id", CATEGORY_ID).maybeSingle();
if (catErr || !category) {
  console.error("Category", CATEGORY_ID, "not found:", catErr?.message ?? "missing");
  process.exit(1);
}
const { data: existing, error: exErr } = await db.from("university_resources").select("slug, title, url, category_id");
if (exErr) {
  console.error("Could not read resources:", exErr.message);
  process.exit(1);
}
const taken = new Set(existing.map((r) => r.slug));
const already = new Set(existing.filter((r) => r.category_id === CATEGORY_ID).map((r) => `${r.title}\u0000${r.url}`));

const problems = [];
const insert = [];
rows.forEach((r, i) => {
  if (!TYPES.has(r.type)) problems.push(`row ${i + 2}: unknown type "${r.type}"`);
  if (!/^https?:\/\//i.test(r.url)) problems.push(`row ${i + 2}: url is not http(s)`);
  if (already.has(`${r.title}\u0000${r.url}`)) return;
  const slug = uniqueSlug(slugify(r.title), taken);
  taken.add(slug);
  insert.push({
    slug,
    category_id: CATEGORY_ID,
    title: r.title,
    description: r.description,
    resource_type: r.type,
    url: r.url,
    duration_minutes: null,
    status: "draft",
    is_free: false,
    billing_cycle: "annual",
    display_order: (i + 1) * 10,
    updated_by: UPDATED_BY,
  });
});

console.log(`Category: ${category.name} (${CATEGORY_ID})`);
console.log(`Sheet rows: ${rows.length} | already present: ${rows.length - insert.length} | to insert: ${insert.length}`);
if (problems.length) {
  console.log("Problems:\n  " + problems.join("\n  "));
  process.exit(1);
}
for (const r of insert.slice(0, 3)) console.log("  e.g.", r.display_order, r.resource_type, r.slug);
if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to insert.");
  process.exit(0);
}
const { data: created, error } = await db.from("university_resources").insert(insert).select("id");
if (error) {
  console.error("Insert failed (nothing written):", error.message);
  process.exit(1);
}
console.log(`Inserted ${created.length} draft resources.`);
