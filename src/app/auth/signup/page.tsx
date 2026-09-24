'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand-logo';
import { getAppUrl } from '@/lib/app-url';

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    companyName: '',
    email: '',
    password: '',
    confirmPassword: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Validate passwords match
      if (formData.password !== formData.confirmPassword) {
        setError('Passwords do not match.');
        return;
      }

      const supabase = createClient();

      // Where the user should land once their account is usable.
      //
      // - Arrived via the questionnaire (has a "next" param, e.g. from the
      //   generating screen) -> resume exactly where they left off.
      // - Has an in-progress questionnaire draft but no explicit "next" ->
      //   resume generating it.
      // - Signed up directly (no questionnaire involved) -> the new welcome
      //   screen, which offers the questionnaire options or a skip to the
      //   dashboard. The questionnaire is never forced.
      const requestedNext = new URLSearchParams(window.location.search).get('next');
      const hasDraft = !!localStorage.getItem('sam-plan-data');
      const destination =
        requestedNext || (hasDraft ? '/onboarding/generating' : '/onboarding/welcome');

      // 1. Sign up with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: `${getAppUrl()}/auth/callback?next=${encodeURIComponent(destination)}`,
          data: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            company_name: formData.companyName,
          },
        },
      });

      if (authError) {
        setError(authError.message);
        return;
      }

      // Supabase does not return an error for an email that is already
      // registered and confirmed - it returns a decoy user object instead,
      // to prevent attackers from using signup to enumerate real emails.
      // The tell is an empty identities array. Without this check the UI
      // showed "Check your email" for a signup that never happened and never
      // sent anything.
      const isExistingAccount =
        !!authData.user && (authData.user.identities?.length ?? 0) === 0;

      if (isExistingAccount) {
        setError('An account with this email already exists. Please sign in instead.');
        return;
      }

      if (authData.user) {
        // Company + profile are created automatically by database trigger (handle_new_user)
        // If email confirmation is enabled, show success message
        if (!authData.session) {
          setSuccess(true);
        } else {
          // Resume an in-progress questionnaire if there is one, otherwise
          // start onboarding. Sending everyone to /onboarding unconditionally
          // is what created the signup -> onboarding -> login loop.
          router.push(destination);
        }
      }
    } catch {
      setError('Something went wrong. Please try again.');
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
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              We sent a confirmation link to <strong>{formData.email}</strong>.
              Click the link to activate your account.
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
            <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              Start building your revenue plan in minutes
            </p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
            {error}
            {error.includes('already exists') && (
              <>
                {' '}
                <Link href="/auth/login" className="font-medium underline">
                  Sign in
                </Link>
              </>
            )}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label htmlFor="firstName" className="text-sm font-medium">
                First name
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                required
                value={formData.firstName}
                onChange={handleChange}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                placeholder="Sarah"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="lastName" className="text-sm font-medium">
                Last name
              </label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                required
                value={formData.lastName}
                onChange={handleChange}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                placeholder="Mitchell"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="companyName" className="text-sm font-medium">
              Company name
            </label>
            <input
              id="companyName"
              name="companyName"
              type="text"
              required
              value={formData.companyName}
              onChange={handleChange}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              placeholder="Acme Inc."
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              value={formData.email}
              onChange={handleChange}
              className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
              placeholder="sarah@company.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={formData.password}
                onChange={handleChange}
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
            <div className="relative">
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                value={formData.confirmPassword}
                onChange={handleChange}
                className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 pr-10 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                placeholder="Re-enter password"
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating account...
              </>
            ) : (
              'Create Account'
            )}
          </Button>
        </form>

        {/* Login link */}
        <p className="text-center text-sm text-[hsl(var(--foreground-muted))]">
          Already have an account?{' '}
          <Link href="/auth/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
