'use client';

import { useState } from 'react';
import { Loader2, PlayCircle } from 'lucide-react';
import { explainPauseBlocker, type ResumeBlocker } from '@/lib/billing/pause';

/**
 * "Restart my plan" on the paused screen.
 *
 * A client island inside an otherwise server-rendered page, because that page
 * must stay a server component — it verifies the pause state server-side on
 * every request, which is what stops a stale tab showing "your plan is paused"
 * to someone whose access is fine.
 *
 * Only rendered for a pause the CUSTOMER applied. An admin suspension has no
 * button here at all, and the route refuses it too, so this is defence in
 * depth rather than the only guard.
 *
 * On success it does a full reload rather than a router push. Resuming changes
 * the answer the Edge middleware gives for every route, and that gate runs
 * before any client navigation — a soft push would be redirected straight back
 * here by middleware still working from the pre-resume session.
 */
export function ResumePlanButton({ resumesOnLabel }: { resumesOnLabel: string | null }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resume = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/resume', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || !body?.resumed) {
        setError(
          body?.error === 'cannot_resume' && body?.blocker
            ? explainPauseBlocker(body.blocker as ResumeBlocker)
            : body?.error === 'not_permitted'
              ? 'Only the account owner can restart billing.'
              : body?.error === 'stripe_failed'
                ? 'We could not restart billing with our payment provider. Please try again in a moment.'
                : 'Could not restart your plan. Please try again.'
        );
        return;
      }

      // Full reload: see the note above about the Edge gate.
      window.location.assign('/year-at-a-glance');
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-5">
      <button
        type="button"
        onClick={resume}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <PlayCircle className="h-4 w-4" aria-hidden="true" />
        )}
        Restart my plan now
      </button>

      <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))]">
        {resumesOnLabel
          ? `Billing and access restart immediately. Otherwise this happens on its own on ${resumesOnLabel}.`
          : 'Billing and access restart immediately.'}
      </p>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
        >
          {error}
        </div>
      )}
    </div>
  );
}
