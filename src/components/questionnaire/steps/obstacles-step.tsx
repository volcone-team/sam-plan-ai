import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { QuestionnaireData } from "../questionnaire-data";
import { OBSTACLE_OPTIONS } from "../questionnaire-data";

interface ObstaclesStepProps {
  data: QuestionnaireData;
  onChange: (updates: Partial<QuestionnaireData>) => void;
  errors: Record<string, string>;
}

export function ObstaclesStep({ data, onChange }: ObstaclesStepProps) {
  const toggle = (item: string) => {
    const current = data.obstacles;
    const updated = current.includes(item)
      ? current.filter((i) => i !== item)
      : [...current, item];
    onChange({ obstacles: updated });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label>Select your biggest challenges</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {OBSTACLE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => toggle(option)}
              className={cn(
                "rounded-[var(--radius-md)] border px-3 py-2.5 text-sm font-medium text-left",
                "transition-colors duration-[var(--duration-default)]",
                data.obstacles.includes(option)
                  ? "border-primary bg-[hsl(var(--primary)_/_0.1)] text-primary"
                  : "border-input hover:border-[hsl(var(--border-strong))] text-foreground"
              )}
              aria-pressed={data.obstacles.includes(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="obstacle-notes">
          Tell us more about your biggest challenge (optional)
        </Label>
        <Textarea
          id="obstacle-notes"
          placeholder="What has held you back from reaching your revenue goals?"
          rows={3}
          value={data.obstacleNotes}
          onChange={(e) => onChange({ obstacleNotes: e.target.value })}
        />
      </div>
    </div>
  );
}
