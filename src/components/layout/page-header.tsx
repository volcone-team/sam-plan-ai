import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Page title (h1) */
  title: string | ReactNode;
  /** Optional description/subtitle below title */
  description?: string | ReactNode;
  /** Optional right-aligned action area (buttons, etc.) */
  actions?: ReactNode;
  /** Optional breadcrumb slot rendered above title */
  breadcrumbs?: ReactNode;
  className?: string;
}

/**
 * Standardized page-level header with title, optional description, and action area.
 * Responsive: actions stack below title on mobile, align right on desktop.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn("space-y-2 pb-6 border-b border-border", className)}>
      {breadcrumbs && <div className="mb-2">{breadcrumbs}</div>}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-[hsl(var(--foreground-muted))] sm:text-base">
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
