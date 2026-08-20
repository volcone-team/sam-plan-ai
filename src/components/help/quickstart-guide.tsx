'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ClipboardList,
  Eye,
  Rocket,
  BarChart3,
  Star,
  CheckCircle2,
  ArrowRight,
  PartyPopper,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Step {
  title: string;
  description: string;
  link: string;
  icon: React.ElementType;
  isActivationMilestone?: boolean;
}

// ─── Data ────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sam-flow-quickstart-progress';

const steps: Step[] = [
  {
    title: 'Complete Your Questionnaire',
    description:
      'Answer 7 questions about your business to generate a personalized revenue plan.',
    link: '/onboarding/full',
    icon: ClipboardList,
  },
  {
    title: 'Review Your Plan',
    description:
      'Explore your Year-at-a-Glance — annual targets, revenue projections, and initiative timeline.',
    link: '/year-at-a-glance',
    icon: Eye,
  },
  {
    title: 'Explore Your Initiatives',
    description:
      'Dive into your initiative library — see revenue scenarios, benchmarks, and project plans for each.',
    link: '/initiatives',
    icon: Rocket,
  },
  {
    title: 'Enter Your First Weekly Results',
    description:
      'This is the moment your plan becomes real. Enter revenue and spend for your first week.',
    link: '/planner/weekly',
    icon: BarChart3,
    isActivationMilestone: true,
  },
  {
    title: 'Set Your Weekly Priorities',
    description:
      'Choose your top 1-3 priorities for the week. This drives the weekly operating cadence.',
    link: '/planner/weekly',
    icon: Star,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadProgress(): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter((i) => typeof i === 'number');
  } catch {
    // ignore
  }
  return [];
}

function saveProgress(completed: number[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
}

// ─── Step Card ───────────────────────────────────────────────────────────────

function StepCard({
  step,
  index,
  isCompleted,
  onToggle,
}: {
  step: Step;
  index: number;
  isCompleted: boolean;
  onToggle: () => void;
}) {
  const Icon = step.icon;
  const stepNumber = index + 1;

  return (
    <div
      className={cn(
        'group relative flex gap-4 rounded-xl border p-5 transition-all duration-200',
        step.isActivationMilestone && !isCompleted
          ? 'border-primary/50 bg-primary/5 shadow-sm ring-1 ring-primary/20'
          : 'border-border bg-card hover:shadow-md hover:border-border/80',
        isCompleted && 'opacity-75'
      )}
    >
      {/* Connector line (vertical stepper) */}
      {index < steps.length - 1 && (
        <div className="absolute left-[2.15rem] top-[4.5rem] bottom-[-1.25rem] w-px bg-border" />
      )}

      {/* Number circle / check */}
      <button
        onClick={onToggle}
        aria-label={isCompleted ? `Mark step ${stepNumber} as incomplete` : `Mark step ${stepNumber} as complete`}
        className={cn(
          'relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200',
          isCompleted
            ? 'border-[hsl(var(--success))] bg-[hsl(var(--success))] text-white'
            : step.isActivationMilestone
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-card text-[hsl(var(--foreground-muted))] hover:border-primary/50'
        )}
      >
        {isCompleted ? (
          <CheckCircle2 className="h-5 w-5" />
        ) : (
          <span className="text-sm font-bold">{stepNumber}</span>
        )}
      </button>

      {/* Content */}
      <div className="flex flex-1 flex-col gap-2 min-w-0">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
              step.isActivationMilestone && !isCompleted
                ? 'bg-primary/15'
                : 'bg-[hsl(var(--background-muted))]'
            )}
          >
            <Icon
              className={cn(
                'h-4 w-4',
                step.isActivationMilestone && !isCompleted
                  ? 'text-primary'
                  : 'text-[hsl(var(--foreground-muted))]'
              )}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3
                className={cn(
                  'text-sm font-semibold leading-tight',
                  isCompleted
                    ? 'text-[hsl(var(--foreground-muted))] line-through'
                    : 'text-[hsl(var(--foreground))]'
                )}
              >
                {step.title}
              </h3>
              {step.isActivationMilestone && !isCompleted && (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                  Activation Milestone
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))] leading-relaxed">
              {step.description}
            </p>
          </div>
        </div>

        {/* Go link */}
        {!isCompleted && (
          <div className="ml-11">
            <Link
              href={step.link}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                step.isActivationMilestone
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background-subtle))]'
              )}
            >
              Go
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Celebration State ───────────────────────────────────────────────────────

function CelebrationBanner() {
  return (
    <div className="rounded-xl border border-[hsl(var(--success-border))] bg-[hsl(var(--success-background))] p-6 text-center">
      <div className="flex justify-center mb-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--success))]/10">
          <PartyPopper className="h-6 w-6 text-[hsl(var(--success))]" />
        </div>
      </div>
      <h3 className="text-lg font-bold text-[hsl(var(--foreground))]">
        You&apos;re all set!
      </h3>
      <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
        Congratulations — you&apos;ve completed all 5 quickstart steps. Your revenue operating system is live.
      </p>
    </div>
  );
}

// ─── Progress Bar ────────────────────────────────────────────────────────────

function ProgressHeader({ completedCount }: { completedCount: number }) {
  const pct = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[hsl(var(--foreground))]">
          {completedCount} of {steps.length} steps completed
        </span>
        <span className="text-xs font-medium text-[hsl(var(--foreground-muted))]">
          {pct}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-[hsl(var(--background-muted))]">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function QuickstartGuide() {
  const [completed, setCompleted] = useState<number[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setCompleted(loadProgress());
    setMounted(true);
  }, []);

  const toggle = useCallback(
    (index: number) => {
      setCompleted((prev) => {
        const next = prev.includes(index)
          ? prev.filter((i) => i !== index)
          : [...prev, index];
        saveProgress(next);
        return next;
      });
    },
    []
  );

  // Avoid hydration mismatch — render nothing dynamic until mounted
  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="h-2 w-full rounded-full bg-[hsl(var(--background-muted))]" />
        {steps.map((step, i) => (
          <div key={i} className="h-28 rounded-xl border border-border bg-card animate-pulse" />
        ))}
      </div>
    );
  }

  const allDone = completed.length === steps.length;

  return (
    <div className="space-y-6">
      {/* Progress */}
      <ProgressHeader completedCount={completed.length} />

      {/* Celebration */}
      {allDone && <CelebrationBanner />}

      {/* Steps */}
      <div className="relative space-y-5">
        {steps.map((step, index) => (
          <StepCard
            key={index}
            step={step}
            index={index}
            isCompleted={completed.includes(index)}
            onToggle={() => toggle(index)}
          />
        ))}
      </div>
    </div>
  );
}
