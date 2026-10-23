'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  SlidersHorizontal, Loader2, TriangleAlert, Info, CheckCircle2, RefreshCw,
  Save, Sprout, Plus, Trash2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { LoadingPanel } from '@/components/ui/spinner';
import {
  AUDIENCE_LABEL,
  CATEGORY_OPTIONS,
  CONVERSION_PATHS,
  DEFAULT_FILTERS,
  FORMAT_LABEL,
  FREQUENCY_LABEL,
  INITIATIVE_FORMATS,
  INITIATIVE_KINDS,
  KIND_LABEL,
  NAMED_DATES,
  NAMED_DATE_LABEL,
  PATH_LABEL,
  PRICE_SOURCES,
  PRICE_SOURCE_LABEL,
  RECURRENCE_FREQUENCIES,
  SOURCE_LABEL,
  STATUS_LABEL,
  buildPatch,
  canAddExtra,
  changedFields,
  draftErrors,
  draftFromConfig,
  fieldLabel,
  filterRecords,
  groupProblems,
  needsHumanLines,
  newFieldExtra,
  newRevenueLine,
  ongoingAllowed,
  pathRestriction,
  recurringAllowed,
  type CategoryFilter,
  type EditorDraft,
  type FieldExtraDraft,
  type RecordFilters,
  type RevenueLineDraft,
  type StatusFilter,
} from '@/lib/intake-v3/config-editor';
import {
  DEFAULT_ONGOING_LABEL,
  FIELD_EXTRA_TYPES,
  MAX_FIELD_EXTRAS,
  type FieldExtraType,
  type ConfigProblem,
} from '@/lib/intake-v3/library-config';
import type { ConfigField } from '@/lib/intake-v3/derive-config';
import {
  isOfferedInIntakePicker,
  type ConfigStatus,
  type LibraryConfigRecord,
  type LibraryConfigSummary,
  type Reconciliation,
} from '@/lib/intake-v3/config-repo';

/**
 * Per-record Initiative Intake configuration (initiative_library_config, 045).
 *
 * WHAT IS NOT HERE: the on/off switch. initiative_settings.is_active lives on
 * /admin/ai-workbook, keeps controlling what the AI uses, and is never
 * restricted by anything on this screen. It is shown read-only. A record is
 * offered in the NEW intake picker only when it is active AND its config here
 * is valid (isOfferedInIntakePicker), so a half-finished record cannot reach a
 * customer however the switch is set.
 *
 * ALL THE RULES LIVE IN config-editor.ts (unit tested): which fields changed,
 * the automatic empty frequency list, path restrictions. This file is markup
 * around them. Validity is the server's call; the editor never decides it.
 *
 * SEPARATE BUSY FLAGS for loading, seeding and saving. One shared flag once
 * let a finished seed re-enable a Save that was still in flight.
 */

interface LoadResponse {
  ok: true;
  records: LibraryConfigRecord[];
  summary: LibraryConfigSummary;
  reconciliation: Reconciliation;
}

type SaveOutcome =
  | { kind: 'saved'; status: ConfigStatus }
  | { kind: 'errors'; errors: string[] }
  | { kind: 'problems'; grouped: Record<string, string[]> };

const inputClass =
  'w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))] disabled:opacity-50';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'valid', label: STATUS_LABEL.valid },
  { value: 'invalid', label: STATUS_LABEL.invalid },
  { value: 'incomplete', label: STATUS_LABEL.incomplete },
];

/** Toggle `value` in a possibly-unset list, keeping vocabulary order. */
function toggleIn<T extends string>(list: T[] | null, value: T, vocab: readonly T[]): T[] {
  const current = list ?? [];
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return vocab.filter((v) => next.includes(v));
}

function statusDetail(status: ConfigStatus): string | null {
  if (status.status === 'incomplete') {
    return `Missing: ${status.missing.map(fieldLabel).join(', ')}`;
  }
  if (status.status === 'invalid') {
    return `${status.problems.length} problem${status.problems.length === 1 ? '' : 's'}`;
  }
  return null;
}

export function InitiativeConfigEditor() {
  const [data, setData] = useState<LoadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);
  const [seedError, setSeedError] = useState<string | null>(null);

  const [filters, setFilters] = useState<RecordFilters>({ ...DEFAULT_FILTERS });

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [original, setOriginal] = useState<EditorDraft | null>(null);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveOutcome, setSaveOutcome] = useState<SaveOutcome | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const panelHeadingRef = useRef<HTMLHeadingElement>(null);

  /**
   * Fetch everything. Returns the data so a caller (save) can re-open the
   * record from the fresh copy. Does not set `loading` itself: the first load
   * rides the initial `true`, and Refresh is an event that sets it.
   */
  const load = useCallback(async (): Promise<LoadResponse | null> => {
    try {
      const res = await fetch('/api/admin/initiative-config', { credentials: 'same-origin' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(
          body?.error === 'config_unavailable'
            ? `Could not read the intake configuration. Has migration 045 been applied? (${body?.message ?? 'no detail'})`
            : body?.message || body?.error || 'Could not load the intake configuration.'
        );
        return null;
      }
      setLoadError(null);
      setData(body as LoadResponse);
      return body as LoadResponse;
    } catch {
      setLoadError('Could not reach the server.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  // Through an inner async function, as ghl-settings.tsx / activity-log.tsx
  // do, so the effect body itself sets no state.
  useEffect(() => {
    const run = async () => {
      await load();
    };
    run();
  }, [load]);

  const refresh = async () => {
    setLoading(true);
    await load();
  };

  const records = useMemo(() => data?.records ?? [], [data]);
  const visible = useMemo(() => filterRecords(records, filters), [records, filters]);
  const selected = useMemo(
    () => records.find((r) => r.initiativeKey === selectedKey) ?? null,
    [records, selectedKey]
  );

  const patch = useMemo(
    () => (original && draft ? buildPatch(original, draft) : {}),
    [original, draft]
  );
  const dirty = Object.keys(patch).length > 0;
  const changed = useMemo(
    () => (original && draft ? changedFields(original, draft) : new Set<ConfigField>()),
    [original, draft]
  );
  const localErrors = useMemo(() => (draft ? draftErrors(draft) : {}), [draft]);
  const hasLocalErrors = Object.keys(localErrors).length > 0;

  const openRecord = (record: LibraryConfigRecord) => {
    if (record.initiativeKey === selectedKey) return;
    if (dirty && !window.confirm('Discard your unsaved changes to this initiative?')) return;
    const d = draftFromConfig(record.effective);
    setSelectedKey(record.initiativeKey);
    setOriginal(d);
    setDraft(d);
    setSaveOutcome(null);
    setSaveError(null);
    // After the panel renders, move focus to it so keyboard users land there.
    requestAnimationFrame(() => panelHeadingRef.current?.focus());
  };

  const closePanel = () => {
    if (dirty && !window.confirm('Discard your unsaved changes to this initiative?')) return;
    setSelectedKey(null);
    setOriginal(null);
    setDraft(null);
    setSaveOutcome(null);
    setSaveError(null);
  };

  const update = (change: Partial<EditorDraft>) =>
    setDraft((d) => (d ? { ...d, ...change } : d));

  const seed = async () => {
    setSeeding(true);
    setSeedMessage(null);
    setSeedError(null);
    try {
      const res = await fetch('/api/admin/initiative-config/seed', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSeedError(body?.message || body?.error || 'Could not seed from the workbook.');
        return;
      }
      setSeedMessage(`Created ${body.created ?? 0}, skipped ${body.skipped ?? 0}.`);
      // Seeding never touches a saved row, so an open draft stays as it is.
      await load();
    } catch {
      setSeedError('Could not reach the server.');
    } finally {
      setSeeding(false);
    }
  };

  const save = async () => {
    if (!selectedKey || !dirty || hasLocalErrors) return;
    setSaving(true);
    setSaveOutcome(null);
    setSaveError(null);
    try {
      const res = await fetch('/api/admin/initiative-config', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        // Only the changed fields: sending everything would turn every
        // "From workbook" value into a "Saved" one nobody confirmed.
        body: JSON.stringify({ initiativeKey: selectedKey, patch }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 422 && body?.error === 'invalid_config') {
        setSaveOutcome({
          kind: 'problems',
          grouped: groupProblems((body.problems ?? []) as ConfigProblem[]),
        });
        return;
      }
      if (res.status === 400) {
        const errors: string[] = Array.isArray(body?.errors)
          ? body.errors
          : [String(body?.error ?? 'The request was refused.')];
        setSaveOutcome({ kind: 'errors', errors });
        return;
      }
      if (!res.ok) {
        setSaveError(body?.message || `Could not save: ${body?.error ?? 'unknown error'}`);
        return;
      }

      // Reloaded rather than trusted, so status, sources and picker
      // eligibility in the list are what the server now holds.
      const fresh = await load();
      const record = fresh?.records.find((r) => r.initiativeKey === selectedKey);
      if (record) {
        const d = draftFromConfig(record.effective);
        setOriginal(d);
        setDraft(d);
        setSaveOutcome({ kind: 'saved', status: record.validation });
      } else {
        setSaveOutcome({ kind: 'saved', status: body.validation as ConfigStatus });
      }
    } catch {
      setSaveError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingPanel />;

  const summary = data?.summary;
  const reconciliation = data?.reconciliation;
  const lines = summary ? needsHumanLines(summary.needsHumanCounts) : [];
  const problemsByField = saveOutcome?.kind === 'problems' ? saveOutcome.grouped : {};

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h2 className="text-lg font-semibold">Initiative intake configuration</h2>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="inline-flex shrink-0 items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {loadError && <ErrorBanner>{loadError}</ErrorBanner>}

      {summary && (
        <SummarySection
          summary={summary}
          reconciliation={reconciliation ?? null}
          lines={lines}
          seeding={seeding}
          seedMessage={seedMessage}
          seedError={seedError}
          onSeed={seed}
        />
      )}

      {data && records.length === 0 && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-3 py-2.5 text-sm text-[hsl(var(--foreground-muted))]">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            The initiative library is empty. Upload a workbook on{' '}
            <Link href="/admin/ai-workbook" className="font-medium text-[hsl(var(--primary))] underline">
              AI Workbook
            </Link>{' '}
            and its initiatives will appear here.
          </span>
        </div>
      )}

      {records.length > 0 && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <RecordList
            records={visible}
            total={records.length}
            filters={filters}
            onFilters={setFilters}
            selectedKey={selectedKey}
            onOpen={openRecord}
          />

          {selected && draft && original && (
            <section
              aria-labelledby="config-panel-heading"
              className="rounded-[var(--radius-lg)] border border-border bg-card p-6 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:self-start xl:overflow-y-auto"
            >
              <EditPanel
                headingRef={panelHeadingRef}
                record={selected}
                draft={draft}
                changed={changed}
                localErrors={localErrors}
                problemsByField={problemsByField}
                onChange={update}
                onClose={closePanel}
              />

              {saveError && <div className="mt-5"><ErrorBanner>{saveError}</ErrorBanner></div>}

              {saveOutcome?.kind === 'errors' && (
                <div className="mt-5">
                  <ErrorBanner>
                    <span className="block font-medium">The server refused this change:</span>
                    <ul className="mt-1 list-disc pl-5">
                      {saveOutcome.errors.map((e) => <li key={e}>{e}</li>)}
                    </ul>
                  </ErrorBanner>
                </div>
              )}

              {saveOutcome?.kind === 'problems' && (
                <div className="mt-5">
                  <ErrorBanner>
                    Not saved: this configuration is complete but not valid. The
                    problems are shown next to each field above.
                    {problemsByField._form && (
                      <ul className="mt-1 list-disc pl-5">
                        {problemsByField._form.map((m) => <li key={m}>{m}</li>)}
                      </ul>
                    )}
                  </ErrorBanner>
                </div>
              )}

              {saveOutcome?.kind === 'saved' && (
                <div className="mt-5 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--primary)_/_0.3)] bg-[hsl(var(--primary)_/_0.06)] px-3 py-2.5 text-sm text-[hsl(var(--primary))]">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Saved. Status: {STATUS_LABEL[saveOutcome.status.status]}
                    {statusDetail(saveOutcome.status) ? ` (${statusDetail(saveOutcome.status)})` : ''}.
                  </span>
                </div>
              )}

              <div className="mt-6 border-t border-border pt-5">
                <p className="mb-3 text-xs text-[hsl(var(--foreground-muted))]">
                  An incomplete record can be saved and finished later. It stays
                  out of the new intake picker until it is valid. A complete
                  record that breaks a rule is refused.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={save}
                    disabled={saving || !dirty || hasLocalErrors}
                    className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save initiative
                  </button>
                  {!dirty && !saving && (
                    <span className="text-xs text-[hsl(var(--foreground-muted))]">
                      No unsaved changes
                    </span>
                  )}
                  {dirty && hasLocalErrors && (
                    <span className="text-xs text-[hsl(var(--destructive))]">
                      Fix the highlighted fields to save.
                    </span>
                  )}
                  {dirty && !hasLocalErrors && !saving && (
                    <span className="text-xs text-[hsl(var(--foreground-muted))]">
                      Will save: {[...changed].map(fieldLabel).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

function SummarySection({
  summary,
  reconciliation,
  lines,
  seeding,
  seedMessage,
  seedError,
  onSeed,
}: {
  summary: LibraryConfigSummary;
  reconciliation: Reconciliation | null;
  lines: { field: ConfigField; count: number; text: string }[];
  seeding: boolean;
  seedMessage: string | null;
  seedError: string | null;
  onSeed: () => void;
}) {
  const stats: { label: string; value: number }[] = [
    { label: 'Initiatives', value: summary.total },
    { label: STATUS_LABEL.valid, value: summary.valid },
    { label: STATUS_LABEL.invalid, value: summary.invalid },
    { label: STATUS_LABEL.incomplete, value: summary.incomplete },
    { label: 'In new picker', value: summary.offeredInPicker },
  ];

  return (
    <section aria-labelledby="config-summary-heading" className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
      <h3 id="config-summary-heading" className="text-sm font-semibold">Summary</h3>

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-3 py-2">
            <dt className="text-xs text-[hsl(var(--foreground-muted))]">{s.label}</dt>
            <dd className="text-lg font-semibold">{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2.5 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))]" />
        <span>
          <span className="font-medium">
            {summary.offeredInPicker} of {summary.total} will appear in the new intake picker.
          </span>{' '}
          <span className="text-[hsl(var(--foreground-muted))]">
            An initiative appears there only when it is switched on (on{' '}
            <Link href="/admin/ai-workbook" className="text-[hsl(var(--primary))] underline">
              AI Workbook
            </Link>
            ) and its configuration here is valid. The switch itself is never
            restricted by this screen.
          </span>
        </span>
      </div>

      {lines.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
            Still needs a decision
          </p>
          <ul className="mt-1.5 space-y-0.5 text-sm">
            {lines.map((l) => <li key={l.field}>{l.text}</li>)}
          </ul>
        </div>
      )}

      <div className="mt-5 border-t border-border pt-5">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onSeed}
            disabled={seeding}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
          >
            {seeding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sprout className="h-3.5 w-3.5" />}
            Seed from workbook
          </button>
          {seedMessage && !seedError && (
            <span role="status" className="flex items-center gap-1.5 text-sm text-[hsl(var(--primary))]">
              <CheckCircle2 className="h-4 w-4" />
              {seedMessage}
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))]">
          Fills in what the workbook implies for every initiative without a saved
          record, and never overwrites a record that has been saved.
        </p>
        {seedError && <div className="mt-3"><ErrorBanner>{seedError}</ErrorBanner></div>}
      </div>

      {reconciliation &&
        (reconciliation.orphanConfigKeys.length > 0 || reconciliation.missingConfigKeys.length > 0) && (
          <div className="mt-5 space-y-2 border-t border-border pt-5 text-xs text-[hsl(var(--foreground-muted))]">
            {reconciliation.missingConfigKeys.length > 0 && (
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {reconciliation.missingConfigKeys.length} initiative
                  {reconciliation.missingConfigKeys.length === 1 ? ' has' : 's have'} no saved
                  record yet and use workbook values only. Seeding creates them:{' '}
                  <span className="font-mono">{reconciliation.missingConfigKeys.join(', ')}</span>
                </span>
              </p>
            )}
            {reconciliation.orphanConfigKeys.length > 0 && (
              <p className="flex items-start gap-2">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {reconciliation.orphanConfigKeys.length} saved record
                  {reconciliation.orphanConfigKeys.length === 1 ? ' refers' : 's refer'} to
                  initiatives not in the current workbook. Harmless; they apply again if
                  those initiatives come back:{' '}
                  <span className="font-mono">{reconciliation.orphanConfigKeys.join(', ')}</span>
                </span>
              </p>
            )}
          </div>
        )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Record list
 * ------------------------------------------------------------------ */

function RecordList({
  records,
  total,
  filters,
  onFilters,
  selectedKey,
  onOpen,
}: {
  records: LibraryConfigRecord[];
  total: number;
  filters: RecordFilters;
  onFilters: (f: RecordFilters) => void;
  selectedKey: string | null;
  onOpen: (r: LibraryConfigRecord) => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={`${id}-heading`} className="min-w-0 space-y-3">
      <h3 id={`${id}-heading`} className="text-sm font-semibold">Initiatives</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <label htmlFor={`${id}-category`} className="text-xs font-medium">Category</label>
          <select
            id={`${id}-category`}
            value={filters.category}
            onChange={(e) => onFilters({ ...filters, category: e.target.value as CategoryFilter })}
            className={inputClass}
          >
            <option value="all">All categories</option>
            <option value="none">No category</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-status`} className="text-xs font-medium">Status</label>
          <select
            id={`${id}-status`}
            value={filters.status}
            onChange={(e) => onFilters({ ...filters, status: e.target.value as StatusFilter })}
            className={inputClass}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-query`} className="text-xs font-medium">Search name or key</label>
          <input
            id={`${id}-query`}
            type="search"
            value={filters.query}
            onChange={(e) => onFilters({ ...filters, query: e.target.value })}
            className={inputClass}
          />
        </div>
      </div>

      <p className="text-xs text-[hsl(var(--foreground-muted))]" aria-live="polite">
        Showing {records.length} of {total}
      </p>

      <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Initiative intake configuration. Select an initiative to edit it.
          </caption>
          <thead className="bg-[hsl(var(--background-muted))] text-xs text-[hsl(var(--foreground-muted))]">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Name</th>
              <th scope="col" className="px-3 py-2 font-medium">Category</th>
              <th scope="col" className="px-3 py-2 font-medium">Status</th>
              <th scope="col" className="px-3 py-2 font-medium">Active</th>
              <th scope="col" className="px-3 py-2 font-medium">In picker</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {records.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-[hsl(var(--foreground-muted))]">
                  No initiatives match these filters.
                </td>
              </tr>
            )}
            {records.map((r) => {
              const isSelected = r.initiativeKey === selectedKey;
              const detail = statusDetail(r.validation);
              const inPicker = isOfferedInIntakePicker(r);
              return (
                <tr
                  key={r.initiativeKey}
                  onClick={() => onOpen(r)}
                  className={cn(
                    'cursor-pointer align-top transition-colors hover:bg-[hsl(var(--background-muted))]',
                    isSelected && 'bg-[hsl(var(--primary)_/_0.06)]'
                  )}
                >
                  <td className="px-3 py-2">
                    {/* The button carries keyboard access; the row click is a convenience. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(r);
                      }}
                      aria-current={isSelected ? 'true' : undefined}
                      className="text-left font-medium hover:underline"
                    >
                      {r.library.name || r.initiativeKey}
                    </button>
                    <span className="block font-mono text-xs text-[hsl(var(--foreground-subtle))]">
                      {r.initiativeKey}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.category?.label ?? (
                      <span className="text-[hsl(var(--foreground-muted))]">Not set</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'font-medium',
                        r.validation.status === 'valid' && 'text-[hsl(var(--primary))]',
                        r.validation.status === 'invalid' && 'text-[hsl(var(--destructive))]',
                        r.validation.status === 'incomplete' && 'text-amber-700 dark:text-amber-300'
                      )}
                    >
                      {STATUS_LABEL[r.validation.status]}
                    </span>
                    {detail && (
                      <span className="block text-xs text-[hsl(var(--foreground-muted))]">{detail}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">{r.settings.isActive ? 'On' : 'Off'}</td>
                  <td className="px-3 py-2">{inPicker ? 'Yes' : 'No'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Edit panel
 * ------------------------------------------------------------------ */

function EditPanel({
  headingRef,
  record,
  draft,
  changed,
  localErrors,
  problemsByField,
  onChange,
  onClose,
}: {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  record: LibraryConfigRecord;
  draft: EditorDraft;
  changed: Set<ConfigField>;
  localErrors: Partial<Record<ConfigField, string>>;
  problemsByField: Record<string, string[]>;
  onChange: (change: Partial<EditorDraft>) => void;
  onClose: () => void;
}) {
  const id = useId();
  const meta = (field: ConfigField) => (
    <FieldMeta source={SOURCE_LABEL[record.sources[field]]} changed={changed.has(field)} />
  );
  const messages = (field: ConfigField) => (
    <FieldMessages error={localErrors[field]} problems={problemsByField[field]} />
  );
  const canRecur = recurringAllowed(draft);
  const canOngoing = ongoingAllowed(draft);
  const kindsDecided = draft.allowedKinds !== null;
  const detail = statusDetail(record.validation);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="config-panel-heading"
            ref={headingRef}
            tabIndex={-1}
            className="text-base font-semibold outline-none"
          >
            {record.library.name || record.initiativeKey}
          </h3>
          <p className="mt-0.5 font-mono text-xs text-[hsl(var(--foreground-subtle))]">
            {record.initiativeKey}
            {record.library.workbookId ? ` · workbook ${record.library.workbookId}` : ''}
          </p>
          <p className="mt-2 text-sm">
            Status: <span className="font-medium">{STATUS_LABEL[record.validation.status]}</span>
            {detail ? <span className="text-[hsl(var(--foreground-muted))]"> ({detail})</span> : null}
          </p>
          {record.validation.status === 'invalid' && (
            <ul className="mt-1 list-disc pl-5 text-xs text-[hsl(var(--destructive))]">
              {record.validation.problems.map((p, i) => (
                <li key={`${p.code}-${i}`}>{fieldLabel(p.field.split('.')[0])}: {p.message}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-sm">
            Switched {record.settings.isActive ? 'on' : 'off'}{' '}
            <span className="text-xs text-[hsl(var(--foreground-muted))]">
              (change it on{' '}
              <Link href="/admin/ai-workbook" className="text-[hsl(var(--primary))] underline">
                AI Workbook
              </Link>
              )
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the editor"
          className="rounded-[var(--radius-md)] p-1.5 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Category */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${id}-category`} className="text-sm font-medium">Category</label>
          {meta('categoryId')}
        </div>
        {record.library.category && (
          <p className="text-xs text-[hsl(var(--foreground-muted))]">
            Workbook says: {record.library.category}
          </p>
        )}
        <select
          id={`${id}-category`}
          value={draft.categoryId}
          onChange={(e) => onChange({ categoryId: e.target.value as EditorDraft['categoryId'] })}
          className={inputClass}
        >
          <option value="">Not set</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
        {messages('categoryId')}
      </div>

      {/* Audience */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${id}-audience`} className="text-sm font-medium">Audience</label>
          {meta('audienceSource')}
        </div>
        <select
          id={`${id}-audience`}
          value={draft.audienceSource}
          onChange={(e) => onChange({ audienceSource: e.target.value as EditorDraft['audienceSource'] })}
          className={inputClass}
        >
          <option value="">Not set</option>
          {(Object.keys(AUDIENCE_LABEL) as (keyof typeof AUDIENCE_LABEL)[]).map((a) => (
            <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>
          ))}
        </select>
        {messages('audienceSource')}
      </div>

      {/* Allowed kinds */}
      <fieldset className="space-y-1.5">
        <legend className="flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
          <span>Allowed kinds</span>
          {meta('allowedKinds')}
        </legend>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {INITIATIVE_KINDS.map((k) => (
            <Checkbox
              key={k}
              id={`${id}-kind-${k}`}
              label={KIND_LABEL[k]}
              checked={draft.allowedKinds?.includes(k) ?? false}
              onChange={() => onChange({ allowedKinds: toggleIn(draft.allowedKinds, k, INITIATIVE_KINDS) })}
            />
          ))}
        </div>
        <UnsetControl
          isSet={draft.allowedKinds !== null}
          onClear={() => onChange({ allowedKinds: null })}
        />
        {messages('allowedKinds')}
      </fieldset>

      {/* Allowed paths */}
      <fieldset className="space-y-1.5">
        <legend className="flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
          <span>Allowed conversion paths</span>
          {meta('allowedPaths')}
        </legend>
        {record.library.ctaOptions.length > 0 && (
          <p className="text-xs text-[hsl(var(--foreground-muted))]">
            Workbook CTA: {record.library.ctaOptions.join(', ')}
          </p>
        )}
        <ul className="space-y-2">
          {CONVERSION_PATHS.map((p) => {
            const restriction = pathRestriction(p, draft.audienceSource, draft.categoryId);
            const checked = draft.allowedPaths?.includes(p) ?? false;
            const hintId = `${id}-path-${p}-hint`;
            return (
              <li key={p} className={cn(restriction && 'text-[hsl(var(--foreground-muted))]')}>
                <Checkbox
                  id={`${id}-path-${p}`}
                  label={PATH_LABEL[p]}
                  checked={checked}
                  // A restricted path that is already ticked stays untickable,
                  // so the admin can always remove it.
                  disabled={!!restriction && !checked}
                  describedBy={restriction ? hintId : undefined}
                  onChange={() => onChange({ allowedPaths: toggleIn(draft.allowedPaths, p, CONVERSION_PATHS) })}
                />
                {restriction && (
                  <p id={hintId} className="ml-6 text-xs">
                    {restriction}
                    {checked ? ' Customers will not be offered it; untick it.' : ''}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <UnsetControl
          isSet={draft.allowedPaths !== null}
          onClear={() => onChange({ allowedPaths: null })}
        />
        {messages('allowedPaths')}
      </fieldset>

      {/* Allowed frequencies */}
      <fieldset className="space-y-1.5" disabled={!canRecur}>
        <legend className="flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
          <span>Allowed frequencies</span>
          {meta('allowedFrequencies')}
        </legend>
        <div className={cn('flex flex-wrap gap-x-5 gap-y-2', !canRecur && 'opacity-50')}>
          {RECURRENCE_FREQUENCIES.map((f) => (
            <Checkbox
              key={f}
              id={`${id}-freq-${f}`}
              label={FREQUENCY_LABEL[f]}
              checked={canRecur && (draft.allowedFrequencies?.includes(f) ?? false)}
              disabled={!canRecur}
              onChange={() =>
                onChange({ allowedFrequencies: toggleIn(draft.allowedFrequencies, f, RECURRENCE_FREQUENCIES) })
              }
            />
          ))}
        </div>
        <p className="text-xs text-[hsl(var(--foreground-muted))]">
          {!kindsDecided
            ? 'Decide the allowed kinds first. Frequencies only apply to a recurring initiative.'
            : !canRecur
              ? 'This initiative cannot recur, so it is saved with no frequencies automatically.'
              : 'Which repeat intervals the customer may choose.'}
        </p>
        {canRecur && (
          <UnsetControl
            isSet={draft.allowedFrequencies !== null}
            onClear={() => onChange({ allowedFrequencies: null })}
          />
        )}
        {messages('allowedFrequencies')}
      </fieldset>

      {/* Ongoing label */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${id}-ongoing`} className="text-sm font-medium">Ongoing label</label>
          {meta('ongoingLabel')}
        </div>
        <input
          id={`${id}-ongoing`}
          type="text"
          maxLength={80}
          value={canOngoing ? draft.ongoingLabel : ''}
          disabled={!canOngoing}
          placeholder={DEFAULT_ONGOING_LABEL}
          aria-describedby={`${id}-ongoing-hint`}
          onChange={(e) => onChange({ ongoingLabel: e.target.value })}
          className={inputClass}
        />
        <p id={`${id}-ongoing-hint`} className="text-xs text-[hsl(var(--foreground-muted))]">
          {canOngoing
            ? `The word customers see for the ongoing kind, e.g. "Evergreen". Leave blank for "${DEFAULT_ONGOING_LABEL}". At most 60 characters.`
            : 'Only used when Ongoing is an allowed kind.'}
        </p>
        {messages('ongoingLabel')}
      </div>

      {/* Format override */}
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={`${id}-format`} className="text-sm font-medium">Format override</label>
          {meta('formatOverride')}
        </div>
        <select
          id={`${id}-format`}
          value={draft.formatOverride}
          onChange={(e) => onChange({ formatOverride: e.target.value as EditorDraft['formatOverride'] })}
          className={inputClass}
        >
          <option value="">None (the category decides)</option>
          {INITIATIVE_FORMATS.map((f) => (
            <option key={f} value={f}>{FORMAT_LABEL[f]}</option>
          ))}
        </select>
        {messages('formatOverride')}
      </div>

      {/* Partner block */}
      <fieldset className="space-y-3">
        <legend className="flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
          <span>Partner block</span>
          {meta('partnerBlock')}
        </legend>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm">Ask who hosts the audience</p>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              Collects the partner or event that owns the audience.
            </p>
          </div>
          <Toggle
            checked={draft.partnerBlock.host}
            onChange={(v) => onChange({ partnerBlock: { ...draft.partnerBlock, host: v } })}
            ariaLabel="Ask who hosts the audience"
          />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm">Ask whether the slot is booked</p>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              With this off, booking status is never asked or recorded, so the
              booked / not-booked task swap never happens for this initiative.
            </p>
          </div>
          <Toggle
            checked={draft.partnerBlock.booking}
            onChange={(v) => onChange({ partnerBlock: { ...draft.partnerBlock, booking: v } })}
            ariaLabel="Ask whether the slot is booked"
          />
        </div>
        {messages('partnerBlock')}
      </fieldset>

      <RevenueLinesEditor
        idPrefix={id}
        lines={draft.revenueLines}
        onChange={(revenueLines) => onChange({ revenueLines })}
        meta={meta('revenueLines')}
        messages={messages('revenueLines')}
      />

      <FieldExtrasEditor
        idPrefix={id}
        extras={draft.fieldExtras}
        onChange={(fieldExtras) => onChange({ fieldExtras })}
        meta={meta('fieldExtras')}
        messages={messages('fieldExtras')}
      />

      {record.warnings.length > 0 && (
        <div className="rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/20 dark:text-amber-200">
          <p className="flex items-center gap-2 font-medium">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            Notes from reading the workbook
          </p>
          <ul className="mt-1 list-disc pl-6 text-xs">
            {record.warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>
                {fieldLabel(w.field)}: {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Repeaters
 * ------------------------------------------------------------------ */

function RevenueLinesEditor({
  idPrefix,
  lines,
  onChange,
  meta,
  messages,
}: {
  idPrefix: string;
  lines: RevenueLineDraft[] | null;
  onChange: (lines: RevenueLineDraft[] | null) => void;
  meta: React.ReactNode;
  messages: React.ReactNode;
}) {
  const list = lines ?? [];
  const setLine = (i: number, change: Partial<RevenueLineDraft>) =>
    onChange(list.map((l, j) => (j === i ? { ...l, ...change } : l)));

  return (
    <fieldset className="space-y-2">
      <legend className="flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
        <span>Revenue lines</span>
        {meta}
      </legend>
      <p className="text-xs text-[hsl(var(--foreground-muted))]">
        One line per price, each with the window its money arrives in.
        {lines === null ? ' Not set yet.' : list.length === 0 ? ' None.' : ''}
      </p>
      {list.map((line, i) => {
        const p = `${idPrefix}-line-${i}`;
        return (
          <div key={i} className="space-y-2 rounded-[var(--radius-md)] border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor={`${p}-id`} className="text-xs font-medium">Line id</label>
                <input
                  id={`${p}-id`}
                  type="text"
                  value={line.id}
                  onChange={(e) => setLine(i, { id: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${p}-price`} className="text-xs font-medium">Price from</label>
                <select
                  id={`${p}-price`}
                  value={line.priceSource}
                  onChange={(e) => setLine(i, { priceSource: e.target.value as RevenueLineDraft['priceSource'] })}
                  className={inputClass}
                >
                  {PRICE_SOURCES.map((s) => (
                    <option key={s} value={s}>{PRICE_SOURCE_LABEL[s]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor={`${p}-opens`} className="text-xs font-medium">Window opens</label>
                <select
                  id={`${p}-opens`}
                  value={line.windowOpens}
                  onChange={(e) => setLine(i, { windowOpens: e.target.value as RevenueLineDraft['windowOpens'] })}
                  className={inputClass}
                >
                  {NAMED_DATES.map((d) => (
                    <option key={d} value={d}>{NAMED_DATE_LABEL[d]}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor={`${p}-closes`} className="text-xs font-medium">Window closes</label>
                <select
                  id={`${p}-closes`}
                  value={line.windowCloses}
                  onChange={(e) => setLine(i, { windowCloses: e.target.value as RevenueLineDraft['windowCloses'] })}
                  className={inputClass}
                >
                  {NAMED_DATES.map((d) => (
                    <option key={d} value={d}>{NAMED_DATE_LABEL[d]}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label htmlFor={`${p}-condition`} className="text-xs font-medium">
                Condition (optional)
              </label>
              <input
                id={`${p}-condition`}
                type="text"
                value={line.condition}
                placeholder="e.g. only when the path is Offer"
                onChange={(e) => setLine(i, { condition: e.target.value })}
                className={inputClass}
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(list.filter((_, j) => j !== i))}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--destructive))] hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove line {line.id || i + 1}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...list, newRevenueLine(list)])}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--background-muted))]"
      >
        <Plus className="h-3.5 w-3.5" />
        Add revenue line
      </button>
      {messages}
    </fieldset>
  );
}

function FieldExtrasEditor({
  idPrefix,
  extras,
  onChange,
  meta,
  messages,
}: {
  idPrefix: string;
  extras: FieldExtraDraft[] | null;
  onChange: (extras: FieldExtraDraft[] | null) => void;
  meta: React.ReactNode;
  messages: React.ReactNode;
}) {
  const list = extras ?? [];
  const canAdd = canAddExtra(extras);
  const setExtra = (i: number, change: Partial<FieldExtraDraft>) =>
    onChange(list.map((x, j) => (j === i ? { ...x, ...change } : x)));

  return (
    <fieldset className="space-y-2">
      <legend className="flex w-full flex-wrap items-center justify-between gap-2 text-sm font-medium">
        <span>Field extras</span>
        {meta}
      </legend>
      <p className="text-xs text-[hsl(var(--foreground-muted))]">
        Extra questions beyond the universal and category inputs, at most{' '}
        {MAX_FIELD_EXTRAS}. Each needs something downstream that reads it.{' '}
        {list.length} of {MAX_FIELD_EXTRAS} used{extras === null ? ' (not set yet)' : ''}.
      </p>
      {list.map((extra, i) => {
        const p = `${idPrefix}-extra-${i}`;
        return (
          <div key={i} className="space-y-2 rounded-[var(--radius-md)] border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor={`${p}-key`} className="text-xs font-medium">Key</label>
                <input
                  id={`${p}-key`}
                  type="text"
                  value={extra.key}
                  onChange={(e) => setExtra(i, { key: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${p}-label`} className="text-xs font-medium">Label</label>
                <input
                  id={`${p}-label`}
                  type="text"
                  value={extra.label}
                  onChange={(e) => setExtra(i, { label: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={`${p}-readby`} className="text-xs font-medium">Read by</label>
                <input
                  id={`${p}-readby`}
                  type="text"
                  value={extra.readBy}
                  onChange={(e) => setExtra(i, { readBy: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor={`${p}-type`} className="text-xs font-medium">Type</label>
                <select
                  id={`${p}-type`}
                  value={extra.type ?? 'text'}
                  onChange={(e) => setExtra(i, { type: e.target.value as FieldExtraType })}
                  className={inputClass}
                >
                  {FIELD_EXTRA_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor={`${p}-hint`} className="text-xs font-medium">Hint (optional)</label>
                <input
                  id={`${p}-hint`}
                  type="text"
                  value={extra.hint ?? ''}
                  onChange={(e) => setExtra(i, { hint: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            {(extra.binds || extra.derives) && (
              <p className="text-xs text-[hsl(var(--foreground-muted))]">
                {extra.binds ? `Asked on the universal ${extra.binds} field.` : `Prefills ${extra.derives}.`}
              </p>
            )}
            <button
              type="button"
              onClick={() => onChange(list.filter((_, j) => j !== i))}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[hsl(var(--destructive))] hover:underline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove extra {extra.key || i + 1}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...list, newFieldExtra()])}
        disabled={!canAdd}
        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Add extra
      </button>
      {messages}
    </fieldset>
  );
}

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

function FieldMeta({ source, changed }: { source: string; changed: boolean }) {
  return (
    <span className="flex items-center gap-2 text-xs font-normal">
      <span className="text-[hsl(var(--foreground-muted))]">Source: {source}</span>
      {changed && <span className="font-medium text-[hsl(var(--primary))]">Unsaved change</span>}
    </span>
  );
}

function FieldMessages({ error, problems }: { error?: string; problems?: string[] }) {
  if (!error && !problems?.length) return null;
  return (
    <ul className="space-y-0.5 text-xs text-[hsl(var(--destructive))]">
      {error && <li>{error}</li>}
      {problems?.map((m) => <li key={m}>{m}</li>)}
    </ul>
  );
}

/** Puts a list field back to "not decided yet", distinct from "none". */
function UnsetControl({ isSet, onClear }: { isSet: boolean; onClear: () => void }) {
  if (!isSet) {
    return <p className="text-xs text-[hsl(var(--foreground-muted))]">Not set yet.</p>;
  }
  return (
    <button
      type="button"
      onClick={onClear}
      className="text-xs text-[hsl(var(--foreground-muted))] underline hover:text-[hsl(var(--foreground))]"
    >
      Mark as not decided
    </button>
  );
}

function Checkbox({
  id,
  label,
  checked,
  onChange,
  disabled,
  describedBy,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-describedby={describedBy}
        className="h-4 w-4 accent-[hsl(var(--primary))] disabled:opacity-40"
      />
      <label htmlFor={id} className={cn('text-sm', disabled && 'opacity-60')}>{label}</label>
    </span>
  );
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
    >
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/** Same switch as call-gate-settings.tsx's. */
function Toggle({
  checked,
  onChange,
  ariaLabel,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-40',
        checked
          ? 'bg-[hsl(var(--primary))]'
          : 'border border-[hsl(var(--border))] bg-[hsl(var(--background-muted))]'
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1'
        )}
      />
    </button>
  );
}
