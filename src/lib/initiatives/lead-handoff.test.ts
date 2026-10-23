import { describe, it, expect } from "vitest";
import {
  LEAD_HANDOFF_ATTR,
  NO_HANDOFF_WARNING,
  handoffCleanup,
  handoffLabel,
  handoffOptions,
  handoffWarnings,
  isLeadGen,
  leadSources,
  parseHandoffPatch,
  readHandoffId,
  resolveHandoff,
  withHandoff,
  type HandoffInitiative,
} from "./lead-handoff";

const PLAN = "plan-1";
const init = (over: Partial<HandoffInitiative> & { id: string }): HandoffInitiative => ({
  name: over.id,
  annualPlanId: PLAN,
  activationDate: "2026-03-01",
  attrs: {},
  ...over,
});

describe("handoffWarnings", () => {
  const leadGen = init({ id: "webinar", name: "Webinar", activationDate: "2026-04-01" });

  it("warns that the initiative runs at $0 when nothing receives the leads", () => {
    expect(handoffWarnings(leadGen, null)).toEqual([NO_HANDOFF_WARNING]);
  });

  it("warns when the receiving initiative starts before the lead-gen one", () => {
    const receiving = init({ id: "launch", name: "Spring Launch", activationDate: "2026-03-15" });
    expect(handoffWarnings(leadGen, receiving)).toEqual([
      "The leads won't exist yet — Spring Launch starts before Webinar.",
    ]);
  });

  it("is silent when the receiver starts on or after the lead-gen one", () => {
    expect(handoffWarnings(leadGen, init({ id: "a", activationDate: "2026-04-01" }))).toEqual([]);
    expect(handoffWarnings(leadGen, init({ id: "b", activationDate: "2026-05-01" }))).toEqual([]);
  });

  it("says nothing about order when either side is undated", () => {
    const undated = init({ id: "u", activationDate: null, eventDate: null, categoryId: "webinars" });
    expect(handoffWarnings(leadGen, undated)).toEqual([]);
    expect(handoffWarnings(undated, leadGen)).toEqual([]);
  });

  it("compares a month-only start by its first day", () => {
    const monthOnly = init({
      id: "m",
      name: "March thing",
      activationDate: "2026-03-01",
      activationDatePrecision: "month",
      categoryId: "webinars",
    });
    expect(handoffWarnings(leadGen, monthOnly)).toHaveLength(1);
  });
});

describe("resolveHandoff (dangling ids read as blank)", () => {
  const target = init({ id: "t" });
  const all = [target, init({ id: "x" })];

  it("finds the receiving initiative", () => {
    expect(resolveHandoff(init({ id: "lg", attrs: { [LEAD_HANDOFF_ATTR]: "t" } }), all)).toBe(target);
  });

  it("is null for an unset, dangling, self or non-string id", () => {
    expect(resolveHandoff(init({ id: "lg" }), all)).toBeNull();
    expect(resolveHandoff(init({ id: "lg", attrs: { [LEAD_HANDOFF_ATTR]: "deleted" } }), all)).toBeNull();
    expect(resolveHandoff(init({ id: "x", attrs: { [LEAD_HANDOFF_ATTR]: "x" } }), all)).toBeNull();
    expect(resolveHandoff(init({ id: "lg", attrs: { [LEAD_HANDOFF_ATTR]: 42 } }), all)).toBeNull();
    expect(resolveHandoff(init({ id: "lg", attrs: null }), all)).toBeNull();
  });

  it("a dangling id gives the blank warning", () => {
    const lg = init({ id: "lg", attrs: { [LEAD_HANDOFF_ATTR]: "deleted" } });
    expect(handoffWarnings(lg, resolveHandoff(lg, all))).toEqual([NO_HANDOFF_WARNING]);
  });
});

describe("leadSources", () => {
  it("lists the initiatives pointing at the receiver, not itself", () => {
    const all = [
      init({ id: "r", attrs: { [LEAD_HANDOFF_ATTR]: "r" } }),
      init({ id: "a", attrs: { [LEAD_HANDOFF_ATTR]: "r" } }),
      init({ id: "b", attrs: { [LEAD_HANDOFF_ATTR]: "other" } }),
      init({ id: "c" }),
    ];
    expect(leadSources({ id: "r" }, all).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("handoffOptions", () => {
  it("same plan only, never itself, earliest first, undated last", () => {
    const all = [
      init({ id: "self", name: "Self" }),
      init({ id: "late", name: "Late", activationDate: "2026-09-01" }),
      init({ id: "early", name: "Early", activationDate: "2026-02-01" }),
      init({ id: "undated", name: "Undated", activationDate: null, categoryId: "webinars" }),
      init({ id: "other-plan", annualPlanId: "plan-2" }),
    ];
    expect(handoffOptions(all, { id: "self", annualPlanId: PLAN })).toEqual([
      { id: "early", label: "Early (02/01/2026)" },
      { id: "late", label: "Late (09/01/2026)" },
      { id: "undated", label: "Undated (no date)" },
    ]);
  });

  it("labels a month-only start by month", () => {
    expect(
      handoffLabel({ name: "X", activationDate: "2026-07-01", activationDatePrecision: "month", categoryId: "w" })
    ).toBe("X (07/2026)");
  });
});

describe("handoffCleanup (delete)", () => {
  it("clears only the rows pointing at the deleted initiative, keeping other attrs", () => {
    const rows = [
      { id: "a", attrs: { [LEAD_HANDOFF_ATTR]: "gone", lead_goal: 200 } },
      { id: "b", attrs: { [LEAD_HANDOFF_ATTR]: "kept" } },
      { id: "c", attrs: {} },
      { id: "d", attrs: null },
      { id: "gone", attrs: { [LEAD_HANDOFF_ATTR]: "gone" } },
    ];
    expect(handoffCleanup(rows, "gone")).toEqual([{ id: "a", attrs: { lead_goal: 200 } }]);
  });
});

describe("withHandoff / readHandoffId / isLeadGen", () => {
  it("sets and clears without touching the input", () => {
    const attrs = { lead_goal: 5 };
    const set = withHandoff(attrs, "t");
    expect(set).toEqual({ lead_goal: 5, [LEAD_HANDOFF_ATTR]: "t" });
    expect(attrs).toEqual({ lead_goal: 5 });
    expect(withHandoff(set, null)).toEqual({ lead_goal: 5 });
    expect(readHandoffId(set)).toBe("t");
    expect(readHandoffId({ [LEAD_HANDOFF_ATTR]: "  " })).toBeNull();
  });

  it("only the leads path is lead-gen", () => {
    expect(isLeadGen({ conversionPath: "leads" })).toBe(true);
    expect(isLeadGen({ conversionPath: "offer" })).toBe(false);
    expect(isLeadGen({ conversionPath: null })).toBe(false);
  });
});

describe("parseHandoffPatch", () => {
  it("accepts an id or null, blank as null", () => {
    expect(parseHandoffPatch({ handoffTo: "abc" })).toEqual({ ok: true, handoffTo: "abc" });
    expect(parseHandoffPatch({ handoffTo: null })).toEqual({ ok: true, handoffTo: null });
    expect(parseHandoffPatch({ handoffTo: " " })).toEqual({ ok: true, handoffTo: null });
  });

  it("refuses anything else", () => {
    expect(parseHandoffPatch({}).ok).toBe(false);
    expect(parseHandoffPatch(null).ok).toBe(false);
    expect(parseHandoffPatch({ handoffTo: 3 }).ok).toBe(false);
  });
});
