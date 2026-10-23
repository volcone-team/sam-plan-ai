'use client';

import { useState } from 'react';
import {
  X,
  ArrowLeft,
  Plus,
  Calendar,
  Users,
} from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { NumberInputRaw } from '@/components/ui/number-input';
import { formatNumber } from '@/lib/format-money';
import { toDateOnly } from '@/lib/plan-dates';
import type { CreateInitiativeRequest } from '@/lib/initiatives/create-request';
import type { InitiativeKind } from '@/types';
import { LibraryInitiativePicker, CUSTOM_CHOICE } from './library-initiative-picker';
import { useCustomerLibrary } from './use-customer-library';
import { MetricSetPicker, DEFAULT_METRIC_CHOICE, type MetricChoice } from './metric-set-picker';
import type { StoredMetrics } from '@/lib/metrics/parse-metrics';
import { LimitReachedError, type LimitNotice as LimitNoticeData } from '@/lib/billing/limit-notice';
import { LimitNotice } from '@/components/billing/limit-notice';
import type { PickerItem } from '@/lib/intake-v3/picker';
import { IntakePicker } from './intake-picker';
import { IntakeForm } from './intake-form';
import { useIntakePickerLoad } from './use-intake-picker-load';
import { chooseAddFlow } from './add-initiative-flow';
import type { HandoffInitiative } from '@/lib/initiatives/lead-handoff';

export interface AddInitiativePanelProps {
  open: boolean;
  onClose: () => void;
  /** Posted to POST /api/initiatives by the caller. */
  onSubmit: (request: CreateInitiativeRequest) => Promise<void>;
  products: Array<{ id: string; name: string }>;
  annualPlanId: string;
  /** The year of `annualPlanId`'s plan. The intake form defaults an ongoing close date to its end. */
  planYear?: number | null;
  /** The company's loaded initiatives, for the lead-handoff select. */
  handoffTargets?: readonly HandoffInitiative[];
}

type PanelStep = 'pick-type' | 'configure';

/** What was picked on step one. */
type Selection =
  | { kind: 'library'; key: string; name: string; metrics: StoredMetrics | null }
  | { kind: 'custom' };

/**
 * Slide-over panel for adding a new initiative.
 *
 * New Initiative Intake (when the admin switch is on, or the caller is a
 * super admin previewing it, and GET /api/intake-v3/picker offers anything):
 * IntakePicker → IntakeForm for the picked record.
 *
 * Legacy fallback (picker failed, or nothing offered — see chooseAddFlow):
 * pick an initiative from the ACTIVE workbook library (or Custom) → configure
 * details. The type mapping happens server-side.
 *
 * Either way the request goes to the caller's onSubmit (POST /api/initiatives)
 * and success closes the panel.
 */
export function AddInitiativePanel({
  open,
  onClose,
  onSubmit,
  products,
  annualPlanId,
  planYear = null,
  handoffTargets,
}: AddInitiativePanelProps) {
  const [step, setStep] = useState<PanelStep>('pick-type');
  const [choice, setChoice] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<Selection | null>(null);
  const library = useCustomerLibrary(open);
  const addFlow = chooseAddFlow(useIntakePickerLoad(open));
  /** The record picked in the new intake picker; null on the picker screen. */
  const [intakeItem, setIntakeItem] = useState<PickerItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** A plan-limit refusal, shown with an Upgrade link for owners. */
  const [submitLimit, setSubmitLimit] = useState<LimitNoticeData | null>(null);
  const [metricChoice, setMetricChoice] = useState<MetricChoice>(DEFAULT_METRIC_CHOICE);
  /** The library key `metricChoice` belongs to. */
  const [metricChoiceFor, setMetricChoiceFor] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [productId, setProductId] = useState('');
  const [kind, setKind] = useState<InitiativeKind>('one-time');
  const [activationDate, setActivationDate] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [plannedBudget, setPlannedBudget] = useState('');
  const [trafficInput, setTrafficInput] = useState('');
  const [eventDateMode, setEventDateMode] = useState<'exact' | 'month'>('exact');
  const [eventMonth, setEventMonth] = useState('');
  const [eventYear, setEventYear] = useState('2026');
  const [timing, setTiming] = useState<'upcoming' | 'historical'>('upcoming');
  const [actualRevenue, setActualRevenue] = useState('');
  const [actualSpend, setActualSpend] = useState('');
  const [audience, setAudience] = useState<'mine' | 'someone_else'>('mine');
  const [bookingStatus, setBookingStatus] = useState<'booked_with_date' | 'booked_date_tbd' | 'not_yet'>('not_yet');
  const [partnerName, setPartnerName] = useState('');
  const [marketingStrategies, setMarketingStrategies] = useState<string[]>([]);
  const [dashboardLink, setDashboardLink] = useState('');
  const [promoBrief, setPromoBrief] = useState('');
  const [productPrice, setProductPrice] = useState('');
  const [spendOnAds, setSpendOnAds] = useState<'yes' | 'no'>('no');
  const [salesCommission, setSalesCommission] = useState<'yes' | 'no'>('no');
  const [otherExpenses, setOtherExpenses] = useState<Array<{ description: string; amount: string }>>([]);
  const [revenueGoalMode, setRevenueGoalMode] = useState<'enter' | 'metrics'>('enter');
  const [initiativeTarget, setInitiativeTarget] = useState('');
  const [rationale, setRationale] = useState('');
  const [trackingMetrics, setTrackingMetrics] = useState<Array<{ name: string; target: string }>>([
    { name: 'Registrants', target: '' },
    { name: 'Conv. rate', target: '' },
    { name: 'Revenue', target: '' },
  ]);

  const resetForm = () => {
    setSubmitError(null);
    setSubmitLimit(null);
    setIntakeItem(null);
    setStep('pick-type');
    setChoice(null);
    setSelectedType(null);
    setMetricChoice(DEFAULT_METRIC_CHOICE);
    setMetricChoiceFor(null);
    setName('');
    setProductId('');
    setKind('one-time');
    setActivationDate('');
    setEventDate('');
    setEventDateMode('exact');
    setEventMonth('');
    setEventYear('2026');
    setTiming('upcoming');
    setActualRevenue('');
    setActualSpend('');
    setAudience('mine');
    setBookingStatus('not_yet');
    setPartnerName('');
    setMarketingStrategies([]);
    setDashboardLink('');
    setPromoBrief('');
    setProductPrice('');
    setSpendOnAds('no');
    setSalesCommission('no');
    setOtherExpenses([]);
    setRevenueGoalMode('enter');
    setInitiativeTarget('');
    setRationale('');
    setTrackingMetrics([
      { name: 'Registrants', target: '' },
      { name: 'Conv. rate', target: '' },
      { name: 'Revenue', target: '' },
    ]);
    setPlannedBudget('');
    setTrafficInput('');
    setSubmitting(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  /** Step one's Continue: turn the radio choice into a selection. */
  const handleContinue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!choice) return;
    if (choice === CUSTOM_CHOICE) {
      setSelectedType({ kind: 'custom' });
      setName('Custom Initiative');
    } else {
      const item = library.initiatives.find(i => i.key === choice);
      if (!item) return;
      // A different initiative starts from "track everything" again.
      // Back then Continue on the same one keeps the choices.
      if (metricChoiceFor !== item.key) {
        setMetricChoice(DEFAULT_METRIC_CHOICE);
        setMetricChoiceFor(item.key);
      }
      setSelectedType({ kind: 'library', key: item.key, name: item.name, metrics: item.metrics });
      setName(item.name);
    }
    setStep('configure');
  };

  const handleBack = () => {
    // The radio choice is kept, so Back returns to where they were.
    setStep('pick-type');
    setSelectedType(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !name) return;

    setSubmitting(true);
    setSubmitError(null);
    setSubmitLimit(null);
    try {
      // Dates go as YYYY-MM-DD strings. toDateOnly keeps a picked date as the
      // same calendar day; `new Date('2026-05-01')` used to be UTC midnight,
      // which is the previous day west of Greenwich.
      const request: CreateInitiativeRequest = {
        libraryKey: selectedType.kind === 'library' ? selectedType.key : null,
        annualPlanId,
        productId: productId || products[0]?.id || '',
        name,
        description: '',
        kind,
        activationDate: activationDate ? toDateOnly(activationDate) : toDateOnly(new Date()),
        eventDate: eventDateMode === 'exact' && eventDate
          ? toDateOnly(eventDate)
          : eventDateMode === 'month' && eventMonth
            ? `${eventYear}-${eventMonth.padStart(2, '0')}-15`
            : null,
        trafficInput: trafficInput ? parseInt(trafficInput, 10) : null,
        plannedBudget: plannedBudget ? parseFloat(plannedBudget) : 0,
        revenueScenarios: {
          good: initiativeTarget ? parseFloat(initiativeTarget) : 0,
          better: initiativeTarget ? Math.round(parseFloat(initiativeTarget) * 1.1) : 0,
          best: initiativeTarget ? Math.round(parseFloat(initiativeTarget) * 1.25) : 0,
        },
        // Choices only: the server builds the metric set from the library row.
        ...(selectedType.kind === 'library'
          ? {
              metricSelection: {
                ...(metricChoice.groupLabels ? { groupLabels: metricChoice.groupLabels } : {}),
                excludedOptional: metricChoice.excludedOptional,
              },
            }
          : {}),
      };
      await onSubmit(request);
      handleClose();
    } catch (err) {
      if (err instanceof LimitReachedError) {
        setSubmitLimit(err.notice);
        setSubmitError(null);
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Could not save the initiative.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  /** The new intake form's submit: same request target, same success path. */
  const handleIntakeSubmit = async (request: CreateInitiativeRequest) => {
    setSubmitting(true);
    setSubmitError(null);
    setSubmitLimit(null);
    try {
      await onSubmit(request);
      handleClose();
    } catch (err) {
      // Shown through the form's `error` prop (or the limit notice); not
      // rethrown, so the form does not show it a second time.
      if (err instanceof LimitReachedError) {
        setSubmitLimit(err.notice);
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Could not save the initiative.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleIntakeBack = () => {
    setIntakeItem(null);
    setSubmitError(null);
    setSubmitLimit(null);
  };

  if (!open) return null;

  if (addFlow.flow !== 'legacy') {
    const intakeConfig =
      addFlow.flow === 'intake' && intakeItem ? addFlow.load.configs[intakeItem.key] : undefined;
    return (
      <>
        {/* Backdrop */}
        <div
          className="fixed inset-0 z-40 bg-black/30 transition-opacity"
          onClick={handleClose}
          aria-hidden="true"
        />

        {/* Panel */}
        <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-card shadow-xl">
          {/* Header. The form carries its own Back and heading. */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">New Initiative</h2>
            <button
              onClick={handleClose}
              className="rounded-[var(--radius-md)] p-1.5 text-[hsl(var(--foreground-muted))] hover:bg-background hover:text-[hsl(var(--foreground))] transition-colors"
              aria-label="Close panel"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {addFlow.flow === 'intake' && addFlow.load.preview && (
              <p
                role="note"
                className="mb-4 rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
              >
                Preview — customers still see the current form.
              </p>
            )}

            {addFlow.flow === 'loading' && (
              <p role="status" className="px-1 py-6 text-center text-sm text-[hsl(var(--foreground-muted))]">
                Loading initiatives…
              </p>
            )}

            {addFlow.flow === 'intake' && intakeItem && intakeConfig ? (
              <div className="space-y-4">
                <LimitNotice notice={submitLimit} />
                <IntakeForm
                  key={intakeItem.key}
                  item={intakeItem}
                  config={intakeConfig}
                  products={products}
                  annualPlanId={annualPlanId}
                  planYear={planYear}
                  onBack={handleIntakeBack}
                  onSubmit={handleIntakeSubmit}
                  submitting={submitting}
                  error={submitError}
                  handoffTargets={handoffTargets}
                />
              </div>
            ) : (
              addFlow.flow === 'intake' && (
                <div className="space-y-4">
                  <p className="text-sm text-[hsl(var(--foreground-muted))]">
                    Choose an initiative to add to your plan.
                  </p>
                  <IntakePicker load={addFlow.load} onSelect={setIntakeItem} onCancel={handleClose} />
                </div>
              )
            )}
          </div>
        </div>
      </>
    );
  }

  const selectedName =
    selectedType?.kind === 'library' ? selectedType.name : 'Custom Initiative';

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 transition-opacity"
        onClick={handleClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            {step === 'configure' && (
              <button
                onClick={handleBack}
                className="rounded-[var(--radius-md)] p-1.5 text-[hsl(var(--foreground-muted))] hover:bg-background hover:text-[hsl(var(--foreground))] transition-colors"
                aria-label="Go back"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
              {step === 'pick-type'
                ? 'Add Initiative'
                : `Configure: ${selectedName}`}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-[var(--radius-md)] p-1.5 text-[hsl(var(--foreground-muted))] hover:bg-background hover:text-[hsl(var(--foreground))] transition-colors"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'pick-type' && (
            // A form, so Enter on a focused radio continues.
            <form id="pick-initiative-form" onSubmit={handleContinue} className="space-y-4">
              <p className="text-sm text-[hsl(var(--foreground-muted))]">
                Choose an initiative to add to your plan.
              </p>
              <LibraryInitiativePicker
                initiatives={library.initiatives}
                value={choice}
                onChange={setChoice}
                loading={library.loading}
                error={library.error}
              />
            </form>
          )}

          {step === 'configure' && selectedType && (
            <form id="add-initiative-form" onSubmit={handleSubmit} className="space-y-5">
              {submitError && (
                <div role="alert" className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  {submitError}
                </div>
              )}
              <LimitNotice notice={submitLimit} />
              {/* Name */}
              <div className="space-y-1.5">
                <label htmlFor="init-name" className="text-sm font-medium text-[hsl(var(--foreground))]">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="init-name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] placeholder:text-[hsl(var(--foreground-muted))]"
                  placeholder="Initiative name"
                />
              </div>

              {/* Product */}
              <div className="space-y-1.5">
                <label htmlFor="init-product" className="text-sm font-medium text-[hsl(var(--foreground))]">
                  <span className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-[hsl(var(--foreground-muted))]" />
                    Product
                  </span>
                </label>
                <select
                  id="init-product"
                  value={productId}
                  onChange={e => setProductId(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                >
                  <option value="">Select a product (optional)...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Kind */}
              <div className="space-y-1.5">
                <label htmlFor="init-kind" className="text-sm font-medium text-[hsl(var(--foreground))]">
                  Kind <span className="text-red-500">*</span>
                </label>
                <select
                  id="init-kind"
                  value={kind}
                  onChange={e => setKind(e.target.value as InitiativeKind)}
                  required
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                >
                  <option value="one-time">One-time</option>
                  <option value="recurring">Recurring</option>
                  <option value="evergreen">Evergreen</option>
                </select>
              </div>

              {/* Timing */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[hsl(var(--foreground))]">Timing</label>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">
                  Use historical mode to log a promo that already happened so you can back-fill actuals.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTiming('upcoming')}
                    className={`rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                      timing === 'upcoming'
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)]'
                        : 'border-border hover:border-[hsl(var(--foreground-muted))]'
                    }`}
                  >
                    <span className="text-sm font-medium text-[hsl(var(--foreground))]">Upcoming</span>
                    <p className="text-[11px] text-[hsl(var(--foreground-muted))] mt-0.5">Planned promo. Track to its target date.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTiming('historical')}
                    className={`rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                      timing === 'historical'
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)]'
                        : 'border-border hover:border-[hsl(var(--foreground-muted))]'
                    }`}
                  >
                    <span className="text-sm font-medium text-[hsl(var(--foreground))]">Historical</span>
                    <p className="text-[11px] text-[hsl(var(--foreground-muted))] mt-0.5">Already ran. Capture the actual results.</p>
                  </button>
                </div>

                {/* Conditional: Actual revenue & spend for historical */}
                {timing === 'historical' && (
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="space-y-1">
                      <label htmlFor="init-actual-revenue" className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
                        Actual revenue ($)
                      </label>
                      <NumberInputRaw
                        id="init-actual-revenue"
                        value={actualRevenue}
                        onValueChange={setActualRevenue}
                        placeholder="0"
                        className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="init-actual-spend" className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
                        Actual spend ($)
                      </label>
                      <NumberInputRaw
                        id="init-actual-spend"
                        value={actualSpend}
                        onValueChange={setActualSpend}
                        placeholder="0"
                        className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                      />
                    </div>
                    <p className="col-span-2 text-xs text-[hsl(var(--foreground-muted))]">
                      Set the date fields below to when it actually ran.
                    </p>
                  </div>
                )}
              </div>

              {/* Audience */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[hsl(var(--foreground))]">Audience</label>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">
                  Whose audience are you promoting to?
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAudience('mine')}
                    className={`rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                      audience === 'mine'
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)]'
                        : 'border-border hover:border-[hsl(var(--foreground-muted))]'
                    }`}
                  >
                    <span className="text-sm font-medium text-[hsl(var(--foreground))]">Mine</span>
                    <p className="text-[11px] text-[hsl(var(--foreground-muted))] mt-0.5">Your list, followers, or customers.</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAudience('someone_else')}
                    className={`rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                      audience === 'someone_else'
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)]'
                        : 'border-border hover:border-[hsl(var(--foreground-muted))]'
                    }`}
                  >
                    <span className="text-sm font-medium text-[hsl(var(--foreground))]">Someone else&apos;s</span>
                    <p className="text-[11px] text-[hsl(var(--foreground-muted))] mt-0.5">A partner, affiliate, or host&apos;s audience.</p>
                  </button>
                </div>

                {/* Conditional: Booking status + partner name for someone else's audience */}
                {audience === 'someone_else' && (
                  <div className="space-y-3 pt-2">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[hsl(var(--foreground))]">Is it booked?</label>
                      <div className="flex gap-2 flex-wrap">
                        {([
                          { value: 'booked_with_date', label: 'Booked, with a date' },
                          { value: 'booked_date_tbd', label: 'Booked, date TBD' },
                          { value: 'not_yet', label: 'Not yet' },
                        ] as const).map(option => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setBookingStatus(option.value)}
                            className={`rounded-[var(--radius-full)] px-3 py-1.5 text-xs font-medium border transition-colors ${
                              bookingStatus === option.value
                                ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]'
                                : 'border-border text-[hsl(var(--foreground-muted))] hover:border-[hsl(var(--foreground-muted))]'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="init-partner" className="text-xs font-medium text-[hsl(var(--foreground))]">
                        Partner name / Event name
                      </label>
                      <input
                        id="init-partner"
                        type="text"
                        value={partnerName}
                        onChange={e => setPartnerName(e.target.value)}
                        placeholder="Can remain blank"
                        className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] placeholder:text-[hsl(var(--foreground-muted))]"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Marketing */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-[hsl(var(--foreground))]">Marketing</label>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">
                  I am going to market this initiative with the following strategies — select all that apply.
                </p>
                <div className="flex flex-wrap gap-2">
                  {['Ads', 'Email', 'SMS', 'Organic Social', 'Partner promotion', 'Other', 'I am not going to market it'].map(strategy => {
                    const isSelected = marketingStrategies.includes(strategy);
                    const isNoMarketing = strategy === 'I am not going to market it';
                    return (
                      <button
                        key={strategy}
                        type="button"
                        onClick={() => {
                          if (isNoMarketing) {
                            setMarketingStrategies(isSelected ? [] : [strategy]);
                          } else {
                            const without = marketingStrategies.filter(s => s !== 'I am not going to market it');
                            if (isSelected) {
                              setMarketingStrategies(without.filter(s => s !== strategy));
                            } else {
                              setMarketingStrategies([...without, strategy]);
                            }
                          }
                        }}
                        className={`rounded-[var(--radius-md)] border px-3 py-2 text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)] text-[hsl(var(--primary))]'
                            : 'border-border text-[hsl(var(--foreground-muted))] hover:border-[hsl(var(--foreground-muted))]'
                        }`}
                      >
                        {strategy}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Activation Date */}
              <div className="space-y-1.5">
                <label htmlFor="init-activation" className="text-sm font-medium text-[hsl(var(--foreground))]">
                  <span className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-[hsl(var(--foreground-muted))]" />
                    Activation Date
                  </span>
                </label>
                <DateInput
                  id="init-activation"
                  value={activationDate}
                  onValueChange={setActivationDate}
                />
                <p className="text-xs text-[hsl(var(--foreground-muted))]">Optional — you can set this later</p>
              </div>

              {/* Event Date (conditional) */}
              {kind === 'one-time' && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-[hsl(var(--foreground))]">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-[hsl(var(--foreground-muted))]" />
                      Event Date
                    </span>
                  </label>
                  {/* Toggle: Exact date vs Month only */}
                  <div className="flex gap-2 mb-2">
                    <button
                      type="button"
                      onClick={() => setEventDateMode('exact')}
                      className={`rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium border transition-colors ${
                        eventDateMode === 'exact'
                          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]'
                          : 'border-border text-[hsl(var(--foreground-muted))] hover:border-[hsl(var(--foreground-muted))]'
                      }`}
                    >
                      Exact date
                    </button>
                    <button
                      type="button"
                      onClick={() => setEventDateMode('month')}
                      className={`rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium border transition-colors ${
                        eventDateMode === 'month'
                          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]'
                          : 'border-border text-[hsl(var(--foreground-muted))] hover:border-[hsl(var(--foreground-muted))]'
                      }`}
                    >
                      Month only
                    </button>
                  </div>
                  {eventDateMode === 'exact' ? (
                    <DateInput
                      id="init-event-date"
                      value={eventDate}
                      onValueChange={setEventDate}
                    />
                  ) : (
                    <div className="flex gap-2">
                      <select
                        value={eventMonth}
                        onChange={e => setEventMonth(e.target.value)}
                        className="flex-1 rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                      >
                        <option value="">Month...</option>
                        <option value="1">January</option>
                        <option value="2">February</option>
                        <option value="3">March</option>
                        <option value="4">April</option>
                        <option value="5">May</option>
                        <option value="6">June</option>
                        <option value="7">July</option>
                        <option value="8">August</option>
                        <option value="9">September</option>
                        <option value="10">October</option>
                        <option value="11">November</option>
                        <option value="12">December</option>
                      </select>
                      <select
                        value={eventYear}
                        onChange={e => setEventYear(e.target.value)}
                        className="w-24 rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                      >
                        <option value="2026">2026</option>
                        <option value="2027">2027</option>
                      </select>
                    </div>
                  )}
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">
                    {eventDateMode === 'month' ? "Pick the month — you can set the exact date later" : ""}
                  </p>
                </div>
              )}

              {/* Details — Additional Fields */}
              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Details</h3>

                {/* Product Price */}
                <div className="space-y-1">
                  <label htmlFor="init-product-price" className="text-xs font-medium text-[hsl(var(--foreground))]">
                    Product price ($)
                  </label>
                  <NumberInputRaw
                    id="init-product-price"
                    value={productPrice}
                    onValueChange={setProductPrice}
                    placeholder="e.g. 2497"
                    className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                  />
                </div>

                {/* Dashboard Link */}
                <div className="space-y-1">
                  <label htmlFor="init-dashboard-link" className="text-xs font-medium text-[hsl(var(--foreground))]">
                    Dashboard link
                  </label>
                  <input
                    id="init-dashboard-link"
                    type="url"
                    value={dashboardLink}
                    onChange={e => setDashboardLink(e.target.value)}
                    placeholder="https://..."
                    className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                  />
                  <p className="text-[11px] text-[hsl(var(--foreground-muted))]">Link to live dashboard, analytics, or tracking page for this initiative.</p>
                </div>

                {/* Promotion Brief */}
                <div className="space-y-1">
                  <label htmlFor="init-promo-brief" className="text-xs font-medium text-[hsl(var(--foreground))]">
                    Promotion brief
                  </label>
                  <textarea
                    id="init-promo-brief"
                    value={promoBrief}
                    onChange={e => setPromoBrief(e.target.value)}
                    placeholder="Hook, angle, offer, creative direction, or links to copy docs."
                    rows={3}
                    className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] resize-y"
                  />
                </div>

                {/* Traffic Input */}
                <div className="space-y-1">
                  <label htmlFor="init-traffic" className="text-xs font-medium text-[hsl(var(--foreground))]">
                    Expected registrants / audience
                  </label>
                  <NumberInputRaw
                    id="init-traffic"
                    value={trafficInput}
                    onValueChange={setTrafficInput}
                    placeholder="0"
                    className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                  />
                </div>
              </div>

              {/* Expense Breakdown */}
              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Expense breakdown</h3>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">
                  Optional. Capture ads, sales commission, and anything else that hits this initiative&apos;s P&amp;L.
                </p>

                {/* Ads */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[hsl(var(--foreground))]">Are you going to spend money on ads?</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setSpendOnAds('yes')}
                      className={`rounded-[var(--radius-md)] border px-3 py-1 text-xs font-medium transition-colors ${
                        spendOnAds === 'yes' ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)] text-[hsl(var(--primary))]' : 'border-border text-[hsl(var(--foreground-muted))]'
                      }`}
                    >Yes</button>
                    <button
                      type="button"
                      onClick={() => setSpendOnAds('no')}
                      className={`rounded-[var(--radius-md)] border px-3 py-1 text-xs font-medium transition-colors ${
                        spendOnAds === 'no' ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)] text-[hsl(var(--primary))]' : 'border-border text-[hsl(var(--foreground-muted))]'
                      }`}
                    >No</button>
                  </div>
                </div>

                {/* Sales Commission */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[hsl(var(--foreground))]">Is there a sales commission?</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setSalesCommission('yes')}
                      className={`rounded-[var(--radius-md)] border px-3 py-1 text-xs font-medium transition-colors ${
                        salesCommission === 'yes' ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)] text-[hsl(var(--primary))]' : 'border-border text-[hsl(var(--foreground-muted))]'
                      }`}
                    >Yes</button>
                    <button
                      type="button"
                      onClick={() => setSalesCommission('no')}
                      className={`rounded-[var(--radius-md)] border px-3 py-1 text-xs font-medium transition-colors ${
                        salesCommission === 'no' ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)] text-[hsl(var(--primary))]' : 'border-border text-[hsl(var(--foreground-muted))]'
                      }`}
                    >No</button>
                  </div>
                </div>

                {/* Other Expenses */}
                <div className="space-y-2">
                  <span className="text-xs font-medium text-[hsl(var(--foreground))]">Other expenses</span>
                  <p className="text-[11px] text-[hsl(var(--foreground-muted))]">Anything else tied to this initiative — tools, contractors, swag, etc.</p>
                  {otherExpenses.length === 0 && (
                    <p className="text-xs italic text-[hsl(var(--foreground-muted))]">No other expenses yet.</p>
                  )}
                  {otherExpenses.map((exp, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={exp.description}
                        onChange={e => {
                          const updated = [...otherExpenses];
                          updated[idx] = { ...updated[idx], description: e.target.value };
                          setOtherExpenses(updated);
                        }}
                        placeholder="Description"
                        className="flex-1 rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-[hsl(var(--primary))]"
                      />
                      <NumberInputRaw
                        value={exp.amount}
                        onValueChange={amount => {
                          const updated = [...otherExpenses];
                          updated[idx] = { ...updated[idx], amount };
                          setOtherExpenses(updated);
                        }}
                        placeholder="$0"
                        aria-label={`Expense ${idx + 1} amount ($)`}
                        className="w-20 rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-[hsl(var(--primary))]"
                      />
                      <button
                        type="button"
                        onClick={() => setOtherExpenses(otherExpenses.filter((_, i) => i !== idx))}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setOtherExpenses([...otherExpenses, { description: '', amount: '' }])}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Add expense
                  </button>
                </div>
              </div>

              {/* Revenue Goals */}
              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Revenue goals</h3>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">
                  Enter your target revenue. Better and Best are calculated automatically (+10% and +25%).
                </p>
                <div className="flex gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setRevenueGoalMode('enter')}
                    className={`rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium border transition-colors ${
                      revenueGoalMode === 'enter'
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]'
                        : 'border-border text-[hsl(var(--foreground-muted))]'
                    }`}
                  >
                    Enter revenue goal
                  </button>
                  <button
                    type="button"
                    onClick={() => setRevenueGoalMode('metrics')}
                    className={`rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium border transition-colors ${
                      revenueGoalMode === 'metrics'
                        ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]'
                        : 'border-border text-[hsl(var(--foreground-muted))]'
                    }`}
                  >
                    Calculate from metrics
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="init-target-revenue" className="text-[11px] font-medium text-[hsl(var(--foreground))]">Initiative Target ($)</label>
                    <NumberInputRaw
                      id="init-target-revenue"
                      value={initiativeTarget}
                      onValueChange={setInitiativeTarget}
                      placeholder="Enter your target revenue"
                      className="w-full rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-[hsl(var(--foreground-muted))]">Better ($)</label>
                    <input
                      type="text"
                      readOnly
                      value={initiativeTarget ? formatNumber(Math.round(parseFloat(initiativeTarget) * 1.1)) : ''}
                      placeholder="—"
                      className="w-full rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-2 py-1.5 text-sm text-[hsl(var(--foreground-muted))] outline-none cursor-not-allowed"
                    />
                    <p className="text-[10px] text-[hsl(var(--foreground-muted))]">+10% above target</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-[hsl(var(--foreground-muted))]">Best ($)</label>
                    <input
                      type="text"
                      readOnly
                      value={initiativeTarget ? formatNumber(Math.round(parseFloat(initiativeTarget) * 1.25)) : ''}
                      placeholder="—"
                      className="w-full rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-2 py-1.5 text-sm text-[hsl(var(--foreground-muted))] outline-none cursor-not-allowed"
                    />
                    <p className="text-[10px] text-[hsl(var(--foreground-muted))]">+25% above target</p>
                  </div>
                </div>
              </div>

              {/* Rationale */}
              <div className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Rationale</h3>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">
                  Why this play, why now. One short paragraph.
                </p>
                <textarea
                  value={rationale}
                  onChange={e => setRationale(e.target.value)}
                  placeholder="What's the bet? What evidence backs the projection?"
                  rows={3}
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] resize-y"
                />
              </div>

              {/* What you'll track: the library initiative's standard metrics */}
              {selectedType.kind === 'library' && (
                <section aria-labelledby="init-track-heading" className="space-y-2 border-t border-border pt-4">
                  <h3 id="init-track-heading" className="text-sm font-semibold text-[hsl(var(--foreground))]">
                    What you&apos;ll track
                  </h3>
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">
                    The numbers you&apos;ll record for this initiative.
                  </p>
                  <MetricSetPicker
                    libraryKey={selectedType.key}
                    metrics={selectedType.metrics}
                    value={metricChoice}
                    onChange={setMetricChoice}
                  />
                </section>
              )}

              {/* Tracking Metrics (custom initiatives; not saved yet) */}
              {selectedType.kind === 'custom' && (
              <div className="space-y-2 border-t border-border pt-4">
                <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Tracking metrics</h3>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">
                  The few numbers you&apos;ll watch each week.
                </p>
                <div className="space-y-2">
                  {trackingMetrics.map((metric, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={metric.name}
                        onChange={e => {
                          const updated = [...trackingMetrics];
                          updated[idx] = { ...updated[idx], name: e.target.value };
                          setTrackingMetrics(updated);
                        }}
                        placeholder="Metric"
                        className="flex-1 rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-[hsl(var(--primary))]"
                      />
                      <input
                        type="text"
                        value={metric.target}
                        onChange={e => {
                          const updated = [...trackingMetrics];
                          updated[idx] = { ...updated[idx], target: e.target.value };
                          setTrackingMetrics(updated);
                        }}
                        placeholder="e.g. 35%"
                        className="w-24 rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-[hsl(var(--primary))]"
                      />
                      <button
                        type="button"
                        onClick={() => setTrackingMetrics(trackingMetrics.filter((_, i) => i !== idx))}
                        className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setTrackingMetrics([...trackingMetrics, { name: '', target: '' }])}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
                  >
                    <Plus className="h-3 w-3" /> Add metric
                  </button>
                </div>
              </div>
              )}
            </form>
          )}
        </div>

        {step === 'pick-type' && (
          <div className="border-t border-border px-6 py-4">
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="pick-initiative-form"
                disabled={!choice}
                className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Footer on the configure step */}
        {step === 'configure' && (
          <div className="border-t border-border px-6 py-4">
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-background"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="add-initiative-form"
                disabled={submitting || !name}
                className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Adding...' : 'Add Initiative'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
