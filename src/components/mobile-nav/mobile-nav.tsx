"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";
import { navigationGroups } from "@/components/sidebar/sidebar-config";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Mobile navigation drawer.
 * Visible only below lg breakpoint (where desktop sidebar is hidden).
 * Reuses the same navigation config as the desktop sidebar.
 * Closes automatically on navigation.
 */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <div className="lg:hidden">
      {/* Mobile Header Bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-14 items-center border-b border-border bg-background px-4">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label="Open navigation menu"
              className={cn(
                "inline-flex items-center justify-center rounded-[var(--radius-md)] p-2",
                "text-foreground hover:bg-accent",
                "transition-colors duration-[var(--duration-default)]"
              )}
            >
              <Menu className="h-5 w-5" />
            </button>
          </SheetTrigger>

          <SheetContent side="left" className="w-72 p-0 overflow-y-auto">
            <SheetHeader className="border-b border-border px-4 py-4">
              <SheetTitle className="flex items-center gap-2">
                <BrandLogo />
              </SheetTitle>
            </SheetHeader>

            <nav aria-label="Mobile navigation" className="px-3 py-4">
              <div className="space-y-6">
                {navigationGroups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))]">
                      {group.label}
                    </p>
                    <ul className="space-y-0.5">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.href);

                        return (
                          <li key={item.href}>
                            <Link
                              href={item.href}
                              onClick={() => setOpen(false)}
                              aria-current={active ? "page" : undefined}
                              className={cn(
                                "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium",
                                "transition-colors duration-[var(--duration-default)]",
                                active
                                  ? "bg-accent text-primary"
                                  : "text-foreground hover:bg-accent hover:text-accent-foreground"
                              )}
                            >
                              <Icon className="h-5 w-5 shrink-0" />
                              <span>{item.label}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </nav>
          </SheetContent>
        </Sheet>

        {/* Logo in mobile header */}
        <Link
          href="/"
          className="ml-3 flex items-center gap-2"
          aria-label="SAM Flow AI — Go to home"
        >
          <BrandLogo />
        </Link>
      </div>

      {/* Spacer to push content below fixed header */}
      <div className="h-14" />
    </div>
  );
}
