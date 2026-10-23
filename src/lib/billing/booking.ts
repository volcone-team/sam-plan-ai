/**
 * Booking links for the two coaching-call save-offers, and the copy that goes
 * around them.
 *
 * WHY THE SCREENS ARE GATED ON CONFIGURATION. Both offers are a single booking
 * button; without a URL the primary action on the screen does nothing. A step
 * that cannot do anything is worse than no step, because the customer spends a
 * click discovering it is broken and we spend their patience. So an unset URL
 * removes the offer from the flow entirely and the journey is one screen
 * shorter — the same mechanism ENABLED_OFFERS uses for screens that are not
 * built.
 *
 * Pure: no database, no React. The caller reads app_settings and passes the raw
 * values in.
 */

/**
 * Is this a usable booking link?
 *
 * HTTPS ONLY. These URLs are typed into an admin field and rendered as a link
 * the customer clicks, so `javascript:` and `data:` must never survive, and a
 * plain `http://` booking page would downgrade a page the customer reached over
 * TLS. Host is deliberately NOT checked: Calendly, GoHighLevel, SavvyCal and a
 * plain contact page are all legitimate, and an allowlist would just be a
 * support ticket waiting to happen.
 */
export function isUsableBookingUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    return new URL(trimmed).protocol === "https:";
  } catch {
    // Not a parseable absolute URL.
    return false;
  }
}

export interface BookingUrls {
  /** 2b — the plan reset call, or null when not configured. */
  resetCall: string | null;
  /** 2c — the strategy call, or null when not configured. */
  strategyCall: string | null;
}

/**
 * Resolve the two links from raw settings.
 *
 * THE STRATEGY CALL FALLS BACK TO THE RESET CALL, so an operator with a single
 * calendar pastes one URL and both screens work. The reverse fallback is
 * deliberately absent: filling in only the strategy URL is a clear statement
 * that the reset call is not on offer, and inventing one from it would put a
 * screen in front of customers that nobody set up.
 */
export function resolveBookingUrls(raw: {
  resetCallUrl?: unknown;
  strategyCallUrl?: unknown;
}): BookingUrls {
  const reset = isUsableBookingUrl(raw.resetCallUrl) ? raw.resetCallUrl.trim() : null;
  const strategy = isUsableBookingUrl(raw.strategyCallUrl)
    ? raw.strategyCallUrl.trim()
    : null;

  return {
    resetCall: reset,
    strategyCall: strategy ?? reset,
  };
}

/* ------------------------------------------------------------------ *
 * The onboarding call link, by billing cycle
 * ------------------------------------------------------------------ */

/**
 * Billing-cycle values that mean "yearly".
 *
 * `subscriptions.billing_cycle` stores "annual" (migration 022's CHECK, and the
 * webhook writes it from the Stripe interval); "yearly" is the client's word
 * for the same thing (see the annual/yearly note in src/lib/ghl/tags.ts), so
 * both are accepted rather than one being a silent miss.
 */
const YEARLY_CYCLES = new Set(["annual", "yearly"]);

/**
 * Which onboarding booking link a customer should see.
 *
 * `monthlyUrl` is `app_settings.onboarding_call_url` (migration 043), which
 * also serves trials, comped accounts and anyone without a paid subscription;
 * `yearlyUrl` is `onboarding_call_url_yearly` (migration 048).
 *
 * A YEARLY CUSTOMER FALLS BACK TO THE MONTHLY LINK when no usable yearly link
 * is set, so an operator with one calendar fills in one field and everybody can
 * book. The reverse fallback is deliberately absent: a monthly customer never
 * gets the yearly calendar, because a separate yearly calendar is exactly the
 * thing the operator set up to keep apart.
 *
 * `billingCycle` should be null for anything that is not a paid subscription —
 * see `onboardingBookingCycle`. Anything other than "annual"/"yearly" (case and
 * whitespace ignored) reads as monthly. Both links are re-validated here with
 * isUsableBookingUrl, so a value can be passed straight from the database.
 */
export function resolveOnboardingBookingUrl(args: {
  monthlyUrl: unknown;
  yearlyUrl: unknown;
  billingCycle: unknown;
}): string | null {
  const monthly = isUsableBookingUrl(args.monthlyUrl) ? args.monthlyUrl.trim() : null;
  const cycle =
    typeof args.billingCycle === "string" ? args.billingCycle.trim().toLowerCase() : "";

  if (YEARLY_CYCLES.has(cycle) && isUsableBookingUrl(args.yearlyUrl)) {
    return args.yearlyUrl.trim();
  }
  return monthly;
}

/**
 * The billing cycle to choose the onboarding link by, from the access decision.
 *
 * Only a PAID subscription has a cycle worth honouring. A trial, a comp, open
 * access with billing switched off, and no subscription at all read as null
 * (the monthly link), whatever `subscriptions.billing_cycle` happens to hold:
 * that column is NOT NULL with a 'monthly' default, so trial rows carry a
 * value nobody chose, and a comp layered over an old annual row is not a yearly
 * purchase.
 */
export function onboardingBookingCycle(args: {
  accessReason: string | null | undefined;
  billingCycle: string | null | undefined;
}): string | null {
  if (args.accessReason !== "active" && args.accessReason !== "grace_period") return null;
  return args.billingCycle ?? null;
}

/* ------------------------------------------------------------------ *
 * Copy
 * ------------------------------------------------------------------ */

export interface CallPerk {
  title: string;
  /** "Included", "Free", "Live, every Tuesday" — the badge beside the title. */
  badge: string | null;
  body: string;
}

export interface ResetCallCopy {
  title: string;
  subtitle: string;
  perk: CallPerk;
  bullets: string[];
  bookLabel: string;
  /** Secondary action, shown only when pausing is also available. */
  pauseLabel: string;
  declineLabel: string;
}

/**
 * 2b — "I feel behind and stopped".
 *
 * The mockup's perk box promises "billing pauses until your call so you don't
 * pay while you're stuck". THAT PROMISE IS NOT MADE HERE, and the omission is
 * deliberate: an automatic pause tied to a booking would mean reading a
 * third-party calendar to know when the call is, and pausing stops access under
 * the agreed semantics — so it would lock someone out of the very plan the call
 * is about reviewing. The pause is offered as an explicit, separate button
 * instead, which the customer chooses knowingly.
 */
export function describeResetCallOffer(args?: { pauseAvailable?: boolean }): ResetCallCopy {
  return {
    title: "Falling behind happens. Let's reset, not restart",
    subtitle:
      "Most people who miss a few weeks just need one conversation to get moving " +
      "again. No charge, and no obligation to stay.",
    perk: {
      title: "Free 15-minute plan reset call",
      badge: "Included",
      body:
        "A coach looks at where your plan stalled and what to drop, so you restart " +
        "from where you are rather than from the beginning.",
    },
    bullets: [
      "We clear the backlog instead of making you catch up on it",
      "We pick the one initiative that matters most this month",
      "Fifteen minutes, and you can leave with the plan either way",
    ],
    bookLabel: "Book my reset call",
    pauseLabel: args?.pauseAvailable
      ? "Just pause my plan instead"
      : "",
    declineLabel: "No thanks, continue to cancel",
  };
}

export interface StrategyCallCopy {
  title: string;
  subtitle: string;
  perks: CallPerk[];
  bookLabel: string;
  declineLabel: string;
}

/**
 * 2c — "I'm not seeing results yet".
 *
 * The mockup lists a second perk, a "Weekly ROS meeting", and a link to an
 * "architect workshop". Neither exists anywhere in this product, so neither is
 * promised here — the strategy call is real because it is a human on a
 * calendar, and the rest would be advertising features we do not have to
 * someone already unhappy about results.
 */
export function describeStrategyCallOffer(): StrategyCallCopy {
  return {
    title: "Let's look at your numbers together",
    subtitle:
      "When results stall it is usually the sequence, not the effort. A second " +
      "set of eyes finds it faster than another month of guessing.",
    perks: [
      {
        title: "1:1 strategy call",
        badge: "Free",
        body:
          "A coach reviews your plan and what it has actually returned so far, " +
          "then tells you what to change first.",
      },
    ],
    bookLabel: "Book my strategy call",
    declineLabel: "No thanks, continue to cancel",
  };
}

export interface CallBookedCopy {
  title: string;
  body: string;
  nextStepTitle: string;
  nextStepBody: string;
  ctaLabel: string;
  ctaHref: string;
}

/**
 * The screen after a call is booked.
 *
 * CAREFULLY HEDGED, because we cannot verify the booking. The button opens a
 * third-party calendar in a new tab and nothing reports back whether a slot was
 * actually chosen, so this says the plan is staying — which IS true, we just
 * kept it — rather than "your call is confirmed", which we do not know.
 */
export function describeCallBooked(args: { reasonWasResults: boolean }): CallBookedCopy {
  return {
    title: "You're all set. Glad you're staying.",
    body:
      "Your plan carries on exactly as it was — nothing has changed on your " +
      "billing. Pick a time that suits you in the tab that just opened, and " +
      "we'll see you on the call.",
    nextStepTitle: "Before the call",
    nextStepBody: args.reasonWasResults
      ? "Have a look at what your initiatives have returned so far. The numbers " +
        "are the fastest way into the conversation."
      : "Have a quick look at your plan and note the bits that stalled. That is " +
        "all the preparation it needs.",
    ctaLabel: "Go to my plan",
    ctaHref: "/year-at-a-glance",
  };
}
