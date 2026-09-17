"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Loader2,
  Check,
  X,
  ArrowLeft,
  Plus,
  DollarSign,
  Calendar,
  Target,
  Package,
} from "lucide-react";
import { PageContainer, PageHeader } from "@/components/layout";
import { useToast } from "@/components/ui/toast";
import { ProgressBar } from "@/components/ui/progress-bar";

interface Suggestion {
  id: string;
  batchId: string;
  type: "new_initiative" | "budget_change" | "date_change" | "target_change" | "product_update";
  targetId: string | null;
  targetLabel: string | null;
  title: string;
  rationale: string;
  current: Record<string, any>;
  proposed: Record<string, any>;
  status: string;
}

const TYPE_META: Record<
  Suggestion["type"],
  { label: string; icon: typeof Plus; color: string }
> = {
  new_initiative: { label: "New Initiative", icon: Plus, color: "text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300" },
  budget_change: { label: "Budget Change", icon: DollarSign, color: "text-amber-600 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300" },
  date_change: { label: "Date Change", icon: Calendar, color: "text-blue-600 bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300" },
  target_change: { label: "Target Change", icon: Target, color: "text-purple-600 bg-purple-100 dark:bg-purple-900/30 dark:text-purple-300" },
  product_update: { label: "Product Update", icon: Package, color: "text-pink-600 bg-pink-100 dark:bg-pink-900/30 dark:text-pink-300" },
};

function formatValue(obj: Record<string, any>): string {
  if (!obj || Object.keys(obj).length === 0) return "—";
  return Object.entries(obj)
    .map(([k, v]) => {
      // Prettify common keys
      if (k === "plannedBudget" || k === "baselineRevenue" || k === "stretchRevenue" || k === "price") {
        return `${labelize(k)}: $${Number(v).toLocaleString()}`;
      }
      if (k === "activationMonth") return `Month: ${v}`;
      return `${labelize(k)}: ${v}`;
    })
    .join(" · ");
}

function labelize(k: string): string {
  return k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

export default function EnhancePlanPage() {
  const router = useRouter();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  const { showToast, dismissToast } = useToast();

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      console.log("[EnhancePlan] Loading suggestions...");
      const res = await fetch("/api/plan/suggestions");
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load suggestions");
        return;
      }
      console.log("[EnhancePlan] Loaded", data.suggestions?.length, "suggestions");
      setSuggestions(data.suggestions || []);
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    console.log("[EnhancePlan] Requesting AI enhancement...");
    const toastId = showToast(
      "This can take up to a minute. The AI is reviewing your whole plan before suggesting changes.",
      { variant: "wait" }
    );
    try {
      const res = await fetch("/api/plan/enhance", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to generate suggestions");
        console.error("[EnhancePlan] Enhance error:", data.error);
        return;
      }
      console.log("[EnhancePlan] Generated batch:", data.batchId, "count:", data.count);
      await loadSuggestions();
    } catch (err: any) {
      setError(err?.message || "Network error");
    } finally {
      dismissToast(toastId);
      setGenerating(false);
    }
  };

  const decide = async (id: string, decision: "accepted" | "rejected") => {
    setActingId(id);
    console.log("[EnhancePlan] Deciding:", id, "->", decision);
    const target = suggestions.find((s) => s.id === id);
    try {
      const res = await fetch(`/api/plan/suggestions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Failed to apply decision", { variant: "error", duration: 5000 });
        return;
      }
      console.log("[EnhancePlan] Decision applied:", decision);
      // Remove the decided suggestion from the list
      setSuggestions((prev) => prev.filter((s) => s.id !== id));

      // Confirm the outcome so it's clear the click did something, and what.
      const label = target?.title || "Suggestion";
      if (decision === "accepted") {
        const verb = target?.type === "new_initiative" ? "added to your plan" : "applied to your plan";
        showToast(`"${label}" ${verb}.`, { variant: "success", duration: 4000 });
      } else {
        showToast(`"${label}" was rejected and won't be applied.`, { variant: "info", duration: 4000 });
      }
    } catch (err: any) {
      showToast(err?.message || "Network error", { variant: "error", duration: 5000 });
    } finally {
      setActingId(null);
    }
  };

  const acceptAll = async () => {
    setApplyingAll(true);
    const count = suggestions.length;
    console.log("[EnhancePlan] Accepting all", count, "suggestions");
    const toastId = showToast("Applying all suggestions to your plan, just a moment...", { variant: "wait" });
    try {
      for (const s of suggestions) {
        await fetch(`/api/plan/suggestions/${s.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "accepted" }),
        });
      }
      await loadSuggestions();
      showToast(`${count} suggestion${count !== 1 ? "s" : ""} added to your plan.`, { variant: "success", duration: 4000 });
    } finally {
      dismissToast(toastId);
      setApplyingAll(false);
    }
  };

  const rejectAll = async () => {
    setApplyingAll(true);
    const count = suggestions.length;
    console.log("[EnhancePlan] Rejecting all", count, "suggestions");
    try {
      for (const s of suggestions) {
        await fetch(`/api/plan/suggestions/${s.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "rejected" }),
        });
      }
      await loadSuggestions();
      showToast(`${count} suggestion${count !== 1 ? "s" : ""} rejected.`, { variant: "info", duration: 4000 });
    } finally {
      setApplyingAll(false);
    }
  };

  return (
    <PageContainer>
      <button
        onClick={() => router.push("/year-at-a-glance")}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Dashboard
      </button>

      <PageHeader
        title="Enhance Your Plan"
        description="AI-recommended improvements to your current plan. You approve each one."
      />

      {error && (
        <div className="mb-4 rounded-[var(--radius-md)] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        </div>
      ) : suggestions.length === 0 ? (
        /* Empty state — trigger generation */
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[hsl(var(--primary)/0.1)]">
            <Sparkles className="h-6 w-6 text-[hsl(var(--primary))]" />
          </div>
          <h3 className="mt-4 text-base font-semibold">Get AI recommendations</h3>
          <p className="mt-1.5 max-w-md text-sm text-[hsl(var(--foreground-muted))]">
            The AI will review your current plan and suggest improvements — new initiatives, budget tweaks, timing changes, and more. Nothing changes until you approve it.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="mt-6 inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing your plan…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Get Recommendations
              </>
            )}
          </button>
          <ProgressBar active={generating} estimatedMs={30000} className="mt-4 max-w-xs" />
        </div>
      ) : (
        /* Review list */
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[hsl(var(--foreground-muted))]">
              {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""} to review
            </p>
            <div className="flex gap-2">
              <button
                onClick={rejectAll}
                disabled={applyingAll}
                className="rounded-[var(--radius-md)] bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                Reject All
              </button>
              <button
                onClick={acceptAll}
                disabled={applyingAll}
                className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {applyingAll ? "Applying…" : "Accept All"}
              </button>
            </div>
          </div>
          <ProgressBar active={applyingAll} estimatedMs={suggestions.length * 800} />

          {suggestions.map((s) => {
            const meta = TYPE_META[s.type];
            const Icon = meta.icon;
            const isChange = s.type !== "new_initiative";
            return (
              <div key={s.id} className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
                          {meta.label}
                        </span>
                        {s.targetLabel && (
                          <span className="text-xs text-[hsl(var(--foreground-muted))]">
                            {s.targetLabel}
                          </span>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm font-medium">{s.title}</p>
                      {s.rationale && (
                        <p className="mt-0.5 text-xs text-[hsl(var(--foreground-muted))]">{s.rationale}</p>
                      )}

                      {/* Before → After for change types */}
                      {isChange && (
                        <div className="mt-3 flex items-center gap-2 text-xs">
                          <span className="rounded bg-[hsl(var(--background-muted))] px-2 py-1 text-[hsl(var(--foreground-muted))] line-through">
                            {formatValue(s.current)}
                          </span>
                          <span className="text-[hsl(var(--foreground-muted))]">→</span>
                          <span className="rounded bg-[hsl(var(--primary)/0.1)] px-2 py-1 font-medium text-[hsl(var(--primary))]">
                            {formatValue(s.proposed)}
                          </span>
                        </div>
                      )}

                      {/* New initiative details */}
                      {s.type === "new_initiative" && (
                        <div className="mt-3 rounded bg-[hsl(var(--background-muted))] px-3 py-2 text-xs text-[hsl(var(--foreground-muted))]">
                          {formatValue(s.proposed)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => decide(s.id, "accepted")}
                      disabled={actingId === s.id}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      title="Accept"
                    >
                      {actingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Accept
                    </button>
                    <button
                      onClick={() => decide(s.id, "rejected")}
                      disabled={actingId === s.id}
                      className="inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                      title="Reject"
                    >
                      <X className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
