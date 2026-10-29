import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  Calendar,
  CalendarRange,
  CalendarClock,
  CalendarCheck,
  GanttChart,
  Package,
  Rocket,
  BarChart3,
  BookOpen,
  GraduationCap,
  HelpCircle,
  Settings,
  LayoutDashboard,
  RotateCcw,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Draws a thin divider above this item. */
  dividerBefore?: boolean;
}

export interface NavGroup {
  /** Section heading. Null renders no heading, with a divider above the group. */
  label: string | null;
  items: NavItem[];
}

/*
 * Order and labels per the client's sidebar layout (Oct 2026). Only labels
 * changed; every route is unchanged, so saved links and redirects still work.
 * "Year" is the dashboard: /year-at-a-glance is the post-login redirect in
 * middleware and the 2FA flow, so its path stays.
 */
export const navigationGroups: NavGroup[] = [
  {
    label: "Plan",
    items: [
      { label: "Year", href: "/year-at-a-glance", icon: LayoutDashboard },
      { label: "Quarter", href: "/planner/quarterly", icon: CalendarClock },
      { label: "Month", href: "/planner/monthly", icon: CalendarRange },
      { label: "Week", href: "/planner/weekly", icon: Calendar },
      { label: "Day", href: "/planner/daily", icon: CalendarDays },
      { label: "Calendar", href: "/planner/calendar", icon: CalendarCheck, dividerBefore: true },
      { label: "Timeline", href: "/planner/timeline", icon: GanttChart },
    ],
  },
  {
    label: "Manage",
    items: [
      { label: "Initiatives", href: "/initiatives", icon: Rocket },
      { label: "Products", href: "/products", icon: Package },
      { label: "Reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Learn",
    items: [
      { label: "Quickstart Guide", href: "/quickstart-guide", icon: BookOpen },
      { label: "SAM University", href: "/sam-university", icon: GraduationCap },
      { label: "FAQ", href: "/faq", icon: HelpCircle },
    ],
  },
  {
    label: null,
    items: [
      { label: "Version History", href: "/plan-history", icon: RotateCcw },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

/** Flat list of all nav items (for mobile nav and other consumers) */
export const navigationItems: NavItem[] = navigationGroups.flatMap(
  (group) => group.items
);
