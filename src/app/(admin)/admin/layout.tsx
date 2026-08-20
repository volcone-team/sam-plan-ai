import type { ReactNode } from "react";
import { AdminSidebar } from "@/components/admin";
import { ThemeToggle } from "@/components/theme-toggle";

interface AdminLayoutProps {
  children: ReactNode;
}

/**
 * Admin layout shell.
 * Fixed sidebar with dark theme, top bar with admin badge.
 * Completely separate from the customer-facing app layout.
 */
export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <div className="relative min-h-dvh">
      {/* Sidebar */}
      <AdminSidebar />

      {/* Main content area — offset by sidebar width on desktop */}
      <div className="flex min-h-dvh flex-col lg:pl-[260px]">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-card px-6">
          {/* Left spacer for mobile hamburger */}
          <div className="lg:hidden w-10" />
          <div className="hidden lg:block" />

          {/* Right side */}
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-[hsl(var(--primary))] px-2.5 py-0.5 text-xs font-semibold text-white">
              Admin
            </span>
            <ThemeToggle />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
