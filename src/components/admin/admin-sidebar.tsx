"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Building2,
  Rocket,
  Sparkles,
  BarChart3,
  BookOpen,
  CreditCard,
  TrendingUp,
  Bell,
  ScrollText,
  Settings,
  Shield,
  Gauge,
  Menu,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthContext } from "@/components/auth-provider";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Shown only to super admins. */
  superAdminOnly?: boolean;
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Customer Users", href: "/admin/users", icon: Users },
  { label: "Internal Users", href: "/admin/internal-users", icon: Shield },
  { label: "Companies", href: "/admin/companies", icon: Building2 },
  /*
   * "Questionnaire" is REMOVED from the nav, not just hidden.
   *
   * The page let an admin add, reorder, reword and delete questions, and the
   * changes persisted across refreshes — but only to that admin's own
   * localStorage. It had no API route and the customer questionnaire never read
   * it, so configuring questions there changed nothing for any customer while
   * looking exactly as though it had. The route still exists and explains this;
   * it is simply no longer presented as a working tool.
   */
  { label: "Initiative Library", href: "/admin/initiatives", icon: Rocket },
  { label: "AI Workbook", href: "/admin/ai-workbook", icon: Sparkles },
  { label: "Benchmarks", href: "/admin/benchmarks", icon: BarChart3 },
  { label: "Content", href: "/admin/content", icon: BookOpen },
  { label: "Subscriptions", href: "/admin/subscriptions", icon: CreditCard },
  { label: "Analytics", href: "/admin/analytics", icon: TrendingUp },
  { label: "Notifications", href: "/admin/notifications", icon: Bell },
  { label: "Activity Log", href: "/admin/activity", icon: ScrollText },
  // Super admin only: shows platform-wide AI spend and controls what customers
  // may spend on a paid API.
  { label: "AI Usage & Tools", href: "/admin/ai-tools", icon: Gauge, superAdminOnly: true },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

/**
 * Admin sidebar navigation.
 * Dark-themed, fixed on desktop, collapsible hamburger on mobile.
 */
export function AdminSidebar() {
  const pathname = usePathname();
  const { adminLevel } = useAuthContext();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Hiding the link is presentation only — the page itself and both APIs it
  // calls enforce super-admin server-side. This just avoids advertising a
  // destination that would redirect.
  const visibleNavItems = navItems.filter(
    (item) => !item.superAdminOnly || adminLevel === "super_admin"
  );

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        type="button"
        aria-label="Toggle admin navigation"
        className="fixed top-4 left-4 z-50 lg:hidden rounded-[var(--radius-md)] bg-[hsl(210_80%_10%)] p-2 text-gray-300"
        onClick={() => setMobileOpen(!mobileOpen)}
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[260px] flex-col",
          "bg-[hsl(210_80%_10%)] border-r border-[hsl(210_40%_22%)]",
          "transition-transform duration-[var(--duration-slow)] ease-[var(--ease-default)]",
          "lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Branding */}
        <div className="flex h-16 shrink-0 items-center gap-2 border-b border-[hsl(210_40%_22%)] px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[hsl(152_100%_35%)]">
            <Settings className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-semibold text-white">Admin Panel</span>
        </div>

        {/* Navigation */}
        <nav aria-label="Admin navigation" className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {visibleNavItems.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium",
                      "transition-colors duration-[var(--duration-default)]",
                      active
                        ? "border-l-2 border-[hsl(152_100%_40%)] bg-[hsl(210_50%_18%)] text-white"
                        : "text-gray-300 hover:bg-[hsl(210_50%_18%)] hover:text-white"
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="shrink-0 border-t border-[hsl(210_40%_22%)] px-4 py-3">
          <Link
            href="/"
            className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            ← Back to App
          </Link>
        </div>
      </aside>
    </>
  );
}
