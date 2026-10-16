"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";
import { pathForStep } from "@/lib/billing/signup-flow";
import { formatMoney, formatNumber } from "@/lib/format-money";

/**
 * Plan selection for a visitor with no account yet.
 *
 * Chooses nothing and charges nothing: it hands a plan id to the signup form
 * via the URL. The plan is re-validated server-side at checkout, so a value
 * edited in the address bar changes which plan is OFFERED and never what
 * someone receives.
 */

export interface SignupPlan {
  id: string;
  name: string;
  description: string | null;
  tagline: string | null;
  monthlyPrice: number;
  annualPrice: number;
  isDefault: boolean;
  purchasableMonthly: boolean;
  purchasableAnnual: boolean;
  limits: { label: string; value: number }[];
  features: { label: string; enabled: boolean }[];
}

type Cycle = "monthly" | "annual";

const money = formatMoney;

/** -1 unlimited, 0 not included on this plan. */
function limitText(value: number): string {
  if (value < 0) return "Unlimited";
  if (value === 0) return "Not included";
  return formatNumber(value);
}

/**
 * Annual saving against twelve months at the monthly rate.
 *
 * Shown only when it is actually a saving: some plans may price annual at
 * twelve times monthly, and claiming a discount that is not there is worse
 * than showing nothing.
 */
function annualSaving(plan: SignupPlan): number | null {
  if (plan.monthlyPrice <= 0 || plan.annualPrice <= 0) return null;
  const saving = plan.monthlyPrice * 12 - plan.annualPrice;
  return saving > 0 ? saving : null;
}

export function GetStartedClient({ plans }: { plans: SignupPlan[] }) {
  const router = useRouter();
  const [cycle, setCycle] = useState<Cycle>("monthly");

  const choose = (planId: string) => {
    // The cycle is NOT carried: it is re-chosen at checkout, where the price
    // being charged is actually shown. Carrying it through signup and an email
    // round trip would risk billing annually for a monthly intent.
    router.push(pathForStep("register", planId));
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[hsl(var(--background-subtle))]">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandLogo width={120} height={40} />
          <Link
            href="/auth/login"
            className="text-xs font-medium text-[hsl(var(--foreground-muted))] hover:text-foreground"
          >
            Already have an account? Sign in
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Choose your plan
            </h1>
            <p className="mt-3 text-sm text-[hsl(var(--foreground-muted))]">
              Pick the plan that fits, then create your account. You can change
              or cancel at any time.
            </p>
          </div>

          <div className="mt-8 flex justify-center">
            <div className="inline-flex rounded-[var(--radius-md)] border border-border bg-card p-1">
              {(["monthly", "annual"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => setCycle(c)}
                  className={cn(
                    "rounded-[var(--radius-sm)] px-4 py-1.5 text-sm font-medium capitalize transition-colors",
                    cycle === c
                      ? "bg-[hsl(var(--primary))] text-white"
                      : "text-[hsl(var(--foreground-muted))] hover:text-foreground"
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          {plans.length === 0 ? (
            /*
              No purchasable plan exists. An operator fault, and the worst
              possible first impression, so it says who to contact rather than
              rendering an empty page.
            */
            <p className="mx-auto mt-8 max-w-md rounded-[var(--radius-lg)] border border-border bg-card px-5 py-4 text-center text-sm text-[hsl(var(--foreground-muted))]">
              Plans are not available right now. Please email
              support@samplan.ai and we will get you set up.
            </p>
          ) : (
            // Flex-wrap so one or two plans centre instead of hugging the left.
            <div className="mt-8 flex flex-wrap justify-center gap-5">
              {plans.map((plan) => {
                const price = cycle === "annual" ? plan.annualPrice : plan.monthlyPrice;
                const buyable =
                  cycle === "annual"
                    ? plan.purchasableAnnual
                    : plan.purchasableMonthly;
                const saving = cycle === "annual" ? annualSaving(plan) : null;

                return (
                  <div
                    key={plan.id}
                    className={cn(
                      "flex w-full flex-col rounded-[var(--radius-lg)] border bg-card p-5 sm:w-[320px]",
                      plan.isDefault
                        ? "border-[hsl(var(--primary))] shadow-sm"
                        : "border-border"
                    )}
                  >
                    {plan.isDefault && (
                      <span className="mb-2 self-start rounded-full bg-[hsl(var(--primary)_/_0.1)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--primary))]">
                        Most popular
                      </span>
                    )}

                    <h2 className="text-base font-semibold text-foreground">
                      {plan.name}
                    </h2>
                    {plan.tagline && (
                      <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
                        {plan.tagline}
                      </p>
                    )}

                    <p className="mt-4">
                      <span className="text-2xl font-bold text-foreground">
                        {money(price)}
                      </span>
                      <span className="text-sm text-[hsl(var(--foreground-muted))]">
                        {cycle === "annual" ? "/year" : "/month"}
                      </span>
                    </p>
                    {saving !== null && (
                      <p className="mt-0.5 text-xs font-medium text-[hsl(var(--primary))]">
                        Save {money(saving)} a year
                      </p>
                    )}

                    {plan.description && (
                      <p className="mt-3 text-xs text-[hsl(var(--foreground-muted))]">
                        {plan.description}
                      </p>
                    )}

                    {plan.limits.length > 0 && (
                      <ul className="mt-4 space-y-1.5 text-xs">
                        {plan.limits.map((l) => (
                          <li
                            key={l.label}
                            className="flex items-baseline justify-between gap-2"
                          >
                            <span className="text-[hsl(var(--foreground-muted))]">
                              {l.label}
                            </span>
                            <span className="font-medium tabular-nums text-foreground">
                              {limitText(l.value)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {plan.features.some((f) => f.enabled) && (
                      <ul className="mt-3 space-y-1.5 text-xs">
                        {plan.features
                          .filter((f) => f.enabled)
                          .map((f) => (
                            <li key={f.label} className="flex items-start gap-1.5">
                              <Check className="mt-0.5 h-3 w-3 shrink-0 text-[hsl(var(--primary))]" />
                              <span className="text-[hsl(var(--foreground-muted))]">
                                {f.label}
                              </span>
                            </li>
                          ))}
                      </ul>
                    )}

                    <div className="mt-5 flex-1" />

                    <button
                      onClick={() => choose(plan.id)}
                      disabled={!buyable}
                      className={cn(
                        "inline-flex w-full items-center justify-center rounded-[var(--radius-md)] px-4 py-2.5 text-sm font-semibold transition-opacity",
                        buyable
                          ? "bg-[hsl(var(--primary))] text-white hover:opacity-90"
                          : "cursor-not-allowed border border-border text-[hsl(var(--foreground-muted))]"
                      )}
                    >
                      {buyable ? `Get started with ${plan.name}` : `Not available ${cycle}`}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <p className="mt-10 text-center text-xs text-[hsl(var(--foreground-subtle))]">
            Payment is handled by Stripe. We never see your card details.
          </p>
        </div>
      </main>
    </div>
  );
}
