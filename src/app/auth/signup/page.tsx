'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { BrandLogo } from '@/components/brand-logo';
import { getAppUrl } from '@/lib/app-url';
import { asBillingCycle, asPlanId, pathForStep } from '@/lib/billing/signup-flow';
import {
  decideDirectSignupOutcome,
  pathAfterSignupTrust,
} from '@/lib/auth/direct-signup';
import { ResendConfirmation } from '@/components/auth/resend-confirmation';
import { RegistrationClosedNotice } from '@/components/auth/registration-closed-notice';
import { useLegalUrls } from '@/hooks/use-legal-urls';
import { ConsentCheckboxes } from '@/components/auth/consent-checkboxes';
import {
  DIAL_CODES,
  DEFAULT_COUNTRY,
  findCountry,
  flagEmoji,
  composeE164,
  describeNationalNumberProblem,
} from '@/lib/phone';

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
function useSignupFlow(): { requiresPlanFirst: boolean | null; registrationOpen: boolean } {
  const [requires, setRequires] = useState<boolean | null>(null);
  /** The admin's "allow new registrations" switch (migration 062). Fails open. */
  const [registrationOpen, setRegistrationOpen] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/billing/signup-flow', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { requiresPlanFirst?: boolean; registrationOpen?: boolean };
        if (!cancelled) {
          setRegistrationOpen(body.registrationOpen !== false);
          setRequires(body.requiresPlanFirst === true);
        }
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

  return { requiresPlanFirst: requires, registrationOpen };
}

export default function SignupPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    companyName: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
  });
  /**
   * Agreement to the Privacy Policy and Terms. REQUIRED.
   *
   * Recorded as a TIMESTAMP server-side rather than a flag, because the
   * question that gets asked later is "when did they agree", which a boolean
   * cannot answer.
   */
  const [termsAccepted, setTermsAccepted] = useState(false);

  /**
   * Consent to promotional SMS, email and phone, including automated dialing.
   * OPTIONAL — it cannot be a condition of holding an account.
   */
  const [promotionalConsent, setPromotionalConsent] = useState(false);

  /**
   * Honeypot. Hidden from people and assistive technology; a bot filling
   * every field fills this too, and /api/auth/signup then answers 200 while
   * creating nothing.
   */
  const [website, setWebsite] = useState('');

  /** The policy links, read from admin settings. */
  const legal = useLegalUrls();

  /**
   * The chosen country, held apart from `formData`.
   *
   * Not in `formData` because `handleChange` is typed for
   * ChangeEvent<HTMLInputElement> and this is a <select>. Widening that handler
   * to satisfy one field would loosen the typing of all seven others.
   *
   * Stored as an ISO code, not a dialling code: +1 is shared by the US and
   * Canada, so the code alone cannot say which flag to show.
   */
  const [phoneCountry, setPhoneCountry] = useState(DEFAULT_COUNTRY);

  const selectedCountry = findCountry(phoneCountry);
  const phoneCode = selectedCountry?.code ?? '';

  /**
   * The expected length for the country currently selected, as hint text.
   *
   * Derived from the same table the validator uses, so the hint and the rule
   * cannot drift. Shown up front because being told "needs 10 digits" only
   * after a rejected submit is a worse experience than being told before.
   */
  const expectedPhoneLength = selectedCountry
    ? selectedCountry.min === selectedCountry.max
      ? `${selectedCountry.min} digits`
      : `${selectedCountry.min} to ${selectedCountry.max} digits`
    : 'Digits only, no spaces needed';

  const { requiresPlanFirst, registrationOpen } = useSignupFlow();

  /**
   * Send anyone who arrived without a plan to pick one first.
   *
   * Covers every entry point at once, including a direct visit to
   * /auth/signup. The plan already in the URL is honoured, so returning from
   * /get-started does not bounce back.
   */
  useEffect(() => {
    if (requiresPlanFirst !== true || !registrationOpen) return;

    const planInUrl = asPlanId(
      new URLSearchParams(window.location.search).get('plan')
    );
    if (planInUrl) return;

    router.replace('/get-started');
  }, [requiresPlanFirst, registrationOpen, router]);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  /**
   * Where the confirmation link should land, kept so a resend rebuilds the
   * SAME destination. Without it a resent link would drop the chosen plan and
   * ask for it again after confirming.
   */
  const [confirmDestination, setConfirmDestination] = useState('/onboarding/welcome');

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    /** Set once we are leaving the page, so the button stays disabled. */
    let navigating = false;

    try {
      // Validate passwords match
      if (formData.password !== formData.confirmPassword) {
        setError('Passwords do not match.');
        return;
      }

      /**
       * Phone, checked before the Supabase call rather than after.
       *
       * `required` on the input catches an empty field but not a half-typed
       * number — and once signUp() succeeds the account exists, so rejecting at
       * that point would strand someone with an account they must confirm
       * before they could fix a typo.
       *
       * The rule depends on the chosen dialling code: exactly 10 digits for
       * +1, 9 or 10 for +44, and so on. See src/lib/phone.ts.
       */
      /**
       * Terms are mandatory. `required` on the input covers the normal path;
       * this is the belt-and-braces check, because the account is created the
       * moment signUp() succeeds and there is no undo after that point.
       */
      if (!termsAccepted) {
        setError('Please agree to the Privacy Policy and Terms & Conditions to continue.');
        return;
      }

      const phoneProblem = describeNationalNumberProblem(phoneCode, formData.phone);
      if (phoneProblem) {
        setError(phoneProblem);
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
      /**
       * The billing cycle picked on /get-started, carried with the plan so
       * /checkout charges the cycle that was chosen. Equally untrusted.
       */
      const selectedCycle = asBillingCycle(
        new URLSearchParams(window.location.search).get('cycle')
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
        (selectedPlan ? pathForStep('checkout', selectedPlan, selectedCycle) : '/onboarding/welcome');

      setConfirmDestination(destination);

      /**
       * 0. DIRECT SIGNUP FIRST (email verification switched off by the admin).
       *
       * The server creates the account already confirmed, so no confirmation
       * email is sent and the user goes straight to payment. When the switch
       * is on (409 verification_required), or the route cannot be reached or
       * fails, the old signUp() path below runs unchanged and they get the
       * "Check your email" screen. See decideDirectSignupOutcome.
       */
      const phoneE164 = composeE164(phoneCode, formData.phone);
      let directResponse: { status: number; body: unknown } | null = null;
      try {
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
            firstName: formData.firstName,
            lastName: formData.lastName,
            companyName: formData.companyName,
            phoneE164,
            termsAccepted,
            promotionalConsent,
            website,
          }),
        });
        directResponse = { status: res.status, body: await res.json().catch(() => null) };
      } catch {
        directResponse = null;
      }

      const outcome = decideDirectSignupOutcome(directResponse);

      if (outcome.kind === 'error') {
        setError(outcome.message);
        return;
      }

      if (outcome.kind === 'sign_in') {
        // The server stored the address trimmed and lower-cased.
        const email = formData.email.trim().toLowerCase();
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password: formData.password,
        });

        if (signInError) {
          // The account exists and is confirmed; an ordinary sign-in works.
          navigating = true;
          router.push(`/auth/login?next=${encodeURIComponent(destination)}`);
          return;
        }

        /**
         * Device trust for this brand-new account, so paying is not preceded
         * by an emailed code. Best effort: when refused, the code challenge
         * is the fallback and it returns to the same destination.
         */
        let trusted = false;
        try {
          const trust = await fetch('/api/auth/2fa/signup-trust', {
            method: 'POST',
            credentials: 'same-origin',
          });
          trusted = trust.ok;
        } catch {
          trusted = false;
        }

        navigating = true;
        router.push(pathAfterSignupTrust(trusted, destination));
        return;
      }


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
             * ONE CANONICAL STRING, built from the two boxes: "+442079460958".
             *
             * Composed rather than sent raw. The trigger stores whatever
             * arrives here verbatim, so passing "020 7946 0958" would persist
             * the spaces, lose the country entirely, and keep a trunk prefix
             * that makes the number undialable.
             *
             * Read by handle_new_user (migration 035) into profiles.phone. If
             * that migration is not applied the value lands in
             * raw_user_meta_data and is silently never read — which is why
             * scripts/verify-profile-phone.mjs checks the trigger as well as
             * the column.
             */
            phone: composeE164(phoneCode, formData.phone),
            /**
             * Sent as a STRING because raw_user_meta_data is JSON read with
             * ->> in the trigger, which yields text. Always sent, so the
             * trigger can tell "declined" from "never asked" — the latter is
             * what an invited team member gets, and it must stay distinct.
             */
            /**
             * DERIVED from the promotional answer, not its own checkbox any
             * more. The old email-only question (migration 028) was replaced
             * on screen by the broader promotional consent below, and agreeing
             * to that includes agreeing to email — so the historical column
             * stays truthful instead of reading FALSE for someone who just
             * said yes to being emailed.
             *
             * Derived inline rather than mirrored into state: a setState
             * during submit would not land before signUp() read it.
             */
            marketing_consent: promotionalConsent ? 'true' : 'false',
            /**
             * Read by handle_new_user (migration 037) into
             * profiles.terms_accepted_at and profiles.promotional_consent.
             *
             * Strings, not booleans, for the same reason as the consent above:
             * raw_user_meta_data is JSON read with ->> in the trigger, which
             * yields text.
             *
             * ALWAYS SENT, both of them. The trigger distinguishes "declined"
             * from "never asked", and an invited team member who never saw
             * these checkboxes must stay in the second category — recording a
             * refusal they never gave would be inventing an answer, and
             * recording an acceptance they never gave would be worse.
             */
            terms_accepted: termsAccepted ? 'true' : 'false',
            promotional_consent: promotionalConsent ? 'true' : 'false',
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
      if (!navigating) setLoading(false);
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

  // The admin has closed new registrations: no form at all.
  if (!registrationOpen) {
    return <RegistrationClosedNotice />;
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
          <div className="flex justify-center">
            <BrandLogo width={140} height={47} />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              We sent a confirmation link to <strong>{formData.email}</strong>.
              Click the link to activate your account. It expires after 24
              hours.
            </p>
          </div>

          {/*
            Email delivery is not guaranteed, and the link can expire before
            it is used. Offering the resend here means a missing first email
            does not strand someone on a screen telling them to check an inbox
            that has nothing in it.
          */}
          <ResendConfirmation
            email={formData.email}
            destination={confirmDestination}
            initialCooldownSeconds={60}
            className="flex flex-col items-center"
          />

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
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              We&apos;ll send your receipt and login details to this address.
            </p>
          </div>

          {/*
            HONEYPOT. Off-screen rather than display:none, which some bots
            skip. aria-hidden and tabIndex -1 keep it away from screen readers
            and keyboard users; autocomplete off keeps browsers from filling it.
          */}
          <div
            aria-hidden="true"
            className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
          >
            <label htmlFor="website">Website</label>
            <input
              id="website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          {/*
            Phone, grouped with email as the other way we reach them.

            TWO BOXES, ONE STORED VALUE. The country code is a <select> rather
            than free text so the stored value cannot be "001", "+ 1" or
            "0044", and so the national number has a known expected length —
            exactly 10 digits for +1. In a single field there is no way to tell
            a country code from an area code, which is why the length could not
            be checked at all before.

            REQUIRED, matching every other identity field on this form. The
            product books onboarding and coaching calls, so a number we may or
            may not have is of limited use.

            type="tel" + inputMode="tel" raise the phone keypad on mobile while
            still accepting the spaces and brackets people type. No input mask:
            one built for (555) 123-4567 mangles 020 7946 0958 as it is typed.
            The value is normalised on submit instead, trunk zero and all.
          */}
          <div className="space-y-1.5">
            <label htmlFor="phone" className="text-sm font-medium">
              Phone number
            </label>
            {/*
              ONE ROW: a compact country picker, then the number taking the rest.

              A TRANSPARENT NATIVE <select> OVER A BOX WE DRAW.

              The requirement is that the collapsed control shows only the flag
              and the code while the open list names the country — and a native
              select cannot do that on its own, because collapsed it renders
              the selected option's own text and nothing shorter. The usual
              answer is a custom listbox, which means re-implementing keyboard
              navigation, type-ahead, focus management, ARIA roles and the
              mobile picker, and getting any one of them wrong makes the field
              unusable for somebody.

              So the real <select> stays, stretched over the box at opacity 0.
              It keeps every native behaviour — arrow keys, type-ahead, the
              full-screen picker on iOS and Android, screen reader support —
              and its option text names the country. The visible box underneath
              is ours to draw, so it shows just the flag and the code.

              The two layers must not fight over clicks: the select sits on top
              with `z-10`, and the visual layer is `pointer-events-none` so
              every click and tap reaches the select.

              `peer` on the select drives the focus ring on the box below it,
              since the element that actually receives focus is invisible.
            */}
            <div className="flex gap-2">
              <label htmlFor="phoneCountry" className="sr-only">
                Country dialling code
              </label>
              <div className="relative w-[6.25rem] shrink-0">
                <select
                  id="phoneCountry"
                  name="phoneCountry"
                  value={phoneCountry}
                  onChange={(e) => setPhoneCountry(e.target.value)}
                  className="peer absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent text-sm opacity-0"
                >
                  {DIAL_CODES.map((entry) => (
                    /*
                      Keyed and valued on ISO: +1 is shared by the US and
                      Canada, so the dialling code is neither a unique key nor
                      enough to know which flag to show.

                      The flag is included in the option text as well. Native
                      option rendering cannot be styled, so the emoji is the
                      only way a flag appears in the open list.
                    */
                    <option key={entry.iso} value={entry.iso}>
                      {flagEmoji(entry.iso)} {entry.country} (+{entry.code})
                    </option>
                  ))}
                </select>

                {/*
                  WHAT THE USER SEES when the control is closed. Hidden from
                  assistive technology because the select above already
                  announces the same thing properly.
                */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none flex items-center gap-1 rounded-[var(--radius-md)] border border-border bg-background px-2 py-2 text-sm transition-colors peer-focus:border-primary peer-focus:ring-2 peer-focus:ring-primary/20"
                >
                  {/*
                    The flag renders as two letters ("US") on Windows, which
                    ships no flag glyphs — see flagEmoji. The code beside it
                    carries the meaning either way, so nothing is lost.
                  */}
                  <span className="text-base leading-none">
                    {flagEmoji(phoneCountry)}
                  </span>
                  <span className="tabular-nums">+{phoneCode}</span>
                  <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 text-[hsl(var(--foreground-muted))]" />
                </div>
              </div>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                /*
                  tel-national, not tel: the browser must fill the number
                  WITHOUT a country code, since the code is its own control.
                  Autofilling a full +1... string here would double it.
                */
                autoComplete="tel-national"
                required
                value={formData.phone}
                onChange={handleChange}
                className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
                placeholder="555 123 4567"
              />
            </div>
            <p className="text-xs text-[hsl(var(--foreground-muted))]">
              {/*
                States the expected length for the SELECTED country, so the
                requirement is known before submitting rather than after being
                refused. Nothing is hardcoded to 10 — the copy follows the
                dropdown.
              */}
              {expectedPhoneLength}. So we can reach you about your plan and
              onboarding call.
            </p>
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
            TWO CHECKBOXES, AND THE DIFFERENCE BETWEEN THEM MATTERS.

            The first is REQUIRED: nobody can hold an account without agreeing
            to the terms, so it gates the submit.

            The second is OPTIONAL and must stay that way. Consent to be
            marketed at cannot be a condition of service, and a pre-ticked box
            is not consent — so it starts unticked and declining it is recorded
            as an explicit FALSE rather than as silence.
          */}
          {/* Shared with /auth/set-password so the wording never drifts. */}
          <ConsentCheckboxes
            legal={legal}
            termsAccepted={termsAccepted}
            onTermsChange={setTermsAccepted}
            promotionalConsent={promotionalConsent}
            onPromotionalChange={setPromotionalConsent}
          />

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
