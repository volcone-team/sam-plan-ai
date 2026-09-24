'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';

interface DeleteAccountModalProps {
  open: boolean;
  onClose: () => void;
  userEmail: string | null;
  /** "account" = delete my account; "company" = delete company & all data */
  mode: 'account' | 'company';
  /** Called after a 200. Parent is responsible for sign-out + redirect. */
  onConfirmed: (deleted: 'account' | 'company') => void;
}

interface DeleteResponse {
  success?: boolean;
  deleted?: 'account' | 'company';
  error?: string;
  message?: string;
}

/**
 * Thin wrapper that mounts the dialog only while open. Keying the dialog on
 * `mode` guarantees a fresh mount (and therefore fresh form state) each time
 * the modal opens or switches modes, so the dialog never has to reset state
 * inside an effect or read a ref during render.
 */
export function DeleteAccountModal({
  open,
  onClose,
  userEmail,
  mode,
  onConfirmed,
}: DeleteAccountModalProps) {
  if (!open) return null;
  return (
    <DeleteAccountDialog
      key={mode}
      onClose={onClose}
      userEmail={userEmail}
      mode={mode}
      onConfirmed={onConfirmed}
    />
  );
}

type DeleteAccountDialogProps = Omit<DeleteAccountModalProps, 'open'>;

function DeleteAccountDialog({
  onClose,
  userEmail,
  mode,
  onConfirmed,
}: DeleteAccountDialogProps) {
  const [confirmText, setConfirmText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const titleId = 'delete-account-modal-title';
  const isCompany = mode === 'company';

  // The typed value must match the literal word DELETE or the user's own email.
  const trimmed = confirmText.trim();
  const matchesEmail = !!userEmail && trimmed.toLowerCase() === userEmail.trim().toLowerCase();
  const confirmValid = trimmed === 'DELETE' || matchesEmail;

  // Focus the input once the overlay is mounted (external DOM side effect).
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  // Escape closes (unless a request is in flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, onClose]);

  const handleConfirm = async () => {
    if (!confirmValid || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteCompany: isCompany, confirm: trimmed }),
        credentials: 'same-origin',
      });
      const data: DeleteResponse = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        onConfirmed(data.deleted ?? (isCompany ? 'company' : 'account'));
        return;
      }

      // Any non-200 keeps the modal open and surfaces the reason inline.
      // 409 last_owner returns a message explaining the owner must delete the
      // company or transfer ownership; 400/403/500 fall through to the same.
      setError(data.message || data.error || 'Something went wrong.');
      setPending(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setPending(false);
    }
  };

  const title = isCompany ? 'Delete company & all data?' : 'Delete your account?';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-xl"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className={`h-5 w-5 ${isCompany ? 'text-red-500' : 'text-amber-500'}`} />
            <h3 id={titleId} className="text-lg font-semibold">
              {title}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md p-1 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Danger callout: red for company-wide deletion, amber for self. */}
        {isCompany ? (
          <div className="mt-4 rounded-[var(--radius-md)] border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/20">
            <p className="text-sm font-medium text-red-900 dark:text-red-200">
              This permanently deletes the ENTIRE company and ALL of its data.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-red-800 dark:text-red-300">
              <li>• Every member&rsquo;s account is removed</li>
              <li>• All plans, initiatives, products, and results are erased</li>
              <li>• This affects everyone in the company, not just you</li>
              <li>• This cannot be undone</li>
            </ul>
          </div>
        ) : (
          <div className="mt-4 rounded-[var(--radius-md)] border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/20">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              This permanently deletes your account.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-amber-800 dark:text-amber-300">
              <li>• You will be signed out immediately</li>
              <li>• Your personal access is removed</li>
              <li>• This cannot be undone</li>
            </ul>
          </div>
        )}

        {/* Type-to-confirm */}
        <div className="mt-5 space-y-2">
          <label htmlFor="delete-confirm-input" className="text-sm font-medium">
            Confirm deletion
          </label>
          <input
            id="delete-confirm-input"
            ref={inputRef}
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && confirmValid && !pending) handleConfirm();
            }}
            disabled={pending}
            autoComplete="off"
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))] focus:ring-1 focus:ring-[hsl(var(--primary))] disabled:opacity-50"
            placeholder="DELETE"
          />
          <p className="text-xs text-[hsl(var(--foreground-muted))]">
            {isCompany
              ? 'This is irreversible and affects your whole team. Type DELETE or your email to confirm.'
              : 'Type DELETE or your email to confirm.'}
          </p>
        </div>

        {/* Inline error (e.g. last_owner message, forbidden, server error). */}
        {error && (
          <div
            role="alert"
            className="mt-4 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"
          >
            {error}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!confirmValid || pending}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {isCompany ? 'Delete Company' : 'Delete Account'}
          </button>
        </div>
      </div>
    </div>
  );
}
