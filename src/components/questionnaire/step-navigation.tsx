import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface StepNavigationProps {
  currentStep: number;
  totalSteps: number;
  isSubmitting: boolean;
  isFirstStep: boolean;
  isLastStep: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSubmit: () => void;
  className?: string;
}

/**
 * Step navigation controls (Previous / Next / Submit).
 * Shows appropriate buttons based on current position.
 */
export function StepNavigation({
  isSubmitting,
  isFirstStep,
  isLastStep,
  onPrevious,
  onNext,
  onSubmit,
  className,
}: StepNavigationProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between pt-6 border-t border-border",
        className
      )}
    >
      {/* Previous button */}
      <div>
        {!isFirstStep && (
          <Button
            type="button"
            variant="ghost"
            onClick={onPrevious}
            disabled={isSubmitting}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Previous
          </Button>
        )}
      </div>

      {/* Next / Submit button */}
      <div>
        {isLastStep ? (
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                Generate My Plan
                <ArrowRight className="ml-1 h-4 w-4" />
              </>
            )}
          </Button>
        ) : (
          <Button type="button" onClick={onNext} disabled={isSubmitting}>
            Next
            <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
