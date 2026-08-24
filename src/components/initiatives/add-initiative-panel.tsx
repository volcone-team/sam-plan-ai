'use client';

import { useState } from 'react';
import {
  X,
  ArrowLeft,
  Plus,
  Calendar,
  Users,
} from 'lucide-react';
import type { InitiativeType, CreateInitiativeDTO, InitiativeKind } from '@/types';

export interface AddInitiativePanelProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (dto: CreateInitiativeDTO) => Promise<void>;
  initiativeTypes: InitiativeType[];
  products: Array<{ id: string; name: string }>;
  companyId: string;
  annualPlanId: string;
}

type PanelStep = 'pick-type' | 'configure';

/**
 * Slide-over panel for adding a new initiative.
 * Two-step flow: pick initiative type → configure details.
 */
export function AddInitiativePanel({
  open,
  onClose,
  onSubmit,
  initiativeTypes,
  products,
  companyId,
  annualPlanId,
}: AddInitiativePanelProps) {
  const [step, setStep] = useState<PanelStep>('pick-type');
  const [selectedType, setSelectedType] = useState<InitiativeType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
    setStep('pick-type');
    setSelectedType(null);
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

  const handleTypeSelect = (type: InitiativeType) => {
    setSelectedType(type);
    setName(type.name);
    setStep('configure');
  };

  const handleBack = () => {
    setStep('pick-type');
    setSelectedType(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedType || !name) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const dto: CreateInitiativeDTO = {
        companyId,
        annualPlanId,
        initiativeTypeId: selectedType.id,
        productId: productId || products[0]?.id || '',
        name,
        kind,
        activationDate: activationDate ? new Date(activationDate) : new Date(),
        eventDate: eventDateMode === 'exact' && eventDate
          ? new Date(eventDate)
          : eventDateMode === 'month' && eventMonth
            ? new Date(`${eventYear}-${eventMonth.padStart(2, '0')}-15`)
            : undefined,
        trafficInput: trafficInput ? parseInt(trafficInput, 10) : undefined,
        plannedBudget: plannedBudget ? parseFloat(plannedBudget) : 0,
        revenueScenarios: {
          good: initiativeTarget ? parseFloat(initiativeTarget) : 0,
          better: initiativeTarget ? Math.round(parseFloat(initiativeTarget) * 1.1) : 0,
          best: initiativeTarget ? Math.round(parseFloat(initiativeTarget) * 1.25) : 0,
        },
      };
      await onSubmit(dto);
      handleClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not save the initiative.');
    } finally {
      setSubmitting(false);
    }
  };

  const difficultyLabel = (type: InitiativeType) => {
    const avg =
      (type.difficulty.effortToImplement +
        type.difficulty.skillExpertiseRequired +
        type.difficulty.timeToResults +
        type.difficulty.costToRun) /
      4;
    if (avg <= 3) return 'Easy';
    if (avg <= 6) return 'Moderate';
    return 'Complex';
  };

  if (!open) return null;

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
                : `Configure: ${selectedType?.name}`}
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
            <div className="space-y-4">
              <p className="text-sm text-[hsl(var(--foreground-muted))]">
                Choose an initiative type to add to your plan.
              </p>

              {/* Custom initiative option */}
              <button
                onClick={() => {
                  const customType: InitiativeType = {
                    id: 'custom-' + Date.now(),
                    name: 'Custom Initiative',
                    channel: 'custom',
                    description: 'Create a custom initiative with your own settings',
                    owner: 'user',
                    benchmarks: {},
                    projectTemplate: { tasks: [], totalEstimatedHours: 0 },
                    difficulty: { effortToImplement: 5, skillExpertiseRequired: 5, timeToResults: 5, costToRun: 5 },
                    aiContext: { description: '', sizingGuidance: '', recommendationWeights: {} },
                    tier: 1,
                    displayOrder: 999,
                    isActive: true,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                  };
                  handleTypeSelect(customType);
                }}
                className="group flex w-full items-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-border bg-background p-4 text-left transition-all hover:border-[hsl(var(--primary))] hover:shadow-sm"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[hsl(var(--background-muted))] group-hover:bg-[hsl(var(--primary)_/_0.1)]">
                  <Plus className="h-4 w-4 text-[hsl(var(--foreground-muted))] group-hover:text-[hsl(var(--primary))]" />
                </div>
                <div>
                  <span className="font-medium text-[hsl(var(--foreground))] group-hover:text-[hsl(var(--primary))]">
                    Custom Initiative
                  </span>
                  <p className="text-xs text-[hsl(var(--foreground-muted))]">
                    Create your own initiative type
                  </p>
                </div>
              </button>

              {/* Initiative types list */}
              <div className="grid gap-3">
                {initiativeTypes.filter(t => t.isActive).map(type => (
                  <button
                    key={type.id}
                    onClick={() => handleTypeSelect(type)}
                    className="group flex items-start gap-4 rounded-[var(--radius-lg)] border border-border bg-background p-4 text-left transition-all hover:border-[hsl(var(--primary))] hover:shadow-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[hsl(var(--foreground))] group-hover:text-[hsl(var(--primary))] transition-colors">
                          {type.name}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-[hsl(var(--background-muted))] px-2 py-0.5 text-[10px] font-medium text-[hsl(var(--foreground-muted))]">
                          {difficultyLabel(type)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))] line-clamp-2">
                        {type.description}
                      </p>
                    </div>
                    <Plus className="h-5 w-5 flex-shrink-0 text-[hsl(var(--foreground-muted))] group-hover:text-[hsl(var(--primary))] transition-colors" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 'configure' && selectedType && (
            <form id="add-initiative-form" onSubmit={handleSubmit} className="space-y-5">
              {submitError && (
                <div role="alert" className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  {submitError}
                </div>
              )}
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
                      <input
                        id="init-actual-revenue"
                        type="number"
                        min="0"
                        value={actualRevenue}
                        onChange={e => setActualRevenue(e.target.value)}
                        placeholder="0"
                        className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="init-actual-spend" className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
                        Actual spend ($)
                      </label>
                      <input
                        id="init-actual-spend"
                        type="number"
                        min="0"
                        value={actualSpend}
                        onChange={e => setActualSpend(e.target.value)}
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
                <input
                  id="init-activation"
                  type="date"
                  value={activationDate}
                  onChange={e => setActivationDate(e.target.value)}
                  className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
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
                    <input
                      id="init-event-date"
                      type="date"
                      value={eventDate}
                      onChange={e => setEventDate(e.target.value)}
                      className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
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
                  <input
                    id="init-product-price"
                    type="number"
                    min="0"
                    value={productPrice}
                    onChange={e => setProductPrice(e.target.value)}
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
                  <input
                    id="init-traffic"
                    type="number"
                    min="0"
                    value={trafficInput}
                    onChange={e => setTrafficInput(e.target.value)}
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
                      <input
                        type="number"
                        value={exp.amount}
                        onChange={e => {
                          const updated = [...otherExpenses];
                          updated[idx] = { ...updated[idx], amount: e.target.value };
                          setOtherExpenses(updated);
                        }}
                        placeholder="$0"
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
                    <label className="text-[11px] font-medium text-[hsl(var(--foreground))]">Initiative Target ($)</label>
                    <input
                      type="number"
                      min="0"
                      value={initiativeTarget}
                      onChange={e => setInitiativeTarget(e.target.value)}
                      placeholder="Enter your target revenue"
                      className="w-full rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-[hsl(var(--foreground-muted))]">Better ($)</label>
                    <input
                      type="text"
                      readOnly
                      value={initiativeTarget ? Math.round(parseFloat(initiativeTarget) * 1.1).toLocaleString() : ''}
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
                      value={initiativeTarget ? Math.round(parseFloat(initiativeTarget) * 1.25).toLocaleString() : ''}
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

              {/* Tracking Metrics */}
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
            </form>
          )}
        </div>

        {/* Footer (only on configure step) */}
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
