'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CreditCard, ExternalLink, TriangleAlert, CheckCircle2, Gift, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner, LoadingPanel } from '@/components/ui/spinner';

/**
 * Customer-facing billing panel: current plan, usage this period, plan changes,
 * and a link to Stripe's portal for cards, invoices and cancellation.
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
    planName: string; billingCycle: string; status: string;
    isComped: boolean; compedUntil: string | null; compedReason: string | null;
    trialEndsAt: string | null; currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean; pendingPlanName: string | null;
    pendingBillingCycle: string | null; hasStripeSubscription: boolean;
  } | null;
  access: { allowed: boolean; reason: string; warn: boolean; daysRemaining: number | null };
  usage: UsageRow[];
  periodEnd: string;
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
  const v = typeof minor === 'number' && Number.isFinite(minor) ? minor / 100 : 0;
  return `${currency.toUpperCase() === 'USD' ? '$' : ''}${v.toFixed(2)}`;
}

/** Human wording for why access is limited, paired with what to do about it. */
function accessNotice(me: BillingMe): { tone: 'warn' | 'error'; text: string } | null {
  const { access, subscription } = me;

  if (!access.allowed) {
    switch (access.reason) {
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cycle, setCycle] = useState<'monthly' | 'annual'>('monthly');

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
    setBusy(true);
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
        return;
      }
      // Leaves the app for Stripe's hosted page; card data never touches us.
      window.location.href = body.url;
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  };

  /** Move an existing subscription to another plan. */
  const changePlan = async (planId: string) => {
    setBusy(true);
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
            : `Could not change plan: ${body?.error ?? 'unknown'}`
        );
        return;
      }
      await load();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  const openPortal = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.url) {
        setError(
          body?.error === 'no_customer'
            ? 'There is no billing account to manage yet.'
            : 'Could not open the billing portal.'
        );
        return;
      }
      window.location.href = body.url;
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
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
              {me.subscription.pendingPlanName && (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Changing to {me.subscription.pendingPlanName} on{' '}
                  {shortDate(me.subscription.currentPeriodEnd)}
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

              {me.canManage && me.subscription.hasStripeSubscription && (
                <button
                  onClick={openPortal}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
                >
                  Manage payment &amp; invoices
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
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
        <div className="space-y-3">
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
                    ${price}
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
                            ? changePlan(plan.id)
                            : subscribe(plan.id)
                        }
                        className="w-full rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                      >
                        {/*
                          Never "Start trial": the trial already began at signup,
                          so every button here is an upgrade to a paid plan.
                        */}
                        {busy ? (
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
    </div>
  );
}
