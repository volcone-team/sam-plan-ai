'use client';
import { formatDate } from "@/lib/format-date";
import { formatScheduleDate } from "@/lib/initiatives/schedule";
import { toDateOnly, parseDateOnly } from "@/lib/plan-dates";

import { useEffect, useState } from 'react';
import { Calendar, Package, Tag, Clock, Zap, Pencil, Loader2 } from 'lucide-react';
import type { Initiative, InitiativeStatus, UpdateInitiativeDTO } from '@/types';
import type { InitiativeType } from '@/types/initiative-type.types';
import { initiativeService } from '@/services/initiative.service';
import { expenseService } from '@/services/expense.service';
import { pickMoneyFormatter } from '@/lib/results-tab-totals';
import { sumExpensesByInitiative } from '@/lib/initiative-spend';
import { NumberInputRaw } from '@/components/ui/number-input';
import { DateInput } from '@/components/ui/date-input';
import { usePermission } from '@/hooks/use-permission';
import { formatNumber, formatMoney } from '@/lib/format-money';
import { autoBest, autoBetter } from '@/lib/intake-v3/revenue';
import { planService } from '@/services/plan.service';
import { horizonEnd, perRun } from '@/lib/planning/revenue-spread';
import { REPEAT_FREQUENCY_LABELS, REPEAT_RUNS_PER_YEAR, type RepeatFrequency } from '@/lib/intake-forecast';
import type { DateOnly } from '@/lib/plan-dates';
import { editLayout } from '@/lib/initiatives/edit-layout';
import type { LibraryRecordConfig } from '@/lib/intake-v3/library-config';
import type { InitiativeKind } from '@/types';

/** Frequencies frequent enough that "per month" is a meaningful figure. */
const MONTHLY_OR_FASTER = new Set<string>(['weekly', 'bi-weekly', 'monthly']);

export interface InitiativeOverviewProps {
  initiative: Initiative;
  initiativeType: InitiativeType | null;
  productName: string;
  initiativeTypes: InitiativeType[];
  products: { id: string; name: string }[];
  onSaved: (updated: Initiative) => void;
}

const statusStyles: Record<string, { bg: string; text: string; label: string }> = {
  planned: { bg: 'bg-[hsl(var(--secondary))]', text: 'text-[hsl(var(--foreground))]', label: 'Planned' },
  in_progress: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'In Progress' },
  launched: { bg: 'bg-green-50', text: 'text-green-700', label: 'Launched' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Completed' },
  paused: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Paused' },
  retired: { bg: 'bg-gray-50', text: 'text-gray-700', label: 'Retired' },
};

const kindLabels: Record<string, string> = {
  'one-time': 'One-time',
  recurring: 'Recurring',
  evergreen: 'Evergreen',
};

type EditErrors = { name?: string; activationDate?: string; eventDate?: string; closeDate?: string; frequency?: string };

const inputClass =
  'w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] placeholder:text-[hsl(var(--foreground-muted))]';
const labelClass = 'text-sm font-medium text-[hsl(var(--foreground))]';
const helperClass = 'text-xs text-[hsl(var(--foreground-muted))]';
const fieldErrorClass = 'text-xs text-red-600 dark:text-red-400';

/**
 * Date → yyyy-mm-dd for <input type="date">. Local calendar day, matching
 * parseDateOnly on read; toISOString shifted it a day for users ahead of UTC.
 */
function toDateInputValue(date: Date | string | undefined | null): string {
  if (!date) return '';
  return toDateOnly(date);
}

function numberToInputValue(value: number | undefined | null): string {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Overview section: name, status, type, dates, product, kind, description.
 * Users with 'initiatives.edit' can switch the section into an inline edit form.
 */
export function InitiativeOverview({
  initiative,
  initiativeType,
  productName,
  initiativeTypes,
  products,
  onSaved,
}: InitiativeOverviewProps) {
  const canEdit = usePermission('initiatives.edit');
  const status = statusStyles[initiative.status] || statusStyles.planned;

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<EditErrors>({});

  // Form state
  const [name, setName] = useState(initiative.name);
  const [description, setDescription] = useState(initiative.description || '');
  const [statusValue, setStatusValue] = useState<InitiativeStatus>(initiative.status);
  const [initiativeTypeId, setInitiativeTypeId] = useState(initiative.initiativeTypeId || '');
  const [productId, setProductId] = useState(initiative.productId || '');
  const [activationDate, setActivationDate] = useState(toDateInputValue(initiative.activationDate));
  const [eventDate, setEventDate] = useState(toDateInputValue(initiative.eventDate));
  const [closeDate, setCloseDate] = useState(toDateInputValue(initiative.revenueCloseDate));
  const [kindValue, setKindValue] = useState<InitiativeKind>(initiative.kind);
  const [frequencyValue, setFrequencyValue] = useState(initiative.repeatFrequency ?? '');
  /**
   * The library record config the Add form used, so Edit shows the same
   * dates, kind and frequency (edit-layout.ts). Null until loaded, and for a
   * custom initiative; the form then offers every field.
   */
  const [formConfig, setFormConfig] = useState<{ config: LibraryRecordConfig | null; categoryId: string | null } | null>(null);
  useEffect(() => {
    if (!editing || formConfig) return;
    let cancelled = false;
    fetch(`/api/initiatives/${initiative.id}/form-config`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { config: null, categoryId: null }))
      .then(body => { if (!cancelled) setFormConfig({ config: body.config ?? null, categoryId: body.categoryId ?? null }); })
      .catch(() => { if (!cancelled) setFormConfig({ config: null, categoryId: null }); });
    return () => { cancelled = true; };
  }, [editing, formConfig, initiative.id]);
  const layout = editLayout({
    config: formConfig?.config ?? null,
    categoryId: formConfig?.categoryId ?? null,
    kind: kindValue,
    conversionPath: initiative.conversionPath ?? (typeof initiative.attrs?.conversion_ask === 'string' ? initiative.attrs.conversion_ask : null),
    hasCloseDate: Boolean(initiative.revenueCloseDate),
  });
  const [trafficInput, setTrafficInput] = useState(numberToInputValue(initiative.trafficInput));
  const [plannedBudget, setPlannedBudget] = useState(numberToInputValue(initiative.plannedBudget));
  /** D2: Σ this initiative's recorded expenses; null while loading. */
  const [expenseSpend, setExpenseSpend] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    expenseService
      .getExpensesByInitiative(initiative.id)
      .then((rows) => {
        // Cents-safe, the same sum the ROI report and initiative cards use.
        if (!cancelled) setExpenseSpend(sumExpensesByInitiative(rows).get(initiative.id) ?? 0);
      })
      .catch(() => { if (!cancelled) setExpenseSpend(0); });
    return () => { cancelled = true; };
  }, [initiative.id]);
  /** Last day of the plan horizon: bounds which runs of a recurring initiative count. */
  const [planEnd, setPlanEnd] = useState<DateOnly | null>(null);
  useEffect(() => {
    if (initiative.kind !== 'recurring' || !initiative.companyId) return;
    let cancelled = false;
    planService
      .getPlanHorizon(initiative.companyId)
      .then(h => { if (!cancelled) setPlanEnd(horizonEnd(h?.planStartMonth, h?.horizonMonths)); })
      .catch(() => { /* no horizon: runs are counted over twelve months */ });
    return () => { cancelled = true; };
  }, [initiative.companyId, initiative.kind]);

  // How often it runs, and what one run (and one month) earns.
  const frequency =
    initiative.kind === 'recurring' && initiative.repeatFrequency ? initiative.repeatFrequency : null;
  const frequencyLabel = frequency
    ? REPEAT_FREQUENCY_LABELS[frequency as RepeatFrequency] ?? frequency
    : null;
  const runFigures = frequency ? perRun(initiative, planEnd) : null;
  const monthlyBetter =
    runFigures && frequency && MONTHLY_OR_FASTER.has(frequency)
      ? (runFigures.better * REPEAT_RUNS_PER_YEAR[frequency as RepeatFrequency]) / 12
      : null;

  const [revenueGood, setRevenueGood] = useState(numberToInputValue(initiative.revenueScenarios?.good));
  const [revenueBetter, setRevenueBetter] = useState(numberToInputValue(initiative.revenueScenarios?.better));
  const [revenueBest, setRevenueBest] = useState(numberToInputValue(initiative.revenueScenarios?.best));
  /**
   * Better and Best follow Good (+10% / +20%) until the user types in them.
   * Once touched in this edit they keep the typed figure; Good no longer moves them.
   */
  const [betterTouched, setBetterTouched] = useState(false);
  const [bestTouched, setBestTouched] = useState(false);
  const handleGoodChange = (value: string) => {
    setRevenueGood(value);
    const good = Number(value);
    const usable = value !== '' && Number.isFinite(good) && good >= 0;
    if (!betterTouched) setRevenueBetter(usable ? String(autoBetter(good)) : '');
    if (!bestTouched) setRevenueBest(usable ? String(autoBest(good)) : '');
  };

  /** Reset form state back to the current initiative values. */
  const resetForm = () => {
    setName(initiative.name);
    setDescription(initiative.description || '');
    setStatusValue(initiative.status);
    setInitiativeTypeId(initiative.initiativeTypeId || '');
    setProductId(initiative.productId || '');
    setActivationDate(toDateInputValue(initiative.activationDate));
    setEventDate(toDateInputValue(initiative.eventDate));
    setCloseDate(toDateInputValue(initiative.revenueCloseDate));
    setKindValue(initiative.kind);
    setFrequencyValue(initiative.repeatFrequency ?? '');
    setTrafficInput(numberToInputValue(initiative.trafficInput));
    setPlannedBudget(numberToInputValue(initiative.plannedBudget));
    setRevenueGood(numberToInputValue(initiative.revenueScenarios?.good));
    setRevenueBetter(numberToInputValue(initiative.revenueScenarios?.better));
    setRevenueBest(numberToInputValue(initiative.revenueScenarios?.best));
    setBetterTouched(false);
    setBestTouched(false);
    setFieldErrors({});
    setSaveError(null);
  };

  const handleEdit = () => {
    resetForm();
    setEditing(true);
  };

  const handleCancel = () => {
    resetForm();
    setEditing(false);
  };

  const handleSave = async () => {
    // Client-side validation
    const errors: EditErrors = {};
    if (!name.trim()) errors.name = 'Name is required.';
    // The same rules as the Add form. A start date is required where it is
    // asked, except on a row that was saved unscheduled (migration 045),
    // which stays so until the user picks one.
    if (layout.start.shown && !activationDate && initiative.activationDate) errors.activationDate = 'Enter a start date.';
    if (layout.event.shown && layout.event.required && !eventDate) errors.eventDate = 'Enter an event date.';
    if (layout.event.shown && eventDate && activationDate && eventDate < activationDate) {
      errors.eventDate = "The event can't be before the start date.";
    }
    if (layout.close.shown && layout.close.required && !closeDate) errors.closeDate = `Enter a date for "${layout.close.label}".`;
    if (layout.close.shown && closeDate && activationDate && closeDate < activationDate) {
      errors.closeDate = "This can't be before the start date.";
    }
    if (layout.frequency.shown && !frequencyValue) errors.frequency = 'Choose how often it happens.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError(null);
      return;
    }

    const toNumber = (value: string) => {
      const parsed = Number(value);
      return isNaN(parsed) ? 0 : parsed;
    };

    /**
     * Dates are sent only when edited. This input is day-precision, so an
     * edited date is stored as 'day'; an untouched month-precision date is
     * left alone rather than silently becoming the 1st of the month.
     */
    // A hidden field is never sent, so the workbook hiding a date leaves the
    // stored one alone. Moving to ongoing is the exception: it has no event.
    const toOngoing = kindValue === 'evergreen' && initiative.kind !== 'evergreen';
    const activationChanged = layout.start.shown && activationDate !== toDateInputValue(initiative.activationDate);
    const eventChanged = layout.event.shown
      ? eventDate !== toDateInputValue(initiative.eventDate)
      : toOngoing && Boolean(initiative.eventDate);
    const closeChanged = layout.close.shown && closeDate !== toDateInputValue(initiative.revenueCloseDate);
    const frequencyToSave =
      kindValue !== 'recurring' ? null : layout.frequency.shown ? frequencyValue || null : layout.silentFrequency ?? (initiative.repeatFrequency ?? null);

    const dto: UpdateInitiativeDTO = {
      name: name.trim(),
      description: description.trim(),
      status: statusValue,
      // "" = "Select a type..." / "Select a product...": no type change, no product.
      ...(initiativeTypeId ? { initiativeTypeId } : {}),
      productId: productId || null,
      ...(activationChanged
        ? {
            activationDate: activationDate ? parseDateOnly(activationDate) : null,
            ...(activationDate ? { activationDatePrecision: 'day' as const } : {}),
          }
        : {}),
      ...(kindValue !== initiative.kind ? { kind: kindValue } : {}),
      ...(frequencyToSave !== (initiative.repeatFrequency ?? null) ? { repeatFrequency: frequencyToSave } : {}),
      ...(closeChanged ? { revenueCloseDate: closeDate ? parseDateOnly(closeDate) : null } : {}),
      ...(eventChanged
        ? {
            eventDate: layout.event.shown && eventDate ? parseDateOnly(eventDate) : null,
            ...(layout.event.shown && eventDate ? { eventDatePrecision: 'day' as const } : {}),
          }
        : {}),
      trafficInput: trafficInput === '' ? undefined : toNumber(trafficInput),
      plannedBudget: toNumber(plannedBudget),
      revenueScenarios: {
        good: toNumber(revenueGood),
        better: toNumber(revenueBetter),
        best: toNumber(revenueBest),
      },
    };

    setSaving(true);
    setSaveError(null);
    try {
      const updated = await initiativeService.updateInitiative(initiative.id, dto);
      onSaved(updated);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the initiative.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-labelledby="overview-heading">
      <div className="flex items-center justify-between gap-3">
        <h2 id="overview-heading" className="text-lg font-semibold text-[hsl(var(--foreground))]">
          Overview
        </h2>
        {canEdit && !editing && (
          <div className="flex items-center gap-3">
            <p id="overview-edit-hint" className="hidden text-sm text-[hsl(var(--foreground-muted))] sm:block">
              Click edit to edit the goals and details of your initiative.
            </p>
            <button
              type="button"
              onClick={handleEdit}
              aria-describedby="overview-edit-hint"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card px-3 py-1.5 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-4 space-y-5 rounded-[var(--radius-lg)] border border-border bg-card p-5">
          {saveError && (
            <div
              role="alert"
              className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
            >
              {saveError}
            </div>
          )}

          {/* Name */}
          <div className="space-y-1.5">
            <label htmlFor="overview-edit-name" className={labelClass}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="overview-edit-name"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              aria-invalid={fieldErrors.name ? true : undefined}
              className={inputClass}
              placeholder="Initiative name"
            />
            {fieldErrors.name && <p className={fieldErrorClass}>{fieldErrors.name}</p>}
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label htmlFor="overview-edit-description" className={labelClass}>
              Description
            </label>
            <textarea
              id="overview-edit-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              className={inputClass}
              placeholder="What is this initiative about?"
            />
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label htmlFor="overview-edit-status" className={labelClass}>
              Status
            </label>
            <select
              id="overview-edit-status"
              value={statusValue}
              onChange={e => setStatusValue(e.target.value as InitiativeStatus)}
              className={inputClass}
            >
              {Object.entries(statusStyles).map(([value, style]) => (
                <option key={value} value={value}>
                  {style.label}
                </option>
              ))}
            </select>
            <p className={helperClass}>
              Status is normally derived from task completion and may be recalculated automatically.
            </p>
          </div>

          {/* Type + Product */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="overview-edit-type" className={labelClass}>
                Type
              </label>
              <select
                id="overview-edit-type"
                value={initiativeTypeId}
                onChange={e => setInitiativeTypeId(e.target.value)}
                className={inputClass}
              >
                <option value="">Select a type...</option>
                {initiativeTypes.map(type => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="overview-edit-product" className={labelClass}>
                Product
              </label>
              <select
                id="overview-edit-product"
                value={productId}
                onChange={e => setProductId(e.target.value)}
                className={inputClass}
              >
                <option value="">No product</option>
                {products.map(product => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* How it runs: the Add form's kind and frequency questions */}
          {(layout.kind.shown || layout.frequency.shown) && (
            <div className="grid gap-4 sm:grid-cols-2">
              {layout.kind.shown && (
                <div className="space-y-1.5">
                  <label htmlFor="overview-edit-kind" className={labelClass}>
                    Frequency
                  </label>
                  <select
                    id="overview-edit-kind"
                    value={kindValue}
                    onChange={e => setKindValue(e.target.value as InitiativeKind)}
                    className={inputClass}
                  >
                    {/* Keep a stored kind the record no longer allows selectable, so a save does not change it silently. */}
                    {!layout.kind.options.some(o => o.value === kindValue) && (
                      <option value={kindValue}>{kindLabels[kindValue] || kindValue}</option>
                    )}
                    {layout.kind.options.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}
              {layout.frequency.shown && (
                <div className="space-y-1.5">
                  <label htmlFor="overview-edit-frequency" className={labelClass}>
                    How often? <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="overview-edit-frequency"
                    value={frequencyValue}
                    onChange={e => setFrequencyValue(e.target.value)}
                    aria-invalid={fieldErrors.frequency ? true : undefined}
                    className={inputClass}
                  >
                    <option value="">Choose…</option>
                    {frequencyValue && !layout.frequency.options.some(o => o.value === frequencyValue) && (
                      <option value={frequencyValue}>{frequencyValue}</option>
                    )}
                    {layout.frequency.options.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  {fieldErrors.frequency && <p className={fieldErrorClass}>{fieldErrors.frequency}</p>}
                </div>
              )}
            </div>
          )}
          {/* Dates: the workbook's Start Date / Event Date columns decide which are asked, as on the Add form */}
          <div className="grid gap-4 sm:grid-cols-2">
            {layout.start.shown && (
              <div className="space-y-1.5">
                <label htmlFor="overview-edit-activation" className={labelClass}>
                  Start date {layout.start.required && <span className="text-red-500">*</span>}
                </label>
                <DateInput
                  id="overview-edit-activation"
                  value={activationDate}
                  onValueChange={setActivationDate}
                  aria-invalid={fieldErrors.activationDate ? true : undefined}
                  error={!!fieldErrors.activationDate}
                />
                <p className={helperClass}>When it starts producing.</p>
                {fieldErrors.activationDate && (
                  <p className={fieldErrorClass}>{fieldErrors.activationDate}</p>
                )}
              </div>
            )}
            {layout.event.shown && (
              <div className="space-y-1.5">
                <label htmlFor="overview-edit-event-date" className={labelClass}>
                  Event date {layout.event.required && <span className="text-red-500">*</span>}
                </label>
                <DateInput
                  id="overview-edit-event-date"
                  value={eventDate}
                  onValueChange={setEventDate}
                  aria-invalid={fieldErrors.eventDate ? true : undefined}
                  error={!!fieldErrors.eventDate}
                />
                {kindValue === 'recurring' && <p className={helperClass}>The first occurrence. Later occurrences follow the frequency.</p>}
                {!layout.event.required && kindValue !== 'recurring' && <p className={helperClass}>Leave empty to clear it.</p>}
                {fieldErrors.eventDate && <p className={fieldErrorClass}>{fieldErrors.eventDate}</p>}
              </div>
            )}
            {layout.close.shown && (
              <div className="space-y-1.5">
                <label htmlFor="overview-edit-close-date" className={labelClass}>
                  {layout.close.label} {layout.close.required && <span className="text-red-500">*</span>}
                </label>
                <DateInput
                  id="overview-edit-close-date"
                  value={closeDate}
                  onValueChange={setCloseDate}
                  aria-invalid={fieldErrors.closeDate ? true : undefined}
                  error={!!fieldErrors.closeDate}
                />
                {fieldErrors.closeDate && <p className={fieldErrorClass}>{fieldErrors.closeDate}</p>}
              </div>
            )}
          </div>
          {/* Traffic input */}
          <div className="space-y-1.5">
            <label htmlFor="overview-edit-traffic" className={labelClass}>
              Expected registrants
            </label>
            <NumberInputRaw
              id="overview-edit-traffic"
              value={trafficInput}
              onValueChange={setTrafficInput}
              className={inputClass}
              placeholder="0"
            />
          </div>

          {/* Budget */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="overview-edit-planned-budget" className={labelClass}>
                Planned budget ($)
              </label>
              <NumberInputRaw
              id="overview-edit-planned-budget"
              value={plannedBudget}
              onValueChange={setPlannedBudget}
                className={inputClass}
                placeholder="0"
              />
            </div>

            {/* D2: read-only, derived from recorded expenses. Plain text, not a disabled input. */}
            <dl className="space-y-1.5">
              <dt className={labelClass}>Actual spend (from expenses)</dt>
              <dd className="py-2 text-sm font-medium text-[hsl(var(--foreground))] tabular-nums">
                {expenseSpend === null ? 'Loading…' : pickMoneyFormatter([expenseSpend])(expenseSpend)}
              </dd>
              <dd className={helperClass}>Record spending under Results › Expenses.</dd>
            </dl>
          </div>

          {/* Revenue scenarios */}
          <fieldset className="space-y-3">
            <legend className={labelClass}>Revenue scenarios ($)</legend>
            <p className={helperClass}>
              Better and Best fill in from Good (+10% and +20%). You can change them.
              {initiative.kind === 'recurring' && ' For a recurring initiative these are the total across all its occurrences in the plan.'}
            </p>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label htmlFor="overview-edit-revenue-good" className={helperClass}>
                  Good
                </label>
                <NumberInputRaw
              id="overview-edit-revenue-good"
              value={revenueGood}
              onValueChange={handleGoodChange}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="overview-edit-revenue-better" className={helperClass}>
                  Better (+10%)
                </label>
                <NumberInputRaw
              id="overview-edit-revenue-better"
              value={revenueBetter}
              onValueChange={v => { setBetterTouched(true); setRevenueBetter(v); }}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="overview-edit-revenue-best" className={helperClass}>
                  Best (+20%)
                </label>
                <NumberInputRaw
              id="overview-edit-revenue-best"
              value={revenueBest}
              onValueChange={v => { setBestTouched(true); setRevenueBest(v); }}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
            </div>
          </fieldset>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              className="rounded-[var(--radius-md)] border border-border bg-background px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--foreground-muted))] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              // Wait for the record's rules, so the fields saved are the ones shown.
              disabled={saving || !formConfig}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          {/* Left column: key details */}
          <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-5">
            {/* Status */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--foreground-muted))]">Status</span>
              <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${status.bg} ${status.text}`}>
                {status.label}
              </span>
            </div>

            {/* Type */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
                <Tag className="h-3.5 w-3.5" />
                Type
              </span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                {initiativeType?.name || (initiative.initiativeTypeId ? 'Unknown' : 'None')}
              </span>
            </div>

            {/* Kind */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
                <Zap className="h-3.5 w-3.5" />
                Kind
              </span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                {kindLabels[initiative.kind] || initiative.kind}
                {frequencyLabel && ` · ${frequencyLabel}`}
              </span>
            </div>

            {/* Revenue: the plan total, and for recurring work what each run earns */}
            <div className="flex items-start justify-between gap-4">
              <span className="text-sm text-[hsl(var(--foreground-muted))]">
                Revenue goal{runFigures ? ' (all occurrences)' : ''}
              </span>
              <span className="text-right text-sm font-medium text-[hsl(var(--foreground))]">
                {formatMoney(initiative.revenueScenarios?.better ?? 0)}
                <span className="block text-xs font-normal text-[hsl(var(--foreground-muted))]">
                  Better · Good {formatMoney(initiative.revenueScenarios?.good ?? 0)} · Best{' '}
                  {formatMoney(initiative.revenueScenarios?.best ?? 0)}
                </span>
              </span>
            </div>
            {runFigures && (
              <div className="flex items-start justify-between gap-4">
                <span className="text-sm text-[hsl(var(--foreground-muted))]">Per occurrence</span>
                <span className="text-right text-sm font-medium text-[hsl(var(--foreground))]">
                  {formatMoney(Math.round(runFigures.better))}
                  <span className="block text-xs font-normal text-[hsl(var(--foreground-muted))]">
                    {runFigures.runs} occurrence{runFigures.runs !== 1 ? 's' : ''} in the plan
                    {monthlyBetter !== null && ` · ≈ ${formatMoney(Math.round(monthlyBetter))} a month`}
                  </span>
                </span>
              </div>
            )}

            {/* Product */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
                <Package className="h-3.5 w-3.5" />
                Product
              </span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                {productName || 'None'}
              </span>
            </div>

            {/* Activation date */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />
                Start date
              </span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                {initiative.activationDate
                  ? formatScheduleDate(initiative.activationDate, initiative.activationDatePrecision)
                  : 'Not set'}
              </span>
            </div>

            {/* Event date */}
            {initiative.eventDate && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5" />
                  Event Date
                </span>
                <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                  {formatScheduleDate(initiative.eventDate, initiative.eventDatePrecision)}
                </span>
              </div>
            )}
            {/* Revenue close (migration 045): only rows the new intake wrote carry one. */}
            {initiative.revenueCloseDate && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5" />
                  Revenue closes
                </span>
                <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                  {formatDate(initiative.revenueCloseDate)}
                </span>
              </div>
            )}

            {/* Traffic Input */}
            {initiative.trafficInput && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-[hsl(var(--foreground-muted))]">
                  Expected Registrants
                </span>
                <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                  {formatNumber(initiative.trafficInput)}
                </span>
              </div>
            )}
          </div>

          {/* Right column: description */}
          <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Description</h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
              {initiative.description || 'No description provided.'}
            </p>

            {/* Date range summary */}
            <div className="mt-4 pt-4 border-t border-border">
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-2">Date Range</h3>
              <div className="flex items-center gap-3 text-sm text-[hsl(var(--foreground-muted))]">
                <span>
                  {initiative.activationDate
                    ? formatScheduleDate(initiative.activationDate, initiative.activationDatePrecision)
                    : 'Unscheduled'}
                </span>
                {initiative.eventDate && (
                  <>
                    <span className="text-[hsl(var(--border-strong))]">→</span>
                    <span>{formatScheduleDate(initiative.eventDate, initiative.eventDatePrecision)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
