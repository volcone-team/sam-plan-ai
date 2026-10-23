'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus, Trash2, Table2 } from 'lucide-react';
import { NumberInputRaw } from '@/components/ui/number-input';
import {
  PRICING_SECTIONS,
  cellFor,
  centsToDollarsInput,
  dollarsToCents,
  type PricingCellRecord,
  type PricingCellState,
  type PricingRowRecord,
  type PricingSection,
} from '@/lib/billing/pricing-table';

/**
 * Admin editor for the plan comparison table on /get-started and /choose-plan
 * (migration 050). Lives under Manage Plans on /admin/subscriptions.
 *
 * Every write goes to /api/admin/pricing-table and is followed by a reload, so
 * the screen always shows what is stored. Before 050 is applied the GET says
 * `available: false` and the editor shows a note instead of any controls.
 */

interface AdminPlan {
  id: string;
  name: string;
  is_active: boolean;
  display_order: number;
  compare_at_monthly_cents: number | null;
  price_label: string | null;
}

interface EditorData {
  available: boolean;
  message?: string;
  rows: PricingRowRecord[];
  cells: PricingCellRecord[];
  plans: AdminPlan[];
  annualNote: string | null;
  annualNoteValueCents: number | null;
}

const SECTION_TITLES: Record<PricingSection, string> = {
  included: 'Included',
  bonus: 'Bonuses',
};

const inputClass =
  'rounded-[var(--radius-md)] border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-[hsl(var(--primary))] disabled:opacity-50';

/**
 * Dollars field → the cents the API expects. A value that is not a number is
 * sent as a string so the server rejects it with a message, rather than
 * JSON.stringify turning NaN into null and silently clearing the figure.
 */
function centsField(input: string): number | null | string {
  const c = dollarsToCents(input);
  return c !== null && Number.isNaN(c) ? input : c;
}

function money(cents: number | null): string {
  if (cents == null) return '';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** Turn an API error body into one readable line. */
function describeError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as { message?: unknown; error?: unknown; errors?: unknown };
    if (typeof b.message === 'string') return b.message;
    if (b.errors && typeof b.errors === 'object') {
      const parts = Object.entries(b.errors as Record<string, string>).map(([k, v]) => `${k}: ${v}`);
      if (parts.length) return parts.join(' · ');
    }
    if (typeof b.error === 'string') return b.error;
  }
  return fallback;
}

type LoadResult = { data: EditorData } | { error: string };

async function fetchEditorData(): Promise<LoadResult> {
  try {
    const res = await fetch('/api/admin/pricing-table', { cache: 'no-store' });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { error: describeError(body, 'Could not load the comparison table.') };
    return { data: body as EditorData };
  } catch {
    return { error: 'Could not load the comparison table.' };
  }
}

export function PricingTableEditor() {
  const [data, setData] = useState<EditorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((result: LoadResult) => {
    if ('error' in result) setError(result.error);
    else setData(result.data);
    setLoading(false);
  }, []);

  const load = useCallback(async () => {
    apply(await fetchEditorData());
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    fetchEditorData().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  /** Send one write, then reload. Returns whether it succeeded. */
  const send = useCallback(
    async (method: 'POST' | 'PUT' | 'DELETE', payload?: Record<string, unknown>, query = '') => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/pricing-table${query}`, {
          method,
          headers: payload ? { 'Content-Type': 'application/json' } : undefined,
          body: payload ? JSON.stringify(payload) : undefined,
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setError(describeError(body, 'Save failed.'));
          if (res.status === 409) await load();
          return false;
        }
        await load();
        return true;
      } catch {
        setError('Save failed.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5 space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-[hsl(var(--foreground))]">
          <Table2 className="h-4 w-4" /> Comparison table
        </h2>
        <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
          The &ldquo;what you get&rdquo; table shown on the plan picker. Values are display figures only; they
          never change what anyone is charged.
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--primary))]" />
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-[var(--radius-md)] border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {!loading && data && !data.available && (
        <p className="rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {data.message ??
            'Migration 050 has not been applied yet, so the comparison table cannot be edited. Customers see the plan cards until it is.'}
        </p>
      )}

      {!loading && data?.available && (
        <EditorBody data={data} busy={busy} send={send} />
      )}
    </div>
  );
}

type Send = (
  method: 'POST' | 'PUT' | 'DELETE',
  payload?: Record<string, unknown>,
  query?: string
) => Promise<boolean>;

function EditorBody({ data, busy, send }: { data: EditorData; busy: boolean; send: Send }) {
  const activePlans = data.plans.filter((p) => p.is_active);
  const cellIndex = new Map(data.cells.map((c) => [`${c.row_id}|${c.plan_id}`, c]));

  return (
    <div className="space-y-6">
      {/* Per-plan header extras */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
          Plan columns
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {activePlans.map((plan) => (
            <PlanExtras key={plan.id} plan={plan} busy={busy} send={send} />
          ))}
        </div>
      </div>

      {/* Annual note */}
      <AnnualNote
        key={`${data.annualNote ?? ''}|${data.annualNoteValueCents ?? ''}`}
        text={data.annualNote}
        valueCents={data.annualNoteValueCents}
        busy={busy}
        send={send}
      />

      {/* Sections */}
      {PRICING_SECTIONS.map((section) => {
        const rows = data.rows
          .filter((r) => r.section === section)
          .slice()
          .sort((a, b) => a.display_order - b.display_order || a.label.localeCompare(b.label));
        return (
          <div key={section}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
              {SECTION_TITLES[section]}
            </h3>
            <div className="space-y-2">
              {rows.length === 0 && (
                <p className="text-xs text-[hsl(var(--foreground-muted))]">No rows yet.</p>
              )}
              {rows.map((row, i) => (
                <RowEditor
                  key={`${row.id}|${row.label}|${row.sublabel ?? ''}|${row.value_cents ?? ''}|${row.is_active}`}
                  row={row}
                  first={i === 0}
                  last={i === rows.length - 1}
                  plans={activePlans}
                  cellIndex={cellIndex}
                  busy={busy}
                  send={send}
                />
              ))}
              <AddRow section={section} busy={busy} send={send} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PlanExtras({ plan, busy, send }: { plan: AdminPlan; busy: boolean; send: Send }) {
  const [label, setLabel] = useState(plan.price_label ?? '');
  const [compare, setCompare] = useState(centsToDollarsInput(plan.compare_at_monthly_cents));

  const saveLabel = () => {
    if (label.trim() === (plan.price_label ?? '')) return;
    void send('PUT', { kind: 'plan', planId: plan.id, priceLabel: label }).then((ok) => {
      if (!ok) setLabel(plan.price_label ?? '');
    });
  };
  const saveCompare = () => {
    const cents = dollarsToCents(compare);
    if (cents === plan.compare_at_monthly_cents) return;
    void send('PUT', { kind: 'plan', planId: plan.id, compareAtMonthlyCents: centsField(compare) }).then((ok) => {
      if (!ok) setCompare(centsToDollarsInput(plan.compare_at_monthly_cents));
    });
  };

  return (
    <div className="rounded-[var(--radius-md)] border border-border p-3 space-y-2">
      <div className="text-sm font-medium text-[hsl(var(--foreground))]">{plan.name}</div>
      <label className="block text-[11px] text-[hsl(var(--foreground-muted))]">
        Price label
        <input
          type="text"
          value={label}
          maxLength={60}
          disabled={busy}
          placeholder="e.g. Founding Price"
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveLabel}
          className={`mt-1 w-full ${inputClass}`}
        />
      </label>
      <label className="block text-[11px] text-[hsl(var(--foreground-muted))]">
        Crossed-out monthly price ($)
        <NumberInputRaw
          value={compare}
          disabled={busy}
          placeholder="None"
          onValueChange={setCompare}
          onBlur={saveCompare}
          className={`mt-1 w-full ${inputClass}`}
        />
      </label>
    </div>
  );
}

function AnnualNote({
  text,
  valueCents,
  busy,
  send,
}: {
  text: string | null;
  valueCents: number | null;
  busy: boolean;
  send: Send;
}) {
  const [draft, setDraft] = useState(text ?? '');
  const [value, setValue] = useState(centsToDollarsInput(valueCents));
  const dirty = draft.trim() !== (text ?? '') || dollarsToCents(value) !== valueCents;

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
        Annual billing note
      </h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex-1 min-w-[220px] text-[11px] text-[hsl(var(--foreground-muted))]">
          Note
          <input
            type="text"
            value={draft}
            maxLength={300}
            disabled={busy}
            placeholder="e.g. 2 months free + onboarding call"
            onChange={(e) => setDraft(e.target.value)}
            className={`mt-1 w-full ${inputClass}`}
          />
        </label>
        <label className="w-36 text-[11px] text-[hsl(var(--foreground-muted))]">
          Value ($)
          <NumberInputRaw
            value={value}
            disabled={busy}
            placeholder="None"
            onValueChange={setValue}
            className={`mt-1 w-full ${inputClass}`}
          />
        </label>
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void send('PUT', { kind: 'note', text: draft, valueCents: centsField(value) })}
          className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 disabled:opacity-50"
        >
          Save note
        </button>
      </div>
    </div>
  );
}

/** Remounts a cell control when its stored value changes. */
function cellKey(cell: PricingCellRecord | undefined): string {
  return cell ? `${cell.included}|${cell.value_cents ?? ''}` : 'none';
}

interface RowDraft {
  label: string;
  sublabel: string;
  value: string;
  isActive: boolean;
}

function RowFields({
  draft,
  setDraft,
  busy,
}: {
  draft: RowDraft;
  setDraft: (d: RowDraft) => void;
  busy: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-[2fr_2fr_1fr]">
      <input
        type="text"
        value={draft.label}
        maxLength={200}
        disabled={busy}
        placeholder="Label"
        aria-label="Label"
        onChange={(e) => setDraft({ ...draft, label: e.target.value })}
        className={inputClass}
      />
      <input
        type="text"
        value={draft.sublabel}
        maxLength={300}
        disabled={busy}
        placeholder="Sublabel (optional)"
        aria-label="Sublabel"
        onChange={(e) => setDraft({ ...draft, sublabel: e.target.value })}
        className={inputClass}
      />
      <NumberInputRaw
        value={draft.value}
        disabled={busy}
        placeholder="Value $ (optional)"
        aria-label="Value ($)"
        onValueChange={(value) => setDraft({ ...draft, value })}
        className={inputClass}
      />
    </div>
  );
}

function RowEditor({
  row,
  first,
  last,
  plans,
  cellIndex,
  busy,
  send,
}: {
  row: PricingRowRecord;
  first: boolean;
  last: boolean;
  plans: AdminPlan[];
  cellIndex: Map<string, PricingCellRecord>;
  busy: boolean;
  send: Send;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RowDraft>({
    label: row.label,
    sublabel: row.sublabel ?? '',
    value: centsToDollarsInput(row.value_cents),
    isActive: row.is_active,
  });

  const save = async () => {
    const ok = await send('PUT', {
      kind: 'row',
      id: row.id,
      section: row.section,
      label: draft.label,
      sublabel: draft.sublabel,
      valueCents: centsField(draft.value),
      isActive: draft.isActive,
    });
    if (ok) setEditing(false);
  };

  const iconButton =
    'rounded p-1 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))] hover:text-[hsl(var(--foreground))] disabled:opacity-30';

  return (
    <div className={`rounded-[var(--radius-md)] border border-border p-3 space-y-2 ${row.is_active ? '' : 'opacity-60'}`}>
      {editing ? (
        <div className="space-y-2">
          <RowFields draft={draft} setDraft={setDraft} busy={busy} />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={draft.isActive}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              />
              Shown to customers
            </label>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded-[var(--radius-md)] border border-border px-3 py-1 text-xs">
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || draft.label.trim() === ''}
                onClick={() => void save()}
                className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1 text-xs text-[hsl(var(--primary-foreground))] disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-[hsl(var(--foreground))]">
              {row.label}
              {row.value_cents != null && (
                <span className="ml-2 text-xs font-normal text-[hsl(var(--foreground-muted))]">
                  {money(row.value_cents)} Value
                </span>
              )}
              {!row.is_active && (
                <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  Hidden
                </span>
              )}
            </div>
            {row.sublabel && (
              <div className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{row.sublabel}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="Move up" disabled={busy || first} onClick={() => void send('PUT', { kind: 'move', rowId: row.id, direction: 'up' })} className={iconButton}>
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" aria-label="Move down" disabled={busy || last} onClick={() => void send('PUT', { kind: 'move', rowId: row.id, direction: 'down' })} className={iconButton}>
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button type="button" aria-label="Edit row" disabled={busy} onClick={() => setEditing(true)} className={iconButton}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label="Delete row"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${row.label}" from the comparison table?`)) {
                  void send('DELETE', undefined, `?rowId=${encodeURIComponent(row.id)}`);
                }
              }}
              className={`${iconButton} hover:text-red-600`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {plans.map((plan) => (
          <CellControl
            key={`${plan.id}|${cellKey(cellIndex.get(`${row.id}|${plan.id}`))}`}
            rowId={row.id}
            plan={plan}
            cell={cellIndex.get(`${row.id}|${plan.id}`)}
            busy={busy}
            send={send}
          />
        ))}
      </div>
    </div>
  );
}

function CellControl({
  rowId,
  plan,
  cell,
  busy,
  send,
}: {
  rowId: string;
  plan: AdminPlan;
  cell: PricingCellRecord | undefined;
  busy: boolean;
  send: Send;
}) {
  const stored = cellFor(cell);
  const [state, setState] = useState<PricingCellState>(stored.state);
  const [value, setValue] = useState(centsToDollarsInput(stored.valueCents));

  const choose = (next: PricingCellState) => {
    setState(next);
    // "Show value" waits for a figure; the other two save at once.
    if (next !== 'value') {
      void send('PUT', { kind: 'cell', rowId, planId: plan.id, state: next }).then((ok) => {
        if (!ok) setState(stored.state);
      });
    }
  };
  const saveValue = () => {
    const cents = dollarsToCents(value);
    if (cents == null) return;
    if (stored.state === 'value' && stored.valueCents === cents) return;
    void send('PUT', { kind: 'cell', rowId, planId: plan.id, state: 'value', valueCents: centsField(value) });
  };

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="font-medium text-[hsl(var(--foreground-muted))]">{plan.name}</span>
      <select
        value={state}
        disabled={busy}
        aria-label={`${plan.name} cell`}
        onChange={(e) => choose(e.target.value as PricingCellState)}
        className={inputClass}
      >
        <option value="excluded">Not included</option>
        <option value="included">Included</option>
        <option value="value">Show value $</option>
      </select>
      {state === 'value' && (
        <NumberInputRaw
          value={value}
          disabled={busy}
          placeholder="$"
          aria-label={`${plan.name} value ($)`}
          onValueChange={setValue}
          onBlur={saveValue}
          className={`w-24 ${inputClass}`}
        />
      )}
    </div>
  );
}

function AddRow({ section, busy, send }: { section: PricingSection; busy: boolean; send: Send }) {
  const empty: RowDraft = { label: '', sublabel: '', value: '', isActive: true };
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<RowDraft>(empty);

  if (!open) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-50"
      >
        <Plus className="h-3.5 w-3.5" /> Add row
      </button>
    );
  }

  const create = async () => {
    const ok = await send('POST', {
      section,
      label: draft.label,
      sublabel: draft.sublabel,
      valueCents: centsField(draft.value),
    });
    if (ok) {
      setDraft(empty);
      setOpen(false);
    }
  };

  return (
    <div className="rounded-[var(--radius-md)] border border-dashed border-border p-3 space-y-2">
      <RowFields draft={draft} setDraft={setDraft} busy={busy} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-[var(--radius-md)] border border-border px-3 py-1 text-xs">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || draft.label.trim() === ''}
          onClick={() => void create()}
          className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1 text-xs text-[hsl(var(--primary-foreground))] disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
