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
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navigationGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      // Renamed from "Year at a Glance". The ROUTE is unchanged on purpose:
      // /year-at-a-glance is the post-login redirect in middleware, in the 2FA
      // flow and in several saved links, so renaming the path would break all
      // of them for a label change.
      { label: "Your Dashboard", href: "/year-at-a-glance", icon: LayoutDashboard },
    ],
  },
  {
    label: "Planner",
    items: [
      { label: "Daily", href: "/planner/daily", icon: CalendarDays },
      { label: "Weekly", href: "/planner/weekly", icon: Calendar },
      { label: "Monthly", href: "/planner/monthly", icon: CalendarRange },
      { label: "Quarterly", href: "/planner/quarterly", icon: CalendarClock },
      { label: "Calendar", href: "/planner/calendar", icon: CalendarCheck },
      { label: "Timeline", href: "/planner/timeline", icon: GanttChart },
    ],
  },
  {
    label: "Execution",
    items: [
      { label: "Initiatives", href: "/initiatives", icon: Rocket },
      { label: "Products", href: "/products", icon: Package },
      { label: "Reports", href: "/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Resources",
    items: [
      { label: "Quickstart Guide", href: "/quickstart-guide", icon: BookOpen },
      { label: "SAM University", href: "/sam-university", icon: GraduationCap },
      { label: "FAQ", href: "/faq", icon: HelpCircle },
    ],
  },
  {
    label: "Account",
    items: [
      { label: "Plan History", href: "/plan-history", icon: RotateCcw },
      { label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

/** Flat list of all nav items (for mobile nav and other consumers) */
export const navigationItems: NavItem[] = navigationGroups.flatMap(
  (group) => group.items
);
