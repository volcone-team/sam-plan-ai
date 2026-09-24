"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  metadata: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: AppNotification[];
  unreadCount: number;
}

const POLL_INTERVAL_MS = 60_000;
const FETCH_LIMIT = 20;

/** Format an ISO timestamp into a short relative label. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;

  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;

  return new Date(then).toLocaleDateString();
}

export interface NotificationButtonProps {
  count?: number;
  className?: string;
}

export function NotificationButton(props: NotificationButtonProps) {
  const { className } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Tracks whether the component is still mounted so in-flight fetches can be ignored.
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notifications?limit=${FETCH_LIMIT}`, {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = (await res.json()) as NotificationsResponse;
      if (!mountedRef.current) return;
      setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
      setUnreadCount(typeof data.unreadCount === "number" ? data.unreadCount : 0);
      setError(false);
    } catch {
      if (!mountedRef.current) return;
      // Fail quietly: leave the badge as-is and surface an unobtrusive row.
      setError(true);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setHasLoaded(true);
      }
    }
  }, []);

  // Initial fetch + 60s polling. Cleanup ignores in-flight results and clears the interval.
  useEffect(() => {
    mountedRef.current = true;
    const run = async () => {
      await load();
    };
    void run();
    const interval = setInterval(() => {
      void run();
    }, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  // Refresh when the dropdown is opened so it's fresh on click.
  useEffect(() => {
    if (!open) return;
    const run = async () => {
      await load();
    };
    void run();
  }, [open, load]);

  // Optional: close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const markRead = useCallback(async (id: string) => {
    // Optimistic update: mark read locally and drop the unread count.
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === id && n.readAt === null
          ? { ...n, readAt: new Date().toISOString() }
          : n
      )
    );
    setUnreadCount((prev) => Math.max(0, prev - 1));

    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      // Swallow: local state already reflects the intent; next poll reconciles.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setNotifications((prev) =>
      prev.map((n) => (n.readAt === null ? { ...n, readAt: now } : n))
    );
    setUnreadCount(0);

    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      // Swallow: next poll reconciles.
    }
  }, []);

  const handleNotificationClick = useCallback(
    (notification: AppNotification) => {
      const isUnread = notification.readAt === null;
      if (isUnread) void markRead(notification.id);
      if (notification.link) {
        setOpen(false);
        router.push(notification.link);
      }
    },
    [markRead, router]
  );

  const badgeLabel = unreadCount > 9 ? "9+" : String(unreadCount);
  const showInitialLoading = loading && !hasLoaded && notifications.length === 0;

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
            {badgeLabel}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-[var(--radius-lg)] border border-border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Notifications</h3>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  className="text-xs font-medium text-[hsl(var(--primary))] hover:underline"
                >
                  Mark all as read
                </button>
              )}
            </div>
            <ul className="max-h-80 overflow-y-auto divide-y divide-border">
              {showInitialLoading ? (
                <li className="px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">Loading…</li>
              ) : error && notifications.length === 0 ? (
                <li className="px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
                  Couldn&apos;t load notifications
                </li>
              ) : notifications.length === 0 ? (
                <li className="px-4 py-6 text-center text-sm text-[hsl(var(--foreground-muted))]">
                  You&apos;re all caught up
                </li>
              ) : (
                notifications.map((notification) => {
                  const isUnread = notification.readAt === null;
                  return (
                    <li key={notification.id}>
                      <button
                        type="button"
                        onClick={() => handleNotificationClick(notification)}
                        className={cn(
                          "block w-full px-4 py-3 text-left transition-colors hover:bg-[hsl(var(--muted))]",
                          isUnread && "bg-[hsl(var(--primary)/0.03)]"
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {isUnread && (
                            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--primary))]" />
                          )}
                          <div className={cn("min-w-0", !isUnread && "ml-4")}>
                            <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                              {notification.title}
                            </p>
                            {notification.body && (
                              <p className="mt-0.5 text-sm text-[hsl(var(--foreground-muted))]">
                                {notification.body}
                              </p>
                            )}
                            <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
                              {timeAgo(notification.createdAt)}
                            </p>
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
