"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  DollarSign,
  Package,
  TrendingUp,
  Users,
  BarChart3,
  Briefcase,
  AlertTriangle,
  Loader2,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";
import type { QuestionnaireData } from "@/components/questionnaire/questionnaire-data";
import {
  createEmptyQuestionnaireData,
  BUSINESS_STAGE_OPTIONS,
} from "@/components/questionnaire/questionnaire-data";

type Mode = "quickstart" | "full";

function loadSavedData(): { data: QuestionnaireData; mode: Mode } {
  if (typeof window === "undefined")
    return { data: createEmptyQuestionnaireData(), mode: "full" };
  try {
    const fullStored = localStorage.getItem("sam-questionnaire-full");
    if (fullStored) {
      return {
        data: { ...createEmptyQuestionnaireData(), ...JSON.parse(fullStored) },
        mode: "full",
      };
    }
    const qsStored = localStorage.getItem("sam-questionnaire-quickstart");
    if (qsStored) {
      return {
        data: { ...createEmptyQuestionnaireData(), ...JSON.parse(qsStored) },
        mode: "quickstart",
      };
    }
  } catch {
    // ignore
  }
  return { data: createEmptyQuestionnaireData(), mode: "full" };
}

/**
 * Review screen — shows questionnaire answers grouped by section.
 * Quickstart shows 3 sections. Full shows all 7.
 * Each section has an Edit link that deep-links to that specific step.
 */
export default function ReviewPage() {
  const router = useRouter();
  const [{ data, mode }] = useState(loadSavedData);
  const [isGenerating, setIsGenerating] = useState(false);

  const basePath = mode === "full" ? "/onboarding/full" : "/onboarding/quickstart";

  const handleGenerate = () => {
    setIsGenerating(true);
    try {
      localStorage.setItem("sam-plan-generated", "true");
      localStorage.setItem("sam-plan-data", JSON.stringify(data));
    } catch {
      // ignore
    }
    router.push("/onboarding/generating");
  };

  const formatCurrency = (amount: number | null) => {
    if (amount == null) return "Not provided";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number | null) => {
    if (num == null) return "Not provided";
    return num.toLocaleString();
  };

  const stageLabel = data.businessStage
    ? BUSINESS_STAGE_OPTIONS.find((o) => o.value === data.businessStage)?.label ?? "Not provided"
    : "Not provided";

  const periodLabel = data.planningPeriod
    ? data.planningPeriod.replace("-", " ").replace(/^\w/, (c) => c.toUpperCase())
    : "Not provided";

  const hasAnyData =
    data.annualRevenueGoal || data.products.length > 0 || data.whatsWorked.length > 0;

  if (!hasAnyData) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="flex flex-col items-center text-center max-w-md">
          <AlertTriangle className="h-8 w-8 text-[hsl(var(--warning))]" />
          <h1 className="mt-4 text-xl font-bold">No questionnaire data found</h1>
          <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
            Please complete the questionnaire before reviewing.
          </p>
          <Link href="/onboarding" className="mt-6">
            <Button>Start Questionnaire</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link
            href={basePath}
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

      <main className="flex-1 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Review &amp; Generate</h1>
            <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
              Review your answers below. Click Edit to make changes, or generate your plan.
            </p>
          </div>

          {/* Q1: Revenue Goal (both modes) */}
          <ReviewCard icon={DollarSign} title="Revenue Goal" editHref={`${basePath}?step=0`}>
            <ReviewItem label="Annual Revenue Goal" value={formatCurrency(data.annualRevenueGoal)} />
            <ReviewItem label="Prior Year Revenue" value={formatCurrency(data.priorYearRevenue)} />
            <ReviewItem label="Planning Period" value={periodLabel} />
          </ReviewCard>

          {/* Q2: Products (both modes) */}
          <ReviewCard icon={Package} title="Products & Pricing" editHref={`${basePath}?step=1`}>
            {data.products.length > 0 ? (
              data.products.map((p) => (
                <ReviewItem
                  key={p.id}
                  label={p.name || "Unnamed product"}
                  value={`${p.type} · ${formatCurrency(p.price)}`}
                />
              ))
            ) : (
              <EmptyField>No products added</EmptyField>
            )}
          </ReviewCard>

          {/* Q3: What's Worked (both modes) */}
          <ReviewCard icon={TrendingUp} title="What's Worked" editHref={`${basePath}?step=2`}>
            {data.whatsWorked.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {data.whatsWorked.map((item) => (
                  <TagBadge key={item} variant="primary">{item}</TagBadge>
                ))}
              </div>
            ) : (
              <EmptyField>No selections made</EmptyField>
            )}
            {data.whatsWorkedNotes && (
              <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))] italic">
                &ldquo;{data.whatsWorkedNotes}&rdquo;
              </p>
            )}
          </ReviewCard>

          {/* Full Plan only sections (Q4–Q7) */}
          {mode === "full" && (
            <>
              {/* Q4: Ideal Customer */}
              <ReviewCard icon={Users} title="Ideal Customer" editHref={`${basePath}?step=3`}>
                <ReviewItem label="Description" value={data.idealCustomer || "Not provided"} />
                <ReviewItem label="Industry" value={data.industry || "Not provided"} />
                <ReviewItem label="Business Type" value={data.businessType || "Not provided"} />
                <ReviewItem label="Biggest Problem Solved" value={data.biggestProblem || "Not provided"} />
              </ReviewCard>

              {/* Q5: Current Assets */}
              <ReviewCard icon={BarChart3} title="Current Assets" editHref={`${basePath}?step=4`}>
                <ReviewItem label="Email List Size" value={formatNumber(data.emailListSize)} />
                <ReviewItem label="Monthly Website Visitors" value={formatNumber(data.monthlyWebsiteVisitors)} />
                <ReviewItem label="Social Following" value={formatNumber(data.socialFollowing)} />
                <ReviewItem label="Existing Customers" value={formatNumber(data.existingCustomers)} />
                <ReviewItem label="Monthly Leads" value={formatNumber(data.monthlyLeads)} />
              </ReviewCard>

              {/* Q6: Budget & Team */}
              <ReviewCard icon={Briefcase} title="Budget & Team" editHref={`${basePath}?step=5`}>
                <ReviewItem label="Monthly Marketing Budget" value={formatCurrency(data.monthlyMarketingBudget)} />
                <ReviewItem label="Team Size" value={data.teamSize != null ? String(data.teamSize) : "Not provided"} />
                <ReviewItem label="Hours Available/Week" value={data.hoursAvailablePerWeek != null ? String(data.hoursAvailablePerWeek) : "Not provided"} />
                <ReviewItem label="Business Stage" value={stageLabel} />
              </ReviewCard>

              {/* Q7: Obstacles */}
              <ReviewCard icon={AlertTriangle} title="Obstacles" editHref={`${basePath}?step=6`}>
                {data.obstacles.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {data.obstacles.map((item) => (
                      <TagBadge key={item} variant="warning">{item}</TagBadge>
                    ))}
                  </div>
                ) : (
                  <EmptyField>No obstacles selected</EmptyField>
                )}
                {data.obstacleNotes && (
                  <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))] italic">
                    &ldquo;{data.obstacleNotes}&rdquo;
                  </p>
                )}
              </ReviewCard>
            </>
          )}

          {/* Generate CTA */}
          <div className="flex flex-col items-center gap-4 pt-6 border-t border-border">
            <Button
              size="xl"
              onClick={handleGenerate}
              disabled={isGenerating}
              className="w-full sm:w-auto"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Preparing...
                </>
              ) : (
                <>
                  Generate My Plan
                  <ArrowRight className="ml-1 h-4 w-4" />
                </>
              )}
            </Button>
            <p className="text-xs text-[hsl(var(--foreground-subtle))]">
              Your plan will be generated using AI-selected initiatives and benchmarks
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function ReviewCard({
  icon: Icon,
  title,
  editHref,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  editHref: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Icon className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <Link
            href={editHref}
            className="text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Pencil className="h-3 w-3" />
            Edit
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">{children}</CardContent>
    </Card>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  const isEmpty = !value || value === "Not provided";
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-[hsl(var(--foreground-muted))] shrink-0">{label}</span>
      <span className={cn("text-right", isEmpty ? "text-[hsl(var(--foreground-subtle))] italic text-xs" : "font-medium")}>
        {value}
      </span>
    </div>
  );
}

function EmptyField({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-[hsl(var(--foreground-subtle))] italic">{children}</p>
  );
}

function TagBadge({ children, variant }: { children: React.ReactNode; variant: "primary" | "warning" }) {
  return (
    <span
      className={cn(
        "rounded-[var(--radius-full)] px-2.5 py-1 text-xs font-medium",
        variant === "primary" && "bg-[hsl(var(--primary)_/_0.1)] text-primary",
        variant === "warning" && "bg-[hsl(var(--warning-background))] border border-[hsl(var(--warning-border))] text-[hsl(var(--foreground))]"
      )}
    >
      {children}
    </span>
  );
}
