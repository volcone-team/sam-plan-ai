'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2, Loader2, X, Lock, Info, TriangleAlert, ArrowLeft,
  Check, PauseCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CANCEL_REASONS,
  ENABLED_OFFERS,
  screensFor,
  stepLabel,
  nextScreen,
  previousScreen,
  offerFor,
  offersForCycle,
  defaultDiscountOfferFor,
  describeCancellation,
  describeCancellationConfirmed,
  describeFeedbackOffer,
  describeFarewellOffer,
  describeDiscountOffer,
  describeOfferAccepted,
  explainBlocker,
  type CancelReason,
  type CancelBlocker,
  formatAccessDate,
  type DiscountOfferId,
  type FlowScreen,
} from '@/lib/billing/cancellation';
import {
  PAUSE_DURATIONS,
  pauseScheduleFor,
  pauseClaimLabel,
  describePauseOffer,
  describePauseAccepted,
  explainPauseBlocker,
  type PauseMonths,
  type PauseBlocker,
} from '@/lib/billing/pause';
import {
  describeResetCallOffer,
  describeStrategyCallOffer,
  describeCallBooked,
} from '@/lib/billing/booking';

/**
 * The cancellation flow, as a modal over Settings → Subscription.
 *
 * Mirrors the client's mockup: step 1 asks why, the final step shows what
 * changes, and a confirmation screen closes it out. The per-reason save-offer
 * screens (the mockup's 2a-2f) are a later phase — `screensFor` already knows
 * where they go, which is why the step counter here is derived rather than
 * hardcoded and will start saying "of 3" the moment they are switched on.
 *
 * WHAT THIS DELIBERATELY DOES NOT CLAIM. The mockup's step 3 says the data is
 * "permanently deleted" after 90 days and step 4 shows a "Reactivate by" date.
 * Nothing in the product deletes anything on a schedule, so that copy is gated
 * behind DATA_IS_PURGED_AFTER_WINDOW in lib/billing/cancellation.ts and reads
 * honestly until a purge job exists. All of the wording comes from that module
 * so it is unit-tested rather than asserted here.
 */

export interface CancelSubscriptionModalProps {
  open: boolean;
  onClose: () => void;
  /** Fired after a successful cancel so the panel can reload from the server. */
  onCancelled: () => void;
  planName: string;
  billingCycle: string;
  status: string | null;
  email: string | null;
  accessEndsAt: string | null;
  initiativeCount: number;
  planFeatures: { key: string; label: string; enabled: boolean }[];
  /** True only when they really pay below today's rate — see /api/billing/me. */
  onLegacyPrice: boolean;
  /**
   * Whether a retention discount can actually be granted. False for annual
   * subscribers and anyone who has already used their one offer.
   */
  discountOfferAvailable: boolean;
  /**
   * Whether a pause can actually be applied. False for annual subscribers,
   * whose renewal date a pause would not move.
   */
  pauseOfferAvailable: boolean;
  /**
   * Booking links from app_settings. Null hides the matching screen — those
   * offers are nothing but a booking button, so without a URL there is nothing
   * for the step to do.
   */
  resetCallUrl: string | null;
  strategyCallUrl: string | null;
  currentPriceMinor: number | null;
  standardPriceMinor: number | null;
  priceCurrency: string;
}

/**
 * Mounts the dialog only while open, and keys it so each opening gets fresh
 * state. Same approach as DeleteAccountModal: a half-filled reason from a
 * previous visit must not be waiting when they come back.
 */
export function CancelSubscriptionModal(props: CancelSubscriptionModalProps) {
  if (!props.open) return null;
  return <CancelDialog key="cancel-flow" {...props} />;
}

/** Shown when claiming a discount fails at the payment provider. */
const OFFER_FAILED_MESSAGE =
  "We couldn't apply the discount. Your subscription hasn't changed. Please try again or contact support.";

function money(minor: number | null, currency = 'usd'): string | null {
  if (typeof minor !== 'number' || !Number.isFinite(minor)) return null;
  const symbol = currency.toUpperCase() === 'USD' ? '$' : '';
  const value = minor / 100;
  return `${symbol}${value.toLocaleString('en-US', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

type CancelDialogProps = Omit<CancelSubscriptionModalProps, 'open'>;

function CancelDialog({
  onClose,
  onCancelled,
  planName,
  billingCycle,
  status,
  email,
  accessEndsAt,
  initiativeCount,
  planFeatures,
  onLegacyPrice,
  discountOfferAvailable,
  pauseOfferAvailable,
  resetCallUrl,
  strategyCallUrl,
  currentPriceMinor,
  standardPriceMinor,
  priceCurrency,
}: CancelDialogProps) {
  /**
   * `pause_from_call` is a detour, not a step: it shows the pause screen to
   * someone who reached the reset-call offer and chose "just pause instead".
   * Kept out of `screens` so the step counter still describes the journey they
   * are actually on rather than growing a phantom fourth step.
   */
  const [screen, setScreen] = useState<
    FlowScreen | 'pause_from_call' | 'done' | 'offer_accepted' | 'paused' | 'call_booked'
  >('reason');
  const [reason, setReason] = useState<CancelReason | null>(null);
  const [detail, setDetail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The feedback screen's answers (2e).
   *
   * Held here and submitted with the SINGLE post at the end of the journey,
   * rather than sent when "Send, and continue" is pressed. Migration 030
   * promises one row per trip through the flow, and posting twice would produce
   * two — one saying they were still deciding, one saying what they decided.
   *
   * "Email me if we build it" starts checked, as in the mockup. Safe because it
   * is a product-update notification tied to a specific request they just
   * typed, not marketing consent, which is captured separately on `profiles`.
   */
  const [missing, setMissing] = useState('');
  const [competingTool, setCompetingTool] = useState('');
  const [notifyIfBuilt, setNotifyIfBuilt] = useState(true);
  /** Whether they actually got as far as the step-2 screen. */
  const [reachedOffer, setReachedOffer] = useState(false);

  /**
   * The offers this customer may actually claim, and which card is selected.
   *
   * Filtered by billing cycle: a monthly customer sees "next month free" and
   * "50% off for 2 months", an annual one sees "a month on us". Showing the
   * monthly cards to an annual subscriber would offer a 100%-off coupon
   * against an annual invoice — a free year — and the server refuses it, so
   * the card must not be there to click in the first place.
   */
  const cycleOffers = useMemo(() => offersForCycle(billingCycle), [billingCycle]);
  const [chosenDiscount, setChosenDiscount] = useState<DiscountOfferId | null>(
    () => defaultDiscountOfferFor(billingCycle)?.id ?? null
  );
  /** What the server actually applied, for the success screen's wording. */
  const [accepted, setAccepted] = useState<{ billingResumesAt: string | null } | null>(null);

  /** Pause length on the 2d segmented control. One month is preselected. */
  const [pauseMonths, setPauseMonths] = useState<PauseMonths>(PAUSE_DURATIONS[0]);
  /** The restart date the server actually set, for the paused screen. */
  const [paused, setPaused] = useState<{ resumesAt: string | null } | null>(null);

  /** Latest `dismiss`, so the Escape listener binds once. Set in an effect. */
  const dismissRef = useRef<() => void>(() => {});
  /** Set from the 200 so the confirmation reflects what the server actually did. */
  const [result, setResult] = useState<{
    accessEndsAt: string | null; email: string | null; status: string | null;
  } | null>(null);

  const titleId = 'cancel-subscription-title';

  /**
   * The offers reachable for THIS customer, not just the ones that are built.
   *
   * A screen whose offer cannot be granted must not appear. Annual subscribers
   * and anyone who has already used their one discount were previously shown
   * the budget screen with two buttons that both failed — the screen was chosen
   * from the reason alone, with no reference to whether the offer behind it
   * could be honoured. Narrowing the set here makes those journeys two steps
   * instead of three, and the step counter follows automatically.
   */
  const availableOffers = useMemo(() => {
    const narrowed = new Set(ENABLED_OFFERS);
    if (!discountOfferAvailable) narrowed.delete('discount');
    if (!pauseOfferAvailable) narrowed.delete('pause');
    // No calendar, no screen: the offer is a booking button and nothing else.
    if (!resetCallUrl) narrowed.delete('reset_call');
    if (!strategyCallUrl) narrowed.delete('strategy_call');
    return narrowed;
  }, [discountOfferAvailable, pauseOfferAvailable, resetCallUrl, strategyCallUrl]);

  /**
   * Say in the console why the budget screen is absent.
   *
   * A screen that silently does not render is indistinguishable from a screen
   * that is broken, which cost real time to diagnose: the customer-facing copy
   * is deliberately vague (it must not tell an annual subscriber that switching
   * to monthly would unlock a discount), and the server's reason is only in the
   * server log. One line here makes the common question answerable from the
   * browser.
   *
   * Kept rather than removed after debugging, because this will be asked again
   * every time an offer is gated behind eligibility.
   */
  useEffect(() => {
    if (!discountOfferAvailable) {
      console.info(
        '[cancellation] Budget screen (2a) hidden: this subscription cannot be ' +
        `granted a retention discount. billingCycle=${billingCycle}, ` +
        `offers valid for that cycle: ${offersForCycle(billingCycle).map((o) => o.id).join(', ') || 'none'}. ` +
        'A discount is one per company ever. ' +
        'Run `node scripts/inspect-retention-eligibility.mjs` for the exact reason.'
      );
    }
    if (!pauseOfferAvailable) {
      console.info(
        '[cancellation] Pause screen (2d) hidden: this subscription cannot be ' +
        `paused. billingCycle=${billingCycle} — pausing is monthly-only, because ` +
        'pause_collection suppresses invoices raised during the pause but does ' +
        'not move an annual renewal date.'
      );
    }
    if (!resetCallUrl || !strategyCallUrl) {
      const missing = [
        !resetCallUrl && 'reset call (2b)',
        !strategyCallUrl && 'strategy call (2c)',
      ].filter(Boolean).join(' and ');
      console.info(
        `[cancellation] Call screen(s) hidden — ${missing}. These offers are a ` +
        'booking button and nothing else, so they stay hidden until a link is ' +
        'configured. Set one on /admin/subscriptions → Retention. ' +
        'Filling in only the reset-call URL enables both.'
      );
    }
  }, [
    discountOfferAvailable,
    pauseOfferAvailable,
    resetCallUrl,
    strategyCallUrl,
    billingCycle,
  ]);

  const screens = screensFor(reason, { enabledOffers: availableOffers });
  /** Terminal screens carry no step counter — there is nothing left to decide. */
  const isTerminal =
    screen === 'done' ||
    screen === 'offer_accepted' ||
    screen === 'paused' ||
    screen === 'call_booked';
  const step = isTerminal
    ? null
    : // The pause detour still belongs to step 2, so it reports step 2.
      stepLabel(screens, screen === 'pause_from_call' ? 'offer' : (screen as FlowScreen));
  /** Which step-2 screen this reason opens, or null if it is unreachable. */
  const offer = offerFor(reason, availableOffers);

  /** Everything the server needs to record this journey, built in one place. */
  const payload = (outcome: 'cancelled' | 'kept') => ({
    reason,
    reasonDetail: detail.trim() || undefined,
    outcome,
    reachedOffer,
    offerDetails:
      offer === 'feedback'
        ? { missing, competingTool, notifyIfBuilt }
        : undefined,
  });

  /**
   * Escape closes, except mid-request. Abandoning a cancellation while the
   * Stripe call is in flight would leave the customer unsure whether their
   * subscription stopped — the one question this flow exists to answer.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // dismiss is read through a ref so the listener is bound once and still
    // sees current state — rebinding on every keystroke in the feedback form
    // would be the alternative.
  }, []);

  /**
   * Why a discount could not be granted.
   *
   * Never says "you have already used your offer" in a way that invites
   * haggling, and never explains the annual rule — someone on an annual plan
   * being told "monthly only" would reasonably ask to switch to monthly to
   * claim it. Each case just moves them along.
   */
  const explainDiscountBlocker = (blocker?: string): string => {
    switch (blocker) {
      case 'already_redeemed':
        return 'This offer has already been used on your account.';
      case 'already_discounted':
        return 'Your subscription already has a discount applied, so this offer cannot be added on top.';
      case 'offer_wrong_cycle':
      case 'no_offer_for_cycle':
      case 'no_price':
      case 'not_eligible_to_cancel':
      default:
        return 'This offer is not available on your plan. Continue below, or contact us and we will see what we can do.';
    }
  };

  /** Shared error wording for the response shapes both buttons can hit. */
  const describeFailure = (body: { error?: string; blocker?: string; message?: string }) => {
    if (body.error === 'cannot_cancel' && body.blocker) {
      return explainBlocker(body.blocker as CancelBlocker);
    }
    if (body.error === 'not_permitted') return 'Only the account owner can cancel the subscription.';
    if (body.error === 'billing_disabled') return 'Billing is not active on this deployment.';
    if (body.error === 'stripe_not_configured') return 'Billing is not configured. Please contact support.';
    if (body.error === 'stripe_failed') return 'Stripe could not complete the cancellation. Nothing has changed — please try again.';
    return body.message || 'Something went wrong. Your subscription has not changed.';
  };

  /**
   * "Keep my plan".
   *
   * Still posts, with outcome 'kept', so the retention funnel can tell a
   * declined offer from an offer nobody saw. Best effort and never blocking:
   * someone choosing to stay must not be held up by a logging call, so the
   * modal closes regardless of how it goes.
   */
  const keepPlan = () => {
    if (reason) {
      void fetch('/api/billing/cancel', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload('kept')),
      }).catch(() => {
        // Nothing to do and nothing to say: they are staying either way.
      });
    }
    onClose();
  };

  /**
   * Dismissal — the X or Escape — is treated as "kept".
   *
   * Clicking the backdrop deliberately does NOT dismiss, matching
   * DeleteAccountModal: a stray click outside a half-completed destructive flow
   * should not throw the answers away.
   *
   * Otherwise closing the dialog silently discarded everything they had told
   * us, including a completed feedback form, and someone who abandons the flow
   * has stayed just as surely as someone who pressed the button. The one case
   * that must NOT re-post is the confirmation screen: by then the journey is
   * already recorded as cancelled, and posting again would add a contradictory
   * second row.
   */
  const dismiss = () => {
    if (pending) return;
    // Both terminal screens have already written their row. Posting again would
    // add a second, contradictory one.
    if (isTerminal) {
      onClose();
      return;
    }
    keepPlan();
  };

  // Written in an effect rather than during render, per React's rules on refs.
  useEffect(() => {
    dismissRef.current = dismiss;
  });

  /**
   * Book a coaching call (2b, 2c).
   *
   * Opens the calendar in a NEW TAB and records the journey as saved, because
   * the two things are independent: we cannot see whether a slot was chosen —
   * the calendar is a third party and nothing reports back — but we do know the
   * customer chose the call over cancelling, and their subscription is
   * untouched either way.
   *
   * That is why the success screen says "pick a time in the tab that just
   * opened" rather than "your call is confirmed", and why the window is opened
   * BEFORE the fetch: a popup blocker only trusts a handler that opens
   * synchronously from the click, so awaiting first would get it blocked.
   */
  const bookCall = (url: string) => {
    if (!reason || pending) return;

    window.open(url, '_blank', 'noopener,noreferrer');

    setPending(true);
    setError(null);
    void fetch('/api/billing/cancel', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      // outcome 'kept' because nothing about the subscription changes — the
      // offer worked, which offerOutcomeFor derives from reachedOffer + kept.
      body: JSON.stringify(payload('kept')),
    })
      .catch(() => {
        // The call is already booked and the plan already kept. A failed
        // analytics write is not worth telling them about.
      })
      .finally(() => {
        setPending(false);
        setScreen('call_booked');
      });
  };

  /** Step 1 "Continue": into the offer screen if one exists, else straight on. */
  const advanceFromReason = () => {
    const next = nextScreen(screens, 'reason');
    if (!next) return;
    if (next === 'offer') setReachedOffer(true);
    setScreen(next);
  };

  const confirmCancel = async () => {
    if (!reason || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/cancel', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload('cancelled')),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body?.cancelled) {
        // Stays on the confirm screen: a failure must leave them looking at the
        // decision they tried to make, next to the reason it did not happen.
        setError(describeFailure(body));
        return;
      }

      setResult({
        accessEndsAt: body.accessEndsAt ?? accessEndsAt,
        email: body.email ?? email,
        status: body.status ?? status,
      });
      setScreen('done');
      // Reload the panel behind the modal so it is already correct when the
      // customer closes this.
      onCancelled();
    } catch {
      setError('Could not reach the server. Your subscription has not changed.');
    } finally {
      setPending(false);
    }
  };

  const reactivate = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/reactivate', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.reactivated) {
        setError(describeFailure(body));
        return;
      }
      onCancelled();
      onClose();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setPending(false);
    }
  };

  const back = () => {
    // The detour's "back" returns to the offer it branched off, which
    // previousScreen cannot know because that screen is not in `screens`.
    if (screen === 'pause_from_call') {
      setScreen('offer');
      return;
    }
    const prev = isTerminal ? null : previousScreen(screens, screen as FlowScreen);
    if (prev) setScreen(prev);
  };

  /**
   * Take the pause (2d).
   *
   * Unlike the discount, this one LOCKS THE CUSTOMER OUT on success — billing
   * and access both stop. So the terminal screen says so, and closing it sends
   * them to the paused page rather than back into a product they can no longer
   * use. Reloading into the app would just bounce off the Edge gate.
   */
  const applyPause = async () => {
    if (!reason || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/pause', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          reasonDetail: detail.trim() || undefined,
          months: pauseMonths,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body?.paused) {
        setError(
          body?.error === 'cannot_pause' && body?.blocker
            ? explainPauseBlocker(body.blocker as PauseBlocker)
            : body?.error === 'stripe_failed'
              ? 'We could not pause billing with our payment provider, so nothing has changed. Please try again.'
              : describeFailure(body)
        );
        return;
      }

      setPaused({ resumesAt: body.resumesAt ?? null });
      setScreen('paused');
      onCancelled();
    } catch {
      setError('Could not reach the server. Nothing has changed.');
    } finally {
      setPending(false);
    }
  };

  /**
   * Claim a discount (2a).
   *
   * Goes to its own route, not the cancel one: this APPLIES money rather than
   * stopping it, and the server re-checks every condition — monthly only, no
   * existing discount, never redeemed before — because the screen being visible
   * is not evidence that granting is still allowed by the time the button is
   * pressed.
   */
  const claimDiscount = async () => {
    if (!reason || !selectedDiscount || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/retention-offer', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          reasonDetail: detail.trim() || undefined,
          offerId: selectedDiscount.id,
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body?.accepted) {
        setError(
          body?.error === 'offer_unavailable'
            ? explainDiscountBlocker(body.blocker)
            : body?.error === 'redemptions_unavailable'
              ? 'We could not confirm the offer just now. Please try again in a moment.'
              : body?.error === 'not_permitted' ||
                  body?.error === 'billing_disabled' ||
                  body?.error === 'stripe_not_configured'
                ? describeFailure(body)
                // stripe_failed and anything unexpected. Never the raw
                // message: that is Stripe's wording, meant for the logs.
                : OFFER_FAILED_MESSAGE
        );
        return;
      }

      setAccepted({ billingResumesAt: body.billingResumesAt ?? null });
      setScreen('offer_accepted');
      // The panel behind the modal shows billing state, which has changed.
      onCancelled();
    } catch {
      setError('Could not reach the server. Nothing has changed.');
    } finally {
      setPending(false);
    }
  };

  const preview = describeCancellation({ planName, accessEndsAt });
  const feedbackCopy = describeFeedbackOffer();
  const farewellCopy = describeFarewellOffer({ accessEndsAt });
  const discountCopy = describeDiscountOffer({
    priceMinor: currentPriceMinor,
    currency: priceCurrency,
    billingCycle,
  });
  /** Falls back within the cycle's own offers, never to another cycle's. */
  const selectedDiscount =
    cycleOffers.find((o) => o.id === chosenDiscount) ?? cycleOffers[0] ?? null;
  const resetCopy = describeResetCallOffer({ pauseAvailable: pauseOfferAvailable });
  const strategyCopy = describeStrategyCallOffer();
  const bookedCopy = describeCallBooked({ reasonWasResults: reason === 'no_results' });
  const pauseCopy = describePauseOffer();
  /** The restart date for the currently selected duration, previewed live. */
  const pausePreviewLabel = formatAccessDate(
    pauseScheduleFor(pauseMonths).resumesAt
  );
  const pausedCopy = describePauseAccepted({
    months: pauseMonths,
    resumesAt: paused?.resumesAt ?? null,
    // Prefers the date the SERVER set over the local preview, so the screen
    // states what actually happened rather than what was predicted.
    resumesOnLabel: formatAccessDate(paused?.resumesAt ?? null) ?? pausePreviewLabel,
  });
  const acceptedCopy = selectedDiscount
    ? describeOfferAccepted({
        offer: selectedDiscount,
        billingResumesAt: accepted?.billingResumesAt ?? null,
      })
    : null;
  const confirmation = describeCancellationConfirmed({
    email: result?.email ?? email,
    status: result?.status ?? status,
    accessEndsAt: result?.accessEndsAt ?? accessEndsAt,
  });

  const per = billingCycle === 'annual' ? 'yr' : 'mo';
  const paid = money(currentPriceMinor, priceCurrency);
  const standard = money(standardPriceMinor, priceCurrency);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-xl"
      >
        {/* Header: back link and step counter, as in the mockup. */}
        <div className="flex items-start justify-between gap-4">
          {screen !== 'reason' && !isTerminal ? (
            <button
              type="button"
              onClick={back}
              disabled={pending}
              className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {step && (
              <span className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
                {step}
              </span>
            )}
            <button
              type="button"
              onClick={dismiss}
              disabled={pending}
              className="rounded-md p-1 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ---------------- Step 1: why are you leaving? ---------------- */}
        {screen === 'reason' && (
          <>
            <h3 id={titleId} className="mt-2 text-lg font-semibold">
              Before you go, what&rsquo;s the main reason?
            </h3>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              Your answer helps us make SAM Plan better, and we may be able to help.
            </p>

            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">Reason for cancelling</legend>
              {CANCEL_REASONS.map((r) => {
                const selected = reason === r.id;
                return (
                  <label
                    key={r.id}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-sm transition-colors',
                      selected
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.06)]'
                        : 'border-border hover:bg-[hsl(var(--background-muted))]'
                    )}
                  >
                    <input
                      type="radio"
                      name="cancel-reason"
                      value={r.id}
                      checked={selected}
                      onChange={() => setReason(r.id)}
                      className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                    />
                    <span>{r.label}</span>
                  </label>
                );
              })}
            </fieldset>

            <div className="mt-4 space-y-1.5">
              <label htmlFor="cancel-detail" className="text-sm font-medium">
                Anything else? <span className="font-normal text-[hsl(var(--foreground-muted))]">(optional)</span>
              </label>
              <textarea
                id="cancel-detail"
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder="Tell us in your own words"
                className="w-full resize-none rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={keepPlan}
                className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                Keep my plan
              </button>
              <button
                type="button"
                onClick={advanceFromReason}
                disabled={!reason}
                className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {/* ---------------- Step 2a: budget ---------------- */}
        {screen === 'offer' && offer === 'discount' && (
          <>
            <h3 id={titleId} className="mt-2 text-lg font-semibold">
              {discountCopy.title}
            </h3>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              {discountCopy.subtitle}
            </p>

            <fieldset className="mt-4 space-y-2">
              <legend className="sr-only">Choose an offer</legend>
              {cycleOffers.map((o) => {
                const selected = selectedDiscount?.id === o.id;
                return (
                  <label
                    key={o.id}
                    className={cn(
                      'block cursor-pointer rounded-[var(--radius-md)] border px-4 py-3 transition-colors',
                      selected
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.06)]'
                        : 'border-border hover:bg-[hsl(var(--background-muted))]'
                    )}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="discount-offer"
                          value={o.id}
                          checked={selected}
                          onChange={() => setChosenDiscount(o.id)}
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                        />
                        <span>
                          <span className="block text-sm font-semibold">{o.title}</span>
                          <span className="mt-0.5 block text-xs text-[hsl(var(--foreground-muted))]">
                            {o.blurb}
                          </span>
                        </span>
                      </span>
                      {o.badge && (
                        <span className="shrink-0 text-xs font-medium text-[hsl(var(--primary))]">
                          {o.badge}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {/*
              The mockup's "a free plan is coming in January" note. Null unless
              configured — see DISCOUNT_NOTICE for why an un-backed promise to a
              customer who is mid-cancellation is worse than no note.
            */}
            {discountCopy.notice && (
              <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--background-muted))] px-3 py-2.5 text-xs leading-relaxed text-[hsl(var(--foreground-muted))]">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{discountCopy.notice}</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={claimDiscount}
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {/* Follows the selection, as in the mockup. */}
                {selectedDiscount?.claimLabel ?? 'Claim this offer'}
              </button>
              <button
                type="button"
                onClick={() => setScreen('confirm')}
                disabled={pending}
                className="w-full py-1 text-sm font-medium text-[hsl(var(--foreground-muted))] underline hover:no-underline disabled:opacity-50"
              >
                {discountCopy.declineLabel}
              </button>
            </div>

            <p className="mt-3 text-center text-xs text-[hsl(var(--foreground-muted))]">
              {discountCopy.footnote}
            </p>
          </>
        )}

        {/* ---------------- Step 2b: plan reset call ---------------- */}
        {screen === 'offer' && offer === 'reset_call' && resetCallUrl && (
          <>
            <h3 id={titleId} className="mt-2 text-lg font-semibold">
              {resetCopy.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
              {resetCopy.subtitle}
            </p>

            <div className="mt-4 rounded-[var(--radius-md)] border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                  {resetCopy.perk.title}
                </p>
                {resetCopy.perk.badge && (
                  <span className="shrink-0 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                    {resetCopy.perk.badge}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-indigo-800 dark:text-indigo-300">
                {resetCopy.perk.body}
              </p>
            </div>

            <ul className="mt-4 space-y-2">
              {resetCopy.bullets.map((line) => (
                <li key={line} className="flex items-start gap-2 text-xs leading-relaxed">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={() => bookCall(resetCallUrl)}
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {resetCopy.bookLabel}
              </button>

              {/*
                The mockup's secondary. Shown only when pausing is actually
                possible — an annual subscriber cannot usefully pause, and a
                button that would be refused is worse than its absence.
                It jumps to the pause screen rather than pausing on the spot,
                because a pause stops ACCESS and that deserves its own
                explicit confirmation.
              */}
              {pauseOfferAvailable && resetCopy.pauseLabel && (
                <button
                  type="button"
                  onClick={() => setScreen('pause_from_call')}
                  disabled={pending}
                  className="w-full rounded-[var(--radius-md)] border border-border px-4 py-2.5 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
                >
                  {resetCopy.pauseLabel}
                </button>
              )}

              <button
                type="button"
                onClick={() => setScreen('confirm')}
                disabled={pending}
                className="w-full py-1 text-sm font-medium text-[hsl(var(--foreground-muted))] underline hover:no-underline disabled:opacity-50"
              >
                {resetCopy.declineLabel}
              </button>
            </div>
          </>
        )}

        {/* ---------------- Step 2c: strategy call ---------------- */}
        {screen === 'offer' && offer === 'strategy_call' && strategyCallUrl && (
          <>
            <h3 id={titleId} className="mt-2 text-lg font-semibold">
              {strategyCopy.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
              {strategyCopy.subtitle}
            </p>

            <div className="mt-4 space-y-2">
              {strategyCopy.perks.map((perk) => (
                <div
                  key={perk.title}
                  className="rounded-[var(--radius-md)] border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/20"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                      {perk.title}
                    </p>
                    {perk.badge && (
                      <span className="shrink-0 text-xs font-medium text-indigo-700 dark:text-indigo-300">
                        {perk.badge}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-indigo-800 dark:text-indigo-300">
                    {perk.body}
                  </p>
                </div>
              ))}
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={() => bookCall(strategyCallUrl)}
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {strategyCopy.bookLabel}
              </button>
              <button
                type="button"
                onClick={() => setScreen('confirm')}
                disabled={pending}
                className="w-full py-1 text-sm font-medium text-[hsl(var(--foreground-muted))] underline hover:no-underline disabled:opacity-50"
              >
                {strategyCopy.declineLabel}
              </button>
            </div>
          </>
        )}

        {/* ---------------- Step 2d: take a break ---------------- */}
        {((screen === 'offer' && offer === 'pause') || screen === 'pause_from_call') && (
          <>
            <h3 id={titleId} className="mt-2 text-lg font-semibold">
              {pauseCopy.title}
            </h3>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              {pauseCopy.subtitle}
            </p>

            {/* Segmented control, as in the mockup. */}
            <div className="mt-4">
              <p className="text-sm font-medium">{pauseCopy.durationLabel}</p>
              <div
                role="radiogroup"
                aria-label={pauseCopy.durationLabel}
                className="mt-2 flex gap-2"
              >
                {PAUSE_DURATIONS.map((months) => {
                  const selected = pauseMonths === months;
                  return (
                    <button
                      key={months}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setPauseMonths(months)}
                      className={cn(
                        'flex-1 rounded-[var(--radius-md)] border px-3 py-2 text-sm font-medium transition-colors',
                        selected
                          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.08)] text-[hsl(var(--primary))]'
                          : 'border-border hover:bg-[hsl(var(--background-muted))]'
                      )}
                    >
                      {months} month{months === 1 ? '' : 's'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* The two dates, computed from the selection. */}
            <dl className="mt-4 divide-y divide-border rounded-[var(--radius-md)] border border-border">
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <dt className="text-[hsl(var(--foreground-muted))]">
                  {pauseCopy.pausesAtLabel}
                </dt>
                <dd className="font-medium">Today</dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <dt className="text-[hsl(var(--foreground-muted))]">
                  {pauseCopy.resumesAtLabel}
                </dt>
                <dd className="font-medium">{pausePreviewLabel ?? '—'}</dd>
              </div>
            </dl>

            <ul className="mt-4 space-y-2">
              {pauseCopy.guarantees.map((line) => (
                <li key={line} className="flex items-start gap-2 text-xs leading-relaxed">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--primary))]" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={applyPause}
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {pauseClaimLabel(pauseMonths)}
              </button>
              <button
                type="button"
                onClick={() => setScreen('confirm')}
                disabled={pending}
                className="w-full py-1 text-sm font-medium text-[hsl(var(--foreground-muted))] underline hover:no-underline disabled:opacity-50"
              >
                {pauseCopy.declineLabel}
              </button>
            </div>
          </>
        )}

        {/* ---------------- Step 2e: what's missing? ---------------- */}
        {screen === 'offer' && offer === 'feedback' && (
          <>
            <h3 id={titleId} className="mt-2 text-lg font-semibold">
              {feedbackCopy.title}
            </h3>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              {feedbackCopy.subtitle}
            </p>

            <div className="mt-4 space-y-1.5">
              <label htmlFor="cancel-missing" className="text-sm font-medium">
                {feedbackCopy.missingLabel}
              </label>
              <textarea
                id="cancel-missing"
                value={missing}
                onChange={(e) => setMissing(e.target.value)}
                rows={3}
                maxLength={2000}
                placeholder={feedbackCopy.missingPlaceholder}
                className="w-full resize-none rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>

            <div className="mt-4 space-y-1.5">
              <label htmlFor="cancel-tool" className="text-sm font-medium">
                {feedbackCopy.toolLabel}
              </label>
              <input
                id="cancel-tool"
                type="text"
                value={competingTool}
                onChange={(e) => setCompetingTool(e.target.value)}
                maxLength={120}
                autoComplete="off"
                placeholder={feedbackCopy.toolPlaceholder}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]"
              />
            </div>

            <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={notifyIfBuilt}
                onChange={(e) => setNotifyIfBuilt(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
              />
              <span>{feedbackCopy.notifyLabel}</span>
            </label>

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={() => setScreen('confirm')}
                className="w-full rounded-[var(--radius-md)] border border-border px-4 py-2.5 text-sm font-medium hover:bg-[hsl(var(--background-muted))]"
              >
                {feedbackCopy.continueLabel}
              </button>
              {/*
                Nothing is sent yet. The answers travel with the single post at
                the end of the journey, so pressing this and then changing their
                mind still records one coherent row — with outcome 'kept' and
                the feedback intact.
              */}
              <button
                type="button"
                onClick={keepPlan}
                className="w-full py-1 text-sm font-medium text-[hsl(var(--primary))] underline hover:no-underline"
              >
                {feedbackCopy.keepLabel}
              </button>
            </div>
          </>
        )}

        {/* ---------------- Step 2f: farewell ---------------- */}
        {screen === 'offer' && offer === 'farewell' && (
          <>
            <h3 id={titleId} className="mt-2 text-lg font-semibold">
              {farewellCopy.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
              {farewellCopy.subtitle}
            </p>

            <div className="mt-4 rounded-[var(--radius-md)] border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
              <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                {farewellCopy.calloutTitle}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-indigo-800 dark:text-indigo-300">
                {farewellCopy.calloutBody}
              </p>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/*
              This screen IS the commitment — there is no confirmation step
              after it, which is why screensFor reports "Step 2 of 2" here.
              Someone winding a business down has already made the decision; a
              retention screen would be asking them to reconsider twice.
            */}
            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={confirmCancel}
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--foreground))] px-4 py-2.5 text-sm font-semibold text-[hsl(var(--background))] hover:opacity-90 disabled:opacity-50"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {farewellCopy.confirmLabel}
              </button>
              <button
                type="button"
                onClick={keepPlan}
                disabled={pending}
                className="w-full py-1 text-sm font-medium text-[hsl(var(--primary))] underline hover:no-underline disabled:opacity-50"
              >
                {farewellCopy.keepLabel}
              </button>
            </div>
          </>
        )}

        {/* ---------------- Final step: what changes ---------------- */}
        {screen === 'confirm' && (
          <>
            <h3 id={titleId} className="mt-2 text-lg font-semibold">
              {preview.title}
            </h3>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              {preview.accessLine}
            </p>

            {/*
              The founding-rate warning, shown ONLY when they really are below
              today's price. /api/billing/me computes that from the price they
              pay versus the plan's current price, so this cannot fire for
              someone already on the standard rate.
            */}
            {onLegacyPrice && paid && standard && (
              <div className="mt-4 rounded-[var(--radius-md)] border border-teal-200 bg-teal-50 p-4 dark:border-teal-900 dark:bg-teal-950/20">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-teal-900 dark:text-teal-200">
                  <Info className="h-4 w-4 shrink-0" />
                  Your current rate goes away
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-teal-800 dark:text-teal-300">
                  You&rsquo;re paying {paid}/{per}. If you come back later, you&rsquo;ll pay the
                  standard rate of {standard}/{per}.
                </p>
              </div>
            )}

            <div className="mt-4">
              <p className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
                What happens to your account
              </p>
              <ul className="mt-2 divide-y divide-border rounded-[var(--radius-md)] border border-border">
                <li className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <span>
                    Your revenue plan
                    {initiativeCount > 0 && ` and ${initiativeCount} initiative${initiativeCount === 1 ? '' : 's'}`}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[hsl(var(--foreground-muted))]">
                    <Lock className="h-3 w-3" />
                    Locked
                  </span>
                </li>
                {/*
                  Driven from plan_features rather than a hardcoded list, so this
                  names what the customer's own plan actually includes. Disabled
                  features are filtered out: they cannot lose what they never had.
                */}
                {planFeatures
                  .filter((f) => f.enabled)
                  .map((f) => (
                    <li
                      key={f.key}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                    >
                      <span>{f.label}</span>
                      <span className="shrink-0 text-xs font-medium text-[hsl(var(--foreground-muted))]">
                        Access ends
                      </span>
                    </li>
                  ))}
              </ul>
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={keepPlan}
                disabled={pending}
                className="w-full rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {preview.keepLabel}
              </button>
              <button
                type="button"
                onClick={confirmCancel}
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-border px-4 py-2.5 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {preview.confirmLabel}
              </button>
            </div>

            <p className="mt-3 text-center text-xs text-[hsl(var(--foreground-muted))]">
              {preview.footnote}
            </p>
          </>
        )}

        {/* ---------------- Offer accepted ---------------- */}
        {screen === 'offer_accepted' && acceptedCopy && (
          <>
            <CheckCircle2 className="mt-2 h-9 w-9 text-[hsl(var(--primary))]" />
            <h3 id={titleId} className="mt-3 text-lg font-semibold">
              {acceptedCopy.title}
            </h3>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              {acceptedCopy.body}
            </p>

            <div className="mt-4 rounded-[var(--radius-md)] border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
              <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">
                {acceptedCopy.nextStepTitle}
              </p>
              <p className="mt-1.5 text-xs leading-relaxed text-indigo-800 dark:text-indigo-300">
                {acceptedCopy.nextStepBody}
              </p>
            </div>

            <div className="mt-5 space-y-2">
              <a
                href={acceptedCopy.ctaHref}
                className="block w-full rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-90"
              >
                {acceptedCopy.ctaLabel}
              </a>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-1 text-sm font-medium text-[hsl(var(--foreground-muted))] underline hover:no-underline"
              >
                Back to settings
              </button>
            </div>
          </>
        )}

        {/* ---------------- Call booked ---------------- */}
        {screen === 'call_booked' && (
          <>
            <CheckCircle2 className="mt-2 h-9 w-9 text-[hsl(var(--primary))]" />
            <h3 id={titleId} className="mt-3 text-lg font-semibold">
              {bookedCopy.title}
            </h3>
            <p className="mt-1 text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
              {bookedCopy.body}
            </p>

            <div className="mt-4 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] p-4">
              <p className="text-sm font-semibold">{bookedCopy.nextStepTitle}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-[hsl(var(--foreground-muted))]">
                {bookedCopy.nextStepBody}
              </p>
            </div>

            <div className="mt-5 space-y-2">
              <a
                href={bookedCopy.ctaHref}
                className="block w-full rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-90"
              >
                {bookedCopy.ctaLabel}
              </a>
              <button
                type="button"
                onClick={onClose}
                className="w-full py-1 text-sm font-medium text-[hsl(var(--foreground-muted))] underline hover:no-underline"
              >
                Back to settings
              </button>
            </div>
          </>
        )}

        {/* ---------------- Pause applied ---------------- */}
        {screen === 'paused' && (
          <>
            <PauseCircle className="mt-2 h-9 w-9 text-amber-600 dark:text-amber-400" />
            <h3 id={titleId} className="mt-3 text-lg font-semibold">
              {pausedCopy.title}
            </h3>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              {pausedCopy.body}
            </p>

            <div className="mt-4 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] p-4">
              <p className="text-sm font-semibold">{pausedCopy.nextStepTitle}</p>
              <p className="mt-1.5 text-xs leading-relaxed text-[hsl(var(--foreground-muted))]">
                {pausedCopy.nextStepBody}
              </p>
            </div>

            {/*
              GOES TO THE PAUSED PAGE, not back into the app.
              Access has just stopped, so the Edge gate would bounce them there
              anyway — doing it deliberately avoids a confusing redirect, and
              that page is where the "restart my plan" button lives.
            */}
            <div className="mt-5">
              <a
                href="/account-paused"
                className="block w-full rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-center text-sm font-semibold text-white hover:opacity-90"
              >
                {pausedCopy.ctaLabel}
              </a>
            </div>
          </>
        )}

        {/* ---------------- Cancellation confirmed ---------------- */}
        {screen === 'done' && (
          <>
            <CheckCircle2 className="mt-2 h-9 w-9 text-[hsl(var(--primary))]" />
            <h3 id={titleId} className="mt-3 text-lg font-semibold">
              {confirmation.title}
            </h3>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              {confirmation.body}
            </p>

            <dl className="mt-4 divide-y divide-border rounded-[var(--radius-md)] border border-border">
              {confirmation.rows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                >
                  <dt className="text-[hsl(var(--foreground-muted))]">{row.label}</dt>
                  <dd className="text-right font-medium">{row.value}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-4 text-xs leading-relaxed text-[hsl(var(--foreground-muted))]">
              {confirmation.footnote}
            </p>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
              >
                {error}
              </div>
            )}

            <div className="mt-5 space-y-2">
              <a
                href="/year-at-a-glance"
                className="block w-full rounded-[var(--radius-md)] border border-border px-4 py-2.5 text-center text-sm font-medium hover:bg-[hsl(var(--background-muted))]"
              >
                Back to my dashboard
              </a>
              {/*
                Offered immediately and on purpose. The subscription is still
                active until the period ends, so this is a single flag flip with
                no charge — the cheapest possible way to recover someone who
                clicked through by mistake.
              */}
              <button
                type="button"
                onClick={reactivate}
                disabled={pending}
                className="inline-flex w-full items-center justify-center gap-1.5 py-1 text-sm font-medium text-[hsl(var(--primary))] underline hover:no-underline disabled:opacity-50"
              >
                {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Reactivate my plan
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
