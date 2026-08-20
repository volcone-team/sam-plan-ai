"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";

export interface SidebarLogoProps {
  collapsed: boolean;
}

/**
 * SAM Flow AI brand mark displayed at the top of the sidebar.
 * Shows full text when expanded, icon-only when collapsed.
 */
export function SidebarLogo({ collapsed }: SidebarLogoProps) {
  return (
    <Link
      href="/"
      className={cn(
        "flex items-center gap-2 px-3 py-4 text-[hsl(var(--sidebar-foreground))]",
        "hover:opacity-80 transition-opacity duration-[var(--duration-default)]",
        collapsed && "justify-center px-0"
      )}
      aria-label="SAM Flow AI — Go to home"
    >
      <BrandLogo className="shrink-0" />
    </Link>
  );
}
