import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { PauseCircle, Mail } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";

export const metadata = {
  title: "Account paused | SAM Plan AI",
};

// The contact email is read per request: an admin changing it should take
// effect immediately, not after a rebuild.
export const dynamic = "force-dynamic";

/**
 * Where a paused account lands.
 *
 * Deliberately OUTSIDE the `(app)` route group. That layout renders the
 * sidebar, header and chat widget — offering navigation to someone who cannot
 * use any of it would be a page full of dead links.
 *
 * WHAT THIS PAGE DOES NOT SAY. The admin's `pause_reason` is never shown. It is
 * an internal note that may read "non-payment" or "contract dispute", and the
 * customer is not its audience. They are told the state and who to contact,
 * which is everything they can act on.
 *
 * The contact address comes from the same `app_settings.chat_contact_email` the
 * AI Tools page edits, so there is ONE place to maintain it rather than a
 * second setting that silently disagrees with the first.
 */
async function loadContactEmail(): Promise<string | null> {
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data } = await db
      .from("app_settings")
      .select("chat_contact_email")
      .eq("id", "global")
      .maybeSingle();

    return (data as { chat_contact_email?: string | null } | null)?.chat_contact_email ?? null;
  } catch (err) {
    // A failed lookup must not break the page — the pause message itself is
    // the important part, and a missing address degrades to generic wording.
    console.error("[account-paused] Could not read contact email:", err);
    return null;
  }
}

export default async function AccountPausedPage() {
  const contactEmail = await loadContactEmail();

  return (
    <div className="flex min-h-dvh flex-col bg-[hsl(var(--background-subtle))]">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4 sm:px-6">
          <BrandLogo width={120} height={40} />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg rounded-[var(--radius-lg)] border border-border bg-card p-8 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950">
            <PauseCircle
              className="h-6 w-6 text-amber-700 dark:text-amber-400"
              aria-hidden="true"
            />
          </div>

          <h1 className="mt-5 text-2xl font-bold tracking-tight text-foreground">
            Your plan is paused
          </h1>

          <p className="mt-3 text-sm text-[hsl(var(--foreground-muted))]">
            Access to your plan, initiatives and reports is on hold while your
            account is paused. Nothing has been deleted — everything will be
            exactly as you left it once access is restored.
          </p>

          <p className="mt-4 text-sm font-medium text-foreground">
            To continue, please contact your administrator.
          </p>

          {contactEmail ? (
            <a
              href={`mailto:${contactEmail}?subject=${encodeURIComponent(
                "Paused account — request to restore access"
              )}`}
              className="mt-5 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {contactEmail}
            </a>
          ) : (
            /*
              No address configured. Say so plainly rather than rendering a
              dead mailto: link, which would look like the page is broken.
            */
            <p className="mt-5 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
              Please get in touch with the person who manages your SAM Plan AI
              account.
            </p>
          )}

          {/*
            Sign out stays reachable. Someone with access to two accounts needs
            a way off this page, and without it a paused session is a dead end.
          */}
          <p className="mt-6 text-xs text-[hsl(var(--foreground-subtle))]">
            <Link
              href="/auth/login"
              className="underline underline-offset-2 hover:text-[hsl(var(--foreground-muted))]"
            >
              Sign in with a different account
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
