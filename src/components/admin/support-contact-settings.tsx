"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import {
  DEFAULT_SUPPORT_EMAIL,
  DEFAULT_SUPPORT_PHONE,
  describeSupportEmailProblem,
  describeSupportPhoneProblem,
} from "@/lib/support-contact";

/**
 * Support email and public phone (SMS) shown in the "Need Assistance?" footer
 * on every portal page. Saved to app_settings (migration 059) through
 * /api/admin/settings, like the legal links. Blank = footer default.
 */
export function SupportContactSettings() {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState<{ email: string; phone: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/settings", { credentials: "same-origin" });
        if (!res.ok) return;
        const body = (await res.json()) as { supportEmail?: string | null; supportPhone?: string | null };
        if (!active) return;
        const e = body.supportEmail ?? "";
        const p = body.supportPhone ?? "";
        setEmail(e);
        setPhone(p);
        setLoaded({ email: e, phone: p });
      } catch {
        // Fields stay empty; a failed save is what surfaces an error.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const emailProblem = describeSupportEmailProblem(email);
  const phoneProblem = describeSupportPhoneProblem(phone);
  const dirty =
    loaded !== null && (loaded.email !== email.trim() || loaded.phone !== phone.trim());

  const save = async () => {
    if (emailProblem || phoneProblem) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // The route requires deterDevtools; re-send the current value so it is not flipped.
      const current = await fetch("/api/admin/settings", { credentials: "same-origin" });
      const existing = current.ok ? ((await current.json()) as { deterDevtools?: boolean }) : {};

      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deterDevtools: existing.deterDevtools === true,
          supportEmail: email.trim(),
          supportPhone: phone.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(body.message || body.error || "Could not save the contact details.");
        return;
      }
      setLoaded({ email: email.trim(), phone: phone.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-[hsl(var(--primary))]";

  return (
    <div className="space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Support contact</h3>
        <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
          Shown in the &ldquo;Need Assistance?&rdquo; footer on every portal page. Leave blank to use the default.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="support-email" className="text-xs font-medium text-foreground">
            Support Email
          </label>
          <input
            id="support-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={DEFAULT_SUPPORT_EMAIL}
            aria-invalid={!!emailProblem}
            aria-describedby="support-email-help"
            className={inputClass}
          />
          <p
            id="support-email-help"
            className={`text-[11px] ${emailProblem ? "text-[hsl(var(--destructive))]" : "text-[hsl(var(--foreground-muted))]"}`}
          >
            {emailProblem ?? `Default: ${DEFAULT_SUPPORT_EMAIL}`}
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="support-phone" className="text-xs font-medium text-foreground">
            Public Phone (SMS)
          </label>
          <input
            id="support-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={DEFAULT_SUPPORT_PHONE}
            aria-invalid={!!phoneProblem}
            aria-describedby="support-phone-help"
            className={inputClass}
          />
          <p
            id="support-phone-help"
            className={`text-[11px] ${phoneProblem ? "text-[hsl(var(--destructive))]" : "text-[hsl(var(--foreground-muted))]"}`}
          >
            {phoneProblem ?? `Shown as typed. Default: ${DEFAULT_SUPPORT_PHONE}`}
          </p>
        </div>
      </div>

      {error && (
        <p className="text-xs text-[hsl(var(--destructive))]" role="alert">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty || !!emailProblem || !!phoneProblem}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Save contact details
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600" role="status">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
