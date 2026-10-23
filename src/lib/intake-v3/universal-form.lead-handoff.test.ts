import { describe, it, expect } from "vitest";
import {
  attachedBlockIds,
  buildCreateRequest,
  draftErrors,
  draftHandoffParty,
  initialDraft,
  layoutFor,
  type IntakeDraft,
} from "./universal-form";
import type { LibraryRecordConfig } from "./library-config";
import type { PickerItem } from "./picker";
import { LEAD_GOAL_ATTR, LEAD_HANDOFF_ATTR } from "../initiatives/lead-handoff";

const PLAN = { annualPlanId: "11111111-2222-4333-8444-555555555555" };
const TARGET = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const CONFIG: LibraryRecordConfig = {
  initiativeKey: "k",
  isLaunch: true,
  allowedKinds: ["one-time"],
  allowedPaths: ["offer", "leads"],
  audienceSource: "own",
  revenueLines: [],
  fieldExtras: [],
  allowedFrequencies: [],
};
const ITEM: PickerItem = { key: "live-webinar", name: "Live Webinar", oneLiner: null, categoryId: "webinars", audience: "own" };

function draft(over: Partial<IntakeDraft> = {}): IntakeDraft {
  return {
    ...initialDraft(ITEM, CONFIG),
    conversionPath: "leads",
    dates: {
      activation: { value: "2026-03-01", precision: "day" },
      event: { value: "2026-03-20", precision: "day" },
      close: { value: "2026-03-31", precision: "day" },
    },
    cart: { opens: { value: "2026-03-10", precision: "day" } },
    revenue: { mode: "goal", goal: 1000, lines: {} },
    promotedBy: ["email-list"],
    ...over,
  };
}

describe("lead handoff in the universal form", () => {
  it("attaches on the leads path only", () => {
    expect(attachedBlockIds(layoutFor(draft(), CONFIG)).has("lead-handoff")).toBe(true);
    expect(attachedBlockIds(layoutFor(draft({ conversionPath: "offer" }), CONFIG)).has("lead-handoff")).toBe(false);
  });

  it("writes the chosen target and the lead goal, at $0 revenue", () => {
    const req = buildCreateRequest(draft({ leads: { goal: "250", handoffTo: TARGET } }), CONFIG, PLAN);
    expect(req.attrs?.[LEAD_HANDOFF_ATTR]).toBe(TARGET);
    expect(req.attrs?.[LEAD_GOAL_ATTR]).toBe(250);
    expect(req.revenueScenarios).toEqual({ good: 0, better: 0, best: 0 });
  });

  it("writes nothing for Decide later", () => {
    const req = buildCreateRequest(draft({ leads: { goal: null, handoffTo: null } }), CONFIG, PLAN);
    expect(req.attrs).not.toHaveProperty(LEAD_HANDOFF_ATTR);
    expect(req.attrs).not.toHaveProperty(LEAD_GOAL_ATTR);
  });

  it("writes neither off the leads path, even with answers left in the draft", () => {
    const req = buildCreateRequest(
      draft({ conversionPath: "offer", leads: { goal: 250, handoffTo: TARGET } }),
      CONFIG,
      PLAN
    );
    expect(req.attrs).not.toHaveProperty(LEAD_HANDOFF_ATTR);
    expect(req.attrs).not.toHaveProperty(LEAD_GOAL_ATTR);
  });

  it("an extra cannot smuggle in a handoff", () => {
    const req = buildCreateRequest(draft({ attrs: { [LEAD_HANDOFF_ATTR]: TARGET } }), CONFIG, PLAN);
    expect(req.attrs).not.toHaveProperty(LEAD_HANDOFF_ATTR);
  });

  it("refuses a lead goal that is not a whole number", () => {
    expect(draftErrors(draft({ leads: { goal: "2.5", handoffTo: null } }), CONFIG)["leads.goal"]).toBeDefined();
    expect(draftErrors(draft({ leads: { goal: "abc", handoffTo: null } }), CONFIG)["leads.goal"]).toBeDefined();
    expect(draftErrors(draft({ leads: { goal: "40", handoffTo: null } }), CONFIG)["leads.goal"]).toBeUndefined();
  });

  it("gives handoffWarnings the draft's name and start", () => {
    expect(draftHandoffParty(draft({ name: " My webinar " }))).toMatchObject({
      name: "My webinar",
      activationDate: "2026-03-01",
    });
    expect(draftHandoffParty(draft({ dates: { ...draft().dates, activation: { value: "nope", precision: "day" } } })).activationDate).toBeNull();
  });
});
