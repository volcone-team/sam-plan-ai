import { describe, it, expect } from "vitest";
import {
  isUsableBookingUrl,
  resolveBookingUrls,
  resolveOnboardingBookingUrl,
  resolvePlanOnboardingBookingUrl,
  onboardingBookingCycle,
  describeResetCallOffer,
  describeStrategyCallOffer,
  describeCallBooked,
} from "./booking";

describe("isUsableBookingUrl", () => {
  it("accepts any https booking provider", () => {
    for (const url of [
      "https://calendly.com/sam-plan/reset",
      "https://api.leadconnectorhq.com/widget/booking/abc123",
      "https://savvycal.com/sam/strategy",
      "https://book.example.co.uk/a-call?utm_source=app",
    ]) {
      expect(isUsableBookingUrl(url)).toBe(true);
    }
  });

  /**
   * THE SECURITY-RELEVANT CASE. These URLs are typed into an admin field and
   * rendered as a link the customer clicks, so a script-bearing scheme must
   * never survive validation.
   */
  it("rejects schemes that are not https", () => {
    for (const url of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox",
      "file:///etc/passwd",
      // Plain http would downgrade a page the customer reached over TLS.
      "http://calendly.com/sam-plan/reset",
    ]) {
      expect(isUsableBookingUrl(url)).toBe(false);
    }
  });

  it("rejects blanks, relative paths and non-strings", () => {
    for (const bad of ["", "   ", "calendly.com/sam", "/book", null, undefined, 7, {}, true]) {
      expect(isUsableBookingUrl(bad)).toBe(false);
    }
  });

  it("tolerates surrounding whitespace, which a paste always brings", () => {
    expect(isUsableBookingUrl("  https://calendly.com/sam  ")).toBe(true);
  });
});

describe("resolveBookingUrls", () => {
  const reset = "https://calendly.com/sam/reset";
  const strategy = "https://calendly.com/sam/strategy";

  it("uses each URL for its own screen when both are set", () => {
    expect(resolveBookingUrls({ resetCallUrl: reset, strategyCallUrl: strategy }))
      .toEqual({ resetCall: reset, strategyCall: strategy });
  });

  /**
   * The single-calendar case, which is the common one. Pasting one URL must
   * light up both screens rather than making the operator paste it twice.
   */
  it("falls back to the reset URL for the strategy call", () => {
    expect(resolveBookingUrls({ resetCallUrl: reset }))
      .toEqual({ resetCall: reset, strategyCall: reset });
    expect(resolveBookingUrls({ resetCallUrl: reset, strategyCallUrl: "" }))
      .toEqual({ resetCall: reset, strategyCall: reset });
  });

  /**
   * NOT symmetric, on purpose. Filling in only the strategy URL says the reset
   * call is not on offer; inventing one from it would put a screen in front of
   * customers that nobody set up.
   */
  it("does not invent a reset call from the strategy URL", () => {
    expect(resolveBookingUrls({ strategyCallUrl: strategy }))
      .toEqual({ resetCall: null, strategyCall: strategy });
  });

  it("is all null when nothing is configured, which hides both screens", () => {
    expect(resolveBookingUrls({})).toEqual({ resetCall: null, strategyCall: null });
    expect(resolveBookingUrls({ resetCallUrl: null, strategyCallUrl: null }))
      .toEqual({ resetCall: null, strategyCall: null });
  });

  it("treats an unusable URL as unset rather than passing it through", () => {
    expect(resolveBookingUrls({ resetCallUrl: "javascript:alert(1)" }))
      .toEqual({ resetCall: null, strategyCall: null });
    expect(resolveBookingUrls({ resetCallUrl: "not a url", strategyCallUrl: strategy }))
      .toEqual({ resetCall: null, strategyCall: strategy });
  });

  it("trims what it stores", () => {
    expect(resolveBookingUrls({ resetCallUrl: `  ${reset}  ` }).resetCall).toBe(reset);
  });
});

describe("describeResetCallOffer — 2b", () => {
  it("names the perk and both exits", () => {
    const copy = describeResetCallOffer({ pauseAvailable: true });
    expect(copy.perk.title).toMatch(/15-minute plan reset call/i);
    expect(copy.perk.badge).toBe("Included");
    expect(copy.bookLabel).toBe("Book my reset call");
    expect(copy.pauseLabel).toBe("Just pause my plan instead");
    expect(copy.declineLabel).toMatch(/continue to cancel/i);
  });

  /** No pause option for an annual subscriber, who cannot usefully pause. */
  it("drops the pause secondary when pausing is unavailable", () => {
    expect(describeResetCallOffer({ pauseAvailable: false }).pauseLabel).toBe("");
    expect(describeResetCallOffer().pauseLabel).toBe("");
  });

  /**
   * The mockup promises "billing pauses until your call". Not made here: it
   * would require reading a third-party calendar to know when the call is, and
   * a pause stops ACCESS, so it would lock someone out of the very plan the
   * call is about reviewing.
   */
  it("does not promise an automatic pause", () => {
    const copy = describeResetCallOffer({ pauseAvailable: true });
    const all = [copy.subtitle, copy.perk.body, ...copy.bullets].join(" ");
    expect(all).not.toMatch(/billing pauses|pause until|won't pay/i);
  });

  it("promises no features that do not exist", () => {
    const copy = describeResetCallOffer({ pauseAvailable: true });
    const all = [copy.subtitle, copy.perk.body, ...copy.bullets].join(" ");
    expect(all).not.toMatch(/scorecard|ROS meeting|workshop/i);
  });
});

describe("describeStrategyCallOffer — 2c", () => {
  const copy = describeStrategyCallOffer();

  it("offers the call and nothing else", () => {
    expect(copy.perks).toHaveLength(1);
    expect(copy.perks[0].title).toMatch(/strategy call/i);
    expect(copy.bookLabel).toBe("Book my strategy call");
  });

  /**
   * The mockup also lists a "Weekly ROS meeting" and links an "architect
   * workshop". Neither exists in this product, and advertising them to someone
   * already unhappy about results is the worst possible moment to oversell.
   */
  it("does not advertise the ROS meeting or the architect workshop", () => {
    const all = [copy.title, copy.subtitle, ...copy.perks.map((p) => `${p.title} ${p.body}`)].join(" ");
    expect(all).not.toMatch(/ROS meeting|architect|workshop|scorecard/i);
  });
});

describe("describeCallBooked", () => {
  /**
   * We cannot verify a booking: the link opens a third-party calendar in a new
   * tab and nothing reports back. So the screen must claim only what is known
   * — the plan is staying — and not "your call is confirmed".
   */
  it("does not claim the call is confirmed", () => {
    const copy = describeCallBooked({ reasonWasResults: false });
    expect(copy.body).not.toMatch(/confirmed|booked for|we'll see you on \w+day/i);
    expect(copy.body).toMatch(/pick a time/i);
  });

  it("states that billing is unchanged, which is the reassurance that matters", () => {
    expect(describeCallBooked({ reasonWasResults: true }).body)
      .toMatch(/nothing has changed on your billing/i);
  });

  it("tailors the preparation note to the reason", () => {
    expect(describeCallBooked({ reasonWasResults: true }).nextStepBody)
      .toMatch(/returned so far|numbers/i);
    expect(describeCallBooked({ reasonWasResults: false }).nextStepBody)
      .toMatch(/stalled/i);
  });

  it("sends them to a page that exists", () => {
    expect(describeCallBooked({ reasonWasResults: false }).ctaHref).toBe("/year-at-a-glance");
  });
});

describe("resolvePlanOnboardingBookingUrl", () => {
  const global = { monthlyUrl: "https://g.example.com/m", yearlyUrl: "https://g.example.com/y" };
  const plan = { planMonthlyUrl: "https://p.example.com/m", planYearlyUrl: "https://p.example.com/y" };

  it("uses the plan's monthly link for a monthly purchase", () => {
    expect(resolvePlanOnboardingBookingUrl({ ...plan, ...global, billingCycle: "monthly" })).toBe(plan.planMonthlyUrl);
    expect(resolvePlanOnboardingBookingUrl({ ...plan, ...global, billingCycle: null })).toBe(plan.planMonthlyUrl);
  });

  it("uses the plan's yearly link for a yearly purchase", () => {
    expect(resolvePlanOnboardingBookingUrl({ ...plan, ...global, billingCycle: "annual" })).toBe(plan.planYearlyUrl);
  });

  it("falls back to the global links when the plan link is empty or unusable", () => {
    expect(resolvePlanOnboardingBookingUrl({ planMonthlyUrl: "", planYearlyUrl: null, ...global, billingCycle: "monthly" })).toBe(global.monthlyUrl);
    expect(resolvePlanOnboardingBookingUrl({ planMonthlyUrl: null, planYearlyUrl: "javascript:alert(1)", ...global, billingCycle: "annual" })).toBe(global.yearlyUrl);
  });

  it("never gives a monthly customer the plan's yearly link", () => {
    expect(resolvePlanOnboardingBookingUrl({ planMonthlyUrl: null, planYearlyUrl: plan.planYearlyUrl, ...global, billingCycle: "monthly" })).toBe(global.monthlyUrl);
  });
});

describe("resolveOnboardingBookingUrl", () => {
  const monthly = "https://link.gohighlevel.com/widget/bookings/sam-monthly";
  const yearly = "https://link.gohighlevel.com/widget/bookings/sam-yearly";

  it.each(["annual", "yearly", "ANNUAL", " Yearly "])(
    "gives a %o customer the yearly link",
    (billingCycle) => {
      expect(resolveOnboardingBookingUrl({ monthlyUrl: monthly, yearlyUrl: yearly, billingCycle }))
        .toBe(yearly);
    }
  );

  it.each(["monthly", null, undefined, "", "weekly", 12, {}])(
    "gives a %o customer the monthly link, never the yearly one",
    (billingCycle) => {
      expect(resolveOnboardingBookingUrl({ monthlyUrl: monthly, yearlyUrl: yearly, billingCycle }))
        .toBe(monthly);
    }
  );

  it.each([null, undefined, "", "   ", "javascript:alert(1)", "http://insecure.example.com", 7])(
    "falls back to the monthly link for a yearly customer when the yearly link is %o",
    (yearlyUrl) => {
      expect(resolveOnboardingBookingUrl({ monthlyUrl: monthly, yearlyUrl, billingCycle: "annual" }))
        .toBe(monthly);
    }
  );

  it("is null when neither link is usable, whatever the cycle", () => {
    for (const billingCycle of ["annual", "monthly", null]) {
      expect(
        resolveOnboardingBookingUrl({
          monthlyUrl: "javascript:alert(1)",
          yearlyUrl: null,
          billingCycle,
        })
      ).toBeNull();
    }
  });

  it("gives a yearly customer the yearly link even with no monthly link set", () => {
    expect(resolveOnboardingBookingUrl({ monthlyUrl: null, yearlyUrl: yearly, billingCycle: "annual" }))
      .toBe(yearly);
  });

  it("does not invent a monthly link from the yearly one", () => {
    expect(resolveOnboardingBookingUrl({ monthlyUrl: null, yearlyUrl: yearly, billingCycle: "monthly" }))
      .toBeNull();
    expect(resolveOnboardingBookingUrl({ monthlyUrl: "", yearlyUrl: yearly, billingCycle: null }))
      .toBeNull();
  });

  it("trims what it returns", () => {
    expect(
      resolveOnboardingBookingUrl({
        monthlyUrl: `  ${monthly}  `,
        yearlyUrl: `  ${yearly}  `,
        billingCycle: "annual",
      })
    ).toBe(yearly);
    expect(
      resolveOnboardingBookingUrl({ monthlyUrl: `  ${monthly}  `, yearlyUrl: null, billingCycle: null })
    ).toBe(monthly);
  });

  it("only ever returns one of the two links or null, for every combination", () => {
    const urls = [monthly, yearly, null, "", "javascript:x", "http://a.b"];
    const cycles = ["annual", "yearly", "monthly", null, "other"];
    for (const monthlyUrl of urls) {
      for (const yearlyUrl of urls) {
        for (const billingCycle of cycles) {
          const out = resolveOnboardingBookingUrl({ monthlyUrl, yearlyUrl, billingCycle });
          const monthlyOk = isUsableBookingUrl(monthlyUrl) ? monthlyUrl : null;
          const isYearly = billingCycle === "annual" || billingCycle === "yearly";
          const expected = isYearly && isUsableBookingUrl(yearlyUrl) ? yearlyUrl : monthlyOk;
          expect(out).toBe(expected);
        }
      }
    }
  });
});

describe("onboardingBookingCycle", () => {
  it.each(["active", "grace_period"])("passes the cycle through for a paid %s subscription", (r) => {
    expect(onboardingBookingCycle({ accessReason: r, billingCycle: "annual" })).toBe("annual");
    expect(onboardingBookingCycle({ accessReason: r, billingCycle: "monthly" })).toBe("monthly");
    expect(onboardingBookingCycle({ accessReason: r, billingCycle: null })).toBeNull();
  });

  /** Trial rows carry the column's 'monthly' default; a comp may sit on an old annual row. */
  it.each(["trialing", "comped", "billing_disabled", "no_subscription", null, undefined])(
    "reads %o as no cycle, which means the monthly link",
    (accessReason) => {
      expect(onboardingBookingCycle({ accessReason, billingCycle: "annual" })).toBeNull();
    }
  );
});
