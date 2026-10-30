/**
 * The Initiative Intake config contract.
 *
 * PINS BYTES, not behaviour descriptions. The twelve workbook category strings
 * are asserted character by character, because the whole reason this module
 * exists is that three of them carry an embedded newline and none of them
 * carry the em dash the product spec uses — and a wrong character there does
 * not fail, it silently files 7 of 87 initiatives nowhere.
 */

import { describe, it, expect } from "vitest";
import {
  CATEGORIES,
  CATEGORY_SOURCE_STRINGS,
  CLOSE_DATE_COPY,
  CLOSE_DATE_LABELS,
  CLOSE_DATE_LABEL_ONGOING,
  CLOSE_DATE_LABEL_UNDECIDED,
  CONVERSION_PATHS,
  DEFAULT_ONGOING_LABEL,
  DEFAULT_PARTNER_BLOCK,
  FORM_SECTIONS,
  FORM_SLOT_ORDER,
  INITIATIVE_FORMATS,
  CATEGORY_SCHEMA_SLOT,
  MAX_FIELD_EXTRAS,
  STAGE_CATEGORY_IDS,
  ASK_UNDECIDED,
  ASK_UNDECIDED_CATEGORY_IDS,
  PARTNER_BLOCK_EXCLUDED_CATEGORY_IDS,
  offersAskUndecided,
  attachedBlocks,
  availableConversionPaths,
  bookingStatusWritten,
  categoryById,
  categoryLabel,
  isCategoryId,
  isStageCategory,
  partnerBlockOf,
  resolveCategory,
  resolveFormLayout,
  resolveRecordAudience,
  silentValue,
  validateLibraryConfig,
  type CategoryId,
  type CanonicalCategory,
  type ConfigProblemCode,
  type LibraryRecordConfig,
} from "./library-config";

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const cat = (id: CategoryId): CanonicalCategory => {
  const found = categoryById(id);
  if (!found) throw new Error(`no category ${id}`);
  return found;
};

/** A minimal valid config. Each test overrides only what it is about. */
const config = (over: Partial<LibraryRecordConfig> = {}): LibraryRecordConfig => ({
  initiativeKey: "webinar",
  isLaunch: true,
  allowedKinds: ["one-time"],
  allowedPaths: ["offer", "calls"],
  audienceSource: "own",
  revenueLines: [],
  fieldExtras: [],
  allowedFrequencies: [],
  ...over,
});

const codes = (v: ReturnType<typeof validateLibraryConfig>): ConfigProblemCode[] =>
  v.ok ? [] : v.problems.map((p) => p.code);

/* ------------------------------------------------------------------ *
 * The twelve categories
 * ------------------------------------------------------------------ */

describe("CATEGORIES", () => {
  it("holds exactly twelve, with unique ids", () => {
    expect(CATEGORIES).toHaveLength(12);
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(12);
  });

  it("is frozen, so a caller cannot reorder the picker for everyone else", () => {
    expect(Object.isFrozen(CATEGORIES)).toBe(true);
  });

  it("keeps the spec's order, which is by what people plan first and not alphabetical", () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([
      "webinars",
      "funnels-launches-promotions",
      "your-own-event-in-person",
      "your-own-event-virtual",
      "other-peoples-stages-in-person",
      "other-peoples-stages-virtual",
      "paid-ads",
      "email-text-mail",
      "sales-outreach",
      "content-media",
      "partnerships-referrals",
      "local-presence",
    ]);
    // tileOrder is 1..12 in list order, so the two cannot drift apart.
    expect(CATEGORIES.map((c) => c.tileOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const alphabetical = [...CATEGORIES].map((c) => c.label).sort();
    expect(CATEGORIES.map((c) => c.label)).not.toEqual(alphabetical);
  });

  it("labels use the spec's EM DASH, never the workbook's hyphen or a newline", () => {
    for (const category of CATEGORIES) {
      expect(category.label).not.toContain("\n");
      // Any dash in a label is U+2014. The hyphens inside "In-Person" are
      // U+002D and legitimate, so only the separator form is checked.
      expect(category.label).not.toContain(" - ");
    }
    expect(cat("other-peoples-stages-in-person").label).toBe(
      "Other People\u0027s Stages \u2014 In-Person Events"
    );
    expect(cat("your-own-event-virtual").label).toBe("Your Own Event \u2014 Virtual Events");
  });

  it("shows audience headings for Webinars and nothing else", () => {
    const withHeadings = CATEGORIES.filter((c) => c.showsAudienceHeadings).map((c) => c.id);
    expect(withHeadings).toEqual(["webinars"]);
  });

  it("resolves the audience where the category names it, and refuses to elsewhere", () => {
    // The four that name it outright.
    expect(cat("your-own-event-in-person").audienceSource).toBe("own");
    expect(cat("your-own-event-virtual").audienceSource).toBe("own");
    expect(cat("other-peoples-stages-in-person").audienceSource).toBe("borrowed");
    expect(cat("other-peoples-stages-virtual").audienceSource).toBe("borrowed");
    // Webinars holds both; Partnerships deliberately does not resolve.
    expect(cat("webinars").audienceSource).toBe("mixed");
    expect(cat("partnerships-referrals").audienceSource).toBe("mixed");
  });

  it("only Webinars is both mixed and headed; the other mixed categories have no headings", () => {
    // The mixed categories are mixed for different reasons, which is why
    // showsAudienceHeadings is not derived from audienceSource.
    // CORRECTED to the owner's designs: Paid Ads and Email, Text & Mail joined.
    const mixed = CATEGORIES.filter((c) => c.audienceSource === "mixed").map((c) => c.id);
    expect(mixed).toEqual(["webinars", "paid-ads", "email-text-mail", "partnerships-referrals"]);
    for (const id of ["paid-ads", "email-text-mail", "partnerships-referrals"] as const) {
      expect(cat(id).showsAudienceHeadings, id).toBe(false);
    }
  });

  it("sets the audiences the owner's category designs decide", () => {
    // Sales & Outreach: "Your own audience only… no Partner block attaches."
    expect(cat("sales-outreach").audienceSource).toBe("own");
    // Solo ads, sponsored newsletter sends and partner sends are borrowed.
    expect(cat("email-text-mail").audienceSource).toBe("mixed");
    // Your ad spend is own; bought placements have a host and a booking.
    expect(cat("paid-ads").audienceSource).toBe("mixed");
    // The always-on publishing layer; guesting moved to OPS — Virtual.
    expect(cat("content-media").audienceSource).toBe("own");
    // Your own business profile, reviews and listings.
    expect(cat("local-presence").audienceSource).toBe("own");
    // Unchanged.
    expect(cat("funnels-launches-promotions").audienceSource).toBe("own");
  });

  it("pins digital on webinars and the two virtual event categories", () => {
    expect(cat("webinars").formatBehaviour).toBe("pinned-digital");
    expect(cat("your-own-event-virtual").formatBehaviour).toBe("pinned-digital");
    expect(cat("other-peoples-stages-virtual").formatBehaviour).toBe("pinned-digital");
  });

  it("ASKS on the two In-Person categories, defaulting to in person", () => {
    // CORRECTED: these were `pinned-in-person`, which contradicts the spec's
    // format table. Most stage formats run both ways — a networking event or a
    // mastermind room happens in a room or on a call — so the category may
    // offer a default but must not force the answer.
    for (const id of ["your-own-event-in-person", "other-peoples-stages-in-person"] as const) {
      expect(cat(id).formatBehaviour, id).toBe("asked");
      expect(cat(id).defaultFormat, id).toBe("in-person");
    }
  });

  it("asks nowhere else, and pins in-person at the category level nowhere at all", () => {
    // `pinned-in-person` survives for the per-record override only.
    expect(CATEGORIES.filter((c) => c.formatBehaviour === "asked").map((c) => c.id)).toEqual([
      "your-own-event-in-person",
      "other-peoples-stages-in-person",
    ]);
    expect(CATEGORIES.some((c) => c.formatBehaviour === "pinned-in-person")).toBe(false);
    // Nor does any category pin hybrid: that is the four records' job.
    expect(CATEGORIES.some((c) => c.formatBehaviour === "pinned-hybrid")).toBe(false);
    // A default is only meaningful where the question renders.
    for (const category of CATEGORIES) {
      if (category.formatBehaviour !== "asked") {
        expect(category.defaultFormat, category.id).toBeUndefined();
      }
    }
  });

  it("does not ask for a format where the concept does not apply", () => {
    for (const id of ["paid-ads", "email-text-mail", "sales-outreach", "content-media"] as const) {
      expect(cat(id).formatBehaviour).toBe("not-asked");
    }
  });

  it("carries the 18 Oct workbook's launch counts, which sum to 87", () => {
    // CORRECTED: these were all null while the breakdown was unknown. They are
    // now known and verified. THE SUM IS THE POINT — 87 is the size of the
    // launch set, so a category whose number drifts shows up here rather than
    // as a tile quietly disagreeing with the list it opens.
    expect(CATEGORIES.map((c) => c.launchCount)).toEqual([
      7, 11, 8, 7, 13, 7, 8, 6, 7, 5, 5, 3,
    ]);
    expect(CATEGORIES.reduce((sum, c) => sum + (c.launchCount ?? 0), 0)).toBe(87);
    expect(CATEGORIES.every((c) => c.launchCount !== null)).toBe(true);
  });

  it("treats only Other People's Stages as stage categories", () => {
    expect(STAGE_CATEGORY_IDS).toEqual([
      "other-peoples-stages-in-person",
      "other-peoples-stages-virtual",
    ]);
    // Your own event has a stage, but nobody pays you to appear at it.
    expect(isStageCategory("your-own-event-in-person")).toBe(false);
    expect(isStageCategory("content-media")).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The exact workbook strings
 * ------------------------------------------------------------------ */

describe("CATEGORY_SOURCE_STRINGS", () => {
  it("is the workbook's twelve values, byte for byte", () => {
    // Pinned so that no formatter, editor autocorrect or paste through a tool
    // that tidies whitespace can quietly change one.
    expect(CATEGORY_SOURCE_STRINGS).toEqual({
      webinars: "Webinars",
      "funnels-launches-promotions": "Funnels, Launches & Promotions",
      "your-own-event-in-person": "Your Own Event - \nIn-Person Events",
      "your-own-event-virtual": "Your Own Event - \nVirtual Events",
      "other-peoples-stages-in-person": "Other People's Stages - \nIn-Person Events",
      "other-peoples-stages-virtual": "Other People's Stages - Virtual Events",
      "paid-ads": "Paid Ads",
      "email-text-mail": "Email, Text & Mail",
      "sales-outreach": "Sales & Outreach",
      "content-media": "Content & Media",
      "partnerships-referrals": "Partnerships & Referrals",
      "local-presence": "Local Presence",
    });
  });

  it("uses HYPHEN-MINUS and never an em dash", () => {
    for (const raw of Object.values(CATEGORY_SOURCE_STRINGS)) {
      expect(raw).not.toContain("\u2014");
      expect(raw).not.toContain("\u2013");
    }
    // The separator in the event categories is U+002D.
    expect(CATEGORY_SOURCE_STRINGS["your-own-event-virtual"].codePointAt(15)).toBe(0x002d);
  });

  it("carries the embedded newline on exactly three of the four event categories", () => {
    const withNewline = Object.entries(CATEGORY_SOURCE_STRINGS)
      .filter(([, raw]) => raw.includes("\n"))
      .map(([id]) => id);
    expect(withNewline).toEqual([
      "your-own-event-in-person",
      "your-own-event-virtual",
      "other-peoples-stages-in-person",
    ]);
    // The inconsistent one. Reproduced faithfully, not tidied.
    expect(CATEGORY_SOURCE_STRINGS["other-peoples-stages-virtual"]).not.toContain("\n");
  });

  it("uses straight apostrophes, not typographic ones", () => {
    for (const raw of Object.values(CATEGORY_SOURCE_STRINGS)) {
      expect(raw).not.toContain("\u2019");
    }
    expect(CATEGORY_SOURCE_STRINGS["other-peoples-stages-virtual"]).toContain("People\u0027s");
  });
});

/* ------------------------------------------------------------------ *
 * The matcher
 * ------------------------------------------------------------------ */

describe("resolveCategory", () => {
  it("resolves every one of the twelve exact workbook strings", () => {
    // THE TEST THIS MODULE WAS WRITTEN FOR. All twelve, as the sheet holds
    // them, newlines included.
    for (const [id, raw] of Object.entries(CATEGORY_SOURCE_STRINGS)) {
      const match = resolveCategory(raw);
      expect(match.ok, `${id}: ${JSON.stringify(raw)}`).toBe(true);
      if (match.ok) expect(match.category.id).toBe(id);
    }
  });

  it("resolves the whitespace-collapsed form ingest actually stores", () => {
    // src/lib/workbook/parse.ts cell() collapses /\s+/ to a single space, so
    // the stored value is never the raw one.
    for (const [id, raw] of Object.entries(CATEGORY_SOURCE_STRINGS)) {
      const stored = raw.replace(/\s+/g, " ").trim();
      const match = resolveCategory(stored);
      expect(match.ok, `${id}: ${JSON.stringify(stored)}`).toBe(true);
      if (match.ok) expect(match.category.id).toBe(id);
    }
  });

  it("resolves the spec's em-dash spelling to the same ids", () => {
    for (const category of CATEGORIES) {
      const match = resolveCategory(category.label);
      expect(match.ok, category.label).toBe(true);
      if (match.ok) expect(match.category.id).toBe(category.id);
    }
  });

  it("gives the three dash-and-newline variants of one category the same id", () => {
    const ids = [
      "Other People's Stages - \nIn-Person Events", // workbook, with newline
      "Other People's Stages - In-Person Events", // collapsed by ingest
      "Other People\u2019s Stages \u2014 In-Person Events", // spec, em dash + curly quote
      "  OTHER PEOPLES   STAGES  --  in person events ",
    ].map((raw) => {
      const m = resolveCategory(raw);
      return m.ok ? m.category.id : m.normalized;
    });
    expect(ids).toEqual(Array(4).fill("other-peoples-stages-in-person"));
  });

  it("tolerates case and padding", () => {
    for (const raw of ["  PAID ADS ", "paid ads", "Paid  Ads"]) {
      const match = resolveCategory(raw);
      expect(match.ok, raw).toBe(true);
      if (match.ok) expect(match.category.id).toBe("paid-ads");
    }
  });

  it("resolves a category id back to itself, so a stored value round-trips", () => {
    for (const category of CATEGORIES) {
      const match = resolveCategory(category.id);
      expect(match.ok).toBe(true);
      if (match.ok) expect(match.category.id).toBe(category.id);
    }
  });

  it("refuses an empty input rather than defaulting to the first category", () => {
    for (const raw of ["", "   ", "\n", "  \n ", null, undefined]) {
      const match = resolveCategory(raw);
      expect(match.ok, JSON.stringify(raw)).toBe(false);
      if (!match.ok) expect(match.error).toBe("empty");
    }
  });

  it("refuses a non-string that stringifies to something, as unknown rather than empty", () => {
    // A number or an object read out of a spreadsheet cell is a real value
    // that is not a category — distinguishable from a blank cell, which is
    // the difference between "fix this row" and "this row has no category".
    for (const raw of [0, 42, {}, []] as unknown[]) {
      const match = resolveCategory(raw);
      expect(match.ok, JSON.stringify(raw)).toBe(false);
      if (!match.ok) expect(match.error).toBe(Array.isArray(raw) ? "empty" : "unknown");
    }
  });

  it("refuses an unknown category and reports what it normalised to", () => {
    const match = resolveCategory("Digital Marketing");
    expect(match.ok).toBe(false);
    if (!match.ok) {
      expect(match.error).toBe("unknown");
      expect(match.normalized).toBe("digital-marketing");
      expect(match.message).toContain("digital-marketing");
    }
  });

  it("refuses the un-split stage banner rather than guessing in-person or virtual", () => {
    // "CATEGORY: OTHER PEOPLE'S STAGES" cannot choose between the two stage
    // categories, and guessing would file half of them under the wrong tile.
    expect(resolveCategory("Other People's Stages").ok).toBe(false);
  });

  it("never returns a category for an input it does not know (no silent fallback)", () => {
    const match = resolveCategory("Webinar Marketing Funnel Thing");
    expect(match.ok).toBe(false);
  });
});

describe("categoryLabel / categoryById / isCategoryId", () => {
  it("maps every id to its display label", () => {
    for (const category of CATEGORIES) {
      expect(categoryLabel(category.id)).toBe(category.label);
    }
  });

  it("returns the raw id for an unknown one rather than throwing or blanking", () => {
    // A renamed category should show as an odd tile, not a crashed page.
    expect(categoryLabel("made-up")).toBe("made-up");
    expect(categoryLabel(null)).toBe("");
    expect(categoryById("made-up")).toBeUndefined();
  });

  it("narrows a database read", () => {
    expect(isCategoryId("webinars")).toBe(true);
    expect(isCategoryId("Webinars")).toBe(false); // ids are slugs, not labels
    expect(isCategoryId(null)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Audience and path resolution
 * ------------------------------------------------------------------ */

describe("resolveRecordAudience", () => {
  it("reads the workbook's two clean values", () => {
    expect(resolveRecordAudience("OWN", cat("webinars"))).toBe("own");
    expect(resolveRecordAudience("OPS", cat("webinars"))).toBe("borrowed");
    expect(resolveRecordAudience("own", cat("webinars"))).toBe("own");
  });

  it("resolves the three OWN & OPS rows to borrowed, per the spec's Affiliate Launch ruling", () => {
    expect(resolveRecordAudience("OWN & OPS", cat("funnels-launches-promotions"))).toBe("borrowed");
    // The ampersand normalises to a separator, so the order of the two halves
    // is the only variation worth accepting.
    expect(resolveRecordAudience("OPS & OWN", cat("webinars"))).toBe("borrowed");
  });

  it("falls back to the category where the column is blank", () => {
    expect(resolveRecordAudience("", cat("other-peoples-stages-virtual"))).toBe("borrowed");
    expect(resolveRecordAudience(null, cat("your-own-event-in-person"))).toBe("own");
  });

  it("falls back to own where neither the column nor the category decides", () => {
    // The conservative end: a wrongly-borrowed own record asks who is hosting
    // a campaign nobody hosts.
    expect(resolveRecordAudience(null, cat("partnerships-referrals"))).toBe("own");
    expect(resolveRecordAudience("maybe", cat("webinars"))).toBe("own");
    // Paid Ads and Email are now mixed, so a blank row no longer borrows.
    expect(resolveRecordAudience(null, cat("paid-ads"))).toBe("own");
    expect(resolveRecordAudience(null, cat("email-text-mail"))).toBe("own");
    // An explicit OPS still makes a bought placement borrowed.
    expect(resolveRecordAudience("OPS", cat("paid-ads"))).toBe("borrowed");
  });

  it("falls back to own on the categories the designs made own-audience", () => {
    for (const id of ["sales-outreach", "content-media", "local-presence"] as const) {
      expect(resolveRecordAudience(null, cat(id)), id).toBe("own");
    }
  });
});

describe("availableConversionPaths", () => {
  it("keeps the contract's order, not the config's", () => {
    const paths = availableConversionPaths(
      { allowedPaths: ["calls", "offer"], audienceSource: "own" },
      cat("webinars")
    );
    expect(paths).toEqual(["offer", "calls"]);
    expect(CONVERSION_PATHS.indexOf("offer")).toBeLessThan(CONVERSION_PATHS.indexOf("calls"));
  });

  it("keeps leads on an own-audience record", () => {
    // CORRECTED: leads used to be borrowed-only. The owner's designs offer
    // "Collect leads" on Your Own Event — Virtual, Content & Media and Local
    // Presence, all own-audience.
    for (const id of ["your-own-event-virtual", "content-media", "local-presence", "webinars"] as const) {
      expect(
        availableConversionPaths({ allowedPaths: ["offer", "leads"], audienceSource: "own" }, cat(id)),
        id
      ).toEqual(["offer", "leads"]);
    }
  });

  it("keeps speaker-fee stage-only, whatever the audience", () => {
    for (const category of CATEGORIES) {
      for (const audienceSource of ["own", "borrowed"] as const) {
        const offered = availableConversionPaths(
          { allowedPaths: ["speaker-fee"], audienceSource },
          category
        );
        expect(offered.length > 0, `${category.id}/${audienceSource}`).toBe(
          STAGE_CATEGORY_IDS.includes(category.id)
        );
      }
    }
  });

  it("keeps leads on a borrowed-audience record", () => {
    expect(
      availableConversionPaths(
        { allowedPaths: ["offer", "leads"], audienceSource: "borrowed" },
        cat("webinars")
      )
    ).toEqual(["offer", "leads"]);
  });

  it("removes speaker-fee off a stage category, keeps it on one", () => {
    expect(
      availableConversionPaths(
        { allowedPaths: ["speaker-fee"], audienceSource: "borrowed" },
        cat("content-media")
      )
    ).toEqual([]);
    expect(
      availableConversionPaths(
        { allowedPaths: ["speaker-fee"], audienceSource: "borrowed" },
        cat("other-peoples-stages-in-person")
      )
    ).toEqual(["speaker-fee"]);
  });
});

describe("partnerBlockOf", () => {
  it("defaults both halves to true", () => {
    expect(partnerBlockOf({})).toEqual({ host: true, booking: true });
    expect(DEFAULT_PARTNER_BLOCK).toEqual({ host: true, booking: true });
    expect(Object.isFrozen(DEFAULT_PARTNER_BLOCK)).toBe(true);
  });

  it("honours Networking switching booking off while keeping the host", () => {
    expect(partnerBlockOf({ partnerBlock: { host: true, booking: false } })).toEqual({
      host: true,
      booking: false,
    });
  });
});

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

describe("FORM_SECTIONS / FORM_SLOT_ORDER", () => {
  it("is nine universal sections", () => {
    expect(FORM_SECTIONS).toHaveLength(9);
    expect(new Set(FORM_SECTIONS).size).toBe(9);
  });

  it("splices the category schema between shape and dates", () => {
    const i = FORM_SLOT_ORDER.indexOf(CATEGORY_SCHEMA_SLOT);
    expect(FORM_SLOT_ORDER[i - 1]).toBe("shape");
    expect(FORM_SLOT_ORDER[i + 1]).toBe("dates");
    expect(FORM_SLOT_ORDER).toHaveLength(10);
  });

  it("keeps the nine in order with the slot added, not reordered around it", () => {
    expect(FORM_SLOT_ORDER.filter((id) => id !== CATEGORY_SCHEMA_SLOT)).toEqual([...FORM_SECTIONS]);
  });
});

/* ------------------------------------------------------------------ *
 * resolveFormLayout — suppressed vs absent
 * ------------------------------------------------------------------ */

describe("resolveFormLayout: suppressed with a silent value vs not rendered at all", () => {
  it("suppresses Kind and still writes the value when one kind is allowed", () => {
    const layout = resolveFormLayout({
      config: config({ allowedKinds: ["one-time"] }),
      category: cat("email-text-mail"),
    });
    expect(layout.kind.state).toBe("suppressed");
    expect(silentValue(layout.kind)).toBe("one-time");
    expect(layout.effectiveKind).toBe("one-time");
    // The point: the caller MUST persist this, and the map is where it looks.
    expect(layout.silentValues.kind).toBe("one-time");
    expect(layout.slots.find((s) => s.id === "kind")?.rendered).toBe(false);
  });

  it("renders Kind when more than one is allowed, and writes nothing silently", () => {
    const layout = resolveFormLayout({
      config: config({ allowedKinds: ["one-time", "recurring"], allowedFrequencies: ["monthly"] }),
      category: cat("email-text-mail"),
    });
    expect(layout.kind.state).toBe("rendered");
    expect(layout.silentValues.kind).toBeUndefined();
    expect(layout.effectiveKind).toBeNull();
  });

  it("takes the answer when Kind renders, and ignores an answer outside the allowed set", () => {
    const base = {
      config: config({ allowedKinds: ["one-time", "ongoing"], ongoingLabel: "Evergreen" }),
      category: cat("webinars"),
    };
    expect(resolveFormLayout({ ...base, answers: { kind: "ongoing" } }).effectiveKind).toBe(
      "ongoing"
    );
    // "recurring" is not allowed here; an answer cannot smuggle it in.
    expect(resolveFormLayout({ ...base, answers: { kind: "recurring" } }).effectiveKind).toBeNull();
  });

  it("suppresses the pinned format and writes it — the clearest silent value", () => {
    // Was Your Own Event — In-Person, which now ASKS; the virtual twin is the
    // category that genuinely cannot be anything else.
    const layout = resolveFormLayout({
      config: config(),
      category: cat("your-own-event-virtual"),
    });
    expect(layout.format.state).toBe("suppressed");
    expect(silentValue(layout.format)).toBe("digital");
    expect(layout.silentValues.format).toBe("digital");
    expect(layout.formatDefault).toBeNull();
  });

  it("renders format with the in-person default on both In-Person categories", () => {
    for (const id of ["your-own-event-in-person", "other-peoples-stages-in-person"] as const) {
      const layout = resolveFormLayout({
        config: config({ allowedPaths: ["calls"], audienceSource: "borrowed" }),
        category: cat(id),
      });
      expect(layout.format.state, id).toBe("rendered");
      expect(layout.formatDefault, id).toBe("in-person");
      // A default is NOT a silent value: the user sees the field and the
      // answer that gets stored is theirs.
      expect(layout.silentValues.format, id).toBeUndefined();
    }
  });

  it("offers no default where format does not render", () => {
    expect(
      resolveFormLayout({ config: config(), category: cat("email-text-mail") }).formatDefault
    ).toBeNull();
    expect(
      resolveFormLayout({ config: config(), category: cat("webinars") }).formatDefault
    ).toBeNull();
  });

  it("marks format ABSENT, not suppressed, where the concept does not apply", () => {
    const layout = resolveFormLayout({ config: config(), category: cat("email-text-mail") });
    expect(layout.format.state).toBe("absent");
    expect(silentValue(layout.format)).toBeNull();
    // Nothing to persist. A default written here would be invented data.
    expect(layout.silentValues.format).toBeUndefined();
  });

  it("collects every silent value and nothing else", () => {
    const layout = resolveFormLayout({
      config: config({
        allowedKinds: ["recurring"],
        allowedPaths: ["offer"],
        allowedFrequencies: ["weekly"],
      }),
      category: cat("your-own-event-virtual"),
    });
    expect(layout.silentValues).toEqual({
      kind: "recurring",
      format: "digital",
      conversion_path: "offer",
      repeat_frequency: "weekly",
    });
    expect(Object.isFrozen(layout.silentValues)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * The per-record format override
 * ------------------------------------------------------------------ */

describe("resolveFormLayout: formatOverride", () => {
  it("pins hybrid on a record inside a category that asks", () => {
    // The spec's four "Hybrid Events" records. Hybrid is a property of the
    // RECORD, not of the category it sits in.
    const layout = resolveFormLayout({
      config: config({
        allowedPaths: ["calls"],
        audienceSource: "borrowed",
        formatOverride: "hybrid",
      }),
      category: cat("other-peoples-stages-in-person"),
    });
    expect(layout.format.state).toBe("suppressed");
    expect(silentValue(layout.format)).toBe("hybrid");
    expect(layout.silentValues.format).toBe("hybrid");
    // Suppressed, so there is no field to preselect.
    expect(layout.formatDefault).toBeNull();
  });

  it("leaves the record's neighbours in the same category untouched", () => {
    // The whole reason the override is per record: pinning the category would
    // take the other twelve In-Person stage records with it.
    const neighbour = resolveFormLayout({
      config: config({ allowedPaths: ["calls"], audienceSource: "borrowed" }),
      category: cat("other-peoples-stages-in-person"),
    });
    expect(neighbour.format.state).toBe("rendered");
    expect(neighbour.formatDefault).toBe("in-person");
  });

  it("beats all four category behaviours, not-asked included", () => {
    // `pinned-in-person` and `pinned-hybrid` are on no category (see the
    // CATEGORIES tests), so they are exercised against synthetic ones — the
    // behaviours exist in the union and the override must win over each.
    const behaviours = [
      { category: cat("your-own-event-in-person"), was: "asked" },
      { category: cat("webinars"), was: "pinned-digital" },
      { category: cat("email-text-mail"), was: "not-asked" },
      {
        category: { ...cat("local-presence"), formatBehaviour: "pinned-in-person" } as CanonicalCategory,
        was: "pinned-in-person",
      },
      {
        category: { ...cat("local-presence"), formatBehaviour: "pinned-hybrid" } as CanonicalCategory,
        was: "pinned-hybrid",
      },
    ] as const;

    for (const { category, was } of behaviours) {
      expect(category.formatBehaviour, was).toBe(was);
      const layout = resolveFormLayout({
        config: config({
          allowedPaths: ["calls"],
          audienceSource: "borrowed",
          formatOverride: "hybrid",
        }),
        category,
      });
      expect(layout.format.state, was).toBe("suppressed");
      expect(silentValue(layout.format), was).toBe("hybrid");
      // THE CASE THAT IS EASY TO GET WRONG: `not-asked` would otherwise leave
      // format absent and store nothing, losing the record's declared format.
      expect(layout.silentValues.format, was).toBe("hybrid");
      expect(layout.formatDefault, was).toBeNull();
    }
  });

  it("writes whichever of the three formats the record names", () => {
    for (const format of INITIATIVE_FORMATS) {
      const layout = resolveFormLayout({
        config: config({ formatOverride: format }),
        category: cat("email-text-mail"),
      });
      expect(layout.silentValues.format, format).toBe(format);
    }
  });

  it("says in its reason that it is the record, not the category, deciding", () => {
    const layout = resolveFormLayout({
      config: config({ formatOverride: "hybrid" }),
      category: cat("email-text-mail"),
    });
    if (layout.format.state !== "suppressed") throw new Error("expected suppressed");
    expect(layout.format.reason).toContain("This initiative");
  });
});

describe("resolveFormLayout: conversion path", () => {
  it("suppresses the question when one path survives the filters", () => {
    const layout = resolveFormLayout({
      config: config({ allowedPaths: ["offer", "speaker-fee"], audienceSource: "own" }),
      category: cat("webinars"),
    });
    // `speaker-fee` was removed by the stage rule, leaving one.
    expect(layout.availablePaths).toEqual(["offer"]);
    expect(layout.conversionPath.state).toBe("suppressed");
    expect(layout.effectivePath).toBe("offer");
    expect(layout.slots.find((s) => s.id === "conversion-path")?.rendered).toBe(false);
  });

  it("renders the question with the filtered options", () => {
    const layout = resolveFormLayout({
      config: config({
        allowedPaths: ["offer", "calls", "leads", "speaker-fee"],
        audienceSource: "borrowed",
      }),
      category: cat("other-peoples-stages-in-person"),
    });
    expect(layout.availablePaths).toEqual(["offer", "calls", "leads", "speaker-fee"]);
    expect(layout.conversionPath.state).toBe("rendered");
    expect(layout.effectivePath).toBeNull();
  });

  it("goes absent, never suppressed, when the filters leave nothing", () => {
    // Reachable only from a config validateLibraryConfig rejects. Absent,
    // because writing a guess would decide how the initiative makes money.
    const layout = resolveFormLayout({
      config: config({ allowedPaths: ["speaker-fee"], audienceSource: "borrowed" }),
      category: cat("paid-ads"),
    });
    expect(layout.availablePaths).toEqual([]);
    expect(layout.conversionPath.state).toBe("absent");
    expect(layout.silentValues.conversion_path).toBeUndefined();
  });
});

describe("resolveFormLayout: ongoing removes the event date and Timing", () => {
  it("drops both, as absent rather than suppressed", () => {
    const layout = resolveFormLayout({
      config: config({ allowedKinds: ["ongoing"], ongoingLabel: "Ongoing" }),
      category: cat("paid-ads"),
    });
    expect(layout.effectiveKind).toBe("ongoing");
    expect(layout.eventDate.state).toBe("absent");
    expect(layout.slots.find((s) => s.id === "timing")?.rendered).toBe(false);
    // No date is invented for either.
    expect(layout.silentValues.event_date).toBeUndefined();
  });

  it("keeps both on a non-ongoing record", () => {
    const layout = resolveFormLayout({
      config: config({ allowedKinds: ["one-time"] }),
      category: cat("your-own-event-in-person"),
    });
    expect(layout.eventDate.state).toBe("rendered");
    expect(layout.slots.find((s) => s.id === "timing")?.rendered).toBe(true);
  });

  it("drops them only once ongoing is actually answered", () => {
    const base = {
      config: config({ allowedKinds: ["one-time", "ongoing"], ongoingLabel: "Evergreen" }),
      category: cat("webinars"),
    };
    expect(resolveFormLayout(base).eventDate.state).toBe("rendered");
    expect(resolveFormLayout({ ...base, answers: { kind: "ongoing" } }).eventDate.state).toBe(
      "absent"
    );
  });
});

describe("resolveFormLayout: the workbook's Start Date / Event Date flags", () => {
  const layout = (over: Partial<LibraryRecordConfig>, kind?: "one-time" | "recurring" | "ongoing") =>
    resolveFormLayout({ config: config(over), category: cat("webinars"), answers: kind ? { kind } : {} });
  const states = (l: ReturnType<typeof resolveFormLayout>) => [l.activationDate.state, l.eventDate.state];

  it("start No / event Yes: event only", () => {
    expect(states(layout({ askStartDate: false, askEventDate: true }))).toEqual(["absent", "rendered"]);
  });

  it("start Yes / event No: start only, whatever the kind", () => {
    expect(states(layout({ askStartDate: true, askEventDate: false }))).toEqual(["rendered", "absent"]);
    expect(states(layout({ allowedKinds: ["recurring"], allowedFrequencies: ["monthly"], askStartDate: true, askEventDate: false })))
      .toEqual(["rendered", "absent"]);
  });

  it("both Yes, and both unset (today's behaviour): both", () => {
    expect(states(layout({ askStartDate: true, askEventDate: true }))).toEqual(["rendered", "rendered"]);
    expect(states(layout({}))).toEqual(["rendered", "rendered"]);
  });

  it("ongoing with no event and start No still asks the start date (it needs a launch date)", () => {
    const ongoing = { allowedKinds: ["ongoing"] as const, ongoingLabel: "Evergreen", askStartDate: false };
    expect(states(layout({ ...ongoing, askEventDate: true }))).toEqual(["rendered", "absent"]);
    expect(states(layout({ ...ongoing, askEventDate: false }))).toEqual(["rendered", "absent"]);
  });

  it("the ongoing exception follows the answered kind", () => {
    const over = {
      allowedKinds: ["one-time", "ongoing"] as const, ongoingLabel: "Evergreen",
      askStartDate: false, askEventDate: true,
    };
    expect(states(layout(over, "one-time"))).toEqual(["absent", "rendered"]);
    expect(states(layout(over, "ongoing"))).toEqual(["rendered", "absent"]);
  });

  it("the close date is unaffected", () => {
    const l = layout({ askStartDate: false, askEventDate: false });
    expect(l.closeDate.rendered).toBe(true);
    expect(l.closeDate.variant).toBe("undecided");
  });
});

describe("resolveFormLayout: frequency", () => {
  it("suppresses the question when a recurring record allows one frequency", () => {
    const layout = resolveFormLayout({
      config: config({ allowedKinds: ["recurring"], allowedFrequencies: ["monthly"] }),
      category: cat("email-text-mail"),
    });
    expect(layout.frequency.state).toBe("suppressed");
    expect(layout.silentValues.repeat_frequency).toBe("monthly");
  });

  it("renders it when more than one is allowed", () => {
    const layout = resolveFormLayout({
      config: config({ allowedKinds: ["recurring"], allowedFrequencies: ["weekly", "monthly"] }),
      category: cat("email-text-mail"),
    });
    expect(layout.frequency.state).toBe("rendered");
  });

  it("is absent on a run that does not repeat, so the forecast cannot repeat it", () => {
    const layout = resolveFormLayout({
      config: config({ allowedKinds: ["one-time"], allowedFrequencies: [] }),
      category: cat("email-text-mail"),
    });
    expect(layout.frequency.state).toBe("absent");
    expect(layout.silentValues.repeat_frequency).toBeUndefined();
  });
});

describe("resolveFormLayout: ongoingLabel", () => {
  it("uses the record's word, because Evergreen and Ongoing are different products", () => {
    expect(
      resolveFormLayout({
        config: config({ allowedKinds: ["one-time", "ongoing"], ongoingLabel: "Evergreen" }),
        category: cat("webinars"),
      }).ongoingLabel
    ).toBe("Evergreen");
  });

  it("falls back to Ongoing when the record gives no word", () => {
    expect(
      resolveFormLayout({ config: config(), category: cat("paid-ads") }).ongoingLabel
    ).toBe(DEFAULT_ONGOING_LABEL);
    // Whitespace is not a word.
    expect(
      resolveFormLayout({
        config: config({ allowedKinds: ["ongoing"], ongoingLabel: "   " }),
        category: cat("paid-ads"),
      }).ongoingLabel
    ).toBe("Ongoing");
  });
});

describe("resolveFormLayout: close date", () => {
  it("always attaches", () => {
    for (const id of CATEGORIES.map((c) => c.id)) {
      const layout = resolveFormLayout({
        config: config({ allowedPaths: ["calls"] }),
        category: cat(id),
      });
      expect(layout.closeDate.rendered, id).toBe(true);
    }
  });

  it("uses one of four labels, by conversion path", () => {
    const labelFor = (path: "offer" | "calls" | "leads" | "speaker-fee") =>
      resolveFormLayout({
        config: config({
          allowedPaths: [path],
          audienceSource: path === "offer" || path === "calls" ? "own" : "borrowed",
        }),
        category:
          path === "speaker-fee" || path === "leads"
            ? cat("other-peoples-stages-in-person")
            : cat("webinars"),
      }).closeDate.label;

    expect(labelFor("offer")).toBe(CLOSE_DATE_LABELS.offer);
    expect(labelFor("calls")).toBe(CLOSE_DATE_LABELS.calls);
    expect(labelFor("leads")).toBe(CLOSE_DATE_LABELS.leads);
    expect(labelFor("speaker-fee")).toBe(CLOSE_DATE_LABELS["speaker-fee"]);
    expect(new Set(Object.values(CLOSE_DATE_LABELS)).size).toBe(4);
  });

  it("lets kind = ongoing override the path rule", () => {
    const layout = resolveFormLayout({
      config: config({ allowedKinds: ["ongoing"], allowedPaths: ["offer"], ongoingLabel: "Ongoing" }),
      category: cat("paid-ads"),
    });
    // The path says offer, but there is no run that ends.
    expect(layout.effectivePath).toBe("offer");
    expect(layout.closeDate.label).toBe(CLOSE_DATE_LABEL_ONGOING);
  });

  it("treats 'I don't know yet' as an undecided path: null, generic label, no path blocks", () => {
    const base = {
      config: config({
        allowedPaths: ["offer", "calls", "leads", "speaker-fee"],
        audienceSource: "borrowed",
      }),
      category: cat("other-peoples-stages-in-person"),
    };
    const layout = resolveFormLayout({ ...base, answers: { conversionPath: ASK_UNDECIDED } });
    expect(ASK_UNDECIDED).toBe("undecided");
    expect(CONVERSION_PATHS).not.toContain(ASK_UNDECIDED);
    expect(layout.conversionPath.state).toBe("rendered");
    expect(layout.effectivePath).toBeNull();
    expect(layout.closeDate).toMatchObject({ label: "When does it close?", required: false, variant: "undecided" });
    expect(attachedBlocks(layout)).not.toContain("cart");
    expect(attachedBlocks(layout)).not.toContain("lead-handoff");
    expect(layout.silentValues.conversion_path).toBeUndefined();
    // The partner block is not path-gated, so it still attaches.
    expect(attachedBlocks(layout)).toContain("partner-host");
    // Identical to not having answered at all.
    expect(layout).toEqual(resolveFormLayout(base));
  });

  it("offers 'I don't know yet' on Other People's Stages — In-Person only", () => {
    expect(ASK_UNDECIDED_CATEGORY_IDS).toEqual(["other-peoples-stages-in-person"]);
    expect(CATEGORIES.filter((c) => offersAskUndecided(c.id)).map((c) => c.id)).toEqual([
      "other-peoples-stages-in-person",
    ]);
  });

  it("stays generic until the path is answered, rather than guessing and jumping", () => {
    const layout = resolveFormLayout({
      config: config({ allowedPaths: ["offer", "calls"] }),
      category: cat("webinars"),
    });
    expect(layout.effectivePath).toBeNull();
    expect(layout.closeDate.label).toBe(CLOSE_DATE_LABEL_UNDECIDED);
    expect(layout.closeDate.required).toBe(false);
  });

  it("uses the spec's exact labels, and only leads (and undecided) is optional", () => {
    const at = (path: "offer" | "calls" | "leads" | "speaker-fee") =>
      resolveFormLayout({
        config: config({
          allowedPaths: [path],
          audienceSource: path === "offer" || path === "calls" ? "own" : "borrowed",
        }),
        category:
          path === "speaker-fee" || path === "leads" ? cat("other-peoples-stages-in-person") : cat("webinars"),
      }).closeDate;
    expect(at("offer")).toMatchObject({ label: "Cart closes", required: true });
    expect(at("calls")).toMatchObject({ label: "When does this round of calls close?", required: true });
    expect(at("leads")).toMatchObject({ label: "Does this offer expire?", required: false });
    expect(at("speaker-fee")).toMatchObject({ label: "Final payment due", required: true });
    expect(CLOSE_DATE_COPY.offer.empty).toBe("Enter the cart close date.");
    expect(CLOSE_DATE_COPY.calls.empty).toBe("Enter when this round of calls closes.");
    expect(CLOSE_DATE_COPY.ongoing.empty).toBe("Enter when this initiative ends.");
  });

  it("ongoing overrides even the optional leads path, and is required", () => {
    const layout = resolveFormLayout({
      config: config({ allowedKinds: ["ongoing"], allowedPaths: ["leads"], audienceSource: "borrowed" }),
      category: cat("other-peoples-stages-in-person"),
    });
    expect(layout.effectivePath).toBe("leads");
    expect(layout.closeDate).toMatchObject({
      variant: "ongoing",
      label: "When does this initiative end?",
      required: true,
    });
  });
});

describe("resolveFormLayout: conditional blocks", () => {
  it("attaches the cart on the offer path only", () => {
    const offer = resolveFormLayout({
      config: config({ allowedPaths: ["offer"] }),
      category: cat("webinars"),
    });
    expect(attachedBlocks(offer)).toContain("cart");
    const calls = resolveFormLayout({
      config: config({ allowedPaths: ["calls"] }),
      category: cat("webinars"),
    });
    expect(attachedBlocks(calls)).not.toContain("cart");
  });

  it("attaches lead handoff on the leads path only", () => {
    const leads = resolveFormLayout({
      config: config({ allowedPaths: ["leads"], audienceSource: "borrowed" }),
      category: cat("other-peoples-stages-virtual"),
    });
    expect(attachedBlocks(leads)).toContain("lead-handoff");
    const offer = resolveFormLayout({
      config: config({ allowedPaths: ["offer"] }),
      category: cat("webinars"),
    });
    expect(attachedBlocks(offer)).not.toContain("lead-handoff");
  });

  // CORRECTED: the block used to need a borrowed audience AND a stage
  // category. The owner's designs: "What calls for the block is a named
  // partner on a set date, not the format."
  it("attaches the partner block on a borrowed record, stage or not", () => {
    for (const id of [
      "other-peoples-stages-in-person",
      "other-peoples-stages-virtual",
      // Bought placements: a podcast ad, a newsletter ad.
      "paid-ads",
      // Solo ads, sponsored sends, a partner's dedicated send.
      "email-text-mail",
    ] as const) {
      const layout = resolveFormLayout({
        config: config({ allowedPaths: ["calls"], audienceSource: "borrowed" }),
        category: cat(id),
      });
      expect(attachedBlocks(layout), id).toContain("partner-host");
      expect(attachedBlocks(layout), id).toContain("partner-booking");
      expect(bookingStatusWritten(layout), id).toBe(true);
    }
  });

  it("never attaches the partner block on an own-audience record", () => {
    // Your Own Event: "No partner block, no booking status". Sales & Outreach:
    // "no Partner block". And a record that overrides a stage category to own.
    for (const category of CATEGORIES) {
      const layout = resolveFormLayout({
        config: config({ allowedPaths: ["calls"], audienceSource: "own" }),
        category,
      });
      expect(attachedBlocks(layout), category.id).not.toContain("partner-host");
      expect(attachedBlocks(layout), category.id).not.toContain("partner-booking");
      expect(bookingStatusWritten(layout), category.id).toBe(false);
    }
  });

  it("gives a borrowed Partnerships & Referrals record the affiliate block, not the partner block", () => {
    // "Many partners at once, so who's hosting? and is it booked? don't apply."
    const layout = resolveFormLayout({
      config: config({ allowedPaths: ["calls"], audienceSource: "borrowed" }),
      category: cat("partnerships-referrals"),
    });
    expect(attachedBlocks(layout)).not.toContain("partner-host");
    expect(attachedBlocks(layout)).not.toContain("partner-booking");
    expect(attachedBlocks(layout)).toContain("affiliate");
    expect(bookingStatusWritten(layout)).toBe(false);
    expect(PARTNER_BLOCK_EXCLUDED_CATEGORY_IDS).toEqual([
      "funnels-launches-promotions",
      "partnerships-referrals",
    ]);
  });

  it("gives a borrowed Funnels record (Affiliate Launch) the affiliate block, not the partner block", () => {
    // Funnels, "When partners are involved": "The Affiliate block, not the
    // Partner block — many partners, no single host, so who's hosting?
    // doesn't apply."
    const funnels = cat("funnels-launches-promotions");
    // Affiliate Launch is "OWN & OPS", which resolves to borrowed.
    const audienceSource = resolveRecordAudience("OWN & OPS", funnels);
    expect(audienceSource).toBe("borrowed");
    const layout = resolveFormLayout({
      config: config({ allowedPaths: ["calls"], audienceSource }),
      category: funnels,
    });
    expect(attachedBlocks(layout)).not.toContain("partner-host");
    expect(attachedBlocks(layout)).not.toContain("partner-booking");
    expect(attachedBlocks(layout)).toContain("affiliate");
    expect(bookingStatusWritten(layout)).toBe(false);
  });

  it("gates host and booking SEPARATELY", () => {
    const layout = resolveFormLayout({
      config: config({
        allowedPaths: ["calls"],
        audienceSource: "borrowed",
        // The spec's Networking case.
        partnerBlock: { host: true, booking: false },
      }),
      category: cat("other-peoples-stages-in-person"),
    });
    expect(attachedBlocks(layout)).toContain("partner-host");
    expect(attachedBlocks(layout)).not.toContain("partner-booking");
  });

  it("never lets booking_status be written when booking is suppressed", () => {
    // THE RULE THAT MATTERS: the task templates swap on booking_status, so a
    // value written for a record that never asked swaps in the wrong tasks.
    const noBooking = resolveFormLayout({
      config: config({
        allowedPaths: ["calls"],
        audienceSource: "borrowed",
        partnerBlock: { host: true, booking: false },
      }),
      category: cat("other-peoples-stages-in-person"),
    });
    expect(bookingStatusWritten(noBooking)).toBe(false);
    expect(noBooking.silentValues.booking_status).toBeUndefined();

    const withBooking = resolveFormLayout({
      config: config({ allowedPaths: ["calls"], audienceSource: "borrowed" }),
      category: cat("other-peoples-stages-in-person"),
    });
    expect(bookingStatusWritten(withBooking)).toBe(true);
  });

  it("never writes booking_status on an own-audience email record", () => {
    const layout = resolveFormLayout({ config: config(), category: cat("email-text-mail") });
    expect(bookingStatusWritten(layout)).toBe(false);
  });

  it("attaches the affiliate block on many-partner categories", () => {
    expect(
      attachedBlocks(
        resolveFormLayout({ config: config(), category: cat("funnels-launches-promotions") })
      )
    ).toContain("affiliate");
    expect(
      attachedBlocks(resolveFormLayout({ config: config(), category: cat("partnerships-referrals") }))
    ).toContain("affiliate");
    expect(
      attachedBlocks(resolveFormLayout({ config: config(), category: cat("email-text-mail") }))
    ).not.toContain("affiliate");
  });

  it("never attaches a VIP block (client, Oct 2026: VIP deleted)", () => {
    for (const id of [
      "webinars",
      "funnels-launches-promotions",
      "your-own-event-in-person",
      "your-own-event-virtual",
      "paid-ads",
    ] as const) {
      expect(attachedBlocks(resolveFormLayout({ config: config(), category: cat(id) })), id).not.toContain("vip");
    }
  });

  it("reports every block either way, with a reason, not just the attached ones", () => {
    // The admin editor and the renderer both need to say WHY a block is absent.
    const layout = resolveFormLayout({ config: config(), category: cat("webinars") });
    // Five since the VIP block was deleted (client, Oct 2026).
    expect(layout.blocks).toHaveLength(5);
    for (const block of layout.blocks) expect(block.reason).not.toBe("");
  });
});

describe("resolveFormLayout: totality", () => {
  it("never throws, for any category, with no answers at all", () => {
    for (const category of CATEGORIES) {
      expect(() =>
        resolveFormLayout({ config: config({ allowedPaths: ["calls"] }), category })
      ).not.toThrow();
    }
  });

  it("returns all ten slots in order every time", () => {
    const layout = resolveFormLayout({ config: config(), category: cat("webinars") });
    expect(layout.slots.map((s) => s.id)).toEqual([...FORM_SLOT_ORDER]);
  });

  it("renders the extras section only when the record has extras", () => {
    expect(
      resolveFormLayout({ config: config(), category: cat("webinars") }).slots.find(
        (s) => s.id === "extras"
      )?.rendered
    ).toBe(false);
    expect(
      resolveFormLayout({
        config: config({ fieldExtras: [{ key: "room_size", label: "Room size", readBy: "forecast" }] }),
        category: cat("webinars"),
      }).slots.find((s) => s.id === "extras")?.rendered
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

describe("validateLibraryConfig", () => {
  it("accepts a plain record", () => {
    expect(validateLibraryConfig(config(), cat("email-text-mail"))).toEqual({ ok: true });
  });

  it("accepts a fully loaded record", () => {
    const result = validateLibraryConfig(
      config({
        initiativeKey: "paid-webinar-launch",
        allowedKinds: ["one-time", "recurring"],
        allowedPaths: ["offer", "calls"],
        audienceSource: "own",
        allowedFrequencies: ["monthly", "quarterly"],
        revenueLines: [
          { id: "core", priceSource: "product.price", windowOpens: "cart_opens", windowCloses: "cart_closes" },
          { id: "upsell", priceSource: "attrs.entry_price", windowOpens: "cart_opens", windowCloses: "event_date" },
        ],
        fieldExtras: [
          { key: "seats", label: "Seats", readBy: "forecast" },
          { key: "venue", label: "Venue", readBy: "task templates" },
        ],
      }),
      cat("webinars")
    );
    expect(result).toEqual({ ok: true });
  });

  it("refuses an empty allowedKinds", () => {
    expect(codes(validateLibraryConfig(config({ allowedKinds: [] }), cat("webinars")))).toContain(
      "no_kinds"
    );
  });

  it("refuses an empty allowedPaths", () => {
    expect(codes(validateLibraryConfig(config({ allowedPaths: [] }), cat("webinars")))).toContain(
      "no_paths"
    );
  });

  it("accepts leads on an own-audience record", () => {
    // CORRECTED: this used to be refused (leads_on_own_audience, now removed).
    // The owner's designs offer "Collect leads" on own-audience categories.
    for (const id of ["your-own-event-virtual", "content-media", "local-presence"] as const) {
      expect(
        codes(
          validateLibraryConfig(
            config({ allowedPaths: ["offer", "leads"], audienceSource: "own" }),
            cat(id)
          )
        ),
        id
      ).toEqual([]);
    }
  });

  it("allows leads on a borrowed-audience record", () => {
    expect(
      codes(
        validateLibraryConfig(
          config({ allowedPaths: ["leads"], audienceSource: "borrowed" }),
          cat("content-media")
        )
      )
    ).toEqual([]);
  });

  it("refuses speaker-fee off a stage category", () => {
    const result = validateLibraryConfig(
      config({ allowedPaths: ["speaker-fee"], audienceSource: "borrowed" }),
      cat("content-media")
    );
    expect(codes(result)).toContain("speaker_fee_off_stage");
  });

  it("allows speaker-fee on a stage category", () => {
    expect(
      codes(
        validateLibraryConfig(
          config({ allowedPaths: ["speaker-fee"], audienceSource: "borrowed" }),
          cat("other-peoples-stages-virtual")
        )
      )
    ).toEqual([]);
  });

  it("refuses a record whose every allowed path is filtered away", () => {
    // Distinct from no_paths: the admin did allow one, and the rules took it.
    const result = validateLibraryConfig(
      config({ allowedPaths: ["speaker-fee"], audienceSource: "borrowed" }),
      cat("webinars")
    );
    expect(codes(result)).toContain("no_paths_available");
  });

  it("refuses a fourth field extra", () => {
    const extras = [1, 2, 3, 4].map((n) => ({ key: `k${n}`, label: `L${n}`, readBy: "forecast" }));
    expect(MAX_FIELD_EXTRAS).toBe(3);
    expect(codes(validateLibraryConfig(config({ fieldExtras: extras }), cat("webinars")))).toContain(
      "too_many_extras"
    );
    // Exactly three is fine; the ceiling is inclusive.
    expect(
      codes(validateLibraryConfig(config({ fieldExtras: extras.slice(0, 3) }), cat("webinars")))
    ).toEqual([]);
  });

  it("checks extra types and their links to the cart dates", () => {
    const v = (fieldExtras: LibraryRecordConfig["fieldExtras"], over: Partial<LibraryRecordConfig> = {}) =>
      codes(validateLibraryConfig(config({ fieldExtras, ...over }), cat("funnels-launches-promotions")));
    const pitch = { key: "pitch_day", label: "Pitch day", readBy: "cart", type: "date" as const, derives: "cart.opens" as const };
    expect(v([pitch])).toEqual([]);
    expect(v([{ key: "n", label: "N", readBy: "x", type: "colour" as never }])).toEqual(["unknown_extra_type"]);
    // A link must be a date, must not both bind and derive, and needs the offer path.
    expect(v([{ ...pitch, type: "text" }])).toEqual(["invalid_extra_link"]);
    expect(v([{ ...pitch, binds: "cart.opens" }])).toEqual(["invalid_extra_link"]);
    expect(v([pitch], { allowedPaths: ["calls"] })).toEqual(["invalid_extra_link"]);
    expect(v([pitch, { ...pitch, key: "webinar_date" }])).toEqual(["invalid_extra_link"]);
    expect(
      v([
        { key: "o", label: "Cart opens", readBy: "x", type: "date", binds: "cart.opens" },
        { key: "c", label: "Cart closes", readBy: "x", type: "date", binds: "dates.close" },
      ])
    ).toEqual([]);
  });

  it("does not render the extras slot for extras that are all bound", () => {
    const layout = resolveFormLayout({
      config: config({ fieldExtras: [{ key: "o", label: "Cart opens", readBy: "x", type: "date", binds: "cart.opens" }] }),
      category: cat("funnels-launches-promotions"),
    });
    expect(layout.slots.find((s) => s.id === "extras")?.rendered).toBe(false);
  });

  it("refuses two extras writing to the same key", () => {
    expect(
      codes(
        validateLibraryConfig(
          config({
            fieldExtras: [
              { key: "seats", label: "Seats", readBy: "forecast" },
              { key: "seats", label: "Capacity", readBy: "tasks" },
            ],
          }),
          cat("webinars")
        )
      )
    ).toContain("duplicate_extra_key");
  });

  it("refuses a cart window on a record whose paths exclude offer", () => {
    const result = validateLibraryConfig(
      config({
        allowedPaths: ["calls"],
        revenueLines: [
          { id: "core", priceSource: "product.price", windowOpens: "cart_opens", windowCloses: "cart_closes" },
        ],
      }),
      cat("webinars")
    );
    expect(codes(result)).toEqual([
      "impossible_revenue_window",
      "impossible_revenue_window",
    ]);
    if (!result.ok) {
      // Both edges are reported, each pointing at its own field.
      expect(result.problems.map((p) => p.field)).toEqual([
        "revenueLines.core.windowOpens",
        "revenueLines.core.windowCloses",
      ]);
      expect(result.problems[0].message).toContain("no cart without the offer path");
    }
  });

  it("refuses an event date on an ongoing-only record", () => {
    const result = validateLibraryConfig(
      config({
        allowedKinds: ["ongoing"],
        ongoingLabel: "Ongoing",
        allowedPaths: ["offer"],
        revenueLines: [
          { id: "core", priceSource: "product.price", windowOpens: "event_date", windowCloses: "close_date" },
        ],
      }),
      cat("paid-ads")
    );
    expect(codes(result)).toContain("impossible_revenue_window");
  });

  it("allows an event date on a record that is only SOMETIMES ongoing", () => {
    // "Only ongoing", not "ongoing is allowed": the one-time runs have an event.
    expect(
      codes(
        validateLibraryConfig(
          config({
            allowedKinds: ["one-time", "ongoing"],
            ongoingLabel: "Evergreen",
            allowedPaths: ["offer"],
            revenueLines: [
              { id: "core", priceSource: "product.price", windowOpens: "event_date", windowCloses: "close_date" },
            ],
          }),
          cat("webinars")
        )
      )
    ).toEqual([]);
  });

  it("refuses contract terms on an own-audience record and allows them on a borrowed one", () => {
    const line = {
      id: "fee",
      priceSource: "host_fee",
      windowOpens: "contract_terms",
      windowCloses: "close_date",
    } as const;
    expect(
      codes(
        validateLibraryConfig(
          config({ allowedPaths: ["calls"], audienceSource: "own", revenueLines: [line] }),
          cat("webinars")
        )
      )
    ).toContain("impossible_revenue_window");
    expect(
      codes(
        validateLibraryConfig(
          config({
            allowedPaths: ["speaker-fee"],
            audienceSource: "borrowed",
            revenueLines: [line],
          }),
          cat("other-peoples-stages-in-person")
        )
      )
    ).toEqual([]);
  });

  it("always allows a close-date window", () => {
    expect(
      codes(
        validateLibraryConfig(
          config({
            allowedKinds: ["ongoing"],
            ongoingLabel: "Ongoing",
            allowedPaths: ["calls"],
            revenueLines: [
              { id: "x", priceSource: "product.price", windowOpens: "close_date", windowCloses: "close_date" },
            ],
          }),
          cat("paid-ads")
        )
      )
    ).toEqual([]);
  });

  it("refuses two revenue lines with the same id", () => {
    expect(
      codes(
        validateLibraryConfig(
          config({
            allowedPaths: ["offer"],
            revenueLines: [
              { id: "core", priceSource: "product.price", windowOpens: "cart_opens", windowCloses: "cart_closes" },
              { id: "core", priceSource: "attrs.entry_price", windowOpens: "cart_opens", windowCloses: "cart_closes" },
            ],
          }),
          cat("webinars")
        )
      )
    ).toContain("duplicate_revenue_line_id");
  });

  it("refuses an ongoingLabel when ongoing is not an allowed kind", () => {
    expect(
      codes(
        validateLibraryConfig(
          config({ allowedKinds: ["one-time"], ongoingLabel: "Evergreen" }),
          cat("webinars")
        )
      )
    ).toContain("ongoing_label_without_ongoing");
  });

  it("refuses frequencies when recurring is not allowed, and demands one when it is", () => {
    expect(
      codes(
        validateLibraryConfig(
          config({ allowedKinds: ["one-time"], allowedFrequencies: ["weekly"] }),
          cat("webinars")
        )
      )
    ).toContain("frequencies_without_recurring");
    expect(
      codes(
        validateLibraryConfig(
          config({ allowedKinds: ["recurring"], allowedFrequencies: [] }),
          cat("webinars")
        )
      )
    ).toContain("recurring_without_frequency");
  });

  it("accepts a format override on every category behaviour, including not-asked", () => {
    // An override exists to express an exception, and the strongest exception
    // is a fixed format inside a category that never asks.
    for (const id of [
      "your-own-event-in-person", // asked
      "webinars", // pinned-digital
      "email-text-mail", // not-asked
    ] as const) {
      expect(
        codes(
          validateLibraryConfig(
            config({ allowedPaths: ["calls"], formatOverride: "hybrid" }),
            cat(id)
          )
        ),
        id
      ).toEqual([]);
    }
  });

  it("refuses an override equal to what the category already pins", () => {
    // Redundant, so it is not configuration but noise — and it survives a
    // change of mind: re-pin the category and the dead override silently
    // becomes a live one nobody chose.
    const result = validateLibraryConfig(
      config({ allowedPaths: ["calls"], formatOverride: "digital" }),
      cat("webinars")
    );
    expect(codes(result)).toContain("redundant_format_override");
    if (!result.ok) {
      expect(result.problems.find((p) => p.code === "redundant_format_override")?.field).toBe(
        "formatOverride"
      );
    }
    // The same value where the category does NOT pin it is a real exception.
    expect(
      codes(
        validateLibraryConfig(
          config({ allowedPaths: ["calls"], formatOverride: "digital" }),
          cat("your-own-event-in-person")
        )
      )
    ).toEqual([]);
  });

  it("refuses a format outside the closed vocabulary", () => {
    expect(
      codes(
        validateLibraryConfig(
          config({ allowedPaths: ["calls"], formatOverride: "virtual" as never }),
          cat("webinars")
        )
      )
    ).toEqual(["unknown_format"]);
  });

  it("refuses a config with no initiative_key, because that is the only key there is", () => {
    // workbook_id is not usable: 76 distinct ids over 87 rows, two formats.
    expect(codes(validateLibraryConfig(config({ initiativeKey: "  " }), cat("webinars")))).toContain(
      "missing_initiative_key"
    );
  });

  it("refuses values outside the closed vocabularies", () => {
    const result = validateLibraryConfig(
      config({
        allowedKinds: ["forever" as never],
        allowedPaths: ["barter" as never],
      }),
      cat("webinars")
    );
    expect(codes(result)).toContain("unknown_kind");
    expect(codes(result)).toContain("unknown_path");
  });

  it("reports EVERY problem at once, not the first", () => {
    // An admin editing 87 records should not get one error per save.
    const result = validateLibraryConfig(
      config({
        initiativeKey: "",
        allowedKinds: [],
        allowedPaths: [],
        fieldExtras: [1, 2, 3, 4].map((n) => ({ key: `k${n}`, label: `L${n}`, readBy: "x" })),
        ongoingLabel: "Evergreen",
      }),
      cat("webinars")
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toEqual([
        "missing_initiative_key",
        "no_kinds",
        "no_paths",
        "too_many_extras",
        "ongoing_label_without_ongoing",
      ]);
      // Every problem names the field the editor should highlight.
      for (const problem of result.problems) expect(problem.field).not.toBe("");
    }
  });
});
