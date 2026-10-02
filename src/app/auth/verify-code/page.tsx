'use client';

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, MailCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { revokeDeviceTrust } from '@/lib/sign-out';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand-logo';

const CODE_LENGTH = 8;
const RESEND_COOLDOWN_SECONDS = 45;

/**
 * Result of asking the backend for a fresh code. Kept as a discriminated union
 * (and outside the component) so both the auto-send on mount and the manual
 * "Resend code" button share one interpretation of the API contract without
 * dragging component state into a dependency array.
 */
type SendResult =
  | { kind: 'sent' }
  | { kind: 'cooldown'; retryAfter: number }
  | { kind: 'not_required'; message: string }
  | { kind: 'unauthorized' }
  | { kind: 'error'; message: string };

async function requestCode(): Promise<SendResult> {
  try {
    const res = await fetch('/api/auth/2fa/send', {
      method: 'POST',
      credentials: 'same-origin',
    });

    let body: { error?: string; message?: string; retryAfter?: number } = {};
    try {
      body = await res.json();
    } catch {
      body = {};
    }

    if (res.ok) return { kind: 'sent' };

    if (res.status === 401) return { kind: 'unauthorized' };

    if (res.status === 429 && body.error === 'cooldown') {
      const retryAfter =
        typeof body.retryAfter === 'number' && body.retryAfter > 0
          ? Math.ceil(body.retryAfter)
          : RESEND_COOLDOWN_SECONDS;
      return { kind: 'cooldown', retryAfter };
    }

    // Per-user send limit (distinct from the short per-browser cooldown): too
    // many codes requested in the last few minutes. Not retryable on a timer,
    // so surface it as an error rather than starting a countdown.
    if (res.status === 429 && body.error === 'too_many_requests') {
      return {
        kind: 'error',
        message:
          body.message ??
          'Too many codes requested. Please wait a few minutes and try again.',
      };
    }

    // Two-factor now applies to every authenticated user, so the backend no
    // longer returns this. Kept as a harmless fallback in case an older
    // deployment answers mid-rollout.
    if (res.status === 400 && body.error === 'not_required') {
      return {
        kind: 'not_required',
        message:
          body.message ??
          'This device does not need verification right now.',
      };
    }

    if (body.error === 'email_failed') {
      return {
        kind: 'error',
        message:
          body.message ?? 'We could not send the verification code. Please try again.',
      };
    }

    if (body.error === 'code_generation_failed') {
      return {
        kind: 'error',
        message: 'We could not generate a verification code. Please try again.',
      };
    }

    return {
      kind: 'error',
      message: body.message ?? body.error ?? 'Something went wrong. Please try again.',
    };
  } catch {
    return {
      kind: 'error',
      message: 'Could not reach the server. Check your connection and try again.',
    };
  }
}

const DEFAULT_NEXT = '/year-at-a-glance';

/**
 * Constrain `?next=` to a path inside this app.
 *
 * The value reaches a real navigation on success, and anyone can craft the URL
 * that lands a user here — middleware is not the only way in. Without this, a
 * `javascript:` URL would execute in the page's context, and `//evil.com` (or
 * any absolute URL) would be an open redirect off the back of a legitimate
 * login. Only a single leading slash followed by a normal path is accepted;
 * everything else falls back to the app home.
 */
function safeNextPath(raw: string | null): string {
  if (!raw) return DEFAULT_NEXT;
  // Must start with exactly one '/' — rejects '//host' and 'scheme:' URLs.
  if (!raw.startsWith('/') || raw.startsWith('//')) return DEFAULT_NEXT;
  // Reject control characters, which can be used to smuggle a scheme past checks.
  if (/[\u0000-\u001F\u007F]/.test(raw)) return DEFAULT_NEXT;
  return raw;
}

function VerifyCodeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Middleware always supplies an explicit ?next=, so the fallback only covers
  // someone landing here directly. Most accounts are customers, so send them to
  // the app home rather than the admin panel.
  const nextPath = safeNextPath(searchParams.get('next'));

  const [code, setCode] = useState('');
  const [initialSending, setInitialSending] = useState(true);
  const [resending, setResending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [notRequired, setNotRequired] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // Strict mode mounts effects twice in development; this guard keeps the
  // auto-send to exactly one request per page load.
  const autoSentRef = useRef(false);

  const applySendResult = useCallback(
    (result: SendResult, { isResend }: { isResend: boolean }) => {
      switch (result.kind) {
        case 'sent':
          setError(null);
          setCooldown(RESEND_COOLDOWN_SECONDS);
          if (isResend) setNotice('A new code is on the way.');
          break;
        // A recent code is already in their inbox — not an error, just wait.
        case 'cooldown':
          setError(null);
          setCooldown(result.retryAfter);
          if (isResend) setNotice('A code was already sent recently. Check your inbox.');
          break;
        case 'not_required':
          setError(null);
          setNotice(null);
          setNotRequired(result.message);
          break;
        case 'unauthorized':
          router.push('/auth/login');
          break;
        case 'error':
          setNotice(null);
          setError(result.message);
          break;
      }
    },
    [router]
  );

  // Auto-send a code as soon as the user lands here.
  //
  // Deliberately no `mounted` cleanup guard. There used to be one, and combined
  // with `autoSentRef` it left the spinner running forever in development:
  // Strict Mode mounts effects twice, so the first mount fired the request and
  // then unmounted (flipping its guard to false), while the second mount saw
  // `autoSentRef` already set and returned early. When the in-flight request
  // resolved, the stale guard made it bail out before `setInitialSending(false)`
  // — so nothing ever cleared the flag and "Sending a code to your email…"
  // stayed on screen (which also kept Resend disabled) even though the email had
  // been sent and the code worked.
  //
  // `autoSentRef` alone is enough to keep this to one request per page load. A
  // state update after unmount is a harmless no-op in React 18+, which is what
  // the removed guard was originally defending against.
  useEffect(() => {
    if (autoSentRef.current) return;
    autoSentRef.current = true;

    const sendInitialCode = async () => {
      try {
        applySendResult(await requestCode(), { isResend: false });
      } finally {
        // In `finally` so the spinner clears even on an unexpected throw.
        // `requestCode` is written to return an error result rather than throw,
        // but a stuck spinner also disables Resend, which leaves the user with
        // no way forward — too costly to depend on that guarantee.
        setInitialSending(false);
      }
    };

    sendInitialCode();
  }, [applySendResult]);

  // Resend countdown.
  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setInterval(() => {
      setCooldown((seconds) => (seconds <= 1 ? 0 : seconds - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldown]);

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;

    setResending(true);
    setNotice(null);
    setError(null);

    const result = await requestCode();
    applySendResult(result, { isResend: true });
    setResending(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length !== CODE_LENGTH || submitting) return;

    setError(null);
    setNotice(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      let body: { error?: string; message?: string } = {};
      try {
        body = await res.json();
      } catch {
        body = {};
      }

      if (res.ok) {
        /**
         * Full document navigation, NOT router.push().
         *
         * Verification just set the `sam_2fa` cookie, and middleware has to see
         * it to stop redirecting. A client-side push could not do that
         * reliably for two reasons:
         *
         *  1. `nextPath` is already in the client router cache — as the
         *     REDIRECT middleware issued when this device was still untrusted.
         *     Pushing replayed that cached redirect and bounced straight back
         *     here, so the click appeared to do nothing.
         *  2. The old code called router.refresh() immediately after push,
         *     which fires against the current route and disrupts the
         *     navigation that was still in flight.
         *
         * `location.replace` discards the client cache entirely and re-requests
         * the page with the new cookie attached, so middleware re-evaluates and
         * serves it. `replace` rather than `assign` keeps the challenge page out
         * of history — Back should not return to a code that is now consumed.
         *
         * No setSubmitting(false): the document is being torn down, and leaving
         * the button disabled prevents a second submit racing the navigation
         * (the code is single-use, so a retry would fail as already consumed).
         */
        window.location.replace(nextPath);
        return;
      }

      if (res.status === 401) {
        router.push('/auth/login');
        return;
      }

      if (body.error === 'invalid_code_format') {
        setError('Enter the 8-digit code from your email.');
      } else if (body.error === 'too_many_attempts') {
        // The code is burnt — a fresh one is the only way forward, so clear the
        // input and let them resend immediately rather than retry a dead code.
        setCode('');
        setCooldown(0);
        setError(
          body.message ?? 'Too many incorrect attempts. Request a new code.'
        );
      } else {
        setError(
          body.message ?? body.error ?? 'Something went wrong. Please try again.'
        );
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    // Clear device trust too. Reaching this page means trust was absent or
    // invalid, but a stale `sam_2fa` may still be sitting in the browser and
    // it is httpOnly, so only the server can remove it.
    await revokeDeviceTrust();
    try {
      // 'local': abandoning the challenge on this device must not revoke the
      // account's sessions on others. auth-js defaults to 'global'.
      await createClient().auth.signOut({ scope: 'local' });
    } catch {
      // Sign-out is an escape hatch — leave for the login page regardless.
    }
    router.push('/auth/login');
  };

  // Fallback path: the backend reported no verification needed. Unreachable in
  // normal operation now that two-factor covers all users.
  if (notRequired) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <BrandLogo width={140} height={47} />
          <div className="space-y-3">
            <h1 className="text-2xl font-bold tracking-tight">You&apos;re all set</h1>
            <p className="text-sm text-[hsl(var(--foreground-muted))]">{notRequired}</p>
          </div>
          <Link href="/year-at-a-glance" className="block">
            <Button className="w-full">Continue to SAM</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <BrandLogo width={140} height={47} />
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              We sent an 8-digit verification code to your email. Enter it below to
              confirm this device.
            </p>
          </div>
        </div>

        {/* Initial send progress */}
        {initialSending && (
          <p
            className="flex items-center justify-center gap-2 text-sm text-[hsl(var(--foreground-muted))]"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending a code to your email…
          </p>
        )}

        {/* Error */}
        <div role="alert" aria-live="assertive">
          {error && (
            <div className="rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
              {error}
            </div>
          )}
        </div>

        {/* Confirmation */}
        {notice && (
          <p
            className="flex items-center justify-center gap-2 text-sm text-[hsl(var(--foreground-muted))]"
            aria-live="polite"
          >
            <MailCheck className="h-4 w-4" />
            {notice}
          </p>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="code" className="text-sm font-medium">
              Verification code
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              autoFocus
              required
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
              }
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm tracking-[0.3em] outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              placeholder="12345678"
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={submitting || code.length !== CODE_LENGTH}
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Verifying...
              </>
            ) : (
              'Verify'
            )}
          </Button>
        </form>

        {/* Resend */}
        <div className="space-y-3 text-center">
          <button
            type="button"
            onClick={handleResend}
            disabled={resending || cooldown > 0 || initialSending}
            className="text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-[hsl(var(--foreground-muted))] disabled:no-underline"
          >
            {resending ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending...
              </span>
            ) : cooldown > 0 ? (
              `Resend code in ${cooldown}s`
            ) : (
              'Resend code'
            )}
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            className="block w-full text-center text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VerifyCodePage() {
  return (
    <Suspense fallback={null}>
      <VerifyCodeForm />
    </Suspense>
  );
}
