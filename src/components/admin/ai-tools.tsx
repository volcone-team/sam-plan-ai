"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUsd } from "@/lib/ai-pricing";

/**
 * Super-admin AI tools: spend and volume across plan generation and the
 * chatbot, plus the chatbot's own controls.
 *
 * COSTS ARE ESTIMATES. They are token counts times a static rate table, so they
 * track the Anthropic invoice closely but not exactly — prompt caching and batch
 * discounts are not modelled. The page says so plainly rather than presenting
 * the figures as billing data.
 */

interface Bucket {
  calls: number;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
}

interface UsageResponse {
  windowDays: number;
  totals: {
    generation: Bucket;
    chat: Bucket;
    combinedCostUsd: number;
    generationFailures: number;
    chatFailures: number;
    chatConversations: number;
    chatMessages: number;
  };
  byDay: { date: string; generation: Bucket; chat: Bucket }[];
  byModel: ({ model: string } & Bucket)[];
  byEventType: ({ eventType: string } & Bucket)[];
  companies: {
    companyId: string | null;
    companyName: string | null;
    generation: Bucket;
    chat: Bucket;
    totalCostUsd: number;
  }[];
  unknownModels: string[];
}

interface ChatSettings {
  chatbotEnabled: boolean;
  chatDailyTokenCap: number;
  chatContactEmail: string | null;
  chatModel: string;
  availableModels: readonly { id: string; label: string; note: string }[];
  overrides: {
    companyId: string;
    companyName: string | null;
    dailyTokenCap: number;
    updatedAt: string;
  }[];
}

const WINDOWS = [7, 30, 90] as const;

function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
      <p className="text-xs text-[hsl(var(--foreground-muted))]">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-[hsl(var(--foreground))]">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{sub}</p>}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors",
        // --background-muted, not --muted: the latter is undefined in
        // globals.css, which left the off state with no fill at all.
        checked ? "bg-[hsl(var(--primary))]" : "bg-[hsl(var(--background-muted))] border border-[hsl(var(--border))]"
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

export function AiTools() {
  const [days, setDays] = useState<number>(30);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Local edit buffers, so typing does not fire a request per keystroke.
  const [capDraft, setCapDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");

  const loadUsage = useCallback(async (windowDays: number) => {
    const res = await fetch(`/api/admin/ai-usage?days=${windowDays}`, {
      credentials: "same-origin",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || "Could not load usage");
    }
    return (await res.json()) as UsageResponse;
  }, []);

  const loadSettings = useCallback(async () => {
    const res = await fetch("/api/admin/chat-settings", { credentials: "same-origin" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || "Could not load chat settings");
    }
    return (await res.json()) as ChatSettings;
  }, []);

  const refresh = useCallback(
    async (windowDays: number) => {
      setLoading(true);
      setError(null);
      try {
        const [u, s] = await Promise.all([loadUsage(windowDays), loadSettings()]);
        setUsage(u);
        setSettings(s);
        setCapDraft(String(s.chatDailyTokenCap));
        setEmailDraft(s.chatContactEmail ?? "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    },
    [loadUsage, loadSettings]
  );

  useEffect(() => {
    refresh(days);
  }, [days, refresh]);

  /** Patch chat settings. Reloads on success so the view matches the server. */
  const save = async (patch: Record<string, unknown>, successMessage: string) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/chat-settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        // The API answers with the offending field name, which is more useful
        // than a generic failure message.
        setError(`Could not save: ${body?.error ?? "unknown field"}`);
        return;
      }
      const fresh = await loadSettings();
      setSettings(fresh);
      setCapDraft(String(fresh.chatDailyTokenCap));
      setEmailDraft(fresh.chatContactEmail ?? "");
      setNotice(successMessage);
      setTimeout(() => setNotice(null), 3000);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  };

  if (loading && !usage) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-[hsl(var(--foreground-muted))]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading AI usage...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className="rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-[var(--radius-md)] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          {notice}
        </div>
      )}

      {/* Window selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={cn(
                "rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors",
                days === w
                  ? "bg-[hsl(var(--primary))] text-white"
                  : "text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))]"
              )}
            >
              {w} days
            </button>
          ))}
        </div>
        <button
          onClick={() => refresh(days)}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm hover:bg-[hsl(var(--background-muted))] disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Estimate disclaimer — stated up front, not buried. */}
      <p className="text-xs text-[hsl(var(--foreground-muted))]">
        Costs are estimated from reported token counts using current list prices.
        They track your Anthropic invoice closely but will not match it exactly
        (prompt caching and batch discounts are not modelled). Anthropic&apos;s
        console remains the billing source of truth.
      </p>

      {usage && usage.unknownModels.length > 0 && (
        <div className="flex items-start gap-2 rounded-[var(--radius-md)] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Unrecognised model priced at fallback rates</p>
            <p className="mt-0.5 text-xs">
              {usage.unknownModels.join(", ")} — add these to the rate table in
              lib/ai-pricing.ts so spend is not understated.
            </p>
          </div>
        </div>
      )}

      {/* Totals */}
      {usage && (
        <section aria-label="Spend summary" className="space-y-3">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            Spend, last {usage.windowDays} days
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Total estimated cost"
              value={formatUsd(usage.totals.combinedCostUsd)}
              sub="Generation + chat"
            />
            <StatCard
              label="Plan generation"
              value={formatUsd(usage.totals.generation.costUsd)}
              sub={`${formatInt(usage.totals.generation.calls)} runs, ${formatInt(usage.totals.generationFailures)} failed`}
            />
            <StatCard
              label="Chatbot"
              value={formatUsd(usage.totals.chat.costUsd)}
              sub={`${formatInt(usage.totals.chatMessages)} replies, ${formatInt(usage.totals.chatConversations)} conversations`}
            />
            <StatCard
              label="Tokens used"
              value={formatInt(
                usage.totals.generation.tokensInput +
                  usage.totals.generation.tokensOutput +
                  usage.totals.chat.tokensInput +
                  usage.totals.chat.tokensOutput
              )}
              sub="Input + output, both surfaces"
            />
          </div>
        </section>
      )}

      {/* Per-model */}
      {usage && usage.byModel.length > 0 && (
        <section aria-label="Spend by model" className="space-y-3">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">By model</h2>
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-[hsl(var(--foreground-muted))]">
                <tr>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Calls</th>
                  <th className="px-4 py-2 font-medium">Input</th>
                  <th className="px-4 py-2 font-medium">Output</th>
                  <th className="px-4 py-2 font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.byModel.map((m) => (
                  <tr key={m.model} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-mono text-xs">{m.model}</td>
                    <td className="px-4 py-2">{formatInt(m.calls)}</td>
                    <td className="px-4 py-2">{formatInt(m.tokensInput)}</td>
                    <td className="px-4 py-2">{formatInt(m.tokensOutput)}</td>
                    <td className="px-4 py-2 font-medium">{formatUsd(m.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Per-company */}
      {usage && usage.companies.length > 0 && (
        <section aria-label="Spend by company" className="space-y-3">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            By company
          </h2>
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-xs text-[hsl(var(--foreground-muted))]">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Plan runs</th>
                  <th className="px-4 py-2 font-medium">Chat replies</th>
                  <th className="px-4 py-2 font-medium">Chat tokens</th>
                  <th className="px-4 py-2 font-medium">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {usage.companies.map((c) => (
                  <tr
                    key={c.companyId ?? "none"}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2">
                      {c.companyName ?? (
                        <span className="text-[hsl(var(--foreground-muted))]">
                          {c.companyId ? "Unnamed company" : "No company"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2">{formatInt(c.generation.calls)}</td>
                    <td className="px-4 py-2">{formatInt(c.chat.calls)}</td>
                    <td className="px-4 py-2">
                      {formatInt(c.chat.tokensInput + c.chat.tokensOutput)}
                    </td>
                    <td className="px-4 py-2 font-medium">{formatUsd(c.totalCostUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Daily trend */}
      {usage && usage.byDay.length > 0 && (
        <section aria-label="Daily spend" className="space-y-3">
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">By day</h2>
          <div className="max-h-72 overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b border-border bg-card text-left text-xs text-[hsl(var(--foreground-muted))]">
                <tr>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Generation</th>
                  <th className="px-4 py-2 font-medium">Chat</th>
                  <th className="px-4 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {[...usage.byDay].reverse().map((d) => (
                  <tr key={d.date} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">{d.date}</td>
                    <td className="px-4 py-2">{formatUsd(d.generation.costUsd)}</td>
                    <td className="px-4 py-2">{formatUsd(d.chat.costUsd)}</td>
                    <td className="px-4 py-2 font-medium">
                      {formatUsd(d.generation.costUsd + d.chat.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Chatbot controls */}
      {settings && (
        <section aria-label="Chatbot controls" className="space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
              Chatbot controls
            </h2>
          </div>

          <div className="space-y-5 rounded-[var(--radius-lg)] border border-border bg-card p-6">
            {/* Enable */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                  Enable the assistant
                </p>
                <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                  When off, the widget does not appear for any user and the chat API
                  refuses requests. Off by default.
                </p>
              </div>
              <Toggle
                checked={settings.chatbotEnabled}
                onChange={(v) => save({ chatbotEnabled: v }, v ? "Assistant enabled." : "Assistant disabled.")}
                ariaLabel="Enable the assistant"
              />
            </div>

            {/* Model */}
            <div className="border-t border-border pt-5">
              <label
                htmlFor="chat-model"
                className="block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                Model
              </label>
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                The initiative library is re-sent with every message, so input price
                dominates chat cost. Haiku is the default for that reason.
              </p>
              <select
                id="chat-model"
                value={settings.chatModel}
                disabled={saving}
                onChange={(e) => save({ chatModel: e.target.value }, "Model updated.")}
                className="mt-2 w-full max-w-md rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                {settings.availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} — {m.note}
                  </option>
                ))}
              </select>
            </div>

            {/* Daily cap */}
            <div className="border-t border-border pt-5">
              <label
                htmlFor="chat-cap"
                className="block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                Daily token allowance per account
              </label>
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                Pooled across every member of a company, counting input and output
                together, and reset at midnight UTC. Set 0 to switch chat off for
                everyone while leaving the feature enabled.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  id="chat-cap"
                  type="number"
                  min={0}
                  value={capDraft}
                  onChange={(e) => setCapDraft(e.target.value)}
                  className="w-40 rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={() => save({ chatDailyTokenCap: Number(capDraft) }, "Allowance updated.")}
                  disabled={saving || capDraft === String(settings.chatDailyTokenCap)}
                  className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Save
                </button>
                <span className="text-xs text-[hsl(var(--foreground-muted))]">
                  ~{Math.max(1, Math.round(Number(capDraft || 0) / 5000))} messages/day
                </span>
              </div>
            </div>

            {/* Contact email */}
            <div className="border-t border-border pt-5">
              <label
                htmlFor="chat-contact"
                className="block text-sm font-medium text-[hsl(var(--foreground))]"
              >
                Contact email when the allowance runs out
              </label>
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                Shown in place of the message box so users have a route to a human
                rather than a dead end. Leave blank to show no link.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  id="chat-contact"
                  type="email"
                  value={emailDraft}
                  placeholder="support@yourcompany.com"
                  onChange={(e) => setEmailDraft(e.target.value)}
                  className="w-72 rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={() =>
                    save(
                      { chatContactEmail: emailDraft.trim() === "" ? null : emailDraft.trim() },
                      "Contact email updated."
                    )
                  }
                  disabled={saving || emailDraft === (settings.chatContactEmail ?? "")}
                  className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>

            {/* Per-company overrides */}
            {settings.overrides.length > 0 && (
              <div className="border-t border-border pt-5">
                <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                  Per-company overrides
                </p>
                <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                  These companies use their own allowance instead of the platform
                  default.
                </p>
                <div className="mt-3 space-y-2">
                  {settings.overrides.map((o) => (
                    <div
                      key={o.companyId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 truncate">
                        {o.companyName ?? o.companyId}
                      </span>
                      <span className="text-[hsl(var(--foreground-muted))]">
                        {formatInt(o.dailyTokenCap)} tokens/day
                      </span>
                      <button
                        onClick={() =>
                          save(
                            { companyOverride: { companyId: o.companyId, dailyTokenCap: null } },
                            "Override removed."
                          )
                        }
                        disabled={saving}
                        className="text-xs font-medium text-[hsl(var(--destructive))] hover:underline disabled:opacity-40"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
