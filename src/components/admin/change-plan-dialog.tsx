"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpCircle, Loader2, X } from "lucide-react";
import { formatMoney } from "@/lib/format-money";

/**
 * "Change plan" on the admin company page (super admins).
 *
 * Moves the company's live Stripe subscription on the client's request,
 * through the same logic as the owner's own Settings change. It CHARGES the
 * customer, so it never fires from the first click: the admin picks a plan,
 * then a warning step spells out what will happen and asks them to type the
 * company name before the change is sent.
 */

interface PlanOption {
  id: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number;
  cycles: ("monthly" | "annual")[];
}

interface Current {
  planId: string | null;
  billingCycle: string | null;
  pendingPlanId: string | null;
  isComped: boolean;
  isPaused: boolean;
  live: boolean;
}

const ERROR_TEXT: Record<string, string> = {
  comped_account: "This company is comped, so there is no Stripe subscription to change.",
  no_subscription: "This company has no Stripe subscription. They need to buy a plan through checkout first.",
  no_live_subscription: "This company's subscription has ended. They need to buy a new plan through checkout.",
  account_paused: "This account is paused. Resume it before changing the plan.",
  price_not_found: "That plan has no Stripe price for this billing cycle. Sync plans in Subscriptions first.",
  no_change: "That is already the company's plan and billing cycle.",
  current_price_unknown: "Stripe's current price for this subscription couldn't be read, so nothing was changed.",
  billing_disabled: "Billing is switched off.",
};

export function ChangePlanButton({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<Current | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [planId, setPlanId] = useState("");
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [typed, setTyped] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/companies/${companyId}/change-plan`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { current: Current | null; plans: PlanOption[]; error?: string }) => {
        if (cancelled) return;
        if (json.error) { setError(json.error); return; }
        setCurrent(json.current);
        setPlans(json.plans ?? []);
        setPlanId(json.current?.planId ?? json.plans?.[0]?.id ?? "");
        setCycle(json.current?.billingCycle === "annual" ? "annual" : "monthly");
      })
      .catch(() => { if (!cancelled) setError("Could not load plans."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, companyId]);

  const close = () => {
    setOpen(false);
    setStep("pick");
    setTyped("");
    setError(null);
    setDone(null);
  };

  const target = plans.find((p) => p.id === planId) ?? null;
  const currentPlan = plans.find((p) => p.id === current?.planId) ?? null;
  const priceOf = (p: PlanOption | null, c: string | null) =>
    p ? (c === "annual" ? p.annualPrice : p.monthlyPrice) : null;
  const targetPrice = priceOf(target, cycle);
  const currentPrice = priceOf(currentPlan, current?.billingCycle ?? null);
  const isDowngrade = targetPrice !== null && currentPrice !== null && cycle === current?.billingCycle && targetPrice < currentPrice;
  const unchanged = planId === current?.planId && cycle === current?.billingCycle;
  const blocked = !current || !current.live || current.isComped || current.isPaused;

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/companies/${companyId}/change-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, billingCycle: cycle, confirm: true }),
      });
      const json: { applied?: string; effectiveAt?: string | null; error?: string; message?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.message || ERROR_TEXT[json.error ?? ""] || json.error || "The plan could not be changed.");
        setStep("pick");
        return;
      }
      setDone(
        json.applied === "period_end"
          ? `Downgrade scheduled${json.effectiveAt ? ` for ${new Date(json.effectiveAt).toLocaleDateString()}` : " for the end of the billing period"}.`
          : "Plan changed. The customer was charged the prorated difference."
      );
    } catch {
      setError("Network error. Nothing was changed.");
      setStep("pick");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-card px-4 py-2 text-sm font-medium hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]"
      >
        <ArrowUpCircle className="h-4 w-4" aria-hidden="true" />
        Change plan
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={submitting ? undefined : close} aria-hidden="true" />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-plan-title"
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-[var(--radius-lg)] border border-border bg-card p-6 shadow-lg"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="change-plan-title" className="text-lg font-semibold">
                Change plan for {companyName}
              </h2>
              <button type="button" onClick={close} disabled={submitting} aria-label="Close" className="rounded p-1 text-[hsl(var(--foreground-muted))] hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {loading ? (
              <p className="flex items-center gap-2 text-sm text-[hsl(var(--foreground-muted))]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading plans…
              </p>
            ) : done ? (
              <>
                <p role="status" className="rounded-[var(--radius-md)] bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">
                  {done}
                </p>
                <div className="flex justify-end">
                  <button type="button" onClick={() => window.location.reload()} className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white">
                    Done
                  </button>
                </div>
              </>
            ) : step === "pick" ? (
              <>
                <p className="text-sm text-[hsl(var(--foreground-muted))]">
                  Current: <strong className="text-foreground">{currentPlan?.name ?? "Unknown"}</strong>
                  {current?.billingCycle ? `, ${current.billingCycle}` : ""}
                  {currentPrice !== null ? ` (${formatMoney(currentPrice)})` : ""}
                </p>
                {blocked && current && (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    {current.isComped
                      ? ERROR_TEXT.comped_account
                      : current.isPaused
                        ? ERROR_TEXT.account_paused
                        : ERROR_TEXT.no_live_subscription}
                  </p>
                )}
                {!current && <p className="text-sm text-amber-700 dark:text-amber-300">{ERROR_TEXT.no_subscription}</p>}
                <div className="grid grid-cols-2 gap-3">
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">New plan</span>
                    <select value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={blocked} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-2 py-2">
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-medium">Billing</span>
                    <select value={cycle} onChange={(e) => setCycle(e.target.value as "monthly" | "annual")} disabled={blocked} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-2 py-2">
                      {(target?.cycles ?? ["monthly", "annual"]).map((c) => (
                        <option key={c} value={c}>{c === "annual" ? "Annual" : "Monthly"}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {target && targetPrice !== null && (
                  <p className="text-sm">New price: <strong>{formatMoney(targetPrice)}</strong> / {cycle === "annual" ? "year" : "month"}</p>
                )}
                {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={close} className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm">Cancel</button>
                  <button
                    type="button"
                    disabled={blocked || unchanged || !target || !target.cycles.includes(cycle)}
                    onClick={() => { setStep("confirm"); setTyped(""); }}
                    className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-2 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div className="space-y-1.5">
                    <p className="font-semibold">Are you sure? This changes a real Stripe subscription.</p>
                    <p>
                      {currentPlan?.name ?? "Current plan"} ({current?.billingCycle}) → <strong>{target?.name}</strong> ({cycle})
                    </p>
                    {isDowngrade ? (
                      <p>This is a downgrade. It takes effect at the end of the customer&apos;s current billing period.</p>
                    ) : (
                      <p>
                        This applies <strong>immediately</strong> and <strong>charges the customer&apos;s card now</strong> for the
                        prorated difference. Only do this if the client has asked for it.
                      </p>
                    )}
                    <p>It can&apos;t be undone from here; reversing it is another plan change.</p>
                  </div>
                </div>
                <label className="block space-y-1 text-sm">
                  <span>Type <strong>{companyName}</strong> to confirm</span>
                  <input value={typed} onChange={(e) => setTyped(e.target.value)} className="w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2" autoFocus />
                </label>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setStep("pick")} disabled={submitting} className="rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm">Back</button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting || typed.trim() !== companyName.trim()}
                    className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isDowngrade ? "Schedule downgrade" : "Change plan and charge"}
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
