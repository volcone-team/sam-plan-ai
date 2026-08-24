import Link from "next/link";
import { ArrowRight, Zap, ClipboardList, Clock } from "lucide-react";
import { OnboardingBackLink } from "@/components/onboarding-back-link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

/**
 * Onboarding path selection screen.
 * Users choose between Quickstart (~2 min) or Full Plan (~7-10 min).
 * No questionnaire content — navigation only.
 */
export default function OnboardingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Header */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
          <OnboardingBackLink />
        </div>
      </header>

      {/* Content */}
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-12 sm:py-20">
        <div className="w-full max-w-3xl">
          {/* Title */}
          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Choose Your Planning Experience
            </h1>
            <p className="mt-3 text-[hsl(var(--foreground-muted))] max-w-lg mx-auto">
              Select how deep you want to go. You can always refine your plan
              later.
            </p>
          </div>

          {/* Cards */}
          <div className="grid gap-6 sm:grid-cols-2">
            {/* Quickstart Card */}
            <Card className="flex flex-col">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[hsl(var(--primary)_/_0.1)] mb-3">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <CardTitle>Quickstart</CardTitle>
                <CardDescription>
                  Create a draft revenue plan in about 2 minutes using a short
                  questionnaire.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="flex items-center gap-2 text-xs text-[hsl(var(--foreground-muted))]">
                  <Clock className="h-3.5 w-3.5" />
                  <span>~2 minutes</span>
                </div>
              </CardContent>
              <CardFooter>
                <Link href="/onboarding/quickstart" className="w-full">
                  <Button className="w-full">
                    Start Quickstart
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </Link>
              </CardFooter>
            </Card>

            {/* Full Plan Card */}
            <Card className="flex flex-col">
              <CardHeader>
                <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[hsl(var(--primary)_/_0.1)] mb-3">
                  <ClipboardList className="h-5 w-5 text-primary" />
                </div>
                <CardTitle>Full Plan</CardTitle>
                <CardDescription>
                  Complete the full business diagnostic to generate a detailed
                  annual revenue operating plan.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <div className="flex items-center gap-2 text-xs text-[hsl(var(--foreground-muted))]">
                  <Clock className="h-3.5 w-3.5" />
                  <span>7–10 minutes</span>
                </div>
              </CardContent>
              <CardFooter>
                <Link href="/onboarding/full" className="w-full">
                  <Button variant="outline" className="w-full">
                    Start Full Plan
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </Link>
              </CardFooter>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
