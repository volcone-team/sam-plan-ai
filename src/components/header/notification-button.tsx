"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

const MOCK_NOTIFICATIONS = [
  { id: 1, message: "Weekly results due — enter this week's actuals", time: "Just now", unread: true },
  { id: 2, message: "Q1 Webinar task 'Run live webinar' is due tomorrow", time: "1 hour ago", unread: true },
  { id: 3, message: "LinkedIn Outreach initiative is 40% complete", time: "3 hours ago", unread: false },
  { id: 4, message: "Revenue this month: on track vs Better projection", time: "1 day ago", unread: false },
  { id: 5, message: "New benchmark data available for Email Campaign", time: "2 days ago", unread: false },
];

export interface NotificationButtonProps {
  count?: number;
  className?: string;
}

export function NotificationButton({ count: _count, className }: NotificationButtonProps) {
  const [open, setOpen] = useState(false);
  const unreadCount = MOCK_NOTIFICATIONS.filter(n => n.unread).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "No new notifications"}
        className={cn(
          "relative inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]",
          "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]",
          "transition-colors",
          className
        )}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white"
            aria-hidden
          >
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-[var(--radius-lg)] border border-border bg-card shadow-lg">
            <div className="border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Notifications</h3>
            </div>
            <ul className="max-h-80 overflow-y-auto divide-y divide-border">
              {MOCK_NOTIFICATIONS.map(notification => (
                <li
                  key={notification.id}
                  className={cn(
                    "px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--muted))]",
                    notification.unread && "bg-[hsl(var(--primary)/0.03)]"
                  )}
                >
                  <div className="flex items-start gap-2">
                    {notification.unread && (
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--primary))]" />
                    )}
                    <div className={cn("min-w-0", !notification.unread && "ml-4")}>
                      <p className="text-sm text-[hsl(var(--foreground))]">{notification.message}</p>
                      <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{notification.time}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-border px-4 py-2">
              <p className="text-xs text-center text-[hsl(var(--foreground-muted))]">
                Notifications will be live after auth is connected
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
