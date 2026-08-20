import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { QuestionnaireData } from "../questionnaire-data";

interface RevenueGoalStepProps {
  data: QuestionnaireData;
  onChange: (updates: Partial<QuestionnaireData>) => void;
  errors: Record<string, string>;
}

const PERIOD_OPTIONS = [
  { value: "3-months", label: "3 Months" },
  { value: "6-months", label: "6 Months" },
  { value: "12-months", label: "12 Months" },
] as const;

export function RevenueGoalStep({ data, onChange, errors }: RevenueGoalStepProps) {
  return (
    <div className="space-y-6">
      <div className="rounded-[var(--radius-md)] bg-[hsl(var(--info-background))] border border-[hsl(var(--info-border))] p-3 text-sm text-[hsl(var(--foreground-muted))]">
        These values will be used to calculate your baseline goal, stretch goal, and annual revenue projections.
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="annual-revenue-goal" required>
            Annual Revenue Goal
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[hsl(var(--foreground-muted))]">$</span>
            <Input
              id="annual-revenue-goal"
              type="number"
              placeholder="750,000"
              className="pl-7"
              value={data.annualRevenueGoal ?? ""}
              onChange={(e) =>
                onChange({ annualRevenueGoal: e.target.value ? Number(e.target.value) : null })
              }
              error={!!errors.annualRevenueGoal}
            />
          </div>
          {errors.annualRevenueGoal && (
            <p className="text-xs text-[hsl(var(--error))]">{errors.annualRevenueGoal}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="prior-year-revenue" required>
            Prior Year Revenue
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[hsl(var(--foreground-muted))]">$</span>
            <Input
              id="prior-year-revenue"
              type="number"
              placeholder="450,000"
              className="pl-7"
              value={data.priorYearRevenue ?? ""}
              onChange={(e) =>
                onChange({ priorYearRevenue: e.target.value ? Number(e.target.value) : null })
              }
              error={!!errors.priorYearRevenue}
            />
          </div>
          {errors.priorYearRevenue && (
            <p className="text-xs text-[hsl(var(--error))]">{errors.priorYearRevenue}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label required>Planning Period</Label>
          <div className="grid grid-cols-3 gap-2">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ planningPeriod: opt.value })}
                className={cn(
                  "rounded-[var(--radius-md)] border px-3 py-2.5 text-sm font-medium",
                  "transition-colors duration-[var(--duration-default)]",
                  data.planningPeriod === opt.value
                    ? "border-primary bg-[hsl(var(--primary)_/_0.1)] text-primary"
                    : "border-input hover:border-[hsl(var(--border-strong))] text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {errors.planningPeriod && (
            <p className="text-xs text-[hsl(var(--error))]">{errors.planningPeriod}</p>
          )}
        </div>
      </div>
    </div>
  );
}
