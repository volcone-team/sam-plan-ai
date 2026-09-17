"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";
import { Button } from "@/components/ui/button";
import { planningService } from "@/services/planning.service";
import { useToast } from "@/components/ui/toast";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useAuth } from "@/hooks/use-auth";

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

/** How long each status message is shown (ms) */
const MESSAGE_DURATION = 1800;

type Phase = "working" | "error";

/**
 * AI plan generation screen.
 *
 * The redirect is driven by the API call completing, not a timer, so the
 * user is never sent to an empty dashboard while generation is still running.
 */
export default function GeneratingPage() {
  const router = useRouter();
  const { userId, companyId, loading: authLoading } = useAuth();
  const { showToast } = useToast();

  const [messageIndex, setMessageIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [phase, setPhase] = useState<Phase>("working");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const startedRef = useRef(false);

  const goToDashboard = useCallback(() => {
    setIsFadingOut(true);
    setTimeout(() => router.push("/year-at-a-glance"), 600);
  }, [router]);

  // Anonymous visitors finish the questionnaire before they have an account.
  // Send them to signup and resume here afterwards.
  // If there's no draft data, skip this screen entirely.
  useEffect(() => {
    if (authLoading) return;
    if (!userId) {
      router.push("/auth/signup?next=/onboarding/generating");
      return;
    }
    // No questionnaire data means user landed here directly (e.g. after signup
    // via the login button). Skip the generating screen entirely.
    if (!localStorage.getItem("sam-plan-data")) {
      router.replace("/year-at-a-glance");
    }
  }, [authLoading, userId, router]);

  // Persist answers, then generate the plan. Redirect only once done.
  useEffect(() => {
    if (authLoading || !userId || !companyId) return;
    if (startedRef.current) return;
    startedRef.current = true;

    async function generate() {
      const rawData = localStorage.getItem("sam-plan-data");

      // Nothing to generate from - just move along.
      if (!rawData) {
        goToDashboard();
        return;
      }

      const data = JSON.parse(rawData);

      try {
        // 1. Save the raw questionnaire answers.
        const answers = {
          revenueGoal: Number(data.annualRevenueGoal) || 0,
          revenueTimeframe: (data.planningPeriod === "6-months"
            ? 6
            : data.planningPeriod === "3-months"
              ? 3
              : 12) as 3 | 6 | 12,
          monthlyMarketingBudget: Number(data.monthlyMarketingBudget) || 0,
          teamSize: Number(data.teamSize) || 1,
          idealCustomerDescription: data.idealCustomer || "",
          failedInitiatives: data.obstacleNotes || "",
        };

        const existing = await planningService.getPlanningInputByCompany(companyId!);
        const saved = existing
          ? await planningService.updatePlanningInput(existing.id, answers)
          : await planningService.createPlanningInput({
              companyId: companyId!,
              intakeRoute: "full",
              productIds: [],
              ...answers,
            });
        await planningService.completePlanningInput(saved.id);

        // 2. Reset old plan data before regenerating.
        //    "scratch" mode = selective reset (keep past/in-progress, delete only
        //    upcoming not-started initiatives). Otherwise fall back to full reset
        //    (first-time generation, nothing to keep).
        const regenMode = localStorage.getItem("sam-regen-mode");
        const resetEndpoint =
          regenMode === "scratch" ? "/api/plan/reset-scratch" : "/api/plan/reset";
        console.log("[generating] Resetting old plan data via:", resetEndpoint, "(mode:", regenMode || "none", ")");

        const resetRes = await fetch(resetEndpoint, { method: "DELETE" });
        if (resetRes.ok) {
          const resetData = await resetRes.json().catch(() => ({}));
          console.log("[generating] Plan reset successful:", resetData);
        } else {
          const resetData = await resetRes.json().catch(() => ({}));
          console.warn("[generating] Plan reset partial/failed:", resetData.error || resetRes.status);
          // Non-fatal: continue with generation even if reset partially fails
        }

        // Clear the regen-mode flag now that reset has run.
        localStorage.removeItem("sam-regen-mode");

        // 3. Generate the plan. Read as text first so a non-JSON error
        //    response (crash, gateway timeout) still yields a real message.
        showToast(
          "Building your plan can take up to a minute - the AI is working through your answers in detail.",
          { variant: "wait", duration: 15000 }
        );
        const res = await fetch("/api/generate-plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionnaire: data }),
        });

        const raw = await res.text();
        let parsed: any = null;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          /* response was not JSON */
        }

        if (!res.ok) {
          const detail =
            parsed?.error ||
            (raw ? raw.slice(0, 300) : `Request failed with status ${res.status} (empty response)`);
          console.error("[onboarding] plan generation failed", {
            status: res.status,
            statusText: res.statusText,
            rawLength: raw.length,
            rawPreview: raw.slice(0, 500),
            parsed,
          });
          setErrorMessage(`${detail} (status ${res.status})`);
          setPhase("error");
          return;
        }

        // 3. Success - clear the draft so signup cannot loop back here.
        localStorage.removeItem("sam-plan-data");
        goToDashboard();
      } catch (err) {
        console.error("[onboarding] plan generation threw", err);
        setErrorMessage(
          err instanceof Error ? err.message : "Could not generate your plan."
        );
        setPhase("error");
      }
    }

    generate();
  }, [authLoading, userId, companyId, attempt, goToDashboard]);

  // Cycle the status messages, holding on the last one until the API returns.
  useEffect(() => {
    if (phase !== "working") return;

    const interval = setInterval(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setMessageIndex((prev) =>
          prev + 1 >= GENERATION_MESSAGES.length ? prev : prev + 1
        );
        setIsTransitioning(false);
      }, 300);
    }, MESSAGE_DURATION);

    return () => clearInterval(interval);
  }, [phase]);

  const handleRetry = () => {
    setErrorMessage(null);
    setPhase("working");
    setMessageIndex(0);
    startedRef.current = false;
    setAttempt((n) => n + 1);
  };

  if (phase === "error") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="flex w-full max-w-md flex-col items-center text-center">
          <div className="mb-10">
            <BrandLogo width={160} height={54} />
          </div>

          <h1 className="text-xl font-semibold">We could not finish your plan</h1>
          <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
            Your answers are saved, so nothing is lost. You can try again.
          </p>

          {errorMessage && (
            <p
              role="alert"
              className="mt-4 w-full rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-2 text-left text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
            >
              {errorMessage}
            </p>
          )}

          <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={handleRetry}>Try again</Button>
            <Button variant="outline" onClick={goToDashboard}>
              Skip for now
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-dvh flex-col items-center justify-center px-4",
        "transition-opacity duration-600 ease-[var(--ease-default)]",
        isFadingOut ? "opacity-0" : "opacity-100"
      )}
    >
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-12 flex items-center gap-2.5">
          <BrandLogo width={160} height={54} />
        </div>

        <div className="mb-10 flex items-center gap-1.5" aria-hidden="true">
          <span className="generating-dot h-2 w-2 rounded-[var(--radius-full)] bg-primary" />
          <span className="generating-dot h-2 w-2 rounded-[var(--radius-full)] bg-primary animation-delay-200" />
          <span className="generating-dot h-2 w-2 rounded-[var(--radius-full)] bg-primary animation-delay-400" />
        </div>

        <p
          className={cn(
            "min-h-[1.5rem] text-base text-[hsl(var(--foreground-muted))]",
            "transition-opacity duration-300 ease-[var(--ease-default)]",
            isTransitioning ? "opacity-0" : "opacity-100"
          )}
          aria-live="polite"
          aria-atomic="true"
        >
          {GENERATION_MESSAGES[messageIndex]}
        </p>

        <ProgressBar active={phase === "working"} estimatedMs={35000} className="mt-5 max-w-xs" />

        <p className="mt-3 text-xs text-[hsl(var(--foreground-subtle))]">
          This usually takes 20-40 seconds. Please keep this tab open.
        </p>

        <span className="sr-only" role="status">
          Generating your plan. {GENERATION_MESSAGES[messageIndex]}
        </span>
      </div>
    </div>
  );
}
