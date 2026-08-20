"use client";

import type { ReactNode } from "react";

export interface AppShellProps {
  sidebar: ReactNode;
  mobileNav: ReactNode;
  header: ReactNode;
  children: ReactNode;
}

/**
 * Application shell that composes sidebar, mobile nav, header, and content area.
 * The content area adjusts its left padding based on the sidebar width CSS variables.
 * Content scrolls independently from the fixed sidebar.
 */
export function AppShell({
  sidebar,
  mobileNav,
  header,
  children,
}: AppShellProps) {
  return (
    <div className="relative min-h-dvh">
      {/* Desktop Sidebar — fixed left, hidden on mobile */}
      {sidebar}

      {/* Mobile Navigation — visible only below lg breakpoint */}
      {mobileNav}

      {/* Main content area — offset by sidebar width on desktop */}
      <div className="flex min-h-dvh flex-col lg:pl-[var(--sidebar-width)] transition-[padding] duration-[var(--duration-slow)] ease-[var(--ease-default)]">
        {/* Desktop Header — sticky top, hidden on mobile */}
        {header}

        {/* Scrollable content area */}
        <div className="flex-1">{children}</div>
      </div>
    </div>
  );
}
