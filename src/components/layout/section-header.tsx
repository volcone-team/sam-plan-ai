import type { ReactNode, ElementType } from "react";
import { cn } from "@/lib/utils";

export interface SectionHeaderProps {
  /** Section title */
  title: string | ReactNode;
  /** Optional description below title */
  description?: string | ReactNode;
  /** Optional right-aligned action area */
  actions?: ReactNode;
  /** Heading level. Default: h2 */
  as?: "h2" | "h3" | "h4";
  className?: string;
}

const headingSizeMap = {
  h2: "text-xl font-semibold tracking-tight sm:text-2xl",
  h3: "text-lg font-semibold tracking-tight sm:text-xl",
  h4: "text-base font-semibold tracking-tight sm:text-lg",
} as const;

/**
 * Standardized section-level header with title, optional description, and action area.
 * Responsive: actions stack below title on mobile, align right on desktop.
 * Smaller scale than PageHeader for section-level hierarchy.
 */
export function SectionHeader({
  title,
  description,
  actions,
  as = "h2",
  className,
}: SectionHeaderProps) {
  const Heading = as as ElementType;

  return (
    <div className={cn("space-y-1 pb-4", className)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <Heading className={headingSizeMap[as]}>{title}</Heading>
          {description && (
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>
    </div>
  );
}
