import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items?: BreadcrumbItem[];
  className?: string;
}

/**
 * Breadcrumb navigation placeholder.
 * Renders a simple breadcrumb trail. When no items provided, renders nothing.
 * Will be enhanced with route-based auto-generation in a later phase.
 */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  if (!items || items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center", className)}>
      <ol className="flex items-center gap-1 text-sm text-[hsl(var(--foreground-muted))]">
        {items.map((item, index) => (
          <li key={item.label} className="flex items-center gap-1">
            {index > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            {item.href && index < items.length - 1 ? (
              <a
                href={item.href}
                className="hover:text-foreground transition-colors duration-[var(--duration-default)]"
              >
                {item.label}
              </a>
            ) : (
              <span
                className={cn(
                  index === items.length - 1 && "text-foreground font-medium"
                )}
                aria-current={index === items.length - 1 ? "page" : undefined}
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
