import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { QuestionnaireData } from "../questionnaire-data";
import { BUSINESS_STAGE_OPTIONS } from "../questionnaire-data";

interface BudgetTeamStepProps {
  data: QuestionnaireData;
  onChange: (updates: Partial<QuestionnaireData>) => void;
  errors: Record<string, string>;
}

export function BudgetTeamStep({ data, onChange, errors }: BudgetTeamStepProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="monthly-budget" required>
            Monthly Marketing Budget
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[hsl(var(--foreground-muted))]">
              $
            </span>
            <Input
              id="monthly-budget"
              type="number"
              placeholder="3,000"
              className="pl-7"
              value={data.monthlyMarketingBudget ?? ""}
              onChange={(e) =>
                onChange({ monthlyMarketingBudget: e.target.value ? Number(e.target.value) : null })
              }
              error={!!errors.monthlyMarketingBudget}
            />
          </div>
          {errors.monthlyMarketingBudget && (
            <p className="text-xs text-[hsl(var(--error))]">{errors.monthlyMarketingBudget}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="team-size">Team Size</Label>
          <Input
            id="team-size"
            type="number"
            placeholder="1"
            value={data.teamSize ?? ""}
            onChange={(e) =>
              onChange({ teamSize: e.target.value ? Number(e.target.value) : null })
            }
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="hours-per-week">Hours Available Per Week</Label>
          <Input
            id="hours-per-week"
            type="number"
            placeholder="20"
            value={data.hoursAvailablePerWeek ?? ""}
            onChange={(e) =>
              onChange({ hoursAvailablePerWeek: e.target.value ? Number(e.target.value) : null })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Business Stage</Label>
        <div className="grid grid-cols-2 gap-2">
          {BUSINESS_STAGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange({ businessStage: opt.value })}
              className={cn(
                "rounded-[var(--radius-md)] border px-3 py-2.5 text-sm font-medium",
                "transition-colors duration-[var(--duration-default)]",
                data.businessStage === opt.value
                  ? "border-primary bg-[hsl(var(--primary)_/_0.1)] text-primary"
                  : "border-input hover:border-[hsl(var(--border-strong))] text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
