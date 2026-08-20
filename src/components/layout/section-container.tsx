import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface SectionContainerProps {
  children: ReactNode;
  className?: string;
  /** Padding variant. Default: md */
  padding?: "none" | "sm" | "md" | "lg";
  /** Background variant. Default: default (transparent) */
  variant?: "default" | "muted" | "elevated";
  /** Show a bottom border separator */
  bordered?: boolean;
  /** Accessible label for the section (renders aria-labelledby) */
  "aria-labelledby"?: string;
}

const paddingMap = {
  none: "",
  sm: "py-3 px-4",
  md: "py-5 px-4 sm:px-6",
  lg: "py-8 px-4 sm:px-6 lg:px-8",
} as const;

const variantMap = {
  default: "",
  muted: "bg-[hsl(var(--background-muted))] rounded-[var(--radius-lg)]",
  elevated:
    "bg-[hsl(var(--background-elevated))] rounded-[var(--radius-lg)] shadow-[var(--shadow)]",
} as const;

/**
 * Grouping container for logical sections within a page.
 * Supports background variants, padding, and optional border separator.
 * Renders as <section> for accessibility.
 */
export function SectionContainer({
  children,
  className,
  padding = "md",
  variant = "default",
  bordered = false,
  "aria-labelledby": ariaLabelledBy,
}: SectionContainerProps) {
  return (
    <section
      aria-labelledby={ariaLabelledBy}
      className={cn(
        paddingMap[padding],
        variantMap[variant],
        bordered && "border-b border-border pb-6",
        className
      )}
    >
      {children}
    </section>
  );
}
