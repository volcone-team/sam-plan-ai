import Link from "next/link";
import { ArrowRight, Play, BarChart3, Calendar, Target, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassButton } from "@/components/ui/glass-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { BrandLogo } from "@/components/brand-logo";

export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <BrandLogo />
          </div>
          <nav className="hidden sm:flex items-center gap-6">
            <Link
              href="/sample-plan"
              className="text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors"
            >
              Sample Plan
            </Link>
            <ThemeToggle />
            <Link href="/onboarding">
              <Button size="sm">Get Started</Button>
            </Link>
          </nav>
          <div className="flex items-center gap-2 sm:hidden">
            <ThemeToggle />
            <Link href="/onboarding">
              <Button size="sm">Get Started</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1">
        <section className="relative overflow-hidden">
          {/* Background gradient — switches between light and dark */}
          <div className="absolute inset-0 -z-10 hero-bg">
            {/* Light mode blobs */}
            <div className="absolute top-[-15%] right-[5%] w-[55%] h-[60%] rounded-full bg-[radial-gradient(ellipse_at_center,#00B35F_0%,transparent_65%)] opacity-60 blur-3xl hero-blob-light" />
            <div className="absolute top-[10%] left-[30%] w-[40%] h-[45%] rounded-full bg-[radial-gradient(ellipse_at_center,#2dba6e_0%,transparent_60%)] opacity-50 blur-3xl hero-blob-light" />
            <div className="absolute bottom-[-15%] left-[-5%] w-[55%] h-[55%] rounded-full bg-[radial-gradient(ellipse_at_center,#0a8f8f_0%,transparent_65%)] opacity-70 blur-3xl hero-blob-light" />
            <div className="absolute bottom-[5%] right-[10%] w-[35%] h-[40%] rounded-full bg-[radial-gradient(ellipse_at_center,#12BBBF_0%,transparent_65%)] opacity-55 blur-3xl hero-blob-light" />
            {/* Dark mode blobs — very light blue-green shades */}
            <div className="absolute top-[-10%] right-[-15%] w-[70%] h-[80%] rounded-full bg-[radial-gradient(ellipse_at_center,#48FFD6_0%,transparent_70%)] opacity-0 blur-3xl hero-blob-dark" />
            <div className="absolute bottom-[-20%] right-[10%] w-[60%] h-[70%] rounded-full bg-[radial-gradient(ellipse_at_center,#0DFFFF_0%,transparent_70%)] opacity-0 blur-3xl hero-blob-dark" />
            <div className="absolute top-[20%] left-[-5%] w-[40%] h-[50%] rounded-full bg-[radial-gradient(ellipse_at_center,#ACFFA7_0%,transparent_70%)] opacity-0 blur-3xl hero-blob-dark" />
          </div>

          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center py-20 text-center sm:py-28 lg:py-36">
              {/* Badge */}
              <div className="mb-6 inline-flex items-center rounded-[var(--radius-full)] border border-border bg-[hsl(var(--background-muted))] px-4 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))]">
                <span className="mr-2 inline-block h-1.5 w-1.5 rounded-[var(--radius-full)] bg-[hsl(var(--success))]" />
                The Revenue Operating System
              </div>

              {/* Heading */}
              <h1 className="gradient-heading max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl text-balance">
                Turn revenue goals into{" "}
                <span className="text-primary">execution-ready plans</span>
              </h1>

              {/* Description */}
              <p className="mt-6 max-w-2xl text-lg text-[hsl(var(--foreground-muted))] sm:text-xl text-balance">
                SAM Plan AI is the revenue operating system that transforms your
                business goals into actionable initiatives, realistic
                projections, and weekly execution cadences — in minutes, not
                months.
              </p>

              {/* CTA Buttons */}
              <div className="mt-10 flex flex-col gap-4 sm:flex-row">
                <Link href="/onboarding">
                  <GlassButton className="w-full sm:w-auto">
                    Generate My Plan
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </GlassButton>
                </Link>
                <Link href="/sample-plan">
                  <Button
                    variant="outline"
                    size="xl"
                    className="w-full sm:w-auto"
                  >
                    <Play className="mr-1 h-4 w-4" />
                    View Sample Plan
                  </Button>
                </Link>
              </div>

              {/* Social proof hint */}
              <p className="mt-6 text-xs text-[hsl(var(--foreground-subtle))]">
                No credit card required · Plan generated in under 2 minutes
              </p>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="border-t border-border bg-[hsl(var(--background-subtle))]">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="text-center">
              <h2 className="gradient-heading text-2xl font-bold tracking-tight sm:text-3xl">
                From strategy to execution in one system
              </h2>
              <p className="mt-3 text-[hsl(var(--foreground-muted))] max-w-2xl mx-auto">
                SAM Plan AI answers the four questions every business needs:
                what to do, how much you&apos;ll make, how to execute, and whether
                you&apos;re on track.
              </p>
            </div>

            <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              <FeatureCard
                icon={Target}
                title="AI Initiative Generator"
                description="Tells you what to do based on your goals, assets, and budget."
              />
              <FeatureCard
                icon={BarChart3}
                title="Revenue Projections"
                description="Shows how much you'll make with good, better, and best scenarios."
              />
              <FeatureCard
                icon={Calendar}
                title="Project Plans"
                description="Turns each initiative into execution-ready tasks with timelines."
              />
              <FeatureCard
                icon={Zap}
                title="Weekly Accountability"
                description="Keeps you on track with a weekly operating cadence."
              />
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="border-t border-border">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center text-center">
              <h2 className="gradient-heading text-2xl font-bold tracking-tight sm:text-3xl">
                Ready to build your revenue plan?
              </h2>
              <p className="mt-3 text-[hsl(var(--foreground-muted))] max-w-lg">
                Answer a few questions and get a complete revenue plan with
                initiatives, projections, and project plans — in minutes.
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row">
                <Link href="/onboarding">
                  <Button size="lg">
                    Generate My Plan
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/sample-plan">
                  <Button variant="ghost" size="lg">
                    View Sample Plan
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-[hsl(var(--background-subtle))]">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2">
              <BrandLogo />
            </div>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              The Revenue Operating System
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="glass-card-glow flex flex-col items-center text-center rounded-[var(--radius-lg)] p-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[hsl(var(--primary)_/_0.1)]">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <h3 className="mt-4 text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))] leading-relaxed">
        {description}
      </p>
    </div>
  );
}
