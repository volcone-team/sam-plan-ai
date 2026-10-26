import * as React from "react";
import { cn } from "@/lib/utils";
import { MAX_SCORE, SCORE_LETTERS, type ScoreBreakdown, type ScoreLetter } from "@/lib/recommend/score";
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
 * SCORE total and the five S/C/O/R/E bars, shared by the intake
 * recommendation card and the initiative detail "FIT/SCORE" card.
 *
 * Rank and the weighted total are recommendation-only and optional.
 */
export interface ScoreBreakdownData {
  total: number;
  breakdown: ScoreBreakdown;
  complete: boolean;
  /** Letters that were blank and counted as 3. */
  missing: ScoreLetter[];
  /** Only shown when a revenueWeight other than 1 is passed. */
  weightedTotal?: number;
}

export interface ScoreBreakdownViewProps {
  score: ScoreBreakdownData;
  /** 1-based SCORE position; omitted outside recommendations. */
  rank?: number | null;
  eligibleCount?: number | null;
  /** The live Revenue weight (1 = equal, the default, shows no weighted total). */
  revenueWeight?: number;
  /** The footnote under the bars. Defaults to SCORE_NOTE. */
  note?: React.ReactNode;
  /** Draw the bordered box around it (default). Off when already inside a card. */
  framed?: boolean;
  /** grid: five columns, for narrow cards (default). stacked: one row per score, for a full-width card. */
  layout?: "grid" | "stacked";
}

/**
 * Each bar carries its value as TEXT ("Speed 5 of 5") as well as length, so
 * nothing depends on colour or shape alone: the visible digit for sighted
 * users, `role="img"` + `aria-label` for screen readers.
 *
 * Two layouts: "grid" puts the five bars side by side (the recommendation
 * card); "stacked" gives each score its own row, label left, digit right,
 * full-width bar beneath (the initiative detail card).
 */
export function ScoreBreakdownView({
  score,
  rank = null,
  eligibleCount = null,
  revenueWeight = 1,
  note = SCORE_NOTE,
  framed = true,
  layout = "grid",
}: ScoreBreakdownViewProps) {
  const weighted =
    typeof score.weightedTotal === "number" ? weightedTotalLabel(score.weightedTotal, revenueWeight) : null;
  const provisional = score.complete ? null : provisionalNote(score.missing);
  return (
    <div className={cn("space-y-2", framed && "rounded-[var(--radius-md)] border border-border px-3 py-2.5")}>
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
      <ul className={layout === "stacked" ? "space-y-3" : "grid grid-cols-5 gap-2"} aria-label="Score breakdown">
        {SCORE_LETTERS.map((letter) => (
          <li key={letter}>
            <ScoreBar
              letter={letter}
              value={score.breakdown[letter]}
              missing={score.missing.includes(letter)}
              layout={layout}
            />
          </li>
        ))}
      </ul>
      {provisional && (
        <p className="text-[11px] text-[hsl(var(--foreground-muted))]">
          {provisional} <span aria-hidden="true">Marked *.</span>
        </p>
      )}
      {note && <p className="text-[11px] text-[hsl(var(--foreground-muted))]">{note}</p>}
    </div>
  );
}

export function ScoreBar({
  letter,
  value,
  missing,
  layout = "grid",
}: {
  letter: ScoreLetter;
  value: number;
  missing: boolean;
  layout?: "grid" | "stacked";
}) {
  const { label, best } = SCORE_LABELS[letter];
  const stacked = layout === "stacked";
  return (
    <div role="img" aria-label={`${barLabel(letter, value, missing)}. ${best}.`} title={best} className="space-y-1">
      <div
        className={
          stacked
            ? "flex items-baseline justify-between gap-2 text-xs"
            : "flex items-baseline justify-between gap-1 text-[11px]"
        }
        aria-hidden="true"
      >
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
              stacked ? "h-2 flex-1 rounded-full" : "h-1.5 flex-1 rounded-full",
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
