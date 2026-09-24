'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand-logo';

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Session guard: an invited user reaching this page should already have a
  // session (established by /auth/callback exchanging the invite code). If they
  // land here without one, updateUser would fail — so check up front and show a
  // friendly recovery message instead of the form.
  const [checkingSession, setCheckingSession] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let mounted = true;

    const establishSession = async () => {
      const supabase = createClient();

      const url = new URL(window.location.href);
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));


      // 1. Explicit error in query or hash → link is invalid/expired.
      if (url.searchParams.get('error') || hash.get('error')) {
        if (!mounted) return;
        setHasSession(false);
        setCheckingSession(false);
        return;
      }

      // 2. PREFERRED: token_hash + type (the link we email). Deterministic —
      //    verifyOtp establishes the session server-verified, with no reliance
      //    on implicit-flow hash fragments that the PKCE browser client will
      //    refuse to adopt (and strip), which caused false "expired" screens.
      const tokenHash = url.searchParams.get('token_hash');
      const otpType = url.searchParams.get('type');
      if (tokenHash && otpType) {
        await supabase.auth.verifyOtp({
          type: otpType as 'recovery' | 'invite' | 'email',
          token_hash: tokenHash,
        });
      } else if (url.searchParams.get('code')) {
        // 3. PKCE flow: exchange ?code=<uuid> for a session.
        await supabase.auth.exchangeCodeForSession(window.location.href);
      } else if (hash.get('access_token')) {
        // 4. Legacy implicit flow: tokens in the URL hash. The browser client may
        //    already have adopted them; otherwise set the session explicitly.
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

      // 5. Final authority: whatever we attempted, ask for the actual user.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) return;

      // 6. Clean the URL once a session exists so a refresh does not re-run the
      // exchange against a now-consumed code (avoids "code already used").
      if (user) {
        window.history.replaceState({}, '', '/auth/set-password');
      }

      setHasSession(!!user);
      setCheckingSession(false);
    };

    establishSession();

    return () => {
      mounted = false;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();

      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(updateError.message);
        return;
      }

      setSuccess(true);

      // The session that authorized this page came from an invite/recovery
      // LINK, and its `amr` claim stays 'otp' forever — setting a password does
      // not upgrade it. Middleware therefore (correctly) confines it to this
      // flow, so we end it here and make the user sign in with the password
      // they just chose. A failing signOut must not strand them on this screen.
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore — the redirect below still gets them to a usable page.
      }

      // Send them to login after ~2s so the confirmation is readable.
      setTimeout(() => {
        router.push('/auth/login?passwordSet=1');
      }, 2000);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Loading state while we verify the invite session (prevents form flash)
  if (checkingSession) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <BrandLogo width={140} height={47} />
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--foreground-muted))] mx-auto" />
        </div>
      </div>
    );
  }

  // No session: the invite link is invalid or expired
  if (!hasSession) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <BrandLogo width={140} height={47} />
          <div className="space-y-3">
            <h1 className="text-2xl font-bold tracking-tight">Invite link expired</h1>
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              This link is invalid, already used, or has expired. Ask your team
              owner to resend the invite, or use Forgot Password.
            </p>
          </div>
          <div className="space-y-3">
            <Link href="/auth/forgot-password" className="block">
              <Button className="w-full">Forgot Password</Button>
            </Link>
            <Link
              href="/auth/login"
              className="block text-center text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors"
            >
              Back to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <BrandLogo width={140} height={47} />
          <div className="space-y-3">
            <CheckCircle2 className="h-12 w-12 text-[hsl(var(--success))] mx-auto" />
            <h1 className="text-2xl font-bold tracking-tight">Password set</h1>
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              Your password has been set. Please sign in with it to continue.
            </p>
          </div>
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
            <h1 className="text-2xl font-bold tracking-tight">Set your password</h1>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              Welcome! Choose a password to finish setting up your account.
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                placeholder="Min 8 characters"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[hsl(var(--foreground-muted))] hover:text-foreground"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="confirmPassword" className="text-sm font-medium">
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              placeholder="Re-enter password"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Setting password...
              </>
            ) : (
              'Set Password'
            )}
          </Button>
        </form>

        {/* Back to login */}
        <Link
          href="/auth/login"
          className="block text-center text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors"
        >
          Back to Login
        </Link>
      </div>
    </div>
  );
}
