'use client';

import { useEffect } from 'react';
import { AlertTriangle, CalendarClock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { describePlanChange } from '@/lib/billing/plan-change';

export interface PlanChangeModalProps {
  open: boolean;
  kind: 'upgrade' | 'downgrade' | 'cycle_change' | 'same';
  currentPlanName: string;
  targetPlanName: string;
  /** Target price in MINOR units (cents), matching Stripe. */
  targetAmountMinor: number | null;
  targetCycle: 'monthly' | 'annual';
  periodEnd: string | null;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmation step for a plan change.
 *
 * WHY THIS EXISTS. An upgrade does not go through Stripe Checkout — there is no
 * new subscription to create, so the existing one is modified in place with
 * proration and the card is charged immediately. That meant pressing "Switch to
 * this plan" took money with no confirmation and no visible amount, which is
 * indistinguishable from a billing bug from the customer's side.
 *
 * The wording comes from `describePlanChange`, which is unit-tested, so an
 * upgrade can never be described with downgrade phrasing (or vice versa).
 */
export function PlanChangeModal(props: PlanChangeModalProps) {
  if (!props.open) return null;
  return <PlanChangeDialog {...props} />;
}

function PlanChangeDialog({
  kind,
  currentPlanName,
  targetPlanName,
  targetAmountMinor,
  targetCycle,
  periodEnd,
  pending,
  onConfirm,
  onClose,
}: PlanChangeModalProps) {
  const preview = describePlanChange({
    kind,
    currentPlanName,
    targetPlanName,
    targetAmountMinor,
    targetCycle,
    periodEnd,
  });

  const titleId = 'plan-change-modal-title';

  // Escape closes, unless the request is already in flight — cancelling mid
  // request would leave the customer unsure whether they were charged.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, onClose]);

  const isCharge = preview.chargesNow;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-xl"
      >
        <div className="flex items-center gap-2">
          {isCharge ? (
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          ) : (
            <CalendarClock className="h-5 w-5 text-[hsl(var(--primary))]" />
          )}
          <h3 id={titleId} className="text-lg font-semibold">
            {preview.title}
          </h3>
        </div>

        <div
          className={cn(
            'mt-4 rounded-[var(--radius-md)] border p-4 text-sm',
            isCharge
              ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200'
              : 'border-border bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-muted))]'
          )}
        >
          {preview.body}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
              isCharge
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-[hsl(var(--primary))] hover:opacity-90'
            )}
          >
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {preview.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
