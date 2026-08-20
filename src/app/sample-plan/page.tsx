import { Eye, Target, TrendingUp, Calendar, Rocket } from "lucide-react";
import Link from "next/link";
import { companyService } from "@/services/company.service";
import { planService } from "@/services/plan.service";
import { initiativeService } from "@/services/initiative.service";
import { PageContainer, PageHeader, SectionContainer, SectionHeader } from "@/components/layout";
import { DemoBanner } from "@/components/demo-banner";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Sample Plan — Year at a Glance (read-only demo).
 * Loads mock data via the service layer to demonstrate
 * what a completed revenue plan looks like.
 */
export default async function SamplePlanPage() {
  const company = await companyService.getCompany();
  const companyId = company.id;
  const quarterlyPlans = await planService.getQuarterlyPlans(companyId, company.planningYear);
  const initiatives = await initiativeService.getActiveInitiatives(companyId);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: company.currency,
      maximumFractionDigits: 0,
    }).format(amount);

  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold">Sample Plan</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/onboarding">
              <Button size="sm">Create My Plan</Button>
            </Link>
            <Link
              href="/"
              className="text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors"
            >
              Home
            </Link>
          </div>
        </div>
      </header>

      <PageContainer maxWidth="xl">
        {/* Demo Banner */}
        <DemoBanner className="mt-2" />

        {/* Page Header */}
        <PageHeader
          title={`${company.name} — Year at a Glance`}
          description={`${company.planningYear} Revenue Operating Plan`}
        />

        {/* Revenue Targets */}
        <SectionContainer>
          <SectionHeader
            title="Revenue Targets"
            description={`Fiscal Year ${company.fiscalYear}`}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              icon={Target}
              label="Target Revenue"
              value={formatCurrency(company.targetRevenue)}
            />
            <MetricCard
              icon={TrendingUp}
              label="Baseline"
              value={formatCurrency(company.baselineRevenue)}
            />
            <MetricCard
              icon={TrendingUp}
              label="Stretch"
              value={formatCurrency(company.stretchRevenue)}
            />
            <MetricCard
              icon={Target}
              label="Operating Budget"
              value={formatCurrency(company.operatingBudget)}
            />
          </div>
        </SectionContainer>

        {/* Quarterly Breakdown */}
        <SectionContainer>
          <SectionHeader
            title="Quarterly Plan"
            description="Revenue targets by quarter"
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {quarterlyPlans.map((qp) => (
              <Card key={qp.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-[hsl(var(--foreground-muted))]">
                    Q{qp.quarter} {qp.year}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xl font-bold">
                    {formatCurrency(qp.targetRevenue)}
                  </p>
                  <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))] line-clamp-2">
                    {qp.notes}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </SectionContainer>

        {/* Initiatives */}
        <SectionContainer>
          <SectionHeader
            title="Active Initiatives"
            description={`${initiatives.length} initiatives planned for ${company.planningYear}`}
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {initiatives.slice(0, 6).map((initiative) => (
              <Card key={initiative.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <Rocket className="h-4 w-4 text-primary" />
                    <span className="text-xs font-medium capitalize px-2 py-0.5 rounded-[var(--radius-full)] bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-muted))]">
                      {initiative.status.replace("_", " ")}
                    </span>
                  </div>
                  <CardTitle className="text-sm font-semibold leading-tight">
                    {initiative.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-[hsl(var(--foreground-muted))] line-clamp-2">
                    {initiative.description}
                  </p>
                  <div className="mt-3 flex items-center gap-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
                        Good
                      </p>
                      <p className="text-sm font-semibold">
                        {formatCurrency(initiative.revenueScenarios.good)}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
                        Best
                      </p>
                      <p className="text-sm font-semibold">
                        {formatCurrency(initiative.revenueScenarios.best)}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </SectionContainer>

        {/* CTA */}
        <SectionContainer padding="lg">
          <div className="flex flex-col items-center text-center">
            <Calendar className="h-8 w-8 text-primary" />
            <h3 className="mt-4 text-lg font-semibold">
              Ready to create your own plan?
            </h3>
            <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))] max-w-md">
              Answer a few questions and get a personalized revenue plan with
              initiatives, projections, and execution timelines.
            </p>
            <Link href="/onboarding" className="mt-6">
              <Button size="lg">Generate My Plan</Button>
            </Link>
          </div>
        </SectionContainer>
      </PageContainer>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-2 mb-2">
          <Icon className="h-4 w-4 text-[hsl(var(--foreground-muted))]" />
          <span className="text-xs text-[hsl(var(--foreground-muted))]">
            {label}
          </span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  );
}
