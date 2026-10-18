import { describe, it, expect } from "vitest";
import {
  UNCATEGORISED,
  categoryOf,
  countGrouped,
  groupByCategory,
  matchesSearch,
  toCustomerLibraryItem,
  type Pickable,
} from "@/lib/library/picker";
import { toLibraryEntry } from "@/lib/workbook/read";

const item = (key: string, category: string | null, name = key, oneLiner: string | null = null): Pickable =>
  ({ key, name, category, oneLiner });

const LIB: Pickable[] = [
  item("webinar", "Webinars", "Live Webinar", "Teach, then pitch"),
  item("fb-ads", "Paid Ads", "Paid Ads - Facebook", "Cold traffic to a lead magnet"),
  item("dinner", "Your Own Event - In-Person Events", "Dinners & Lunches"),
  item("loose", null, "Uncategorised thing"),
  item("evergreen", "Webinars", "Evergreen Webinar"),
  item("g-ads", "Paid Ads", "Paid Ads - Google"),
];

describe("groupByCategory", () => {
  it("groups by category in first-appearance order, with uncategorised last", () => {
    const groups = groupByCategory(LIB);
    expect(groups.map((g) => g.category)).toEqual([
      "Webinars", "Paid Ads", "Your Own Event - In-Person Events", UNCATEGORISED,
    ]);
    expect(groups[0].items.map((i) => i.key)).toEqual(["webinar", "evergreen"]);
  });

  it("moves pinned (recommended) keys to the front of their category, in pin order", () => {
    const groups = groupByCategory(LIB, { pinFirst: ["g-ads", "evergreen"] });
    expect(groups.find((g) => g.category === "Paid Ads")?.items.map((i) => i.key)).toEqual(["g-ads", "fb-ads"]);
    expect(groups.find((g) => g.category === "Webinars")?.items.map((i) => i.key)).toEqual(["evergreen", "webinar"]);
  });

  it("filters by search and drops empty categories", () => {
    const groups = groupByCategory(LIB, { search: "paid google" });
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((i) => i.key)).toEqual(["g-ads"]);
  });

  it("treats a blank category as uncategorised", () => {
    expect(categoryOf(item("x", "   "))).toBe(UNCATEGORISED);
  });

  /**
   * Nothing is lost or duplicated by grouping, and pinning never moves an item
   * out of its category. Seeded generator (no fast-check in this project).
   */
  it("property: every item appears exactly once, under its own category", () => {
    const rand = mulberry32(5);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    for (let run = 0; run < 200; run++) {
      const n = Math.floor(rand() * 30);
      const items: Pickable[] = Array.from({ length: n }, (_, i) =>
        item(`k${i}`, pick(["A", "B", "C", " ", "", null]), pick(["x", "y", "Z"]))
      );
      const pinFirst = items.filter(() => rand() < 0.2).map((i) => i.key);
      const groups = groupByCategory(items, { pinFirst });
      expect(countGrouped(groups)).toBe(items.length);
      for (const g of groups) for (const i of g.items) expect(categoryOf(i)).toBe(g.category);
      expect(new Set(groups.flatMap((g) => g.items.map((i) => i.key))).size).toBe(items.length);
      const uncategorised = groups.findIndex((g) => g.category === UNCATEGORISED);
      if (uncategorised !== -1) expect(uncategorised).toBe(groups.length - 1);
    }
  });
});

describe("matchesSearch", () => {
  it("matches every word, case-insensitively, across name, one-liner and category", () => {
    expect(matchesSearch(LIB[0], "  WEBINAR  pitch ")).toBe(true);
    expect(matchesSearch(LIB[0], "webinars")).toBe(true); // the category
    expect(matchesSearch(LIB[0], "webinar google")).toBe(false);
    expect(matchesSearch(LIB[0], "")).toBe(true);
    expect(matchesSearch(LIB[0], null)).toBe(true);
  });
});

describe("toCustomerLibraryItem", () => {
  it("carries picker fields only, never admin-only ones", () => {
    const entry = toLibraryEntry({
      initiative_key: "webinar", name: "Live Webinar", category: "Webinars", one_liner: "x",
      own_or_ops: "OWN", price_tier: "High", needs_sales_team: "YES", difficulty: 3,
      speed_score: 4, cost_score: 3, odds_score: 2, revenue_score: 5, ease_score: 1, score_total: 15,
      ideal_industries: ["Retail"], metrics_raw: "- Opens",
    });
    const out = toCustomerLibraryItem(entry);
    expect(Object.keys(out).sort()).toEqual(
      ["category", "key", "metrics", "name", "oneLiner", "ownOrOps", "scores"]
    );
    expect(out.scores).toEqual({ speed: 4, cost: 3, odds: 2, revenue: 5, ease: 1, total: 15 });
    // Not yet re-uploaded (no stored parse): metrics are parsed live from the raw cell.
    expect(out.metrics?.groups[0].metrics.map((m) => m.key)).toEqual(["opens"]);
  });
});

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
