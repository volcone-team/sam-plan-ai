import { describe, it, expect } from "vitest";
import {
  firstSignupStep,
  afterRegistration,
  pathForStep,
  asPlanId,
  asBillingCycle,
  shouldShowWelcome,
  type SignupContext,
} from "./signup-flow";

const TRIAL_ON: SignupContext = { trialEnabled: true, stripeEnabled: true };
const TRIAL_OFF: SignupContext = { trialEnabled: false, stripeEnabled: true };
const BILLING_OFF: SignupContext = { trialEnabled: true, stripeEnabled: false };

const PLAN = "e4dce2b7-8fa0-495d-8ffb-fa4de1b8d866";

describe("firstSignupStep", () => {
  it("goes straight to register when a trial is on", () => {
    // No plan choice and no card: the whole point of the trial flow.
    expect(firstSignupStep(TRIAL_ON)).toBe("register");
  });

  it("asks for a plan first when there is no trial", () => {
    expect(firstSignupStep(TRIAL_OFF)).toBe("choose_plan");
  });

  /**
   * With billing off there is nothing to sell, so a plan picker would ask
   * someone to choose between options that do not apply to them.
   */
  it("skips the plan picker entirely when billing is off", () => {
    expect(firstSignupStep(BILLING_OFF)).toBe("register");
    expect(firstSignupStep({ trialEnabled: false, stripeEnabled: false })).toBe(
      "register"
    );
  });
});

describe("afterRegistration", () => {
  it("drops a trial user straight into the product", () => {
    expect(afterRegistration(TRIAL_ON, null)).toBe("dashboard");
  });

  it("sends a paying signup to checkout with their chosen plan", () => {
    expect(afterRegistration(TRIAL_OFF, PLAN)).toBe("checkout");
  });

  /**
   * The plan travels through the confirmation EMAIL LINK, which may be opened
   * in a different browser or days later. Losing it must not strand them.
   */
  it("asks again when the chosen plan was lost in the round trip", () => {
    expect(afterRegistration(TRIAL_OFF, null)).toBe("choose_plan");
  });

  it("ignores a carried plan when billing is off", () => {
    // Nothing to charge for, so checkout would fail.
    expect(afterRegistration(BILLING_OFF, PLAN)).toBe("dashboard");
  });

  it("ignores a carried plan when a trial is running", () => {
    // They already have access; charging now would be charging twice.
    expect(afterRegistration(TRIAL_ON, PLAN)).toBe("dashboard");
  });
});

describe("pathForStep", () => {
  it("carries the plan through signup so it survives the email link", () => {
    expect(pathForStep("register", PLAN)).toBe(`/auth/signup?plan=${PLAN}`);
  });

  it("omits the parameter when there is no plan", () => {
    expect(pathForStep("register", null)).toBe("/auth/signup");
  });

  it("falls back to the picker when checkout has no plan", () => {
    // A checkout with nothing to buy is a dead end.
    expect(pathForStep("checkout", null)).toBe("/choose-plan");
  });

  it("encodes the plan id", () => {
    expect(pathForStep("checkout", "a b")).toContain("a%20b");
  });

  it("maps every step to a real path", () => {
    for (const step of ["choose_plan", "register", "welcome", "dashboard"] as const) {
      expect(pathForStep(step)).toMatch(/^\//);
    }
  });
});

describe("asPlanId", () => {
  it("accepts a plan id", () => {
    expect(asPlanId(PLAN)).toBe(PLAN);
  });

  /**
   * The value arrives in a QUERY STRING and is user-editable. Shape checking
   * is not authorisation — the server re-checks the plan at checkout — but it
   * keeps junk out of the query.
   */
  it("rejects anything that is not a uuid", () => {
    for (const bad of [
      "",
      "starter",
      "'; drop table plans; --",
      "../../etc/passwd",
      "<script>",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(asPlanId(bad)).toBeNull();
    }
  });
});

describe("shouldShowWelcome", () => {
  it("shows it to someone who has paid but not yet built a plan", () => {
    expect(shouldShowWelcome({ hasActivePlan: true, hasBuiltPlan: false })).toBe(true);
  });

  it("does not show it once they have a plan built", () => {
    expect(shouldShowWelcome({ hasActivePlan: true, hasBuiltPlan: true })).toBe(false);
  });

  /**
   * Keyed on real state, not a "seen" flag: someone who paid and abandoned
   * onboarding should land back here rather than on an empty dashboard.
   */
  it("does not show it to someone with no active plan", () => {
    expect(shouldShowWelcome({ hasActivePlan: false, hasBuiltPlan: false })).toBe(false);
  });
});

describe("billing cycle carried with the plan", () => {
  it("accepts only monthly and annual", () => {
    expect(asBillingCycle("monthly")).toBe("monthly");
    expect(asBillingCycle("annual")).toBe("annual");
    for (const junk of ["yearly", "ANNUAL", "", null, undefined, 12]) {
      expect(asBillingCycle(junk)).toBeNull();
    }
  });

  it("appends the cycle to register and checkout paths", () => {
    expect(pathForStep("register", PLAN, "annual")).toBe(`/auth/signup?plan=${PLAN}&cycle=annual`);
    expect(pathForStep("checkout", PLAN, "annual")).toBe(`/checkout?plan=${PLAN}&cycle=annual`);
    expect(pathForStep("checkout", PLAN, "monthly")).toBe(`/checkout?plan=${PLAN}&cycle=monthly`);
  });

  it("leaves paths unchanged when no cycle is given", () => {
    expect(pathForStep("checkout", PLAN)).toBe(`/checkout?plan=${PLAN}`);
    expect(pathForStep("register", PLAN, null)).toBe(`/auth/signup?plan=${PLAN}`);
  });

  it("never attaches a cycle without a plan", () => {
    expect(pathForStep("checkout", null, "annual")).toBe("/choose-plan");
    expect(pathForStep("register", null, "annual")).toBe("/auth/signup");
  });
});
