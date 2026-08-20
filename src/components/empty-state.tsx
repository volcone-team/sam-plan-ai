import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** Icon to display */
  icon: LucideIcon;
  /** Heading text */
  title: string;
  /** Description text */
  description?: string;
  /** Optional action (button, link, etc.) */
  action?: ReactNode;
  className?: string;
}

/**
 * Empty state placeholder for pages without content.
 * Displays an icon, title, description, and optional action.
 * Purely presentational — no business logic.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-lg)]",
        "border border-dashed border-border bg-card p-12 text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-full)] bg-[hsl(var(--background-muted))]">
        <Icon className="h-6 w-6 text-[hsl(var(--foreground-muted))]" />
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {description && (
        <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))] max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
