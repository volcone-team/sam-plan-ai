"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CreditCard,
  RefreshCw,
  TriangleAlert,
  CheckCircle2,
  Gift,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { LoadingPanel } from "@/components/ui/spinner";
import { ServerDataTable, type ServerColumn } from "@/components/ui/server-data-table";

/**
 * Real Stripe billing administration. SUPER-ADMIN ONLY.
 *
 * Replaces the mock panel whose buttons called alert("Stripe not connected").
 * Everything here is wired to /api/admin/billing and /api/admin/subscribers.
 */

interface BillingSettings {
  stripeEnabled: boolean;
  stripeMode: "test" | "live";
  trialEnabled: boolean;
  trialDays: number;
  trialPlanId: string | null;
  trialRequiresCard: boolean;
  trialInitiativeCap: number;
  dunningGraceDays: number;
}

interface Plan {
  id: string;
  name: string;
  monthly_price: number;
  annual_price: number;
  is_active: boolean;
  is_default: boolean;
}

interface PriceRow {
  plan_id: string;
  stripe_mode: string;
  billing_cycle: string;
  stripe_price_id: string;
  unit_amount: number;
  is_current: boolean;
}

interface BillingResponse {
  settings: BillingSettings;
  keys: {
    testConfigured: boolean;
    liveConfigured: boolean;
    testWarning: string | null;
    liveWarning: string | null;
  };
  plans: Plan[];
  prices: PriceRow[];
  counts: { stripeSubscriptions: number; comped: number };
}

interface Subscriber {
  subscriptionId: string;
  companyId: string;
  companyName: string | null;
  planName: string;
  planId: string | null;
  billingCycle: string;
  price: number | null;
  status: string;
  stripeStatus: string | null;
  stripeMode: string | null;
  hasStripeSubscription: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingPlanName: string | null;
  isComped: boolean;
  compedUntil: string | null;
  compedReason: string | null;
  trialEndsAt: string | null;
  pastDueSince: string | null;
  lifetimePaid: number;
  access: { allowed: boolean; reason: string; warn: boolean; daysRemaining: number | null };
}

interface Invoice {
  id: string;
  companyName: string | null;
  stripe_invoice_id: string;
  status: string | null;
  amount_due: number | null;
  amount_paid: number | null;
  currency: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
  paid_at: string | null;
  failure_message: string | null;
  created_at: string;
}

interface SubscribersResponse {
  mode: string;
  stripeEnabled: boolean;
  subscribers: Subscriber[];
  invoices: Invoice[];
  /** Total matching rows on the server, for pagination. */
  total: number;
  limit: number;
  offset: number;
  totals: {
    companies: number; comped: number; paying: number;
    pastDue: number; collected: number;
  };
}

/** Minor units to a display string. */
function money(minor: number | null | undefined, currency = "usd"): string {
  const v = typeof minor === "number" && Number.isFinite(minor) ? minor / 100 : 0;
  return `${currency.toUpperCase() === "USD" ? "$" : ""}${v.toFixed(2)}`;
}

function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-US", { dateStyle: "medium" }) : "—";
}

function Toggle({
  checked, onChange, ariaLabel, disabled,
}: { checked: boolean; onChange: (v: boolean) => void; ariaLabel: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-40",
        checked
          ? "bg-[hsl(var(--primary))]"
          : "border border-[hsl(var(--border))] bg-[hsl(var(--background-muted))]"
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

function StatusPill({ sub }: { sub: Subscriber }) {
  const { access } = sub;
  const label = sub.isComped
    ? "Comped"
    : access.reason === "billing_disabled"
      ? "Billing off"
      : (sub.stripeStatus ?? sub.status);

  const tone = !access.allowed
    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
    : access.warn
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
      : "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300";

  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tone)}>
      {label}
    </span>
  );
}

/**
 * Column definitions for the Accounts table.
 *
 * Outside the component so the array identity is stable — DataTable memoises
 * filtering on `columns`, and a fresh array each render would recompute the
 * filter on every keystroke.
 */
function subscriberColumns(ctx: {
  busy: boolean;
  plans: Plan[];
  onComp: (sub: Subscriber) => void;
  onUncomp: (sub: Subscriber) => void;
}): ServerColumn<Subscriber>[] {
  return [
    {
      key: "company",
      header: "Company",
      render: (sub) => (
        <>
          {sub.companyName ?? (
            <span className="text-[hsl(var(--foreground-muted))]">Unnamed</span>
          )}
          {sub.compedReason && (
            <p className="text-xs text-[hsl(var(--foreground-muted))]">{sub.compedReason}</p>
          )}
        </>
      ),
    },
    {
      key: "plan",
      header: "Plan",
      render: (sub) => (
        <>
          {sub.planName}
          <span className="text-xs text-[hsl(var(--foreground-muted))]"> / {sub.billingCycle}</span>
          {sub.pendingPlanName && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              → {sub.pendingPlanName} at period end
            </p>
          )}
        </>
      ),
    },
    {
      key: "state",
      header: "State",
      render: (sub) => (
        <>
          <StatusPill sub={sub} />
          {sub.cancelAtPeriodEnd && (
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">Cancelling</p>
          )}
        </>
      ),
    },
    {
      key: "renews",
      // Header reflects that the date may be an ending rather than a renewal.
      header: "Renews / ends",
      className: "text-xs",
      render: (sub) => {
        if (sub.isComped) {
          return sub.compedUntil ? `Comp ends ${shortDate(sub.compedUntil)}` : "No expiry";
        }
        // A cancelling subscription ENDS on this date; calling it a renewal was
        // the most misleading thing this table said.
        if (sub.cancelAtPeriodEnd) {
          return (
            <span className="text-amber-700 dark:text-amber-400">
              Ends {shortDate(sub.currentPeriodEnd)}
            </span>
          );
        }
        return shortDate(sub.currentPeriodEnd);
      },
    },
    {
      key: "paid",
      header: "Paid",
      render: (sub) => money(sub.lifetimePaid),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (sub) => {
        // Grant access is offered ONLY to accounts that are not paying. Comping a
        // paying customer would hand them a free plan while their card is still
        // charged, and would corrupt the flag that answers "who is not paying".
        if (sub.isComped) {
          return (
            <button
              disabled={ctx.busy}
              onClick={() => ctx.onUncomp(sub)}
              className="text-xs font-medium text-[hsl(var(--destructive))] hover:underline disabled:opacity-40"
            >
              Remove comp
            </button>
          );
        }
        if (
          sub.hasStripeSubscription &&
          ["active", "trialing", "past_due"].includes(sub.stripeStatus ?? "")
        ) {
          return (
            <span className="text-xs text-[hsl(var(--foreground-muted))]">Paying customer</span>
          );
        }
        return (
          <button
            disabled={ctx.busy}
            onClick={() => ctx.onComp(sub)}
            className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-40"
          >
            <Gift className="h-3.5 w-3.5" />
            Grant access
          </button>
        );
      },
    },
  ];
}

export function BillingManagement() {
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [data, setData] = useState<SubscribersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [trialDaysDraft, setTrialDaysDraft] = useState("");
  const [trialCapDraft, setTrialCapDraft] = useState("");
  const [graceDraft, setGraceDraft] = useState("");
  // Bumped after a mutation so the table reloads its CURRENT page, preserving the
  // admin's search term and position rather than resetting them.
  const [reloadToken, setReloadToken] = useState(0);
  const [compTarget, setCompTarget] = useState<Subscriber | null>(null);
  const [compPlanId, setCompPlanId] = useState("");
  const [compUntil, setCompUntil] = useState("");
  const [compReason, setCompReason] = useState("");

  /**
   * One page of accounts, straight from the server.
   *
   * Stable identity via useCallback with no changing deps: ServerDataTable calls
   * this inside an effect keyed on the function, so a new reference each render
   * would re-fetch in a loop.
   */
  const fetchSubscriberPage = useCallback(
    async ({ search, limit, offset }: { search: string; limit: number; offset: number }) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (search) params.set("search", search);

      const res = await fetch(`/api/admin/subscribers?${params}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Could not load accounts");
      }
      const body = (await res.json()) as SubscribersResponse;
      return { rows: body.subscribers, total: body.total ?? body.subscribers.length };
    },
    []
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bRes, sRes] = await Promise.all([
        fetch("/api/admin/billing", { credentials: "same-origin" }),
        // Only for the headline totals and invoice list; the accounts table
        // fetches its own pages.
        fetch("/api/admin/subscribers?limit=1", { credentials: "same-origin" }),
      ]);
      if (!bRes.ok || !sRes.ok) {
        const body = await (bRes.ok ? sRes : bRes).json().catch(() => ({}));
        throw new Error(body?.error || "Could not load billing data");
      }
      const b = (await bRes.json()) as BillingResponse;
      const s = (await sRes.json()) as SubscribersResponse;
      setBilling(b);
      setData(s);
      setTrialDaysDraft(String(b.settings.trialDays));
      setTrialCapDraft(String(b.settings.trialInitiativeCap));
      setGraceDraft(String(b.settings.dunningGraceDays));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const saveSettings = async (patch: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // key_missing is the common, actionable failure: explain it precisely
        // rather than showing a raw field name.
        setError(
          body?.error === "key_missing"
            ? `No Stripe secret key for ${body.mode} mode. Add STRIPE_SECRET_KEY_${String(body.mode).toUpperCase()} to the environment first.`
            : `Could not save: ${body?.error ?? "unknown"}`
        );
        return;
      }
      await load();
      flash(ok);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  // Keep drafts in step after a reload so the Save buttons disable correctly.
  useEffect(() => {
    if (!billing) return;
    setTrialCapDraft(String(billing.settings.trialInitiativeCap));
  }, [billing]);

  const runAction = async (payload: Record<string, unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/billing", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`Action failed: ${body?.error ?? "unknown"}`);
        return;
      }
      if (Array.isArray(body?.errors) && body.errors.length > 0) {
        setError(
          `Completed with problems: ${body.errors.map((e: { plan?: string; message?: string }) => e.message ?? e).join("; ")}`
        );
      } else {
        // Report what the sync actually did. A bare "synced" message was
        // confusing when everything was already current or deliberately skipped,
        // because nothing visibly changed in Stripe.
        const parts: string[] = [];
        if (Array.isArray(body?.created) && body.created.length) {
          parts.push(`${body.created.length} created`);
        }
        if (Array.isArray(body?.updated) && body.updated.length) {
          parts.push(`${body.updated.length} price change(s) — existing subscribers keep their old price`);
        }
        if (Array.isArray(body?.unchanged) && body.unchanged.length) {
          parts.push(`${body.unchanged.length} already current`);
        }
        if (Array.isArray(body?.skipped) && body.skipped.length) {
          parts.push(`${body.skipped.length} not offered (price 0)`);
        }
        if (typeof body?.migrated === "number") {
          parts.push(`${body.migrated} moved, ${body.skipped ?? 0} skipped`);
        }
        flash(parts.length ? `${ok} ${parts.join(" · ")}` : ok);
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Reconcile from Stripe. Stripe is the authority on what was paid, so this
   * only ever overwrites our copy with theirs — safe to run repeatedly.
   */
  const resyncFromStripe = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/billing/resync", {
        method: "POST",
        credentials: "same-origin",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(`Pull failed: ${body?.error ?? "unknown"}`);
        return;
      }
      const synced = Array.isArray(body?.synced) ? body.synced.length : 0;
      const skipped = Array.isArray(body?.skipped) ? body.skipped.length : 0;
      const errs = Array.isArray(body?.errors) ? body.errors : [];
      if (errs.length > 0) {
        setError(`Pulled with problems: ${errs.join("; ")}`);
      } else {
        flash(
          `Pulled from Stripe — ${synced} subscription(s), ${body?.invoicesRecorded ?? 0} invoice(s)` +
            (skipped ? `, ${skipped} skipped` : "")
        );
      }
      await load();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  };

  const comp = async () => {
    if (!compTarget || !compPlanId) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/subscribers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "comp",
          companyId: compTarget.companyId,
          planId: compPlanId,
          until: compUntil || null,
          reason: compReason || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(`Could not comp: ${body?.error ?? "unknown"}`);
        return;
      }
      setCompTarget(null);
      setCompUntil("");
      setCompReason("");
      // Refresh totals, and nudge the table to reload its current page.
      await load();
      setReloadToken((n) => n + 1);
      flash("Access granted.");
    } finally {
      setBusy(false);
    }
  };

  const uncomp = async (s: Subscriber) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/subscribers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "uncomp", companyId: s.companyId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(`Could not remove comp: ${body?.error ?? "unknown"}`);
        return;
      }
      await load();
      setReloadToken((n) => n + 1);
      flash("Comp removed.");
    } finally {
      setBusy(false);
    }
  };

  // Shared LoadingPanel rather than bespoke "Loading billing..." text, so every
  // admin tab presents the same loading state.
  if (loading && !billing) {
    return <LoadingPanel />;
  }

  const s = billing?.settings;
  const keys = billing?.keys;
  const currentModePrices = (billing?.prices ?? []).filter(
    (p) => p.stripe_mode === s?.stripeMode && p.is_current
  );

  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className="rounded-[var(--radius-md)] border border-[hsl(var(--destructive)_/_0.3)] bg-[hsl(var(--destructive)_/_0.05)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </div>
      )}

      {/* Key status — surfaced first, because everything else depends on it. */}
      {keys && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(["test", "live"] as const).map((m) => {
            const configured = m === "test" ? keys.testConfigured : keys.liveConfigured;
            const warning = m === "test" ? keys.testWarning : keys.liveWarning;
            return (
              <div key={m} className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium capitalize">{m} mode keys</p>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      configured
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : "bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground-muted))]"
                    )}
                  >
                    {configured ? "Configured" : "Not set"}
                  </span>
                </div>
                {warning && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {warning}
                  </p>
                )}
                {!configured && (
                  <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))]">
                    Set STRIPE_SECRET_KEY_{m.toUpperCase()} and
                    STRIPE_WEBHOOK_SECRET_{m.toUpperCase()}.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Core controls */}
      {s && (
        <section aria-label="Billing controls" className="space-y-3">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-[hsl(var(--primary))]" />
            <h2 className="text-lg font-semibold">Billing controls</h2>
          </div>

          <div className="space-y-5 rounded-[var(--radius-lg)] border border-border bg-card p-6">
            {/* Master switch */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Require payment to register</p>
                <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                  Off: the app runs exactly as it does today — signup needs no payment
                  and nothing is restricted. On: new signups must pay, and access
                  follows subscription state.
                </p>
                <p className="mt-2 text-xs text-[hsl(var(--foreground-muted))]">
                  Existing accounts are comped, so turning this on will not lock them out.
                </p>
              </div>
              <Toggle
                checked={s.stripeEnabled}
                disabled={busy}
                onChange={(v) =>
                  saveSettings({ stripeEnabled: v }, v ? "Billing enabled." : "Billing disabled.")
                }
                ariaLabel="Require payment to register"
              />
            </div>

            {/* Mode */}
            <div className="border-t border-border pt-5">
              <p className="text-sm font-medium">Stripe mode</p>
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                Test and live are separate Stripe accounts with separate data. Customers
                and subscriptions created in one do not exist in the other, so switching
                does not carry anything across.
              </p>
              {(billing?.counts.stripeSubscriptions ?? 0) > 0 && (
                <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  {billing?.counts.stripeSubscriptions} subscription(s) already exist. They
                  belong to the mode that created them and will be ignored in the other mode.
                </p>
              )}
              <div className="mt-3 flex gap-2">
                {(["test", "live"] as const).map((m) => {
                  const configured = m === "test" ? keys?.testConfigured : keys?.liveConfigured;
                  return (
                    <button
                      key={m}
                      disabled={busy || !configured}
                      onClick={() => saveSettings({ stripeMode: m }, `Switched to ${m} mode.`)}
                      className={cn(
                        "rounded-[var(--radius-md)] px-4 py-2 text-sm font-medium capitalize transition-colors disabled:opacity-40",
                        s.stripeMode === m
                          ? "bg-[hsl(var(--primary))] text-white"
                          : "border border-border hover:bg-[hsl(var(--background-muted))]"
                      )}
                    >
                      {m}
                      {!configured && " (no key)"}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Trial */}
            <div className="border-t border-border pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Free trial</p>
                  <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                    The trial starts the moment someone registers — no card, no checkout.
                    They get the initiative allowance set below for the number of days
                    set, then keep read-only access to the dashboard until they upgrade.
                  </p>
                </div>
                <Toggle
                  checked={s.trialEnabled}
                  disabled={busy}
                  onChange={(v) => saveSettings({ trialEnabled: v }, "Trial setting saved.")}
                  ariaLabel="Enable free trial"
                />
              </div>

              {s.trialEnabled && (
                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="trial-days" className="text-xs text-[hsl(var(--foreground-muted))]">
                      Trial length (days)
                    </label>
                    <input
                      id="trial-days"
                      type="number"
                      min={0}
                      max={365}
                      value={trialDaysDraft}
                      onChange={(e) => setTrialDaysDraft(e.target.value)}
                      className="w-24 rounded-[var(--radius-md)] border border-border bg-background px-3 py-1.5 text-sm"
                    />
                    <button
                      disabled={busy || trialDaysDraft === String(s.trialDays)}
                      onClick={() => saveSettings({ trialDays: Number(trialDaysDraft) }, "Trial length saved.")}
                      className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                      Save
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="trial-cap" className="text-xs text-[hsl(var(--foreground-muted))]">
                      Initiatives allowed during the trial
                    </label>
                    <input
                      id="trial-cap"
                      type="number"
                      min={0}
                      max={1000}
                      value={trialCapDraft}
                      onChange={(e) => setTrialCapDraft(e.target.value)}
                      className="w-24 rounded-[var(--radius-md)] border border-border bg-background px-3 py-1.5 text-sm"
                    />
                    <button
                      disabled={busy || trialCapDraft === String(s.trialInitiativeCap)}
                      onClick={() =>
                        saveSettings(
                          { trialInitiativeCap: Number(trialCapDraft) },
                          "Trial initiative allowance saved."
                        )
                      }
                      className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                    >
                      Save
                    </button>
                    <span className="text-xs text-[hsl(var(--foreground-muted))]">
                      Total for the whole trial — quickstart and full combined.
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label htmlFor="trial-plan" className="text-xs text-[hsl(var(--foreground-muted))]">
                      Other limits mirror
                    </label>
                    <select
                      id="trial-plan"
                      value={s.trialPlanId ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        saveSettings({ trialPlanId: e.target.value || null }, "Trial plan saved.")
                      }
                      className="rounded-[var(--radius-md)] border border-border bg-background px-3 py-1.5 text-sm"
                    >
                      <option value="">Default plan</option>
                      {(billing?.plans ?? []).map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>

                  {/*
                    The "require a card" toggle was removed: the trial no longer
                    runs through Stripe Checkout, so there is no point at which a
                    card could be collected for it. Upgrading is a separate,
                    deliberate purchase.
                  */}
                </div>
              )}
            </div>

            {/* Dunning */}
            <div className="border-t border-border pt-5">
              <p className="text-sm font-medium">Grace period after a failed payment</p>
              <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
                Days a customer keeps access while a payment is failing. Stripe retries
                automatically, and the usual cause is an expired card — cutting access
                instantly punishes customers for something that often fixes itself.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={graceDraft}
                  aria-label="Grace period in days"
                  onChange={(e) => setGraceDraft(e.target.value)}
                  className="w-24 rounded-[var(--radius-md)] border border-border bg-background px-3 py-1.5 text-sm"
                />
                <button
                  disabled={busy || graceDraft === String(s.dunningGraceDays)}
                  onClick={() => saveSettings({ dunningGraceDays: Number(graceDraft) }, "Grace period saved.")}
                  className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Prices */}
      <section aria-label="Stripe prices" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Plans in Stripe ({s?.stripeMode})</h2>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={() => runAction({ action: "sync_prices" }, "Prices synced to Stripe.")}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
              Sync prices
            </button>
            {/*
              Repair path for a missed webhook. A webhook endpoint is PINNED to the
              API version it was created with and cannot be re-pinned, so an older
              endpoint can deliver a payload shape the handler fails to read —
              payment succeeds in Stripe while the plan never changes here.
            */}
            <button
              disabled={busy}
              onClick={resyncFromStripe}
              title="Pull subscriptions and invoices from Stripe. Use when a payment succeeded but the plan did not change."
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm hover:bg-[hsl(var(--background-muted))] disabled:opacity-40"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} />
              Pull from Stripe
            </button>
          </div>
        </div>
        <p className="text-xs text-[hsl(var(--foreground-muted))]">
          Creates Stripe products and prices from your plans. Changing a plan&apos;s price
          creates a NEW Stripe price — existing subscribers keep the price they signed up
          at until you explicitly migrate them.
        </p>

        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-[hsl(var(--foreground-muted))]">
              <tr>
                <th className="px-4 py-2 font-medium">Plan</th>
                <th className="px-4 py-2 font-medium">Monthly</th>
                <th className="px-4 py-2 font-medium">Annual</th>
                <th className="px-4 py-2 font-medium">In Stripe</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {(billing?.plans ?? []).map((p) => {
                const monthly = currentModePrices.find(
                  (x) => x.plan_id === p.id && x.billing_cycle === "monthly"
                );
                const annual = currentModePrices.find(
                  (x) => x.plan_id === p.id && x.billing_cycle === "annual"
                );
                const synced = !!monthly || !!annual;
                return (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 py-2">${p.monthly_price}</td>
                    <td className="px-4 py-2">${p.annual_price}</td>
                    <td className="px-4 py-2">
                      {/*
                        Distinguishes "not offered" from "needs a sync". A price of
                        0 means the plan is deliberately not sold on that cycle, so
                        showing "Not synced" made a valid setup look broken.
                      */}
                      {synced ? (
                        <span className="text-xs text-green-700 dark:text-green-400">
                          {monthly ? "monthly" : ""}{monthly && annual ? " + " : ""}{annual ? "annual" : ""}
                        </span>
                      ) : p.monthly_price <= 0 && p.annual_price <= 0 ? (
                        <span className="text-xs text-[hsl(var(--foreground-muted))]">
                          No price set
                        </span>
                      ) : (
                        <span className="text-xs text-amber-700 dark:text-amber-400">
                          Sync needed
                        </span>
                      )}
                      {/* Flags a DB price that has not reached Stripe yet. */}
                      {p.monthly_price > 0 && !monthly && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          monthly pending
                        </p>
                      )}
                      {p.annual_price > 0 && !annual && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          annual pending
                        </p>
                      )}
                      {p.monthly_price <= 0 && p.annual_price > 0 && (
                        <p className="text-xs text-[hsl(var(--foreground-muted))]">
                          annual only
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {synced && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            runAction(
                              { action: "migrate_price", planId: p.id },
                              "Subscribers moved to the current price."
                            )
                          }
                          title="Charge existing subscribers the current price from their next invoice"
                          className="text-xs font-medium text-[hsl(var(--primary))] hover:underline disabled:opacity-40"
                        >
                          Apply new price to all
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Totals */}
      {data && (
        <section aria-label="Subscriber totals" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[
            { label: "Companies", value: String(data.totals.companies) },
            { label: "Paying", value: String(data.totals.paying) },
            { label: "Comped", value: String(data.totals.comped) },
            { label: "Past due", value: String(data.totals.pastDue) },
            { label: "Collected", value: money(data.totals.collected) },
          ].map((t) => (
            <div key={t.label} className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
              <p className="text-xs text-[hsl(var(--foreground-muted))]">{t.label}</p>
              <p className="mt-1 text-2xl font-semibold">{t.value}</p>
            </div>
          ))}
        </section>
      )}

      {/* Subscribers */}
      {data && (
        <section aria-label="Subscribers" className="space-y-3">
          <h2 className="text-lg font-semibold">Accounts</h2>
          {/*
            Server-paged: search and paging happen in the query, so the response
            stays the size of one page however many accounts exist.
            `reloadToken` is bumped after comp/uncomp so the visible page
            refreshes without resetting the admin's search or position.
          */}
          <ServerDataTable
            fetchPage={fetchSubscriberPage}
            rowKey={(sub) => sub.subscriptionId}
            searchPlaceholder="Search accounts by company name..."
            emptyMessage="No accounts yet."
            reloadToken={reloadToken}
            columns={subscriberColumns({
              busy,
              plans: billing?.plans ?? [],
              onComp: (sub) => {
                setCompTarget(sub);
                setCompPlanId(sub.planId ?? billing?.plans[0]?.id ?? "");
              },
              onUncomp: uncomp,
            })}
          />
        </section>
      )}

      {/* Payment history */}
      {data && (
        <section aria-label="Payment history" className="space-y-3">
          <h2 className="text-lg font-semibold">Payment history</h2>
          {data.invoices.length === 0 ? (
            <p className="rounded-[var(--radius-lg)] border border-border bg-card p-6 text-sm text-[hsl(var(--foreground-muted))]">
              No invoices yet. They appear here as Stripe reports them via webhook.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto rounded-[var(--radius-lg)] border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-border bg-card text-left text-xs text-[hsl(var(--foreground-muted))]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Date</th>
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 font-medium">Paid</th>
                    <th className="px-4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((inv) => (
                    <tr key={inv.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-xs">{shortDate(inv.created_at)}</td>
                      <td className="px-4 py-2">{inv.companyName ?? "—"}</td>
                      <td className="px-4 py-2">
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-medium",
                            inv.status === "paid"
                              ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          )}
                        >
                          {inv.status ?? "unknown"}
                        </span>
                        {inv.failure_message && (
                          <p className="mt-0.5 text-xs text-[hsl(var(--destructive))]">
                            {inv.failure_message}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-2">{money(inv.amount_due, inv.currency)}</td>
                      <td className="px-4 py-2">{money(inv.amount_paid, inv.currency)}</td>
                      <td className="px-4 py-2 text-right">
                        {inv.hosted_invoice_url && (
                          <a
                            href={inv.hosted_invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--primary))] hover:underline"
                          >
                            View <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Comp dialog */}
      {compTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-label="Grant access" className="w-full max-w-md rounded-[var(--radius-lg)] border border-border bg-card p-6">
            <h3 className="text-base font-semibold">
              Grant free access — {compTarget.companyName ?? "this account"}
            </h3>
            <p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">
              Full use of the chosen plan with no payment. Plan limits still apply, and
              Stripe is not involved at all.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="comp-plan" className="block text-xs font-medium">Plan</label>
                <select
                  id="comp-plan"
                  value={compPlanId}
                  onChange={(e) => setCompPlanId(e.target.value)}
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm"
                >
                  {(billing?.plans ?? []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="comp-until" className="block text-xs font-medium">
                  Until (blank = no expiry)
                </label>
                <input
                  id="comp-until"
                  type="date"
                  value={compUntil}
                  onChange={(e) => setCompUntil(e.target.value)}
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="comp-reason" className="block text-xs font-medium">Reason</label>
                <input
                  id="comp-reason"
                  type="text"
                  value={compReason}
                  placeholder="Partner account, beta tester, etc."
                  onChange={(e) => setCompReason(e.target.value)}
                  className="mt-1 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setCompTarget(null)}
                className="rounded-[var(--radius-md)] border border-border px-3 py-2 text-sm hover:bg-[hsl(var(--background-muted))]"
              >
                Cancel
              </button>
              <button
                disabled={busy || !compPlanId}
                onClick={comp}
                className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Grant access
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
