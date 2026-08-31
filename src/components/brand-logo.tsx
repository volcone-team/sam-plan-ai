"use client";

import Image from "next/image";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Brand logo that swaps between light and dark versions
 * based on the current theme.
 * - Light mode: shows logo-light.png (dark logo on light background)
 * - Dark mode: shows logo-dark.png (light logo on dark background)
 */
export function BrandLogo({ width = 120, height = 40, className }: BrandLogoProps) {
  const { resolvedTheme } = useTheme();

  return (
    <>
      {/* Light logo for light mode (light background) */}
      <Image
        src="/logo-light.png"
        alt="SAM Plan AI"
        width={width}
        height={height}
        className={cn(
          "rounded-[var(--radius-sm)]",
          resolvedTheme === "dark" ? "hidden" : "block",
          className
        )}
      />
      {/* Dark logo for dark mode (dark background) */}
      <Image
        src="/logo-dark.png"
        alt="SAM Plan AI"
        width={width}
        height={height}
        className={cn(
          "rounded-[var(--radius-sm)]",
          resolvedTheme === "dark" ? "block" : "hidden",
          className
        )}
      />
    </>
  );
}
