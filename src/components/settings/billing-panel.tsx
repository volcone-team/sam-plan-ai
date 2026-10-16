'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CreditCard, ExternalLink, TriangleAlert, CheckCircle2, Gift, RefreshCw,
  CalendarClock, Info, BadgePercent,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner, LoadingPanel } from '@/components/ui/spinner';
import { PlanChangeModal } from './plan-change-modal';
import { CancelSubscriptionModal } from './cancel-subscription-modal';
import { canCancel, canReactivate } from '@/lib/billing/cancellation';
import { formatMoneyFromMinor } from '@/lib/format-money';
import { pickMoneyFormatter } from '@/lib/results-tab-totals';

/**
 * Customer-facing billing panel: current plan, usage this period, plan changes,
 * invoice history, the in-app cancellation flow, and an "Update card" button.
 *
 * "Update card" deep-links into Stripe's portal on the card-update screen only
 * (`flow: "payment_method_update"`). There is deliberately no general portal
 * link here: invoices are listed below and cancellation runs in-app.
 *
 * Renders a plain "no billing required" note when Stripe is disabled, rather than
 * showing plans that cannot be bought.
 */

interface PlanLimit { key: string; label: string; value: number }
interface PlanFeature { key: string; label: string; enabled: boolean }

interface Plan {
  id: string;
  name: string;
  description: string | null;
  tagline: string | null;
  monthlyPrice: number;
  annualPrice: number;
  isCurrent: boolean;
  purchasableMonthly: boolean;
  purchasableAnnual: boolean;
  limits: PlanLimit[];
  features: PlanFeature[];
}

interface UsageRow {
  key: string; label: string; limit: number; used: number;
  remaining: number | null; unlimited: boolean; notIncluded: boolean;
}

interface BillingMe {
  billingEnabled: boolean;
  canManage: boolean;
  trial: { enabled: boolean; days: number; requiresCard: boolean };
  plans: Plan[];
  subscription: {
    planName: string; planRetired: boolean; billingCycle: string; status: string;
    isComped: boolean; compedUntil: string | null; compedReason: string | null;
    trialEndsAt: string | null; currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean; pendingPlanName: string | null;
    pendingBillingCycle: string | null; hasStripeSubscription: boolean;
    isPaused: boolean;
    // Cancellation flow inputs. See /api/billing/me for how each is resolved.
    currentPriceMinor: number | null; standardPriceMinor: number | null;
    priceCurrency: string; onLegacyPrice: boolean;
    planFeatures: PlanFeature[];
    discountOfferAvailable: boolean;
    pauseOfferAvailable: boolean;
    resetCallUrl: string | null;
    strategyCallUrl: string | null;
  } | null;
  access: { allowed: boolean; reason: string; warn: boolean; daysRemaining: number | null };
  usage: UsageRow[];
  counts: { initiatives: number };
  periodEnd: string;
  /**
   * The discount in force, or null. Resolved server-side from Stripe — see
   * src/lib/billing/discount-display.ts.
   */
  activeDiscount: {
    couponId: string | null;
    nextCharge: string | null;
    summary: string;
    afterwards: string | null;
    saving: string | null;
  } | null;
  invoices: {
    stripe_invoice_id: string; status: string | null; amount_paid: number | null;
    currency: string; paid_at: string | null; hosted_invoice_url: string | null;
    created_at: string;
  }[];
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { dateStyle: 'medium' }) : '—';
}

function money(minor: number | null, currency = 'usd'): string {
  return formatMoneyFromMinor(minor, currency);
}

/** Human wording for why access is limited, paired with what to do about it. */
function accessNotice(me: BillingMe): { tone: 'warn' | 'error'; text: string } | null {
  const { access, subscription } = me;

  if (!access.allowed) {
    switch (access.reason) {
      case 'paused':
        /*
          No live subscription behind the pause: buying a plan ends it (user
          decision). Reached by super admins, who bypass the middleware. The
          picker below already offers Checkout, because hasStripeSubscription
          is false for a canceled or missing subscription.
        */
        if (subscription && !subscription.hasStripeSubscription && !subscription.isComped) {
          return {
            tone: 'error',
            text: 'Your account is paused and has no active subscription. Choose a plan below to restore access — buying a plan ends the pause.',
          };
        }
        // Mostly unreachable: the middleware redirects a paused user to
        // /account-paused before any app page renders. Kept so the panel never
        // falls through to "not active yet", which would misdescribe a pause as
        // an unfinished signup.
        return {
          tone: 'error',
          text: 'Your plan is paused. Contact your administrator to restore access.',
        };
      case 'trial_expired':
        return {
          tone: 'error',
          // Accurate about what they CAN still do: the dashboard stays readable,
          // only creating new work is blocked.
          text: 'Your free trial has ended. You can still view your dashboard — upgrade to a plan to keep building.',
        };
      case 'past_due_expired':
        return { tone: 'error', text: 'We could not take your last payment. Update your card to restore access.' };
      case 'comp_expired':
        return { tone: 'error', text: 'Your complimentary access has ended. Choose a plan to continue.' };
      case 'canceled':
        return { tone: 'error', text: 'Your subscription has been cancelled. Pick a plan to start again.' };
      case 'no_subscription':
        return { tone: 'error', text: 'Choose a plan below to start using SAM.' };
      default:
        return { tone: 'error', text: 'Your subscription is not active yet.' };
    }
  }

  if (access.reason === 'grace_period') {
    return {
      tone: 'warn',
      text: `A payment failed, so access will stop in ${access.daysRemaining ?? 0} day(s). Update your card to avoid interruption.`,
    };
  }
  if (access.reason === 'trialing' && access.warn) {
    return { tone: 'warn', text: `Your trial ends in ${access.daysRemaining ?? 0} day(s).` };
  }
  if (access.reason === 'comped' && access.warn) {
    return { tone: 'warn', text: `Your complimentary access ends in ${access.daysRemaining ?? 0} day(s).` };
  }
  if (subscription?.cancelAtPeriodEnd) {
    return {
      tone: 'warn',
      text: `Your plan ends on ${shortDate(subscription.currentPeriodEnd)}. You keep full access until then.`,
    };
  }
  return null;
}

export function BillingPanel() {
  const [me, setMe] = useState<BillingMe | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * Which action is in flight, or null. Keys: `subscribe:<planId>`,
   * `change:<planId>`, `reactivate`.
   *
   * Per-action rather than one boolean so only the clicked button shows a
   * spinner. Every action button is still disabled while ANY action runs
   * (via `busy` below) to prevent double submission.
   */
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busy = busyAction !== null;
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');
  /**
   * The plan the customer has asked to move to, held while they confirm.
   *
   * A change is NEVER sent straight from the button: an upgrade charges the card
   * immediately with no Stripe Checkout page in between, so it needs an explicit
   * confirmation showing what will be billed.
   */
  const [confirming, setConfirming] = useState<Plan | null>(null);
  /** Whether the multi-step cancellation flow is open. */
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async (opts?: { reconcile?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      /**
       * Pull the subscription from Stripe BEFORE reading our own copy.
       *
       * The webhook is the only writer of subscription state, and it can be late
       * — or absent entirely in local development, since Stripe cannot deliver to
       * localhost. Without this, returning from a successful Checkout showed the
       * OLD plan and looked like the payment had failed.
       *
       * Only on returning from Checkout, not on every page load: it costs two
       * Stripe calls, and the webhook handles the steady state.
       */
      if (opts?.reconcile) {
        try {
          await fetch('/api/billing/reconcile', {
            method: 'POST',
            credentials: 'same-origin',
          });
        } catch {
          // Best-effort: fall through and show whatever we already have.
        }
      }

      const res = await fetch('/api/billing/me', { credentials: 'same-origin' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || 'Could not load billing');
      }
      const body = (await res.json()) as BillingMe;
      setMe(body);
      if (body.subscription?.billingCycle === 'annual') setCycle('annual');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Checkout redirects back with ?checkout=success. That parameter is a HINT
    // ONLY — it can be typed by hand, so it never grants anything. All it does is
    // trigger a reconcile, and entitlement still comes from Stripe via the server.
    const justPaid =
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('checkout') === 'success';

    load({ reconcile: justPaid });

    if (justPaid) {
      // Clear the parameter so a refresh does not reconcile again.
      const url = new URL(window.location.href);
      url.searchParams.delete('checkout');
      window.history.replaceState({}, '', url.toString());
    }
  }, [load]);

  /** Start checkout for a plan the company has never subscribed to. */
  const subscribe = async (planId: string) => {
    setBusyAction(`subscribe:${planId}`);
    setError(null);
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, billingCycle: cycle }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setError(
          body?.error === 'already_subscribed'
            ? 'You already have a subscription — use Change plan instead.'
            : body?.error === 'not_permitted'
              ? 'Only the account owner can manage billing.'
              // Configuration fault, not something the customer did wrong.
              : body?.error === 'price_stale' || body?.error === 'price_not_found'
                ? (body?.message ?? 'This plan is not available yet. Please contact support.')
                : 'Could not start checkout. Please try again.'
        );
        // Failure: release the buttons. (Success deliberately keeps them
        // locked, because the page is about to navigate to Stripe.)
        setBusyAction(null);
        return;
      }
      // Leaves the app for Stripe's hosted page; card data never touches us.
      window.location.href = body.url;
    } catch {
      setError('Could not reach the server.');
      setBusyAction(null);
    }
  };

  /**
   * Open Stripe's portal straight on the card-update screen.
   *
   * Card data never touches us: Stripe hosts the form and redirects back to
   * /settings when the new card is saved.
   */
  const updateCard = async () => {
    setBusyAction('update_card');
    setError(null);
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow: 'payment_method_update' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setError(
          body?.error === 'not_permitted'
            ? 'Only the account owner can update the payment card.'
            : body?.error === 'no_customer'
              ? 'There is no payment card on file for this account yet.'
              : body?.error === 'billing_disabled'
                ? 'Billing is switched off at the moment, so there is no card to update.'
                : 'Could not open the card update page. Please try again.'
        );
        // Failure: release the buttons. Success keeps them locked because
        // the page is about to navigate to Stripe.
        setBusyAction(null);
        return;
      }
      window.location.href = body.url;
    } catch {
      setError('Could not reach the server.');
      setBusyAction(null);
    }
  };

  /**
   * Which direction is a move to `plan` on the selected cycle?
   *
   * Mirrors the server's classifyPlanChange, which compares on PRICE rather than
   * on limits (a plan can raise one limit while lowering another, so limits give
   * no total ordering). This copy only decides what to SAY — the server
   * re-classifies and is the authority on what actually happens.
   */
  const changeKindFor = (plan: Plan): 'upgrade' | 'downgrade' | 'cycle_change' | 'same' => {
    const current = me?.plans.find((p) => p.isCurrent);
    if (!current) return 'upgrade';
    if (current.id === plan.id) {
      return me?.subscription?.billingCycle === cycle ? 'same' : 'cycle_change';
    }
    const currentPrice =
      me?.subscription?.billingCycle === 'annual' ? current.annualPrice : current.monthlyPrice;
    const targetPrice = cycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
    return targetPrice > currentPrice ? 'upgrade' : 'downgrade';
  };

  /** Move an existing subscription to another plan. */
  const changePlan = async (planId: string) => {
    setBusyAction(`change:${planId}`);
    setError(null);
    try {
      const res = await fetch('/api/stripe/change-plan', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, billingCycle: cycle }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          body?.error === 'comped_account'
            ? 'Your access was granted directly, so there is no subscription to change.'
            : body?.error === 'no_live_subscription'
              ? 'Your previous subscription has ended, so there is nothing to change. Refresh the page and choose a plan to start a new subscription.'
              : body?.error === 'account_paused'
                ? 'Your account is paused. Contact your administrator to make changes to your plan.'
                : `Could not change plan: ${body?.error ?? 'unknown'}`
        );
        return;
      }
      // Close the dialog only on success, so a failure leaves the customer
      // looking at the change they tried to make alongside the reason.
      setConfirming(null);
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusyAction(null);
    }
  };

  /**
   * Undo a pending cancellation.
   *
   * Lives here rather than in the cancellation modal because it is reached from
   * the panel itself: once a subscription is ending, the Cancel button is
   * replaced by this one and the modal is not involved at all.
   *
   * A lapsed subscription cannot be resumed — Stripe has cancelled it for real
   * — so the route answers `requiresCheckout` and the customer buys again
   * through the normal plan cards below.
   */
  const reactivate = async () => {
    setBusyAction('reactivate');
    setError(null);
    try {
      const res = await fetch('/api/billing/reactivate', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({}));

      if (res.ok && body?.requiresCheckout) {
        setError('Your subscription has already ended. Choose a plan below to start again.');
        return;
      }
      if (!res.ok || !body?.reactivated) {
        setError(
          body?.error === 'not_permitted'
            ? 'Only the account owner can manage billing.'
            : body?.error === 'cannot_reactivate'
              ? 'There is no pending cancellation to undo.'
              : 'Could not reactivate your plan. Please try again.'
        );
        return;
      }
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusyAction(null);
    }
  };

  // Shared LoadingPanel, matching every other panel in the app.
  if (loading) {
    return <LoadingPanel />;
  }

  if (!me) {
    return (
      <div role="alert" className="rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
        {error ?? 'Billing is unavailable right now.'}
      </div>
    );
  }

  // Stripe off: say so plainly instead of advertising plans nobody can buy.
  if (!me.billingEnabled) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h2 className="text-lg font-semibold">Billing</h2>
        </div>
        <div className="rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
          No payment is required at the moment — your account has full access.
        </div>
      </div>
    );
  }

  const notice = accessNotice(me);

  /**
   * Whether cancelling and reactivating are possible, decided by the SAME
   * tested functions the API uses.
   *
   * Sharing them is the point: a button the server would reject is worse than
   * no button, and duplicating the precedence here (pause above comp above
   * status) is exactly how the two would drift apart.
   */
  const subState = me.subscription
    ? {
        status: me.subscription.status,
        isComped: me.subscription.isComped,
        isPaused: me.subscription.isPaused,
        cancelAtPeriodEnd: me.subscription.cancelAtPeriodEnd,
        hasStripeSubscription: me.subscription.hasStripeSubscription,
        currentPeriodEnd: me.subscription.currentPeriodEnd,
      }
    : null;
  const cancelState = canCancel(subState);
  const reactivateState = canReactivate(subState);

  /**
   * "Update card" needs a live Stripe subscription (past_due and unpaid count
   * as live) and an owner. Comped accounts have no card to update.
   */
  const showUpdateCard =
    me.canManage &&
    !!me.subscription?.hasStripeSubscription &&
    !me.subscription.isComped;
  /** The notices for these reasons tell the user to update their card. */
  const cardNeedsAttention =
    me.access.reason === 'past_due_expired' || me.access.reason === 'grace_period';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <CreditCard className="h-5 w-5 text-[hsl(var(--primary))]" />
        <h2 className="text-lg font-semibold">Billing</h2>
      </div>

      {error && (
        <div role="alert" className="rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
          {error}
        </div>
      )}

      {notice && (
        <div
          role={notice.tone === 'error' ? 'alert' : undefined}
          className={cn(
            'flex items-start gap-2 rounded-[var(--radius-md)] border px-4 py-3 text-sm',
            notice.tone === 'error'
              ? 'border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] text-[hsl(var(--destructive))]'
              : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'
          )}
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {notice.text}
        </div>
      )}

      {/* Current plan */}
      {me.subscription && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Current plan</p>
              <p className="mt-0.5 text-xl font-semibold">
                {me.subscription.planName}
                {me.subscription.isComped && (
                  <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-[hsl(var(--primary)_/_0.1)] px-2 py-0.5 text-xs font-medium text-[hsl(var(--primary))]">
                    <Gift className="h-3 w-3" />
                    Complimentary
                  </span>
                )}
              </p>
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                {me.subscription.isComped
                  ? me.subscription.compedUntil
                    ? `Granted access until ${shortDate(me.subscription.compedUntil)}`
                    : 'Granted access with no expiry'
                  : me.subscription.trialEndsAt && me.access.reason === 'trialing'
                    ? `Trial ends ${shortDate(me.subscription.trialEndsAt)}`
                    : me.subscription.currentPeriodEnd
                      ? `${me.subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} ${shortDate(me.subscription.currentPeriodEnd)} · billed ${me.subscription.billingCycle}`
                      : `Billed ${me.subscription.billingCycle}`}
              </p>
              {/*
                THE DISCOUNT, AND WHAT THEY WILL ACTUALLY PAY.

                Accepting a retention offer used to change nothing here: the
                line above still showed the plan's list price and "Renews 14
                Nov", so someone who had just claimed 50% off saw no evidence
                of it and no way to check short of re-entering the
                cancellation flow — where they would be told they had already
                used their one offer.

                Rendered above the plan name's siblings rather than tucked at
                the bottom, because the amount due is the thing they came to
                confirm.
              */}
              {me.activeDiscount && (
                <p className="mt-2 inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-md)] border border-green-300 bg-green-50 px-2.5 py-1.5 text-xs text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                  <BadgePercent className="h-3.5 w-3.5 shrink-0" />
                  {me.activeDiscount.nextCharge && (
                    <span className="font-semibold">
                      {me.activeDiscount.nextCharge} due next
                    </span>
                  )}
                  <span>{me.activeDiscount.summary}</span>
                  {me.activeDiscount.afterwards && (
                    <span className="opacity-80">{me.activeDiscount.afterwards}</span>
                  )}
                </p>
              )}

              {/*
                A scheduled downgrade is persisted in pending_plan_id, so this
                survives a refresh. It previously did not: the webhook cleared
                the column as soon as the subscription reported `active`, which
                a scheduled downgrade does for the whole remaining period — so
                the notice disappeared seconds after it was set, while Stripe
                still showed the lower amount due next cycle.
              */}
              {me.subscription.pendingPlanName && (
                <p className="mt-2 inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                  Changing to {me.subscription.pendingPlanName}
                  {me.subscription.pendingBillingCycle
                    ? ` (${me.subscription.pendingBillingCycle})`
                    : ''}{' '}
                  on {shortDate(me.subscription.currentPeriodEnd)}
                </p>
              )}

              {/*
                Retired plan: no longer sold, but nothing about this customer's
                arrangement changed. The copy is deliberately reassuring and
                asks nothing of them — they keep the same price and the same
                limits, and the plan simply does not appear in the cards below.
                Without this the plan name looked like an error, because the
                plan they are on is absent from the list of plans.
              */}
              {me.subscription.planRetired && !me.subscription.isComped && (
                <p className="mt-2 inline-flex items-start gap-1.5 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-2.5 py-1.5 text-xs text-[hsl(var(--foreground-muted))]">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    {me.subscription.planName} is no longer offered to new
                    customers. Your price and limits stay exactly as they are —
                    nothing changes unless you choose a different plan.
                  </span>
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {/*
                Escape hatch: if someone pays and navigates away before the
                automatic reconcile runs, or a webhook is simply late, this lets
                them refresh their own state instead of contacting support.
              */}
              <button
                onClick={() => load({ reconcile: true })}
                disabled={busy || loading}
                title="Check Stripe for the latest status of your subscription"
                className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
                Refresh billing
              </button>

              {/*
                Primary when a failed payment is the reason for the notice
                above, since that notice tells them to update their card.
              */}
              {showUpdateCard && (
                <button
                  onClick={updateCard}
                  disabled={busy}
                  aria-busy={busyAction === 'update_card'}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-sm disabled:opacity-40',
                    cardNeedsAttention
                      ? 'bg-[hsl(var(--primary))] font-semibold text-white hover:opacity-90'
                      : 'border border-border font-medium hover:bg-[hsl(var(--background-muted))]'
                  )}
                >
                  {busyAction === 'update_card' ? (
                    <Spinner
                      size="sm"
                      className={cardNeedsAttention ? 'text-white' : undefined}
                    />
                  ) : (
                    <CreditCard className="h-3.5 w-3.5" />
                  )}
                  Update card
                </button>
              )}

              {/*
                Reactivate replaces Cancel once a subscription is ending.
                Showing both would be a contradiction, and a customer who has
                just cancelled is the one most likely to want this — it is a
                single flag flip with no charge while the period is still
                running.
              */}
              {me.canManage && reactivateState.allowed && reactivateState.kind === 'resume' && (
                <button
                  onClick={reactivate}
                  disabled={busy}
                  aria-busy={busyAction === 'reactivate'}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
                >
                  {busyAction === 'reactivate' && (
                    <Spinner size="sm" className="text-white" />
                  )}
                  Reactivate my plan
                </button>
              )}

              {/*
                THE OTHER REACTIVATION STATE, which had no control at all.

                `canReactivate` returns two allowed kinds. `resume` is a
                subscription still running but set to end — one flag flip, no
                charge, handled above. `repurchase` is one that has ALREADY
                ended: Stripe has nothing left to resume, so it needs a new
                checkout at whatever the current price is.

                Only `resume` was rendered. In the repurchase state the card
                showed no action whatsoever — Cancel is correctly blocked by
                `already_canceled`, so a customer who had fully lapsed was left
                with a dead panel and no way back in, even though the plan
                picker was sitting further down the page.

                A button rather than a link so it can also move the viewport:
                "choose a plan below" is unhelpful when "below" is off screen.
              */}
              {me.canManage && reactivateState.allowed && reactivateState.kind === 'repurchase' && (
                <button
                  onClick={() => {
                    document
                      .getElementById('plan-picker')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
                >
                  Start a new subscription
                </button>
              )}
            </div>
          </div>

          {/*
            CANCEL SITS HERE, LOW EMPHASIS AND LAST.
            Deliberately a quiet text button under the card rather than a
            peer of the others: it is the one irreversible action on this
            screen, and the flow behind it is where the retention conversation
            happens. Rendered only when cancelling is actually possible, so a
            comped, trialing or paused account is never shown a button that
            would only explain why it cannot be used.
          */}
          {me.canManage && cancelState.allowed && (
            <div className="mt-4 border-t border-border pt-3">
              <button
                onClick={() => setCancelling(true)}
                disabled={busy}
                className="text-sm font-medium text-[hsl(var(--foreground-muted))] underline hover:text-[hsl(var(--destructive))] hover:no-underline disabled:opacity-40"
              >
                Cancel my subscription
              </button>
            </div>
          )}
        </div>
      )}

      {/* Usage */}
      {me.usage.length > 0 && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold">Usage this period</h3>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              Resets {shortDate(me.periodEnd)}
            </p>
          </div>
          <div className="mt-4 space-y-3">
            {me.usage.map((u) => {
              const pct = u.unlimited || u.limit <= 0
                ? 0
                : Math.min(100, Math.round((u.used / u.limit) * 100));
              return (
                <div key={u.key}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span>{u.label}</span>
                    <span className="text-xs text-[hsl(var(--foreground-muted))]">
                      {u.unlimited
                        ? 'Unlimited'
                        : u.notIncluded
                          ? 'Not in your plan'
                          : `${u.used} of ${u.limit}`}
                    </span>
                  </div>
                  {!u.unlimited && !u.notIncluded && (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--background-muted))]">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          pct >= 100 ? 'bg-[hsl(var(--destructive))]' : 'bg-[hsl(var(--primary))]'
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Plans */}
      {me.canManage && (
        /*
          Anchored so the subscription card above can point at it. A customer
          whose subscription has fully ended is told to "choose a plan below",
          and on a long settings page "below" is not always on screen.
        */
        <div className="space-y-3" id="plan-picker">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {me.subscription?.hasStripeSubscription ? 'Change plan' : 'Choose a plan'}
            </h3>
            <div className="flex gap-1 rounded-[var(--radius-md)] border border-border p-0.5">
              {(['monthly', 'annual'] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCycle(c)}
                  className={cn(
                    'rounded-[var(--radius-sm)] px-3 py-1 text-xs font-medium capitalize transition-colors',
                    cycle === c
                      ? 'bg-[hsl(var(--primary))] text-white'
                      : 'text-[hsl(var(--foreground-muted))] hover:text-foreground'
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {me.plans.map((plan) => {
              const price = cycle === 'annual' ? plan.annualPrice : plan.monthlyPrice;
              const buyable = cycle === 'annual' ? plan.purchasableAnnual : plan.purchasableMonthly;
              const isCurrent =
                plan.isCurrent && me.subscription?.billingCycle === cycle;
              // Only THIS card's own action spins. A change is confirmed in
              // the modal first, so `change:<id>` spins there as well.
              const cardBusy =
                busyAction === `subscribe:${plan.id}` || busyAction === `change:${plan.id}`;

              return (
                <div
                  key={plan.id}
                  className={cn(
                    'flex flex-col rounded-[var(--radius-lg)] border bg-card p-5',
                    isCurrent ? 'border-[hsl(var(--primary))]' : 'border-border'
                  )}
                >
                  <div className="flex items-baseline justify-between">
                    <p className="font-semibold">{plan.name}</p>
                    {isCurrent && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))]">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Current
                      </span>
                    )}
                  </div>
                  {plan.tagline && (
                    <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{plan.tagline}</p>
                  )}
                  <p className="mt-3 text-2xl font-bold">
                    {pickMoneyFormatter([price])(price)}
                    <span className="text-sm font-normal text-[hsl(var(--foreground-muted))]">
                      /{cycle === 'annual' ? 'yr' : 'mo'}
                    </span>
                  </p>
                  {plan.description && (
                    <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))]">{plan.description}</p>
                  )}

                  <ul className="mt-3 flex-1 space-y-1">
                    {plan.limits.slice(0, 5).map((l) => (
                      <li key={l.key} className="text-xs text-[hsl(var(--foreground-muted))]">
                        {l.label}: {l.value === -1 ? 'Unlimited' : l.value === 0 ? 'Not included' : l.value}
                      </li>
                    ))}
                  </ul>

                  <div className="mt-4">
                    {isCurrent ? (
                      <button
                        disabled
                        className="w-full rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium opacity-50"
                      >
                        Your plan
                      </button>
                    ) : !buyable ? (
                      <button
                        disabled
                        title="This plan is not available for purchase yet"
                        className="w-full rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm opacity-40"
                      >
                        Unavailable
                      </button>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() =>
                          me.subscription?.hasStripeSubscription
                            // Confirm first: this path charges immediately for
                            // an upgrade. New subscriptions go to Stripe
                            // Checkout, which is its own confirmation step.
                            ? setConfirming(plan)
                            : subscribe(plan.id)
                        }
                        aria-busy={cardBusy}
                        className="w-full rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                      >
                        {/*
                          Never "Start trial": the trial already began at signup,
                          so every button here is an upgrade to a paid plan.
                        */}
                        {cardBusy ? (
                          <Spinner size="sm" className="mx-auto text-white" />
                        ) : me.subscription?.hasStripeSubscription ? (
                          'Switch to this plan'
                        ) : (
                          'Upgrade to this plan'
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-[hsl(var(--foreground-muted))]">
            Upgrades apply straight away and you are billed the difference for the rest of
            the period. Downgrades take effect at the end of the period you have already
            paid for. Usage already counted this period carries over either way.
          </p>
        </div>
      )}

      {!me.canManage && (
        <p className="text-xs text-[hsl(var(--foreground-muted))]">
          Only the account owner can change the plan or payment details.
        </p>
      )}

      {/* Invoice history */}
      {me.invoices.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Invoices</h3>
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
            <table className="w-full text-sm">
              <tbody>
                {me.invoices.map((inv) => (
                  <tr key={inv.stripe_invoice_id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-xs">{shortDate(inv.paid_at ?? inv.created_at)}</td>
                    <td className="px-4 py-2">{money(inv.amount_paid, inv.currency)}</td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          inv.status === 'paid'
                            ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        )}
                      >
                        {inv.status ?? 'unknown'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      {inv.hosted_invoice_url && (
                        <a
                          href={inv.hosted_invoice_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
                        >
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/*
        Prices are stored in whole currency units but Stripe and this dialog
        work in minor units, so convert once here rather than inside the
        dialog — keeping the dialog's contract identical to Stripe's.
      */}
      {confirming && (
        <PlanChangeModal
          open
          kind={changeKindFor(confirming)}
          currentPlanName={me.subscription?.planName ?? 'your current plan'}
          targetPlanName={confirming.name}
          targetAmountMinor={Math.round(
            (cycle === 'annual' ? confirming.annualPrice : confirming.monthlyPrice) * 100
          )}
          targetCycle={cycle}
          periodEnd={me.subscription?.currentPeriodEnd ?? null}
          pending={busyAction === `change:${confirming.id}`}
          onConfirm={() => changePlan(confirming.id)}
          onClose={() => setConfirming(null)}
        />
      )}

      {/*
        The cancellation flow. Gated on cancelState so it cannot be opened for
        an account the server would refuse, which keeps the modal free of
        "you can't do this" states.
      */}
      {me.subscription && (
        <CancelSubscriptionModal
          open={cancelling && cancelState.allowed}
          onClose={() => setCancelling(false)}
          onCancelled={() => load()}
          planName={me.subscription.planName}
          billingCycle={me.subscription.billingCycle}
          status={me.subscription.status}
          /*
            Not in /api/billing/me's payload, and not worth adding there: the
            only screen that needs it is the confirmation, and the cancel
            response carries the address the receipt was actually sent to —
            which is the one worth showing.
          */
          email={null}
          accessEndsAt={me.subscription.currentPeriodEnd}
          initiativeCount={me.counts?.initiatives ?? 0}
          planFeatures={me.subscription.planFeatures ?? []}
          onLegacyPrice={me.subscription.onLegacyPrice}
          /*
            Defaults to false if a cached bundle meets an older API response:
            hiding an offer that might have been available is recoverable, while
            showing one that cannot be granted is the bug this replaced.
          */
          discountOfferAvailable={me.subscription.discountOfferAvailable ?? false}
          pauseOfferAvailable={me.subscription.pauseOfferAvailable ?? false}
          resetCallUrl={me.subscription.resetCallUrl ?? null}
          strategyCallUrl={me.subscription.strategyCallUrl ?? null}
          currentPriceMinor={me.subscription.currentPriceMinor}
          standardPriceMinor={me.subscription.standardPriceMinor}
          priceCurrency={me.subscription.priceCurrency}
        />
      )}
    </div>
  );
}
