import { describe, it, expect } from "vitest";
import {
  buildPatch,
  canAddExtra,
  changedFields,
  draftErrors,
  draftFromConfig,
  filterRecords,
  groupProblems,
  needsHumanLines,
  newRevenueLine,
  normalizeDraft,
  pathRestriction,
  CATEGORY_OPTIONS,
  DEFAULT_FILTERS,
  NAMED_DATE_LABEL,
  fieldLabel,
  workbookFlagLine,
  type EditorDraft,
  type FilterableRecord,
} from "./config-editor";
import {
  availableConversionPaths,
  categoryById,
  CATEGORIES,
  CONVERSION_PATHS,
  INITIATIVE_KINDS,
  MAX_FIELD_EXTRAS,
  NAMED_DATES,
  type ConversionPath,
  type InitiativeKind,
  type RecordAudienceSource,
} from "./library-config";
import { applyPatch, parseConfigPatch, type StoredConfig } from "./config-repo";

const base = (over: Partial<StoredConfig> = {}): StoredConfig => ({
  initiativeKey: "webinar",
  categoryId: "webinars",
  audienceSource: "own",
  allowedPaths: ["offer", "calls"],
  partnerBlock: { host: true, booking: true },
  revenueLines: [],
  fieldExtras: [],
  ...over,
});

const edit = (d: EditorDraft, over: Partial<EditorDraft>): EditorDraft => ({ ...d, ...over });

/** Every subset of a vocabulary, so the kind rules are checked exhaustively. */
function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, x) => acc.concat(acc.map((s) => [...s, x])), [[]]);
}

describe("draftFromConfig", () => {
  it("keeps unset arrays as null, never []", () => {
    const d = draftFromConfig(base());
    expect(d.allowedKinds).toBeNull();
    expect(d.allowedFrequencies).toBeNull();
    expect(d.allowedPaths).toEqual(["offer", "calls"]);
  });

  it("puts arrays in vocabulary order and defaults scalars to empty", () => {
    const d = draftFromConfig(base({ allowedPaths: ["calls", "offer"], categoryId: undefined }));
    expect(d.allowedPaths).toEqual(["offer", "calls"]);
    expect(d.categoryId).toBe("");
    expect(d.formatOverride).toBe("");
  });
});

describe("buildPatch", () => {
  it("is empty when nothing changed and kinds are unset", () => {
    const d = draftFromConfig(base());
    expect(buildPatch(d, d)).toEqual({});
  });

  it("sends only the changed fields", () => {
    const d = draftFromConfig(base());
    const patch = buildPatch(d, edit(d, { audienceSource: "borrowed", formatOverride: "hybrid" }));
    expect(patch).toEqual({ audienceSource: "borrowed", formatOverride: "hybrid" });
  });

  it("clears with null, not an empty string", () => {
    const d = draftFromConfig(base({ formatOverride: "hybrid", ongoingLabel: "Evergreen", allowedKinds: ["ongoing"], allowedFrequencies: [] }));
    const patch = buildPatch(d, edit(d, { formatOverride: "", ongoingLabel: "  " }));
    expect(patch).toEqual({ formatOverride: null, ongoingLabel: null });
  });

  it("ignores order-only changes to a checkbox group", () => {
    const d = draftFromConfig(base());
    expect(buildPatch(d, edit(d, { allowedPaths: ["calls", "offer"] }))).toEqual({});
  });

  it("sends allowedFrequencies: [] automatically when recurring is not allowed", () => {
    const d = draftFromConfig(base());
    const patch = buildPatch(d, edit(d, { allowedKinds: ["one-time"] }));
    expect(patch).toEqual({ allowedKinds: ["one-time"], allowedFrequencies: [] });
  });

  it("drops frequencies picked earlier once recurring is unticked", () => {
    const d = draftFromConfig(base({ allowedKinds: ["recurring"], allowedFrequencies: ["weekly"] }));
    const patch = buildPatch(d, edit(d, { allowedKinds: ["one-time"] }));
    expect(patch.allowedFrequencies).toEqual([]);
  });

  it("leaves frequencies alone while kinds are unset", () => {
    const d = draftFromConfig(base());
    expect(buildPatch(d, edit(d, { audienceSource: "borrowed" }))).not.toHaveProperty("allowedFrequencies");
  });

  it("keeps the admin's frequencies when recurring is allowed", () => {
    const d = draftFromConfig(base());
    const patch = buildPatch(d, edit(d, { allowedKinds: ["recurring"], allowedFrequencies: ["monthly", "weekly"] }));
    expect(patch.allowedFrequencies).toEqual(["weekly", "monthly"]);
  });

  it("trims revenue lines and drops a blank condition", () => {
    const d = draftFromConfig(base());
    const patch = buildPatch(
      d,
      edit(d, {
        revenueLines: [
          { id: " main ", priceSource: "product.price", windowOpens: "cart_opens", windowCloses: "cart_closes", condition: " " },
        ],
      })
    );
    expect(patch.revenueLines).toEqual([
      { id: "main", priceSource: "product.price", windowOpens: "cart_opens", windowCloses: "cart_closes" },
    ]);
  });

  it("produces a patch the server's parser accepts", () => {
    const d = draftFromConfig(base());
    const patch = buildPatch(
      d,
      edit(d, {
        allowedKinds: ["one-time", "ongoing"],
        ongoingLabel: "Evergreen",
        partnerBlock: { host: true, booking: false },
        fieldExtras: [{ key: "seats", label: "Seats", readBy: "forecast" }],
      })
    );
    const parsed = parseConfigPatch(patch);
    expect(parsed.ok).toBe(true);
  });

  it("round-trips: applying the patch to the original gives the edited draft", () => {
    const original = base({ allowedKinds: ["recurring"], allowedFrequencies: ["weekly"] });
    const o = draftFromConfig(original);
    const edited = edit(o, { allowedKinds: ["one-time"], categoryId: "paid-ads", audienceSource: "borrowed" });
    const after = applyPatch(original, buildPatch(o, edited));
    expect(draftFromConfig(after)).toEqual(normalizeDraft(edited));
  });

  /**
   * The frequency rule over every combination of allowed kinds: frequencies
   * are sent as [] exactly when kinds are decided and exclude recurring.
   */
  it("applies the frequency rule for every subset of kinds", () => {
    const o = draftFromConfig(base({ allowedFrequencies: ["weekly"] }));
    for (const kinds of subsets<InitiativeKind>(INITIATIVE_KINDS)) {
      const patch = buildPatch(o, edit(o, { allowedKinds: kinds }));
      if (kinds.includes("recurring")) expect(patch).not.toHaveProperty("allowedFrequencies");
      else expect(patch.allowedFrequencies).toEqual([]);
    }
  });
});

describe("changedFields", () => {
  it("lists the fields the patch touches", () => {
    const d = draftFromConfig(base());
    expect([...changedFields(d, edit(d, { allowedKinds: ["one-time"] }))].sort()).toEqual([
      "allowedFrequencies",
      "allowedKinds",
    ]);
  });
});

describe("draftErrors", () => {
  it("flags blank revenue-line ids and incomplete extras", () => {
    const d = draftFromConfig(base());
    const errors = draftErrors(
      edit(d, {
        revenueLines: [{ ...newRevenueLine([]), id: " " }],
        fieldExtras: [{ key: "k", label: "", readBy: "x" }],
      })
    );
    expect(errors.revenueLines).toBeDefined();
    expect(errors.fieldExtras).toBeDefined();
  });

  it("is empty for a clean draft", () => {
    expect(draftErrors(draftFromConfig(base()))).toEqual({});
  });
});

describe("canAddExtra", () => {
  it("stops at the cap", () => {
    const extra = { key: "a", label: "b", readBy: "c" };
    expect(canAddExtra(null)).toBe(true);
    expect(canAddExtra(Array(MAX_FIELD_EXTRAS - 1).fill(extra))).toBe(true);
    expect(canAddExtra(Array(MAX_FIELD_EXTRAS).fill(extra))).toBe(false);
  });
});

describe("newRevenueLine", () => {
  it("picks an unused id", () => {
    const first = newRevenueLine([]);
    expect(first.id).toBe("line-1");
    expect(newRevenueLine([{ ...first, id: "line-2" }]).id).toBe("line-3");
  });
});

describe("groupProblems", () => {
  it("groups revenue window problems under revenueLines and unknowns under _form", () => {
    const grouped = groupProblems([
      { code: "impossible_revenue_window", field: "revenueLines.main.windowOpens", message: "a" },
      { code: "speaker_fee_off_stage", field: "allowedPaths", message: "b" },
      { code: "missing_initiative_key", field: "initiativeKey", message: "c" },
    ]);
    expect(grouped).toEqual({ revenueLines: ["a"], allowedPaths: ["b"], _form: ["c"] });
  });
});

describe("pathRestriction", () => {
  it("restricts speaker fee off stage, and never restricts leads by audience", () => {
    // Leads on an own audience is allowed: the owner's designs offer it on
    // Your Own Event — Virtual, Content & Media and Local Presence.
    expect(pathRestriction("leads", "own", "webinars")).toBeNull();
    expect(pathRestriction("leads", "own", "local-presence")).toBeNull();
    expect(pathRestriction("leads", "borrowed", "webinars")).toBeNull();
    expect(pathRestriction("speaker-fee", "borrowed", "webinars")).not.toBeNull();
    expect(pathRestriction("speaker-fee", "borrowed", "other-peoples-stages-virtual")).toBeNull();
  });

  it("says nothing while the deciding field is unset", () => {
    expect(pathRestriction("leads", "", "webinars")).toBeNull();
    expect(pathRestriction("speaker-fee", "own", "")).toBeNull();
  });

  /** Must agree with the contract's filter for every category, audience and path. */
  it("matches availableConversionPaths everywhere", () => {
    const audiences: RecordAudienceSource[] = ["own", "borrowed"];
    for (const category of CATEGORIES) {
      for (const audienceSource of audiences) {
        for (const path of CONVERSION_PATHS as readonly ConversionPath[]) {
          const offered = availableConversionPaths({ allowedPaths: [path], audienceSource }, category).length > 0;
          expect(pathRestriction(path, audienceSource, category.id) === null).toBe(offered);
        }
      }
    }
  });
});

describe("filterRecords", () => {
  const rec = (key: string, name: string, categoryId: FilterableRecord["effective"]["categoryId"], status: FilterableRecord["validation"]["status"]): FilterableRecord => ({
    initiativeKey: key,
    library: { name },
    effective: { categoryId },
    validation: { status },
  });
  const records = [
    rec("webinar", "Live Webinar", "webinars", "valid"),
    rec("hybrid-events-ops", "Hybrid Events", "other-peoples-stages-virtual", "incomplete"),
    rec("mystery", "Mystery", undefined, "incomplete"),
  ];

  it("returns everything with the default filters", () => {
    expect(filterRecords(records, DEFAULT_FILTERS)).toHaveLength(3);
  });

  it("filters by category, by no category, by status and by search", () => {
    expect(filterRecords(records, { ...DEFAULT_FILTERS, category: "webinars" }).map((r) => r.initiativeKey)).toEqual(["webinar"]);
    expect(filterRecords(records, { ...DEFAULT_FILTERS, category: "none" }).map((r) => r.initiativeKey)).toEqual(["mystery"]);
    expect(filterRecords(records, { ...DEFAULT_FILTERS, status: "incomplete" })).toHaveLength(2);
    expect(filterRecords(records, { ...DEFAULT_FILTERS, query: "  WEBINAR " })).toHaveLength(1);
    expect(filterRecords(records, { ...DEFAULT_FILTERS, query: "ops" }).map((r) => r.initiativeKey)).toEqual(["hybrid-events-ops"]);
  });
});

describe("labels", () => {
  it("lists the twelve categories in picker order", () => {
    expect(CATEGORY_OPTIONS.map((c) => c.id)).toEqual(CATEGORIES.map((c) => c.id));
    expect(CATEGORY_OPTIONS).toHaveLength(12);
    expect(CATEGORY_OPTIONS.every((c) => categoryById(c.id)?.label === c.label)).toBe(true);
  });

  it("has a human label for every named date", () => {
    for (const d of NAMED_DATES) expect(NAMED_DATE_LABEL[d]).toMatch(/^[A-Z]/);
  });

  it("summarises needs-human counts, dropping zeros", () => {
    expect(needsHumanLines({ allowedKinds: 87, categoryId: 0, revenueLines: 3 })).toEqual([
      { field: "allowedKinds", count: 87, text: "87 still need a frequency" },
      { field: "revenueLines", count: 3, text: "3 still need revenue lines" },
    ]);
  });
});

describe("workbook date flags (read-only)", () => {
  it("says asked / not asked, from the workbook", () => {
    expect(workbookFlagLine("askStartDate", false)).toBe("Start date: not asked (from workbook)");
    expect(workbookFlagLine("askStartDate", true)).toBe("Start date: asked (from workbook)");
    expect(workbookFlagLine("askEventDate", false)).toBe("Event date: not asked (from workbook)");
    expect(workbookFlagLine("askEventDate", true)).toBe("Event date: asked (from workbook)");
  });

  it("unset reads as asked, and says the cell was blank or not read", () => {
    expect(workbookFlagLine("askEventDate", undefined)).toBe("Event date: asked (workbook cell blank or not read)");
  });

  it("labels the flags in warnings", () => {
    expect(fieldLabel("askStartDate")).toBe("Start date");
    expect(fieldLabel("askEventDate")).toBe("Event date");
    expect(fieldLabel("allowedKinds")).toBe("Frequency");
  });
});
