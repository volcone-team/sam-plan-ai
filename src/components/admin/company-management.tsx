"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Plus,
  Trash2,
  Eye,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

interface AdminCompany {
  id: string;
  name: string;
  description: string;
  owner: string;
  users: number;
  tier: "Starter" | "Pro" | "Mastery";
  targetRevenue: number;
  currency: string;
  status: "active" | "inactive";
  createdAt: string;
  fiscalYear: number;
  planningYear: number;
  priorYearRevenue: number;
  baselineRevenue: number;
  stretchRevenue: number;
  operatingBudget: number;
}

/* ------------------------------------------------------------------
   Mock Data
   ------------------------------------------------------------------ */

const MOCK_COMPANIES: AdminCompany[] = [
  {
    id: "8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d",
    name: "Elevate Coaching",
    description: "A premium coaching and consulting firm specializing in executive leadership development",
    owner: "Sarah Mitchell",
    users: 3,
    tier: "Pro",
    targetRevenue: 495000,
    currency: "USD",
    status: "active",
    createdAt: "2024-06-15",
    fiscalYear: 2026,
    planningYear: 2026,
    priorYearRevenue: 450000,
    baselineRevenue: 495000,
    stretchRevenue: 900000,
    operatingBudget: 346500,
  },
  {
    id: "comp-2nd-demo",
    name: "Growth Agency Co",
    description: "Full-service digital growth agency for B2B SaaS startups",
    owner: "David Park",
    users: 2,
    tier: "Starter",
    targetRevenue: 200000,
    currency: "USD",
    status: "active",
    createdAt: "2025-03-01",
    fiscalYear: 2026,
    planningYear: 2026,
    priorYearRevenue: 150000,
    baselineRevenue: 180000,
    stretchRevenue: 280000,
    operatingBudget: 120000,
  },
];

const STORAGE_KEY = "sam-flow-admin-companies-list";

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getTierBadgeClasses(tier: string): string {
  switch (tier) {
    case "Starter":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "Pro":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "Mastery":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}

function getStatusBadgeClasses(status: string): string {
  return status === "active"
    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
}

function loadCompanies(): AdminCompany[] {
  if (typeof window === "undefined") return MOCK_COMPANIES;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return MOCK_COMPANIES;
}

function saveCompanies(companies: AdminCompany[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(companies));
}

/* ------------------------------------------------------------------
   Component
   ------------------------------------------------------------------ */

export function CompanyManagement() {
  const router = useRouter();
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({
    name: "",
    description: "",
    fiscalYear: "2026",
    planningYear: "2026",
    currency: "USD",
    priorYearRevenue: "",
    baselineRevenue: "",
    stretchRevenue: "",
    targetRevenue: "",
    operatingBudget: "",
  });

  useEffect(() => {
    setCompanies(loadCompanies());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!loading) saveCompanies(companies);
  }, [companies, loading]);

  function handleAddCompany() {
    if (!addForm.name.trim()) return;
    const newCompany: AdminCompany = {
      id: `comp-${Date.now()}`,
      name: addForm.name,
      description: addForm.description,
      owner: "—",
      users: 0,
      tier: "Starter",
      targetRevenue: parseFloat(addForm.targetRevenue) || 0,
      currency: addForm.currency,
      status: "active",
      createdAt: new Date().toISOString().split("T")[0],
      fiscalYear: parseInt(addForm.fiscalYear) || 2026,
      planningYear: parseInt(addForm.planningYear) || 2026,
      priorYearRevenue: parseFloat(addForm.priorYearRevenue) || 0,
      baselineRevenue: parseFloat(addForm.baselineRevenue) || 0,
      stretchRevenue: parseFloat(addForm.stretchRevenue) || 0,
      operatingBudget: parseFloat(addForm.operatingBudget) || 0,
    };
    setCompanies((prev) => [...prev, newCompany]);
    setAddForm({
      name: "",
      description: "",
      fiscalYear: "2026",
      planningYear: "2026",
      currency: "USD",
      priorYearRevenue: "",
      baselineRevenue: "",
      stretchRevenue: "",
      targetRevenue: "",
      operatingBudget: "",
    });
    setShowAddForm(false);
  }

  function handleDelete(id: string) {
    setCompanies((prev) => prev.filter((c) => c.id !== id));
    setDeleteConfirmId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">Loading companies…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center justify-end">
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Add Company
        </button>
      </div>

      {/* Add Company Form */}
      {showAddForm && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5 space-y-4">
          <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">Add New Company</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              type="text"
              placeholder="Company Name *"
              value={addForm.name}
              onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <input
              type="text"
              placeholder="Description"
              value={addForm.description}
              onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <select
              value={addForm.currency}
              onChange={(e) => setAddForm((f) => ({ ...f, currency: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            >
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
              <option value="CAD">CAD</option>
              <option value="AUD">AUD</option>
            </select>
            <input
              type="number"
              placeholder="Fiscal Year"
              value={addForm.fiscalYear}
              onChange={(e) => setAddForm((f) => ({ ...f, fiscalYear: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <input
              type="number"
              placeholder="Planning Year"
              value={addForm.planningYear}
              onChange={(e) => setAddForm((f) => ({ ...f, planningYear: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <input
              type="number"
              placeholder="Prior-Year Revenue"
              value={addForm.priorYearRevenue}
              onChange={(e) => setAddForm((f) => ({ ...f, priorYearRevenue: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <input
              type="number"
              placeholder="Baseline Revenue"
              value={addForm.baselineRevenue}
              onChange={(e) => setAddForm((f) => ({ ...f, baselineRevenue: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <input
              type="number"
              placeholder="Stretch Revenue"
              value={addForm.stretchRevenue}
              onChange={(e) => setAddForm((f) => ({ ...f, stretchRevenue: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <input
              type="number"
              placeholder="Target Revenue"
              value={addForm.targetRevenue}
              onChange={(e) => setAddForm((f) => ({ ...f, targetRevenue: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <input
              type="number"
              placeholder="Operating Budget"
              value={addForm.operatingBudget}
              onChange={(e) => setAddForm((f) => ({ ...f, operatingBudget: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddCompany}
              disabled={!addForm.name.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="h-3.5 w-3.5" /> Add Company
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background))]"
            >
              <X className="h-3.5 w-3.5" /> Cancel
            </button>
          </div>
        </div>
      )}

      {/* Companies Table */}
      {companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
          <Building2 className="h-10 w-10 text-[hsl(var(--foreground-muted))]" />
          <h3 className="mt-3 text-base font-semibold text-[hsl(var(--foreground))]">No companies</h3>
          <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))]">
            No companies registered yet. Add one to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <div className="border-b border-border px-6 py-4">
            <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
              Companies ({companies.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Company</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Owner</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Users</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Tier</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Revenue Target</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Status</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {companies.map((company) => (
                  <tr key={company.id} className="hover:bg-[hsl(var(--background))] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                          <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                        <span className="font-medium text-[hsl(var(--foreground))]">{company.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">{company.owner}</td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground))]">{company.users}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", getTierBadgeClasses(company.tier))}>
                        {company.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground))]">
                      {formatCurrency(company.targetRevenue, company.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", getStatusBadgeClasses(company.status))}>
                        {company.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => router.push(`/admin/companies/${company.id}`)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] transition-colors"
                          title="View details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </button>
                        {deleteConfirmId === company.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(company.id)}
                              className="inline-flex items-center rounded-md bg-red-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="inline-flex items-center rounded-md border border-border px-2 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(company.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                            title="Delete company"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
