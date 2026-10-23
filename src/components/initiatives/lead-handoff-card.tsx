'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { Initiative } from '@/types';
import {
  handoffOptions,
  handoffWarnings,
  isLeadGen,
  leadSources,
  resolveHandoff,
} from '@/lib/initiatives/lead-handoff';

export interface LeadHandoffCardProps {
  initiative: Initiative;
  /** The company's initiatives, as loaded. A handoff id not among them reads as blank. */
  all: readonly Initiative[];
  canEdit: boolean;
  /** Called with the initiative's new attrs after a successful save. */
  onSaved: (attrs: Record<string, unknown>) => void;
}

const LINK_CLASS = 'font-medium text-[hsl(var(--primary))] hover:underline';

/**
 * Where a lead-gen initiative's leads go ("Leads go to: X", or the $0 warning),
 * with a small editor; and on a receiving initiative, where its leads come
 * from. Renders nothing for an initiative that is neither.
 */
export function LeadHandoffCard({ initiative, all, canEdit, onSaved }: LeadHandoffCardProps) {
  const leadGen = isLeadGen(initiative);
  const receiving = resolveHandoff(initiative, all);
  const sources = leadSources(initiative, all);
  const options = useMemo(
    () => handoffOptions(all, { id: initiative.id, annualPlanId: initiative.annualPlanId }),
    [all, initiative.id, initiative.annualPlanId]
  );

  const savedId = receiving?.id ?? '';
  const [choice, setChoice] = useState<string>(savedId);
  const [syncedId, setSyncedId] = useState<string>(savedId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reset the picker when the saved handoff changes (adjust-state-during-render,
  // per React's "you might not need an effect").
  if (syncedId !== savedId) {
    setSyncedId(savedId);
    setChoice(savedId);
  }

  if (!leadGen && sources.length === 0) return null;

  const warnings = leadGen ? handoffWarnings(initiative, receiving) : [];
  const dirty = choice !== savedId;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/initiatives/${initiative.id}/handoff`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handoffTo: choice || null }),
      });
      const body = (await res.json().catch(() => ({}))) as { attrs?: Record<string, unknown>; error?: string };
      if (!res.ok || !body.attrs) throw new Error(body.error || `Could not save (${res.status}).`);
      onSaved(body.attrs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save where the leads go.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label="Lead handoff"
      className="space-y-2 rounded-[var(--radius-lg)] border border-border bg-card p-4 text-sm"
    >
      {leadGen && receiving && (
        <p>
          Leads go to:{' '}
          <Link href={`/initiatives/${receiving.id}`} className={LINK_CLASS}>
            {receiving.name}
          </Link>
        </p>
      )}
      {warnings.map(w => (
        <p key={w} role="status" className="flex gap-1.5 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {w}
        </p>
      ))}
      {leadGen && canEdit && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <label htmlFor={`handoff-${initiative.id}`} className="text-xs text-[hsl(var(--foreground-muted))]">
            Where do these leads go?
          </label>
          <select
            id={`handoff-${initiative.id}`}
            value={choice}
            onChange={e => setChoice(e.target.value)}
            disabled={saving}
            className="rounded-[var(--radius-md)] border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">Decide later</option>
            {options.map(o => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1 text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {sources.length > 0 && (
        <p>
          Receives leads from:{' '}
          {sources.map((s, n) => (
            <span key={s.id}>
              {n > 0 && ', '}
              <Link href={`/initiatives/${s.id}`} className={LINK_CLASS}>
                {s.name}
              </Link>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
