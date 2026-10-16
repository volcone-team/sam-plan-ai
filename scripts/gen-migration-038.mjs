/**
 * Generates migration 038 — SAM University (categories, resources, plan gating).
 *
 * A GENERATOR, not a hand-written .sql file, to match 028/029/035/037. This
 * migration deliberately contains NO dollar-quoting at all: there are no DO
 * blocks and no functions, and RLS needs no policies. The read-back check
 * below asserts exactly that, so a future edit that sneaks in a `$$` body (or
 * a stray `$` mangled by PowerShell / String.replace) fails loudly here rather
 * than in the SQL editor.
 *
 * The seed data is built from a JS array (today's 15 hardcoded modules from
 * src/components/help/sam-university.tsx) so the titles, order and access are
 * reviewable in one place and escaped consistently.
 *
 * Run: node scripts/gen-migration-038.mjs
 */
import { writeFileSync, readFileSync } from "node:fs";

/** SQL string literal: single quotes doubled. Values here are our own constants. */
const q = (s) => (s === null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

/** Same rule as slugify() in src/lib/university/access.ts. */
const slug = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

/**
 * access: "free" -> is_free = TRUE.
 *         "pro"  -> is_free = FALSE plus a row for the plan named exactly 'Pro'.
 * Mastery modules are "pro": there is no Mastery plan, and there is no ranking.
 */
const CATEGORIES = [
  {
    name: "Getting Started",
    icon: "BookOpen",
    access: "free",
    modules: [
      ["Building Your First Plan", "How to complete the questionnaire and generate your revenue plan", 8],
      ["Understanding Your Initiatives", "How initiatives work, types, and what each one means", 12],
      ["Navigating Your Dashboard", "Tour of the Year-at-a-Glance and planning views", 6],
    ],
  },
  {
    name: "Initiative Strategy",
    icon: "GraduationCap",
    access: "pro",
    modules: [
      ["Choosing the Right Initiatives", "How to select initiatives based on your business stage", 15],
      ["Revenue Scenarios Explained", "What Good, Better, Best mean and how to use them", 10],
      ["Matching Difficulty to Your Team", "Understanding the 4 difficulty dimensions", 12],
    ],
  },
  {
    name: "Revenue Projections",
    icon: "BarChart3",
    access: "pro",
    modules: [
      ["How Benchmarks Work", "Where our benchmark data comes from and what drives accuracy", 10],
      ["Reading Your Projections", "Interpreting monthly, quarterly, and annual projections", 8],
      ["Budget vs Actuals", "Tracking spend against projections", 12],
    ],
  },
  {
    name: "Weekly Cadence",
    icon: "CalendarCheck",
    access: "pro",
    modules: [
      ["The 5-Step Weekly Operating Loop", "Enter results, see where you are, what's moving, adjust, prioritize", 15],
      ["Entering Weekly Results", "How to log revenue and spend each week", 8],
      ["Setting Effective Priorities", "How to pick your top 1-3 each week", 10],
    ],
  },
  {
    name: "Advanced (Mastery)",
    icon: "Sparkles",
    access: "pro",
    modules: [
      ["Quarterly Strategy Reviews", "How to reshape your plan each quarter", 20],
      ["Building Custom Initiatives", "Creating your own initiative types with benchmarks", 15],
      ["Data-Driven Plan Optimization", "Using actuals to refine projections and strategy", 18],
    ],
  },
];

const categoryRows = CATEGORIES.map(
  (c, i) => `  (${q(slug(c.name))}, ${q(c.name)}, ${q(c.icon)}, ${(i + 1) * 10}, TRUE)`
).join(",\n");

const resourceRows = CATEGORIES.flatMap((c) =>
  c.modules.map(
    ([title, description, minutes], j) =>
      `  (${q(slug(title))}, ${q(slug(c.name))}, ${q(title)}, ${q(description)}, ${minutes}, ${c.access === "free" ? "TRUE" : "FALSE"}, ${(j + 1) * 10})`
  )
).join(",\n");

const proSlugs = CATEGORIES.filter((c) => c.access === "pro")
  .flatMap((c) => c.modules.map(([title]) => `    ${q(slug(title))}`))
  .join(",\n");

const EXPECTED_RESOURCES = CATEGORIES.reduce((n, c) => n + c.modules.length, 0);
const EXPECTED_PRO = CATEGORIES.filter((c) => c.access === "pro").reduce((n, c) => n + c.modules.length, 0);

const sql = `-- ============================================================
-- SAM UNIVERSITY — training catalogue with per-plan gating
--
-- Replaces the 15 modules hardcoded in src/components/help/sam-university.tsx
-- with admin-managed data.
--
-- GATING HAS NO RANKING. Each resource is EITHER free for everyone
-- (is_free = TRUE) OR restricted to an explicit list of plans in
-- university_resource_plans. "Pro includes Starter" is never inferred: plans
-- are named products whose contents change, and a ranking would have to be
-- maintained alongside them and would drift.
--
-- CONTENT IS AN EXTERNAL URL ONLY (http/https). No uploads, no storage bucket.
--
-- STATUS:
--   draft        never shown to customers.
--   coming_soon  shown as a card with NO url, even when unlocked.
--   published    shown; url sent only when the viewer is entitled.
-- A published row must have a url (CHECK below), so "published but empty"
-- cannot exist.
--
-- GENERATED by scripts/gen-migration-038.mjs. Edit that, not this.
-- SAFE TO RE-RUN: every statement is guarded and the seed never overwrites
-- anything an admin has changed.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Categories.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS university_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  -- A lucide-react icon name. The allow-list lives in TypeScript
  -- (UNIVERSITY_ICONS in src/types/university.types.ts), not here, so adding
  -- an icon is a code change and never another hand-run migration.
  icon TEXT,
  display_order INT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE university_categories IS
  'SAM University sections. Unpublished categories, and categories with no visible resources, are hidden from customers.';

-- ------------------------------------------------------------
-- 2. Resources.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS university_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  category_id UUID NOT NULL REFERENCES university_categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  resource_type TEXT NOT NULL
    CHECK (resource_type IN ('video', 'article', 'pdf', 'link')),
  -- External content only. The scheme check is the database's last line of
  -- defence against javascript: / data: links; the admin API validates first.
  url TEXT
    CHECK (url IS NULL OR url ~* '^https?://'),
  duration_minutes INT
    CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'coming_soon', 'published')),
  -- FALSE plus no plan rows means admins only. That is the safe default for a
  -- row created half-configured.
  is_free BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Who last changed it. No FK, as in initiative_settings: deleting an admin
  -- must not touch the catalogue.
  updated_by UUID,
  CONSTRAINT university_resources_published_needs_url
    CHECK (status <> 'published' OR url IS NOT NULL)
);

COMMENT ON TABLE university_resources IS
  'SAM University items. Gated by is_free OR university_resource_plans. The url of a locked or coming_soon item is never sent to a customer.';
COMMENT ON COLUMN university_resources.is_free IS
  'TRUE: visible and unlocked for everyone. FALSE: unlocked only for plans listed in university_resource_plans (and super admins).';

CREATE INDEX IF NOT EXISTS idx_university_resources_category
  ON university_resources(category_id);
CREATE INDEX IF NOT EXISTS idx_university_resources_category_order
  ON university_resources(category_id, display_order);

-- ------------------------------------------------------------
-- 3. Which plans unlock a non-free resource.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS university_resource_plans (
  resource_id UUID NOT NULL REFERENCES university_resources(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
  PRIMARY KEY (resource_id, plan_id)
);

COMMENT ON TABLE university_resource_plans IS
  'Explicit plan list for a non-free resource. No ranking: a plan unlocks exactly the rows listed here. Ignored when is_free is TRUE.';

-- ------------------------------------------------------------
-- 4. updated_at maintenance, using update_updated_at() from migration 001
--    (the same function subscription_plans uses since 004).
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at ON university_categories;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON university_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON university_resources;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON university_resources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 5. RLS: ENABLED, with NO policies for anon or authenticated.
--
-- WHY NO READ POLICY. The url of a locked resource is the paid content itself.
-- Any SELECT policy for authenticated users would let a Starter customer read
-- every url straight from the REST API with their own session, bypassing the
-- teaser logic entirely — RLS cannot express "return the row but null one
-- column unless the plan matches". So all access goes through service-role
-- API routes, which apply canAccessResource / toResourceView
-- (src/lib/university/access.ts) and strip urls before anything leaves the
-- server. With RLS on and no policies, anon and authenticated get zero rows.
-- ------------------------------------------------------------
ALTER TABLE university_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE university_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE university_resource_plans ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 6. SEED — today's 15 hardcoded modules, same 5 categories, same order.
--
-- All coming_soon with no url: the videos are still in production.
-- Free modules -> is_free. Pro and Mastery modules -> the plan named exactly
-- 'Pro', looked up BY NAME (ids differ between environments). If no such plan
-- exists, no plan rows are inserted and those modules stay admin-only until
-- an admin assigns plans.
--
-- ON CONFLICT DO NOTHING on stable slugs, so re-running never overwrites an
-- admin's edits. To change content, use the admin screen, not this file.
-- ------------------------------------------------------------
INSERT INTO university_categories (slug, name, icon, display_order, is_published)
VALUES
${categoryRows}
ON CONFLICT (slug) DO NOTHING;

INSERT INTO university_resources (
  slug, category_id, title, description, resource_type, url,
  duration_minutes, status, is_free, display_order
)
SELECT v.slug, c.id, v.title, v.description, 'video', NULL,
       v.minutes, 'coming_soon', v.is_free, v.display_order
FROM (VALUES
${resourceRows}
) AS v(slug, category_slug, title, description, minutes, is_free, display_order)
JOIN university_categories c ON c.slug = v.category_slug
ON CONFLICT (slug) DO NOTHING;

/*
 * Plan rows only for seeded, non-free resources that have NO plan rows yet.
 * The NOT EXISTS guard means a re-run cannot re-add Pro to a resource an admin
 * has since moved to a different plan.
 */
INSERT INTO university_resource_plans (resource_id, plan_id)
SELECT r.id, p.id
FROM university_resources r
JOIN subscription_plans p ON p.name = 'Pro'
WHERE r.is_free = FALSE
  AND r.slug IN (
${proSlugs}
  )
  AND NOT EXISTS (
    SELECT 1 FROM university_resource_plans x WHERE x.resource_id = r.id
  )
ON CONFLICT DO NOTHING;
`;

const path = "supabase/migrations/038_sam_university.sql";
writeFileSync(path, sql, "utf8");

/**
 * Verified by reading the file BACK OFF DISK, not by inspecting the string we
 * just built — only a re-read proves what will actually be pasted.
 */
const written = readFileSync(path, "utf8");

const pairs = (written.match(/\$\$/g) || []).length;
const lone = (written.replace(/\$\$/g, "").match(/\$/g) || []).length;
const has = (s) => written.includes(s);

const checks = {
  "creates university_categories": has("CREATE TABLE IF NOT EXISTS university_categories"),
  "creates university_resources": has("CREATE TABLE IF NOT EXISTS university_resources"),
  "creates university_resource_plans": has("CREATE TABLE IF NOT EXISTS university_resource_plans"),
  "resource_type check": has("CHECK (resource_type IN ('video', 'article', 'pdf', 'link'))"),
  "url scheme check": has("CHECK (url IS NULL OR url ~* '^https?://')"),
  "duration check": has("CHECK (duration_minutes IS NULL OR duration_minutes >= 0)"),
  "status check": has("CHECK (status IN ('draft', 'coming_soon', 'published'))"),
  "published needs url": has("CHECK (status <> 'published' OR url IS NOT NULL)"),
  "composite primary key": has("PRIMARY KEY (resource_id, plan_id)"),
  "category index": has("ON university_resources(category_id);"),
  "category+order index": has("ON university_resources(category_id, display_order);"),
  "RLS on categories": has("ALTER TABLE university_categories ENABLE ROW LEVEL SECURITY;"),
  "RLS on resources": has("ALTER TABLE university_resources ENABLE ROW LEVEL SECURITY;"),
  "RLS on resource_plans": has("ALTER TABLE university_resource_plans ENABLE ROW LEVEL SECURITY;"),
  "no policies created": !/CREATE POLICY/i.test(written),
  "Pro looked up by name": has("JOIN subscription_plans p ON p.name = 'Pro'"),
  "no hardcoded plan ids": !/de1815a6|90a5b85c|99ddd34b/i.test(written),
  "seed is idempotent": (written.match(/^ON CONFLICT/gm) || []).length === 3,
  "seed rows all coming_soon": has("'coming_soon', v.is_free"),
  [`${EXPECTED_RESOURCES} resource rows`]:
    (resourceRows.match(/^ {2}\(/gm) || []).length === EXPECTED_RESOURCES,
  [`${EXPECTED_PRO} Pro slugs`]: (proSlugs.match(/'/g) || []).length === EXPECTED_PRO * 2,
  "apostrophe escaped": has("what''s moving"),
};

console.log(`\nWrote ${path}`);
console.log(`  dollar-quote pairs    : ${pairs} (expect 0)`);
console.log(`  stray single $        : ${lone} (expect 0)`);
for (const [label, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? "ok    " : "FAILED"} ${label}`);
}

const ok = pairs === 0 && lone === 0 && Object.values(checks).every(Boolean);

console.log(ok ? "\nOK — safe to run in the SQL editor.\n" : "\nBROKEN — do not run.\n");

process.exit(ok ? 0 : 1);
