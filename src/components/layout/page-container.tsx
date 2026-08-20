import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface PageContainerProps {
  children: ReactNode;
  className?: string;
  /** Vertical gap between direct children. Default: md */
  gap?: "sm" | "md" | "lg";
  /** Optional max-width constraint */
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
}

const gapMap = {
  sm: "space-y-4",
  md: "space-y-6",
  lg: "space-y-8",
} as const;

/**
 * Primary wrapper for a page's content area.
 * Provides consistent vertical/horizontal padding and spacing between children.
 * Renders as <main> for accessibility.
 */
export function PageContainer({
  children,
  className,
  gap = "md",
  maxWidth = "full",
}: PageContainerProps) {
  return (
    <main
      className={cn(
        "w-full py-6 px-4 sm:px-6 lg:px-8 lg:py-8",
        gapMap[gap],
        maxWidth === "sm" && "mx-auto max-w-[640px]",
        maxWidth === "md" && "mx-auto max-w-[768px]",
        maxWidth === "lg" && "mx-auto max-w-[1024px]",
        maxWidth === "xl" && "mx-auto max-w-[1280px]",
        maxWidth === "2xl" && "mx-auto max-w-[1536px]",
        className
      )}
    >
      {children}
    </main>
  );
}
