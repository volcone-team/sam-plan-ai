'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand-logo';
import { getAppUrl } from '@/lib/app-url';
import { asPlanId, pathForStep } from '@/lib/billing/signup-flow';

/**
 * Does this signup need a plan chosen first?
 *
 * ASKED HERE, not at each link. There are six places that link to signup
 * (landing ×4, sample plan ×2, login, the demo banner, the confirmed page) and
 * the route is reachable directly, so gating it link-by-link guarantees the
 * next one added misses it — which is exactly what happened.
 *
 * Returns null while unknown so the form is not rendered before the answer
 * arrives; showing the form and then yanking it away is worse than a brief
 * spinner.
 */
function useRequiresPlanFirst(): boolean | null {
  const [requires, setRequires] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/billing/signup-flow', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { requiresPlanFirst?: boolean };
        if (!cancelled) setRequires(body.requiresPlanFirst === true);
      } catch {
        /*
         * Fails OPEN: on a read failure the form is shown. A plan can still be
         * bought afterwards via the entitlement gate, whereas blocking signup
         * on a settings lookup loses the customer outright.
         */
        if (!cancelled) setRequires(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return requires;
}

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
  /**
   * Marketing consent. Defaults to UNCHECKED — a pre-ticked box is not
   * consent, and the stored value has to reflect a deliberate action.
   */
  const [marketingConsent, setMarketingConsent] = useState(false);

  const requiresPlanFirst = useRequiresPlanFirst();

  /**
   * Send anyone who arrived without a plan to pick one first.
   *
   * Covers every entry point at once, including a direct visit to
   * /auth/signup. The plan already in the URL is honoured, so returning from
   * /get-started does not bounce back.
   */
  useEffect(() => {
    if (requiresPlanFirst !== true) return;

    const planInUrl = asPlanId(
      new URLSearchParams(window.location.search).get('plan')
    );
    if (planInUrl) return;

    router.replace('/get-started');
  }, [requiresPlanFirst, router]);
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
      /**
       * A plan chosen BEFORE registering (no-trial flow) rides through to the
       * confirmation link, so the user lands on checkout for the plan they
       * picked rather than being asked again.
       *
       * UNTRUSTED: it comes from a query string the user can edit. It only
       * selects which plan to OFFER at checkout — the server re-validates the
       * plan and Stripe decides what they actually get.
       */
      const selectedPlan = asPlanId(
        new URLSearchParams(window.location.search).get('plan')
      );

      // ONLY an explicit ?next= is honoured, for flows that genuinely need to
      // resume a specific page.
      //
      // We deliberately do NOT inspect localStorage to guess a destination.
      // That heuristic was wrong in three ways:
      //   1. A draft is not scoped to a user, so an abandoned one from a
      //      previous account in this browser hijacked a brand-new signup and
      //      generated their plan from someone else's answers.
      //   2. The decision was baked into the confirmation EMAIL LINK at signup
      //      time but acted on much later — possibly in a different browser,
      //      where the local state is completely different.
      //   3. It is unnecessary now: the intake saves its answers server-side
      //      against the account, so resuming is driven by `resume_screen`
      //      rather than by anything in this browser.
      // Everyone lands on the welcome screen, which starts the intake.
      const requestedNext = new URLSearchParams(window.location.search).get('next');
      /**
       * Where the confirmation link lands.
       *
       * With a plan carried through, go to checkout for it. Otherwise the
       * welcome hub, which decides for itself whether a trial is running.
       */
      const destination =
        requestedNext ||
        (selectedPlan ? pathForStep('checkout', selectedPlan) : '/onboarding/welcome');

      // 1. Sign up with Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          emailRedirectTo: `${getAppUrl()}/auth/confirmed?next=${encodeURIComponent(destination)}`,
          data: {
            first_name: formData.firstName,
            last_name: formData.lastName,
            company_name: formData.companyName,
            /**
             * Sent as a STRING because raw_user_meta_data is JSON read with
             * ->> in the trigger, which yields text. Always sent, so the
             * trigger can tell "declined" from "never asked" — the latter is
             * what an invited team member gets, and it must stay distinct.
             */
            marketing_consent: marketingConsent ? 'true' : 'false',
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

  /**
   * Hold the form until the plan-first rule is known, and while redirecting.
   *
   * Rendering the form first and then replacing the route lets someone start
   * typing into a page that is about to vanish — which is how the plan step
   * got skipped entirely in testing.
   */
  if (requiresPlanFirst === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  if (
    requiresPlanFirst &&
    typeof window !== 'undefined' &&
    !asPlanId(new URLSearchParams(window.location.search).get('plan'))
  ) {
    // The effect above is navigating to /get-started.
    return (
      <div className="flex min-h-dvh items-center justify-center px-4">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

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

          {/*
            Marketing consent. NOT required and NOT pre-ticked: a pre-ticked
            box is not consent, and blocking signup on it would make it a
            condition of service rather than a choice.
          */}
          <label
            htmlFor="marketingConsent"
            className="flex cursor-pointer items-start gap-2.5 text-xs text-[hsl(var(--foreground-muted))]"
          >
            <input
              id="marketingConsent"
              name="marketingConsent"
              type="checkbox"
              checked={marketingConsent}
              onChange={(e) => setMarketingConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-[hsl(var(--primary))]"
            />
            <span>
              Keep me updated with product news, tips and offers by email. You
              can unsubscribe at any time. This is optional — leaving it
              unticked will not affect your account.
            </span>
          </label>

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
