import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SidebarNavItemProps {
  label: string;
  href: string;
  icon: LucideIcon;
  isActive: boolean;
  collapsed: boolean;
}

/**
 * Individual navigation item in the sidebar.
 * Shows icon + label when expanded, icon-only with tooltip when collapsed.
 */
export function SidebarNavItem({
  label,
  href,
  icon: Icon,
  isActive,
  collapsed,
}: SidebarNavItemProps) {
  return (
    <li>
      <Link
        href={href}
        aria-current={isActive ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        title={collapsed ? label : undefined}
        className={cn(
          "flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium",
          "transition-colors duration-[var(--duration-default)] ease-[var(--ease-default)]",
          collapsed && "justify-center px-2",
          isActive
            ? "bg-[hsl(var(--sidebar-accent))] text-[hsl(var(--sidebar-primary))]"
            : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-[hsl(var(--sidebar-accent-foreground))]"
        )}
      >
        <Icon className="h-5 w-5 shrink-0" />
        {!collapsed && <span className="whitespace-nowrap">{label}</span>}
      </Link>
    </li>
  );
}
