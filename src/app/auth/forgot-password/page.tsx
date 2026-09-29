'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand-logo';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      /**
       * Server route rather than supabase.auth.resetPasswordForEmail(): the
       * email now goes out over the Mailgun HTTP API instead of Supabase's
       * dashboard SMTP. Supabase still mints the recovery token, so
       * /auth/reset-password verifies it unchanged.
       *
       * The route always answers 200 so it cannot be used to discover which
       * addresses have accounts — which also means the success screen below is
       * shown even for an unknown address. That is intentional, and the reason
       * no error is surfaced for a "missing" account.
       */
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        setError('Something went wrong. Please try again.');
        return;
      }

      setSuccess(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <BrandLogo width={140} height={47} />
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
            {/*
              Deliberately hedged ("if an account exists"): the endpoint does not
              disclose whether the address is registered, so promising an email
              outright would be a claim we cannot make — and would leak the
              answer the moment it failed to arrive.
            */}
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              If an account exists for <strong>{email}</strong>, a password reset
              link is on its way. Click the link in the email to set a new password.
            </p>
          </div>
          <Link href="/auth/login">
            <Button variant="outline" className="w-full mt-4">
              Back to Login
            </Button>
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
            <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              Enter your email and we&apos;ll send you a reset link
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
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              placeholder="sarah@company.com"
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              'Send Reset Link'
            )}
          </Button>
        </form>

        {/* Back to login */}
        <Link
          href="/auth/login"
          className="flex items-center justify-center gap-2 text-sm text-[hsl(var(--foreground-muted))] hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Login
        </Link>
      </div>
    </div>
  );
}
