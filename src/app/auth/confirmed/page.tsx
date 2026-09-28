'use client';

import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand-logo';

/**
 * /auth/confirmed — where signup confirmation emails land.
 *
 * This page exists because the confirmation link Supabase sends can arrive as
 * an IMPLICIT-FLOW HASH FRAGMENT:
 *
 *   /auth/confirmed?next=%2Fonboarding%2Fwelcome#access_token=...&type=signup
 *
 * Hash fragments are never transmitted to the server. The previous landing
 * spot, `/auth/callback`, is a server route handler, so it saw no `?code=`,
 * `exchangeCodeForSession` never ran, and every confirmation ended on
 * `/auth/login?error=auth_callback_failed` with no cookies set. No server route
 * can fix that — the tokens are only readable in the browser. Hence a CLIENT
 * page: it reads the fragment, establishes the session, and only then hands
 * off to the server with real cookies.
 */
function ConfirmedContent() {
  const searchParams = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let mounted = true;

    const confirm = async () => {
      const supabase = createClient();

      const url = new URL(window.location.href);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));

      // Session establishment, same branch order as /auth/set-password — the
      // link shape varies by Supabase project settings and email template, so
      // all four are handled rather than betting on one.

      // 1. Explicit error in query or hash → link is invalid/expired.
      if (url.searchParams.get('error') || hash.get('error')) {
        if (!mounted) return;
        setFailed(true);
        return;
      }

      const tokenHash = url.searchParams.get('token_hash');
      const otpType = url.searchParams.get('type');
      if (tokenHash && otpType) {
        // 2. PREFERRED: token_hash + type. verifyOtp establishes the session
        //    server-verified, with no reliance on the hash fragment.
        await supabase.auth.verifyOtp({
          type: otpType as 'signup' | 'email' | 'invite' | 'recovery',
          token_hash: tokenHash,
        });
      } else if (url.searchParams.get('code')) {
        // 3. PKCE flow: exchange ?code=<uuid> for a session.
        await supabase.auth.exchangeCodeForSession(window.location.href);
      } else if (hash.get('access_token')) {
        // 4. Implicit flow: tokens in the URL hash. The browser client may have
        //    already adopted them; otherwise set the session explicitly.
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session) {
          await supabase.auth.setSession({
            access_token: hash.get('access_token')!,
            refresh_token: hash.get('refresh_token') ?? '',
          });
        }
      }

      // Final authority: whatever we attempted, ask for the actual user.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) return;

      if (!user) {
        setFailed(true);
        return;
      }

      // Clicking a link in their own inbox already proved control of the email
      // address, so trade it for two-factor device trust. Without this a
      // brand-new user is blocked by `two_factor_required` the moment
      // onboarding calls /api/generate-plan. Best effort only: if it fails the
      // user is merely asked for an emailed code, which is annoying, not broken.
      try {
        await fetch('/api/auth/2fa/grant', {
          method: 'POST',
          credentials: 'same-origin',
        });
      } catch {
        // Ignore — proceed to the destination either way.
      }

      // Strip the tokens/code from the URL so a refresh cannot replay a
      // now-consumed link.
      window.history.replaceState({}, '', '/auth/confirmed');

      // Full page load, not router.push: guarantees the server (and middleware)
      // sees the session cookies and the fresh `sam_2fa` cookie on the very
      // next request.
      const next = searchParams.get('next') || '/onboarding/welcome';
      window.location.assign(next);
    };

    confirm();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <BrandLogo width={140} height={47} />
          <div className="space-y-3">
            <h1 className="text-2xl font-bold tracking-tight">
              Confirmation link expired
            </h1>
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              This link is invalid, has expired, or was already used. Try signing
              in — if your account was already confirmed, you are good to go.
            </p>
          </div>
          <div className="space-y-3">
            <Link href="/auth/login" className="block">
              <Button className="w-full">Go to sign in</Button>
            </Link>
            <Link
              href="/auth/signup"
              className="block text-center text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors"
            >
              Create a new account
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <BrandLogo width={140} height={47} />
        <p
          className="flex items-center justify-center gap-2 text-sm text-[hsl(var(--foreground-muted))]"
          aria-live="polite"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Confirming your account…
        </p>
      </div>
    </div>
  );
}

export default function ConfirmedPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmedContent />
    </Suspense>
  );
}
