import { describe, it, expect } from "vitest";
import {
  AUDIENCE_GROUPS_INTRO,
  AUDIENCE_HEADINGS,
  RECENTS_LIMIT,
  SUBHEADINGS,
  buildCategoryList,
  buildIndex,
  buildRecents,
  buildTiles,
  searchItems,
  sectionize,
  toPickerItems,
  type PickerItem,
} from "./picker";
import { CATEGORIES } from "./library-config";
import { buildRecord } from "./config-repo";

const item = (key: string, categoryId: PickerItem["categoryId"], audience: PickerItem["audience"] = "own", extra: Partial<PickerItem> = {}): PickerItem => ({
  key,
  name: key.replace(/-/g, " "),
  oneLiner: null,
  categoryId,
  audience,
  ...extra,
});

const ITEMS: PickerItem[] = [
  item("paid-social", "paid-ads", "borrowed", { name: "Paid Social", oneLiner: "Meta and TikTok ads" }),
  item("live-webinar", "webinars", "own", { name: "Live Webinar", oneLiner: "Teach, then pitch" }),
  item("joint-webinar", "webinars", "borrowed", { name: "Joint Webinar", oneLiner: "On a partner's list" }),
  item("auto-webinar", "webinars", "own", { name: "Automated Webinar" }),
  item("newsletter", "email-text-mail", "own", { name: "Newsletter", oneLiner: "Weekly WEBINAR invite" }),
];

describe("buildTiles", () => {
  it("lists only non-empty categories, in tile order, with live counts", () => {
    const tiles = buildTiles(ITEMS);
    expect(tiles.map((t) => [t.id, t.count])).toEqual([
      ["webinars", 3],
      ["paid-ads", 1],
      ["email-text-mail", 1],
    ]);
    expect(tiles[0]).toEqual({ id: "webinars", label: "Webinars", tileOrder: 1, count: 3 });
  });

  it("never exposes launchCount", () => {
    for (const t of buildTiles(ITEMS)) expect(t).not.toHaveProperty("launchCount");
  });

  it("shows every category once each has an item, in tileOrder", () => {
    const all = CATEGORIES.map((c) => item(`x-${c.id}`, c.id));
    const tiles = buildTiles(all);
    expect(tiles).toHaveLength(12);
    expect(tiles.map((t) => t.tileOrder)).toEqual([...tiles.map((t) => t.tileOrder)].sort((a, b) => a - b));
  });

  it("is empty for no items", () => {
    expect(buildTiles([])).toEqual([]);
  });
});

describe("buildCategoryList", () => {
  it("groups Webinars under the two audience headings with the spec copy", () => {
    const list = buildCategoryList(ITEMS, "webinars")!;
    expect(list.intro).toBe("Most plans use both kinds.");
    expect(list.groups.map((g) => g.heading)).toEqual(["Your audience", "Someone else's audience"]);
    expect(list.groups[0].description).toBe(
      "Your list, your following, your ad spend. You control the date and who sees it."
    );
    expect(list.groups[1].description).toBe(
      "A host's stage, a partner's list, an affiliate's following. You're borrowing their reach, so they control the date and the audience."
    );
    expect(list.groups[0].sections).toEqual([
      { subheading: null, items: [ITEMS[1], ITEMS[3]] },
    ]);
    expect(list.groups[1].sections[0].items).toEqual([ITEMS[2]]);
  });

  it("omits an empty audience group", () => {
    const list = buildCategoryList(ITEMS.filter((i) => i.audience === "own"), "webinars")!;
    expect(list.groups.map((g) => g.audience)).toEqual(["own"]);
    expect(list.intro).toBe(AUDIENCE_GROUPS_INTRO);
  });

  it("is one ungrouped list for every other category", () => {
    const mixed = [item("a", "paid-ads", "own"), item("b", "paid-ads", "borrowed")];
    const list = buildCategoryList(mixed, "paid-ads")!;
    expect(list.intro).toBeNull();
    expect(list.groups).toEqual([
      { audience: null, heading: null, description: null, sections: [{ subheading: null, items: mixed }] },
    ]);
  });

  it("only Webinars shows audience headings", () => {
    expect(CATEGORIES.filter((c) => c.showsAudienceHeadings).map((c) => c.id)).toEqual(["webinars"]);
  });

  it("returns null for an unknown category", () => {
    expect(buildCategoryList(ITEMS, "nope")).toBeNull();
  });
});

describe("sub-headings", () => {
  it("ship empty", () => {
    expect(SUBHEADINGS).toEqual({});
  });

  it("split a list into ordered sections, un-headed items first", () => {
    const items = [item("a", "paid-ads"), item("b", "paid-ads"), item("c", "paid-ads"), item("d", "paid-ads")];
    const map = { c: "Second", b: "First", d: "Second" };
    expect(sectionize(items, map)).toEqual([
      { subheading: null, items: [items[0]] },
      { subheading: "Second", items: [items[2], items[3]] },
      { subheading: "First", items: [items[1]] },
    ]);
  });

  it("apply inside audience groups", () => {
    const list = buildCategoryList(ITEMS, "webinars", { "auto-webinar": "Evergreen" })!;
    expect(list.groups[0].sections).toEqual([
      { subheading: null, items: [ITEMS[1]] },
      { subheading: "Evergreen", items: [ITEMS[3]] },
    ]);
  });
});

describe("searchItems", () => {
  it("matches name and one-liner case-insensitively across categories", () => {
    const results = searchItems(ITEMS, "  WeBiNaR ");
    expect(results.map((r) => r.item.key)).toEqual([
      "live-webinar",
      "joint-webinar",
      "auto-webinar",
      "newsletter", // via its one-liner
    ]);
  });

  it("labels each result with its category and audience", () => {
    const [r] = searchItems(ITEMS, "joint");
    expect(r).toEqual({ item: ITEMS[2], categoryLabel: "Webinars", audienceLabel: "Someone else's audience" });
    expect(searchItems(ITEMS, "tiktok")[0]).toMatchObject({
      categoryLabel: "Paid Ads",
      audienceLabel: AUDIENCE_HEADINGS.borrowed.heading,
    });
  });

  it("distinguishes records sharing a name", () => {
    const twins = [item("vip-a", "webinars", "own", { name: "VIP Day" }), item("vip-b", "your-own-event-in-person", "own", { name: "VIP Day" })];
    expect(searchItems(twins, "vip day").map((r) => r.categoryLabel)).toEqual([
      "Webinars",
      "Your Own Event — In-Person Events",
    ]);
  });

  it("returns nothing for a blank query or no match", () => {
    expect(searchItems(ITEMS, "   ")).toEqual([]);
    expect(searchItems(ITEMS, "zzz")).toEqual([]);
  });
});

describe("buildIndex", () => {
  it("groups every item by category in tile order", () => {
    const index = buildIndex(ITEMS);
    expect(index.map((e) => e.category.id)).toEqual(["webinars", "paid-ads", "email-text-mail"]);
    expect(index[0].items.map((i) => i.key)).toEqual(["live-webinar", "joint-webinar", "auto-webinar"]);
    expect(index.flatMap((e) => e.items)).toHaveLength(ITEMS.length);
  });
});

describe("buildRecents", () => {
  it("keeps order, drops unoffered and duplicate keys, caps at 4", () => {
    const recents = buildRecents(ITEMS, [
      "newsletter",
      "gone",
      "newsletter",
      "paid-social",
      "live-webinar",
      "joint-webinar",
      "auto-webinar",
    ]);
    expect(RECENTS_LIMIT).toBe(4);
    expect(recents.map((i) => i.key)).toEqual(["newsletter", "paid-social", "live-webinar", "joint-webinar"]);
  });

  it("is empty with no recents", () => {
    expect(buildRecents(ITEMS, [])).toEqual([]);
  });
});

describe("toPickerItems", () => {
  const lib = {
    initiative_key: "webinar",
    workbook_id: "IN01",
    name: "Live Webinar",
    category: "Webinars",
    own_or_ops: "OWN",
    cta_options: ["Offer"],
  };
  const row = {
    initiative_key: "webinar",
    category_id: "webinars",
    allowed_kinds: ["one-time"],
    allowed_paths: ["offer"],
    allowed_frequencies: [],
    audience_source: "own",
    format_override: null,
    ongoing_label: null,
    partner_host: true,
    partner_booking: true,
    revenue_lines: [],
    field_extras: [],
  };

  it("projects to the five picker fields only", () => {
    const record = buildRecord(lib, row, undefined);
    const [out] = toPickerItems([record], new Map([["webinar", "  Teach, then pitch "]]));
    expect(out).toEqual({
      key: "webinar",
      name: "Live Webinar",
      oneLiner: "Teach, then pitch",
      categoryId: "webinars",
      audience: "own",
    });
    expect(Object.keys(out).sort()).toEqual(["audience", "categoryId", "key", "name", "oneLiner"]);
    expect(JSON.stringify(out)).not.toContain("IN01");
  });

  it("drops a record without a category or audience, and nulls a blank one-liner", () => {
    const record = buildRecord(lib, row, undefined);
    const noCategory = { ...record, effective: { ...record.effective, categoryId: undefined } };
    expect(toPickerItems([noCategory])).toEqual([]);
    expect(toPickerItems([record], new Map([["webinar", "  "]]))[0].oneLiner).toBeNull();
  });
});
