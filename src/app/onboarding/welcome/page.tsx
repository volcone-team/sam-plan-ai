"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock, Check } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { useAuth } from "@/hooks/use-auth";

/**
 * Post-signup welcome / onboarding launch screen.
 *
 * New flow: Landing "Create an Account" -> /auth/signup -> HERE.
 * Presents the 3-step journey. Only step 1 is actionable; steps 2 and 3 are
 * locked until a plan exists. A skip link goes straight to the dashboard.
 */
export default function OnboardingWelcomePage() {
  const router = useRouter();
  const { firstName } = useAuth();
  // Personalize the greeting once the profile has loaded; fall back to a
  // neutral greeting while it is still resolving or if no name is set.
  const greetingName = firstName?.trim() || "there";

  return (
    <div className="flex min-h-dvh flex-col bg-[hsl(var(--background-subtle))]">
      {/* Top bar */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
          <BrandLogo width={120} height={40} />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 py-12 sm:py-16">
        <div className="w-full max-w-xl">
          {/* Heading */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Welcome, {greetingName}.
            </h1>
            <p className="mt-3 text-lg font-medium text-[hsl(var(--foreground-muted))]">
              You are on your way to growing your revenue consistently.
            </p>
            <p className="mt-1 text-lg font-semibold">Let&apos;s build your first plan.</p>
            <p className="mt-2 text-sm text-[hsl(var(--foreground-subtle))]">
              Three steps. The first one takes about two minutes.
            </p>
          </div>

          {/* Step 1 — active */}
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
                  className="mt-4 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 transition-opacity"
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

          {/* Step 2 — locked */}
          <LockedStep
            n={2}
            title="Get your plan"
            description="Initiatives, projections, and project plans built against your goal."
          />

          {/* Step 3 — locked */}
          <LockedStep
            n={3}
            title="Enter your first numbers"
            description="See your real revenue against the plan for the first time."
          />

          {/* Skip */}
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
  return (
    <div
      className={
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold " +
        (state === "active"
          ? "bg-[hsl(var(--primary)/0.15)] text-[hsl(var(--primary))]"
          : "bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-subtle))]")
      }
    >
      {state === "done" ? <Check className="h-3.5 w-3.5" /> : n}
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
