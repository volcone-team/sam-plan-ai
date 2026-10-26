'use client';

import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { DateInput } from '@/components/ui/date-input';
import { NumberInputRaw } from '@/components/ui/number-input';
import type { CreateInitiativeRequest } from '@/lib/initiatives/create-request';
import {
  bookingStatusWritten,
  categoryLabel,
  fieldExtraType,
  type FieldExtra,
  type LibraryRecordConfig,
} from '@/lib/intake-v3/library-config';
import { isLeadsPath } from '@/lib/intake-v3/revenue';
import {
  CORE_GROUP_ID,
  schemaErrorKey,
  schemaFor,
  schemaOptions,
  visibleSchemaGroups,
  type SchemaDate,
  type SchemaField,
} from '@/lib/intake-v3/category-schemas';
import type { PickerItem } from '@/lib/intake-v3/picker';
import {
  NO_PROMOTION_WARNING,
  attachedBlockIds,
  boundExtra,
  buildCreateRequest,
  cartOpensHint,
  closeDateLabel,
  extraErrorKey,
  ownExtras,
  setExtraAnswer,
  commissionPreview,
  draftErrors,
  draftHandoffParty,
  draftWarnings,
  layoutFor,
  marketingReveals,
  setDraftKind,
  projectedScenarios,
  type DraftDate,
  type IntakeDraft,
} from '@/lib/intake-v3/universal-form';
import { handoffOptions, handoffWarnings, type HandoffInitiative } from '@/lib/initiatives/lead-handoff';
import {
  AD_PLATFORM_OPTIONS,
  BOOKING_OPTIONS,
  COMMISSION_BASIS_OPTIONS,
  FORMAT_OPTIONS,
  PROMOTION_OPTIONS,
  PROMO_SEND_OPTIONS,
  RECRUITMENT_OPTIONS,
  YES_NO_OPTIONS,
  amountInput,
  bookingHelp,
  commissionRateLabel,
  commissionView,
  fromYesNo,
  toYesNo,
  toggleIn,
  errorDomId,
  fieldDomId,
  formStartDraft,
  frequencyOptions,
  kindOptions,
  moneyOrDash,
  noPromotionBody,
  NO_PROMOTION_ACTIONS,
  clearNoPromotion,
  promoteBySomeoneElse,
  showNoPromotionWarning,
  pathOptions,
  revenueView,
  setDatePrecision,
  togglePromotion,
  type Option,
} from './intake-form-view';

export interface IntakeFormProps {
  item: PickerItem;
  config: LibraryRecordConfig;
  products: Array<{ id: string; name: string }>;
  annualPlanId: string;
  /**
   * The plan's year. An ongoing initiative's close date defaults to 31
   * December of it (else of the start date's year).
   */
  planYear?: number | null;
  onBack: () => void;
  /** Posted to POST /api/initiatives by the caller. */
  onSubmit: (request: CreateInitiativeRequest) => Promise<void>;
  submitting?: boolean;
  error?: string | null;
  /**
   * The company's already-loaded initiatives, offered by the lead-handoff
   * block's "Where do these leads go?". Only those in `annualPlanId` are listed.
   */
  handoffTargets?: readonly HandoffInitiative[];
}

const INPUT_CLASS =
  'w-full rounded-[var(--radius-md)] border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] placeholder:text-[hsl(var(--foreground-muted))]';
const LABEL_CLASS = 'text-sm font-medium text-[hsl(var(--foreground))]';
const HINT_CLASS = 'text-xs text-[hsl(var(--foreground-muted))]';
const SECTION_CLASS = 'space-y-4 border-t border-border pt-4 first:border-t-0 first:pt-0';
const SECTION_HEADING_CLASS = 'text-sm font-semibold text-[hsl(var(--foreground))]';

const borderFor = (invalid: boolean) =>
  invalid ? 'border-[hsl(var(--invalid-border))]' : 'border-border';

/**
 * The universal initiative form for the new Initiative Intake.
 *
 * Renders, in the universal order, only what `layoutFor` says renders:
 * identity, shape (kind / format / conversion path / frequency), dates (with
 * the cart block's "Cart opens"), revenue, the partner / VIP / affiliate
 * blocks, promotion (with its answer-gated reveals), expenses and notes. It
 * holds no layout rule of its own: blocks come from `attachedBlockIds(layout)`,
 * reveals from `marketingReveals`; validation is `draftErrors`, the request is
 * `buildCreateRequest`.
 *
 * Errors show inline only after the first submit attempt. Warnings never
 * block saving. Mounted by AddInitiativePanel.
 */
export function IntakeForm({
  item,
  config,
  products,
  annualPlanId,
  planYear = null,
  onBack,
  onSubmit,
  submitting = false,
  error = null,
  handoffTargets = [],
}: IntakeFormProps) {
  const [draft, setDraft] = useState<IntakeDraft>(() => formStartDraft(item, config, planYear));
  /** "No, nothing is promoting it": hides the warning for this draft only. */
  const [promotionWarningDismissed, setPromotionWarningDismissed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  /** Bumped on each failed submit, to move focus to the first invalid field. */
  const [failedSubmits, setFailedSubmits] = useState(0);
  /** A thrown onSubmit error, when the caller does not pass one in. */
  const [localError, setLocalError] = useState<string | null>(null);

  const base = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const promotionChipsRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => layoutFor(draft, config), [draft, config]);
  const errors = useMemo(() => draftErrors(draft, config), [draft, config]);
  const warnings = useMemo(() => draftWarnings(draft, config), [draft, config]);
  const projected = useMemo(() => projectedScenarios(draft, config), [draft, config]);
  const revenue = useMemo(() => revenueView(draft, config), [draft, config]);

  const shown = attempted ? errors : {};
  const update = (patch: Partial<IntakeDraft>) => setDraft(d => ({ ...d, ...patch }));
  const setDate = (key: keyof IntakeDraft['dates'], date: DraftDate) =>
    setDraft(d => ({ ...d, dates: { ...d.dates, [key]: date } }));

  useEffect(() => {
    if (failedSubmits === 0) return;
    // First invalid field in document order: an input, or a radio group's first radio.
    formRef.current
      ?.querySelector<HTMLElement>('[aria-invalid="true"], [data-invalid="true"] input')
      ?.focus();
  }, [failedSubmits]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setAttempted(true);
    setLocalError(null);
    if (Object.keys(errors).length > 0) {
      setFailedSubmits(n => n + 1);
      return;
    }
    try {
      await onSubmit(buildCreateRequest(draft, config, { annualPlanId }));
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not save the initiative.');
    }
  };

  const attachedBlocks = attachedBlockIds(layout);
  const reveals = marketingReveals(draft);
  const commission = commissionView(commissionPreview(draft, config));
  const setVip = (patch: Partial<IntakeDraft['vip']>) => setDraft(d => ({ ...d, vip: { ...d.vip, ...patch } }));
  const setAffiliate = (patch: Partial<IntakeDraft['affiliate']>) =>
    setDraft(d => ({ ...d, affiliate: { ...d.affiliate, ...patch } }));
  const setPromoPlan = (patch: Partial<IntakeDraft['promoPlan']>) =>
    setDraft(d => ({ ...d, promoPlan: { ...d.promoPlan, ...patch } }));
  const setCommission = (patch: Partial<IntakeDraft['commission']>) =>
    setDraft(d => ({ ...d, commission: { ...d.commission, ...patch } }));
  const showHost = attachedBlocks.has('partner-host');
  const showBooking = bookingStatusWritten(layout);
  const showRevenue = !isLeadsPath(layout.effectivePath);
  const showLeads = isLeadsPath(layout.effectivePath);
  const showHandoff = attachedBlocks.has('lead-handoff');
  const leads = draft.leads ?? { goal: null, handoffTo: null };
  const setLeads = (patch: Partial<NonNullable<IntakeDraft['leads']>>) =>
    setDraft(d => ({ ...d, leads: { goal: null, handoffTo: null, ...d.leads, ...patch } }));
  const handoffChoices = useMemo(
    () => handoffOptions(handoffTargets, { annualPlanId }),
    [handoffTargets, annualPlanId]
  );
  const handoffTarget = handoffTargets.find(t => t.id === leads.handoffTo) ?? null;
  const handoffNotes = showHandoff ? handoffWarnings(draftHandoffParty(draft), handoffTarget) : [];
  const schemaGroups = visibleSchemaGroups(schemaFor(draft.categoryId), draft, draft.libraryName, layout);
  const setAnswer = (key: string, value: unknown) =>
    setDraft(d => ({ ...d, category: { ...d.category, [key]: value } }));
  const extras = ownExtras(config);
  const cartBound = boundExtra(config, layout, 'cart.opens');
  const closeBound = boundExtra(config, layout, 'dates.close');
  const closeLabel = closeDateLabel(config, layout);
  const cartHint =
    cartBound?.hint ?? cartOpensHint(draft, config) ?? `The cart closes on the ${closeLabel.toLowerCase()} date.`;
  const errorCount = Object.keys(shown).length;
  /** Errors for fields not on screen, so they still have somewhere to show. */
  const unplacedErrors =
    layout.conversionPath.state === 'absent' && shown.conversionPath ? [shown.conversionPath] : [];
  const submitError = error ?? localError;

  const fieldProps = (key: string) => ({
    id: fieldDomId(base, key),
    'aria-invalid': shown[key] ? (true as const) : undefined,
    'aria-describedby': shown[key] ? errorDomId(base, key) : undefined,
  });
  const fieldError = (key: string) => <FieldError id={errorDomId(base, key)} message={shown[key]} />;

  /** One category schema field, on the same components as the universal fields. */
  const schemaField = (field: SchemaField) => {
    const key = schemaErrorKey(field.key);
    const raw = draft.category[field.key];
    const common = {
      tag: field.tag,
      hint: field.hint,
      errorId: errorDomId(base, key),
      error: shown[key],
    };
    switch (field.type) {
      case 'yesno':
        return (
          <ChoiceGroup
            key={field.key}
            name={fieldDomId(base, key)}
            legend={field.label}
            options={YES_NO_OPTIONS}
            value={toYesNo(typeof raw === 'boolean' ? raw : null)}
            onChange={v => setAnswer(field.key, fromYesNo(v))}
            {...common}
          />
        );
      case 'single':
        return (
          <ChoiceGroup
            key={field.key}
            name={fieldDomId(base, key)}
            legend={field.label}
            options={schemaOptions(field)}
            value={typeof raw === 'string' ? raw : null}
            onChange={v => setAnswer(field.key, v)}
            {...common}
          />
        );
      case 'multi': {
        const values = Array.isArray(raw) ? (raw as string[]) : [];
        return (
          <CheckGroup
            key={field.key}
            legend={field.label}
            options={schemaOptions(field)}
            values={values}
            onToggle={v => setAnswer(field.key, toggleIn(values, v))}
            {...common}
          />
        );
      }
      case 'text':
        return (
          <TextField
            key={field.key}
            id={fieldDomId(base, key)}
            label={field.label}
            placeholder={field.placeholder}
            value={typeof raw === 'string' ? raw : ''}
            onChange={v => setAnswer(field.key, v)}
            required={field.required}
            {...common}
          />
        );
      case 'number':
      case 'currency':
        return (
          <NumberField
            key={field.key}
            id={fieldDomId(base, key)}
            label={field.type === 'currency' ? `${field.label} ($)` : field.label}
            placeholder={field.placeholder}
            value={amountInput(typeof raw === 'number' || typeof raw === 'string' ? raw : null)}
            onChange={v => setAnswer(field.key, v === '' ? null : v)}
            required={field.required}
            {...common}
          />
        );
      case 'date': {
        const date: SchemaDate =
          raw && typeof raw === 'object' && 'precision' in raw ? (raw as SchemaDate) : { value: null, precision: 'day' };
        return (
          <DateField
            key={field.key}
            id={fieldDomId(base, key)}
            label={field.label}
            date={date}
            onChange={d => setAnswer(field.key, d)}
            required={field.required}
            {...common}
          />
        );
      }
    }
  };

  /** One of the record's own field extras. Answers live in draft.attrs[extra.key]. */
  const extraField = (extra: FieldExtra) => {
    const key = extraErrorKey(extra.key);
    const raw = draft.attrs[extra.key];
    const set = (value: unknown) => setDraft(d => setExtraAnswer(d, config, extra.key, value));
    const common = {
      id: fieldDomId(base, key),
      label: extra.label,
      hint: extra.hint,
      errorId: errorDomId(base, key),
      error: shown[key],
    };
    switch (fieldExtraType(extra)) {
      case 'number':
        return (
          <NumberField
            key={extra.key}
            {...common}
            value={amountInput(typeof raw === 'number' || typeof raw === 'string' ? raw : null)}
            onChange={v => set(v === '' ? null : v)}
          />
        );
      case 'date': {
        const date: DraftDate =
          raw && typeof raw === 'object' && 'precision' in raw ? (raw as DraftDate) : { value: null, precision: 'day' };
        return <DateField key={extra.key} {...common} date={date} onChange={set} />;
      }
      default:
        return (
          <TextField key={extra.key} {...common} value={typeof raw === 'string' ? raw : ''} onChange={set} />
        );
    }
  };

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-5" aria-labelledby={`${base}-heading`}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to initiatives"
          className="rounded-[var(--radius-md)] p-1.5 text-[hsl(var(--foreground-muted))] transition-colors hover:bg-background hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h2 id={`${base}-heading`} className="text-lg font-semibold text-[hsl(var(--foreground))]">
            New Initiative
          </h2>
          <p className={HINT_CLASS}>{categoryLabel(item.categoryId)}</p>
        </div>
      </div>

      {submitError && (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          {submitError}
        </div>
      )}
      {errorCount > 0 && (
        <div
          role="alert"
          className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
        >
          <p>{errorCount === 1 ? 'One field needs attention.' : `${errorCount} fields need attention.`}</p>
          {unplacedErrors.map(m => (
            <p key={m} className="mt-1">
              {m}
            </p>
          ))}
        </div>
      )}

      {/* 1 Identity */}
      <section className={SECTION_CLASS} aria-labelledby={`${base}-identity`}>
        <h3 id={`${base}-identity`} className="sr-only">
          Identity
        </h3>
        <div className="space-y-1.5">
          <label htmlFor={fieldDomId(base, 'name')} className={LABEL_CLASS}>
            Name <span className="text-red-500" aria-hidden="true">*</span>
          </label>
          <input
            {...fieldProps('name')}
            type="text"
            value={draft.name}
            onChange={e => update({ name: e.target.value })}
            aria-required="true"
            className={`${INPUT_CLASS} ${borderFor(!!shown.name)}`}
            placeholder="Initiative name"
          />
          {fieldError('name')}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={fieldDomId(base, 'product')} className={LABEL_CLASS}>
            Product
          </label>
          <select
            id={fieldDomId(base, 'product')}
            value={draft.productId ?? ''}
            onChange={e => update({ productId: e.target.value || null })}
            className={`${INPUT_CLASS} border-border`}
          >
            <option value="">Select a product (optional)...</option>
            {products.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* 2 Shape */}
      {(layout.kind.state === 'rendered' ||
        layout.format.state === 'rendered' ||
        layout.conversionPath.state === 'rendered' ||
        layout.frequency.state === 'rendered') && (
        <section className={SECTION_CLASS} aria-labelledby={`${base}-shape`}>
          <h3 id={`${base}-shape`} className={SECTION_HEADING_CLASS}>
            How it runs
          </h3>
          {layout.kind.state === 'rendered' && (
            <ChoiceGroup
              name={fieldDomId(base, 'kind')}
              legend="Frequency"
              options={kindOptions(config, layout)}
              value={draft.kind}
              onChange={kind => setDraft(d => setDraftKind(d, config, kind, planYear))}
              errorId={errorDomId(base, 'kind')}
              error={shown.kind}
            />
          )}
          {layout.format.state === 'rendered' && (
            <ChoiceGroup
              name={fieldDomId(base, 'format')}
              legend="Format"
              options={FORMAT_OPTIONS}
              value={draft.format}
              onChange={format => update({ format })}
              errorId={errorDomId(base, 'format')}
              error={shown.format}
            />
          )}
          {layout.conversionPath.state === 'rendered' && (
            <ChoiceGroup
              name={fieldDomId(base, 'conversionPath')}
              legend="What's the ask?"
              options={pathOptions(layout, draft.categoryId)}
              value={draft.conversionPath}
              onChange={conversionPath => update({ conversionPath })}
              errorId={errorDomId(base, 'conversionPath')}
              error={shown.conversionPath}
            />
          )}
          {layout.frequency.state === 'rendered' && (
            <ChoiceGroup
              name={fieldDomId(base, 'frequency')}
              legend="How often?"
              options={frequencyOptions(config)}
              value={draft.frequency}
              onChange={frequency => update({ frequency })}
              errorId={errorDomId(base, 'frequency')}
              error={shown.frequency}
            />
          )}
        </section>
      )}

      {/* 3 Category schema (CATEGORY_SCHEMA_SLOT): between Shape and Dates */}
      {(schemaGroups.length > 0 || extras.length > 0) && (
        <section className={SECTION_CLASS} aria-labelledby={`${base}-category`}>
          <h3 id={`${base}-category`} className={SECTION_HEADING_CLASS}>
            About this initiative
          </h3>
          {schemaGroups.map(({ group, fields }) =>
            group.id === CORE_GROUP_ID ? (
              <div key={group.id} className="space-y-4">
                {fields.map(schemaField)}
                {group.note && <p className={HINT_CLASS}>{group.note}</p>}
              </div>
            ) : (
              <fieldset key={group.id} className="space-y-3 rounded-[var(--radius-md)] border border-border p-3">
                <legend className={`${LABEL_CLASS} px-1`}>{group.title}</legend>
                {group.note && <p className={HINT_CLASS}>{group.note}</p>}
                {fields.map(schemaField)}
              </fieldset>
            )
          )}
          {/* The record's type extras: after the category fields, same section. */}
          {extras.length > 0 && <div className="space-y-4">{extras.map(extraField)}</div>}
        </section>
      )}

      {/* 4 Dates */}
      <section className={SECTION_CLASS} aria-labelledby={`${base}-dates`}>
        <h3 id={`${base}-dates`} className={SECTION_HEADING_CLASS}>
          Dates
        </h3>
        <DateField
          id={fieldDomId(base, 'dates.activation')}
          label="Start date"
          hint="When it starts producing."
          date={draft.dates.activation}
          onChange={d => setDate('activation', d)}
          errorId={errorDomId(base, 'dates.activation')}
          error={shown['dates.activation']}
          required
        />
        {layout.eventDate.state === 'rendered' && (
          <DateField
            id={fieldDomId(base, 'dates.event')}
            label="Event date"
            date={draft.dates.event}
            onChange={d => setDate('event', d)}
            errorId={errorDomId(base, 'dates.event')}
            error={shown['dates.event']}
            required={layout.effectiveKind === 'one-time'}
          />
        )}
        {/* Cart block: only "Cart opens" — the cart closes on the close date below.
            A bound extra relabels it; a deriving extra (pitch day) prefills it. */}
        {attachedBlocks.has('cart') && (
          <DateField
            id={fieldDomId(base, 'cart.opens')}
            label={cartBound?.label ?? 'Cart opens'}
            hint={cartHint}
            date={draft.cart.opens}
            onChange={opens => setDraft(d => ({ ...d, cart: { ...d.cart, opens } }))}
            errorId={errorDomId(base, 'cart.opens')}
            error={shown['cart.opens']}
            required
          />
        )}
        <DateField
          id={fieldDomId(base, 'dates.close')}
          label={closeLabel}
          hint={closeBound?.hint}
          date={draft.dates.close}
          onChange={d => setDate('close', d)}
          errorId={errorDomId(base, 'dates.close')}
          error={shown['dates.close']}
          required={layout.closeDate.required}
        />
      </section>

      {/* 5 Revenue */}
      {showRevenue && (
        <section className={SECTION_CLASS} aria-labelledby={`${base}-revenue`}>
          <div>
            <h3 id={`${base}-revenue`} className={SECTION_HEADING_CLASS}>
              Revenue goal
            </h3>
            <p className={HINT_CLASS}>Enter your Good target. Better and Best are calculated for you.</p>
          </div>
          {revenue.lines === null ? (
            <MoneyField
              id={fieldDomId(base, 'revenue.goal')}
              label="Good ($)"
              value={draft.revenue.goal === null ? '' : String(draft.revenue.goal)}
              onChange={v => setDraft(d => ({ ...d, revenue: { ...d.revenue, goal: v === '' ? null : v } }))}
              errorId={errorDomId(base, 'revenue.goal')}
              error={shown['revenue.goal']}
            />
          ) : (
            <div className="space-y-3">
              {revenue.lines.map(line => {
                const key = `revenue.lines.${line.id}`;
                return (
                  <MoneyField
                    key={line.id}
                    id={fieldDomId(base, key)}
                    label={`${line.label}: Good ($)`}
                    value={line.value}
                    onChange={v =>
                      setDraft(d => ({
                        ...d,
                        revenue: { ...d.revenue, lines: { ...d.revenue.lines, [line.id]: v === '' ? null : v } },
                      }))
                    }
                    errorId={errorDomId(base, key)}
                    error={shown[key]}
                  />
                );
              })}
            </div>
          )}
          <dl className="grid grid-cols-3 gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--background-muted))] px-3 py-2">
            {revenue.lines !== null && <Figure label="Total Good" value={moneyOrDash(revenue.good)} />}
            {revenue.lines === null && <Figure label="Good" value={moneyOrDash(revenue.good)} />}
            <Figure label="Better" value={moneyOrDash(revenue.better)} />
            <Figure label="Best" value={moneyOrDash(revenue.best)} />
          </dl>
        </section>
      )}

      {/* 5 Leads (the leads path's revenue slot): a lead count, and the lead-handoff block */}
      {showLeads && (
        <section className={SECTION_CLASS} aria-labelledby={`${base}-leads`}>
          <div>
            <h3 id={`${base}-leads`} className={SECTION_HEADING_CLASS}>
              Lead goal
            </h3>
            <p className={HINT_CLASS}>
              This one collects leads, so it runs at $0. The initiative that converts them books the revenue.
            </p>
          </div>
          <NumberField
            id={fieldDomId(base, 'leads.goal')}
            label="Lead goal"
            value={amountInput(leads.goal)}
            onChange={v => setLeads({ goal: v === '' ? null : v })}
            errorId={errorDomId(base, 'leads.goal')}
            error={shown['leads.goal']}
          />
          {showHandoff && (
            <div className="space-y-1.5">
              <label htmlFor={fieldDomId(base, 'leads.handoffTo')} className={LABEL_CLASS}>
                Where do these leads go?
              </label>
              <select
                id={fieldDomId(base, 'leads.handoffTo')}
                value={leads.handoffTo ?? ''}
                onChange={e => setLeads({ handoffTo: e.target.value || null })}
                className={`${INPUT_CLASS} border-border`}
              >
                <option value="">Decide later</option>
                {handoffChoices.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {handoffNotes.map(note => (
                <p key={note} role="status" className="flex gap-1.5 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {note}
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Partner block */}
      {(showHost || showBooking) && (
        <section className={SECTION_CLASS} aria-labelledby={`${base}-partner`}>
          <h3 id={`${base}-partner`} className={SECTION_HEADING_CLASS}>
            Partner
          </h3>
          {showHost && (
            <div className="space-y-1.5">
              <label htmlFor={fieldDomId(base, 'partner.host')} className={LABEL_CLASS}>
                {"Who's hosting?"}
              </label>
              <input
                id={fieldDomId(base, 'partner.host')}
                type="text"
                value={draft.partner.host ?? ''}
                onChange={e => setDraft(d => ({ ...d, partner: { ...d.partner, host: e.target.value || null } }))}
                className={`${INPUT_CLASS} border-border`}
                placeholder="Partner or event name"
              />
            </div>
          )}
          {showBooking && (
            <ChoiceGroup
              name={fieldDomId(base, 'partner.bookingStatus')}
              legend="Is it booked?"
              hint={bookingHelp(draft.partner.host)}
              options={BOOKING_OPTIONS}
              value={draft.partner.bookingStatus}
              onChange={bookingStatus => setDraft(d => ({ ...d, partner: { ...d.partner, bookingStatus } }))}
              errorId={errorDomId(base, 'partner.bookingStatus')}
              error={shown['partner.bookingStatus']}
            />
          )}
        </section>
      )}

      {/* VIP block */}
      {attachedBlocks.has('vip') && (
        <section className={SECTION_CLASS} aria-labelledby={`${base}-vip`}>
          <h3 id={`${base}-vip`} className={SECTION_HEADING_CLASS}>
            VIP tier
          </h3>
          <ChoiceGroup
            name={fieldDomId(base, 'vip.offered')}
            legend="Offering a VIP tier?"
            options={YES_NO_OPTIONS}
            value={toYesNo(draft.vip.offered)}
            onChange={v => setVip({ offered: fromYesNo(v) })}
            errorId={errorDomId(base, 'vip.offered')}
          />
          {draft.vip.offered === true && (
            <>
              <NumberField
                id={fieldDomId(base, 'vip.price')}
                label="Price ($)"
                value={amountInput(draft.vip.price)}
                onChange={v => setVip({ price: v === '' ? null : v })}
                errorId={errorDomId(base, 'vip.price')}
                error={shown['vip.price']}
                required
              />
              <NumberField
                id={fieldDomId(base, 'vip.capacity')}
                label="Capacity"
                value={amountInput(draft.vip.capacity)}
                onChange={v => setVip({ capacity: v === '' ? null : v })}
                errorId={errorDomId(base, 'vip.capacity')}
                error={shown['vip.capacity']}
              />
              <TextField
                id={fieldDomId(base, 'vip.included')}
                label="What's included"
                value={draft.vip.included}
                onChange={included => setVip({ included })}
              />
            </>
          )}
        </section>
      )}

      {/* Affiliate block */}
      {attachedBlocks.has('affiliate') && (
        <section className={SECTION_CLASS} aria-labelledby={`${base}-affiliate`}>
          <h3 id={`${base}-affiliate`} className={SECTION_HEADING_CLASS}>
            Affiliates
          </h3>
          <NumberField
            id={fieldDomId(base, 'affiliate.partnerCount')}
            label="Partner count"
            value={amountInput(draft.affiliate.partnerCount)}
            onChange={v => setAffiliate({ partnerCount: v === '' ? null : v })}
            errorId={errorDomId(base, 'affiliate.partnerCount')}
            error={shown['affiliate.partnerCount']}
          />
          <ChoiceGroup
            name={fieldDomId(base, 'affiliate.recruitment')}
            legend="Recruitment status"
            options={RECRUITMENT_OPTIONS}
            value={draft.affiliate.recruitment}
            onChange={recruitment => setAffiliate({ recruitment })}
            errorId={errorDomId(base, 'affiliate.recruitment')}
          />
          <TextField
            id={fieldDomId(base, 'affiliate.terms')}
            label="Commission terms"
            value={draft.affiliate.terms}
            onChange={terms => setAffiliate({ terms })}
          />
        </section>
      )}

      {/* Marketing */}
      <section className={SECTION_CLASS} aria-labelledby={`${base}-promotion`}>
        <fieldset className="space-y-2">
          <legend id={`${base}-promotion`} className={SECTION_HEADING_CLASS}>
            {"What's promoting it?"}
          </legend>
          <p className={HINT_CLASS}>Select all that apply.</p>
          <div ref={promotionChipsRef} className="flex flex-wrap gap-2">
            {PROMOTION_OPTIONS.map(option => {
              const checked = draft.promotedBy.includes(option.value);
              return (
                <label key={option.value} className={chipClass(checked)}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={checked}
                    onChange={() => update({ promotedBy: togglePromotion(draft.promotedBy, option.value) })}
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        {reveals.promoPlan && (
          <fieldset className="space-y-3 rounded-[var(--radius-md)] border border-border p-3">
            <legend className={`${LABEL_CLASS} px-1`}>Their promo plan</legend>
            <TextField
              id={fieldDomId(base, 'promoPlan.who')}
              label="Who is promoting"
              value={draft.promoPlan.who}
              onChange={who => setPromoPlan({ who })}
            />
            <CheckGroup
              legend="What they're sending"
              options={PROMO_SEND_OPTIONS}
              values={draft.promoPlan.sending}
              onToggle={v => setPromoPlan({ sending: toggleIn(draft.promoPlan.sending, v) })}
            />
            <NumberField
              id={fieldDomId(base, 'promoPlan.sends')}
              label="How many sends"
              value={amountInput(draft.promoPlan.sends)}
              onChange={v => setPromoPlan({ sends: v === '' ? null : v })}
              errorId={errorDomId(base, 'promoPlan.sends')}
              error={shown['promoPlan.sends']}
            />
          </fieldset>
        )}
        {reveals.ads && (
          <fieldset className="space-y-3 rounded-[var(--radius-md)] border border-border p-3">
            <legend className={`${LABEL_CLASS} px-1`}>Ads</legend>
            <CheckGroup
              legend="Ad platforms"
              options={AD_PLATFORM_OPTIONS}
              values={draft.adPlatforms}
              onToggle={v => update({ adPlatforms: toggleIn(draft.adPlatforms, v) })}
            />
            <NumberField
              id={fieldDomId(base, 'plannedBudget')}
              label="Ad budget ($)"
              hint="One figure across all platforms."
              value={amountInput(draft.plannedBudget)}
              onChange={v => update({ plannedBudget: v === '' ? null : v })}
              errorId={errorDomId(base, 'plannedBudget')}
              error={shown.plannedBudget}
            />
          </fieldset>
        )}
        <ChoiceGroup
          name={fieldDomId(base, 'funnels.optin')}
          legend="New opt-in funnel?"
          options={YES_NO_OPTIONS}
          value={toYesNo(draft.funnels.optin)}
          onChange={v => setDraft(d => ({ ...d, funnels: { ...d.funnels, optin: fromYesNo(v) } }))}
          errorId={errorDomId(base, 'funnels.optin')}
        />
        <ChoiceGroup
          name={fieldDomId(base, 'funnels.sales')}
          legend="New sales funnel?"
          options={YES_NO_OPTIONS}
          value={toYesNo(draft.funnels.sales)}
          onChange={v => setDraft(d => ({ ...d, funnels: { ...d.funnels, sales: fromYesNo(v) } }))}
          errorId={errorDomId(base, 'funnels.sales')}
        />
        {showNoPromotionWarning(!!warnings.promotion, promotionWarningDismissed) && projected && (
          <div
            role="status"
            className="flex gap-2 rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-medium">{NO_PROMOTION_WARNING}</p>
              <p className="mt-0.5 text-xs">{noPromotionBody(draft.name, projected.good)}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => update({ promotedBy: promoteBySomeoneElse(draft.promotedBy) })}
                  className="rounded-[var(--radius-md)] bg-amber-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-amber-600 dark:hover:bg-amber-500"
                >
                  {NO_PROMOTION_ACTIONS.someoneElse}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    update({ promotedBy: clearNoPromotion(draft.promotedBy) });
                    promotionChipsRef.current?.querySelector<HTMLInputElement>('input')?.focus();
                  }}
                  className="rounded-[var(--radius-md)] border border-amber-300 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-amber-800 dark:hover:bg-amber-900/40"
                >
                  {NO_PROMOTION_ACTIONS.ownChannel}
                </button>
                <button
                  type="button"
                  onClick={() => setPromotionWarningDismissed(true)}
                  className="text-xs font-medium underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {NO_PROMOTION_ACTIONS.dismiss}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Expenses */}
      <section className={SECTION_CLASS} aria-labelledby={`${base}-expenses`}>
        <h3 id={`${base}-expenses`} className={SECTION_HEADING_CLASS}>
          Expenses
        </h3>
        <ChoiceGroup
          name={fieldDomId(base, 'commission.offered')}
          legend="Is there a sales commission?"
          options={YES_NO_OPTIONS}
          value={toYesNo(draft.commission.offered)}
          onChange={v => setCommission({ offered: fromYesNo(v) })}
          errorId={errorDomId(base, 'commission.offered')}
        />
        {draft.commission.offered === true && (
          <>
            <ChoiceGroup
              name={fieldDomId(base, 'commission.basis')}
              legend="Basis"
              options={COMMISSION_BASIS_OPTIONS}
              value={draft.commission.basis}
              onChange={basis => setCommission({ basis })}
              errorId={errorDomId(base, 'commission.basis')}
              error={shown['commission.basis']}
            />
            <NumberField
              id={fieldDomId(base, 'commission.rate')}
              label={commissionRateLabel(draft.commission.basis)}
              value={amountInput(draft.commission.rate)}
              onChange={v => setCommission({ rate: v === '' ? null : v })}
              errorId={errorDomId(base, 'commission.rate')}
              error={shown['commission.rate']}
              required
            />
            {commission && 'note' in commission && <p className={HINT_CLASS}>{commission.note}</p>}
            {commission && 'good' in commission && (
              <dl
                aria-label="Commission"
                className="grid grid-cols-3 gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--background-muted))] px-3 py-2"
              >
                <Figure label="Good" value={commission.good} />
                <Figure label="Better" value={commission.better} />
                <Figure label="Best" value={commission.best} />
              </dl>
            )}
          </>
        )}
      </section>

      {/* Notes */}
      <section className={SECTION_CLASS}>
        <div className="space-y-1.5">
          <label htmlFor={fieldDomId(base, 'notes')} className={LABEL_CLASS}>
            Notes
          </label>
          <textarea
            id={fieldDomId(base, 'notes')}
            value={draft.notes}
            onChange={e => update({ notes: e.target.value })}
            rows={3}
            className={`${INPUT_CLASS} border-border resize-y`}
            placeholder="Anything worth remembering about this one"
          />
        </div>
      </section>

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting || undefined}
          className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Add Initiative'}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

/** `stacked`: a label with a description line under it. */
function chipClass(selected: boolean, stacked = false): string {
  return `inline-flex cursor-pointer ${stacked ? 'flex-col items-start text-left' : 'items-center'} rounded-[var(--radius-md)] border px-3 py-2 text-xs font-medium transition-colors focus-within:ring-2 focus-within:ring-ring ${
    selected
      ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.05)] text-[hsl(var(--primary))]'
      : 'border-border text-[hsl(var(--foreground-muted))] hover:border-[hsl(var(--foreground-muted))]'
  }`;
}

/** A small badge after a label, e.g. "EVERGREEN". Read as part of the label. */
function Tag({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-border px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
      {text}
    </span>
  );
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-red-600 dark:text-red-400">
      {message}
    </p>
  );
}

/** A radio group: fieldset + legend, chip-styled native radios. */
function ChoiceGroup<T extends string>({
  name,
  legend,
  tag,
  hint,
  options,
  value,
  onChange,
  errorId,
  error,
}: {
  name: string;
  legend: string;
  tag?: string;
  hint?: string;
  options: readonly Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  errorId: string;
  error?: string;
}) {
  const hintId = `${name}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    // Radios cannot carry aria-invalid; the group announces the error via
    // aria-describedby, and data-invalid lets the form focus into it.
    <fieldset className="space-y-1.5" aria-describedby={describedBy} data-invalid={error ? 'true' : undefined}>
      <legend className={LABEL_CLASS}>
        {legend}
        <Tag text={tag} />
      </legend>
      {hint && (
        <p id={hintId} className={HINT_CLASS}>
          {hint}
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-0.5">
        {options.map(option => (
          <label
            key={option.value}
            className={chipClass(value === option.value, !!option.description)}
          >
            <input
              type="radio"
              className="sr-only"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
            {option.description && (
              <span className="mt-0.5 font-normal text-[hsl(var(--foreground-muted))]">{option.description}</span>
            )}
          </label>
        ))}
      </div>
      <FieldError id={errorId} message={error} />
    </fieldset>
  );
}

/** A date with a Day / Month-only toggle. Month uses a native month input (YYYY-MM). */
function DateField({
  id,
  label,
  tag,
  hint,
  date,
  onChange,
  errorId,
  error,
  required = false,
}: {
  id: string;
  label: string;
  tag?: string;
  hint?: string;
  date: DraftDate;
  onChange: (date: DraftDate) => void;
  errorId: string;
  error?: string;
  required?: boolean;
}) {
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  const value = date.value ?? '';
  const common = {
    id,
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className={LABEL_CLASS}>
          {label}
          {required && (
            <span className="ml-0.5 text-red-500" aria-hidden="true">
              *
            </span>
          )}
          <Tag text={tag} />
        </label>
        <div role="group" aria-label={`${label} precision`} className="flex gap-1">
          {(['day', 'month'] as const).map(p => (
            <button
              key={p}
              type="button"
              aria-pressed={date.precision === p}
              onClick={() => onChange(setDatePrecision(date, p))}
              className={`rounded-[var(--radius-md)] border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                date.precision === p
                  ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.1)] text-[hsl(var(--primary))]'
                  : 'border-border text-[hsl(var(--foreground-muted))] hover:border-[hsl(var(--foreground-muted))]'
              }`}
            >
              {p === 'day' ? 'Day' : 'Month only'}
            </button>
          ))}
        </div>
      </div>
      {hint && (
        <p id={hintId} className={HINT_CLASS}>
          {hint}
        </p>
      )}
      {date.precision === 'day' ? (
        <DateInput
          {...common}
          value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''}
          onValueChange={v => onChange({ value: v || null, precision: 'day' })}
          error={!!error}
        />
      ) : (
        <input
          {...common}
          type="month"
          value={/^\d{4}-\d{2}$/.test(value) ? value : value.slice(0, 7)}
          onChange={e => onChange({ value: e.target.value || null, precision: 'month' })}
          className={`${INPUT_CLASS} ${borderFor(!!error)}`}
        />
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function MoneyField({
  id,
  label,
  value,
  onChange,
  errorId,
  error,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  errorId: string;
  error?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium text-[hsl(var(--foreground))]">
        {label}
      </label>
      <NumberInputRaw
        id={id}
        value={value}
        onValueChange={onChange}
        placeholder="0"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        error={!!error}
        className={`${INPUT_CLASS} ${borderFor(!!error)}`}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

/** A labelled number input (counts and amounts), with hint and error wiring. */
function NumberField({
  id,
  label,
  tag,
  hint,
  placeholder = '0',
  value,
  onChange,
  errorId,
  error,
  required = false,
}: {
  id: string;
  label: string;
  tag?: string;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  errorId: string;
  error?: string;
  required?: boolean;
}) {
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
        {required && (
          <span className="ml-0.5 text-red-500" aria-hidden="true">
            *
          </span>
        )}
        <Tag text={tag} />
      </label>
      {hint && (
        <p id={hintId} className={HINT_CLASS}>
          {hint}
        </p>
      )}
      <NumberInputRaw
        id={id}
        value={value}
        onValueChange={onChange}
        placeholder={placeholder}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        error={!!error}
        className={`${INPUT_CLASS} ${borderFor(!!error)}`}
      />
      <FieldError id={errorId} message={error} />
    </div>
  );
}

function TextField({
  id,
  label,
  tag,
  hint,
  placeholder,
  value,
  onChange,
  errorId,
  error,
  required = false,
}: {
  id: string;
  label: string;
  tag?: string;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  errorId?: string;
  error?: string;
  required?: boolean;
}) {
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error && errorId ? errorId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label}
        {required && (
          <span className="ml-0.5 text-red-500" aria-hidden="true">
            *
          </span>
        )}
        <Tag text={tag} />
      </label>
      {hint && (
        <p id={hintId} className={HINT_CLASS}>
          {hint}
        </p>
      )}
      <input
        id={id}
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`${INPUT_CLASS} ${borderFor(!!error)}`}
      />
      {errorId && <FieldError id={errorId} message={error} />}
    </div>
  );
}

/** A multi-select: fieldset + legend, chip-styled native checkboxes. */
function CheckGroup<T extends string>({
  legend,
  tag,
  hint,
  options,
  values,
  onToggle,
  errorId,
  error,
}: {
  legend: string;
  tag?: string;
  hint?: string;
  options: readonly Option<T>[];
  values: readonly T[];
  onToggle: (value: T) => void;
  errorId?: string;
  error?: string;
}) {
  return (
    <fieldset
      className="space-y-1.5"
      aria-describedby={error && errorId ? errorId : undefined}
      data-invalid={error ? 'true' : undefined}
    >
      <legend className={LABEL_CLASS}>
        {legend}
        <Tag text={tag} />
      </legend>
      <p className={HINT_CLASS}>{hint ? `${hint} Select all that apply.` : 'Select all that apply.'}</p>
      <div className="flex flex-wrap gap-2 pt-0.5">
        {options.map(option => {
          const checked = values.includes(option.value);
          return (
            <label key={option.value} className={chipClass(checked)}>
              <input type="checkbox" className="sr-only" checked={checked} onChange={() => onToggle(option.value)} />
              {option.label}
            </label>
          );
        })}
      </div>
      {errorId && <FieldError id={errorId} message={error} />}
    </fieldset>
  );
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-[hsl(var(--foreground-muted))]">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-[hsl(var(--foreground))]">{value}</dd>
    </div>
  );
}
