import type { StepConfig } from "./questionnaire-types";

export interface ProgressIndicatorProps {
  steps: StepConfig[];
  currentStep: number;
  onStepClick?: (step: number) => void;
}

/**
 * Minimal progress bar for the questionnaire.
 * A single thin horizontal bar that animates smoothly between steps.
 * No numbers, no step names, no dots.
 */
export function ProgressIndicator({
  steps,
  currentStep,
}: ProgressIndicatorProps) {
  const progress = ((currentStep + 1) / steps.length) * 100;

  return (
    <div className="w-full" role="progressbar" aria-valuenow={currentStep + 1} aria-valuemin={1} aria-valuemax={steps.length} aria-label={`Step ${currentStep + 1} of ${steps.length}`}>
      <div className="h-0.5 w-full bg-[hsl(var(--border))] overflow-hidden">
        <div
          className="h-full bg-primary transition-[width] duration-500 ease-[var(--ease-default)]"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
