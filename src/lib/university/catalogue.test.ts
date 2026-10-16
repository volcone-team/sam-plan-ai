import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMissingTableError,
  loadCatalogueForUser,
  UniversityMigrationMissingError,
  type UniversityCatalogueResponse,
} from "./catalogue";
import type {
  UniversityCategoryRow,
  UniversityResourcePlanRow,
  UniversityResourceRow,
  UniversityStatus,
} from "@/types/university.types";

// ─── Fake Supabase ───────────────────────────────────────────────────────────
//
// An in-memory stand-in for the parts of supabase-js the loader (and the real
// loadCompanyAccess under it) uses: from().select().eq()/.neq()/.order(), then
// await or .maybeSingle(). Filters are really applied, so the test also proves
// drafts are filtered and the right subscription row is picked.

type Row = Record<string, unknown>;
interface FakeError { code: string; message: string }
/** `object`, not `Row`: typed row interfaces have no index signature. */
interface FakeTables { [table: string]: readonly object[] }

function fakeDb(tables: FakeTables, errors: Record<string, FakeError> = {}): SupabaseClient {
  function builder(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let orderBy: string | null = null;
    const result = () => {
      if (errors[table]) return { data: null, error: errors[table] };
      let rows = ((tables[table] ?? []) as readonly Row[]).filter((r) => filters.every((f) => f(r)));
      if (orderBy) {
        const key = orderBy;
        rows = [...rows].sort((a, b) => Number(a[key] ?? 0) - Number(b[key] ?? 0));
      }
      return { data: rows, error: null };
    };
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b; },
      neq: (col: string, val: unknown) => { filters.push((r) => r[col] !== val); return b; },
      order: (col: string) => { orderBy = col; return b; },
      maybeSingle: async () => {
        const r = result();
        return { data: r.data ? r.data[0] ?? null : null, error: r.error };
      },
      then: <T>(resolve: (v: ReturnType<typeof result>) => T) => Promise.resolve(result()).then(resolve),
    };
    return b;
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const STARTER = "11111111-0000-4000-8000-000000000001";
const PRO = "22222222-0000-4000-8000-000000000002";
const RETIRED = "33333333-0000-4000-8000-000000000003";
const COMPANY = "44444444-0000-4000-8000-000000000004";
const CAT = "55555555-0000-4000-8000-000000000005";
const TS = "2026-01-01T00:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

const PLANS: Row[] = [
  { id: PRO, name: "Pro", is_active: true, display_order: 2 },
  { id: STARTER, name: "Starter", is_active: true, display_order: 1 },
  { id: RETIRED, name: "Legacy", is_active: false, display_order: 3 },
];

function category(id = CAT, published = true): UniversityCategoryRow {
  return {
    id, slug: `c-${id}`, name: `Cat ${id.slice(0, 4)}`, description: null, icon: "BookOpen",
    display_order: 0, is_published: published, created_at: TS, updated_at: TS,
  };
}

function resource(
  n: number,
  opts: { status: UniversityStatus; isFree: boolean; categoryId?: string }
): UniversityResourceRow {
  return {
    id: `r-${n}`, slug: `r-${n}`, category_id: opts.categoryId ?? CAT, title: `Resource ${n}`,
    description: null, resource_type: "video",
    url: opts.status === "coming_soon" && n % 2 === 0 ? null : `https://secret.example.com/content-${n}`,
    duration_minutes: 5, status: opts.status, is_free: opts.isFree, display_order: n,
    created_at: TS, updated_at: TS, updated_by: null,
  };
}

function subscription(planId: string | null, status = "active"): Row {
  return {
    company_id: COMPANY, plan_id: planId, status, stripe_status: status, is_comped: false,
    comped_until: null, trial_ends_at: null, current_period_start: TS, current_period_end: FUTURE,
    past_due_since: null, cancel_at_period_end: false, is_paused: false, pause_resumes_at: null,
  };
}

function tables(opts: {
  resources: UniversityResourceRow[];
  links: UniversityResourcePlanRow[];
  sub: Row | null;
  stripeEnabled?: boolean;
  categories?: UniversityCategoryRow[];
}): FakeTables {
  return {
    app_settings: [{
      id: "global", stripe_enabled: opts.stripeEnabled ?? true, trial_enabled: true, trial_days: 14,
      trial_plan_id: null, trial_requires_card: false, dunning_grace_days: 7,
    }],
    subscriptions: opts.sub ? [opts.sub] : [],
    university_categories: opts.categories ?? [category()],
    university_resources: opts.resources,
    university_resource_plans: opts.links,
    subscription_plans: PLANS,
  };
}

/** One of each: free published, Pro-only published, Pro-only coming soon, draft. */
const BASIC_RESOURCES = [
  resource(1, { status: "published", isFree: true }),
  resource(2, { status: "published", isFree: false }),
  resource(3, { status: "coming_soon", isFree: false }),
  resource(4, { status: "draft", isFree: true }),
];
const BASIC_LINKS: UniversityResourcePlanRow[] = [
  { resource_id: "r-2", plan_id: PRO },
  { resource_id: "r-2", plan_id: RETIRED },
  { resource_id: "r-3", plan_id: PRO },
];

const allViews = (res: UniversityCatalogueResponse) => res.categories.flatMap((c) => c.resources);
const view = (res: UniversityCatalogueResponse, id: string) => allViews(res).find((v) => v.id === id);

async function load(t: FakeTables, isAdmin = false, companyId: string | null = COMPANY) {
  return loadCatalogueForUser(fakeDb(t), { companyId, isAdmin });
}

// ─── Examples ────────────────────────────────────────────────────────────────

describe("loadCatalogueForUser", () => {
  it("Starter viewer: Pro-only items are locked teasers and no locked url is serialised", async () => {
    const res = await load(tables({ resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: subscription(STARTER) }));
    const json = JSON.stringify(res);

    expect(view(res, "r-2")).toMatchObject({ locked: true, url: null, unlockPlanNames: ["Pro"] });
    expect(view(res, "r-3")).toMatchObject({ locked: true, url: null });
    expect(json).not.toContain("content-2");
    expect(json).not.toContain("content-3");
    expect(view(res, "r-1")).toMatchObject({ locked: false, url: "https://secret.example.com/content-1" });
    expect(res.viewer).toEqual({ planName: "Starter", hasPaidPlan: true, isAdmin: false });
  });

  it("Pro viewer: published items carry their url; coming_soon never does", async () => {
    const res = await load(tables({ resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: subscription(PRO) }));
    expect(view(res, "r-2")).toMatchObject({ locked: false, url: "https://secret.example.com/content-2" });
    expect(view(res, "r-3")).toMatchObject({ locked: false, url: null, status: "coming_soon" });
    expect(JSON.stringify(res)).not.toContain("content-3");
    expect(res.viewer.planName).toBe("Pro");
  });

  it("no plan: free items only", async () => {
    const res = await load(tables({ resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: null }));
    expect(view(res, "r-1")?.locked).toBe(false);
    expect(view(res, "r-2")).toMatchObject({ locked: true, url: null });
    expect(res.viewer).toEqual({ planName: null, hasPaidPlan: false, isAdmin: false });
  });

  it("plan present but access not allowed (cancelled): free items only, hasPaidPlan false", async () => {
    const res = await load(tables({ resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: subscription(PRO, "canceled") }));
    expect(view(res, "r-2")).toMatchObject({ locked: true, url: null });
    expect(res.viewer.hasPaidPlan).toBe(false);
  });

  it("no company at all: free items only", async () => {
    const res = await load(tables({ resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: null }), false, null);
    expect(view(res, "r-2")?.locked).toBe(true);
  });

  it("super admin: everything unlocked, even with no plan", async () => {
    const res = await load(tables({ resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: null }), true);
    expect(allViews(res).every((v) => !v.locked)).toBe(true);
    expect(view(res, "r-2")?.url).toBe("https://secret.example.com/content-2");
    expect(res.viewer.isAdmin).toBe(true);
  });

  it("billing disabled: everything unlocked", async () => {
    const res = await load(tables({ resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: null, stripeEnabled: false }));
    expect(allViews(res).every((v) => !v.locked)).toBe(true);
  });

  it("drafts are absent, even for an admin", async () => {
    const res = await load(tables({ resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: null }), true);
    expect(view(res, "r-4")).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain("content-4");
  });

  it("a retired plan is not named in unlockPlanNames but still unlocks for its subscribers", async () => {
    const starter = await load(tables({ resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: subscription(STARTER) }));
    expect(view(starter, "r-2")?.unlockPlanNames).toEqual(["Pro"]);

    const legacy = await load(tables({ resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: subscription(RETIRED) }));
    expect(view(legacy, "r-2")).toMatchObject({ locked: false, url: "https://secret.example.com/content-2" });
    expect(legacy.viewer.planName).toBe("Legacy");
  });

  it("names unlock plans in plan display order", async () => {
    const links: UniversityResourcePlanRow[] = [
      { resource_id: "r-2", plan_id: PRO },
      { resource_id: "r-2", plan_id: STARTER },
    ];
    const res = await load(tables({ resources: BASIC_RESOURCES, links, sub: null }));
    expect(view(res, "r-2")?.unlockPlanNames).toEqual(["Starter", "Pro"]);
  });

  it("hides unpublished categories", async () => {
    const res = await load(tables({
      resources: BASIC_RESOURCES, links: BASIC_LINKS, sub: null, categories: [category(CAT, false)],
    }), true);
    expect(res.categories).toEqual([]);
  });

  it.each([
    { code: "PGRST205", message: "Could not find the table 'public.university_resources' in the schema cache" },
    { code: "42P01", message: 'relation "university_resources" does not exist' },
    { code: "", message: "Could not find the table 'public.university_categories'" },
  ])("missing table ($code) → UniversityMigrationMissingError", async (error) => {
    const db = fakeDb(tables({ resources: [], links: [], sub: null }), { university_resources: error });
    await expect(loadCatalogueForUser(db, { companyId: COMPANY, isAdmin: false }))
      .rejects.toBeInstanceOf(UniversityMigrationMissingError);
  });

  it("any other error is a plain Error, not a migration error", async () => {
    const db = fakeDb(tables({ resources: [], links: [], sub: null }), {
      university_resource_plans: { code: "57014", message: "canceling statement due to statement timeout" },
    });
    const p = loadCatalogueForUser(db, { companyId: COMPANY, isAdmin: false });
    await expect(p).rejects.toThrow(/timeout/);
    await expect(p).rejects.not.toBeInstanceOf(UniversityMigrationMissingError);
  });
});

describe("isMissingTableError", () => {
  it("recognises the codes and message, and nothing else", () => {
    expect(isMissingTableError({ code: "PGRST205", message: "x" })).toBe(true);
    expect(isMissingTableError({ code: "42P01", message: "x" })).toBe(true);
    expect(isMissingTableError({ message: "Could not find the table 'public.x'" })).toBe(true);
    expect(isMissingTableError({ code: "PGRST204", message: "Could not find the 'x' column" })).toBe(false);
    expect(isMissingTableError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
  });
});

// ─── Seeded generator ────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("loadCatalogueForUser — seeded invariant: a url reaches the response only if published and unlocked", () => {
  const STATUSES: UniversityStatus[] = ["draft", "coming_soon", "published"];
  const PLAN_IDS = [STARTER, PRO, RETIRED];

  it("holds across 300 random catalogues and viewers", async () => {
    const rnd = mulberry32(0x5a11);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];

    for (let iter = 0; iter < 300; iter++) {
      const count = 1 + Math.floor(rnd() * 12);
      const resources: UniversityResourceRow[] = [];
      const links: UniversityResourcePlanRow[] = [];
      for (let i = 0; i < count; i++) {
        const n = iter * 100 + i;
        const r = resource(n, { status: pick(STATUSES), isFree: rnd() < 0.3 });
        if (r.status === "published" && r.url === null) r.url = `https://secret.example.com/content-${n}`;
        resources.push(r);
        if (!r.is_free) for (const p of PLAN_IDS) if (rnd() < 0.4) links.push({ resource_id: r.id, plan_id: p });
      }

      const isAdmin = rnd() < 0.15;
      const stripeEnabled = rnd() < 0.85;
      const planId = rnd() < 0.2 ? null : pick(PLAN_IDS);
      const status = pick(["active", "active", "canceled"] as const);
      const sub = rnd() < 0.15 ? null : subscription(planId, status);

      const res = await load(tables({ resources, links, sub, stripeEnabled }), isAdmin);
      const json = JSON.stringify(res);
      const allowed = sub !== null && (status === "active");
      const ctx = JSON.stringify({ iter, isAdmin, stripeEnabled, planId, status, hasSub: sub !== null });

      for (const r of resources) {
        const plans = links.filter((l) => l.resource_id === r.id).map((l) => l.plan_id);
        const unlocked =
          isAdmin || !stripeEnabled || r.is_free ||
          (allowed && sub?.plan_id != null && plans.includes(sub.plan_id as string));
        const v = view(res, r.id);

        if (r.status === "draft") {
          expect(v, `draft present ${ctx}`).toBeUndefined();
        } else {
          expect(v?.locked, `locked ${r.id} ${ctx}`).toBe(!unlocked);
        }
        const mayLeak = r.status === "published" && unlocked;
        if (r.url && !mayLeak) expect(json.includes(r.url), `leaked ${r.id} ${ctx}`).toBe(false);
        if (mayLeak) expect(v?.url).toBe(r.url);
        // Retired plans are never advertised.
        if (v) expect(v.unlockPlanNames).not.toContain("Legacy");
      }
    }
  });
});
