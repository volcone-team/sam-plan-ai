"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Clock, Info, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "info" | "wait" | "success" | "error";

interface ToastItem {
  id: string;
  message: string;
  variant: ToastVariant;
  /** ms before auto-dismiss. Omit/0 for a toast that must be dismissed manually or via dismissToast(id). */
  duration?: number;
}

interface ToastContextValue {
  /** Show a toast. Returns its id so callers can dismiss it early (e.g. once a slow request finishes). */
  showToast: (message: string, options?: { variant?: ToastVariant; duration?: number }) => string;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/**
 * Backgrounds are FULLY OPAQUE.
 *
 * The dark variants used to carry a `/40` alpha, so page content showed through
 * the toast — a heading or button behind it read as overlapping text rather
 * than as something covered up. A notification has to be legible against
 * whatever it lands on, and it is already offset below the header, so there is
 * nothing to be gained by letting the page bleed through.
 */
const VARIANT_STYLES: Record<ToastVariant, { icon: typeof Info; classes: string }> = {
  info: {
    icon: Info,
    classes: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100",
  },
  wait: {
    icon: Clock,
    classes: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  },
  success: {
    icon: CheckCircle2,
    classes: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  },
  error: {
    icon: AlertTriangle,
    classes: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-100",
  },
};

/**
 * App-wide toast notifications.
 *
 * Built for one specific problem: AI plan generation/enhancement takes
 * 20-60+ seconds, and users had no signal that this was expected - just a
 * spinner with no indication of how long to wait. showToast() with a "wait"
 * variant surfaces that up front instead of leaving people guessing.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    (message: string, options?: { variant?: ToastVariant; duration?: number }) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const variant = options?.variant ?? "info";
      const duration = options?.duration;
      setToasts((prev) => [...prev, { id, message, variant, duration }]);

      if (duration && duration > 0) {
        const timer = setTimeout(() => dismissToast(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismissToast]
  );

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      {/*
        Fixed top-centre, BELOW the app chrome.
        
        `top-4` put toasts over the header and the page title — both the mobile
        bar and the desktop header are h-14 (56px), so the offset clears them
        and the toast reads as part of the page rather than covering it.

        `pointer-events-none` on the container with it re-enabled on each toast:
        the container spans the full width, so without this its empty area
        swallowed clicks on whatever sat underneath — including the header.
      */}
      <div
        className="pointer-events-none fixed left-1/2 top-[4.5rem] z-[100] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const { icon: Icon, classes } = VARIANT_STYLES[t.variant];
          return (
            <div
              key={t.id}
              role="status"
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-[var(--radius-md)] border px-4 py-3 text-sm shadow-lg animate-in fade-in slide-in-from-top-2",
                classes
              )}
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="flex-1">{t.message}</p>
              <button
                onClick={() => dismissToast(t.id)}
                className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}
