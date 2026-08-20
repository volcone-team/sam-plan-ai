import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { QuestionnaireData } from "../questionnaire-data";
import { WHATS_WORKED_OPTIONS } from "../questionnaire-data";

interface WhatsWorkedStepProps {
  data: QuestionnaireData;
  onChange: (updates: Partial<QuestionnaireData>) => void;
  errors: Record<string, string>;
}

export function WhatsWorkedStep({ data, onChange, errors }: WhatsWorkedStepProps) {
  const toggle = (item: string) => {
    const current = data.whatsWorked;
    const updated = current.includes(item)
      ? current.filter((i) => i !== item)
      : [...current, item];
    onChange({ whatsWorked: updated });
  };

  return (
    <div className="space-y-6">
      {errors.whatsWorked && (
        <p className="text-xs text-[hsl(var(--error))]">{errors.whatsWorked}</p>
      )}

      <div className="space-y-2">
        <Label>Select all that have driven real results</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {WHATS_WORKED_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className={cn(
                "rounded-[var(--radius-md)] border px-3 py-2.5 text-sm font-medium text-left",
                "transition-colors duration-[var(--duration-default)]",
                data.whatsWorked.includes(option)
                  ? "border-primary bg-[hsl(var(--primary)_/_0.1)] text-primary"
                  : "border-input hover:border-[hsl(var(--border-strong))] text-foreground"
              )}
              aria-pressed={data.whatsWorked.includes(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="whats-worked-notes">
          What has worked best and why? (optional)
        </Label>
        <Textarea
          id="whats-worked-notes"
          placeholder="Tell us about your most successful marketing or sales initiatives..."
          rows={3}
          value={data.whatsWorkedNotes}
          onChange={(e) => onChange({ whatsWorkedNotes: e.target.value })}
        />
      </div>
    </div>
  );
}
