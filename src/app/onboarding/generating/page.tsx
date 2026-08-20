"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";
import { planningService } from "@/services/planning.service";

const GENERATION_MESSAGES = [
  "Analyzing your business...",
  "Understanding your revenue goals...",
  "Evaluating your products and pricing...",
  "Identifying your strongest growth opportunities...",
  "Matching initiatives to your business...",
  "Building revenue projections...",
  "Creating execution-ready project plans...",
  "Preparing your annual operating system...",
  "Finalizing your personalized revenue plan...",
] as const;

/** Time each message is displayed (ms) */
const MESSAGE_DURATION = 1200;
/** Total generation time (ms) */
const TOTAL_DURATION = GENERATION_MESSAGES.length * MESSAGE_DURATION;

/**
 * AI Plan Generation loading experience.
 *
 * On mount:
 * 1. Reads saved questionnaire data from localStorage
 * 2. Calls Planning Service to persist the intake (simulated save)
 * 3. Runs the animated loading experience
 * 4. Navigates to Year-at-a-Glance on completion
 *
 * Ready for future Anthropic integration — replace the timer
 * with a real streaming AI call.
 */
export default function GeneratingPage() {
  const router = useRouter();
  const [messageIndex, setMessageIndex] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const savedRef = useRef(false);

  // Save questionnaire data via Planning Service on mount
  useEffect(() => {
    if (savedRef.current) return;
    savedRef.current = true;

    async function savePlanningInput() {
      try {
        const rawData = localStorage.getItem("sam-plan-data");
        if (!rawData) return;

        const data = JSON.parse(rawData);

        // Use the planning service to simulate saving
        // In production, this will be replaced with a real AI call
        const companyId = "comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d";

        // Check if input already exists, update or create
        const existing = await planningService.getPlanningInputByCompany(companyId);
        if (existing) {
          await planningService.updatePlanningInput(existing.id, {
            revenueGoal: data.annualRevenueGoal,
            revenueTimeframe: data.planningPeriod === "12-months" ? 12 : data.planningPeriod === "6-months" ? 6 : 3,
            monthlyMarketingBudget: data.monthlyMarketingBudget,
            teamSize: data.teamSize,
            idealCustomerDescription: data.idealCustomer,
            failedInitiatives: data.obstacleNotes,
          });
          await planningService.completePlanningInput(existing.id);
        }
      } catch {
        // Non-blocking — plan generation continues regardless
      }
    }

    savePlanningInput();
  }, []);

  const handleComplete = useCallback(() => {
    setIsFadingOut(true);
    setTimeout(() => {
      router.push("/year-at-a-glance");
    }, 600);
  }, [router]);

  // Message cycling with fade transitions
  useEffect(() => {
    const interval = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setMessageIndex((prev) => {
          const next = prev + 1;
          if (next >= GENERATION_MESSAGES.length) {
            clearInterval(interval);
            return prev;
          }
          return next;
        });
        setIsTransitioning(false);
      }, 300);
    }, MESSAGE_DURATION);

    return () => clearInterval(interval);
  }, []);

  // Completion timer
  useEffect(() => {
    const timeout = setTimeout(handleComplete, TOTAL_DURATION);
    return () => clearTimeout(timeout);
  }, [handleComplete]);

  return (
    <div
      className={cn(
        "flex min-h-dvh flex-col items-center justify-center px-4",
        "transition-opacity duration-600 ease-[var(--ease-default)]",
        isFadingOut ? "opacity-0" : "opacity-100"
      )}
    >
      <div className="flex flex-col items-center text-center max-w-md">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-12">
          <BrandLogo width={160} height={54} />
        </div>

        {/* Animated dots */}
        <div className="mb-10 flex items-center gap-1.5" aria-hidden="true">
          <span className="generating-dot h-2 w-2 rounded-[var(--radius-full)] bg-primary" />
          <span className="generating-dot h-2 w-2 rounded-[var(--radius-full)] bg-primary animation-delay-200" />
          <span className="generating-dot h-2 w-2 rounded-[var(--radius-full)] bg-primary animation-delay-400" />
        </div>

        {/* Status message with fade */}
        <p
          className={cn(
            "text-base text-[hsl(var(--foreground-muted))] min-h-[1.5rem]",
            "transition-opacity duration-300 ease-[var(--ease-default)]",
            isTransitioning ? "opacity-0" : "opacity-100"
          )}
          aria-live="polite"
          aria-atomic="true"
        >
          {GENERATION_MESSAGES[messageIndex]}
        </p>

        {/* Accessible status for screen readers */}
        <span className="sr-only" role="status">
          Generating your plan. {GENERATION_MESSAGES[messageIndex]}
        </span>
      </div>
    </div>
  );
}
