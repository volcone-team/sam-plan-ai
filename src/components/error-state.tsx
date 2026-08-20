import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ErrorStateProps {
  /** Error title. Default: "Something went wrong" */
  title?: string;
  /** Error description or message */
  description?: string;
  /** Optional action to recover (retry button, link, etc.) */
  action?: ReactNode;
  /** Whether to show the full-page centered layout or inline */
  fullPage?: boolean;
  className?: string;
}

/**
 * Error state display.
 * Shows an alert icon, title, description, and optional recovery action.
 * Accessible: uses role="alert" for immediate screen reader announcement.
 * Purely presentational — no business logic.
 */
export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  fullPage = false,
  className,
}: ErrorStateProps) {
  const content = (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-[var(--radius-lg)]",
        "border border-[hsl(var(--error-border))] bg-[hsl(var(--error-background))] p-12 text-center",
        className
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-full)] bg-[hsl(var(--error)_/_0.1)]">
        <AlertTriangle className="h-6 w-6 text-[hsl(var(--error))]" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-[hsl(var(--error-foreground))]">
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))] max-w-sm">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );

  if (fullPage) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4">
        {content}
      </div>
    );
  }

  return content;
}
