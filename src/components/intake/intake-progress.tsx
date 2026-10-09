"use client";

import { cn } from "@/lib/utils";
import type { PlanPath, ScreenId } from "@/lib/intake/flow";
import { progressFor } from "@/lib/intake/flow";

/**
 * Path-aware progress bar (REQ-1.2).
 *
 * Step and total both come from `progressFor`, which reads the one screen array
 * for the user's path. That is the whole point: Path C has 9 screens and Paths A
 * and B have 10, so a hardcoded total would tell a Path C user they are on
 * "Step 6 of 10" and leave them waiting for a tenth screen that never arrives.
 *
 * Not reusing `ui/progress-bar.tsx` — that one eases toward 90% to fake
 * progress on an async call of unknown duration. Here the progress is exactly
 * known, and an animated approximation would be wrong rather than reassuring.
 */
export function IntakeProgress({
  path,
  screen,
}: {
  path: PlanPath | null;
  screen: ScreenId;
}) {
  const { step, total, percent } = progressFor(path, screen);

  // Screen 0 is the path question itself, so there is no meaningful position
  // to report until it is answered.
  if (step === 0) return null;

  return (
    <div className="bg-background">
      <div className="mx-auto max-w-3xl px-4 py-3 sm:px-6">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
            Step {step} of {total}
          </p>
          <p className="text-xs text-[hsl(var(--foreground-muted))]">{percent}%</p>
        </div>

        <div
          role="progressbar"
          aria-valuenow={step}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`Step ${step} of ${total}`}
          className="h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--background-muted))]"
        >
          <div
            className={cn(
              "h-full rounded-full bg-[hsl(var(--primary))]",
              "transition-all duration-300 ease-out"
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
