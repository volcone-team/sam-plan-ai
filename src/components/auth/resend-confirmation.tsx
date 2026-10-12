'use client';

import { useEffect, useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { getAppUrl } from '@/lib/app-url';
import { interpretResendResult, type ResendOutcome } from '@/lib/auth/resend-result';

/**
 * Send a fresh signup confirmation email.
 *
 * Confirmation links expire, and until this existed an expired link was a dead
 * end: sign-in fails ("email not confirmed") and re-registering fails too,
 * because Supabase refuses a second signup for the same address.
 *
 * ONLY THE NEWEST LINK WORKS — but only when a new one is actually issued.
 * Verified against the live auth server (scripts/test-confirm-token-rotation.mjs):
 * issuing a new token rejects the old one. A resend inside Supabase's ~60s
 * cooldown, however, is REFUSED with a 429 and issues nothing, so the old link
 * stays valid. The first version of this component ignored that refusal and
 * announced "your earlier link has stopped working" either way, which was false
 * exactly when it mattered. The message now reflects what really happened.
 *
 * Nothing here leaks whether an address is registered. Supabase answers a
 * resend for an unknown or already-confirmed address the same way it answers a
 * successful one, so "sent" carries no information about the account.
 */
export function ResendConfirmation({
  email: knownEmail,
  /**
   * Where the link should land. Carried so a plan chosen before registering
   * survives a resend; without it the user would confirm and then be asked to
   * pick a plan a second time.
   */
  destination = '/onboarding/welcome',
  initialCooldownSeconds = 0,
  className,
}: {
  /**
   * Start already counting down. The signup screen has JUST sent an email, so
   * a resend there would be refused for the next minute anyway — offering the
   * button immediately invites exactly the refusal that confused testing.
   */
  initialCooldownSeconds?: number;
  /**
   * Omit to ask for the address — needed on the expired-link screen, where a
   * dead token identifies nobody.
   */
  email?: string;
  destination?: string;
  className?: string;
}) {
  const [typedEmail, setTypedEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<ResendOutcome | null>(null);
  const [cooldown, setCooldown] = useState(initialCooldownSeconds);

  const asksForEmail = knownEmail === undefined;
  const email = asksForEmail ? typedEmail.trim() : knownEmail;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = async () => {
    if (sending || cooldown > 0 || !email) return;

    setSending(true);
    let result: ResendOutcome;
    try {
      const { error } = await createClient().auth.resend({
        type: 'signup',
        email,
        options: {
          emailRedirectTo:
            `${getAppUrl()}/auth/confirmed?next=${encodeURIComponent(destination)}`,
        },
      });
      result = interpretResendResult(error);
    } catch {
      result = { kind: 'failed' };
    }

    setOutcome(result);
    // The countdown follows the SERVER's answer, not a guess, so the button
    // re-enables exactly when a new request can succeed.
    if (result.kind === 'sent') setCooldown(result.cooldownSeconds);
    if (result.kind === 'throttled') setCooldown(result.retryAfterSeconds);
    setSending(false);
  };

  return (
    <div className={className}>
      {asksForEmail && (
        <div className="mb-3 w-full space-y-1.5 text-left">
          <label htmlFor="resendEmail" className="text-sm font-medium">
            Your email address
          </label>
          <input
            id="resendEmail"
            type="email"
            value={typedEmail}
            onChange={(e) => setTypedEmail(e.target.value)}
            placeholder="sarah@company.com"
            className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
      )}

      <button
        type="button"
        onClick={resend}
        disabled={sending || cooldown > 0 || !email}
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-[hsl(var(--foreground-muted))] disabled:no-underline"
      >
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending...
          </>
        ) : cooldown > 0 ? (
          `Resend available in ${cooldown}s`
        ) : (
          <>
            <Mail className="h-4 w-4" />
            {outcome ? 'Send another link' : 'Resend confirmation link'}
          </>
        )}
      </button>

      {outcome && <OutcomeMessage outcome={outcome} />}
    </div>
  );
}

function OutcomeMessage({ outcome }: { outcome: ResendOutcome }) {
  const text = (() => {
    switch (outcome.kind) {
      case 'sent':
        return (
          'A new confirmation link is on its way. Use the newest email — any ' +
          'earlier link has now stopped working. It can take a minute or two to ' +
          'arrive, so check spam too.'
        );
      case 'throttled':
        /*
         * The case the old copy got wrong. Nothing was issued, so the link
         * already in their inbox is STILL the valid one — telling them it had
         * stopped working sent them hunting for an email that never came.
         */
        return (
          'A link was sent very recently, so a new one was not sent yet. The ' +
          'link already in your inbox still works — use that, or try again ' +
          'once the timer runs out.'
        );
      case 'limit_reached':
        return (
          'Too many emails have been sent to this address. Please wait a while ' +
          'before trying again. The most recent link you received still works.'
        );
      case 'failed':
        return (
          'We could not send a new link just now. Please try again, or email ' +
          'support@samplan.ai if it keeps happening.'
        );
    }
  })();

  return (
    <p
      role="status"
      className={
        outcome.kind === 'failed'
          ? 'mt-2 text-xs text-[hsl(var(--destructive))]'
          : 'mt-2 text-xs text-[hsl(var(--foreground-muted))]'
      }
    >
      {text}
    </p>
  );
}
