"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { usePermission } from "@/hooks/use-permission";

/**
 * Confirm removing an entire plan year.
 *
 * The counts are FETCHED rather than passed in, so the dialog names what will
 * actually go: "this cannot be undone" without saying what "this" is is not
 * informed consent. Logged results get their own warning line, because those
 * are recorded revenue rather than plan scaffolding that can be regenerated.
 *
 * Typing the year to confirm is deliberate friction. This deletes a year's
 * initiatives, tasks and actuals in one click, and the years sit next to each
 * other in a dropdown — a misclick on the wrong year should not be one button
 * press away from destroying it.
 */

interface DeleteYearModalProps {
  open: boolean;
  year: number;
  onClose: () => void;
  /** Called after a successful delete, so the caller can refresh and switch year. */
  onDeleted: (result: { year: number; reappears: boolean }) => void;
}

interface YearSummary {
  exists: boolean;
  initiativeCount: number;
  initiativeNames: string[];
  taskCount: number;
  resultCount: number;
  expenseCount: number;
  reappears: boolean;
}

export function DeleteYearModal({ open, year, onClose, onDeleted }: DeleteYearModalProps) {
  const canEditPlan = usePermission("plan.regenerate");

  const [summary, setSummary] = useState<YearSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on each open so a previous attempt's typed confirmation or error
  // cannot carry over to a different year.
  useEffect(() => {
    if (!open) return;
    setSummary(null);
    setLoading(true);
    setConfirmText("");
    setError(null);

    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/plan/year?year=${year}`, { cache: "no-store" });
        const body = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          throw new Error(body.error || `Could not read ${year} (${response.status}).`);
        }
        setSummary(body as YearSummary);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, year]);

  // Escape closes, unless a delete is in flight — interrupting that would
  // leave the user unsure whether it happened.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !deleting) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, deleting, onClose]);

  if (!open) return null;

  const confirmed = confirmText.trim() === String(year);

  const handleDelete = async () => {
    if (!confirmed || deleting) return;

    setDeleting(true);
    setError(null);

    try {
      const response = await fetch(`/api/plan/year?year=${year}`, { method: "DELETE" });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error || `Could not delete ${year} (${response.status}).`);
      }

      onDeleted({ year, reappears: Boolean(body.reappears) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDeleting(false);
    }
  };

  /** Read-only roles get an explanation rather than a destructive control. */
  if (!canEditPlan) {
    return (
      <Shell onClose={onClose} title="Deleting a plan year isn't available">
        <p className="mt-3 text-sm text-[hsl(var(--foreground-muted))]">
          Your role has read-only access to the plan. Ask an owner or operator to
          delete {year}.
        </p>
        <div className="mt-5 flex justify-end">
          <SecondaryButton onClick={onClose}>Close</SecondaryButton>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={deleting ? undefined : onClose} title={`Delete the ${year} plan?`}>
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[hsl(var(--foreground-muted))]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking what&apos;s in {year}…
        </div>
      ) : !summary?.exists ? (
        <>
          <p className="mt-3 text-sm text-[hsl(var(--foreground-muted))]">
            There is nothing stored for {year}, so there is nothing to delete.
          </p>
          <div className="mt-5 flex justify-end">
            <SecondaryButton onClick={onClose}>Close</SecondaryButton>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm text-[hsl(var(--foreground-muted))]">
            This removes the {year} plan and everything scheduled in it.
          </p>

          <ul className="mt-4 space-y-1.5 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] p-3 text-sm">
            <Count n={summary.initiativeCount} one="initiative" many="initiatives" />
            <Count n={summary.taskCount} one="task" many="tasks" />
            <Count n={summary.expenseCount} one="logged expense" many="logged expenses" />
            <Count
              n={summary.resultCount}
              one="recorded result"
              many="recorded results"
              emphasise
            />
          </ul>

          {summary.initiativeNames.length > 0 && (
            <p className="mt-3 text-xs text-[hsl(var(--foreground-muted))]">
              Including {summary.initiativeNames.join(", ")}
              {summary.initiativeCount > summary.initiativeNames.length &&
                ` and ${summary.initiativeCount - summary.initiativeNames.length} more`}
              .
            </p>
          )}

          {/*
            Recorded results are actual revenue the user entered by hand. Every
            other row here can be regenerated; these cannot.
          */}
          {summary.resultCount > 0 && (
            <p className="mt-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.4)] bg-[hsl(var(--destructive)_/_0.08)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {year} has {summary.resultCount} recorded{" "}
                {summary.resultCount === 1 ? "result" : "results"} — real revenue
                you entered. Deleting the year removes{" "}
                {summary.resultCount === 1 ? "it" : "them"} too.
              </span>
            </p>
          )}

          {/*
            Said BEFORE the delete, not after. `usePlanYears` always offers the
            current calendar year, so deleting it empties it rather than making
            it disappear — and a user who expected it gone would reasonably
            think the delete had failed.
          */}
          {summary.reappears && (
            <p className="mt-3 text-xs text-[hsl(var(--foreground-muted))]">
              {year} is the current year, so it will still appear in the plan
              year list — just empty.
            </p>
          )}

          <p className="mt-4 text-xs text-[hsl(var(--foreground-muted))]">
            A backup is saved to Plan History first, so this can be restored.
          </p>

          <label className="mt-4 block text-sm font-medium">
            Type <span className="font-semibold">{year}</span> to confirm
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={deleting}
              inputMode="numeric"
              autoComplete="off"
              placeholder={String(year)}
              className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)_/_0.2)] disabled:opacity-50"
            />
          </label>

          {error && (
            <p role="alert" className="mt-3 text-sm text-[hsl(var(--destructive))]">
              {error}
            </p>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <SecondaryButton onClick={onClose} disabled={deleting}>
              Cancel
            </SecondaryButton>
            <button
              onClick={handleDelete}
              disabled={!confirmed || deleting}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--destructive))] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete {year}
            </button>
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({
  title,
  onClose,
  children,
}: {
  title: string;
  /** Omitted while deleting, which also hides the close control. */
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">{title}</h3>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-md p-1 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))]"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

function SecondaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** One line of the "what goes" list. Zero counts still show, so the list is a complete picture. */
function Count({
  n,
  one,
  many,
  emphasise,
}: {
  n: number;
  one: string;
  many: string;
  emphasise?: boolean;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-[hsl(var(--foreground-muted))]">
        {n === 1 ? one : many}
      </span>
      <span
        className={
          emphasise && n > 0
            ? "font-semibold tabular-nums text-[hsl(var(--destructive))]"
            : "font-medium tabular-nums"
        }
      >
        {n}
      </span>
    </li>
  );
}
