"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Eye,
  Search,
  Loader2,
  Users,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminCompany {
  id: string;
  name: string;
  description: string;
  ownerEmail: string | null;
  ownerName: string | null;
  memberCount: number;
  targetRevenue: number;
  baselineRevenue: number;
  stretchRevenue: number;
  operatingBudget: number;
  currency: string;
  planStatus: string;
  planYear: number | null;
  createdAt: string;
}

function generatePassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pw = "";
  for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  return pw;
}

function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getPlanStatusClasses(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    case "draft":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300";
    case "none":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    default:
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
  }
}

export function CompanyManagement() {
  const router = useRouter();
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ companyName: "", ownerEmail: "", ownerFirstName: "", ownerLastName: "", ownerPassword: "" });
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDeleteCompany(id: string) {
    setDeletingId(id);
    console.log("[CompanyManagement] Deleting company:", id);
    try {
      const res = await fetch(`/api/admin/companies/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to delete company");
        return;
      }
      console.log("[CompanyManagement] Deleted company:", id);
      setCompanies(prev => prev.filter(c => c.id !== id));
      setDeleteConfirmId(null);
    } catch (err) {
      alert("Network error deleting company");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleAddCompany(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddSuccess(null);
    setAddLoading(true);
    try {
      const res = await fetch("/api/admin/companies/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error || "Failed"); return; }
      setAddSuccess("Company '" + data.company.name + "' created. Credentials: " + addForm.ownerEmail + " / " + addForm.ownerPassword);
      setAddForm({ companyName: "", ownerEmail: "", ownerFirstName: "", ownerLastName: "", ownerPassword: generatePassword() });
      loadCompanies(search);
    } catch (err) {
      setAddError("Network error");
    } finally {
      setAddLoading(false);
    }
  }

  async function loadCompanies(searchTerm: string = "") {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      params.set("limit", "50");

      const res = await fetch(`/api/admin/companies?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load companies");
        console.error("[CompanyManagement] API error:", data.error);
        return;
      }

      console.log("[CompanyManagement] Loaded", data.companies?.length, "companies, total:", data.total);
      setCompanies(data.companies || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err?.message || "Network error");
      console.error("[CompanyManagement] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCompanies();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadCompanies(search);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  if (loading && companies.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        <span className="ml-2 text-sm text-[hsl(var(--foreground-muted))]">Loading companies…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        <button
          onClick={() => loadCompanies(search)}
          className="mt-3 text-sm font-medium text-red-600 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add Company button */}
      <div className="flex items-center justify-end mb-4">
        <button onClick={() => { setShowAddForm(!showAddForm); if (!addForm.ownerPassword) setAddForm(f => ({ ...f, ownerPassword: generatePassword() })); }} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90">+ Add Company</button>
      </div>

      {showAddForm && (
        <div className="mb-6 rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <h4 className="text-sm font-semibold mb-4">Create New Company + Owner</h4>
          {addError && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{addError}</div>}
          {addSuccess && <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{addSuccess}</div>}
          <form onSubmit={handleAddCompany} className="space-y-3">
            <div><label className="mb-1 block text-xs font-medium">Company Name *</label><input type="text" required value={addForm.companyName} onChange={(e) => setAddForm(f => ({ ...f, companyName: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="Acme Coaching" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs font-medium">First Name *</label><input type="text" required value={addForm.ownerFirstName} onChange={(e) => setAddForm(f => ({ ...f, ownerFirstName: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></div>
              <div><label className="mb-1 block text-xs font-medium">Last Name</label><input type="text" value={addForm.ownerLastName} onChange={(e) => setAddForm(f => ({ ...f, ownerLastName: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></div>
            </div>
            <div><label className="mb-1 block text-xs font-medium">Owner Email *</label><input type="email" required value={addForm.ownerEmail} onChange={(e) => setAddForm(f => ({ ...f, ownerEmail: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" placeholder="owner@company.com" /></div>
            <div><label className="mb-1 block text-xs font-medium">Password *</label><div className="flex gap-2"><input type="text" required value={addForm.ownerPassword} onChange={(e) => setAddForm(f => ({ ...f, ownerPassword: e.target.value }))} className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /><button type="button" onClick={() => setAddForm(f => ({ ...f, ownerPassword: generatePassword() }))} className="rounded-md border border-border px-3 py-2 text-xs">Generate</button></div><p className="mt-1 text-xs text-[hsl(var(--foreground-muted))]">Share credentials manually. No email sent.</p></div>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={addLoading} className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">{addLoading ? "Creating..." : "Create Company"}</button>
              <button type="button" onClick={() => setShowAddForm(false)} className="rounded-md border border-border px-4 py-2 text-sm font-medium">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--foreground-muted))]" />
          <input
            type="text"
            placeholder="Search companies…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-border bg-card pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
        </div>
        <span className="text-sm text-[hsl(var(--foreground-muted))]">
          {total} {total === 1 ? "company" : "companies"}
        </span>
      </div>

      {/* Companies Table */}
      {companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
          <Building2 className="h-10 w-10 text-[hsl(var(--foreground-muted))]" />
          <h3 className="mt-3 text-base font-semibold">No companies found</h3>
          <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))]">
            {search ? "No companies match your search." : "No customers have signed up yet."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-[hsl(var(--background-muted))]">
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Company</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Owner</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Members</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Target Revenue</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Plan Status</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Joined</th>
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
                        <div>
                          <span className="font-medium text-[hsl(var(--foreground))]">{company.name}</span>
                          {company.description && (
                            <p className="text-xs text-[hsl(var(--foreground-muted))] truncate max-w-[200px]">{company.description}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-[hsl(var(--foreground))]">{company.ownerName || "—"}</p>
                        <p className="text-xs text-[hsl(var(--foreground-muted))]">{company.ownerEmail || ""}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-[hsl(var(--foreground))]">
                        <Users className="h-3.5 w-3.5" />
                        {company.memberCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground))]">
                      {company.targetRevenue > 0 ? formatCurrency(company.targetRevenue, company.currency) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize", getPlanStatusClasses(company.planStatus))}>
                        {company.planStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">
                      {new Date(company.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
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
                              onClick={() => handleDeleteCompany(company.id)}
                              disabled={deletingId === company.id}
                              className="rounded-md bg-red-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                            >
                              {deletingId === company.id ? "Deleting..." : "Confirm Delete"}
                            </button>
                            <button
                              onClick={() => setDeleteConfirmId(null)}
                              className="rounded-md border border-border px-2 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirmId(company.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20 transition-colors"
                            title="Delete company permanently"
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
