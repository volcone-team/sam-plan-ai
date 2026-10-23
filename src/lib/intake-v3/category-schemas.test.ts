import { describe, it, expect } from "vitest";
import {
  CATEGORY_SCHEMAS,
  SCHEMA_CATEGORY_IDS,
  allSchemaFields,
  boundFieldCopy,
  schemaAttrs,
  schemaErrors,
  schemaFor,
  schemaOptions,
  visibleSchemaFields,
  visibleSchemaGroups,
  type CategorySchema,
  type SchemaDraft,
  type SchemaLayout,
} from "./category-schemas";
import { CATEGORIES, isCategoryId, type CategoryId, type LibraryRecordConfig } from "./library-config";
import { buildCreateRequest, draftErrors, initialDraft, layoutFor, type IntakeDraft } from "./universal-form";
import { normalizeKey } from "../workbook/parse";
import { typeExtrasFor } from "./type-extras";
import type { PickerItem } from "./picker";

/**
 * Library record names per category, read from wb_initiative_library
 * (Oct 2026 workbook). Every `records` gate must name one of these, or the
 * gated questions never show.
 */
const LIBRARY_NAMES: Partial<Record<CategoryId, readonly string[]>> = {
  webinars: ["Evergreen Webinars", "Online Workshops", "Live Webinar", "Co-Hosted / Joint Venture Webinar"],
  "funnels-launches-promotions": [
    "Book Funnel (Free + Shipping)", "VSL / Sales Page", "Internal Launch", "Affiliate Launch",
    "Beta / Founding Cohort Launch", "Black Friday Promotion", "Lead Magnet / Quiz Funnel", "Low-Ticket Funnel",
    "Flash Sale / Seasonal Promotion", "Free Trial of Signature Product", "General Promotion",
  ],
  "your-own-event-in-person": [
    "Dinners/Lunches", "Your Own Event", "Your Own Hybrid Event", "Your Own Workshop / One-Day Intensive",
    "Event Sponsorship & Exhibitor Sales", "In-Store Events, Classes & Demos", "Grand Opening or Relaunch Event",
    "Behind-the-Scenes Event",
  ],
  "your-own-event-virtual": [
    "Podcast/Vodcast", "Social Media Lives", "Challenge / Bootcamp (Free)", "Challenge / Bootcamp (Paid)",
    "Hybrid Events", "Your Own Virtual Summit", "Your Own YouTube Channel",
  ],
  "other-peoples-stages-in-person": [
    "OPS - In Person (Other People's Stages)", "Hybrid Events", "Networking Events", "Dinners/Lunches",
    "Breakout Session / Panel", "Corporate & Association Training", "Faith-Based & Church Stages",
    "Sponsorship of Someone Else's Event", "Speaking at Masterminds & Retreats", "Company Convention Circuit",
    "Mastermind Membership (Someone Else's Room)", "Local Sponsorships (Teams, Schools, Charities)",
    "Chamber & Local Business Associations",
  ],
  "other-peoples-stages-virtual": [
    "Podcast/Vodcast Guest", "Social Media Lives", "Challenge / Bootcamp (Free)", "Challenge / Bootcamp (Paid)",
    "Hybrid Events", "Virtual Summit (as Speaker)", "Guest on Someone's YouTube Channel",
  ],
  "paid-ads": [
    "LinkedIn Ads", "Paid Ads (Meta)", "Podcast Ads", "Newsletter Ads", "Paid Ads (Pinterest)", "YouTube Ads",
    "Google Search / Intent Ads", "Geo-Targeted & Radius Ads",
  ],
  "email-text-mail": [
    "Re-Engagement / Win-Back Campaign", "Email Campaign", "Your Own SMS / Text Community", "Direct Mail",
    "SMS / Text Campaign", "Past-Buyer Reactivation Campaign",
  ],
  "sales-outreach": [
    "Direct Message Reach Out", "Cross-Sell & Upsell to Existing Customers", "Outbound Call Campaign",
    "Renewal & Rebill Calls", "Cold Email / LinkedIn Outbound", "Appointment Setter Team", "Sales Calls",
  ],
  "content-media": ["Organic Social", "SEO & AI Search", "Content", "Local PR & Community Media", "Your Own Newsletter"],
  "partnerships-referrals": [
    "Affiliate & JV Recruitment", "Courses & Memberships", "Influencer Marketing", "Referrals",
    "Sponsorship Sales on Your Own Assets",
  ],
  "local-presence": [
    "Local Directory & Citation Listings", "Review Generation Engine", "Google Business Profile & Local Map Pack",
  ],
};

const layout = (over: Partial<SchemaLayout> = {}): SchemaLayout => ({ effectiveKind: "one-time", blocks: [], ...over });
const draft = (category: Record<string, unknown> = {}, audienceSource: SchemaDraft["audienceSource"] = "own"): SchemaDraft => ({
  category,
  audienceSource,
});
const keys = (schema: CategorySchema | null, d: SchemaDraft, name: string, l: SchemaLayout = layout()) =>
  visibleSchemaFields(schema, d, name, l).map((f) => f.key);

describe("schema data", () => {
  it("has a schema for every listed category, and only real category ids", () => {
    for (const id of SCHEMA_CATEGORY_IDS) {
      expect(isCategoryId(id), id).toBe(true);
      expect(schemaFor(id)?.categoryId).toBe(id);
    }
    expect(CATEGORIES).toHaveLength(12);
    for (const c of CATEGORIES) {
      expect(SCHEMA_CATEGORY_IDS, c.id).toContain(c.id);
      expect(LIBRARY_NAMES[c.id]?.length, c.id).toBeGreaterThan(0);
    }
  });

  for (const id of SCHEMA_CATEGORY_IDS) {
    describe(id, () => {
      const schema = CATEGORY_SCHEMAS[id]!;
      const fields = allSchemaFields(schema);

      it("has unique field keys and group ids", () => {
        expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length);
        expect(new Set(schema.groups.map((g) => g.id)).size).toBe(schema.groups.length);
      });

      it("gives every choice field non-empty, distinct options", () => {
        for (const f of fields.filter((f) => f.type === "single" || f.type === "multi")) {
          const values = schemaOptions(f).map((o) => o.value);
          expect(values.length, f.key).toBeGreaterThan(0);
          expect(new Set(values).size, f.key).toBe(values.length);
          expect(values.every((v) => v !== ""), f.key).toBe(true);
        }
      });

      it("answer gates point at an earlier, unbound field and a value it can hold", () => {
        const seen = new Map<string, (typeof fields)[number]>();
        for (const f of fields) {
          const gate = f.gate;
          if (gate && "answer" in gate) {
            const target = seen.get(gate.answer);
            expect(target, `${f.key} -> ${gate.answer}`).toBeDefined();
            expect(target!.binds).toBeUndefined();
            const allowed: unknown[] = target!.type === "yesno" ? [true, false] : schemaOptions(target!).map((o) => o.value);
            for (const v of Array.isArray(gate.equals) ? gate.equals : [gate.equals]) expect(allowed).toContain(v);
          }
          seen.set(f.key, f);
        }
      });

      it("records gates name real library records of this category", () => {
        const names = (LIBRARY_NAMES[id] ?? []).map(normalizeKey);
        const gates = [...schema.groups.map((g) => g.gate), ...fields.map((f) => f.gate)];
        for (const gate of gates) {
          if (gate && "records" in gate) for (const n of gate.records) expect(names, n).toContain(normalizeKey(n));
        }
      });

      it("never renders a bound field, whatever the context", () => {
        const all = Object.fromEntries(fields.map((f) => [f.key, f.type === "yesno" ? true : "x"]));
        for (const name of LIBRARY_NAMES[id] ?? []) {
          for (const audience of ["own", "borrowed"] as const) {
            for (const kind of ["one-time", "recurring", "ongoing"] as const) {
              const blocks = [{ id: "affiliate" as const, attached: true, reason: "" }];
              const shown = visibleSchemaFields(schema, draft(all, audience), name, layout({ effectiveKind: kind, blocks }));
              expect(shown.some((f) => f.binds), `${name}/${audience}/${kind}`).toBe(false);
            }
          }
        }
      });
    });
  }

  it("only covers known categories", () => {
    const ids = new Set(CATEGORIES.map((c) => c.id));
    for (const id of SCHEMA_CATEGORY_IDS) expect(ids.has(id)).toBe(true);
  });
});

describe("gating", () => {
  const web = schemaFor("webinars");

  it("answer gate: replay expires shows only on replay = yes", () => {
    expect(keys(web, draft(), "Live Webinar")).not.toContain("replayExpires");
    expect(keys(web, draft({ replay: false }), "Live Webinar")).not.toContain("replayExpires");
    expect(keys(web, draft({ replay: true }), "Live Webinar")).toContain("replayExpires");
  });

  it("answer gate on a choice value", () => {
    const ops = schemaFor("other-peoples-stages-virtual");
    expect(keys(ops, draft({ agreement: "mention-only" }, "borrowed"), "Social Media Lives")).not.toContain("revenueSplit");
    expect(keys(ops, draft({ agreement: "sell" }, "borrowed"), "Social Media Lives")).toContain("revenueSplit");
  });

  it("audience gate: the borrowed and own webinar groups", () => {
    const own = visibleSchemaGroups(web, draft({}, "own"), "Live Webinar", layout({ effectiveKind: "ongoing" })).map((g) => g.group.id);
    const borrowed = visibleSchemaGroups(web, draft({}, "borrowed"), "Live Webinar", layout()).map((g) => g.group.id);
    expect(own).toContain("your-own-webinar");
    expect(own).not.toContain("someone-elses-webinar");
    expect(borrowed).toContain("someone-elses-webinar");
    expect(borrowed).not.toContain("your-own-webinar");
  });

  it("kind gate: evergreen questions only on ongoing; a group of only bound fields is left out", () => {
    expect(keys(web, draft(), "Evergreen Webinars", layout({ effectiveKind: "ongoing" }))).toEqual(
      expect.arrayContaining(["offerTested", "runCadence"])
    );
    const groups = visibleSchemaGroups(web, draft(), "Live Webinar", layout({ effectiveKind: "one-time" }));
    // "Your own webinar" then holds only the bound cart, so it does not render (nor its note).
    expect(groups.map((g) => g.group.id)).toEqual(["core"]);
  });

  it("asks pitch day once: as the Challenge type extra, in the schema everywhere else", () => {
    const virtual = schemaFor("your-own-event-virtual");
    for (const name of ["Challenge / Bootcamp (Free)", "Challenge / Bootcamp (Paid)"]) {
      expect(keys(virtual, draft(), name)).toContain("days");
      expect(keys(virtual, draft(), name)).not.toContain("pitchDay");
      expect(typeExtrasFor(name)?.map((e) => e.label)).toEqual(["Pitch day"]);
    }
    expect(keys(virtual, draft(), "Your Own Virtual Summit")).toContain("pitchDay");
    expect(keys(virtual, draft(), "Hybrid Events")).toContain("pitchDay");
  });

  it("records gate: matched with normalizeKey on the library name", () => {
    const funnels = schemaFor("funnels-launches-promotions");
    expect(keys(funnels, draft(), "VSL / Sales Page")).toContain("callsOrOffer");
    expect(keys(funnels, draft(), "vsl/sales page")).toContain("callsOrOffer");
    expect(keys(funnels, draft(), "Internal Launch")).not.toContain("callsOrOffer");
    const virtual = schemaFor("your-own-event-virtual");
    expect(keys(virtual, draft(), "Podcast/Vodcast")).toContain("showPurpose");
    expect(keys(virtual, draft(), "Your Own Virtual Summit")).toEqual(expect.arrayContaining(["days", "speakerCount"]));
    expect(keys(virtual, draft(), "Challenge / Bootcamp (Free)")).not.toContain("speakerCount");
  });

  it("block gate: the partners group follows the affiliate block", () => {
    const funnels = schemaFor("funnels-launches-promotions");
    expect(keys(funnels, draft(), "Internal Launch")).not.toContain("affiliatePortal");
    const blocks = [{ id: "affiliate" as const, attached: true, reason: "" }];
    expect(keys(funnels, draft(), "Internal Launch", layout({ blocks }))).toContain("affiliatePortal");
  });

  it("records gates on the Part B categories", () => {
    const mail = schemaFor("email-text-mail");
    const groupsOf = (name: string) => visibleSchemaGroups(mail, draft(), name, layout()).map((g) => g.group.id);
    expect(groupsOf("SMS / Text Campaign")).toContain("sms-compliance");
    expect(groupsOf("Your Own SMS / Text Community")).toContain("sms-compliance");
    expect(groupsOf("Direct Mail")).toEqual(["core", "direct-mail"]);
    expect(groupsOf("Email Campaign")).toEqual(["core"]);
    expect(keys(mail, draft({ hasList: true }), "Email Campaign")).toContain("listSize");
    expect(keys(mail, draft({ hasList: false }), "Email Campaign")).not.toContain("listSize");

    const ads = schemaFor("paid-ads");
    expect(keys(ads, draft({}, "borrowed"), "Podcast Ads")).toContain("placedBy");
    expect(keys(ads, draft(), "Paid Ads (Meta)")).not.toContain("placedBy");

    const sales = schemaFor("sales-outreach");
    expect(keys(sales, draft(), "Cold Email / LinkedIn Outbound")).toContain("sendingWarmed");
    expect(keys(sales, draft(), "Sales Calls")).not.toContain("sendingWarmed");

    const content = schemaFor("content-media");
    expect(keys(content, draft(), "Local PR & Community Media")).toEqual(expect.arrayContaining(["newsAngle", "pressKit"]));
    expect(keys(content, draft(), "Content")).toEqual(["purpose", "cadence", "maker", "discovery"]);

    const partners = schemaFor("partnerships-referrals");
    expect(keys(partners, draft(), "Influencer Marketing")).toEqual(expect.arrayContaining(["creative", "approvalRights", "tracking"]));
    expect(keys(partners, draft(), "Referrals")).not.toContain("sponsorshipAsset");
  });

  it("Sales & Outreach requires the call source", () => {
    const sales = schemaFor("sales-outreach");
    expect(schemaErrors(sales, draft(), "Sales Calls", layout())).toEqual({ "category.source": "This question needs an answer." });
    expect(schemaErrors(sales, draft({ source: "referral" }), "Sales Calls", layout())).toEqual({});
  });

  it("a field gated on a hidden field is hidden too", () => {
    const schema: CategorySchema = {
      categoryId: "webinars",
      groups: [
        { id: "a", title: "A", gate: { audience: "borrowed" }, fields: [{ key: "x", label: "X", type: "yesno" }] },
        { id: "b", title: "B", fields: [{ key: "y", label: "Y", type: "text", gate: { answer: "x", equals: true } }] },
      ],
    };
    expect(keys(schema, draft({ x: true }, "borrowed"), "n")).toEqual(["x", "y"]);
    expect(keys(schema, draft({ x: true }, "own"), "n")).toEqual([]);
  });
});

describe("errors and written values", () => {
  const schema: CategorySchema = {
    categoryId: "webinars",
    groups: [
      {
        id: "core",
        title: "Core",
        fields: [
          { key: "need", label: "Need", type: "single", options: ["One", "Two"], required: true },
          { key: "count", label: "Count", type: "number" },
          { key: "when", label: "When", type: "date" },
          { key: "picks", label: "Picks", type: "multi", options: ["A", "B", "C"] },
          { key: "secret", label: "Secret", type: "text", gate: { audience: "borrowed" }, required: true },
          { key: "bound", label: "Bound", type: "text", binds: "partner.host", required: true },
        ],
      },
    ],
  };

  it("requires visible required fields only, and flags unreadable answers", () => {
    expect(schemaErrors(schema, draft(), "n", layout())).toEqual({ "category.need": "This question needs an answer." });
    const e = schemaErrors(schema, draft({ need: "one", count: "abc", when: { value: "2026-02-30", precision: "day" } }), "n", layout());
    expect(Object.keys(e).sort()).toEqual(["category.count", "category.when"]);
    expect(schemaErrors(schema, draft({ need: "three" }), "n", layout())).toHaveProperty("category.need");
  });

  it("writes visible answered fields only, normalised", () => {
    const d = draft({
      need: "two",
      count: "12",
      when: { value: "2026-05", precision: "month" },
      picks: ["c", "a", "zzz"],
      secret: "hidden answer",
      bound: "Host",
    });
    expect(schemaAttrs(schema, d, "n", layout())).toEqual({ need: "two", count: 12, when: "2026-05-01", picks: ["a", "c"] });
    expect(schemaAttrs(schema, draft(), "n", layout())).toBeNull();
  });

  it("exposes a bound field's copy for the universal form", () => {
    expect(boundFieldCopy(schemaFor("webinars"), "partner.host")).toMatchObject({ placeholder: "Partner, host or affiliate" });
    expect(boundFieldCopy(schemaFor("webinars"), "adPlatforms")).toBeNull();
    expect(boundFieldCopy(schemaFor("paid-ads"), "plannedBudget")).toMatchObject({ label: "Total ad budget" });
    expect(boundFieldCopy(schemaFor("sales-outreach"), "close")).toMatchObject({ label: "When does this round of calls close?" });
    expect(boundFieldCopy(schemaFor("partnerships-referrals"), "affiliate.terms")).toMatchObject({
      placeholder: "e.g. 40% / $500 flat",
    });
  });
});

describe("through the universal form", () => {
  const PLAN = { annualPlanId: "11111111-2222-4333-8444-555555555555" };
  const config = (over: Partial<LibraryRecordConfig> = {}): LibraryRecordConfig => ({
    initiativeKey: "k",
    isLaunch: true,
    allowedKinds: ["one-time"],
    allowedPaths: ["offer"],
    audienceSource: "own",
    revenueLines: [],
    fieldExtras: [],
    allowedFrequencies: [],
    ...over,
  });
  const item = (name: string, categoryId: CategoryId): PickerItem => ({ key: normalizeKey(name), name, oneLiner: null, categoryId, audience: "own" });
  const ready = (d: IntakeDraft, over: Partial<IntakeDraft> = {}): IntakeDraft => ({
    ...d,
    dates: {
      activation: { value: "2026-03-01", precision: "day" },
      event: { value: "2026-03-20", precision: "day" },
      close: { value: "2026-03-31", precision: "day" },
    },
    revenue: { mode: "goal", goal: 1000, lines: {} },
    cart: { opens: { value: "2026-03-01", precision: "day" } },
    ...over,
  });

  it("starts with no answers and the library name", () => {
    const d = initialDraft(item("Live Webinar", "webinars"), config());
    expect(d.category).toEqual({});
    expect(d.libraryName).toBe("Live Webinar");
  });

  it("writes attrs.category without hidden answers, and gates on the library name not the edited one", () => {
    const base = initialDraft(item("VSL / Sales Page", "funnels-launches-promotions"), config());
    const d = ready(base, {
      name: "My renamed funnel",
      category: { promoting: "bundle", callsOrOffer: "book-a-call", cart: "ignored", affiliatePortal: true },
    });
    expect(draftErrors(d, config())).toEqual({});
    const attrs = buildCreateRequest(d, config(), PLAN).attrs!;
    // affiliate attaches by category, so the partners group is visible.
    expect(layoutFor(d, config()).blocks.find((b) => b.id === "affiliate")?.attached).toBe(true);
    expect(attrs.category).toEqual({ promoting: "bundle", callsOrOffer: "book-a-call", affiliatePortal: true });

    const other = ready(initialDraft(item("Internal Launch", "funnels-launches-promotions"), config()), {
      category: { callsOrOffer: "book-a-call" },
    });
    expect(buildCreateRequest(other, config(), PLAN).attrs).not.toHaveProperty("category");
  });

  it("puts schema errors in draftErrors, and an extra cannot smuggle attrs.category", () => {
    const d = ready(initialDraft(item("Live Webinar", "webinars"), config()), {
      category: { replay: true, replayExpires: { value: "2026-13-01", precision: "day" } },
    });
    expect(draftErrors(d, config())["category.replayExpires"]).toBe("Enter a valid date.");
    const clean = ready(initialDraft(item("Live Webinar", "webinars"), config()), { attrs: { category: { forged: 1 } } });
    expect(buildCreateRequest(clean, config(), PLAN).attrs).not.toHaveProperty("category");
  });
});
