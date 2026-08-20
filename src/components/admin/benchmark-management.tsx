"use client";

import { useEffect, useState } from "react";
import {
  BarChart3,
  Plus,
  ChevronDown,
  ChevronUp,
  Save,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { benchmarkService } from "@/services/benchmark.service";
import { initiativeTypeService } from "@/services/initiative-type.service";
import type {
  Benchmark,
  BenchmarkSource,
  InitiativeType,
} from "@/types";

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function getSourceBadgeClasses(source: BenchmarkSource): string {
  switch (source) {
    case "first_party":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "published":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "partner_shared":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "industry_report":
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}

function getSourceLabel(source: BenchmarkSource): string {
  switch (source) {
    case "first_party":
      return "First Party";
    case "published":
      return "Published";
    case "partner_shared":
      return "Partner Shared";
    case "industry_report":
      return "Industry Report";
    default:
      return source;
  }
}

function getMetricName(benchmark: Benchmark): string {
  if ("fieldName" in benchmark) {
    return benchmark.fieldName.replace(/_/g, " ");
  }
  if ("costMetric" in benchmark) {
    return benchmark.costMetric.replace(/_/g, " ");
  }
  return "Unknown";
}

function formatValue(value: number): string {
  if (value < 1) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return `$${value.toFixed(2)}`;
}

/* ------------------------------------------------------------------
   Component
   ------------------------------------------------------------------ */

export function BenchmarkManagement() {
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [initiativeTypes, setInitiativeTypes] = useState<InitiativeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [benchData, typeData] = await Promise.all([
          benchmarkService.getAllBenchmarks(),
          initiativeTypeService.getAllInitiativeTypes(),
        ]);
        setBenchmarks(benchData);
        setInitiativeTypes(typeData);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function getInitiativeTypeName(id: string): string {
    const type = initiativeTypes.find((t) => t.id === id);
    return type?.name ?? id;
  }

  const sourceCounts = benchmarks.reduce(
    (acc, b) => {
      acc[b.source] = (acc[b.source] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  function handleSaveEdit(id: string, updates: { conservative: number; moderate: number; aggressive: number; source: BenchmarkSource }) {
    setBenchmarks((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, data: { conservative: updates.conservative, moderate: updates.moderate, aggressive: updates.aggressive }, source: updates.source }
          : b
      )
    );
    setExpandedId(null);
  }

  function handleAddBenchmark(newBenchmark: {
    initiativeTypeId: string;
    metricName: string;
    conservative: number;
    moderate: number;
    aggressive: number;
    source: BenchmarkSource;
  }) {
    const created: Benchmark = {
      id: `bench-${Date.now()}`,
      initiativeTypeId: newBenchmark.initiativeTypeId,
      fieldName: newBenchmark.metricName,
      fieldDescription: "",
      data: {
        conservative: newBenchmark.conservative,
        moderate: newBenchmark.moderate,
        aggressive: newBenchmark.aggressive,
      },
      source: newBenchmark.source,
      sourceDetails: "",
      initiativeTypeVersion: "2026-Q1",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setBenchmarks((prev) => [...prev, created]);
    setShowAddForm(false);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          Loading benchmarks…
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          icon={BarChart3}
          label="Total Benchmarks"
          value={benchmarks.length}
          color="purple"
        />
        <SummaryCard
          icon={BarChart3}
          label="First Party"
          value={sourceCounts["first_party"] || 0}
          color="green"
        />
        <SummaryCard
          icon={BarChart3}
          label="Published"
          value={sourceCounts["published"] || 0}
          color="blue"
        />
        <SummaryCard
          icon={BarChart3}
          label="Partner Shared"
          value={sourceCounts["partner_shared"] || 0}
          color="amber"
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Add Benchmark
        </button>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <AddBenchmarkForm
          initiativeTypes={initiativeTypes}
          onAdd={handleAddBenchmark}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border bg-card">
                <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                  Initiative Type
                </th>
                <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                  Metric Name
                </th>
                <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                  Conservative
                </th>
                <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                  Moderate
                </th>
                <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                  Aggressive
                </th>
                <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                  Source
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {benchmarks.map((benchmark) => {
                const isExpanded = expandedId === benchmark.id;
                return (
                  <BenchmarkRow
                    key={benchmark.id}
                    benchmark={benchmark}
                    initiativeTypeName={getInitiativeTypeName(benchmark.initiativeTypeId)}
                    isExpanded={isExpanded}
                    onToggleExpand={() =>
                      setExpandedId(isExpanded ? null : benchmark.id)
                    }
                    onSave={(updates) => handleSaveEdit(benchmark.id, updates)}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Summary Card
   ------------------------------------------------------------------ */

interface SummaryCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  color: "purple" | "green" | "blue" | "amber";
}

function SummaryCard({ icon: Icon, label, value, color }: SummaryCardProps) {
  const colorMap = {
    purple: "bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400",
    green: "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400",
    blue: "bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400",
    amber: "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400",
  };

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-10 w-10 items-center justify-center rounded-lg", colorMap[color])}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">
            {label}
          </p>
          <p className="text-xl font-bold text-[hsl(var(--foreground))]">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Benchmark Row
   ------------------------------------------------------------------ */

interface BenchmarkRowProps {
  benchmark: Benchmark;
  initiativeTypeName: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSave: (updates: { conservative: number; moderate: number; aggressive: number; source: BenchmarkSource }) => void;
}

function BenchmarkRow({
  benchmark,
  initiativeTypeName,
  isExpanded,
  onToggleExpand,
  onSave,
}: BenchmarkRowProps) {
  const [editConservative, setEditConservative] = useState(benchmark.data.conservative.toString());
  const [editModerate, setEditModerate] = useState(benchmark.data.moderate.toString());
  const [editAggressive, setEditAggressive] = useState(benchmark.data.aggressive.toString());
  const [editSource, setEditSource] = useState<BenchmarkSource>(benchmark.source);

  function handleSave() {
    onSave({
      conservative: parseFloat(editConservative) || 0,
      moderate: parseFloat(editModerate) || 0,
      aggressive: parseFloat(editAggressive) || 0,
      source: editSource,
    });
  }

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-[hsl(var(--background))] transition-colors"
        onClick={onToggleExpand}
      >
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <span className="font-medium text-[hsl(var(--foreground))]">
              {initiativeTypeName}
            </span>
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5 text-[hsl(var(--foreground-muted))]" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-[hsl(var(--foreground-muted))]" />
            )}
          </div>
        </td>
        <td className="px-4 py-3 text-[hsl(var(--foreground))] capitalize">
          {getMetricName(benchmark)}
        </td>
        <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">
          {formatValue(benchmark.data.conservative)}
        </td>
        <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">
          {formatValue(benchmark.data.moderate)}
        </td>
        <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">
          {formatValue(benchmark.data.aggressive)}
        </td>
        <td className="px-4 py-3">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
              getSourceBadgeClasses(benchmark.source)
            )}
          >
            {getSourceLabel(benchmark.source)}
          </span>
        </td>
      </tr>

      {/* Inline Edit Form */}
      {isExpanded && (
        <tr>
          <td colSpan={6} className="bg-[hsl(var(--background))] px-4 py-4">
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">
                Edit Benchmark
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
                    Conservative
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={editConservative}
                    onChange={(e) => setEditConservative(e.target.value)}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
                    Moderate
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={editModerate}
                    onChange={(e) => setEditModerate(e.target.value)}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
                    Aggressive
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={editAggressive}
                    onChange={(e) => setEditAggressive(e.target.value)}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
                    Source
                  </label>
                  <select
                    value={editSource}
                    onChange={(e) => setEditSource(e.target.value as BenchmarkSource)}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                  >
                    <option value="first_party">First Party</option>
                    <option value="published">Published</option>
                    <option value="partner_shared">Partner Shared</option>
                    <option value="industry_report">Industry Report</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSave}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
                >
                  <Save className="h-3.5 w-3.5" />
                  Save
                </button>
                <button
                  onClick={onToggleExpand}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ------------------------------------------------------------------
   Add Benchmark Form
   ------------------------------------------------------------------ */

interface AddBenchmarkFormProps {
  initiativeTypes: InitiativeType[];
  onAdd: (data: {
    initiativeTypeId: string;
    metricName: string;
    conservative: number;
    moderate: number;
    aggressive: number;
    source: BenchmarkSource;
  }) => void;
  onCancel: () => void;
}

function AddBenchmarkForm({ initiativeTypes, onAdd, onCancel }: AddBenchmarkFormProps) {
  const [initiativeTypeId, setInitiativeTypeId] = useState(initiativeTypes[0]?.id ?? "");
  const [metricName, setMetricName] = useState("");
  const [conservative, setConservative] = useState("");
  const [moderate, setModerate] = useState("");
  const [aggressive, setAggressive] = useState("");
  const [source, setSource] = useState<BenchmarkSource>("first_party");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!metricName.trim()) return;
    onAdd({
      initiativeTypeId,
      metricName: metricName.trim().replace(/\s+/g, "_").toLowerCase(),
      conservative: parseFloat(conservative) || 0,
      moderate: parseFloat(moderate) || 0,
      aggressive: parseFloat(aggressive) || 0,
      source,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[var(--radius-lg)] border border-border bg-card p-4 space-y-4"
    >
      <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">
        Add New Benchmark
      </h4>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
            Initiative Type
          </label>
          <select
            value={initiativeTypeId}
            onChange={(e) => setInitiativeTypeId(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
          >
            {initiativeTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
            Metric Name
          </label>
          <input
            type="text"
            value={metricName}
            onChange={(e) => setMetricName(e.target.value)}
            placeholder="e.g., open_rate"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
            Source
          </label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as BenchmarkSource)}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
          >
            <option value="first_party">First Party</option>
            <option value="published">Published</option>
            <option value="partner_shared">Partner Shared</option>
            <option value="industry_report">Industry Report</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
            Conservative
          </label>
          <input
            type="number"
            step="any"
            value={conservative}
            onChange={(e) => setConservative(e.target.value)}
            placeholder="0.05"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
            Moderate
          </label>
          <input
            type="number"
            step="any"
            value={moderate}
            onChange={(e) => setModerate(e.target.value)}
            placeholder="0.10"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[hsl(var(--foreground-muted))] mb-1">
            Aggressive
          </label>
          <input
            type="number"
            step="any"
            value={aggressive}
            onChange={(e) => setAggressive(e.target.value)}
            placeholder="0.20"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Benchmark
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] transition-colors"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </form>
  );
}
