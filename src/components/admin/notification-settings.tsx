"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Bell, CheckCircle, AlertCircle, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  renderTemplate,
  type EmailTemplate,
  type TemplateVars,
} from "@/lib/notifications/render";

/* ------------------------------------------------------------------
   Types — mirror the /api/admin/notifications contract (Task 10)
   ------------------------------------------------------------------ */

type RecipientRule = "all" | "owners_operators";

interface NotificationRules {
  enabled: boolean;
  lead_times: number[];
  recipient_rule: RecipientRule;
  template_key: string;
}

interface NotificationsResponse {
  rules: NotificationRules;
  template: {
    key: string;
    subject: string;
    body_html: string;
    active: boolean;
  } | null;
}

/* ------------------------------------------------------------------
   Constants
   ------------------------------------------------------------------ */

const RECIPIENT_OPTIONS: { value: RecipientRule; label: string }[] = [
  { value: "all", label: "All company users" },
  { value: "owners_operators", label: "Owners & operators only" },
];

/** Tokens supported by the shared renderer (see @/lib/notifications/render). */
const TEMPLATE_VARIABLES = [
  "firstName",
  "initiativeName",
  "channel",
  "daysUntil",
  "activationDate",
] as const;

/** Sample values used only to power the live preview. */
const PREVIEW_VARS: TemplateVars = {
  firstName: "Alex",
  initiativeName: "Spring Webinar",
  channel: "webinar",
  daysUntil: 2,
  activationDate: "2025-04-01",
};

/* ------------------------------------------------------------------
   Pure helper: add a day value to the lead-times list (deduped, sorted)
   ------------------------------------------------------------------ */

export function addLeadTime(existing: number[], value: number): number[] {
  if (!Number.isInteger(value) || value <= 0) return existing.slice().sort((a, b) => a - b);
  const set = new Set(existing);
  set.add(value);
  return Array.from(set).sort((a, b) => a - b);
}

/* ------------------------------------------------------------------
   Sub-component: accessible toggle (role="switch")
   ------------------------------------------------------------------ */

function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        checked ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted))]"
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-6" : "translate-x-1"
        )}
      />
    </button>
  );
}

const INPUT_CLASSES =
  "w-full rounded-[var(--radius-md)] border border-border bg-transparent px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:border-[hsl(var(--primary))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]";

/* ------------------------------------------------------------------
   Main component
   ------------------------------------------------------------------ */

export function NotificationSettings() {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Editable state (loaded from the API, never localStorage)
  const [enabled, setEnabled] = useState(true);
  const [leadTimes, setLeadTimes] = useState<number[]>([]);
  const [recipientRule, setRecipientRule] = useState<RecipientRule>("owners_operators");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");

  // Lead-time add input
  const [newLeadTime, setNewLeadTime] = useState("");
  const [leadTimeError, setLeadTimeError] = useState<string | null>(null);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const applyResponse = useCallback((data: NotificationsResponse) => {
    setEnabled(data.rules.enabled);
    setLeadTimes([...data.rules.lead_times].sort((a, b) => a - b));
    setRecipientRule(data.rules.recipient_rule);
    setSubject(data.template?.subject ?? "");
    setBodyHtml(data.template?.body_html ?? "");
  }, []);

  // Initial load from the DB-backed API (Req 2.2/2.3 — no localStorage).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/notifications", {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data: NotificationsResponse = await res.json();
        if (!active) return;
        applyResponse(data);
        setLoadError(null);
      } catch {
        if (active) setLoadError("Could not load notification settings. Please refresh to try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyResponse]);

  // Live preview uses the SAME renderer the sender uses (Req 7.2).
  const preview = useMemo(() => {
    const tpl: EmailTemplate = { subject, body_html: bodyHtml };
    return renderTemplate(tpl, PREVIEW_VARS);
  }, [subject, bodyHtml]);

  const handleAddLeadTime = () => {
    const value = Number(newLeadTime);
    if (newLeadTime.trim() === "" || !Number.isInteger(value) || value <= 0) {
      setLeadTimeError("Enter a whole number of days greater than 0.");
      return;
    }
    setLeadTimes((prev) => addLeadTime(prev, value));
    setNewLeadTime("");
    setLeadTimeError(null);
  };

  const handleRemoveLeadTime = (value: number) => {
    setLeadTimes((prev) => prev.filter((d) => d !== value));
  };

  const insertVariable = (name: string) => {
    const token = `{{${name}}}`;
    const el = bodyRef.current;
    if (!el) {
      setBodyHtml((prev) => prev + token);
      return;
    }
    const start = el.selectionStart ?? bodyHtml.length;
    const end = el.selectionEnd ?? bodyHtml.length;
    const next = bodyHtml.slice(0, start) + token + bodyHtml.slice(end);
    setBodyHtml(next);
    // Restore focus + caret after the inserted token.
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + token.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setShowSuccess(false);
    try {
      const res = await fetch("/api/admin/notifications", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          lead_times: leadTimes,
          recipient_rule: recipientRule,
          subject,
          body_html: bodyHtml,
        }),
      });

      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        const field = typeof data?.error === "string" ? data.error : "input";
        setSaveError(`Please check the "${field}" field and try again.`);
        return;
      }
      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      const data: NotificationsResponse = await res.json();
      applyResponse(data);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch {
      setSaveError("Something went wrong while saving. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">Loading notification settings…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        <AlertCircle className="h-4 w-4" />
        {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Success toast */}
      {showSuccess && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <CheckCircle className="h-4 w-4" />
          Notification settings saved successfully.
        </div>
      )}

      {/* Save error banner */}
      {saveError && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <AlertCircle className="h-4 w-4" />
          {saveError}
        </div>
      )}

      {/* Global enabled toggle */}
      <section aria-label="Reminder status">
        <div className="mb-4 flex items-center gap-2">
          <Bell className="h-5 w-5 text-[hsl(var(--primary))]" />
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Reminder status</h2>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-[var(--radius-lg)] border border-border bg-card px-6 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[hsl(var(--foreground))]">Automatic initiative reminders</p>
            <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
              When on, reminder emails are sent automatically as initiatives approach their trigger dates.
            </p>
          </div>
          <ToggleSwitch
            checked={enabled}
            onChange={setEnabled}
            ariaLabel="Automatic initiative reminders"
          />
        </div>
      </section>

      {/* Lead times */}
      <section aria-label="Lead times">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Lead times</h2>
          <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
            How many days ahead of an initiative&rsquo;s trigger date a reminder fires. Add more than one.
          </p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
          <div className="flex flex-wrap gap-2" role="list" aria-label="Configured lead times">
            {leadTimes.length === 0 && (
              <p className="text-sm text-[hsl(var(--foreground-muted))]">No lead times configured yet.</p>
            )}
            {leadTimes.map((days) => (
              <span
                key={days}
                role="listitem"
                className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--muted))] px-3 py-1 text-sm text-[hsl(var(--foreground))]"
              >
                {days} {days === 1 ? "day" : "days"}
                <button
                  type="button"
                  onClick={() => handleRemoveLeadTime(days)}
                  aria-label={`Remove ${days} day lead time`}
                  className="rounded-full p-0.5 text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>

          <div className="mt-4 flex items-end gap-2">
            <div className="w-40">
              <label
                htmlFor="new-lead-time"
                className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                Add lead time (days)
              </label>
              <input
                id="new-lead-time"
                type="number"
                min={1}
                step={1}
                value={newLeadTime}
                onChange={(e) => {
                  setNewLeadTime(e.target.value);
                  setLeadTimeError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddLeadTime();
                  }
                }}
                className={INPUT_CLASSES}
                placeholder="e.g. 3"
              />
            </div>
            <button
              type="button"
              onClick={handleAddLeadTime}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>
          {leadTimeError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400" role="alert">
              {leadTimeError}
            </p>
          )}
        </div>
      </section>

      {/* Recipient rule */}
      <section aria-label="Recipients">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Recipients</h2>
          <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
            Who at the initiative&rsquo;s company receives the reminder.
          </p>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
          <fieldset>
            <legend className="sr-only">Recipient rule</legend>
            <div className="space-y-3">
              {RECIPIENT_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-3 text-sm text-[hsl(var(--foreground))]">
                  <input
                    type="radio"
                    name="recipient-rule"
                    value={opt.value}
                    checked={recipientRule === opt.value}
                    onChange={() => setRecipientRule(opt.value)}
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </section>

      {/* Template editor + live preview */}
      <section aria-label="Email template">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">Email template</h2>
          <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">
            Edit the reminder subject and HTML body. Use the variable palette to insert dynamic values.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Editor */}
          <div className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
            <div className="mb-4">
              <label
                htmlFor="template-subject"
                className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                Subject
              </label>
              <input
                id="template-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className={INPUT_CLASSES}
                placeholder='e.g. Your {{channel}} "{{initiativeName}}" goes live in {{daysUntil}} days'
              />
            </div>

            {/* Variable palette */}
            <div className="mb-2">
              <p className="mb-1.5 text-sm font-medium text-[hsl(var(--foreground))]">Variables</p>
              <div className="flex flex-wrap gap-2">
                {TEMPLATE_VARIABLES.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => insertVariable(name)}
                    aria-label={`Insert ${name} variable into the body`}
                    className="rounded-full border border-border px-2.5 py-1 font-mono text-xs text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
                  >
                    {`{{${name}}}`}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="template-body"
                className="mb-1 block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                HTML body
              </label>
              <textarea
                id="template-body"
                ref={bodyRef}
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
                rows={10}
                className={cn(INPUT_CLASSES, "font-mono")}
                placeholder="<p>Hi {{firstName}}, ...</p>"
              />
            </div>
          </div>

          {/* Live preview */}
          <div
            className="rounded-[var(--radius-lg)] border border-border bg-card p-6"
            aria-label="Template preview"
          >
            <p className="mb-3 text-sm font-medium text-[hsl(var(--foreground))]">Preview</p>
            <div className="mb-3">
              <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                Subject
              </p>
              <p className="mt-1 text-sm text-[hsl(var(--foreground))]">{preview.subject}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-[hsl(var(--foreground-muted))]">
                Body
              </p>
              {/*
                Admin-authored content shown only to admins on this admin-only page.
                renderTemplate HTML-escapes interpolated VALUES; the surrounding body
                markup is authored by the admin here, so rendering it as HTML is safe
                in this context.
              */}
              <div
                className="prose prose-sm mt-1 max-w-none text-sm text-[hsl(var(--foreground))]"
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Save */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[hsl(var(--primary)/0.9)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </div>
  );
}
