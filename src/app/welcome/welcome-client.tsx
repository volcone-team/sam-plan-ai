"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  Check,
  ClipboardList,
  PlayCircle,
  Users,
  BadgeCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";

/**
 * Founding-member welcome screen.
 *
 * COPY IS PLACEHOLDER and marked as such: the wording, the video and the
 * booking links are all to be replaced. Everything that will need swapping is
 * pulled into the constants below rather than buried in markup, so changing
 * the pitch later does not mean re-reading the layout.
 *
 * Shown to every new customer for now.
 */

/** Perks. Replace wholesale when the real offer is settled. */
const PERKS: { icon: typeof Users; title: string; body: string }[] = [
  {
    icon: CalendarDays,
    title: "A 1:1 onboarding call with a co-founder",
    body:
      "We'll walk through your plan together and make sure the numbers reflect " +
      "how your business actually works.",
  },
  {
    icon: Users,
    title: "Weekly group coaching",
    body:
      "Bring questions, hear what is working for other founders, and get " +
      "direct feedback on your plan.",
  },
  {
    icon: BadgeCheck,
    title: "Founding-member pricing, locked",
    body:
      "Your rate stays as it is for as long as you keep your subscription, " +
      "whatever we charge later.",
  },
];

/**
 * Where the booking links point.
 *
 * Empty for now. An empty value renders explanatory text instead of a dead
 * link — a button that goes nowhere is worse than one that is honestly absent.
 */
const BOOKING_URL = "";
const VIDEO_URL = "";
const SUPPORT_EMAIL = "support@samplan.ai";

export function WelcomeClient({
  firstName,
  planName,
  intakeDone,
  isTrial,
  trialDaysRemaining,
}: {
  firstName: string | null;
  planName: string | null;
  intakeDone: boolean;
  isTrial: boolean;
  trialDaysRemaining: number | null;
}) {
  const greeting = firstName?.trim() ? `Welcome, ${firstName.trim()}!` : "Welcome!";

  return (
    <div className="flex min-h-dvh flex-col bg-[hsl(var(--background-subtle))]">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-center px-4 sm:px-6">
          <BrandLogo width={120} height={40} />
        </div>
      </header>

      <main className="flex-1 px-4 py-10 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-10">
          {/* Hero */}
          <section className="rounded-[var(--radius-lg)] border border-border bg-card p-6 text-center sm:p-10">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {greeting}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-sm text-[hsl(var(--foreground-muted))]">
              You&apos;re one of the first people to use SAM Plan AI. You are a
              few minutes away from having a real revenue operating system for
              your business.
            </p>

            {/*
              Plan or trial state, stated plainly. A trial user especially
              needs to know this is time-boxed before they invest effort.
            */}
            {isTrial ? (
              <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Free trial
                {typeof trialDaysRemaining === "number"
                  ? ` · ${trialDaysRemaining} day${trialDaysRemaining === 1 ? "" : "s"} left`
                  : ""}
              </p>
            ) : (
              planName && (
                <p className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--primary)_/_0.1)] px-3 py-1 text-xs font-medium text-[hsl(var(--primary))]">
                  <Check className="h-3 w-3" />
                  {planName} active
                </p>
              )
            )}

            {/* Video. Placeholder until a real URL exists. */}
            <div className="mt-6 overflow-hidden rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))]">
              {VIDEO_URL ? (
                <div className="aspect-video">
                  <iframe
                    src={VIDEO_URL}
                    title="Welcome to SAM Plan AI"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                    allowFullScreen
                    className="h-full w-full"
                  />
                </div>
              ) : (
                <div className="flex aspect-video flex-col items-center justify-center gap-2">
                  <PlayCircle
                    className="h-10 w-10 text-[hsl(var(--foreground-subtle))]"
                    aria-hidden="true"
                  />
                  <p className="text-xs text-[hsl(var(--foreground-subtle))]">
                    Welcome video coming soon
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Perks */}
          <section>
            <h2 className="text-center text-lg font-semibold text-foreground">
              Your founding member perks
            </h2>
            <p className="mx-auto mt-1 max-w-lg text-center text-sm text-[hsl(var(--foreground-muted))]">
              Because you are one of our first customers, these are yours and
              will not be offered again.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              {PERKS.map((perk) => (
                <div
                  key={perk.title}
                  className="rounded-[var(--radius-lg)] border border-border bg-card p-5"
                >
                  <perk.icon
                    className="h-5 w-5 text-[hsl(var(--primary))]"
                    aria-hidden="true"
                  />
                  <h3 className="mt-3 text-sm font-semibold text-foreground">
                    {perk.title}
                  </h3>
                  <p className="mt-1.5 text-xs text-[hsl(var(--foreground-muted))]">
                    {perk.body}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Next steps */}
          <section>
            <h2 className="text-center text-lg font-semibold text-foreground">
              Here are your next steps
            </h2>

            <div className="mt-6 space-y-4">
              <Step
                n={1}
                title="Book your onboarding call"
                body={
                  BOOKING_URL
                    ? "Pick a time that suits you. We'll review your plan together and get you set up."
                    : "We'll email you a booking link shortly so you can pick a time that suits you."
                }
                action={
                  BOOKING_URL ? (
                    <a
                      href={BOOKING_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[hsl(var(--background-muted))]"
                    >
                      Book a time
                      <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  ) : null
                }
              />

              {/*
                THE STEP THAT MATTERS. Everything the product does depends on
                the intake, so it is the only one with a primary button — and
                it reads as done once initiatives exist.
              */}
              <Step
                n={2}
                title="Complete your intake"
                body={
                  intakeDone
                    ? "Done. Your plan is built and waiting on your dashboard."
                    : "About 15 minutes. This is what SAM uses to build your plan, so it is worth doing properly."
                }
                done={intakeDone}
                action={
                  intakeDone ? null : (
                    <Link
                      href="/intake/start"
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                    >
                      Start my intake
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )
                }
              />

              <Step
                n={3}
                title="Add your coaching calls to the calendar"
                body="Join the weekly group session whenever you have questions — there is no need to book."
              />
            </div>
          </section>

          <div className="text-center">
            <Link
              href="/year-at-a-glance"
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-card px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-[hsl(var(--background-muted))]"
            >
              Go to my dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
            <p className="mt-4 text-xs text-[hsl(var(--foreground-subtle))]">
              Questions? Email {SUPPORT_EMAIL}. Welcome aboard — we are glad you
              are here.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function Step({
  n,
  title,
  body,
  action,
  done,
}: {
  n: number;
  title: string;
  body: string;
  action?: React.ReactNode;
  done?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex gap-4 rounded-[var(--radius-lg)] border bg-card p-5",
        done ? "border-border" : "border-border"
      )}
    >
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
          done
            ? "bg-[hsl(var(--primary))] text-white"
            : "bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-muted))]"
        )}
      >
        {done ? <Check className="h-4 w-4" aria-hidden="true" /> : n}
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {n === 2 && !done && (
            <ClipboardList className="h-4 w-4 text-[hsl(var(--primary))]" aria-hidden="true" />
          )}
          {title}
        </h3>
        <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">{body}</p>
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
