/**
 * Self-service pause decisions, as pure functions.
 *
 * WHAT A PAUSE MEANS HERE, because the answer shapes everything below:
 * billing stops, ACCESS STOPS, and nothing is deleted. Stopping the money
 * while leaving the product open would be giving it away, so a pause reuses the
 * existing `is_paused` gate in evaluateAccess — the same gate an admin
 * suspension uses.
 *
 * THAT IS WHY THE COPY IN HERE DEVIATES FROM THE MOCKUP. The design says
 * "everything waits for you exactly as you left it" and lists what stays saved,
 * but never says the customer is locked out meanwhile. Someone who pauses
 * expecting to keep working and finds themselves on a "your plan is paused"
 * screen has been misled by us, so every string below states it plainly.
 *
 * No database, no Stripe, no React.
 */

import { addMonthsClamped } from "@/lib/billing/month-math";

/** The three options on the segmented control, from the mockup. */
export const PAUSE_DURATIONS = [1, 2, 3] as const;

export type PauseMonths = (typeof PAUSE_DURATIONS)[number];

export function isPauseMonths(value: unknown): value is PauseMonths {
  return (
    typeof value === "number" &&
    (PAUSE_DURATIONS as readonly number[]).includes(value)
  );
}

/** Where a pause came from. Decides whether the customer may lift it. */
export type PauseOrigin = "admin" | "customer";

export function isPauseOrigin(value: unknown): value is PauseOrigin {
  return value === "admin" || value === "customer";
}

/* ------------------------------------------------------------------ *
 * May this customer pause, and may they un-pause?
 * ------------------------------------------------------------------ */

export type PauseBlocker =
  | "not_eligible_to_cancel"
  | "not_monthly";

export type PauseEligibility =
  | { allowed: true }
  | { allowed: false; blocker: PauseBlocker };

/**
 * May this customer pause their own billing?
 *
 * `cancelEligible` carries most of the work: canCancel already refuses a
 * comped account (nothing to pause), a trial (no Stripe subscription to stop
 * collecting on), an already-paused account and one that is already ending.
 * Reusing it means pause and cancel cannot disagree about who is in a normal
 * paying state.
 *
 * MONTHLY ONLY, for a reason that is easy to miss: `pause_collection`
 * suppresses invoices RAISED during the pause window — it does not move a
 * renewal date. An annual subscriber whose renewal is ten months away would
 * have nothing suppressed by a one-to-three month pause, so they would lose
 * access and save nothing. That is strictly worse for them than doing nothing,
 * so the screen is not offered. It is the same reason the retention discounts
 * are cycle-restricted.
 */
export function canPauseSelf(args: {
  cancelEligible: boolean;
  billingCycle: string | null;
}): PauseEligibility {
  if (!args.cancelEligible) {
    return { allowed: false, blocker: "not_eligible_to_cancel" };
  }
  if (args.billingCycle !== "monthly") {
    return { allowed: false, blocker: "not_monthly" };
  }
  return { allowed: true };
}

export type ResumeBlocker = "not_paused" | "admin_paused";

export type ResumeEligibility =
  | { allowed: true }
  | { allowed: false; blocker: ResumeBlocker };

/**
 * May this customer lift the pause themselves?
 *
 * THE SECURITY-RELEVANT ONE. An admin pause is a suspension — non-payment, a
 * contract dispute, abuse — and the customer must not be able to undo it. A
 * pause they chose is theirs to end whenever they like.
 *
 * A NULL origin is treated as an admin pause. Every pause that existed before
 * migration 032 was applied by the admin route, and the migration backfills
 * them accordingly; this default is the belt to that braces, so a row the
 * backfill somehow missed fails closed rather than handing a suspended account
 * the ability to un-suspend itself.
 */
export function canResumeSelf(args: {
  isPaused: boolean;
  pauseOrigin: string | null;
}): ResumeEligibility {
  if (!args.isPaused) return { allowed: false, blocker: "not_paused" };
  if (args.pauseOrigin !== "customer") {
    return { allowed: false, blocker: "admin_paused" };
  }
  return { allowed: true };
}

/** Why pausing or resuming is unavailable, in words a customer can act on. */
export function explainPauseBlocker(blocker: PauseBlocker | ResumeBlocker): string {
  switch (blocker) {
    case "not_eligible_to_cancel":
      return "Pausing is not available on this account right now.";
    case "not_monthly":
      // Deliberately does NOT suggest switching to monthly to unlock it.
      return "Pausing is only available on monthly billing.";
    case "not_paused":
      return "Your plan is not paused.";
    case "admin_paused":
      // Says nothing about why: pause_reason is an internal admin note.
      return "Your account was paused by an administrator, so it cannot be resumed here. Please contact support.";
  }
}

/* ------------------------------------------------------------------ *
 * Dates
 * ------------------------------------------------------------------ */

export interface PauseSchedule {
  /** When billing stops. Immediate — the mockup's "Billing pauses: Today". */
  pausesAt: string;
  /** When Stripe starts collecting again. */
  resumesAt: string;
}

/**
 * When the pause starts and ends.
 *
 * Counted from NOW rather than from the end of the paid period, matching the
 * mockup's "Billing pauses — Today". That does hand the customer the remainder
 * of a period they have already paid for on top of the pause, which is the
 * natural cost of pausing mid-cycle and not worth complicating the offer to
 * claw back.
 *
 * `now` is injectable so tests are deterministic.
 */
export function pauseScheduleFor(
  months: PauseMonths,
  now: Date = new Date()
): PauseSchedule {
  const pausesAt = now.toISOString();
  // Non-null for a valid date and a positive month count, both guaranteed here.
  const resumesAt = addMonthsClamped(pausesAt, months)!;
  return { pausesAt, resumesAt };
}

/**
 * How long before the resume date the warning email goes out.
 *
 * Seven days, because that is what the screen promises: "we'll email you a week
 * before billing restarts".
 */
export const PAUSE_REMINDER_LEAD_DAYS = 7;

/**
 * Is it time to warn this customer that billing is about to restart?
 *
 * True inside the final week and not already sent. Deliberately has no lower
 * bound: a cron that missed a day must still send a late reminder rather than
 * skip it, because a silent restart of billing is the outcome the email exists
 * to prevent.
 */
export function shouldSendPauseReminder(args: {
  isPaused: boolean;
  pauseResumesAt: string | null;
  reminderSentAt: string | null;
  now?: number;
  leadDays?: number;
}): boolean {
  if (!args.isPaused) return false;
  if (args.reminderSentAt) return false;
  if (!args.pauseResumesAt) return false;

  const resumes = new Date(args.pauseResumesAt).getTime();
  if (!Number.isFinite(resumes)) return false;

  const now = args.now ?? Date.now();
  const lead = (args.leadDays ?? PAUSE_REMINDER_LEAD_DAYS) * 24 * 60 * 60 * 1000;

  return resumes - now <= lead;
}

/**
 * Has this pause run its course?
 *
 * The question the resume cron asks, and also the safety net inside
 * evaluateAccess: a pause whose date has passed must stop locking the customer
 * out even if no job has run. A pause with no date never expires on its own —
 * that is an open-ended admin suspension.
 */
export function pauseHasElapsed(args: {
  isPaused: boolean;
  pauseResumesAt: string | null;
  now?: number;
}): boolean {
  if (!args.isPaused) return false;
  if (!args.pauseResumesAt) return false;

  const resumes = new Date(args.pauseResumesAt).getTime();
  if (!Number.isFinite(resumes)) return false;

  return resumes <= (args.now ?? Date.now());
}

/* ------------------------------------------------------------------ *
 * Copy
 * ------------------------------------------------------------------ */

export interface PauseOfferCopy {
  title: string;
  subtitle: string;
  durationLabel: string;
  pausesAtLabel: string;
  resumesAtLabel: string;
  /** The checklist under the dates. */
  guarantees: string[];
  declineLabel: string;
}

/**
 * 2d — "Take a break without losing your place".
 *
 * The third guarantee is NOT in the mockup and is the most important line on
 * the screen: it says access stops. The mockup lists what is preserved and
 * leaves the reader to assume the product stays open, which under the agreed
 * semantics it does not. Better to lose a few pauses to honesty than to lock
 * out customers who thought they were keeping access.
 *
 * The mockup's "your founding rate is locked in when you resume" is also gone.
 * Pausing does not change the subscription's price — the Stripe subscription
 * and its price keep existing untouched — so the rate is preserved as a matter
 * of fact, but promising it as a feature invites a dispute if the plan's price
 * is ever restructured.
 */
export function describePauseOffer(): PauseOfferCopy {
  return {
    title: "Take a break without losing your place",
    subtitle:
      "Pause your billing for a few months. Nothing is deleted, and everything " +
      "is waiting exactly as you left it when you come back.",
    durationLabel: "Pause for",
    pausesAtLabel: "Billing pauses",
    resumesAtLabel: "Billing restarts",
    guarantees: [
      "Your plan, initiatives and history stay saved",
      "You keep your current price when billing restarts",
      // The honest one. See the note above.
      "Your access pauses too, and comes straight back when billing restarts",
      "We'll email you a week before billing restarts",
    ],
    declineLabel: "No thanks, continue to cancel",
  };
}

/** "Pause for 1 month" / "Pause for 2 months". */
export function pauseClaimLabel(months: PauseMonths): string {
  return `Pause for ${months} month${months === 1 ? "" : "s"}`;
}

export interface PauseAcceptedCopy {
  title: string;
  body: string;
  nextStepTitle: string;
  nextStepBody: string;
  ctaLabel: string;
}

/**
 * The screen after a pause is applied.
 *
 * Says the access consequence FIRST, because the customer is about to be
 * redirected out of the product and an unexplained lockout seconds after
 * clicking a reassuring green button is the worst version of this.
 */
export function describePauseAccepted(args: {
  months: PauseMonths;
  resumesAt: string | null;
  /** Pre-formatted for display, e.g. "Dec 12, 2026". */
  resumesOnLabel: string | null;
}): PauseAcceptedCopy {
  const when = args.resumesOnLabel
    ? `on ${args.resumesOnLabel}`
    : `in ${args.months} month${args.months === 1 ? "" : "s"}`;

  return {
    title: "Your plan is paused",
    body:
      `You won't be charged again until billing restarts ${when}. ` +
      "Your access is on hold until then — nothing has been deleted, and it all " +
      "comes back exactly as you left it.",
    nextStepTitle: "Coming back sooner?",
    nextStepBody:
      "You can restart your plan any time from the paused screen — you don't " +
      "have to wait for the date above.",
    ctaLabel: "Got it",
  };
}
