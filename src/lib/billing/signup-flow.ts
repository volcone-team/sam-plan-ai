/**
 * Where a new user goes next, and whether they must pick a plan first.
 *
 * TWO FLOWS, chosen by the admin's trial toggle:
 *
 *   trial ON   register -> trial on the chosen plan -> dashboard
 *              No plan choice, no card, no Stripe. They are in immediately and
 *              the clock starts.
 *
 *   trial OFF  choose plan -> register -> Stripe -> welcome
 *              Nothing is free, so the plan is chosen BEFORE the account exists
 *              and payment happens straight after confirmation.
 *
 * The awkward part is that with trials off the plan is chosen before there is
 * anywhere to store it. It therefore travels in the URL, through signup and the
 * email confirmation link, until an account exists to attach it to. That makes
 * it UNTRUSTED: a plan id in a query string is user-editable, so it only ever
 * selects which plan to offer at checkout — never what they get. Entitlement
 * still comes from Stripe via the webhook.
 *
 * Pure so the branching can be tested exhaustively. Getting it wrong either
 * gives the product away free or strands a paying customer mid-signup.
 */

/** Signup destinations. Slugs, not paths, so callers cannot invent routes. */
export type SignupStep =
  | "choose_plan"
  | "register"
  | "checkout"
  | "welcome"
  | "dashboard";

export interface SignupContext {
  /** app_settings.trial_enabled */
  trialEnabled: boolean;
  /** Whether billing is on at all. Off means the app is open. */
  stripeEnabled: boolean;
}

/**
 * The first screen a visitor who wants an account should see.
 *
 * With billing OFF this is always `register`: there is nothing to sell, so a
 * plan picker would be a dead end asking people to choose between things that
 * do not apply.
 */
export function firstSignupStep(ctx: SignupContext): SignupStep {
  if (!ctx.stripeEnabled) return "register";
  return ctx.trialEnabled ? "register" : "choose_plan";
}

/**
 * Where to send someone once their account is confirmed and they are signed in.
 *
 * `selectedPlanId` is the plan carried from the pre-signup picker, if any.
 */
export function afterRegistration(
  ctx: SignupContext,
  selectedPlanId: string | null
): SignupStep {
  // Billing off, or a trial running: they already have access.
  if (!ctx.stripeEnabled || ctx.trialEnabled) return "dashboard";

  /*
   * Trials off and no plan carried through. Not an error — they may have
   * registered from a direct link, or the parameter may have been lost in the
   * email round trip — so they are asked to choose rather than being stuck.
   */
  if (!selectedPlanId) return "choose_plan";

  return "checkout";
}

/** A billing cycle chosen on /get-started. */
export type SignupBillingCycle = "monthly" | "annual";

/**
 * Validate a billing cycle arriving from a URL. UNTRUSTED like the plan: it
 * only chooses which price to offer, and Stripe's hosted page shows the actual
 * amount before anything is charged.
 */
export function asBillingCycle(value: unknown): SignupBillingCycle | null {
  return value === "monthly" || value === "annual" ? value : null;
}

/** `&cycle=...` when a cycle is known, else nothing (checkout defaults to monthly). */
function cycleSuffix(cycle: SignupBillingCycle | null | undefined): string {
  return cycle ? `&cycle=${cycle}` : "";
}

/**
 * Path for a step. One place, so no caller hardcodes a route.
 *
 * The plan and the cycle ride along together, through signup and the
 * confirmation email link, to checkout.
 */
export function pathForStep(
  step: SignupStep,
  planId?: string | null,
  cycle?: SignupBillingCycle | null
): string {
  switch (step) {
    case "choose_plan":
      return "/choose-plan";
    case "register":
      // The plan rides along so it survives into the confirmation email link.
      return planId
        ? `/auth/signup?plan=${encodeURIComponent(planId)}${cycleSuffix(cycle)}`
        : "/auth/signup";
    case "checkout":
      return planId
        ? `/checkout?plan=${encodeURIComponent(planId)}${cycleSuffix(cycle)}`
        : "/choose-plan";
    case "welcome":
      return "/welcome";
    case "dashboard":
      return "/year-at-a-glance";
  }
}

/**
 * Validate a plan id arriving from a URL.
 *
 * Shape only — this says nothing about whether the plan exists, is active, or
 * is purchasable. Those are the server's job at checkout. The point here is to
 * reject obvious junk before it reaches a query, and to make clear at the call
 * site that the value is untrusted.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asPlanId(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

/**
 * Should the welcome page be shown, or has this user seen it?
 *
 * Keyed on whether they have ever had a plan built, NOT on a "seen" flag: the
 * welcome page is the handover between paying and using the product, and
 * someone who paid but never finished onboarding should land back on it rather
 * than on an empty dashboard.
 */
export function shouldShowWelcome(args: {
  hasActivePlan: boolean;
  hasBuiltPlan: boolean;
}): boolean {
  return args.hasActivePlan && !args.hasBuiltPlan;
}
