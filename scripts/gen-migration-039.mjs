/**
 * Generates migration 039 — admin-managed FAQ (categories + items).
 *
 * A GENERATOR, not a hand-written .sql file, to match 028/029/035/037/038.
 * The output contains NO dollar sign at all — no dollar-quoting, no DO blocks,
 * no functions, and RLS needs no policies. Two seeded answers mention prices
 * ("Starter ($49/mo)…"); every dollar sign in seed text is emitted as
 * `chr(36)` concatenation instead, so the file stays dollar-free. The read-back
 * check below asserts that, so a future edit cannot sneak one in.
 *
 * The seed is today's hardcoded `faqCategories` from
 * src/components/help/faq-page.tsx, VERBATIM (including answers that are now
 * out of date — the owner edits those in admin, not here).
 *
 * Run: node scripts/gen-migration-039.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";

/** Built, never typed, so no shell or String.replace can mangle it. */
const DOLLAR = String.fromCharCode(36);

/**
 * SQL string literal: single quotes doubled. A dollar sign is never written
 * literally: the text is split on it and re-joined with `chr(36)`.
 */
const q = (s) => {
  if (s === null) return "NULL";
  const parts = String(s).split(DOLLAR).map((p) => `'${p.replace(/'/g, "''")}'`);
  return parts.length === 1 ? parts[0] : `(${parts.join(" || chr(36) || ")})`;
};

/** Same rule as slugify() in src/lib/university/access.ts (reused by the FAQ admin). */
const slug = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

// ─── Seed: copied verbatim from src/components/help/faq-page.tsx ────────────
const CATEGORIES = [
  {
    name: "Getting Started",
    icon: "Rocket",
    items: [
      [
        "What is SAM Plan AI?",
        "A revenue operating system that generates personalized annual plans with execution-ready project plans, then drives weekly accountability.",
      ],
      [
        "How does the plan get generated?",
        "You answer 7 questions about your business (revenue goal, products, what\u2019s worked, audience, assets, budget, obstacles). The AI selects 6\u201310 initiatives from our library, calculates revenue projections, and creates project plans.",
      ],
      [
        "What\u2019s the difference between Quickstart and Full Plan?",
        "Quickstart asks ~3 questions for an instant rough plan. Full Plan asks all 7 for a tailored, higher-confidence result. You can always upgrade from Quickstart to Full later.",
      ],
      [
        "Can I change my plan after it\u2019s generated?",
        "Yes. You can add, remove, or swap initiatives from the library at any time. The plan is a living document, not a one-time artifact.",
      ],
    ],
  },
  {
    name: "Plans & Billing",
    icon: "CreditCard",
    items: [
      [
        "What are the subscription tiers?",
        `Starter (${DOLLAR}49/mo), Pro (${DOLLAR}149/mo), and Mastery (${DOLLAR}4,997/yr). Each tier adds more accountability and support.`,
      ],
      ["Is there a free trial?", "Yes, 14-day full-feature free trial. No credit card required to start."],
      [
        "What\u2019s the refund policy?",
        "30-day money-back guarantee. After 30 days, no refunds on monthly; annual plans are prorated.",
      ],
    ],
  },
  {
    name: "Features",
    icon: "Layers",
    items: [
      [
        "What are Good/Better/Best revenue scenarios?",
        "Three projection levels based on conversion benchmarks: Good (conservative), Better (moderate), Best (aggressive). They show the range of possible outcomes for your plan.",
      ],
      [
        "How does the weekly operating cadence work?",
        "Each week you: (1) Enter results, (2) See where you are vs plan, (3) See what\u2019s due/slipping, (4) Adjust if needed, (5) Set top 1\u20133 priorities.",
      ],
      [
        "What initiative types are available?",
        "9 core types in v1: Webinar, Email Campaign, LinkedIn Outreach, Referral Program, Challenge/Bootcamp, VSL/Sales Page, Paid Ads, Sales Calls, Content & Organic Social.",
      ],
      [
        "Where do the benchmarks come from?",
        "First-party data from real businesses, partner-shared anonymized data, and published industry reports. Never invented.",
      ],
    ],
  },
  {
    name: "Data & Privacy",
    icon: "ShieldCheck",
    items: [
      [
        "What data do you share?",
        "Only anonymized, aggregated conversion rates. Never your company name, revenue, or identifiable information.",
      ],
      ["Can I opt out of benchmark sharing?", "Yes. Toggle it off in Settings \u2192 Benchmarks at any time."],
      [
        "Is my data secure?",
        "Yes. We use industry-standard encryption. When Supabase is connected, Row Level Security ensures only you see your data.",
      ],
    ],
  },
];

const EXPECTED_ITEMS = CATEGORIES.reduce((n, c) => n + c.items.length, 0);

// Slugs are UNIQUE across all items; fail now rather than in the SQL editor.
const itemSlugs = CATEGORIES.flatMap((c) => c.items.map(([question]) => slug(question)));
const duplicateSlugs = itemSlugs.filter((s, i) => itemSlugs.indexOf(s) !== i);

const categoryRows = CATEGORIES.map(
  (c, i) => `  (${q(slug(c.name))}, ${q(c.name)}, ${q(c.icon)}, ${(i + 1) * 10}, TRUE)`
).join(",\n");

const itemRows = CATEGORIES.flatMap((c) =>
  c.items.map(
    ([question, answer], j) =>
      `  (${q(slug(question))}, ${q(slug(c.name))}, ${q(question)},\n   ${q(answer)}, ${(j + 1) * 10})`
  )
).join(",\n");

const sql = `-- ============================================================
-- FAQ — admin-managed help content
--
-- Replaces the questions hardcoded in src/components/help/faq-page.tsx with
-- data edited at Admin -> Content -> FAQ.
--
-- NO PLAN GATING. FAQs are help content: every signed-in user sees every
-- published item in a published category. Drafts are never shown.
--
-- ANSWERS ARE PLAIN TEXT. The app renders them as text with line breaks kept
-- (http/https urls become links); no HTML or markdown is ever interpreted.
--
-- GENERATED by scripts/gen-migration-039.mjs. Edit that, not this.
-- SAFE TO RE-RUN: every statement is guarded and the seed never overwrites
-- anything an admin has changed.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Categories.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faq_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
    CHECK (char_length(name) BETWEEN 1 AND 100),
  -- A lucide-react icon name. The allow-list lives in TypeScript
  -- (FAQ_ICONS in src/types/faq.types.ts), so adding one is a code change.
  icon TEXT,
  display_order INT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE faq_categories IS
  'FAQ sections. Unpublished categories, and categories with no published items, are hidden from customers.';

-- ------------------------------------------------------------
-- 2. Items.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  category_id UUID NOT NULL REFERENCES faq_categories(id) ON DELETE CASCADE,
  question TEXT NOT NULL
    CHECK (char_length(question) BETWEEN 1 AND 300),
  -- Plain text. Blank lines separate paragraphs.
  answer TEXT NOT NULL
    CHECK (char_length(answer) BETWEEN 1 AND 5000),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Who last changed it. No FK: deleting an admin must not touch the FAQ.
  updated_by UUID
);

COMMENT ON TABLE faq_items IS
  'FAQ questions and plain-text answers. Only status = published is shown to customers.';

CREATE INDEX IF NOT EXISTS idx_faq_items_category
  ON faq_items(category_id);
CREATE INDEX IF NOT EXISTS idx_faq_items_category_order
  ON faq_items(category_id, display_order);

-- ------------------------------------------------------------
-- 3. updated_at maintenance, using update_updated_at() from migration 001.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON faq_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON faq_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON faq_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON faq_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 4. RLS: ENABLED, with NO policies for anon or authenticated.
--
-- Same pattern as SAM University (038). Drafts must not be readable straight
-- from the REST API, so all access goes through service-role API routes:
-- /api/faq (published only, via buildPublicFaq in src/lib/faq/faq.ts) and
-- /api/admin/faq/** (requireAdmin). anon and authenticated get zero rows.
-- ------------------------------------------------------------
ALTER TABLE faq_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE faq_items ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 5. SEED — the hardcoded FAQ from faq-page.tsx, verbatim, all published.
--
-- Some answers are out of date (prices, trial length, question count).
-- They are seeded as-is on purpose; edit them in the admin screen.
--
-- ON CONFLICT DO NOTHING on stable slugs, so re-running never overwrites an
-- admin's edits. chr(36) is a dollar sign, kept out of this file literally.
-- ------------------------------------------------------------
INSERT INTO faq_categories (slug, name, icon, display_order, is_published)
VALUES
${categoryRows}
ON CONFLICT (slug) DO NOTHING;

INSERT INTO faq_items (slug, category_id, question, answer, status, display_order)
SELECT v.slug, c.id, v.question, v.answer, 'published', v.display_order
FROM (VALUES
${itemRows}
) AS v(slug, category_slug, question, answer, display_order)
JOIN faq_categories c ON c.slug = v.category_slug
ON CONFLICT (slug) DO NOTHING;
`;

const path = "supabase/migrations/039_faq.sql";
writeFileSync(path, sql, "utf8");

/** Verified by reading the file BACK OFF DISK — only a re-read proves what will be pasted. */
const written = readFileSync(path, "utf8");

const dollars = written.split(DOLLAR).length - 1;
const has = (s) => written.includes(s);

const checks = {
  "creates faq_categories": has("CREATE TABLE IF NOT EXISTS faq_categories"),
  "creates faq_items": has("CREATE TABLE IF NOT EXISTS faq_items"),
  "name length check": has("CHECK (char_length(name) BETWEEN 1 AND 100)"),
  "question length check": has("CHECK (char_length(question) BETWEEN 1 AND 300)"),
  "answer length check": has("CHECK (char_length(answer) BETWEEN 1 AND 5000)"),
  "status check": has("CHECK (status IN ('draft', 'published'))"),
  "category FK cascades": has("REFERENCES faq_categories(id) ON DELETE CASCADE"),
  "category index": has("ON faq_items(category_id);"),
  "category+order index": has("ON faq_items(category_id, display_order);"),
  "updated_at trigger (categories)": has("CREATE TRIGGER set_updated_at BEFORE UPDATE ON faq_categories"),
  "updated_at trigger (items)": has("CREATE TRIGGER set_updated_at BEFORE UPDATE ON faq_items"),
  "RLS on categories": has("ALTER TABLE faq_categories ENABLE ROW LEVEL SECURITY;"),
  "RLS on items": has("ALTER TABLE faq_items ENABLE ROW LEVEL SECURITY;"),
  "no policies created": !/CREATE POLICY/i.test(written),
  "seed is idempotent": (written.match(/^ON CONFLICT \(slug\) DO NOTHING;/gm) || []).length === 2,
  "4 category rows": (categoryRows.match(/^ {2}\(/gm) || []).length === 4,
  [`${EXPECTED_ITEMS} item rows`]: (itemRows.match(/^ {2}\(/gm) || []).length === EXPECTED_ITEMS,
  "item slugs unique": duplicateSlugs.length === 0,
  "seed rows published": has("v.answer, 'published', v.display_order"),
  "prices via chr(36)": has("'Starter (' || chr(36) || '49/mo), Pro ('"),
  "apostrophes kept (curly)": has("What\u2019s the refund policy?"),
};

console.log(`\nWrote ${path}`);
console.log(`  dollar signs          : ${dollars} (expect 0)`);
for (const [label, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? "ok    " : "FAILED"} ${label}`);
}
if (duplicateSlugs.length) console.log(`  duplicate slugs: ${duplicateSlugs.join(", ")}`);

const ok = dollars === 0 && Object.values(checks).every(Boolean);
console.log(ok ? "\nOK — safe to run in the SQL editor.\n" : "\nBROKEN — do not run.\n");
process.exit(ok ? 0 : 1);
