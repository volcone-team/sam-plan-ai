import { describe, it, expect } from "vitest";
import {
  OFFER_OWNER_CART_NOTE,
  TYPE_EXTRAS_BY_NAME,
  planTypeExtrasBackfill,
  typeExtrasFor,
  type BackfillConfigRow,
  type BackfillLibraryRow,
} from "./type-extras";
import { MAX_FIELD_EXTRAS, categoryById, validateLibraryConfig, type CategoryId, type LibraryRecordConfig } from "./library-config";

describe("TYPE_EXTRAS_BY_NAME", () => {
  it("keeps every record within the three-extra ceiling", () => {
    for (const extras of Object.values(TYPE_EXTRAS_BY_NAME)) {
      expect(extras.length).toBeGreaterThan(0);
      expect(extras.length).toBeLessThanOrEqual(MAX_FIELD_EXTRAS);
    }
  });

  it("validates on each record's real category with the offer path", () => {
    const where: Record<string, CategoryId[]> = {
      "Challenge / Bootcamp (Free)": ["your-own-event-virtual", "other-peoples-stages-virtual"],
      "Challenge / Bootcamp (Paid)": ["your-own-event-virtual", "other-peoples-stages-virtual"],
      "Internal Launch": ["funnels-launches-promotions"],
      "Affiliate Launch": ["funnels-launches-promotions"],
      "Dinners/Lunches": ["your-own-event-in-person", "other-peoples-stages-in-person"],
    };
    for (const [name, categories] of Object.entries(where)) {
      for (const id of categories) {
        const config: LibraryRecordConfig = {
          initiativeKey: name,
          isLaunch: false,
          allowedKinds: ["one-time"],
          allowedPaths: ["offer", "calls"],
          audienceSource: "own",
          revenueLines: [],
          fieldExtras: typeExtrasFor(name)!,
          allowedFrequencies: [],
        };
        expect(validateLibraryConfig(config, categoryById(id)!)).toEqual({ ok: true });
      }
    }
  });
});

describe("typeExtrasFor", () => {
  it("matches the library names through normalizeKey", () => {
    expect(typeExtrasFor("Challenge / Bootcamp (Free)")?.map((e) => e.key)).toEqual(["pitch_day"]);
    expect(typeExtrasFor("challenge  bootcamp free")?.map((e) => e.key)).toEqual(["pitch_day"]);
    expect(typeExtrasFor("Internal Launch")?.[0]).toMatchObject({ type: "date", derives: "cart.opens" });
    expect(typeExtrasFor("Dinners/Lunches")?.map((e) => [e.key, e.type])).toEqual([
      ["guest_list_size", "number"],
      ["qualifying_criteria", "text"],
    ]);
  });

  it("binds Affiliate Launch's two cart dates with the offer-owner note", () => {
    const extras = typeExtrasFor("Affiliate Launch")!;
    expect(extras.map((e) => [e.label, e.binds])).toEqual([
      ["Cart opens", "cart.opens"],
      ["Cart closes", "dates.close"],
    ]);
    expect(extras.every((e) => e.hint === OFFER_OWNER_CART_NOTE)).toBe(true);
  });

  it("returns null for other names and blanks, and copies otherwise", () => {
    expect(typeExtrasFor("Live Webinar")).toBeNull();
    expect(typeExtrasFor("")).toBeNull();
    expect(typeExtrasFor(null)).toBeNull();
    const a = typeExtrasFor("Internal Launch")!;
    a[0].label = "changed";
    expect(typeExtrasFor("Internal Launch")![0].label).toBe("Webinar date");
  });
});

describe("planTypeExtrasBackfill", () => {
  const lib: BackfillLibraryRow[] = [
    { initiative_key: "challenge-bootcamp-free", name: "Challenge / Bootcamp (Free)" },
    { initiative_key: "internal-launch", name: "Internal Launch" },
    { initiative_key: "dinners-lunches", name: "Dinners/Lunches" },
    { initiative_key: "affiliate-launches", name: "Affiliate Launch" },
    { initiative_key: "live-webinar", name: "Live Webinar" },
  ];

  it("fills only empty arrays on named records, and reports the rest", () => {
    const configs: BackfillConfigRow[] = [
      { initiative_key: "challenge-bootcamp-free", field_extras: [] },
      { initiative_key: "internal-launch", field_extras: [{ key: "x", label: "X", readBy: "y" }] },
      { initiative_key: "dinners-lunches", field_extras: null },
      { initiative_key: "live-webinar", field_extras: [] },
    ];
    const plan = planTypeExtrasBackfill(lib, configs);
    expect(plan.updates.map((u) => u.initiativeKey)).toEqual(["challenge-bootcamp-free"]);
    expect(plan.updates[0].fieldExtras.map((e) => e.key)).toEqual(["pitch_day"]);
    expect(plan.skipped).toEqual([
      { initiativeKey: "internal-launch", name: "Internal Launch", reason: "has_extras" },
      { initiativeKey: "dinners-lunches", name: "Dinners/Lunches", reason: "not_an_array" },
      { initiativeKey: "affiliate-launches", name: "Affiliate Launch", reason: "no_config_row" },
    ]);
  });

  it("finds nothing to do once applied", () => {
    const configs = lib.map((l) => ({ initiative_key: l.initiative_key, field_extras: [] as unknown }));
    const first = planTypeExtrasBackfill(lib, configs);
    expect(first.updates).toHaveLength(4);
    const after = configs.map((c) => ({
      ...c,
      field_extras: first.updates.find((u) => u.initiativeKey === c.initiative_key)?.fieldExtras ?? c.field_extras,
    }));
    expect(planTypeExtrasBackfill(lib, after).updates).toEqual([]);
  });

  /**
   * Property: the plan only ever writes a row whose field_extras is [] and
   * whose name has type extras, and never writes the same key twice.
   */
  it("never touches a configured or unnamed row (property, seeded random libraries)", () => {
    const names = [...Object.keys(TYPE_EXTRAS_BY_NAME), "Live Webinar", "Organic Social", ""];
    const extrasChoices: unknown[] = [[], null, [{ key: "k", label: "L", readBy: "r" }]];
    // Small LCG: deterministic, so a failure reproduces.
    let seed = 20261018;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let run = 0; run < 300; run++) {
      const rs = Array.from({ length: rand(20) }, (_, i) => ({
        key: `k${i}`,
        name: names[rand(names.length)],
        extras: extrasChoices[rand(extrasChoices.length)],
        hasRow: rand(4) !== 0,
      }));
      const library = rs.map((r) => ({ initiative_key: r.key, name: r.name }));
      const configs = rs.filter((r) => r.hasRow).map((r) => ({ initiative_key: r.key, field_extras: r.extras }));
      const plan = planTypeExtrasBackfill(library, configs);
      const keys = plan.updates.map((u) => u.initiativeKey);
      expect(new Set(keys).size).toBe(keys.length);
      for (const u of plan.updates) {
        const r = rs.find((x) => x.key === u.initiativeKey)!;
        expect(r.hasRow).toBe(true);
        expect(r.extras).toEqual([]);
        expect(typeExtrasFor(r.name)).not.toBeNull();
        expect(u.fieldExtras.length).toBeLessThanOrEqual(MAX_FIELD_EXTRAS);
      }
      // Every named row with [] is planned: nothing eligible is missed.
      const eligible = rs.filter((r) => r.hasRow && Array.isArray(r.extras) && r.extras.length === 0 && typeExtrasFor(r.name));
      expect(keys.sort()).toEqual(eligible.map((r) => r.key).sort());
    }
  });
});
