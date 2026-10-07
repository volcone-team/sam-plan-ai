import { describe, it, expect } from "vitest";
import {
  PICKER_GROUPS,
  groupFor,
  labelFor,
  groupInitiatives,
  byKey,
  requiresSalesCalls,
  platformOf,
  type LibraryInitiative,
} from "./library";

/**
 * Fixtures are the REAL rows from `wb_initiative_library`, taken from the
 * database backup. Invented keys are what made the funnel label overrides miss
 * silently, so the categories and slugs here are copied verbatim rather than
 * guessed at.
 */

function entry(over: Partial<LibraryInitiative> & { key: string }): LibraryInitiative {
  return {
    name: over.key,
    category: null,
    oneLiner: null,
    ownOrOps: null,
    priceTier: null,
    difficulty: null,
    speedToResults: null,
    needsSalesTeam: null,
    ...over,
  };
}

const WEBINAR = entry({
  key: "webinar",
  name: "Live Webinar",
  category: "Virtual Live Video Events",
  ownOrOps: "OPS",
  needsSalesTeam: "POSSIBLY",
  oneLiner: "Teach live and sell at the end.",
});

const OWN_EVENT = entry({
  key: "your-own-event",
  name: "Your Own Event",
  category: "Large Format",
  ownOrOps: "OWN",
  needsSalesTeam: "POSSIBLY",
});

const SALES_CALLS = entry({
  key: "sales-calls",
  name: "Sales Calls",
  category: "YOUR OWN STAGES - OWN -DIGITAL",
  ownOrOps: "OWN",
  needsSalesTeam: "YES",
});

const PAID_ADS = entry({
  key: "paid-ads",
  name: "Paid Ads",
  category: "YOUR OWN STAGES - OWN -DIGITAL",
  ownOrOps: "OWN",
  needsSalesTeam: "POSSIBLY",
});

const PODCAST = entry({
  key: "podcast-vodcast-guest",
  name: "Podcast/Vodcast Guest",
  category: "Series",
  ownOrOps: "OPS",
  needsSalesTeam: "NO",
});

const MEMBERSHIPS = entry({
  key: "courses-memberships",
  name: "Courses & Memberships",
  category: "MRR",
  ownOrOps: "OPS",
});

const AFFILIATE = entry({
  key: "affiliate-launches",
  name: "Affiliate Launches",
  category: "YOUR OWN STAGES - OWN -DIGITAL",
  ownOrOps: "OWN & OPS",
  needsSalesTeam: "POSSIBLY",
});

const TICKET_MAP = entry({
  key: "ticket-map-virtual",
  name: "Virtual Ticket Strategy",
  category: "Ticket Map",
});

const ALL = [
  WEBINAR,
  OWN_EVENT,
  SALES_CALLS,
  PAID_ADS,
  PODCAST,
  MEMBERSHIPS,
  AFFILIATE,
];

describe("groupFor", () => {
  it("maps the workbook's own category strings to readable headings", () => {
    expect(groupFor(WEBINAR)).toBe("Virtual Events");
    expect(groupFor(OWN_EVENT)).toBe("In-Person Events");
    expect(groupFor(PAID_ADS)).toBe("Digital Marketing");
    expect(groupFor(MEMBERSHIPS)).toBe("Recurring Revenue");
  });

  /**
   * The workbook files eleven unrelated things under one digital heading. Sales
   * calls and referrals are selling, not marketing, so they are split out —
   * otherwise the user scans a single eleven-item list that mixes both.
   */
  it("splits selling out of the catch-all digital category", () => {
    expect(groupFor(SALES_CALLS)).toBe("Sales & Referrals");
    expect(groupFor(entry({ key: "referral", category: "YOUR OWN STAGES - OWN -DIGITAL" })))
      .toBe("Sales & Referrals");
    // Its category stays Digital Marketing for everything else in the sheet.
    expect(groupFor(PAID_ADS)).toBe("Digital Marketing");
  });

  it("regroups the podcast as media rather than a series", () => {
    expect(groupFor(PODCAST)).toBe("Content & Media");
  });

  it("is insensitive to a casing change in the workbook", () => {
    expect(groupFor(entry({ key: "x", category: "virtual live video events" })))
      .toBe("Virtual Events");
    expect(groupFor(entry({ key: "y", category: "VIRTUAL LIVE VIDEO EVENTS" })))
      .toBe("Virtual Events");
  });

  /**
   * The workbook is re-uploadable, so an unrecognised category is routine
   * rather than exceptional. It must still appear: an initiative the user
   * cannot find is worse than one under an odd heading.
   */
  it("files an unknown or missing category under Other", () => {
    expect(groupFor(entry({ key: "new", category: "Some New Sheet" }))).toBe("Other");
    expect(groupFor(entry({ key: "none", category: null }))).toBe("Other");
  });

  it("only ever returns a declared group", () => {
    for (const initiative of ALL) {
      expect(PICKER_GROUPS).toContain(groupFor(initiative));
    }
  });
});

describe("labelFor", () => {
  /**
   * REQ-8.4's condition — "where a name exists as both OPS and OWN" — is
   * load-bearing. Suffixing unconditionally produces "Courses & Memberships
   * (on someone else's platform)", which asserts something untrue about a
   * membership. The suffix only earns its place when the user genuinely cannot
   * tell two identically-named entries apart.
   */
  it("suffixes both variants when a name is carried twice", () => {
    const pair = [
      entry({ key: "webinar-own", name: "Live Webinar", ownOrOps: "OWN" }),
      entry({ key: "webinar-ops", name: "Live Webinar", ownOrOps: "OPS" }),
    ];
    expect(labelFor(pair[0], pair)).toBe("Live Webinar (on your own platform)");
    expect(labelFor(pair[1], pair)).toBe("Live Webinar (on someone else's platform)");
  });

  it("leaves a uniquely-named initiative alone", () => {
    expect(labelFor(WEBINAR, ALL)).toBe("Live Webinar");
    expect(labelFor(PAID_ADS, ALL)).toBe("Paid Ads");
    expect(labelFor(OWN_EVENT, ALL)).toBe("Your Own Event");
  });

  // The phrasing would be actively misleading on a recurring product.
  it("never suffixes a membership", () => {
    expect(labelFor(MEMBERSHIPS, ALL)).toBe("Courses & Memberships");
  });

  // "OWN & OPS" is genuinely both, so neither suffix is true.
  it("adds no suffix when an initiative is both", () => {
    expect(labelFor(AFFILIATE, ALL)).toBe("Affiliate Launches");
  });

  it("adds no suffix when the library does not say", () => {
    expect(labelFor(entry({ key: "x", name: "Thing", ownOrOps: null }), ALL)).toBe("Thing");
  });

  it("defaults to the bare name with no collection to compare against", () => {
    expect(labelFor(WEBINAR)).toBe("Live Webinar");
  });
});

describe("platformOf", () => {
  it("normalises the workbook's values", () => {
    expect(platformOf(PAID_ADS)).toBe("own");
    expect(platformOf(WEBINAR)).toBe("ops");
  });

  it("is null when the library says both or says nothing", () => {
    expect(platformOf(AFFILIATE)).toBeNull();
    expect(platformOf(entry({ key: "x" }))).toBeNull();
  });

  /**
   * Memberships are tagged OPS in the workbook, which is why `labelFor` has to
   * check for an ambiguous NAME rather than just reading this field — the tag
   * alone would have it render "(on someone else's platform)".
   */
  it("reads OPS on memberships, which is why the name check matters", () => {
    expect(platformOf(MEMBERSHIPS)).toBe("ops");
    expect(labelFor(MEMBERSHIPS, ALL)).toBe("Courses & Memberships");
  });
});

describe("groupInitiatives", () => {
  it("groups in the declared display order", () => {
    const groups = groupInitiatives(ALL).map((g) => g.group);
    const expectedOrder = PICKER_GROUPS.filter((g) => groups.includes(g));
    expect(groups).toEqual(expectedOrder);
  });

  it("drops empty groups rather than rendering an empty heading", () => {
    const groups = groupInitiatives([WEBINAR]).map((g) => g.group);
    expect(groups).toEqual(["Virtual Events"]);
  });

  it("includes every initiative when unfiltered", () => {
    const total = groupInitiatives(ALL).reduce((n, g) => n + g.initiatives.length, 0);
    expect(total).toBe(ALL.length);
  });

  /**
   * REQ-8.3. A Ticket Map item without an event product behind it is not
   * actionable, so it is hidden rather than offered and later rejected.
   */
  it("hides Ticket Map items without an Event product", () => {
    const withEvent = groupInitiatives([WEBINAR, TICKET_MAP], { hasEventProduct: true });
    const without = groupInitiatives([WEBINAR, TICKET_MAP], { hasEventProduct: false });

    expect(flatKeys(withEvent)).toContain("ticket-map-virtual");
    expect(flatKeys(without)).not.toContain("ticket-map-virtual");
  });

  // REQ-9.2 — screen 6 must not ask again about results already given.
  it("excludes keys the caller has already handled", () => {
    const groups = groupInitiatives(ALL, { exclude: ["webinar", "paid-ads"] });
    expect(flatKeys(groups)).not.toContain("webinar");
    expect(flatKeys(groups)).not.toContain("paid-ads");
    expect(flatKeys(groups)).toContain("sales-calls");
  });

  it("searches the name", () => {
    expect(flatKeys(groupInitiatives(ALL, { search: "webinar" }))).toEqual(["webinar"]);
  });

  it("searches case-insensitively and ignores surrounding space", () => {
    expect(flatKeys(groupInitiatives(ALL, { search: "  PAID ads " }))).toEqual(["paid-ads"]);
  });

  it("searches the one-liner", () => {
    expect(flatKeys(groupInitiatives(ALL, { search: "teach live" }))).toEqual(["webinar"]);
  });

  /**
   * People search for the thing and for the kind of thing interchangeably —
   * "webinar" and "virtual" should both find it.
   */
  it("searches the group heading", () => {
    expect(flatKeys(groupInitiatives(ALL, { search: "virtual" }))).toContain("webinar");
    expect(flatKeys(groupInitiatives(ALL, { search: "in-person" }))).toContain("your-own-event");
  });

  /**
   * "Own" versus "someone else's" is how people think about these even when the
   * label does not carry the suffix, so the platform is searchable regardless.
   */
  it("searches by platform", () => {
    expect(flatKeys(groupInitiatives(ALL, { search: "own platform" }))).toContain("paid-ads");
    expect(flatKeys(groupInitiatives(ALL, { search: "someone else" }))).toContain("webinar");
  });

  it("returns nothing for a search that matches nothing", () => {
    expect(groupInitiatives(ALL, { search: "zzzzz" })).toEqual([]);
  });

  it("treats a blank search as no search", () => {
    expect(flatKeys(groupInitiatives(ALL, { search: "   " }))).toHaveLength(ALL.length);
  });

  it("handles an empty library without throwing", () => {
    expect(groupInitiatives([])).toEqual([]);
  });
});

describe("byKey", () => {
  it("resolves a stored answer back to its initiative", () => {
    expect(byKey(ALL).get("webinar")?.name).toBe("Live Webinar");
  });

  it("misses cleanly on a key the library no longer carries", () => {
    // The workbook is re-uploadable and a key can disappear between uploads.
    expect(byKey(ALL).get("removed-initiative")).toBeUndefined();
  });
});

describe("requiresSalesCalls", () => {
  /**
   * Only an explicit YES counts. REQ-13.10 excludes sales-call initiatives for
   * users who do not take calls, and treating POSSIBLY as YES would strip most
   * of the library — leaving almost nothing to recommend them.
   */
  it("is true only for an explicit YES", () => {
    expect(requiresSalesCalls(SALES_CALLS)).toBe(true);
    expect(requiresSalesCalls(PAID_ADS)).toBe(false);
    expect(requiresSalesCalls(PODCAST)).toBe(false);
  });

  it("is false when the library does not say", () => {
    expect(requiresSalesCalls(MEMBERSHIPS)).toBe(false);
  });

  it("tolerates casing and whitespace in the workbook value", () => {
    expect(requiresSalesCalls(entry({ key: "x", needsSalesTeam: " yes " }))).toBe(true);
  });
});

function flatKeys(groups: { initiatives: LibraryInitiative[] }[]): string[] {
  return groups.flatMap((g) => g.initiatives.map((i) => i.key));
}
