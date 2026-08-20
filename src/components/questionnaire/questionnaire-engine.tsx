"use client";

import { useReducer, useCallback, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";
import type { QuestionnaireMode } from "./questionnaire-types";
import { getStepsForMode } from "./questionnaire-config";
import {
  questionnaireReducer,
  createInitialState,
} from "./questionnaire-reducer";
import { ProgressIndicator } from "./progress-indicator";
import { StepNavigation } from "./step-navigation";
import { StepContent } from "./step-content";
import { usePersistedData } from "./use-persisted-data";
import { validateStep } from "./questionnaire-validation";

export interface QuestionnaireEngineProps {
  mode: QuestionnaireMode;
}

/**
 * Questionnaire engine — the core multi-step form framework.
 * Manages navigation state + questionnaire data + validation.
 * Auto-saves progress to localStorage.
 * Supports ?step=N URL parameter for deep-linking to a specific step.
 */
export function QuestionnaireEngine({ mode }: QuestionnaireEngineProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const steps = getStepsForMode(mode);

  // Parse initial step from URL parameter
  const initialStep = (() => {
    const stepParam = searchParams.get("step");
    if (stepParam) {
      const parsed = parseInt(stepParam, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed < steps.length) {
        return parsed;
      }
    }
    return 0;
  })();

  const [state, dispatch] = useReducer(
    questionnaireReducer,
    { mode, initialStep },
    (args) => ({ ...createInitialState(args.mode), currentStep: args.initialStep })
  );
  const { data: questionnaireData, updateData } = usePersistedData(mode);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [isAnimating, setIsAnimating] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const currentStepConfig = steps[state.currentStep];
  const isFirstStep = state.currentStep === 0;
  const isLastStep = state.currentStep === steps.length - 1;

  const animateTransition = useCallback(
    (dir: "forward" | "backward", callback: () => void) => {
      setDirection(dir);
      setIsAnimating(true);
      setTimeout(() => {
        callback();
        setTimeout(() => setIsAnimating(false), 20);
      }, 150);
    },
    []
  );

  const handleNext = useCallback(() => {
    const errors = validateStep(currentStepConfig.id, questionnaireData);
    if (Object.keys(errors).length > 0) {
      dispatch({ type: "SET_ERRORS", errors });
      return;
    }
    dispatch({ type: "CLEAR_ERRORS" });
    animateTransition("forward", () => {
      dispatch({ type: "NEXT_STEP" });
    });
  }, [currentStepConfig.id, questionnaireData, animateTransition]);

  const handlePrevious = useCallback(() => {
    animateTransition("backward", () => {
      dispatch({ type: "PREV_STEP" });
    });
  }, [animateTransition]);

  const handleGoToStep = useCallback(
    (step: number) => {
      const dir = step > state.currentStep ? "forward" : "backward";
      animateTransition(dir, () => {
        dispatch({ type: "GO_TO_STEP", step });
      });
    },
    [state.currentStep, animateTransition]
  );

  const handleAnswer = useCallback(
    (key: string, value: unknown) => {
      dispatch({ type: "SET_ANSWER", key, value });
    },
    []
  );

  const handleSubmit = useCallback(() => {
    const errors = validateStep(currentStepConfig.id, questionnaireData);
    if (Object.keys(errors).length > 0) {
      dispatch({ type: "SET_ERRORS", errors });
      return;
    }
    dispatch({ type: "SET_SUBMITTING", isSubmitting: true });
    router.push("/onboarding/review");
  }, [currentStepConfig.id, questionnaireData, router]);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/onboarding"
            className="flex items-center gap-2 text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Back</span>
          </Link>
          <div className="flex items-center gap-2">
            <BrandLogo />
          </div>
          <div className="w-16" />
        </div>
      </header>

      {/* Progress bar */}
      <ProgressIndicator
        steps={steps}
        currentStep={state.currentStep}
        onStepClick={handleGoToStep}
      />

      {/* Content with animated transitions */}
      <main className="flex-1 px-4 sm:px-6">
        <div className="mx-auto max-w-3xl">
          <div
            ref={contentRef}
            className={cn(
              "transition-all duration-200 ease-[var(--ease-default)]",
              isAnimating && direction === "forward" && "opacity-0 translate-x-4",
              isAnimating && direction === "backward" && "opacity-0 -translate-x-4",
              !isAnimating && "opacity-100 translate-x-0"
            )}
          >
            <StepContent
              step={currentStepConfig}
              answers={state.answers}
              errors={state.errors}
              onAnswer={handleAnswer}
              questionnaireData={questionnaireData}
              onDataChange={updateData}
            />
          </div>

          {/* Navigation */}
          <StepNavigation
            currentStep={state.currentStep}
            totalSteps={steps.length}
            isSubmitting={state.isSubmitting}
            isFirstStep={isFirstStep}
            isLastStep={isLastStep}
            onPrevious={handlePrevious}
            onNext={handleNext}
            onSubmit={handleSubmit}
          />
        </div>
      </main>
    </div>
  );
}
