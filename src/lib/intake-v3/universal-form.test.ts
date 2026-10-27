import { describe, it, expect } from "vitest";
import {
  NO_PROMOTION_NEEDED,
  NO_PROMOTION_WARNING,
  PROMOTION_ADS,
  PROMOTION_SOMEONE_ELSE,
  attachedBlockIds,
  boundExtra,
  buildCreateRequest,
  cartOpensHint,
  closeDateLabel,
  extraAttrs,
  extraErrorKey,
  ownExtras,
  setExtraAnswer,
  commissionPreview,
  commissionRule,
  marketingReveals,
  projectedScenarios,
  draftErrors,
  draftWarnings,
  initialDraft,
  layoutFor,
  NO_PROMOTION_ATTR,
  hasNoPromotionMarker,
  ongoingCloseDefault,
  setDraftKind,
  withOngoingCloseDefault,
  type IntakeDraft,
} from "./universal-form";
import { ASK_UNDECIDED, bookingStatusWritten, type LibraryRecordConfig } from "./library-config";
import { IMPLICIT_LINE_ID } from "./revenue";
import { parseCreateInitiativeRequest } from "../initiatives/create-request";
import type { PickerItem } from "./picker";

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

const item = (categoryId: PickerItem["categoryId"], audience: PickerItem["audience"] = "own"): PickerItem => ({
  key: "live-webinar",
  name: "Live Webinar",
  oneLiner: null,
  categoryId,
  audience,
});

/** A config whose layout renders kind, path and frequency (webinars: format pinned digital). */
const WEBINAR = config({
  allowedKinds: ["one-time", "recurring", "ongoing"],
  allowedPaths: ["offer", "calls"],
  allowedFrequencies: ["weekly", "monthly"],
  ongoingLabel: "Evergreen",
});

/** Other People's Stages — In-Person: format asked, partner block, ASK_UNDECIDED offered. */
const STAGE = config({
  allowedPaths: ["offer", "calls", "leads", "speaker-fee"],
  audienceSource: "borrowed",
});
const NETWORKING = config({ ...STAGE, partnerBlock: { host: true, booking: false } });

/** A filled-in, valid draft. */
function filled(d: IntakeDraft, over: Partial<IntakeDraft> = {}): IntakeDraft {
  return {
    ...d,
    conversionPath: d.conversionPath ?? "offer",
    dates: {
      activation: { value: "2026-03-01", precision: "day" },
      event: { value: "2026-03-20", precision: "day" },
      close: { value: "2026-03-31", precision: "day" },
    },
    revenue: { mode: "goal", goal: 1000, lines: {} },
    promotedBy: ["email-list"],
    // The cart block attaches on the offer path; on/after start, on/before close.
    cart: { opens: { value: "2026-03-01", precision: "day" } },
    ...over,
  };
}

describe("initialDraft", () => {
  it("pre-applies silent values: pinned format and single path", () => {
    const d = initialDraft(item("webinars"), config());
    expect(d.format).toBe("digital");
    expect(d.conversionPath).toBe("offer");
    expect(d.kind).toBe("one-time");
  });

  it("defaults In-Person categories to in-person, without pinning", () => {
    const d = initialDraft(item("other-peoples-stages-in-person", "borrowed"), STAGE);
    expect(d.format).toBe("in-person");
    expect(layoutFor(d, STAGE).format.state).toBe("rendered");
    expect(d.conversionPath).toBeNull();
    expect(d.audienceSource).toBe("borrowed");
  });

  it("chooses the first allowed kind when kind is asked", () => {
    const d = initialDraft(item("webinars"), config({ ...WEBINAR, allowedKinds: ["recurring", "one-time"] }));
    expect(d.kind).toBe("recurring");
    expect(d.frequency).toBeNull();
  });

  it("leaves format null where it does not apply", () => {
    expect(initialDraft(item("paid-ads"), config()).format).toBeNull();
  });
});

describe("layoutFor", () => {
  it("is resolveFormLayout with the draft's answers", () => {
    const d = { ...initialDraft(item("webinars"), WEBINAR), kind: "ongoing" as const };
    const layout = layoutFor(d, WEBINAR);
    expect(layout.effectiveKind).toBe("ongoing");
    expect(layout.eventDate.state).toBe("absent");
  });
});

describe("draftErrors", () => {
  it("is empty for a valid draft", () => {
    expect(draftErrors(filled(initialDraft(item("webinars"), config())), config())).toEqual({});
  });

  it("flags a blank name and missing dates and revenue", () => {
    const d = { ...initialDraft(item("webinars"), config()), name: "  " };
    const e = draftErrors(d, config());
    expect(Object.keys(e).sort()).toEqual([
      "cart.opens",
      "dates.activation",
      "dates.close",
      "dates.event",
      "name",
      "revenue.goal",
    ]);
  });

  it("rejects a kind not in the allowed kinds", () => {
    const cfg = config({ ...WEBINAR, allowedKinds: ["one-time", "recurring"], allowedFrequencies: ["weekly"], ongoingLabel: undefined });
    const d = filled(initialDraft(item("webinars"), cfg), { kind: "ongoing" });
    expect(draftErrors(d, cfg).kind).toMatch(/not available/);
  });

  it("rejects a path that is not available, and a missing one", () => {
    const d = filled(initialDraft(item("webinars"), WEBINAR), { conversionPath: "leads" });
    expect(draftErrors(d, WEBINAR).conversionPath).toMatch(/not available/);
    expect(draftErrors({ ...d, conversionPath: null }, WEBINAR).conversionPath).toBeDefined();
  });

  it("accepts ASK_UNDECIDED only where the category offers it", () => {
    const stage = filled(initialDraft(item("other-peoples-stages-in-person", "borrowed"), STAGE), {
      conversionPath: ASK_UNDECIDED,
    });
    expect(draftErrors(stage, STAGE).conversionPath).toBeUndefined();
    const web = filled(initialDraft(item("webinars"), WEBINAR), { conversionPath: ASK_UNDECIDED });
    expect(draftErrors(web, WEBINAR).conversionPath).toBeDefined();
  });

  it("requires frequency on a recurring draft with several frequencies", () => {
    const d = filled(initialDraft(item("webinars"), WEBINAR), { kind: "recurring" });
    expect(draftErrors(d, WEBINAR).frequency).toBeDefined();
    expect(draftErrors({ ...d, frequency: "monthly" }, WEBINAR).frequency).toBeUndefined();
  });

  it("rejects invalid dates and a close date before the start", () => {
    const d = filled(initialDraft(item("webinars"), config()));
    const bad = { ...d, dates: { ...d.dates, activation: { value: "2026-02-30", precision: "day" as const } } };
    expect(draftErrors(bad, config())["dates.activation"]).toMatch(/valid/);
    const inverted = { ...d, dates: { ...d.dates, close: { value: "2026-02-01", precision: "day" as const } } };
    expect(draftErrors(inverted, config())["dates.close"]).toMatch(/before the start/);
  });

  it("compares month-only dates by month", () => {
    const d = filled(initialDraft(item("webinars"), config()));
    const sameMonth = {
      ...d,
      dates: { ...d.dates, activation: { value: "2026-03-20", precision: "day" as const }, close: { value: "2026-03", precision: "month" as const } },
    };
    expect(draftErrors(sameMonth, config())["dates.close"]).toBeUndefined();
    const earlier = { ...sameMonth, dates: { ...sameMonth.dates, close: { value: "2026-02", precision: "month" as const } } };
    expect(draftErrors(earlier, config())["dates.close"]).toMatch(/before the start/);
  });

  it("does not require an event date on an ongoing draft", () => {
    const d = filled(initialDraft(item("webinars"), WEBINAR), { kind: "ongoing" });
    const noEvent = { ...d, dates: { ...d.dates, event: { value: null, precision: "day" as const } } };
    expect(draftErrors(noEvent, WEBINAR)).toEqual({});
  });

  it("requires a Good figure per revenue line in lines mode", () => {
    const d = filled(initialDraft(item("webinars"), config()), {
      revenue: { mode: "lines", goal: null, lines: { [IMPLICIT_LINE_ID]: "" } },
    });
    expect(draftErrors(d, config())[`revenue.lines.${IMPLICIT_LINE_ID}`]).toBeDefined();
  });

  it("asks for no revenue on the leads path", () => {
    const d = filled(initialDraft(item("other-peoples-stages-in-person", "borrowed"), STAGE), {
      conversionPath: "leads",
      revenue: { mode: "goal", goal: null, lines: {} },
    });
    expect(draftErrors(d, STAGE)).toEqual({});
  });
});

describe("draftWarnings", () => {
  it("warns with the exact copy when nothing drives the initiative", () => {
    const d = filled(initialDraft(item("webinars"), config()), { promotedBy: [" "] });
    expect(draftWarnings(d, config()).promotion).toBe("Nothing is driving this one.");
    expect(NO_PROMOTION_WARNING).toBe("Nothing is driving this one.");
  });

  it("is silent when a driver is selected", () => {
    expect(draftWarnings(filled(initialDraft(item("webinars"), config())), config())).toEqual({});
  });

  it("warns when 'No promotion needed' is the only selection", () => {
    const d = filled(initialDraft(item("webinars"), config()), { promotedBy: [NO_PROMOTION_NEEDED] });
    expect(draftWarnings(d, config()).promotion).toBe(NO_PROMOTION_WARNING);
    // A warning, not an error: the draft still saves, with the answer stored.
    expect(draftErrors(d, config())).toEqual({});
    expect(buildCreateRequest(d, config(), PLAN).attrs?.promoted_by).toEqual([NO_PROMOTION_NEEDED]);
  });

  it("is silent alongside a real driver", () => {
    const d = filled(initialDraft(item("webinars"), config()), { promotedBy: [NO_PROMOTION_NEEDED, "email"] });
    expect(draftWarnings(d, config())).toEqual({});
  });

  it("is silent with no positive revenue target", () => {
    const base = filled(initialDraft(item("webinars"), config()), { promotedBy: [] });
    for (const goal of [null, "", 0]) {
      expect(draftWarnings({ ...base, revenue: { mode: "goal", goal, lines: {} } }, config())).toEqual({});
    }
  });

  it("is silent on the leads path, which projects nothing", () => {
    const leads = config({ allowedPaths: ["leads"] });
    const d = filled(initialDraft(item("webinars"), leads), { promotedBy: [], conversionPath: "leads" });
    expect(draftWarnings(d, leads)).toEqual({});
  });
});

describe("projectedScenarios", () => {
  it("reads the goal, and is null when it does not read", () => {
    const d = filled(initialDraft(item("webinars"), config()));
    expect(projectedScenarios(d, config())).toEqual({ good: 1000, better: 1100, best: 1200 });
    expect(projectedScenarios({ ...d, revenue: { mode: "goal", goal: "x", lines: {} } }, config())).toBeNull();
  });
});

describe("buildCreateRequest", () => {
  it("maps ongoing to evergreen and drops the event date", () => {
    const d = filled(initialDraft(item("webinars"), WEBINAR), { kind: "ongoing" });
    const req = buildCreateRequest(d, WEBINAR, PLAN);
    expect(req.kind).toBe("evergreen");
    expect(req.eventDate).toBeNull();
  });

  it("writes silent values, including ones with no request field", () => {
    const cfg = config({ allowedKinds: ["recurring"], allowedFrequencies: ["monthly"] });
    const req = buildCreateRequest(filled(initialDraft(item("webinars"), cfg)), cfg, PLAN);
    expect(req.kind).toBe("recurring");
    expect(req.format).toBe("digital");
    expect(req.conversionPath).toBe("offer");
    expect(req.attrs?.repeat_frequency).toBe("monthly");
    expect(req.categoryId).toBe("webinars");
  });

  it("omits format where it does not apply", () => {
    const req = buildCreateRequest(filled(initialDraft(item("paid-ads"), config())), config(), PLAN);
    expect(req.format).toBeNull();
  });

  it("never writes booking_status when booking is switched off", () => {
    const d = filled(initialDraft(item("other-peoples-stages-in-person", "borrowed"), NETWORKING), {
      partner: { host: "Chamber", bookingStatus: "confirmed" },
      attrs: { booking_status: "confirmed" },
    });
    expect(bookingStatusWritten(layoutFor(d, NETWORKING))).toBe(false);
    const req = buildCreateRequest(d, NETWORKING, PLAN);
    expect(req.attrs).not.toHaveProperty("booking_status");
    expect(req.attrs?.partner_host).toBe("Chamber");
  });

  it("writes booking_status where the booking half is attached", () => {
    const d = filled(initialDraft(item("other-peoples-stages-in-person", "borrowed"), STAGE), {
      partner: { host: null, bookingStatus: "pending" },
    });
    expect(buildCreateRequest(d, STAGE, PLAN).attrs?.booking_status).toBe("pending");
  });

  it("does not write booking_status on an own-audience record", () => {
    const d = filled(initialDraft(item("webinars"), config()), { partner: { host: null, bookingStatus: "confirmed" } });
    expect(buildCreateRequest(d, config(), PLAN).attrs).not.toHaveProperty("booking_status");
  });

  it("stores month-only dates as the 1st with month precision", () => {
    const d = filled(initialDraft(item("webinars"), config()), {
      dates: {
        activation: { value: "2026-04", precision: "month" },
        event: { value: "2026-05-17", precision: "month" },
        close: { value: "2026-06", precision: "month" },
      },
      cart: { opens: { value: "2026-05", precision: "month" } },
    });
    const req = buildCreateRequest(d, config(), PLAN);
    expect(req.attrs?.cart_opens).toBe("2026-05-01");
    expect(req.attrs?.cart_opens_precision).toBe("month");
    expect(req.activationDate).toBe("2026-04-01");
    expect(req.activationDatePrecision).toBe("month");
    expect(req.eventDate).toBe("2026-05-01");
    expect(req.eventDatePrecision).toBe("month");
    expect(req.revenueCloseDate).toBe("2026-06-01");
    expect(req.attrs?.revenue_close_date_precision).toBe("month");
  });

  it("stores ASK_UNDECIDED in attrs and leaves conversionPath unset", () => {
    const d = filled(initialDraft(item("other-peoples-stages-in-person", "borrowed"), STAGE), {
      conversionPath: ASK_UNDECIDED,
    });
    const req = buildCreateRequest(d, STAGE, PLAN);
    expect(req).not.toHaveProperty("conversionPath");
    expect(req.attrs?.conversion_ask).toBe(ASK_UNDECIDED);
  });

  it("uses goalScenarios in goal mode", () => {
    const d = filled(initialDraft(item("webinars"), config()), { revenue: { mode: "goal", goal: "1005", lines: {} } });
    expect(buildCreateRequest(d, config(), PLAN).revenueScenarios).toEqual({
      good: 1005,
      better: Math.round(1005 * 1.1),
      best: Math.round(1005 * 1.2),
    });
  });

  it("sums per-line Good in lines mode and keeps the lines in attrs", () => {
    const cfg = config({
      revenueLines: [
        { id: "main", priceSource: "product.price", windowOpens: "cart_opens", windowCloses: "cart_closes" },
        { id: "vip", priceSource: "vip_price", windowOpens: "cart_opens", windowCloses: "cart_closes" },
      ],
    });
    const d = filled(initialDraft(item("webinars"), cfg), { revenue: { mode: "lines", goal: null, lines: { main: 800, vip: "200" } } });
    const req = buildCreateRequest(d, cfg, PLAN);
    expect(req.revenueScenarios).toEqual({ good: 1000, better: 1100, best: 1200 });
    expect(req.attrs?.revenue_lines).toEqual({ main: 800, vip: 200 });
  });

  it("refuses to build from a draft with errors", () => {
    expect(() => buildCreateRequest(initialDraft(item("webinars"), config()), config(), PLAN)).toThrow(/not ready/);
  });

  it("produces bodies the server parser accepts unchanged (seeded sweep)", () => {
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const paths = [ASK_UNDECIDED, "offer", "calls", "leads", "speaker-fee"] as const;
    for (let i = 0; i < 200; i++) {
      const base = initialDraft(item("other-peoples-stages-in-person", "borrowed"), STAGE);
      const month = String(1 + rand(12)).padStart(2, "0");
      const d = filled(base, {
        conversionPath: paths[rand(paths.length)],
        format: (["in-person", "digital", "hybrid"] as const)[rand(3)],
        revenue: { mode: "goal", goal: rand(100000), lines: {} },
        dates: {
          activation: { value: `2026-${month}-01`, precision: "day" },
          event: { value: `2026-${month}`, precision: "month" },
          close: { value: `2027-${month}-15`, precision: rand(2) ? "day" : "month" },
        },
        cart: { opens: { value: `2026-${month}-01`, precision: "day" } },
      });
      const req = buildCreateRequest(d, STAGE, PLAN);
      const parsed = parseCreateInitiativeRequest(JSON.parse(JSON.stringify(req)));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value).toEqual(req);
      expect(req.kind).not.toBe("ongoing");
    }
  });
});

/* ------------------------------------------------------------------ *
 * Conditional blocks and reveals
 * ------------------------------------------------------------------ */

/** Funnels, Launches & Promotions: VIP and affiliate both attach; offer path has a cart. */
const FUNNEL = config({ allowedPaths: ["offer", "calls"] });
const funnelDraft = (over: Partial<IntakeDraft> = {}) =>
  filled(initialDraft(item("funnels-launches-promotions"), FUNNEL), { conversionPath: "offer", ...over });

describe("block gating comes from layout.blocks", () => {
  it("attaches cart on offer only, VIP and affiliate by category", () => {
    const offer = attachedBlockIds(layoutFor(funnelDraft(), FUNNEL));
    expect([...offer].filter((b) => ["cart", "vip", "affiliate"].includes(b)).sort()).toEqual(["affiliate", "cart", "vip"]);
    expect(attachedBlockIds(layoutFor(funnelDraft({ conversionPath: "calls" }), FUNNEL)).has("cart")).toBe(false);
    const ads = attachedBlockIds(layoutFor(filled(initialDraft(item("paid-ads"), config())), config()));
    expect(ads.has("vip") || ads.has("affiliate")).toBe(false);
    const web = attachedBlockIds(layoutFor(filled(initialDraft(item("webinars"), config())), config()));
    expect(web.has("vip")).toBe(true);
    expect(web.has("affiliate")).toBe(false);
  });

  it("starts every block unanswered", () => {
    const d = initialDraft(item("funnels-launches-promotions"), FUNNEL);
    expect(d.cart.opens.value).toBeNull();
    expect(d.vip.offered).toBeNull();
    expect(d.commission.offered).toBeNull();
    expect(d.funnels).toEqual({ optin: null, sales: null });
  });
});

describe("cart block", () => {
  const withCart = (value: string | null) => funnelDraft({ cart: { opens: { value, precision: "day" } } });

  it("requires Cart opens on the offer path and not on calls", () => {
    expect(draftErrors(withCart(null), FUNNEL)["cart.opens"]).toMatch(/Enter the cart opens/);
    expect(draftErrors({ ...withCart(null), conversionPath: "calls" }, FUNNEL)["cart.opens"]).toBeUndefined();
  });

  it("orders Cart opens between the start and the cart close", () => {
    expect(draftErrors(withCart("2026-02-28"), FUNNEL)["cart.opens"]).toMatch(/before the start/);
    expect(draftErrors(withCart("2026-04-01"), FUNNEL)["cart.opens"]).toBe("The cart can't open after it closes.");
    expect(draftErrors(withCart("2026-03-31"), FUNNEL)["cart.opens"]).toBeUndefined();
    expect(draftErrors(withCart("2026-02-30"), FUNNEL)["cart.opens"]).toMatch(/valid/);
  });

  it("writes cart_opens only while the cart is attached", () => {
    expect(buildCreateRequest(withCart("2026-03-10"), FUNNEL, PLAN).attrs?.cart_opens).toBe("2026-03-10");
    const calls = { ...withCart("2026-03-10"), conversionPath: "calls" as const };
    expect(buildCreateRequest(calls, FUNNEL, PLAN).attrs).not.toHaveProperty("cart_opens");
  });
});

describe("VIP block", () => {
  const vip = (v: Partial<IntakeDraft["vip"]>) =>
    funnelDraft({ vip: { offered: true, price: null, capacity: null, included: "", ...v } });

  it("requires a price only when offered", () => {
    expect(draftErrors(vip({}), FUNNEL)["vip.price"]).toMatch(/Enter the VIP price/);
    expect(draftErrors(vip({ price: "0" }), FUNNEL)["vip.price"]).toMatch(/valid/);
    expect(draftErrors(vip({ offered: false }), FUNNEL)["vip.price"]).toBeUndefined();
    expect(draftErrors(vip({ price: 500, capacity: "2.5" }), FUNNEL)["vip.capacity"]).toMatch(/whole/);
  });

  it("writes attrs.vip with the four keys", () => {
    const req = buildCreateRequest(vip({ price: "497", capacity: "20", included: " Q&A call " }), FUNNEL, PLAN);
    expect(req.attrs?.vip).toEqual({ offered: true, price: 497, capacity: 20, included: "Q&A call" });
    const no = buildCreateRequest(vip({ offered: false, price: 497 }), FUNNEL, PLAN);
    expect(no.attrs?.vip).toEqual({ offered: false, price: null, capacity: null, included: null });
    expect(buildCreateRequest(funnelDraft(), FUNNEL, PLAN).attrs).not.toHaveProperty("vip");
  });

  it("drops VIP answers where the block is detached (and ignores them for errors)", () => {
    const d = filled(initialDraft(item("paid-ads"), config()), {
      vip: { offered: true, price: null, capacity: null, included: "x" },
      attrs: { vip: { offered: true } },
    });
    expect(draftErrors(d, config())).toEqual({});
    expect(buildCreateRequest(d, config(), PLAN).attrs).not.toHaveProperty("vip");
  });
});

describe("affiliate block", () => {
  it("writes snake_case answers when attached and drops them when detached", () => {
    const affiliate = { partnerCount: "12", recruitment: "recruiting" as const, terms: "30% first sale" };
    const req = buildCreateRequest(funnelDraft({ affiliate }), FUNNEL, PLAN);
    expect(req.attrs?.affiliate).toEqual({
      partner_count: 12,
      recruitment_status: "recruiting",
      commission_terms: "30% first sale",
    });
    const web = filled(initialDraft(item("webinars"), config()), { affiliate });
    expect(buildCreateRequest(web, config(), PLAN).attrs).not.toHaveProperty("affiliate");
  });

  it("rejects a fractional partner count", () => {
    const d = funnelDraft({ affiliate: { partnerCount: "1.5", recruitment: null, terms: "" } });
    expect(draftErrors(d, FUNNEL)["affiliate.partnerCount"]).toMatch(/whole/);
  });
});

describe("marketing reveals", () => {
  const promo = { who: "Acme", sending: ["social", "email"] as const, sends: "3" };

  it("reveals by the promotion choice", () => {
    const cat = "funnels-launches-promotions" as const;
    expect(marketingReveals({ promotedBy: [PROMOTION_SOMEONE_ELSE], categoryId: cat })).toEqual({ promoPlan: true, ads: false });
    expect(marketingReveals({ promotedBy: [PROMOTION_ADS, "email"], categoryId: cat })).toEqual({ promoPlan: false, ads: true });
  });

  it("always reveals Ads for a Paid Ads initiative, ticked or not", () => {
    expect(marketingReveals({ promotedBy: [], categoryId: "paid-ads" })).toEqual({ promoPlan: false, ads: true });
    const d = filled(initialDraft(item("paid-ads"), config()), {
      promotedBy: ["email-list"],
      adPlatforms: ["linkedin", "google"],
      plannedBudget: "1200",
    });
    const req = buildCreateRequest(d, config(), PLAN);
    expect(req.plannedBudget).toBe(1200);
    expect(req.attrs?.ad_platforms).toEqual(["google", "linkedin"]);
    expect(draftErrors({ ...d, plannedBudget: "abc" }, config()).plannedBudget).toMatch(/ad budget/);
  });

  it("writes the promo plan only while someone else is promoting", () => {
    const on = funnelDraft({ promotedBy: [PROMOTION_SOMEONE_ELSE], promoPlan: promo });
    // Sending is stored in the option order, not click order.
    expect(buildCreateRequest(on, FUNNEL, PLAN).attrs?.promo_plan).toEqual({
      who: "Acme",
      sending: ["email", "social"],
      sends: 3,
    });
    const off = { ...on, promotedBy: ["email"] };
    expect(buildCreateRequest(off, FUNNEL, PLAN).attrs).not.toHaveProperty("promo_plan");
  });

  it("maps the ad budget to plannedBudget and drops it with the Ads choice", () => {
    const ads = funnelDraft({ promotedBy: [PROMOTION_ADS], adPlatforms: ["youtube", "meta"], plannedBudget: "2500" });
    const req = buildCreateRequest(ads, FUNNEL, PLAN);
    expect(req.plannedBudget).toBe(2500);
    expect(req.attrs?.ad_platforms).toEqual(["meta", "youtube"]);
    const cleared = buildCreateRequest({ ...ads, promotedBy: [] }, FUNNEL, PLAN);
    expect(cleared.plannedBudget).toBe(0);
    expect(cleared.attrs).not.toHaveProperty("ad_platforms");
    expect(draftErrors({ ...ads, plannedBudget: "abc" }, FUNNEL).plannedBudget).toMatch(/ad budget/);
    expect(draftErrors({ ...ads, plannedBudget: "abc", promotedBy: [] }, FUNNEL).plannedBudget).toBeUndefined();
  });

  it("validates sends only while revealed", () => {
    const d = funnelDraft({ promotedBy: [PROMOTION_SOMEONE_ELSE], promoPlan: { ...promo, sends: "x" } });
    expect(draftErrors(d, FUNNEL)["promoPlan.sends"]).toMatch(/whole/);
    expect(draftErrors({ ...d, promotedBy: [] }, FUNNEL)["promoPlan.sends"]).toBeUndefined();
  });

  it("writes the funnel answers whenever answered", () => {
    const req = buildCreateRequest(funnelDraft({ funnels: { optin: true, sales: false } }), FUNNEL, PLAN);
    expect(req.attrs?.new_optin_funnel).toBe(true);
    expect(req.attrs?.new_sales_funnel).toBe(false);
    expect(buildCreateRequest(funnelDraft(), FUNNEL, PLAN).attrs).not.toHaveProperty("new_optin_funnel");
  });
});

describe("sales commission", () => {
  const comm = (c: Partial<IntakeDraft["commission"]>) =>
    funnelDraft({ commission: { offered: true, basis: null, rate: null, ...c } });

  it("requires basis and rate when Yes", () => {
    const e = draftErrors(comm({}), FUNNEL);
    expect(e["commission.basis"]).toBeDefined();
    expect(e["commission.rate"]).toBeDefined();
    expect(draftErrors(comm({ basis: "percent", rate: "120" }), FUNNEL)["commission.rate"]).toMatch(/over 100/);
    expect(draftErrors(comm({ offered: false }), FUNNEL)).toEqual({});
  });

  it("computes percent commission per scenario with commissionForScenarios", () => {
    // Good 1000 / Better 1100 / Best 1200 at 10%.
    expect(commissionPreview(comm({ basis: "percent", rate: "10" }), FUNNEL)).toEqual({
      status: "ok",
      good: 100,
      better: 110,
      best: 120,
    });
    expect(commissionRule(comm({ basis: "percent", rate: "7.5" }))).toEqual({ type: "percent", percent: 7.5 });
  });

  it("reports that flat commission needs a sale count", () => {
    expect(commissionPreview(comm({ basis: "flat", rate: "50" }), FUNNEL).status).toBe("needs-sales-count");
  });

  it("is off when unanswered and has no revenue on a blank goal", () => {
    expect(commissionPreview(funnelDraft(), FUNNEL)).toEqual({ status: "off" });
    const blank = { ...comm({ basis: "percent", rate: 10 }), revenue: { mode: "goal" as const, goal: null, lines: {} } };
    expect(commissionPreview(blank, FUNNEL)).toEqual({ status: "no-revenue" });
  });

  it("writes attrs.commission", () => {
    expect(buildCreateRequest(comm({ basis: "flat", rate: "50" }), FUNNEL, PLAN).attrs?.commission).toEqual({
      offered: true,
      basis: "flat",
      rate: 50,
    });
    expect(buildCreateRequest(comm({ offered: false, basis: "flat", rate: 50 }), FUNNEL, PLAN).attrs?.commission).toEqual(
      { offered: false, basis: null, rate: null }
    );
  });
});

describe("block answers in extras cannot be smuggled", () => {
  it("strips block keys from draft.attrs, and writes only declared extras", () => {
    const cfg = config({
      ...FUNNEL,
      fieldExtras: [
        { key: "keep", label: "Keep", readBy: "x", type: "number" },
        { key: "cart_opens", label: "Sneaky", readBy: "x" },
      ],
    });
    const d = funnelDraft({
      conversionPath: "calls",
      attrs: { cart_opens: "2020-01-01", ad_platforms: ["meta"], keep: 1, undeclared: "x" },
    });
    const attrs = buildCreateRequest(d, cfg, PLAN).attrs;
    expect(attrs).not.toHaveProperty("cart_opens");
    expect(attrs).not.toHaveProperty("ad_platforms");
    expect(attrs).not.toHaveProperty("undeclared");
    expect(attrs?.keep).toBe(1);
  });

  it("round-trips a fully answered draft through the server parser", () => {
    const d = funnelDraft({
      promotedBy: [PROMOTION_ADS, PROMOTION_SOMEONE_ELSE],
      plannedBudget: 900,
      adPlatforms: ["google"],
      promoPlan: { who: "Acme", sending: ["dont-know"], sends: 2 },
      vip: { offered: true, price: 997, capacity: null, included: "" },
      affiliate: { partnerCount: 4, recruitment: "confirmed", terms: "" },
      funnels: { optin: false, sales: true },
      commission: { offered: true, basis: "percent", rate: 20 },
    });
    const req = buildCreateRequest(d, FUNNEL, PLAN);
    const parsed = parseCreateInitiativeRequest(JSON.parse(JSON.stringify(req)));
    expect(parsed.ok && parsed.value).toEqual(req);
  });
});

describe("field extras", () => {
  const day = (value: string | null) => ({ value, precision: "day" as const });
  const PITCH = { key: "pitch_day", label: "Pitch day", readBy: "cart", type: "date" as const, derives: "cart.opens" as const };
  const WEBINAR_DATE = { ...PITCH, key: "webinar_date", label: "Webinar date" };
  const DINNER = config({
    allowedPaths: ["offer", "calls"],
    fieldExtras: [
      { key: "guest_list_size", label: "Guest list size", readBy: "tasks", type: "number" },
      { key: "qualifying_criteria", label: "Qualifying criteria", readBy: "tasks", type: "text" },
    ],
  });
  const CHALLENGE = config({ allowedPaths: ["offer", "calls"], fieldExtras: [PITCH] });
  const AFFILIATE = config({
    allowedPaths: ["offer", "calls"],
    fieldExtras: [
      { key: "oo_opens", label: "Cart opens", readBy: "x", type: "date", binds: "cart.opens", hint: "Set by the offer owner." },
      { key: "oo_closes", label: "Cart closes", readBy: "x", type: "date", binds: "dates.close", hint: "Set by the offer owner." },
    ],
  });
  const challenge = (over: Partial<IntakeDraft> = {}) =>
    filled(initialDraft(item("your-own-event-virtual"), CHALLENGE), { conversionPath: "offer", cart: { opens: day(null) }, ...over });

  it("lists own extras in config order and leaves bound ones to the universal fields", () => {
    expect(ownExtras(DINNER).map((e) => e.key)).toEqual(["guest_list_size", "qualifying_criteria"]);
    expect(ownExtras(AFFILIATE)).toEqual([]);
  });

  it("validates each extra by its type and writes typed values", () => {
    const d = filled(initialDraft(item("your-own-event-in-person"), DINNER), {
      attrs: { guest_list_size: "abc", qualifying_criteria: "  Owners over $1M  " },
    });
    expect(draftErrors(d, DINNER)[extraErrorKey("guest_list_size")]).toMatch(/valid number/);
    const ok = { ...d, attrs: { guest_list_size: "24", qualifying_criteria: "  Owners over $1M  " } };
    expect(draftErrors(ok, DINNER)).toEqual({});
    expect(buildCreateRequest(ok, DINNER, PLAN).attrs).toMatchObject({
      guest_list_size: 24,
      qualifying_criteria: "Owners over $1M",
    });
    // Optional: blank answers are fine and write nothing.
    const blank = { ...d, attrs: { guest_list_size: "", qualifying_criteria: " " } };
    expect(draftErrors(blank, DINNER)).toEqual({});
    expect(extraAttrs(blank, DINNER)).toEqual({});
  });

  it("refuses an invalid date extra and writes a valid one as YYYY-MM-DD", () => {
    const bad = setExtraAnswer(challenge(), CHALLENGE, "pitch_day", day("2026-02-30"));
    expect(draftErrors(bad, CHALLENGE)[extraErrorKey("pitch_day")]).toMatch(/valid date/);
    const good = setExtraAnswer(challenge(), CHALLENGE, "pitch_day", day("2026-03-10"));
    expect(buildCreateRequest(good, CHALLENGE, PLAN).attrs).toMatchObject({ pitch_day: "2026-03-10", cart_opens: "2026-03-10" });
  });

  it("derives cart opens from pitch day, and from the webinar date", () => {
    const d = setExtraAnswer(challenge(), CHALLENGE, "pitch_day", day("2026-03-10"));
    expect(d.cart.opens).toEqual(day("2026-03-10"));
    expect(cartOpensHint(d, CHALLENGE)).toBe("Your cart opens on pitch day.");
    // Moving pitch day moves the cart while the cart is still following it.
    expect(setExtraAnswer(d, CHALLENGE, "pitch_day", day("2026-03-12")).cart.opens).toEqual(day("2026-03-12"));

    const launch = config({ allowedPaths: ["offer", "calls"], fieldExtras: [WEBINAR_DATE] });
    const w = setExtraAnswer(filled(initialDraft(item("funnels-launches-promotions"), launch), { cart: { opens: day(null) } }), launch, "webinar_date", day("2026-03-15"));
    expect(w.cart.opens).toEqual(day("2026-03-15"));
    expect(cartOpensHint(w, launch)).toBe("Your cart opens on the webinar date.");
  });

  it("keeps the user's own cart date once they override it", () => {
    const d = setExtraAnswer(challenge(), CHALLENGE, "pitch_day", day("2026-03-10"));
    const overridden = { ...d, cart: { opens: day("2026-03-11") } };
    expect(cartOpensHint(overridden, CHALLENGE)).toBeNull();
    const moved = setExtraAnswer(overridden, CHALLENGE, "pitch_day", day("2026-03-20"));
    expect(moved.cart.opens).toEqual(day("2026-03-11"));
    expect(moved.attrs.pitch_day).toEqual(day("2026-03-20"));
    expect(buildCreateRequest(moved, CHALLENGE, PLAN).attrs?.cart_opens).toBe("2026-03-11");
  });

  it("fills the cart even before the offer path is chosen, and writes it only once attached", () => {
    const calls = setExtraAnswer(challenge({ conversionPath: "calls" }), CHALLENGE, "pitch_day", day("2026-03-10"));
    expect(buildCreateRequest(calls, CHALLENGE, PLAN).attrs).not.toHaveProperty("cart_opens");
    expect(buildCreateRequest({ ...calls, conversionPath: "offer" }, CHALLENGE, PLAN).attrs?.cart_opens).toBe("2026-03-10");
  });

  it("ignores undeclared and bound keys", () => {
    const d = challenge();
    expect(setExtraAnswer(d, CHALLENGE, "nope", "x")).toBe(d);
    const a = filled(initialDraft(item("funnels-launches-promotions"), AFFILIATE));
    expect(setExtraAnswer(a, AFFILIATE, "oo_opens", day("2026-03-01"))).toBe(a);
  });

  it("asks Affiliate Launch's cart dates on the cart fields, with no separate copy", () => {
    const a = filled(initialDraft(item("funnels-launches-promotions"), AFFILIATE), { conversionPath: "offer" });
    const layout = layoutFor(a, AFFILIATE);
    expect(boundExtra(AFFILIATE, layout, "cart.opens")?.hint).toBe("Set by the offer owner.");
    expect(closeDateLabel(AFFILIATE, layout)).toBe("Cart closes");
    expect(draftErrors({ ...a, dates: { ...a.dates, close: day(null) } }, AFFILIATE)["dates.close"]).toBe(
      "Enter the cart close date."
    );
    const req = buildCreateRequest(a, AFFILIATE, PLAN);
    expect(req.attrs?.cart_opens).toBe("2026-03-01");
    expect(req.revenueCloseDate).toBe("2026-03-31");
    expect(req.attrs).not.toHaveProperty("oo_opens");
    expect(req.attrs).not.toHaveProperty("oo_closes");
    // Off the offer path there is no cart, so the close date keeps its own word.
    const calls = layoutFor({ ...a, conversionPath: "calls" }, AFFILIATE);
    expect(boundExtra(AFFILIATE, calls, "cart.opens")).toBeNull();
    expect(closeDateLabel(AFFILIATE, calls)).toBe("When does this round of calls close?");
  });
});

describe("close date: required per path and kind", () => {
  const blankClose = (d: IntakeDraft): IntakeDraft => ({ ...d, dates: { ...d.dates, close: { value: null, precision: "day" } } });
  it("requires it on offer and calls, with wording that reads naturally", () => {
    const w = filled(initialDraft(item("webinars"), WEBINAR), { kind: "one-time", frequency: null });
    expect(draftErrors(blankClose({ ...w, conversionPath: "offer" }), WEBINAR)["dates.close"]).toBe("Enter the cart close date.");
    expect(draftErrors(blankClose({ ...w, conversionPath: "calls" }), WEBINAR)["dates.close"]).toBe(
      "Enter when this round of calls closes."
    );
  });
  it("leaves it optional on leads and on 'I don't know yet', but still checks a typed date", () => {
    const s = filled(initialDraft(item("other-peoples-stages-in-person", "borrowed"), STAGE));
    for (const conversionPath of ["leads", ASK_UNDECIDED] as const) {
      const d = blankClose({ ...s, conversionPath });
      expect(draftErrors(d, STAGE)["dates.close"], conversionPath).toBeUndefined();
      expect(buildCreateRequest(d, STAGE, PLAN).revenueCloseDate).toBeNull();
      const early = { ...d, dates: { ...d.dates, close: { value: "2026-02-01", precision: "day" as const } } };
      expect(draftErrors(early, STAGE)["dates.close"]).toMatch(/before the start date/);
    }
  });
  it("requires it for ongoing", () => {
    const d = blankClose(filled(initialDraft(item("webinars"), WEBINAR), { kind: "ongoing" }));
    expect(draftErrors(d, WEBINAR)["dates.close"]).toBe("Enter when this initiative ends.");
  });
});

describe("ongoing close date defaults to the plan-year end", () => {
  const ONGOING = config({ ...WEBINAR, allowedKinds: ["ongoing"] });
  it("is Dec 31 of the plan year, else of the start date's year, else nothing", () => {
    const none = { value: null, precision: "day" as const };
    expect(ongoingCloseDefault(2027, none)).toBe("2027-12-31");
    expect(ongoingCloseDefault(null, { value: "2026-05-04", precision: "day" })).toBe("2026-12-31");
    expect(ongoingCloseDefault(undefined, { value: "2028-02", precision: "month" })).toBe("2028-12-31");
    expect(ongoingCloseDefault(null, none)).toBeNull();
  });
  it("prefills only a blank close date on an ongoing draft", () => {
    const d = initialDraft(item("webinars"), ONGOING);
    expect(withOngoingCloseDefault(d, ONGOING, 2027).dates.close).toEqual({ value: "2027-12-31", precision: "day" });
    const typed = { ...d, dates: { ...d.dates, close: { value: "2027-06-30", precision: "day" as const } } };
    expect(withOngoingCloseDefault(typed, ONGOING, 2027)).toBe(typed);
    const oneTime = initialDraft(item("webinars"), config());
    expect(withOngoingCloseDefault(oneTime, config(), 2027)).toBe(oneTime);
  });
  it("fills on switching to ongoing and clears the untouched default on switching away", () => {
    const d = initialDraft(item("webinars"), WEBINAR);
    const ongoing = setDraftKind(d, WEBINAR, "ongoing", 2026);
    expect(ongoing.dates.close.value).toBe("2026-12-31");
    expect(setDraftKind(ongoing, WEBINAR, "one-time", 2026).dates.close.value).toBeNull();
    const moved = { ...ongoing, dates: { ...ongoing.dates, close: { value: "2026-09-30", precision: "day" as const } } };
    expect(setDraftKind(moved, WEBINAR, "one-time", 2026).dates.close.value).toBe("2026-09-30");
  });
});

describe("workbook date flags: which of start / event date the form asks", () => {
  const blank = { value: null, precision: "day" as const };
  const day = (value: string) => ({ value, precision: "day" as const });
  /** A filled one-time webinar draft (offer path, cart attached) for this config. */
  const draftFor = (cfg: LibraryRecordConfig, dates: Partial<IntakeDraft["dates"]> = {}) => {
    const d = filled(initialDraft(item("webinars"), cfg));
    return { ...d, dates: { ...d.dates, ...dates } };
  };
  const roundTrips = (req: ReturnType<typeof buildCreateRequest>) => {
    const parsed = parseCreateInitiativeRequest(JSON.parse(JSON.stringify(req)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(req);
  };

  it("start No / event Yes: no start-date error, activation sent null, event still required", () => {
    const cfg = config({ askStartDate: false, askEventDate: true });
    const d = draftFor(cfg, { activation: blank });
    expect(layoutFor(d, cfg).activationDate.state).toBe("absent");
    expect(draftErrors(d, cfg)).toEqual({});
    expect(draftErrors({ ...d, dates: { ...d.dates, event: blank } }, cfg)).toEqual({
      "dates.event": "Enter the event date.",
    });
    const req = buildCreateRequest(d, cfg, PLAN);
    expect(req).toMatchObject({
      activationDate: null, activationDatePrecision: "day", eventDate: "2026-03-20", categoryId: "webinars",
    });
    roundTrips(req);
  });

  it("start hidden: a stale start date is neither checked against nor written", () => {
    const cfg = config({ askStartDate: false, askEventDate: true });
    // Typed while the field was visible: later than the event, the close and cart opens.
    const d = draftFor(cfg, { activation: { value: "2026-05", precision: "month" } });
    expect(draftErrors(d, cfg)).toEqual({});
    const req = buildCreateRequest(d, cfg, PLAN);
    expect(req.activationDate).toBeNull();
    expect(req.activationDatePrecision).toBe("day");
    roundTrips(req);
  });

  it("start Yes / event No: a one-time draft no longer needs an event date, and none is written", () => {
    const cfg = config({ askStartDate: true, askEventDate: false });
    const d = draftFor(cfg, { event: blank });
    expect(layoutFor(d, cfg).eventDate.state).toBe("absent");
    expect(draftErrors(d, cfg)).toEqual({});
    const stale = draftFor(cfg, { event: day("2025-01-01") });
    expect(draftErrors(stale, cfg)).toEqual({});
    const req = buildCreateRequest(stale, cfg, PLAN);
    expect(req).toMatchObject({ activationDate: "2026-03-01", eventDate: null, eventDatePrecision: "day" });
    roundTrips(req);
  });

  it("start Yes / event Yes (and unset): unchanged, both required on a one-time draft", () => {
    for (const cfg of [config({ askStartDate: true, askEventDate: true }), config()]) {
      const d = draftFor(cfg, { activation: blank, event: blank });
      expect(draftErrors(d, cfg)).toEqual({
        "dates.activation": "Enter a start date.",
        "dates.event": "Enter the event date.",
      });
      expect(buildCreateRequest(draftFor(cfg), cfg, PLAN)).toMatchObject({
        activationDate: "2026-03-01", eventDate: "2026-03-20",
      });
    }
  });

  it("ongoing with no event date and start No: the start date is shown and required", () => {
    const cfg = config({ ...WEBINAR, allowedKinds: ["ongoing"], askStartDate: false, askEventDate: false });
    const d = draftFor(cfg, { activation: blank, event: blank });
    const layout = layoutFor(d, cfg);
    expect([layout.activationDate.state, layout.eventDate.state]).toEqual(["rendered", "absent"]);
    expect(draftErrors(d, cfg)["dates.activation"]).toBe("Enter a start date.");
    const ok = draftFor(cfg, { event: blank });
    expect(draftErrors(ok, cfg)).toEqual({});
    expect(buildCreateRequest(ok, cfg, PLAN)).toMatchObject({ activationDate: "2026-03-01", eventDate: null });
  });

  it("the ongoing close default still reads the (shown) start year, else the plan year", () => {
    const cfg = config({ ...WEBINAR, allowedKinds: ["ongoing"], askStartDate: false });
    const d = { ...initialDraft(item("webinars"), cfg), dates: { activation: day("2028-04-01"), event: blank, close: blank } };
    expect(withOngoingCloseDefault(d, cfg, null).dates.close.value).toBe("2028-12-31");
    expect(withOngoingCloseDefault(d, cfg, 2027).dates.close.value).toBe("2027-12-31");
  });

  it("start hidden skips cart-opens' start-date check, but not its close-date check", () => {
    const cfg = config({ askStartDate: false });
    const d = draftFor(cfg, { activation: day("2026-03-15") });
    expect(draftErrors(d, cfg)).toEqual({});
    const late = { ...d, cart: { opens: day("2026-04-15") } };
    expect(draftErrors(late, cfg)).toEqual({ "cart.opens": "The cart can't open after it closes." });
  });
});

describe("no-promotion marker", () => {
  it("stores attrs.no_promotion when the warning held, and not otherwise", () => {
    const d = filled(initialDraft(item("webinars"), config()));
    expect(buildCreateRequest(d, config(), PLAN).attrs).not.toHaveProperty(NO_PROMOTION_ATTR);
    const none = { ...d, promotedBy: [NO_PROMOTION_NEEDED] };
    expect(draftWarnings(none, config()).promotion).toBe(NO_PROMOTION_WARNING);
    expect(buildCreateRequest(none, config(), PLAN).attrs?.[NO_PROMOTION_ATTR]).toBe(true);
    expect(buildCreateRequest({ ...d, promotedBy: [] }, config(), PLAN).attrs?.[NO_PROMOTION_ATTR]).toBe(true);
  });
  it("cannot be smuggled in through an extra's answer", () => {
    const X = config({ fieldExtras: [{ key: NO_PROMOTION_ATTR, label: "x", readBy: "x" }] });
    const d = filled(initialDraft(item("webinars"), X), { attrs: { [NO_PROMOTION_ATTR]: "yes" } });
    expect(buildCreateRequest(d, X, PLAN).attrs).not.toHaveProperty(NO_PROMOTION_ATTR);
  });
});

describe("hasNoPromotionMarker", () => {
  it("is true only for a literal true", () => {
    expect(hasNoPromotionMarker({ attrs: { [NO_PROMOTION_ATTR]: true } })).toBe(true);
    expect(hasNoPromotionMarker({ attrs: { [NO_PROMOTION_ATTR]: "true" } })).toBe(false);
    expect(hasNoPromotionMarker({ attrs: {} })).toBe(false);
    expect(hasNoPromotionMarker({})).toBe(false);
  });
});
