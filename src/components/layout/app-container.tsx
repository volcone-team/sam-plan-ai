import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AppContainerProps {
  children: ReactNode;
  className?: string;
  /** Maximum width constraint. Default: full width */
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "full";
}

/**
 * Outermost layout wrapper that constrains the full application content area.
 * Applies responsive horizontal padding and optional max-width.
 */
export function AppContainer({
  children,
  className,
  maxWidth = "full",
}: AppContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        maxWidth === "sm" && "max-w-[640px]",
        maxWidth === "md" && "max-w-[768px]",
        maxWidth === "lg" && "max-w-[1024px]",
        maxWidth === "xl" && "max-w-[1280px]",
        maxWidth === "2xl" && "max-w-[1536px]",
        className
      )}
    >
      {children}
    </div>
  );
}
