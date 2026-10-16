import { describe, it, expect } from "vitest";
import {
  canAccessResource,
  toResourceView,
  buildCustomerCatalogue,
  normaliseResourceInput,
  normaliseCategoryInput,
  normaliseExternalUrl,
  slugify,
  uniqueSlug,
  videoEmbedUrl,
  categoryFromRow,
  resourceFromRow,
  groupPlanIds,
} from "./access";
import {
  UNIVERSITY_RESOURCE_TYPES,
  UNIVERSITY_STATUSES,
  type UniversityCategory,
  type UniversityResource,
  type UniversityStatus,
  type UniversityViewer,
} from "@/types/university.types";

// ─── Seeded generator (mulberry32) ───────────────────────────────────────────

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

const STARTER = "de1815a6-0000-4000-8000-000000000001";
const PRO = "90a5b85c-0000-4000-8000-000000000002";
const ADMIN_PLAN = "99ddd34b-0000-4000-8000-000000000003";
const PLAN_IDS = [STARTER, PRO, ADMIN_PLAN];
const PLANS = [
  { id: STARTER, name: "Starter" },
  { id: PRO, name: "Pro" },
];
const PLAN_NAMES = new Map(PLANS.map((p) => [p.id, p.name]));

const ITERATIONS = 500;

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)];
}

function genResource(rand: () => number, i: number, categoryId = "cat-1"): UniversityResource {
  const planIds = PLAN_IDS.filter(() => rand() < 0.4);
  const status = pick(rand, UNIVERSITY_STATUSES);
  return {
    id: `res-${i}`,
    slug: `res-${i}`,
    categoryId,
    title: `Resource ${i}`,
    description: rand() < 0.5 ? null : "desc",
    type: pick(rand, UNIVERSITY_RESOURCE_TYPES),
    url: status === "published" || rand() < 0.5 ? `https://example.com/${i}` : null,
    durationMinutes: rand() < 0.2 ? null : Math.floor(rand() * 60),
    status,
    isFree: rand() < 0.3,
    planIds,
    displayOrder: Math.floor(rand() * 5),
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    updatedBy: null,
  };
}

function genViewer(rand: () => number): UniversityViewer {
  return {
    isAdmin: rand() < 0.15,
    planId: rand() < 0.2 ? null : pick(rand, [...PLAN_IDS, "11111111-1111-4111-8111-111111111111"]),
    accessAllowed: rand() < 0.75,
    billingDisabled: rand() < 0.15,
  };
}

function resource(over: Partial<UniversityResource> = {}): UniversityResource {
  return {
    id: "r1",
    slug: "r1",
    categoryId: "c1",
    title: "Lesson",
    description: null,
    type: "video",
    url: "https://example.com/v",
    durationMinutes: 5,
    status: "published",
    isFree: false,
    planIds: [PRO],
    displayOrder: 0,
    createdAt: "",
    updatedAt: "",
    updatedBy: null,
    ...over,
  };
}

function category(over: Partial<UniversityCategory> = {}): UniversityCategory {
  return {
    id: "c1",
    slug: "c1",
    name: "Cat",
    description: null,
    icon: "BookOpen",
    displayOrder: 0,
    isPublished: true,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const CUSTOMER_PRO: UniversityViewer = { isAdmin: false, planId: PRO, accessAllowed: true, billingDisabled: false };
const CUSTOMER_STARTER: UniversityViewer = { ...CUSTOMER_PRO, planId: STARTER };
const NO_PLAN: UniversityViewer = { ...CUSTOMER_PRO, planId: null };
const LOCKED_OUT_PRO: UniversityViewer = { ...CUSTOMER_PRO, accessAllowed: false };
const ADMIN: UniversityViewer = { isAdmin: true, planId: null, accessAllowed: false, billingDisabled: false };
const BILLING_OFF: UniversityViewer = { isAdmin: false, planId: null, accessAllowed: true, billingDisabled: true };

// ─── Generated invariants ────────────────────────────────────────────────────

describe("university access — generated invariants", () => {
  it("a locked view never has a url, and only published+unlocked views do", () => {
    const rand = mulberry32(0x5a11);
    for (let i = 0; i < ITERATIONS; i++) {
      const r = genResource(rand, i);
      const v = genViewer(rand);
      const view = toResourceView(r, v, PLAN_NAMES);
      if (!view) continue;
      if (view.locked) expect(view.url, JSON.stringify({ r, v })).toBeNull();
      if (view.url !== null) {
        expect(view.locked).toBe(false);
        expect(view.status).toBe("published");
      }
      expect(view.locked).toBe(!canAccessResource(r, v));
    }
  });

  it("draft is never returned, and coming_soon never carries a url", () => {
    const rand = mulberry32(0xd4af7);
    for (let i = 0; i < ITERATIONS; i++) {
      const r = genResource(rand, i);
      const v = genViewer(rand);
      const view = toResourceView(r, v, PLAN_NAMES);
      if (r.status === "draft") expect(view).toBeNull();
      else expect(view).not.toBeNull();
      if (r.status === "coming_soon") expect(view?.url).toBeNull();
    }
  });

  it("the catalogue never contains drafts, empty categories or urls on locked items", () => {
    const rand = mulberry32(0xca7a);
    for (let i = 0; i < 100; i++) {
      const cats = [0, 1, 2].map((n) =>
        category({ id: `c${n}`, name: `Cat ${n}`, displayOrder: Math.floor(rand() * 3), isPublished: rand() < 0.8 })
      );
      const resources = Array.from({ length: 8 }, (_, j) => genResource(rand, i * 10 + j, `c${Math.floor(rand() * 3)}`));
      const viewer = genViewer(rand);
      const out = buildCustomerCatalogue(cats, resources, viewer, PLANS);

      const byId = new Map(resources.map((r) => [r.id, r]));
      for (const c of out) {
        expect(c.resources.length).toBeGreaterThan(0);
        expect(cats.find((x) => x.id === c.id)?.isPublished).toBe(true);
        for (const view of c.resources) {
          expect(byId.get(view.id)?.status).not.toBe("draft");
          if (view.locked) expect(view.url).toBeNull();
        }
      }
    }
  });

  it("a no-plan, non-admin viewer with billing on can open free items only", () => {
    const rand = mulberry32(0xf4ee);
    for (let i = 0; i < ITERATIONS; i++) {
      const r = genResource(rand, i);
      const v: UniversityViewer = { isAdmin: false, planId: null, accessAllowed: rand() < 0.5, billingDisabled: false };
      expect(canAccessResource(r, v)).toBe(r.isFree);
    }
  });

  it("admins and billing-disabled viewers can open everything", () => {
    const rand = mulberry32(0xad31);
    for (let i = 0; i < ITERATIONS; i++) {
      const r = genResource(rand, i);
      expect(canAccessResource(r, { ...genViewer(rand), isAdmin: true })).toBe(true);
      expect(canAccessResource(r, { ...genViewer(rand), isAdmin: false, billingDisabled: true })).toBe(true);
    }
  });
});

// ─── Examples ────────────────────────────────────────────────────────────────

describe("canAccessResource", () => {
  it("unlocks by explicit plan list with no ranking", () => {
    const proOnly = resource({ planIds: [PRO] });
    expect(canAccessResource(proOnly, CUSTOMER_PRO)).toBe(true);
    expect(canAccessResource(proOnly, CUSTOMER_STARTER)).toBe(false);
    expect(canAccessResource(resource({ planIds: [STARTER] }), CUSTOMER_PRO)).toBe(false);
  });

  it("free items are open to everyone, including no-plan and locked-out", () => {
    const free = resource({ isFree: true, planIds: [] });
    for (const v of [NO_PLAN, LOCKED_OUT_PRO, CUSTOMER_STARTER]) expect(canAccessResource(free, v)).toBe(true);
  });

  it("a locked-out account keeps free items only, even on a matching plan", () => {
    expect(canAccessResource(resource({ planIds: [PRO] }), LOCKED_OUT_PRO)).toBe(false);
  });

  it("not free with no plans is admin-only", () => {
    const orphan = resource({ planIds: [] });
    expect(canAccessResource(orphan, CUSTOMER_PRO)).toBe(false);
    expect(canAccessResource(orphan, ADMIN)).toBe(true);
    expect(canAccessResource(orphan, BILLING_OFF)).toBe(true);
  });
});

describe("toResourceView", () => {
  it("builds a teaser for a locked item, naming the plans in plan order", () => {
    const view = toResourceView(resource({ planIds: [PRO, STARTER, ADMIN_PLAN] }), NO_PLAN, PLAN_NAMES);
    expect(view).toMatchObject({ locked: true, url: null, unlockPlanNames: ["Starter", "Pro"], isFree: false });
  });

  it("sends the url only for published and unlocked", () => {
    expect(toResourceView(resource(), CUSTOMER_PRO, PLAN_NAMES)?.url).toBe("https://example.com/v");
    expect(toResourceView(resource(), CUSTOMER_STARTER, PLAN_NAMES)?.url).toBeNull();
    const soon = resource({ status: "coming_soon" });
    expect(toResourceView(soon, ADMIN, PLAN_NAMES)).toMatchObject({ locked: false, url: null, status: "coming_soon" });
  });

  it("drafts are null even for admins (they use the admin API)", () => {
    expect(toResourceView(resource({ status: "draft" }), ADMIN, PLAN_NAMES)).toBeNull();
  });

  it("free items have no unlock plan names", () => {
    expect(toResourceView(resource({ isFree: true, planIds: [PRO] }), NO_PLAN, PLAN_NAMES)?.unlockPlanNames).toEqual([]);
  });
});

describe("buildCustomerCatalogue", () => {
  it("hides unpublished and empty categories and sorts by order then name/title", () => {
    const cats = [
      category({ id: "b", name: "B", displayOrder: 1 }),
      category({ id: "a", name: "A", displayOrder: 1 }),
      category({ id: "first", name: "Z", displayOrder: 0 }),
      category({ id: "hidden", name: "Hidden", isPublished: false }),
      category({ id: "empty", name: "Empty" }),
      category({ id: "drafts", name: "Only drafts" }),
    ];
    const resources = [
      resource({ id: "a2", categoryId: "a", title: "Beta", displayOrder: 1 }),
      resource({ id: "a1", categoryId: "a", title: "Alpha", displayOrder: 1 }),
      resource({ id: "a0", categoryId: "a", title: "Zed", displayOrder: 0 }),
      resource({ id: "b1", categoryId: "b" }),
      resource({ id: "z1", categoryId: "first" }),
      resource({ id: "h1", categoryId: "hidden" }),
      resource({ id: "d1", categoryId: "drafts", status: "draft" }),
    ];
    const out = buildCustomerCatalogue(cats, resources, CUSTOMER_PRO, PLANS);
    expect(out.map((c) => c.id)).toEqual(["first", "a", "b"]);
    expect(out[1].resources.map((r) => r.id)).toEqual(["a0", "a1", "a2"]);
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

const CAT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function validResource(over: Record<string, unknown> = {}) {
  return {
    categoryId: CAT_ID,
    title: "  Intro  ",
    description: "  ",
    type: "video",
    url: "https://youtu.be/dQw4w9WgXcQ",
    durationMinutes: 10,
    status: "published",
    isFree: false,
    planIds: [PRO, PRO.toUpperCase()],
    ...over,
  };
}

describe("normaliseResourceInput", () => {
  it("trims, nulls blanks, dedupes plan ids and defaults displayOrder", () => {
    const res = normaliseResourceInput(validResource());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({ title: "Intro", description: null, planIds: [PRO], displayOrder: 0 });
  });

  it("rejects bad url schemes", () => {
    for (const url of [
      "javascript:alert(1)",
      "JAVASCRIPT:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "ftp://example.com/file",
      "//example.com/x",
      "/relative",
      "example.com",
      "https://user:pass@example.com/",
    ]) {
      const res = normaliseResourceInput(validResource({ url }));
      expect(res.ok, url).toBe(false);
      if (!res.ok) expect(res.errors.url, url).toBeDefined();
    }
  });

  it("generated: any url accepted is http(s) and parses", () => {
    const rand = mulberry32(0x0071);
    const schemes = ["http:", "https:", "javascript:", "data:", "vbscript:", "file:", "mailto:", " https:", "HTTPS:"];
    for (let i = 0; i < ITERATIONS; i++) {
      const raw = `${pick(rand, schemes)}${rand() < 0.7 ? "//" : ""}${pick(rand, ["example.com", "", "a.b", "x y"])}/${i}`;
      const safe = normaliseExternalUrl(raw);
      if (safe !== null) {
        expect(/^https?:\/\//.test(safe), raw).toBe(true);
        expect(new URL(safe).hostname.length).toBeGreaterThan(0);
      }
    }
  });

  it("published requires a url; coming_soon does not", () => {
    const res = normaliseResourceInput(validResource({ url: "" }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.url).toMatch(/published/i);
    expect(normaliseResourceInput(validResource({ url: "", status: "coming_soon" })).ok).toBe(true);
  });

  it("requires isFree or a non-empty list of uuids, and ignores planIds when free", () => {
    for (const planIds of [undefined, [], ["not-a-uuid"], "x"]) {
      const res = normaliseResourceInput(validResource({ planIds }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.errors.planIds).toBeDefined();
    }
    const free = normaliseResourceInput(validResource({ isFree: true, planIds: ["junk"] }));
    expect(free.ok && free.value.planIds).toEqual([]);
  });

  it("enforces title, description, type, status and duration bounds", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ title: "   " }, "title"],
      [{ title: "x".repeat(201) }, "title"],
      [{ description: "x".repeat(2001) }, "description"],
      [{ type: "podcast" }, "type"],
      [{ status: "live" }, "status"],
      [{ durationMinutes: -1 }, "durationMinutes"],
      [{ durationMinutes: 1001 }, "durationMinutes"],
      [{ durationMinutes: 2.5 }, "durationMinutes"],
      [{ categoryId: "nope" }, "categoryId"],
      [{ isFree: "yes" }, "isFree"],
    ];
    for (const [over, field] of cases) {
      const res = normaliseResourceInput(validResource(over));
      expect(res.ok, field).toBe(false);
      if (!res.ok) expect(Object.keys(res.errors), field).toContain(field);
    }
    expect(normaliseResourceInput(validResource({ title: "x".repeat(200), durationMinutes: null })).ok).toBe(true);
    expect(normaliseResourceInput(validResource({ durationMinutes: 1000 })).ok).toBe(true);
  });

  it("treats non-object input as empty", () => {
    const res = normaliseResourceInput(null);
    expect(res.ok).toBe(false);
  });
});

describe("normaliseCategoryInput", () => {
  it("accepts a valid category and defaults", () => {
    const res = normaliseCategoryInput({ name: " Basics ", icon: "Rocket" });
    expect(res).toEqual({
      ok: true,
      value: { name: "Basics", description: null, icon: "Rocket", displayOrder: 0, isPublished: true },
    });
  });

  it("rejects unknown icons and bad fields", () => {
    const res = normaliseCategoryInput({ name: "", icon: "Skull", displayOrder: -1, isPublished: "no" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(Object.keys(res.errors).sort()).toEqual(["displayOrder", "icon", "isPublished", "name"]);
  });
});

// ─── Slugs, rows, embeds ─────────────────────────────────────────────────────

describe("slugs", () => {
  it("slugifies like the migration seed", () => {
    expect(slugify("The 5-Step Weekly Operating Loop")).toBe("the-5-step-weekly-operating-loop");
    expect(slugify("Advanced (Mastery)")).toBe("advanced-mastery");
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu");
    expect(slugify("!!!")).toBe("item");
    expect(slugify("a".repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it("suffixes until unique and stays within 80 chars", () => {
    expect(uniqueSlug("intro", [])).toBe("intro");
    expect(uniqueSlug("intro", ["intro", "intro-2"])).toBe("intro-3");
    const long = "a".repeat(80);
    const next = uniqueSlug(long, [long]);
    expect(next.endsWith("-2")).toBe(true);
    expect(next.length).toBeLessThanOrEqual(80);
  });
});

describe("row mapping", () => {
  it("maps rows to camelCase and drops unknown icons", () => {
    const cat = categoryFromRow({
      id: "c", slug: "c", name: "C", description: null, icon: "Skull",
      display_order: 3, is_published: false, created_at: "t", updated_at: "u",
    });
    expect(cat).toMatchObject({ icon: null, displayOrder: 3, isPublished: false });

    const plans = groupPlanIds([
      { resource_id: "r", plan_id: PRO },
      { resource_id: "r", plan_id: STARTER },
    ]);
    const status: UniversityStatus = "coming_soon";
    const res = resourceFromRow(
      {
        id: "r", slug: "r", category_id: "c", title: "T", description: null, resource_type: "pdf",
        url: null, duration_minutes: null, status, is_free: false, display_order: 1,
        created_at: "t", updated_at: "u", updated_by: null,
      },
      plans.get("r") ?? []
    );
    expect(res).toMatchObject({ categoryId: "c", type: "pdf", planIds: [PRO, STARTER], status: "coming_soon" });
  });
});

describe("videoEmbedUrl", () => {
  it("maps YouTube, Vimeo and Loom", () => {
    const yt = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    expect(videoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe(yt);
    expect(videoEmbedUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(yt);
    expect(videoEmbedUrl("https://m.youtube.com/shorts/dQw4w9WgXcQ")).toBe(yt);
    expect(videoEmbedUrl("https://youtube.com/embed/dQw4w9WgXcQ")).toBe(yt);
    expect(videoEmbedUrl("https://vimeo.com/123456789")).toBe("https://player.vimeo.com/video/123456789");
    expect(videoEmbedUrl("https://vimeo.com/123456789/abcdef1234")).toBe(
      "https://player.vimeo.com/video/123456789?h=abcdef1234"
    );
    const loomId = "0123456789abcdef0123456789abcdef";
    expect(videoEmbedUrl(`https://www.loom.com/share/${loomId}`)).toBe(`https://www.loom.com/embed/${loomId}`);
  });

  it("returns null for anything else", () => {
    for (const url of [
      null,
      "",
      "https://example.com/video.mp4",
      "https://www.youtube.com/watch?v=short",
      "https://vimeo.com/channels/staff",
      "javascript:alert(1)",
      "https://evil.com/youtube.com/watch?v=dQw4w9WgXcQ",
    ]) {
      expect(videoEmbedUrl(url), String(url)).toBeNull();
    }
  });
});
