"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, ExternalLink, TriangleAlert } from "lucide-react";
import { describeLegalUrlProblem } from "@/lib/legal-urls";

/**
 * Admin fields for the Privacy Policy and Terms & Conditions links.
 *
 * These are the links behind the REQUIRED consent checkbox on the signup
 * form. Until they are set, the checkbox renders "Privacy Policy" and
 * "Terms & Conditions" as plain text — signup still works, but nobody can
 * read what they are agreeing to, which is worth saying loudly on this screen
 * rather than leaving an admin to discover it from a customer.
 *
 * Saved through /api/admin/settings, the same endpoint as the devtools toggle,
 * because both live on the `app_settings` singleton and a second endpoint for
 * two columns would be two things to keep in step.
 */
export function LegalLinksSettings() {
  const [privacyUrl, setPrivacyUrl] = useState("");
  const [termsUrl, setTermsUrl] = useState("");
  const [loaded, setLoaded] = useState<{ privacy: string; terms: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as {
          privacyPolicyUrl?: string | null;
          termsUrl?: string | null;
        };
        if (!active) return;
        const privacy = body.privacyPolicyUrl ?? "";
        const terms = body.termsUrl ?? "";
        setPrivacyUrl(privacy);
        setTermsUrl(terms);
        setLoaded({ privacy, terms });
      } catch {
        // Fields stay empty; a failed save is what surfaces an error.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  /**
   * Validated before the request, with the same function the server uses.
   *
   * Checking here as well as on the route is not redundant: it is the
   * difference between "your link was rejected" appearing instantly next to
   * the field and appearing after a round trip.
   */
  const privacyProblem = describeLegalUrlProblem(privacyUrl);
  const termsProblem = describeLegalUrlProblem(termsUrl);

  const dirty =
    loaded !== null &&
    (loaded.privacy !== privacyUrl.trim() || loaded.terms !== termsUrl.trim());

  const save = async () => {
    if (privacyProblem || termsProblem) return;

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      /**
       * `deterDevtools` is re-sent because the route requires it — it predates
       * these fields and validates it as mandatory. Read back from the server
       * first so this screen cannot silently flip someone else's setting.
       */
      const current = await fetch("/api/admin/settings", { credentials: "same-origin" });
      const existing = current.ok
        ? ((await current.json()) as { deterDevtools?: boolean })
        : {};

      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deterDevtools: existing.deterDevtools === true,
          privacyPolicyUrl: privacyUrl.trim(),
          termsUrl: termsUrl.trim(),
        }),
      });

      const body = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };

      if (!res.ok) {
        setError(body.message || body.error || "Could not save those links.");
        return;
      }

      setLoaded({ privacy: privacyUrl.trim(), terms: termsUrl.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const bothMissing = !privacyUrl.trim() && !termsUrl.trim();

  return (
    <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Legal links</h3>
        <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
          Linked from the consent checkbox new customers must tick to register.
          Both must be public pages — https only.
        </p>
      </div>

      {/*
        Said plainly. A required checkbox whose documents cannot be read is a
        real compliance gap, not a cosmetic one, so it is flagged here rather
        than left to be noticed.
      */}
      {bothMissing && loaded !== null && (
        <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--warning)_/_0.4)] bg-[hsl(var(--warning)_/_0.08)] px-3 py-2.5 text-xs text-foreground">
          <TriangleAlert
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--warning))]"
            aria-hidden="true"
          />
          <span>
            Neither link is set, so the signup checkbox shows both names as
            plain text. Customers are agreeing to documents they cannot open.
          </span>
        </p>
      )}

      <Field
        id="privacy-policy-url"
        label="Privacy Policy URL"
        value={privacyUrl}
        onChange={setPrivacyUrl}
        problem={privacyProblem}
        placeholder="https://advanceyourreach.com/privacy"
      />

      <Field
        id="terms-url"
        label="Terms & Conditions URL"
        value={termsUrl}
        onChange={setTermsUrl}
        problem={termsProblem}
        placeholder="https://advanceyourreach.com/terms"
      />

      {error && (
        <p className="text-xs text-[hsl(var(--destructive))]" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty || !!privacyProblem || !!termsProblem}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save links
        </button>

        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3.5 w-3.5" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  problem,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  problem: string | null;
  placeholder: string;
}) {
  const valid = !problem && value.trim().length > 0;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="url"
          inputMode="url"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]"
        />
        {/*
          A way to check the link actually resolves, without leaving the page.
          Only offered once the value passes validation, so it cannot be used
          to open something unusable.
        */}
        {valid && (
          <a
            href={value.trim()}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in a new tab"
            className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-md)] border border-border px-2.5 text-xs font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background-muted))] hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Test
          </a>
        )}
      </div>
      {problem ? (
        <p className="text-[11px] text-[hsl(var(--destructive))]">{problem}</p>
      ) : (
        <p className="text-[11px] text-[hsl(var(--foreground-muted))]">
          Leave blank to show the name without a link.
        </p>
      )}
    </div>
  );
}
