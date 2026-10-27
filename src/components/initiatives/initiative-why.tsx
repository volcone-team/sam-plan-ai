'use client';

import { useEffect, useId, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import type { InitiativeType } from '@/types/initiative-type.types';
import type { ContextEntry } from '@/lib/workbook/read';
import { whySections, type WhySection } from '@/lib/initiatives/why-content';
import type { AiContextResponse, WhyScore } from '@/lib/initiatives/why-score';
import { ScoreBreakdownView } from '@/components/recommend/score-breakdown';
export interface InitiativeWhyProps {
  initiativeId: string;
  /** The initiative's workbook library key; no key means no workbook lookup. */
  libraryKey?: string | null;
  initiativeType: InitiativeType | null;
  /**
   * Show the "Why This Initiative" heading and its "When to use" card.
   * False leaves only the Difficulty Dimensions card. Default true.
   */
  showWhy?: boolean;
}
const FIT_SCORE_NOTE =
  "FIT: initiatives that don't match your industry, your product's price, or need a team you don't have are filtered out. " +
  'SCORE: each is rated 1 to 5 on Speed, Cost, Odds of success, Revenue potential and Ease (5 is always best), added up out of 25.';
interface WhyData {
  entry: ContextEntry | null;
  score: WhyScore | null;
}
const EMPTY: WhyData = { entry: null, score: null };
/**
 * The workbook AI Context entry and library SCORE for this initiative.
 * `undefined` while loading; both fields null when there is no library key or
 * the fetch failed (the left card falls back to the type description, the
 * right card hides).
 */
function useWhyData(initiativeId: string, libraryKey: string | null | undefined) {
  const [data, setData] = useState<WhyData | undefined>(libraryKey ? undefined : EMPTY);
  useEffect(() => {
    if (!libraryKey) {
      setData(EMPTY);
      return;
    }
    let cancelled = false;
    setData(undefined);
    fetch(`/api/initiatives/${initiativeId}/ai-context`, { cache: 'no-store' })
      .then(async res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as Partial<AiContextResponse>;
        if (!cancelled) setData({ entry: body.entry ?? null, score: body.score ?? null });
      })
      .catch(err => {
        console.error('[initiative-why] AI context unavailable:', err);
        if (!cancelled) setData(EMPTY);
      });
    return () => {
      cancelled = true;
    };
  }, [initiativeId, libraryKey]);
  return data;
}
function WhyField({ section, first }: { section: WhySection; first: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const textId = useId();
  const clamped = section.long && !expanded;

  return (
    <div className={first ? undefined : 'pt-4 border-t border-border'}>
      <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-2">{section.heading}</h3>
      <p
        id={textId}
        className={`text-sm leading-relaxed whitespace-pre-line text-[hsl(var(--foreground-muted))] ${
          clamped ? 'line-clamp-6' : ''
        }`}
      >
        {section.text}
      </p>
      {section.long && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-controls={textId}
          className="mt-2 text-xs font-medium text-[hsl(var(--primary))] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] rounded-sm"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/**
 * "Why This Initiative" section.
 * Left: "When to use" from the workbook AI Context (falls back to the type
 * description). Right: Difficulty Dimensions, with the FIT/SCORE breakdown
 * from the workbook library row. Either card hides when it has nothing to
 * show; a lone card takes the full width.
 */
export function InitiativeWhy({ initiativeId, libraryKey, initiativeType, showWhy = true }: InitiativeWhyProps) {
  const data = useWhyData(initiativeId, libraryKey);
  // Render nothing until the lookup settles, so the old description does not
  // flash before the workbook text replaces it.
  if (data === undefined) return null;
  const sections = showWhy ? whySections(data.entry, initiativeType?.aiContext?.description) : [];
  const score = data.score;
  if (sections.length === 0 && !score) return null;
  const both = sections.length > 0 && score !== null;
  return (
    <section aria-labelledby={showWhy ? 'why-heading' : undefined} aria-label={showWhy ? undefined : 'Difficulty Dimensions'}>
      {showWhy && (
        <h2 id="why-heading" className="text-lg font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-[hsl(var(--warning))]" />
          Why This Initiative
        </h2>
      )}
      <div className={`${showWhy ? 'mt-4 ' : ''}grid gap-6 ${both ? 'md:grid-cols-2' : ''}`}>
        {sections.length > 0 && (
          <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-5">
            {sections.map((s, i) => (
              <WhyField key={s.heading} section={s} first={i === 0} />
            ))}
          </div>
        )}
        {score && (
          <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Difficulty Dimensions</h3>
            <h4 className="mt-1 mb-3 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">FIT/SCORE</h4>
            <ScoreBreakdownView score={score} note={FIT_SCORE_NOTE} framed={false} layout="stacked" />
          </div>
        )}
      </div>
    </section>
  );
}
