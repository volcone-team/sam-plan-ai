'use client';

import { Lightbulb, Target } from 'lucide-react';
import type { InitiativeType, DifficultyDimensions } from '@/types/initiative-type.types';

export interface InitiativeWhyProps {
  initiativeType: InitiativeType | null;
}

interface DifficultyBarProps {
  label: string;
  value: number;
  maxValue?: number;
}

function DifficultyBar({ label, value, maxValue = 10 }: DifficultyBarProps) {
  const percentage = (value / maxValue) * 100;

  // Color based on value: low = green, mid = yellow, high = red
  let barColor = 'bg-[hsl(var(--success))]';
  if (value > 6) barColor = 'bg-[hsl(var(--error))]';
  else if (value > 3) barColor = 'bg-[hsl(var(--warning))]';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[hsl(var(--foreground-muted))]">{label}</span>
        <span className="text-xs font-semibold text-[hsl(var(--foreground))]">{value}/10</span>
      </div>
      <div className="h-2 w-full rounded-full bg-[hsl(var(--background-muted))]">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${percentage}%` }}
          role="meter"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={maxValue}
          aria-label={`${label}: ${value} out of ${maxValue}`}
        />
      </div>
    </div>
  );
}

const difficultyLabels: Record<keyof DifficultyDimensions, string> = {
  effortToImplement: 'Effort to Implement',
  skillExpertiseRequired: 'Skill / Expertise Required',
  timeToResults: 'Time to Results',
  costToRun: 'Cost to Run',
};

/**
 * "Why This Initiative" section.
 * Shows the AI context description, difficulty dimensions, and sizing guidance.
 */
export function InitiativeWhy({ initiativeType }: InitiativeWhyProps) {
  if (!initiativeType) return null;

  const { aiContext, difficulty } = initiativeType;

  return (
    <section aria-labelledby="why-heading">
      <h2 id="why-heading" className="text-lg font-semibold text-[hsl(var(--foreground))] flex items-center gap-2">
        <Lightbulb className="h-5 w-5 text-[hsl(var(--warning))]" />
        Why This Initiative
      </h2>

      <div className="mt-4 grid gap-6 md:grid-cols-2">
        {/* Description and sizing guidance */}
        <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <div>
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-2">
              When to Use
            </h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
              {aiContext.description}
            </p>
          </div>

          <div className="pt-4 border-t border-border">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-2 flex items-center gap-2">
              <Target className="h-4 w-4 text-[hsl(var(--primary))]" />
              Sizing Guidance
            </h3>
            <p className="text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
              {aiContext.sizingGuidance}
            </p>
          </div>
        </div>

        {/* Difficulty dimensions */}
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] mb-4">
            Difficulty Dimensions
          </h3>
          <div className="space-y-4">
            {(Object.keys(difficultyLabels) as Array<keyof DifficultyDimensions>).map(key => (
              <DifficultyBar
                key={key}
                label={difficultyLabels[key]}
                value={difficulty[key]}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
