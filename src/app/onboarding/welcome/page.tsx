"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, Lock } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { NumberInputRaw } from "@/components/ui/number-input";
import { useAuth, useCompanyId } from "@/hooks/use-auth";
import { initiativeService } from "@/services/initiative.service";
import { resultService } from "@/services/result.service";
import { cacheInvalidatePrefix, CacheKeys } from "@/lib/client-cache";
import { toDateOnly } from "@/lib/plan-dates";

/**
 * Post-signup welcome / onboarding launch screen.
 *
 * The three steps UNLOCK from real data rather than being hardcoded: step 2
 * opens once a plan has been generated, step 3 once there is a plan to record
 * against. Generation returns the user here (see onboarding/generating) so the
 * next step is visibly unlocked instead of dropping them on the dashboard with
 * no sense of progress.
 */
export default function OnboardingWelcomePage() {
  const router = useRouter();
  const { firstName } = useAuth();
  const companyId = useCompanyId() || "";
  const greetingName = firstName?.trim() || "there";

  const [loading, setLoading] = useState(true);
  /** A plan exists once initiatives have been generated. */
  const [hasPlan, setHasPlan] = useState(false);
  /** Whether any actuals have been logged, which completes step 3. */
  const [hasResults, setHasResults] = useState(false);
  const [firstInitiativeId, setFirstInitiativeId] = useState<string | null>(null);

  const [revenue, setRevenue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const initiatives = await initiativeService.getInitiativesByCompany(companyId);
        if (cancelled) return;
        setHasPlan(initiatives.length > 0);
        setFirstInitiativeId(initiatives[0]?.id ?? null);

        // Wide window: any logged result at all completes the step.
        const now = new Date();
        const results = await resultService.getResultsByDateRange(
          new Date(now.getFullYear() - 2, 0, 1),
          new Date(now.getFullYear() + 2, 11, 31),
          companyId
        );
        if (cancelled) return;
        setHasResults(results.length > 0);
        if (cancelled) return;
      } catch (err) {
        console.error("[onboarding/welcome] progress load failed:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  /**
   * Record the first number. Results are stored per week, so last month is
   * recorded as a single period spanning that month - enough to show actual
   * against plan, which is the point of the step.
   */
  const saveFirstNumber = async () => {
    if (!firstInitiativeId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      await resultService.createInitiativeResult({
        companyId,
        initiativeId: firstInitiativeId,
        weekStartDate: start,
        weekEndDate: end,
        actualRevenue: Number(revenue) || 0,
        actualSpend: 0,
        notes: `First recorded revenue for ${toDateOnly(start).slice(0, 7)}`,
      });
      cacheInvalidatePrefix(CacheKeys.planPrefix);
      router.push("/year-at-a-glance");
    } catch (err) {
      console.error("[onboarding/welcome] save failed:", err);
      setSaveError("Could not save that number. Please try again.");
      setSaving(false);
    }
  };

  const questionnaireDone = hasPlan;

  return (
    <div className="flex min-h-dvh flex-col bg-[hsl(var(--background-subtle))]">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
          <BrandLogo width={120} height={40} />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-xl">
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Welcome, {greetingName}.
            </h1>
            <p className="mt-3 text-lg font-medium text-[hsl(var(--foreground-muted))]">
              You are on your way to growing your revenue consistently.
            </p>
            <p className="mt-1 text-lg font-semibold">
              {hasPlan ? "Your plan is ready." : "Let\u2019s build your first plan."}
            </p>
            <p className="mt-2 text-sm text-[hsl(var(--foreground-subtle))]">
              {hasPlan
                ? "One step left: put your first real numbers in."
                : "Three steps. The first one takes about two minutes."}
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-[var(--radius-lg)] border border-border bg-card py-16">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--foreground-muted))]" />
            </div>
          ) : (
            <>
              {/* Step 1 — the questionnaire. Done once a plan exists. */}
              {questionnaireDone ? (
                <DoneStep
                  title="Tell us about your business"
                  description="A few questions so the plan reflects how you actually operate."
                />
              ) : (
                <div className="rounded-[var(--radius-lg)] border border-[hsl(var(--primary))] bg-card p-5 shadow-sm">
                  <div className="flex items-start gap-3">
                    <StepBadge n={1} state="active" />
                    <div className="flex-1">
                      <h2 className="text-sm font-semibold">Tell us about your business</h2>
                      <p className="mt-0.5 text-sm text-[hsl(var(--foreground-muted))]">
                        A few questions so the plan reflects how you actually operate.
                      </p>
                      <button
                        onClick={() => router.push("/onboarding/quickstart")}
                        className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                      >
                        Get your first plan in 2 minutes
                        <ArrowRight className="h-4 w-4" />
                      </button>
                      <div className="mt-3">
                        <Link
                          href="/onboarding/full"
                          className="text-sm font-medium text-[hsl(var(--foreground-muted))] underline underline-offset-2 hover:text-foreground"
                        >
                          Want a more tailored plan? Answer all 7 questions
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2 — unlocks the moment a plan exists. */}
              {hasPlan ? (
                <DoneStep
                  title="Get your plan"
                  description="Initiatives, projections, and project plans built against your goal."
                  action={
                    <Link
                      href="/year-at-a-glance"
                      className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[hsl(var(--background-muted))]"
                    >
                      View my plan
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  }
                />
              ) : (
                <LockedStep
                  n={2}
                  title="Get your plan"
                  description="Initiatives, projections, and project plans built against your goal."
                />
              )}

              {/* Step 3 — unlocks automatically once there is a plan. */}
              {!hasPlan ? (
                <LockedStep
                  n={3}
                  title="Enter your first numbers"
                  description="See your real revenue against the plan for the first time."
                />
              ) : hasResults ? (
                <DoneStep
                  title="Enter your first numbers"
                  description="See your real revenue against the plan for the first time."
                  action={
                    <Link
                      href="/planner/weekly"
                      className="mt-3 inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[hsl(var(--background-muted))]"
                    >
                      Go to the weekly planner
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  }
                />
              ) : (
                <div className="mt-3 rounded-[var(--radius-lg)] border-2 border-[hsl(var(--foreground))] bg-card p-5">
                  <div className="flex items-start gap-3">
                    <StepBadge n={3} state="active" />
                    <div className="flex-1">
                      <h2 className="text-sm font-semibold">Enter your first numbers</h2>
                      <p className="mt-0.5 text-sm text-[hsl(var(--foreground-muted))]">
                        See your real revenue against the plan for the first time.
                      </p>

                      <div className="mt-4 max-w-xs">
                        <label htmlFor="first-revenue" className="text-sm font-semibold">
                          Last month&apos;s revenue ($)
                        </label>
                        <NumberInputRaw
                          id="first-revenue"
                          value={revenue}
                          onValueChange={setRevenue}
                          placeholder="0"
                          className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                        />
                        <p className="mt-1.5 text-xs text-[hsl(var(--foreground-muted))]">
                          We&apos;ll show it against your {new Date().getFullYear()} Plan targets.
                        </p>
                      </div>

                      {saveError && (
                        <p className="mt-2 text-xs text-[hsl(var(--error))]">{saveError}</p>
                      )}

                      <button
                        onClick={saveFirstNumber}
                        disabled={saving || revenue.trim() === "" || !firstInitiativeId}
                        className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Save and see my progress
                        {!saving && <ArrowRight className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          <div className="mt-6 text-center">
            <Link
              href="/year-at-a-glance"
              className="text-sm text-[hsl(var(--foreground-subtle))] underline underline-offset-2 hover:text-[hsl(var(--foreground-muted))]"
            >
              Skip this and go to the dashboard
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function StepBadge({ n, state }: { n: number; state: "active" | "locked" | "done" }) {
  if (state === "done") {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--foreground))] text-[hsl(var(--background))]">
        <Check className="h-4 w-4" />
      </div>
    );
  }
  return (
    <div
      className={
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
        (state === "active"
          ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]"
          : "bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-subtle))]")
      }
    >
      {n}
    </div>
  );
}

function DoneStep({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mt-3 rounded-[var(--radius-lg)] border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <StepBadge n={0} state="done" />
        <div className="flex-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-sm text-[hsl(var(--foreground-muted))]">{description}</p>
          {action}
        </div>
      </div>
    </div>
  );
}

function LockedStep({ n, title, description }: { n: number; title: string; description: string }) {
  return (
    <div className="mt-3 rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted)/0.4)] p-5">
      <div className="flex items-start gap-3">
        <StepBadge n={n} state="locked" />
        <div className="flex-1">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-[hsl(var(--foreground-muted))]">{title}</h2>
            <Lock className="h-3 w-3 text-[hsl(var(--foreground-subtle))]" />
          </div>
          <p className="mt-0.5 text-sm text-[hsl(var(--foreground-subtle))]">{description}</p>
        </div>
      </div>
    </div>
  );
}
