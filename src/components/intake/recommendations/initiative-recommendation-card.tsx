"use client";

import { Check, X, Shuffle, Info, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format-money";
import { BENCHMARK_NOTICE } from "@/lib/intake/schema";

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
}

export interface RecommendationCardProps {
  data: RecommendationCardData;
  /** "Suggested" on Path A, "Recommended" on B and C. */
  badge?: string | null;
  accepted: boolean;
  dismissed: boolean;
  /** False once the eligible pool is exhausted, which disables swap (D3). */
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

      {/* REQ-13.4 — one line on why it fits, from the model where available. */}
      {data.why && (
        <p className="rounded-[var(--radius-md)] bg-[hsl(var(--background-muted))] px-3 py-2 text-xs text-foreground">
          {data.why}
        </p>
      )}

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
              ? "Show me a different initiative"
              : "No other initiatives fit your answers"
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
