"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Trash2,
  Save,
  ChevronDown,
  ChevronRight,
  Rocket,
  X,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { initiativeTypeService } from "@/services/initiative-type.service";
import type {
  InitiativeType,
  ConversionBenchmarks,
  DifficultyDimensions,
  DifficultyLevel,
} from "@/types";

/* ------------------------------------------------------------------
   Constants
   ------------------------------------------------------------------ */

const STORAGE_KEY = "sam-flow-admin-initiative-types";

const TIER_CONFIG = {
  1: { label: "Core", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" },
  2: { label: "Expanded", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" },
  3: { label: "Specialized", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" },
} as const;

type TierFilter = "all" | 1 | 2 | 3;

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function getDifficultyColor(value: number): string {
  if (value <= 3) return "bg-green-500";
  if (value <= 6) return "bg-yellow-500";
  return "bg-red-500";
}

function generateId(): string {
  return `inittype-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function saveToLocalStorage(types: InitiativeType[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(types));
  } catch {
    // storage full or unavailable
  }
}

/* ------------------------------------------------------------------
   Sub-Components
   ------------------------------------------------------------------ */

function TierBadge({ tier }: { tier: 1 | 2 | 3 }) {
  const config = TIER_CONFIG[tier];
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", config.color)}>
      {config.label}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        active
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
          : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
      )}
    >
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function DifficultyBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[hsl(var(--foreground-muted))] w-16 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-[hsl(var(--foreground-muted)/0.15)] overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", getDifficultyColor(value))}
          style={{ width: `${(value / 10) * 100}%` }}
        />
      </div>
      <span className="text-xs font-medium text-[hsl(var(--foreground))] w-4 text-right">{value}</span>
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--foreground-muted)/0.05)] transition-colors"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {title}
      </button>
      {open && <div className="px-4 pb-4 pt-2 border-t border-border">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------
   Edit / Add Form
   ------------------------------------------------------------------ */

interface FormData {
  name: string;
  channel: string;
  description: string;
  tier: 1 | 2 | 3;
  isActive: boolean;
  benchmarks: ConversionBenchmarks;
  difficulty: DifficultyDimensions;
  aiContext: {
    description: string;
    sizingGuidance: string;
    recommendationWeights: {
      budget: number;
      timeframe: number;
      teamSize: number;
      assets: number;
    };
  };
}

function getEmptyForm(): FormData {
  return {
    name: "",
    channel: "",
    description: "",
    tier: 1,
    isActive: true,
    benchmarks: {},
    difficulty: {
      effortToImplement: 5 as DifficultyLevel,
      skillExpertiseRequired: 5 as DifficultyLevel,
      timeToResults: 5 as DifficultyLevel,
      costToRun: 5 as DifficultyLevel,
    },
    aiContext: {
      description: "",
      sizingGuidance: "",
      recommendationWeights: { budget: 0.5, timeframe: 0.5, teamSize: 0.5, assets: 0.5 },
    },
  };
}

function formFromType(type: InitiativeType): FormData {
  return {
    name: type.name,
    channel: type.channel,
    description: type.description,
    tier: type.tier,
    isActive: type.isActive,
    benchmarks: { ...type.benchmarks },
    difficulty: { ...type.difficulty },
    aiContext: {
      description: type.aiContext.description,
      sizingGuidance: type.aiContext.sizingGuidance,
      recommendationWeights: {
        budget: type.aiContext.recommendationWeights?.budget ?? 0.5,
        timeframe: type.aiContext.recommendationWeights?.timeframe ?? 0.5,
        teamSize: type.aiContext.recommendationWeights?.teamSize ?? 0.5,
        assets: type.aiContext.recommendationWeights?.assets ?? 0.5,
      },
    },
  };
}

function InitiativeForm({
  initial,
  onSave,
  onCancel,
  isNew,
}: {
  initial: FormData;
  onSave: (data: FormData) => void;
  onCancel: () => void;
  isNew: boolean;
}) {
  const [form, setForm] = useState<FormData>(initial);
  const [newMetricName, setNewMetricName] = useState("");

  function updateField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateDifficulty(key: keyof DifficultyDimensions, value: number) {
    const clamped = Math.min(10, Math.max(1, value)) as DifficultyLevel;
    setForm((prev) => ({ ...prev, difficulty: { ...prev.difficulty, [key]: clamped } }));
  }

  function updateBenchmark(metric: string, scenario: "conservative" | "moderate" | "aggressive", value: number) {
    setForm((prev) => ({
      ...prev,
      benchmarks: {
        ...prev.benchmarks,
        [metric]: { ...prev.benchmarks[metric], [scenario]: value },
      },
    }));
  }

  function addMetric() {
    if (!newMetricName.trim()) return;
    const key = newMetricName.trim().toLowerCase().replace(/\s+/g, "_");
    if (form.benchmarks[key]) return;
    setForm((prev) => ({
      ...prev,
      benchmarks: { ...prev.benchmarks, [key]: { conservative: 0, moderate: 0, aggressive: 0 } },
    }));
    setNewMetricName("");
  }

  function removeMetric(key: string) {
    setForm((prev) => {
      const updated = { ...prev.benchmarks };
      delete updated[key];
      return { ...prev, benchmarks: updated };
    });
  }

  function updateWeight(key: "budget" | "timeframe" | "teamSize" | "assets", value: number) {
    const clamped = Math.min(1, Math.max(0, value));
    setForm((prev) => ({
      ...prev,
      aiContext: {
        ...prev.aiContext,
        recommendationWeights: { ...prev.aiContext.recommendationWeights, [key]: clamped },
      },
    }));
  }

  return (
    <div className="border-t border-border bg-card/50 px-4 py-5 sm:px-6 space-y-4">
      {/* Basic Info */}
      <CollapsibleSection title="Basic Info" defaultOpen={isNew}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                placeholder="e.g. Webinar"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Channel</label>
              <input
                type="text"
                value={form.channel}
                onChange={(e) => updateField("channel", e.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                placeholder="e.g. webinar"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              rows={2}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-none"
              placeholder="What is this initiative type?"
            />
          </div>
        </div>
      </CollapsibleSection>

      {/* Benchmarks */}
      <CollapsibleSection title="Benchmarks">
        <div className="space-y-3">
          {Object.keys(form.benchmarks).length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3 text-xs font-medium text-[hsl(var(--foreground-muted))]">Metric</th>
                    <th className="text-center py-2 px-2 text-xs font-medium text-[hsl(var(--foreground-muted))]">Conservative</th>
                    <th className="text-center py-2 px-2 text-xs font-medium text-[hsl(var(--foreground-muted))]">Moderate</th>
                    <th className="text-center py-2 px-2 text-xs font-medium text-[hsl(var(--foreground-muted))]">Aggressive</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(form.benchmarks).map(([metric, values]) => (
                    <tr key={metric} className="border-b border-border/50">
                      <td className="py-2 pr-3 text-xs text-[hsl(var(--foreground))]">{metric.replace(/_/g, " ")}</td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="0.01"
                          value={values.conservative}
                          onChange={(e) => updateBenchmark(metric, "conservative", parseFloat(e.target.value) || 0)}
                          className="w-20 mx-auto block rounded border border-border bg-card px-2 py-1 text-xs text-center text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="0.01"
                          value={values.moderate}
                          onChange={(e) => updateBenchmark(metric, "moderate", parseFloat(e.target.value) || 0)}
                          className="w-20 mx-auto block rounded border border-border bg-card px-2 py-1 text-xs text-center text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                        />
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="number"
                          step="0.01"
                          value={values.aggressive}
                          onChange={(e) => updateBenchmark(metric, "aggressive", parseFloat(e.target.value) || 0)}
                          className="w-20 mx-auto block rounded border border-border bg-card px-2 py-1 text-xs text-center text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                        />
                      </td>
                      <td className="py-2 pl-2">
                        <button onClick={() => removeMetric(metric)} className="text-[hsl(var(--foreground-muted))] hover:text-red-500 transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={newMetricName}
              onChange={(e) => setNewMetricName(e.target.value)}
              placeholder="New metric name"
              className="flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMetric(); } }}
            />
            <button onClick={addMetric} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] transition-colors">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
        </div>
      </CollapsibleSection>

      {/* Difficulty */}
      <CollapsibleSection title="Difficulty">
        <div className="space-y-3">
          {(["effortToImplement", "skillExpertiseRequired", "timeToResults", "costToRun"] as const).map((key) => {
            const labels: Record<string, string> = {
              effortToImplement: "Effort",
              skillExpertiseRequired: "Skill",
              timeToResults: "Time",
              costToRun: "Cost",
            };
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="text-xs text-[hsl(var(--foreground-muted))] w-12 shrink-0">{labels[key]}</span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={form.difficulty[key]}
                  onChange={(e) => updateDifficulty(key, parseInt(e.target.value))}
                  className="flex-1 h-2 rounded-full appearance-none bg-[hsl(var(--foreground-muted)/0.15)] cursor-pointer accent-[hsl(var(--primary))]"
                />
                <span className={cn(
                  "text-xs font-medium w-5 text-center rounded px-1 py-0.5 text-white",
                  getDifficultyColor(form.difficulty[key])
                )}>
                  {form.difficulty[key]}
                </span>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>

      {/* AI Context */}
      <CollapsibleSection title="AI Context">
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Description (when to recommend)</label>
            <textarea
              value={form.aiContext.description}
              onChange={(e) => setForm((prev) => ({ ...prev, aiContext: { ...prev.aiContext, description: e.target.value } }))}
              rows={2}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Sizing Guidance</label>
            <textarea
              value={form.aiContext.sizingGuidance}
              onChange={(e) => setForm((prev) => ({ ...prev, aiContext: { ...prev.aiContext, sizingGuidance: e.target.value } }))}
              rows={2}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] resize-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">Recommendation Weights (0–1)</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(["budget", "timeframe", "teamSize", "assets"] as const).map((key) => (
                <div key={key}>
                  <span className="block text-xs text-[hsl(var(--foreground-muted))] mb-1 capitalize">{key}</span>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={1}
                    value={form.aiContext.recommendationWeights[key]}
                    onChange={(e) => updateWeight(key, parseFloat(e.target.value) || 0)}
                    className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-center text-[hsl(var(--foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--primary))]"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Tier & Status */}
      <CollapsibleSection title="Tier & Status" defaultOpen={isNew}>
        <div className="flex flex-wrap gap-6">
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-2">Tier</label>
            <div className="flex gap-2">
              {([1, 2, 3] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => updateField("tier", t)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium border transition-colors",
                    form.tier === t
                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]"
                      : "border-border text-[hsl(var(--foreground-muted))] hover:border-[hsl(var(--foreground-muted))]"
                  )}
                >
                  Tier {t} — {TIER_CONFIG[t].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-2">Status</label>
            <button
              type="button"
              onClick={() => updateField("isActive", !form.isActive)}
              className="flex items-center gap-2 text-sm"
            >
              {form.isActive ? (
                <ToggleRight className="h-6 w-6 text-green-500" />
              ) : (
                <ToggleLeft className="h-6 w-6 text-[hsl(var(--foreground-muted))]" />
              )}
              <span className={cn("text-sm", form.isActive ? "text-green-600 dark:text-green-400" : "text-[hsl(var(--foreground-muted))]")}>
                {form.isActive ? "Active" : "Inactive"}
              </span>
            </button>
          </div>
        </div>
      </CollapsibleSection>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={() => onSave(form)}
          disabled={!form.name.trim() || !form.channel.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="h-3.5 w-3.5" />
          {isNew ? "Create Initiative Type" : "Save Changes"}
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-[hsl(var(--foreground-muted))] hover:bg-card transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Main Component
   ------------------------------------------------------------------ */

export function InitiativeLibraryManagement() {
  const [types, setTypes] = useState<InitiativeType[]>([]);
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load initiative types on mount
  useEffect(() => {
    async function load() {
      try {
        const data = await initiativeTypeService.getAllInitiativeTypes();
        // Also include inactive types for admin
        const allData = await loadAllIncludingInactive();
        setTypes(allData.length > 0 ? allData : data);
      } catch {
        setTypes([]);
      } finally {
        setLoading(false);
        setMounted(true);
      }
    }
    load();
  }, []);

  // Persist to localStorage whenever types change (after mount)
  useEffect(() => {
    if (mounted && types.length > 0) {
      saveToLocalStorage(types);
    }
  }, [types, mounted]);

  const filteredTypes = types.filter((t) => {
    if (tierFilter === "all") return true;
    return t.tier === tierFilter;
  });

  const tierCounts = {
    all: types.length,
    1: types.filter((t) => t.tier === 1).length,
    2: types.filter((t) => t.tier === 2).length,
    3: types.filter((t) => t.tier === 3).length,
  };

  const handleSave = useCallback(async (id: string, data: FormData) => {
    try {
      await initiativeTypeService.updateInitiativeType(id, {
        name: data.name,
        description: data.description,
        benchmarks: data.benchmarks,
        difficulty: data.difficulty,
        aiContext: {
          description: data.aiContext.description,
          sizingGuidance: data.aiContext.sizingGuidance,
          recommendationWeights: data.aiContext.recommendationWeights,
        },
        isActive: data.isActive,
      });
      // Update local state
      setTypes((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, name: data.name, channel: data.channel, description: data.description, tier: data.tier, isActive: data.isActive, benchmarks: data.benchmarks, difficulty: data.difficulty, aiContext: { description: data.aiContext.description, sizingGuidance: data.aiContext.sizingGuidance, recommendationWeights: data.aiContext.recommendationWeights }, updatedAt: new Date() }
            : t
        )
      );
      setExpandedId(null);
    } catch (err) {
      console.error("Failed to save:", err);
    }
  }, []);

  const handleCreate = useCallback(async (data: FormData) => {
    try {
      const created = await initiativeTypeService.createInitiativeType({
        name: data.name,
        channel: data.channel,
        description: data.description,
        benchmarks: data.benchmarks,
        projectTemplate: { tasks: [], totalEstimatedHours: 0 },
        difficulty: data.difficulty,
        aiContext: {
          description: data.aiContext.description,
          sizingGuidance: data.aiContext.sizingGuidance,
          recommendationWeights: data.aiContext.recommendationWeights,
        },
        tier: data.tier,
      });
      setTypes((prev) => [...prev, created]);
      setShowAddForm(false);
    } catch (err) {
      console.error("Failed to create:", err);
    }
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    try {
      // Remove from service (in-memory mock)
      await initiativeTypeService.updateInitiativeType(id, { isActive: false });
      setTypes((prev) => prev.filter((t) => t.id !== id));
      setDeleteConfirmId(null);
      if (expandedId === id) setExpandedId(null);
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  }, [expandedId]);

  const handleToggleActive = useCallback(async (id: string, isActive: boolean) => {
    try {
      await initiativeTypeService.updateInitiativeType(id, { isActive });
      setTypes((prev) =>
        prev.map((t) => (t.id === id ? { ...t, isActive, updatedAt: new Date() } : t))
      );
    } catch (err) {
      console.error("Failed to toggle:", err);
    }
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Rocket className="h-8 w-8 animate-pulse text-[hsl(var(--foreground-muted))]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tier Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {(["all", 1, 2, 3] as TierFilter[]).map((filter) => {
          const label = filter === "all" ? "All" : `Tier ${filter} — ${TIER_CONFIG[filter].label}`;
          const count = tierCounts[filter];
          return (
            <button
              key={String(filter)}
              onClick={() => setTierFilter(filter)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium border transition-colors",
                tierFilter === filter
                  ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]"
                  : "border-border text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--foreground-muted))]"
              )}
            >
              {label}
              <span className="text-xs opacity-70">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Initiative Type List */}
      <div className="space-y-3">
        {filteredTypes.map((type) => (
          <div
            key={type.id}
            className={cn(
              "rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden transition-shadow",
              expandedId === type.id && "shadow-md"
            )}
          >
            {/* Card Header */}
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
              {/* Name + Channel */}
              <button
                onClick={() => setExpandedId(expandedId === type.id ? null : type.id)}
                className="flex-1 text-left min-w-0"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">{type.name}</p>
                  <TierBadge tier={type.tier} />
                  <StatusBadge active={type.isActive} />
                </div>
                <p className="text-xs text-[hsl(var(--foreground-muted))] mt-0.5">
                  Channel: {type.channel}
                </p>
              </button>

              {/* Difficulty mini bars (hidden on mobile) */}
              <div className="hidden md:flex flex-col gap-1 w-40 shrink-0">
                <DifficultyBar value={type.difficulty.effortToImplement} label="Effort" />
                <DifficultyBar value={type.difficulty.costToRun} label="Cost" />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleActive(type.id, !type.isActive);
                  }}
                  className="rounded p-1.5 text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] transition-colors"
                  title={type.isActive ? "Deactivate" : "Activate"}
                >
                  {type.isActive ? (
                    <ToggleRight className="h-4 w-4 text-green-500" />
                  ) : (
                    <ToggleLeft className="h-4 w-4" />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteConfirmId(deleteConfirmId === type.id ? null : type.id);
                  }}
                  className="rounded p-1.5 text-[hsl(var(--foreground-muted))] hover:text-red-500 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Delete Confirmation */}
            {deleteConfirmId === type.id && (
              <div className="border-t border-border bg-red-50 dark:bg-red-900/10 px-6 py-3 flex items-center justify-between">
                <span className="text-sm text-red-600 dark:text-red-400">
                  Permanently delete &quot;{type.name}&quot;?
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDelete(type.id)}
                    className="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors"
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="rounded-md border border-border px-3 py-1 text-xs font-medium text-[hsl(var(--foreground-muted))] hover:bg-card transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Inline Edit Form */}
            {expandedId === type.id && (
              <InitiativeForm
                initial={formFromType(type)}
                onSave={(data) => handleSave(type.id, data)}
                onCancel={() => setExpandedId(null)}
                isNew={false}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add New Type */}
      {showAddForm ? (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 sm:px-6 border-b border-border">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Add New Initiative Type</h3>
          </div>
          <InitiativeForm
            initial={getEmptyForm()}
            onSave={handleCreate}
            onCancel={() => setShowAddForm(false)}
            isNew={true}
          />
        </div>
      ) : (
        <button
          onClick={() => { setShowAddForm(true); setExpandedId(null); }}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-4 py-2.5 text-sm font-medium text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--foreground-muted))] transition-colors w-full justify-center"
        >
          <Plus className="h-4 w-4" />
          Add Initiative Type
        </button>
      )}

      {/* Empty state */}
      {filteredTypes.length === 0 && !showAddForm && (
        <div className="text-center py-8">
          <Rocket className="h-8 w-8 mx-auto text-[hsl(var(--foreground-muted))] mb-2" />
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            No initiative types found for this filter.
          </p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------
   Helper: Load all types including inactive
   ------------------------------------------------------------------ */

async function loadAllIncludingInactive(): Promise<InitiativeType[]> {
  // The service filters out inactive. We need a workaround for admin.
  // Try localStorage first, then fall back to service.
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((t: any) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        }));
      }
    }
  } catch {
    // fall through
  }
  return [];
}
