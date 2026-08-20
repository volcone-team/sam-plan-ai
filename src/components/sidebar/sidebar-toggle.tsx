import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SidebarToggleProps {
  collapsed: boolean;
  onToggle: () => void;
}

/**
 * Toggle button to collapse/expand the sidebar.
 * Shows chevron-left when expanded, chevron-right when collapsed.
 */
export function SidebarToggle({ collapsed, onToggle }: SidebarToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className={cn(
        "flex items-center justify-center rounded-[var(--radius-md)] p-2",
        "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))]",
        "transition-colors duration-[var(--duration-default)] ease-[var(--ease-default)]",
        collapsed ? "mx-auto" : "ml-auto mr-2"
      )}
    >
      {collapsed ? (
        <ChevronRight className="h-4 w-4" />
      ) : (
        <ChevronLeft className="h-4 w-4" />
      )}
    </button>
  );
}
