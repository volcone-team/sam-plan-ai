"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Award,
  CalendarCheck,
  CalendarDays,
  Play,
  Presentation,
  Users,
} from "lucide-react";

/**
 * Founding-member welcome screen, built to the "Welcome Page.png" mockup.
 *
 * ALWAYS DARK, deliberately independent of the app theme: the design is a
 * dark navy page with a blue glow, and following the user's light/dark
 * preference would produce a page that matches neither the mockup nor itself.
 *
 * Copy is the client's (Oct 2026), separate for monthly and yearly
 * purchases: PERKS_* and STEP_COPY / COACHING_BODY below.
 */

/** Everything still to be supplied. Empty values render honest fallbacks. */
const VIDEO_URL = "";
/**
 * The booking link USED to be a constant here (`BOOKING_URL`, a GHL calendar).
 * It is now `app_settings.onboarding_call_url`, read server-side and passed in
 * as `bookingUrl`, so the owner can set it without a deploy. Same value, same
 * two slots: the step 1 embed and the primary call to action. Unset behaves
 * exactly as the empty constant did.
 */
const SUPPORT_EMAIL = "support@samplan.ai";

/**
 * Artwork from the design, served from /public/welcome. Every image falls back
 * to a matching icon if its file is missing, so a missing asset degrades the
 * look rather than showing a broken-image box.
 */
const ART = {
  perkOnboarding: "/welcome/perk-onboarding.png",
  perkCoaching: "/welcome/perk-coaching.png",
  perkPricing: "/welcome/perk-pricing.png",
  stepIntake: "/welcome/step-intake.png",
  stepCoaching: "/welcome/step-coaching.png",
} as const;

/** Yearly perks (client copy, Oct 2026): the onboarding call is with Pete, an annual-plan bonus. */
const PERKS_YEARLY = [
  {
    art: ART.perkOnboarding,
    icon: Presentation,
    title: "A 1:1 onboarding call with Pete.",
    body: "This is a one-of-a-kind bonus ONLY to Founding Members on the annual plan!",
  },
  {
    art: ART.perkCoaching,
    icon: Users,
    title: "Weekly group coaching led by the co-founders.",
    body:
      "For 12 months, Pete or Rachel will lead your coaching calls personally. " +
      "Future coaching will be led by our team.",
  },
  {
    art: ART.perkPricing,
    icon: Award,
    title: "Our best pricing, ever.",
    body:
      "Your Founding Member rate is grandfathered in for as long as you're a " +
      "member. It will never be this low again.",
  },
] as const;

/** Monthly perks (client copy, Oct 2026): Rachel only, 12 months of coaching. */
const PERKS_MONTHLY = [
  {
    art: ART.perkOnboarding,
    icon: Presentation,
    title: "A 1:1 onboarding call with a co-founder.",
    body:
      "You'll meet with Rachel Stivers, the co-founder of SAM Plan AI. " +
      "Future members will onboard with our team.",
  },
  {
    art: ART.perkCoaching,
    icon: Users,
    title: "Weekly group coaching led by the co-founders.",
    body:
      "For 12 months, Pete or Rachel will lead your coaching calls personally. " +
      "Future coaching will be led by our team.",
  },
  {
    art: ART.perkPricing,
    icon: Award,
    title: "Our best pricing, ever.",
    body:
      "Your Founding Member rate is grandfathered in for as long as you're a " +
      "member. It will never be this low again.",
  },
] as const;

/** Which plan the customer bought; decides the copy. */
export type WelcomePlan = "monthly" | "yearly";

/** Step 1, the closing text and button, per plan. Monthly onboards with Rachel, yearly with Pete. */
const STEP_COPY: Readonly<
  Record<
    WelcomePlan,
    { bookTitle: string; bookBody: string; ctaIntro: string; bookLabel: string; coachingImageRight: boolean }
  >
> = {
  monthly: {
    bookTitle: "Pick a time to meet 1:1 with Rachel (Pete's co-founder)",
    bookBody:
      "Together we will review your plan and get you up and running. " +
      "This call is only available to Founding Members, so book it " +
      "now while times are open. This is a crucial step to completing " +
      "your intake and getting access to the app. We want to make sure " +
      "you are set up for success. You will get the concierge white " +
      "glove treatment directly from Pete's co-founder.",
    ctaIntro:
      "To get access to your app and generate your first SAM Plan, we " +
      "must book your onboarding call. We want to set you up for success.",
    bookLabel: "Book your onboarding call with Rachel",
    coachingImageRight: false,
  },
  yearly: {
    bookTitle: "Pick a time to meet 1:1 with Pete.",
    bookBody:
      "Together we\u2019ll review your plan and get you up and running. This " +
      "call is only available to Founding Members, so book it now while " +
      "times are open. This is a crucial step to completing your intake and " +
      "getting access to the app. We want to make sure you\u2019re set up for " +
      "success, so you\u2019ll get concierge white-glove treatment directly " +
      "from Pete.",
    ctaIntro:
      "To get access to the app and generate your first SAM Plan, you must " +
      "book your onboarding call! We want to set you up for success!",
    bookLabel: "Book your onboarding call with Pete!",
    coachingImageRight: true,
  },
};

const COACHING_BODY: Readonly<Record<WelcomePlan, string>> = {
  monthly:
    "Join Pete and Rachel every Monday at 2 p.m. Eastern / 11 a.m. " +
    "Pacific for your Revenue Operating System weekly call. This is " +
    "your time to go through our weekly process to make sure you are " +
    "hitting your revenue goals, plus get direct coaching and tips on " +
    "using your SAM Plan.",
  yearly:
    "Join Pete and Rachel every Monday at 2 pm Eastern/11 am Pacific for " +
    "your Revenue Operating System weekly call. This is your time to go " +
    "through our weekly process to make sure you are hitting your revenue " +
    "goals plus get direct coaching and tips on using your SAM Plan!",
};

export function WelcomeClient({
  awaitingCall,
  bookingUrl,
  plan = "monthly",
}: {
  firstName: string | null;
  planName: string | null;
  intakeDone: boolean;
  isTrial: boolean;
  trialDaysRemaining: number | null;
  /**
   * True when this company must have its onboarding call before the portal
   * opens (migration 043). Decided server-side by `needsCallUnlock`; false for
   * everyone who was already a customer, and false whenever the feature is off
   * or its migration is not applied.
   */
  awaitingCall: boolean;
  /**
   * The customer's onboarding link, already chosen by billing cycle
   * (resolveOnboardingBookingUrl: yearly link for a paid yearly plan, else
   * app_settings.onboarding_call_url) and validated as an https link.
   */
  bookingUrl: string | null;
  /** Monthly or yearly purchase (paid yearly only; trials and comps are monthly). */
  plan?: WelcomePlan;
}) {
  const perks = plan === "monthly" ? PERKS_MONTHLY : PERKS_YEARLY;
  const copy = STEP_COPY[plan];
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#060b16] text-white">
      {/* Blue spotlight behind the hero, as in the mockup. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[900px] bg-[radial-gradient(ellipse_55%_60%_at_50%_0%,rgba(37,99,235,0.45),rgba(6,11,22,0)_70%)]"
      />

      <main className="relative mx-auto max-w-5xl px-5 pb-16 pt-10 sm:px-8">
        {/* Logo */}
        <div className="flex justify-center">
          <Image
            src="/logo-dark.png"
            alt="SAM Plan AI"
            width={130}
            height={44}
            priority
          />
        </div>

        {/* Hero */}
        <section className="mt-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white/90 sm:text-5xl">
            Welcome, Founding Member!
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">
            You&apos;re one of the first people to get SAM Plan AI, and
            you&apos;re just a few minutes away from having a consistent revenue
            operating system in your business.
          </p>

          <div className="mx-auto mt-10 max-w-3xl overflow-hidden rounded-xl border border-white/10 bg-black/60 shadow-[0_0_80px_rgba(37,99,235,0.25)]">
            {VIDEO_URL ? (
              <div className="aspect-video">
                <iframe
                  src={VIDEO_URL}
                  title="Welcome to SAM Plan AI"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full"
                />
              </div>
            ) : (
              <div className="relative flex aspect-video items-center justify-center bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.25),rgba(0,0,0,0.9)_70%)]">
                <span className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-white/80 sm:h-24 sm:w-24">
                  <Play className="ml-1 h-9 w-9 fill-white text-white" aria-hidden="true" />
                </span>
                <span className="sr-only">Welcome video coming soon</span>
              </div>
            )}
          </div>
        </section>

        {/* Perks */}
        <section className="mt-20 text-center">
          <h2 className="text-2xl font-bold text-white/85 sm:text-4xl">
            Your Founding Member Perks
          </h2>
          <p className="mx-auto mt-4 max-w-md text-sm text-white/80 sm:text-base">
            Because you&apos;re one of our Founding Members, you&apos;re getting
            perks no one else will get:
          </p>

          <div className="mx-auto mt-10 grid max-w-4xl gap-6 sm:grid-cols-3">
            {perks.map((perk) => (
              <div
                key={perk.title}
                className="rounded-2xl border border-teal-300/40 bg-gradient-to-b from-[#0f1a2e] to-[#0a1222] p-6 shadow-[0_0_30px_rgba(45,212,191,0.12)]"
              >
                <Art
                  src={perk.art}
                  fallback={perk.icon}
                  size={72}
                  className="mx-auto h-[72px] w-auto"
                />
                <h3 className="mx-auto mt-5 max-w-[14rem] text-sm font-semibold text-white">
                  {perk.title}
                </h3>
                <p className="mt-4 text-xs leading-relaxed text-white/70">
                  {perk.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Next steps */}
        <section className="mt-20">
          <h2 className="text-center text-2xl font-bold text-white/85 sm:text-4xl">
            Here Are Your Next Steps
          </h2>

          {/*
            Two steps for both plans: book the onboarding call, then add the
            coaching calls. The intake step is gone (it opens after the call).
            The booking calendar gets the wider column and enough height to
            show a full GHL calendar without scrolling inside the frame.
          */}
          <div className="mt-12 grid items-start gap-8 md:grid-cols-[3fr_2fr]">
            <div className="order-2 md:order-1">
              {bookingUrl ? (
                <iframe
                  src={bookingUrl}
                  title="Book your onboarding call"
                  className="h-[900px] w-full rounded-xl bg-white"
                />
              ) : (
                <>
                  <MiniCalendar />
                  <p className="mt-2 text-center text-xs text-white/50">
                    Booking calendar coming soon
                  </p>
                </>
              )}
            </div>
            <StepCopy
              className="order-1 md:order-2 md:pt-6"
              step={1}
              title={copy.bookTitle}
              body={copy.bookBody}
            />
          </div>

          <div className="mt-16 grid items-center gap-8 md:grid-cols-2">
            {/* Yearly: copy left, image right. Monthly: image left, copy right. */}
            <Illustration
              src={ART.stepCoaching}
              icon={CalendarCheck}
              className={copy.coachingImageRight ? "order-2" : "order-2 md:order-1"}
            />
            <StepCopy
              className={copy.coachingImageRight ? "order-1" : "order-1 md:order-2"}
              step={2}
              title={<>Add your Founding Member<br />coaching calls to your calendar</>}
              body={COACHING_BODY[plan]}
            />
          </div>
        </section>

        {/* CTA */}
        <section className="mt-20 text-center">
          {awaitingCall && (
            <p className="mx-auto mb-6 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-base">
              {copy.ctaIntro}
            </p>
          )}
          <PrimaryCta
            awaitingCall={awaitingCall}
            bookingUrl={bookingUrl}
            bookLabel={copy.bookLabel}
          />
          <p className="mt-10 text-sm font-semibold text-white">
            Questions? Email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
          <p className="mt-5 text-sm font-semibold text-white">
            Welcome to the founding group, we&apos;re so glad you&apos;re here.
          </p>
        </section>
      </main>

      <footer className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-8 sm:px-8">
          <Image src="/logo-dark.png" alt="SAM Plan AI" width={110} height={37} />
          <p className="text-xs text-white/80 sm:text-sm">
            The Revenue Operating System
          </p>
        </div>
      </footer>
    </div>
  );
}

/** The gradient bar, shared so both states look identical. */
const CTA_CLASS =
  "mx-auto flex max-w-3xl items-center justify-center gap-2 rounded-md " +
  "bg-gradient-to-r from-blue-600 via-sky-500 to-teal-400 px-6 py-3.5 text-sm " +
  "font-semibold uppercase tracking-wide text-white " +
  "shadow-[0_0_30px_rgba(56,189,248,0.3)] transition-opacity hover:opacity-90";

/**
 * The one button at the bottom of the page.
 *
 * TWO STATES, because this page has two audiences and only one of them has a
 * dashboard to go to:
 *
 *   awaiting their call -> "Book a call with us". The dashboard link is NOT
 *       shown: the middleware would bounce them straight back here, so
 *       offering it would be a button whose only effect is to look broken.
 *   everyone else       -> "Access your SAM Plan dashboard", unchanged. This
 *       is still the ordinary post-checkout page, and for a customer who was
 *       never gated (every existing one) nothing about it changes.
 *
 * NO DEAD BUTTON when the link is unset. A gated customer with no configured
 * calendar is told we will arrange it, which is true and is all we can
 * honestly say — the same reasoning as src/lib/billing/booking.ts, where an
 * unset URL removes the offer rather than rendering a button that does
 * nothing.
 */
function PrimaryCta({
  awaitingCall,
  bookingUrl,
  bookLabel,
}: {
  awaitingCall: boolean;
  bookingUrl: string | null;
  /** The booking button's words; differs by plan. */
  bookLabel: string;
}) {
  if (!awaitingCall) {
    return (
      <Link href="/year-at-a-glance" className={CTA_CLASS}>
        Access your SAM Plan dashboard
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    );
  }

  if (!bookingUrl) {
    return (
      <p className="mx-auto max-w-3xl text-sm font-semibold text-white">
        We&apos;ll be in touch to arrange your call.
      </p>
    );
  }

  return (
    <a
      href={bookingUrl}
      /*
       * A third-party calendar, so a new tab and `noopener noreferrer`: the
       * page must stay open behind it (it carries the rest of the next steps),
       * and the opened document must get no handle on this one.
       *
       * The new tab is ANNOUNCED rather than left as a surprise — a visible
       * icon would say nothing to a screen reader, so the words are in the
       * accessible name and hidden visually.
       */
      target="_blank"
      rel="noopener noreferrer"
      className={CTA_CLASS}
    >
      {bookLabel}
      <span className="sr-only"> (opens in a new tab)</span>
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </a>
  );
}

function StepCopy({
  step,
  title,
  body,
  action,
  className,
}: {
  step: number;
  title: React.ReactNode;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-3xl font-bold text-white sm:text-4xl">Step {step}</p>
      <h3 className="mt-3 text-lg font-bold leading-snug text-white sm:text-xl">
        {title}
      </h3>
      <p className="mt-5 max-w-md text-sm leading-relaxed text-white/80">
        {body}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Design artwork, falling back to an icon if the file is missing.
 *
 * A plain <img> rather than next/image: these are fixed decorative assets, and
 * next/image offers no clean way to react to a 404 without a broken frame
 * flashing first. `onError` swaps in the icon instead.
 *
 * The artwork ships on a BLACK background, not transparency. `mix-blend-screen`
 * drops pure black out against the dark page, so the glow sits on the page
 * rather than inside a visible black square.
 *
 * Decorative only (`alt=""`): every image sits beside text that says the same
 * thing, so a screen reader announcing it would be noise.
 */
function Art({
  src,
  fallback: Icon,
  size,
  className,
}: {
  src: string;
  fallback: typeof CalendarDays;
  size: number;
  className?: string;
}) {
  const [missing, setMissing] = useState(false);

  if (missing) {
    return (
      <Icon
        aria-hidden="true"
        strokeWidth={1.25}
        style={{ width: size, height: size }}
        className="mx-auto text-teal-300 drop-shadow-[0_0_12px_rgba(45,212,191,0.6)]"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      onError={() => setMissing(true)}
      className={`mix-blend-screen ${className ?? ""}`}
    />
  );
}

function Illustration({
  src,
  icon,
  className,
}: {
  src: string;
  icon: typeof CalendarDays;
  className?: string;
}) {
  return (
    <div className={`flex justify-center ${className ?? ""}`}>
      <Art
        src={src}
        fallback={icon}
        size={128}
        className="w-full max-w-[340px]"
      />
    </div>
  );
}

/** Static month view standing in for the GHL booking embed. */
function MiniCalendar() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const label = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="mx-auto max-w-sm rounded-xl bg-white p-5 text-neutral-800 shadow-lg">
      <div className="flex items-center justify-between text-sm font-semibold">
        <span aria-hidden="true" className="text-neutral-400">‹</span>
        <span suppressHydrationWarning>{label}</span>
        <span aria-hidden="true" className="text-neutral-400">›</span>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-y-3 text-center text-[11px]">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
          <span key={d} className="font-medium text-neutral-400">{d}</span>
        ))}
        {cells.map((day, i) => (
          <span key={i} suppressHydrationWarning>{day ?? ""}</span>
        ))}
      </div>
    </div>
  );
}
