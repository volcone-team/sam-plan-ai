import { describe, it, expect } from "vitest";
import {
  CONFIG_FIELDS,
  deriveConfig,
  deriveConfigs,
  type LibraryRowInput,
} from "./derive-config";

const row = (over: Partial<LibraryRowInput> = {}): LibraryRowInput => ({
  initiative_key: "webinar",
  name: "Webinar",
  category: "Webinars",
  own_or_ops: "OWN",
  cta_options: ["Offer"],
  ...over,
});

const codes = (r: ReturnType<typeof deriveConfig>) => r.warnings.map((w) => w.code);

describe("deriveConfig: category", () => {
  it("resolves the workbook's stored (collapsed) spelling to an id", () => {
    const r = deriveConfig(row({ category: "Other People's Stages - In-Person Events" }));
    expect(r.config.categoryId).toBe("other-peoples-stages-in-person");
    expect(r.derived).toContain("categoryId");
    expect(r.needsHuman).not.toContain("categoryId");
  });

  it("resolves the raw spelling with an embedded newline", () => {
    const r = deriveConfig(row({ category: "Your Own Event - \nIn-Person Events" }));
    expect(r.config.categoryId).toBe("your-own-event-in-person");
  });

  it("warns and leaves categoryId unset on an unknown category", () => {
    const r = deriveConfig(row({ category: "DIGITAL MARKETING" }));
    expect(r.config).not.toHaveProperty("categoryId");
    expect(codes(r)).toContain("category_unknown");
    expect(r.needsHuman).toContain("categoryId");
  });

  it("warns category_empty on a blank category", () => {
    const r = deriveConfig(row({ category: null }));
    expect(r.config).not.toHaveProperty("categoryId");
    expect(codes(r)).toContain("category_empty");
  });
});

describe("deriveConfig: audienceSource", () => {
  it.each([
    ["OWN", "own"],
    ["OPS", "borrowed"],
    ["OWN & OPS", "borrowed"],
  ] as const)("%s -> %s", (ownOrOps, expected) => {
    const r = deriveConfig(row({ own_or_ops: ownOrOps }));
    expect(r.config.audienceSource).toBe(expected);
    expect(codes(r)).not.toContain("audience_fallback");
  });

  it("falls back to the category and warns when own_or_ops is blank", () => {
    // Was Paid Ads -> borrowed. Paid Ads is now `mixed` (owner's designs), so
    // the borrowed fallback is shown on a category that is still borrowed.
    const r = deriveConfig(row({ category: "Other People's Stages - Virtual Events", own_or_ops: null }));
    expect(r.config.audienceSource).toBe("borrowed");
    expect(codes(r)).toContain("audience_fallback");
  });

  it("falls back to own, with the warning, on a blank Paid Ads row now the category is mixed", () => {
    const r = deriveConfig(row({ category: "Paid Ads", own_or_ops: null }));
    expect(r.config.audienceSource).toBe("own");
    expect(codes(r)).toContain("audience_fallback");
  });

  it("leaves audience unset when the category is unknown", () => {
    const r = deriveConfig(row({ category: "Nope", own_or_ops: "OPS" }));
    expect(r.config).not.toHaveProperty("audienceSource");
    expect(codes(r)).toContain("audience_unresolved");
    expect(r.needsHuman).toContain("audienceSource");
  });
});

describe("deriveConfig: allowedPaths", () => {
  it("maps all four tokens, case/spacing-insensitive, in contract order", () => {
    const r = deriveConfig(
      row({ cta_options: ["speaker fee", "Lead Collect", "Drive to Calls", "OFFER"] })
    );
    expect(r.config.allowedPaths).toEqual(["offer", "calls", "leads", "speaker-fee"]);
    expect(r.warnings).toEqual([]);
  });

  it("dedupes repeated tokens", () => {
    const r = deriveConfig(row({ cta_options: ["Offer", "offer"] }));
    expect(r.config.allowedPaths).toEqual(["offer"]);
  });

  it("warns on an unknown token and keeps the known ones", () => {
    const r = deriveConfig(row({ cta_options: ["Offer", "Book a Demo"] }));
    expect(r.config.allowedPaths).toEqual(["offer"]);
    const w = r.warnings.find((x) => x.code === "cta_unknown_token");
    expect(w?.value).toBe("Book a Demo");
    expect(w?.field).toBe("allowedPaths");
  });

  it("leaves allowedPaths unset (never []) when every token is unknown", () => {
    const r = deriveConfig(row({ cta_options: ["Book a Demo"] }));
    expect(r.config).not.toHaveProperty("allowedPaths");
    expect(codes(r)).toEqual(expect.arrayContaining(["cta_unknown_token", "cta_no_known_paths"]));
    expect(r.needsHuman).toContain("allowedPaths");
  });

  it.each([[null], [[]], [["", "  "]]])("leaves allowedPaths unset for %j without warning", (cta) => {
    const r = deriveConfig(row({ cta_options: cta }));
    expect(r.config).not.toHaveProperty("allowedPaths");
    expect(r.warnings.filter((w) => w.field === "allowedPaths")).toEqual([]);
    expect(r.needsHuman).toContain("allowedPaths");
  });
});

describe("deriveConfig: fields never derived", () => {
  it("never invents allowedKinds, whatever the row", () => {
    const rows = [
      row(),
      row({ name: "Hybrid Events", category: "Other People's Stages - Virtual Events" }),
      row({ name: "Networking Event", cta_options: null, category: null, own_or_ops: null }),
      row({ name: "Paid Ads Evergreen", category: "Paid Ads", cta_options: ["Lead Collect"] }),
    ];
    for (const r of rows.map(deriveConfig)) {
      expect(r.config).not.toHaveProperty("allowedKinds");
      expect(r.needsHuman).toContain("allowedKinds");
      expect(r.derived).not.toContain("allowedKinds");
    }
  });

  it("leaves isLaunch, ongoingLabel, revenueLines, fieldExtras, allowedFrequencies unset", () => {
    const r = deriveConfig(row());
    for (const f of ["isLaunch", "ongoingLabel", "revenueLines", "fieldExtras", "allowedFrequencies"]) {
      expect(r.config).not.toHaveProperty(f);
    }
    expect(r.needsHuman).toEqual(
      expect.arrayContaining(["revenueLines", "allowedFrequencies"])
    );
    expect(r.needsHuman).not.toContain("ongoingLabel");
    expect(r.needsHuman).not.toContain("fieldExtras");
  });

  it("contains no empty arrays anywhere", () => {
    const r = deriveConfig(row({ cta_options: [] }));
    for (const v of Object.values(r.config)) {
      if (Array.isArray(v)) expect(v.length).toBeGreaterThan(0);
    }
  });
});

describe("deriveConfig: type extras", () => {
  const keysFor = (name: string, category: string, own_or_ops = "OWN") =>
    deriveConfig(row({ initiative_key: "k", name, category, own_or_ops })).config.fieldExtras?.map((e) => e.key);

  it("seeds pitch day on both Challenge / Bootcamp records, in both virtual categories", () => {
    for (const name of ["Challenge / Bootcamp (Free)", "Challenge / Bootcamp (Paid)"]) {
      expect(keysFor(name, "Your Own Event - Virtual Events")).toEqual(["pitch_day"]);
      expect(keysFor(name, "Other People's Stages - Virtual Events", "OPS")).toEqual(["pitch_day"]);
    }
  });

  it("seeds the webinar date, the offer owner's cart dates and the dinner questions", () => {
    expect(keysFor("Internal Launch", "Funnels, Launches & Promotions")).toEqual(["webinar_date"]);
    expect(keysFor("Affiliate Launch", "Funnels, Launches & Promotions", "OWN & OPS")).toEqual([
      "offer_owner_cart_opens",
      "offer_owner_cart_closes",
    ]);
    expect(keysFor("Dinners/Lunches", "Your Own Event - In-Person Events")).toEqual([
      "guest_list_size",
      "qualifying_criteria",
    ]);
  });

  it("reports fieldExtras as derived only where it seeded them", () => {
    const r = deriveConfig(row({ name: "Internal Launch", category: "Funnels, Launches & Promotions" }));
    expect(r.derived).toContain("fieldExtras");
    expect(r.needsHuman).not.toContain("fieldExtras");
    expect(deriveConfig(row()).derived).not.toContain("fieldExtras");
  });
});

describe("deriveConfig: formatOverride", () => {
  it("pins Hybrid Events to hybrid", () => {
    const r = deriveConfig(row({ name: "Hybrid Events" }));
    expect(r.config.formatOverride).toBe("hybrid");
    expect(r.derived).toContain("formatOverride");
  });

  it("does not pin other names", () => {
    for (const name of ["Hybrid Events Workshop", "Webinar", "Virtual Events"]) {
      const r = deriveConfig(row({ name }));
      expect(r.config).not.toHaveProperty("formatOverride");
      expect(r.needsHuman).not.toContain("formatOverride");
    }
  });
});

describe("deriveConfig: partnerBlock", () => {
  it("defaults to host and booking both true", () => {
    const r = deriveConfig(row());
    expect(r.config.partnerBlock).toEqual({ host: true, booking: true });
    expect(codes(r)).not.toContain("booking_name_matched");
  });

  it.each(["Networking", "Networking Events", "Local networking breakfast"])(
    "switches booking off for %j and warns",
    (name) => {
      const r = deriveConfig(row({ name }));
      expect(r.config.partnerBlock).toEqual({ host: true, booking: false });
      const w = r.warnings.find((x) => x.code === "booking_name_matched");
      expect(w?.field).toBe("partnerBlock");
    }
  );

  it.each(["Networkingly", "Social Network Ads", "Netw0rking", "networkings"])(
    "does not match %j (not the whole word)",
    (name) => {
      const r = deriveConfig(row({ name }));
      expect(r.config.partnerBlock).toEqual({ host: true, booking: true });
      expect(codes(r)).not.toContain("booking_name_matched");
    }
  );

  it("returns a fresh object, not the shared frozen default", () => {
    const a = deriveConfig(row()).config.partnerBlock!;
    expect(Object.isFrozen(a)).toBe(false);
  });
});

describe("deriveConfig: result lists", () => {
  it("derived and needsHuman are disjoint and in CONFIG_FIELDS order", () => {
    const r = deriveConfig(row({ category: "Nope", cta_options: null }));
    expect(r.derived.filter((f) => r.needsHuman.includes(f))).toEqual([]);
    const order = (xs: readonly string[]) =>
      [...xs].sort((a, b) => CONFIG_FIELDS.indexOf(a as never) - CONFIG_FIELDS.indexOf(b as never));
    expect(r.derived).toEqual(order(r.derived));
    expect(r.needsHuman).toEqual(order(r.needsHuman));
  });

  it("stamps every warning with the initiative key", () => {
    const r = deriveConfig(row({ initiative_key: "x-key", category: "Nope" }));
    expect(r.warnings.length).toBeGreaterThan(0);
    for (const w of r.warnings) expect(w.initiativeKey).toBe("x-key");
  });
});

describe("deriveConfigs", () => {
  it("aggregates needs-human counts and warnings across rows", () => {
    const batch = deriveConfigs([
      row({ initiative_key: "a" }),
      row({ initiative_key: "b", category: "DIGITAL MARKETING", cta_options: null }),
      row({ initiative_key: "c", name: "Networking", cta_options: ["Offer", "Mystery"] }),
    ]);
    expect(batch.results).toHaveLength(3);
    expect(batch.needsHumanCounts.allowedKinds).toBe(3);
    expect(batch.needsHumanCounts.revenueLines).toBe(3);
    expect(batch.needsHumanCounts.categoryId).toBe(1);
    expect(batch.needsHumanCounts.audienceSource).toBe(1);
    expect(batch.needsHumanCounts.allowedPaths).toBe(1);
    expect(batch.needsHumanCounts.partnerBlock).toBe(0);
    expect(Object.keys(batch.needsHumanCounts).sort()).toEqual([...CONFIG_FIELDS].sort());
    expect(batch.warnings.map((w) => [w.initiativeKey, w.code])).toEqual([
      ["b", "category_unknown"],
      ["b", "audience_unresolved"],
      ["c", "cta_unknown_token"],
      ["c", "booking_name_matched"],
    ]);
    expect(batch.warningCounts).toEqual({
      category_unknown: 1,
      audience_unresolved: 1,
      cta_unknown_token: 1,
      booking_name_matched: 1,
    });
  });

  it("handles an empty batch", () => {
    const batch = deriveConfigs([]);
    expect(batch.results).toEqual([]);
    expect(batch.warnings).toEqual([]);
    expect(Object.values(batch.needsHumanCounts).every((n) => n === 0)).toBe(true);
  });
});
