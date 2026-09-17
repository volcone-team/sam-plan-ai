"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ProgressBarProps {
  /** Whether the operation is currently running. */
  active: boolean;
  /**
   * Rough expected duration in ms. The bar eases toward 90% over this
   * window, then holds - it does not represent real server progress, since
   * none of these AI calls report it. On completion (active -> false) it
   * jumps to 100% and fades out shortly after.
   */
  estimatedMs?: number;
  /** Optional label shown above the bar, e.g. "Generating your plan..." */
  label?: string;
  className?: string;
}

/** How often progress is recalculated. */
const TICK_MS = 120;
/** Start slightly filled so there is immediate visual feedback. */
const FLOOR = 4;
/** Ceiling while running - only completion pushes past this. */
const CEILING = 90;

/**
 * Indeterminate-duration progress bar.
 *
 * Plan generation, enhancement, and restore are single AI/DB calls that
 * report no intermediate progress - only a start and an end. This eases
 * toward 90% on a decelerating curve calibrated to estimatedMs, then snaps
 * to 100% the moment the real request finishes.
 *
 * Updates on a ~120ms interval rather than requestAnimationFrame: at 60fps
 * each new width restarted the CSS transition before it could visibly move,
 * which made the bar look frozen.
 */
export function ProgressBar({ active, estimatedMs = 30000, label, className }: ProgressBarProps) {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Running: ease toward the ceiling.
    if (active) {
      setVisible(true);
      setProgress(FLOOR);

      // Guard against 0/negative estimates (e.g. a count-derived estimate
      // where the count has already dropped to zero), which would divide by
      // zero and slam the bar straight to the ceiling.
      const est = Math.max(estimatedMs, 500);
      const start = Date.now();
      const timer = setInterval(() => {
        const elapsed = Date.now() - start;
        const ratio = 1 - Math.exp(-elapsed / (est * 0.55));
        const next = FLOOR + ratio * (CEILING - FLOOR);
        setProgress(Math.min(next, CEILING));
      }, TICK_MS);

      return () => clearInterval(timer);
    }

    // Idle. Nothing to show unless a run just completed - handled below.
    return undefined;
  }, [active, estimatedMs]);

  // Completion: fill to 100%, then hide. Split from the driver effect so the
  // interval teardown above cannot clobber the final frame.
  useEffect(() => {
    if (active || !visible) return;

    setProgress(100);
    const hide = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 600);

    return () => clearTimeout(hide);
  }, [active, visible]);

  if (!visible) return null;

  return (
    <div className={cn("w-full", className)}>
      {label && (
        <p className="mb-1.5 text-xs text-[hsl(var(--foreground-muted))]">{label}</p>
      )}
      <div
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--background-muted))]"
      >
        <div
          className="h-full rounded-full bg-[hsl(var(--primary))] transition-all duration-200 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
