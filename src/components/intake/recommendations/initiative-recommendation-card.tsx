"use client";

import * as React from "react";
import { Check, X, Shuffle, Info, Undo2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format-money";
import { BENCHMARK_NOTICE } from "@/lib/intake/schema";
import { MAX_SCORE, SCORE_LETTERS, type ScoreBreakdown, type ScoreLetter } from "@/lib/recommend/score";
import type { RecommendationExplanation } from "@/lib/recommend/explain";
import {
  SCORE_LABELS,
  SCORE_NOTE,
  barLabel,
  formatTotal,
  provisionalNote,
  rankLabel,
  weightedTotalLabel,
} from "@/lib/recommend/score-display";

/**
 * One recommendation card (REQ-13.4, REQ-13.6, REQ-13.14).
 *
 * Shows name, products, start month, forecast, effort and why it fits. The
 * benchmark notice appears ONLY on benchmark-derived forecasts — putting it on a
 * figure the user supplied themselves would undermine their own numbers, and
 * omitting it from one we estimated would present a guess as fact.
 */

export interface RecommendationCardData {
  key: string;
  name: string;
  oneLiner: string | null;
  difficulty: number | null;
  speedToResults: string | null;
  forecast: number;
  fromBenchmarks: boolean;
  why: string | null;
  /** Product names, resolved for display. */
  productNames: string[];
  startMonth: string | null;
  /** Tells same-name variants apart ("Your own stage", a category). See display-name.ts. */
  subtitle?: string | null;
  /** SCORE, or null on a response from before scores existed. */
  score?: CardScore | null;
  /** 1-based SCORE position in the eligible pool. */
  rank?: number | null;
  /** How many initiatives were ranked, for "#1 of 33". */
  eligibleCount?: number | null;
  /** The live Revenue weight (1 = equal). */
  revenueWeight?: number;
  explanation?: RecommendationExplanation | null;
}

export interface CardScore {
  total: number;
  weightedTotal: number;
  breakdown: ScoreBreakdown;
  complete: boolean;
  /** Letters that were blank and counted as 3. */
  missing: ScoreLetter[];
}

export interface RecommendationCardProps {
  data: RecommendationCardData;
  /** "Suggested" on Path A, "Recommended" on B and C. */
  badge?: string | null;
  accepted: boolean;
  dismissed: boolean;
  /**
   * Whether this card's slot has any alternative to cycle to.
   *
   * PER SLOT, not a global "pool exhausted" flag. Swapping now walks a ring
   * that wraps back to the original, so this is false only when the slot has
   * nothing but its original recommendation — never because earlier swaps used
   * something up.
   */
  canSwap: boolean;
  onAccept: () => void;
  onDismiss: () => void;
  onRestore: () => void;
  onSwap: () => void;
}

export function RecommendationCard({
  data,
  badge,
  accepted,
  dismissed,
  canSwap,
  onAccept,
  onDismiss,
  onRestore,
  onSwap,
}: RecommendationCardProps) {
  /**
   * A dismissed card collapses but STAYS on screen with an Undo (REQ-13.7).
   * Removing it entirely would make an accidental dismiss unrecoverable, and
   * these are only held locally until "Build my plan".
   */
  if (dismissed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-dashed border-border px-4 py-3">
        <p className="text-sm text-[hsl(var(--foreground-muted))] line-through">
          {data.name}
        </p>
        <button
          type="button"
          onClick={onRestore}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background-muted))] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          Undo
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "space-y-3 rounded-[var(--radius-lg)] border p-4 transition-colors",
        accepted
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.06)]"
          : "border-border"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{data.name}</h3>
            {badge && (
              <span className="rounded-full bg-[hsl(var(--background-muted))] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                {badge}
              </span>
            )}
          </div>
          {data.subtitle && (
            <p className="text-xs font-medium text-[hsl(var(--foreground-muted))]">{data.subtitle}</p>
          )}
          {data.oneLiner && (
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              {data.oneLiner}
            </p>
          )}
        </div>

        <div className="text-right">
          <p className="text-xs text-[hsl(var(--foreground-muted))]">Forecast</p>
          <p className="text-lg font-semibold tabular-nums text-foreground">
            {formatMoney(data.forecast)}
          </p>
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[hsl(var(--foreground-muted))]">
        {data.productNames.length > 0 && (
          <Detail label="Sells">{data.productNames.join(", ")}</Detail>
        )}
        {data.startMonth && <Detail label="Starts">{data.startMonth}</Detail>}
        {data.difficulty !== null && (
          <Detail label="Effort">{effortLabel(data.difficulty)}</Detail>
        )}
        {data.speedToResults && <Detail label="Results">{data.speedToResults}</Detail>}
      </dl>

      {data.score && (
        <ScoreBreakdownView
          score={data.score}
          rank={data.rank ?? null}
          eligibleCount={data.eligibleCount ?? null}
          revenueWeight={data.revenueWeight ?? 1}
        />
      )}

      {/* REQ-13.4 — why it fits, from the model where available. Always visible. */}
      {(data.explanation?.whyFits || data.why) && (
        <p className="rounded-[var(--radius-md)] bg-[hsl(var(--background-muted))] px-3 py-2 text-xs text-foreground">
          {data.explanation?.whyFits || data.why}
        </p>
      )}

      {data.explanation && <ExplanationDetails explanation={data.explanation} />}

      {/* REQ-13.6 — only when the figure is ours, not theirs. */}
      {data.fromBenchmarks && (
        <p className="flex items-start gap-1.5 text-xs italic text-[hsl(var(--foreground-muted))]">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {BENCHMARK_NOTICE}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={onAccept}
          aria-pressed={accepted}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            accepted
              ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
              : "border border-input text-foreground hover:bg-[hsl(var(--background-muted))]"
          )}
        >
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          {accepted ? "Added" : "Add to plan"}
        </button>

        <button
          type="button"
          onClick={onSwap}
          // Disabled rather than silently inert: a control that stops
          // responding reads as a bug (D3).
          disabled={!canSwap}
          title={
            canSwap
              ? "Show me a different initiative — keep clicking to cycle back to this one"
              : "No other initiative fits your answers for this slot"
          }
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-input px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-[hsl(var(--background-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Shuffle className="h-3.5 w-3.5" aria-hidden="true" />
          Swap
        </button>

        <button
          type="button"
          onClick={onDismiss}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-xs text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background-muted))] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          Not for me
        </button>
      </div>
    </div>
  );
}

/**
 * Rank, total and the five S/C/O/R/E bars.
 *
 * Each bar carries its value as TEXT ("Speed 5 of 5") as well as length, so
 * nothing depends on colour or shape alone: the visible digit for sighted
 * users, `role="img"` + `aria-label` for screen readers.
 */
function ScoreBreakdownView({
  score,
  rank,
  eligibleCount,
  revenueWeight,
}: {
  score: CardScore;
  rank: number | null;
  eligibleCount: number | null;
  revenueWeight: number;
}) {
  const weighted = weightedTotalLabel(score.weightedTotal, revenueWeight);
  const note = score.complete ? null : provisionalNote(score.missing);

  return (
    <div className="space-y-2 rounded-[var(--radius-md)] border border-border px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-[hsl(var(--foreground-muted))]">
          {rank !== null && (
            <span className="font-semibold text-foreground">{rankLabel(rank, eligibleCount)}</span>
          )}
          <span>
            SCORE{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {formatTotal(score.total)}
            </span>
          </span>
          {weighted && <span className="tabular-nums">({weighted})</span>}
        </p>
        {!score.complete && (
          <span className="rounded-full bg-[hsl(var(--warning)_/_0.15)] px-2 py-0.5 text-[10px] font-medium text-foreground">
            Provisional score
          </span>
        )}
      </div>

      <ul className="grid grid-cols-5 gap-2" aria-label="Score breakdown">
        {SCORE_LETTERS.map((letter) => (
          <li key={letter}>
            <ScoreBar
              letter={letter}
              value={score.breakdown[letter]}
              missing={score.missing.includes(letter)}
            />
          </li>
        ))}
      </ul>

      {note && (
        <p className="text-[11px] text-[hsl(var(--foreground-muted))]">
          {note} <span aria-hidden="true">Marked *.</span>
        </p>
      )}
      <p className="text-[11px] text-[hsl(var(--foreground-muted))]">{SCORE_NOTE}</p>
    </div>
  );
}

function ScoreBar({ letter, value, missing }: { letter: ScoreLetter; value: number; missing: boolean }) {
  const { label, best } = SCORE_LABELS[letter];
  return (
    <div role="img" aria-label={`${barLabel(letter, value, missing)}. ${best}.`} title={best} className="space-y-1">
      <div className="flex items-baseline justify-between gap-1 text-[11px]" aria-hidden="true">
        <span className="truncate text-[hsl(var(--foreground-muted))]">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">
          {value}
          {missing && "*"}
        </span>
      </div>
      <div className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: MAX_SCORE }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i < value
                ? missing
                  ? "border border-dashed border-[hsl(var(--primary))] bg-transparent"
                  : "bg-[hsl(var(--primary))]"
                : "bg-[hsl(var(--background-muted))]"
            )}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * "Why this?" — what to track, what to watch out for, and a readiness
 * checklist, collapsed so the card stays compact.
 *
 * The checklist is LOCAL state only: it is there to make the user think, not
 * to gate anything, and it is not saved.
 */
function ExplanationDetails({ explanation }: { explanation: RecommendationExplanation }) {
  const [open, setOpen] = React.useState(false);
  const [ready, setReady] = React.useState<ReadonlySet<number>>(new Set());
  const panelId = React.useId();
  const baseId = React.useId();

  const hasDetails =
    explanation.whatToTrack.length > 0 ||
    Boolean(explanation.watchOutFor) ||
    explanation.readinessQuestions.length > 0;

  const sourceNote = explanation.source === "ai" ? "Written by AI" : "Based on our scoring";

  if (!hasDetails) {
    return <p className="text-[11px] text-[hsl(var(--foreground-muted))]">{sourceNote}</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-[var(--radius-md)] px-1.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-[hsl(var(--background-muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
          Why this?
        </button>
        <p className="text-[11px] text-[hsl(var(--foreground-muted))]">{sourceNote}</p>
      </div>

      <div id={panelId} hidden={!open} className="space-y-3 px-1.5 text-xs text-foreground">
        {explanation.whatToTrack.length > 0 && (
          <div className="space-y-1">
            <p className="font-semibold">What to track</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[hsl(var(--foreground-muted))]">
              {explanation.whatToTrack.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}

        {explanation.watchOutFor && (
          <div className="space-y-1">
            <p className="font-semibold">Watch out for</p>
            <p className="text-[hsl(var(--foreground-muted))]">{explanation.watchOutFor}</p>
          </div>
        )}

        {explanation.readinessQuestions.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="mb-1 font-semibold">Before you start</legend>
            {explanation.readinessQuestions.map((question, index) => {
              const id = `${baseId}-ready-${index}`;
              return (
                <div key={question} className="flex items-start gap-2">
                  <input
                    id={id}
                    type="checkbox"
                    checked={ready.has(index)}
                    onChange={() =>
                      setReady((prev) => {
                        const next = new Set(prev);
                        if (next.has(index)) next.delete(index);
                        else next.add(index);
                        return next;
                      })
                    }
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))]"
                  />
                  <label htmlFor={id} className="text-[hsl(var(--foreground-muted))]">
                    {question}{" "}
                    <span className="font-medium text-foreground">
                      {ready.has(index) ? "Yes" : "Not yet"}
                    </span>
                  </label>
                </div>
              );
            })}
          </fieldset>
        )}
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="flex gap-1">
      <dt>{label}:</dt>
      <dd className="font-medium text-foreground">{children}</dd>
    </span>
  );
}

/**
 * The workbook's 1-5 difficulty, in words.
 *
 * Numbers invite comparison the scale does not support — a 4 is not "twice" a
 * 2 — and "Heavy lift" tells the user what they need to know about their own
 * capacity.
 */
function effortLabel(difficulty: number): string {
  if (difficulty <= 1) return "Very light";
  if (difficulty === 2) return "Light";
  if (difficulty === 3) return "Moderate";
  if (difficulty === 4) return "Heavy";
  return "Very heavy";
}
