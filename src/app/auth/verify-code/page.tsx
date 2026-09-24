'use client';

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, MailCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
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

    if (res.status === 400 && body.error === 'not_required') {
      return {
        kind: 'not_required',
        message:
          body.message ??
          'Two-factor verification is not required for this account.',
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

function VerifyCodeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = searchParams.get('next') || '/admin';

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

  // Auto-send a code as soon as the admin lands here.
  useEffect(() => {
    if (autoSentRef.current) return;
    autoSentRef.current = true;

    let mounted = true;

    const sendInitialCode = async () => {
      const result = await requestCode();
      if (!mounted) return;
      applySendResult(result, { isResend: false });
      setInitialSending(false);
    };

    sendInitialCode();

    return () => {
      mounted = false;
    };
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
        router.push(nextPath);
        router.refresh();
        return;
      }

      if (res.status === 401) {
        router.push('/auth/login');
        return;
      }

      if (body.error === 'invalid_code_format') {
        setError('Enter the 8-digit code from your email.');
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
    try {
      await createClient().auth.signOut();
    } catch {
      // Sign-out is an escape hatch — leave for the login page regardless.
    }
    router.push('/auth/login');
  };

  // This account does not need two-factor verification at all.
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
