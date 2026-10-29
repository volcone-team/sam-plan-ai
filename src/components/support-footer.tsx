"use client";

import { useEffect, useState } from "react";
import { Bug, ExternalLink, LifeBuoy, Lightbulb, Mail, MessageSquareText } from "lucide-react";
import { resolveSupportContact, type SupportContact } from "@/lib/support-contact";

/**
 * "Need Assistance?" footer: how to reach support, report an error or ask for
 * a feature. Shown at the bottom of every portal page (AppShell).
 *
 * The email and SMS number come from /admin/settings (app_settings, migration
 * 059), read through /api/admin/settings like the devtools switch. It renders
 * the defaults first, then swaps in the saved values.
 * The two forms are external Monday.com pages, so they open in a new tab.
 */
const ERROR_FORM_URL = "https://forms.monday.com/forms/21201c3b1b898a0e09c978aa4b844e99?r=use1";
const FEATURE_REQUEST_URL = "https://ev-companies.monday.com/boards/18435280721/views/286248997";

const linkClass =
  "font-medium text-[hsl(var(--primary))] underline-offset-2 hover:underline focus-visible:underline outline-none";

export function SupportFooter() {
  const [contact, setContact] = useState<SupportContact>(() => resolveSupportContact(null));

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { supportContact?: SupportContact };
        if (active && body.supportContact) setContact(body.supportContact);
      } catch {
        // Keep the defaults: the footer must never go blank.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <footer
      aria-labelledby="support-footer-heading"
      className="mt-12 border-t border-border bg-[hsl(var(--background-muted))]/40"
    >
      <div className="mx-auto grid max-w-7xl gap-6 px-4 pt-8 pb-24 sm:px-6 sm:pb-20 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-10 lg:px-8">
        <div className="flex gap-4">
          <span
            aria-hidden="true"
            className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))] sm:flex"
          >
            <LifeBuoy className="h-5 w-5" />
          </span>
          <div className="space-y-2">
            <h2 id="support-footer-heading" className="text-base font-semibold text-[hsl(var(--foreground))]">
              Need Assistance?
            </h2>
            <p className="max-w-3xl text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
              Sammie the Planbot is always available to answer questions and provide guidance. If you&rsquo;d like
              to reach a team member, contact our Customer Experience team anytime via SMS (text only, cannot
              receive calls) at{" "}
              <a href={contact.phoneHref} className={`${linkClass} inline-flex items-center gap-1 whitespace-nowrap`}>
                <MessageSquareText aria-hidden="true" className="h-3.5 w-3.5" />
                {contact.phoneDisplay}
              </a>{" "}
              or email{" "}
              <a href={`mailto:${contact.email}`} className={`${linkClass} inline-flex items-center gap-1 whitespace-nowrap`}>
                <Mail aria-hidden="true" className="h-3.5 w-3.5" />
                {contact.email}
              </a>
              . We&rsquo;re happy to help!
            </p>
          </div>
        </div>

        <ul className="flex flex-col gap-2 sm:flex-row lg:flex-col">
          <li>
            <a
              href={ERROR_FORM_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-card px-4 py-3 text-sm transition-colors hover:border-[hsl(var(--primary))] focus-visible:border-[hsl(var(--primary))] outline-none"
            >
              <Bug aria-hidden="true" className="h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))] group-hover:text-[hsl(var(--primary))]" />
              <span>
                <span className="block text-xs text-[hsl(var(--foreground-muted))]">Found an error?</span>
                <span className="font-medium text-[hsl(var(--foreground))]">Please let us know here</span>
              </span>
              <ExternalLink aria-hidden="true" className="ml-auto h-3.5 w-3.5 text-[hsl(var(--foreground-muted))]" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
          <li>
            <a
              href={FEATURE_REQUEST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-card px-4 py-3 text-sm transition-colors hover:border-[hsl(var(--primary))] focus-visible:border-[hsl(var(--primary))] outline-none"
            >
              <Lightbulb aria-hidden="true" className="h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))] group-hover:text-[hsl(var(--primary))]" />
              <span>
                <span className="block text-xs text-[hsl(var(--foreground-muted))]">Have a feature request?</span>
                <span className="font-medium text-[hsl(var(--foreground))]">Submit it here</span>
              </span>
              <ExternalLink aria-hidden="true" className="ml-auto h-3.5 w-3.5 text-[hsl(var(--foreground-muted))]" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        </ul>
      </div>
    </footer>
  );
}
