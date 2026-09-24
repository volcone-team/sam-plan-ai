"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/theme-toggle";
import { Breadcrumbs, type BreadcrumbItem } from "./breadcrumbs";
import { UserAvatar } from "./user-avatar";
import { NotificationButton } from "./notification-button";

export interface AppHeaderProps {
  /** Page title displayed in the header */
  title?: string;
  /** Breadcrumb items */
  breadcrumbs?: BreadcrumbItem[];
  /** Optional actions rendered before the default actions */
  actions?: ReactNode;
  /** Number of unread notifications */
  notificationCount?: number;
  /** Optional display-name override. When omitted, UserAvatar reads the
   *  signed-in profile from useAuth() so initials reflect the real user. */
  userName?: string;
  /** User avatar image URL */
  userImageUrl?: string;
  className?: string;
}

/**
 * Shared application header.
 * Sticky, responsive, accessible.
 * Contains breadcrumbs, page title, theme toggle, notifications, and user avatar.
 * No authentication or backend integration.
 */
export function AppHeader({
  title,
  breadcrumbs,
  actions,
  notificationCount = 0,
  userName,
  userImageUrl,
  className,
}: AppHeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 hidden lg:block",
        "border-b border-border bg-background/95 backdrop-blur-sm",
        className
      )}
    >
      <div className="flex h-14 items-center justify-between px-6">
        {/* Left: Breadcrumbs + Title */}
        <div className="flex items-center gap-4 min-w-0">
          <div className="flex flex-col justify-center min-w-0">
            {breadcrumbs && breadcrumbs.length > 0 && (
              <Breadcrumbs items={breadcrumbs} className="mb-0.5" />
            )}
            {title && (
              <h1 className="text-base font-semibold truncate">{title}</h1>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {actions}
          <ThemeToggle />
          <NotificationButton count={notificationCount} />
          <div className="ml-2">
            <UserAvatar name={userName} imageUrl={userImageUrl} size="sm" />
          </div>
        </div>
      </div>
    </header>
  );
}
