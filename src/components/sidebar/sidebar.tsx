"use client";

import { useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navigationGroups } from "./sidebar-config";
import { SidebarLogo } from "./sidebar-logo";
import { SidebarNavItem } from "./sidebar-nav-item";
import { SidebarToggle } from "./sidebar-toggle";

const STORAGE_KEY = "sam-sidebar-collapsed";

function getStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(STORAGE_KEY) === "true";
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

/**
 * Primary application sidebar with grouped navigation.
 * Collapsible, with state persisted in localStorage.
 * Hidden below lg breakpoint (mobile nav is a separate phase).
 */
export function Sidebar() {
  const pathname = usePathname();
  const storedCollapsed = useSyncExternalStore(
    subscribe,
    getStoredCollapsed,
    () => false
  );
  const [collapsed, setCollapsed] = useState(storedCollapsed);

  const handleToggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col fixed inset-y-0 left-0 z-40",
        "bg-[hsl(var(--sidebar))] border-r border-[hsl(var(--sidebar-border))]",
        "transition-[width] duration-[var(--duration-slow)] ease-[var(--ease-default)]",
        collapsed
          ? "w-[var(--sidebar-width-collapsed)]"
          : "w-[var(--sidebar-width)]"
      )}
    >
      {/* Logo */}
      <div className="shrink-0 border-b border-[hsl(var(--sidebar-border))] px-3">
        <SidebarLogo collapsed={collapsed} />
      </div>

      {/* Navigation */}
      <nav
        aria-label="Main navigation"
        className="flex-1 overflow-y-auto px-3 py-4"
      >
        <div className="space-y-6">
          {navigationGroups.map((group) => (
            <div key={group.label}>
              {!collapsed && (
                <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <SidebarNavItem
                    key={item.href}
                    label={item.label}
                    href={item.href}
                    icon={item.icon}
                    isActive={isActive(item.href)}
                    collapsed={collapsed}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* Footer with Toggle */}
      <div className="shrink-0 border-t border-[hsl(var(--sidebar-border))] px-3 py-3">
        <SidebarToggle collapsed={collapsed} onToggle={handleToggle} />
      </div>
    </aside>
  );
}
