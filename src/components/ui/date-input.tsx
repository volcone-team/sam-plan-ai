'use client';

import * as React from "react";
import { cn } from "@/lib/utils";

export interface DateInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type"
  > {
  /** ISO date, `YYYY-MM-DD`, exactly as stored and sent to the API. */
  value: string;
  /** Receives `YYYY-MM-DD`, or '' when cleared. */
  onValueChange: (value: string) => void;
  error?: boolean;
}

/**
 * Date field that always reads MM/DD/YYYY, whatever the viewer's OS locale is.
 *
 * WHY NOT `<input type="date">`: a native date input renders in the BROWSER's
 * locale, which the page cannot override — `lang="en"` on <html> does not change
 * it. On a machine configured for en-GB (or most of the world) the placeholder
 * reads `dd-mm-yyyy` and the picker shows day-first, while every date the app
 * PRINTS is MM/DD/YYYY via lib/format-date. Same screen, two conventions, and on
 * an ambiguous date like 03/04 no way to tell which was meant.
 *
 * So the visible field is a text input we format ourselves, with a native date
 * picker kept alongside it for calendar selection. The value crossing the
 * boundary stays ISO `YYYY-MM-DD` in both directions, so callers and stored data
 * are untouched.
 *
 * Typing is accepted loosely (slashes optional, auto-inserted) because a strict
 * field that rejects keystrokes is worse than one that tidies up after you.
 */

/** ISO `YYYY-MM-DD` to display `MM/DD/YYYY`. */
export function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "";
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/**
 * Display `MM/DD/YYYY` to ISO `YYYY-MM-DD`, or '' when not yet a real date.
 *
 * Validates the calendar day rather than just the shape: 02/31/2026 matches the
 * pattern but is not a date, and silently storing it would produce an invalid
 * value the server has to reject later.
 */
export function displayToIso(display: string): string {
  const digits = (display ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return "";

  const month = Number(digits.slice(0, 2));
  const day = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));

  if (month < 1 || month > 12) return "";
  if (day < 1 || day > 31) return "";
  if (year < 1000) return "";

  // Round-trip through Date to reject impossible days (Feb 31, Apr 31).
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return "";
  }

  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

/** Insert slashes as the user types: "1015" -> "10/15". */
export function formatDateTyping(input: string): string {
  const digits = (input ?? "").replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  ({ className, value, onValueChange, error, placeholder, ...props }, ref) => {
    // Local display text so a partially-typed date survives ("10/1" on its way
    // to "10/15/2026"); deriving it from `value` would erase anything that is
    // not yet a complete date.
    const [display, setDisplay] = React.useState(() => isoToDisplay(value));
    const pickerRef = React.useRef<HTMLInputElement | null>(null);

    // Re-sync when the value changes from OUTSIDE (form reset, loaded record).
    // Guarded so ordinary typing is never overwritten.
    React.useEffect(() => {
      if (displayToIso(display) !== (value ?? "")) {
        setDisplay(isoToDisplay(value));
      }
      // `display` deliberately omitted — including it fights the user's input.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const next = formatDateTyping(e.target.value);
      setDisplay(next);

      const iso = displayToIso(next);
      // Emit '' while incomplete so a half-typed date is never treated as set.
      onValueChange(iso);
    };

    // Tidy on blur: an incomplete entry clears rather than lingering as text
    // that looks accepted but was never stored.
    const handleBlur = () => {
      const iso = displayToIso(display);
      setDisplay(iso ? isoToDisplay(iso) : "");
    };

    return (
      <div className="relative">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          // Explicit, so the expected order is visible before typing starts.
          placeholder={placeholder ?? "mm/dd/yyyy"}
          className={cn(
            "w-full rounded-[var(--radius-md)] border bg-background px-3 py-2 pr-10 text-sm",
            "placeholder:text-[hsl(var(--foreground-muted))]",
            "outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error ? "border-[hsl(var(--invalid-border))]" : "border-border",
            className
          )}
          value={display}
          onChange={handleTextChange}
          onBlur={handleBlur}
          ref={ref}
          {...props}
        />

        {/*
          Hidden native input, opened by the calendar button. Keeps calendar
          selection available without letting the browser's locale decide how
          the date READS. aria-hidden + tabIndex -1: the text field above is the
          accessible control, so this must not be a second tab stop.
        */}
        <input
          ref={pickerRef}
          type="date"
          aria-hidden="true"
          tabIndex={-1}
          value={value ?? ""}
          onChange={(e) => {
            onValueChange(e.target.value);
            setDisplay(isoToDisplay(e.target.value));
          }}
          className="pointer-events-none absolute right-0 top-0 h-full w-0 opacity-0"
        />
        <button
          type="button"
          onClick={() => {
            const el = pickerRef.current;
            if (!el) return;
            // showPicker is not in every browser; focus+click is the fallback.
            if (typeof el.showPicker === "function") {
              try { el.showPicker(); return; } catch { /* fall through */ }
            }
            el.focus();
            el.click();
          }}
          aria-label="Open calendar"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))] hover:text-foreground"
        >
          {/* Inline so this component needs no icon dependency. */}
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </button>
      </div>
    );
  }
);
DateInput.displayName = "DateInput";

export { DateInput };
