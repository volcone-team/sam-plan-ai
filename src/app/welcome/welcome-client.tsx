"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Award,
  CalendarCheck,
  CalendarDays,
  Check,
  ClipboardCheck,
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
 * Copy is the mockup's, verbatim. The bracketed values ([X] months, [day],
 * [time]) are unfilled in the design too, so they live in constants below
 * rather than being invented.
 */

/** Everything still to be supplied. Empty values render honest fallbacks. */
const VIDEO_URL = "";
const BOOKING_URL = ""; // GHL calendar embed URL
const SUPPORT_EMAIL = "support@samplan.ai";
const COACHING_MONTHS = "[X]";
const COACHING_DAY = "[day]";
const COACHING_TIME = "[time]";

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

const PERKS = [
  {
    art: ART.perkOnboarding,
    icon: Presentation,
    title: "A 1:1 onboarding call with a co-founder.",
    body:
      "You'll meet with Pete Vargas or Rachel Stivers, the co-founders of " +
      "SAM Plan AI. Future members will onboard with our team.",
  },
  {
    art: ART.perkCoaching,
    icon: Users,
    title: "Weekly group coaching led by the co-founders.",
    body:
      `For ${COACHING_MONTHS} months, Pete or Rachel will lead your coaching ` +
      "calls personally. Future coaching will be led by our team.",
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

export function WelcomeClient({
  intakeDone,
}: {
  firstName: string | null;
  planName: string | null;
  intakeDone: boolean;
  isTrial: boolean;
  trialDaysRemaining: number | null;
}) {
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
            {PERKS.map((perk) => (
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

          {/* Step 1 — calendar left, copy right */}
          <div className="mt-12 grid items-center gap-8 md:grid-cols-2">
            <div className="order-2 md:order-1">
              {BOOKING_URL ? (
                <iframe
                  src={BOOKING_URL}
                  title="Book your onboarding call"
                  className="h-[520px] w-full rounded-xl bg-white"
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
              className="order-1 md:order-2"
              step={1}
              title={<>Book your onboarding call<br />with a co-founder</>}
              body={
                "Pick a time to meet 1:1 with Pete or Rachel. Together you'll " +
                "review your plan and get you up and running. This call is " +
                "only available to Founding Members, so book it now while " +
                "times are open."
              }
            />
          </div>

          {/* Step 2 — copy left, illustration right */}
          <div className="mt-16 grid items-center gap-8 md:grid-cols-2">
            <StepCopy
              step={2}
              title={
                <>
                  Complete your intake
                  <br />
                  <em className="font-semibold">(about 15 minutes)</em>
                </>
              }
              body={
                "Do this before your onboarding call. SAM Plan will build your " +
                "first draft plan, so your time with Pete or Rachel goes to " +
                "refining your strategy, not filling out forms."
              }
              action={
                intakeDone ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    Intake complete
                  </span>
                ) : (
                  <Link
                    href="/intake/start"
                    className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-400"
                  >
                    Click to complete
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                )
              }
            />
            <Illustration src={ART.stepIntake} icon={ClipboardCheck} />
          </div>

          {/* Step 3 — illustration left, copy right */}
          <div className="mt-16 grid items-center gap-8 md:grid-cols-2">
            <Illustration
              src={ART.stepCoaching}
              icon={CalendarCheck}
              className="order-2 md:order-1"
            />
            <StepCopy
              className="order-1 md:order-2"
              step={3}
              title={<>Add your Founding Member<br />coaching calls to your calendar</>}
              body={
                `Join Pete or Rachel every ${COACHING_DAY} at ${COACHING_TIME} ` +
                "for weekly group coaching, a Founding Member exclusive for " +
                `${COACHING_MONTHS} months.`
              }
            />
          </div>
        </section>

        {/* CTA */}
        <section className="mt-20 text-center">
          <Link
            href="/year-at-a-glance"
            className="mx-auto flex max-w-3xl items-center justify-center gap-2 rounded-md bg-gradient-to-r from-blue-600 via-sky-500 to-teal-400 px-6 py-3.5 text-sm font-semibold uppercase tracking-wide text-white shadow-[0_0_30px_rgba(56,189,248,0.3)] transition-opacity hover:opacity-90"
          >
            Access your SAM Plan dashboard
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
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
