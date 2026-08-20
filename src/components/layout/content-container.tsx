import type { ReactNode, ElementType } from "react";
import { cn } from "@/lib/utils";

export interface ContentContainerProps {
  children: ReactNode;
  className?: string;
  /** Maximum content width. Default: lg (1024px) */
  maxWidth?: "sm" | "md" | "lg" | "xl" | "full";
  /** HTML element to render. Default: div */
  as?: ElementType;
}

/**
 * Content-width wrapper for constraining readable content within a page.
 * Centers content horizontally with consistent padding.
 */
export function ContentContainer({
  children,
  className,
  maxWidth = "lg",
  as: Component = "div",
}: ContentContainerProps) {
  return (
    <Component
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        maxWidth === "sm" && "max-w-[640px]",
        maxWidth === "md" && "max-w-[768px]",
        maxWidth === "lg" && "max-w-[1024px]",
        maxWidth === "xl" && "max-w-[1280px]",
        className
      )}
    >
      {children}
    </Component>
  );
}
