'use client';
import { formatDate } from "@/lib/format-date";

import { useState } from 'react';
import { Calendar, Package, Tag, Clock, Zap, Pencil, Loader2 } from 'lucide-react';
import type { Initiative, InitiativeStatus, UpdateInitiativeDTO } from '@/types';
import type { InitiativeType } from '@/types/initiative-type.types';
import { initiativeService } from '@/services/initiative.service';
import { usePermission } from '@/hooks/use-permission';

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

const inputClass =
  'w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] placeholder:text-[hsl(var(--foreground-muted))]';
const labelClass = 'text-sm font-medium text-[hsl(var(--foreground))]';
const helperClass = 'text-xs text-[hsl(var(--foreground-muted))]';
const fieldErrorClass = 'text-xs text-red-600 dark:text-red-400';

/** Date → yyyy-mm-dd for <input type="date">, matching the stored (UTC) date value. */
function toDateInputValue(date: Date | string | undefined | null): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
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
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; activationDate?: string }>({});

  // Form state
  const [name, setName] = useState(initiative.name);
  const [description, setDescription] = useState(initiative.description || '');
  const [statusValue, setStatusValue] = useState<InitiativeStatus>(initiative.status);
  const [initiativeTypeId, setInitiativeTypeId] = useState(initiative.initiativeTypeId || '');
  const [productId, setProductId] = useState(initiative.productId || '');
  const [activationDate, setActivationDate] = useState(toDateInputValue(initiative.activationDate));
  const [eventDate, setEventDate] = useState(toDateInputValue(initiative.eventDate));
  const [trafficInput, setTrafficInput] = useState(numberToInputValue(initiative.trafficInput));
  const [plannedBudget, setPlannedBudget] = useState(numberToInputValue(initiative.plannedBudget));
  const [actualSpend, setActualSpend] = useState(numberToInputValue(initiative.actualSpend));
  const [revenueGood, setRevenueGood] = useState(numberToInputValue(initiative.revenueScenarios?.good));
  const [revenueBetter, setRevenueBetter] = useState(numberToInputValue(initiative.revenueScenarios?.better));
  const [revenueBest, setRevenueBest] = useState(numberToInputValue(initiative.revenueScenarios?.best));

  /** Reset form state back to the current initiative values. */
  const resetForm = () => {
    setName(initiative.name);
    setDescription(initiative.description || '');
    setStatusValue(initiative.status);
    setInitiativeTypeId(initiative.initiativeTypeId || '');
    setProductId(initiative.productId || '');
    setActivationDate(toDateInputValue(initiative.activationDate));
    setEventDate(toDateInputValue(initiative.eventDate));
    setTrafficInput(numberToInputValue(initiative.trafficInput));
    setPlannedBudget(numberToInputValue(initiative.plannedBudget));
    setActualSpend(numberToInputValue(initiative.actualSpend));
    setRevenueGood(numberToInputValue(initiative.revenueScenarios?.good));
    setRevenueBetter(numberToInputValue(initiative.revenueScenarios?.better));
    setRevenueBest(numberToInputValue(initiative.revenueScenarios?.best));
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
    const errors: { name?: string; activationDate?: string } = {};
    if (!name.trim()) errors.name = 'Name is required.';
    if (!activationDate) errors.activationDate = 'Activation date is required.';
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setSaveError(null);
      return;
    }

    const toNumber = (value: string) => {
      const parsed = Number(value);
      return isNaN(parsed) ? 0 : parsed;
    };

    const dto: UpdateInitiativeDTO = {
      name: name.trim(),
      description: description.trim(),
      status: statusValue,
      initiativeTypeId,
      productId,
      activationDate: new Date(activationDate),
      eventDate: eventDate ? new Date(eventDate) : null,
      trafficInput: trafficInput === '' ? undefined : toNumber(trafficInput),
      plannedBudget: toNumber(plannedBudget),
      actualSpend: toNumber(actualSpend),
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
          <button
            type="button"
            onClick={handleEdit}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-card px-3 py-1.5 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </button>
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
                <option value="">Select a product...</option>
                {products.map(product => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Dates */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="overview-edit-activation" className={labelClass}>
                Activation date <span className="text-red-500">*</span>
              </label>
              <input
                id="overview-edit-activation"
                type="date"
                value={activationDate}
                onChange={e => setActivationDate(e.target.value)}
                aria-invalid={fieldErrors.activationDate ? true : undefined}
                className={inputClass}
              />
              {fieldErrors.activationDate && (
                <p className={fieldErrorClass}>{fieldErrors.activationDate}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="overview-edit-event-date" className={labelClass}>
                Event date
              </label>
              <input
                id="overview-edit-event-date"
                type="date"
                value={eventDate}
                onChange={e => setEventDate(e.target.value)}
                className={inputClass}
              />
              <p className={helperClass}>Leave empty to clear it.</p>
            </div>
          </div>

          {/* Traffic input */}
          <div className="space-y-1.5">
            <label htmlFor="overview-edit-traffic" className={labelClass}>
              Expected registrants
            </label>
            <input
              id="overview-edit-traffic"
              type="number"
              min="0"
              value={trafficInput}
              onChange={e => setTrafficInput(e.target.value)}
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
              <input
                id="overview-edit-planned-budget"
                type="number"
                min="0"
                value={plannedBudget}
                onChange={e => setPlannedBudget(e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="overview-edit-actual-spend" className={labelClass}>
                Actual spend ($)
              </label>
              <input
                id="overview-edit-actual-spend"
                type="number"
                min="0"
                value={actualSpend}
                onChange={e => setActualSpend(e.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </div>
          </div>

          {/* Revenue scenarios */}
          <fieldset className="space-y-3">
            <legend className={labelClass}>Revenue scenarios ($)</legend>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label htmlFor="overview-edit-revenue-good" className={helperClass}>
                  Good
                </label>
                <input
                  id="overview-edit-revenue-good"
                  type="number"
                  min="0"
                  value={revenueGood}
                  onChange={e => setRevenueGood(e.target.value)}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="overview-edit-revenue-better" className={helperClass}>
                  Better
                </label>
                <input
                  id="overview-edit-revenue-better"
                  type="number"
                  min="0"
                  value={revenueBetter}
                  onChange={e => setRevenueBetter(e.target.value)}
                  className={inputClass}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="overview-edit-revenue-best" className={helperClass}>
                  Best
                </label>
                <input
                  id="overview-edit-revenue-best"
                  type="number"
                  min="0"
                  value={revenueBest}
                  onChange={e => setRevenueBest(e.target.value)}
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
              disabled={saving}
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
                {initiativeType?.name || 'Unknown'}
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
              </span>
            </div>

            {/* Product */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
                <Package className="h-3.5 w-3.5" />
                Product
              </span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                {productName}
              </span>
            </div>

            {/* Activation date */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-[hsl(var(--foreground-muted))] flex items-center gap-2">
                <Clock className="h-3.5 w-3.5" />
                Activation
              </span>
              <span className="text-sm font-medium text-[hsl(var(--foreground))]">
                {formatDate(initiative.activationDate)}
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
                  {formatDate(initiative.eventDate)}
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
                  {initiative.trafficInput.toLocaleString()}
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
                <span>{formatDate(initiative.activationDate)}</span>
                {initiative.eventDate && (
                  <>
                    <span className="text-[hsl(var(--border-strong))]">→</span>
                    <span>{formatDate(initiative.eventDate)}</span>
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
