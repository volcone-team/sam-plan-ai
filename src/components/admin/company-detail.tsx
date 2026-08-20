"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Plus,
  Save,
  Trash2,
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

interface AdminUser {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: "owner" | "operator" | "team_member" | "viewer";
  isActive: boolean;
  lastActive: string;
}

/* ------------------------------------------------------------------
   Mock Data
   ------------------------------------------------------------------ */

const MOCK_COMPANIES: AdminCompany[] = [
  {
    id: "comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d",
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

const MOCK_USERS: AdminUser[] = [
  { id: "user-1", companyId: "comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d", firstName: "Sarah", lastName: "Mitchell", email: "sarah@elevatecoaching.com", role: "owner", isActive: true, lastActive: "2025-01-15" },
  { id: "user-2", companyId: "comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d", firstName: "Marcus", lastName: "Chen", email: "marcus@elevatecoaching.com", role: "operator", isActive: true, lastActive: "2025-01-14" },
  { id: "user-3", companyId: "comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d", firstName: "Alex", lastName: "Rodriguez", email: "alex@elevatecoaching.com", role: "team_member", isActive: true, lastActive: "2025-01-13" },
  { id: "user-4", companyId: "comp-2nd-demo", firstName: "David", lastName: "Park", email: "david@growthagency.co", role: "owner", isActive: true, lastActive: "2025-01-15" },
  { id: "user-5", companyId: "comp-2nd-demo", firstName: "Lisa", lastName: "Wang", email: "lisa@growthagency.co", role: "operator", isActive: true, lastActive: "2025-01-12" },
];

const COMPANIES_STORAGE_KEY = "sam-flow-admin-companies-list";
const USERS_STORAGE_KEY = "sam-flow-admin-users-list";

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

function getRoleBadgeClasses(role: string): string {
  switch (role) {
    case "owner":
      return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
    case "operator":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";
  }
}

function getRoleLabel(role: string): string {
  switch (role) {
    case "owner": return "Owner";
    case "operator": return "Operator";
    case "team_member": return "Team Member";
    case "viewer": return "Viewer";
    default: return role;
  }
}

function loadCompanies(): AdminCompany[] {
  if (typeof window === "undefined") return MOCK_COMPANIES;
  try {
    const stored = localStorage.getItem(COMPANIES_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return MOCK_COMPANIES;
}

function saveCompanies(companies: AdminCompany[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(COMPANIES_STORAGE_KEY, JSON.stringify(companies));
}

function loadUsers(): AdminUser[] {
  if (typeof window === "undefined") return MOCK_USERS;
  try {
    const stored = localStorage.getItem(USERS_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return MOCK_USERS;
}

function saveUsers(users: AdminUser[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
}

/* ------------------------------------------------------------------
   Component
   ------------------------------------------------------------------ */

export function CompanyDetail() {
  const router = useRouter();
  const params = useParams();
  const companyId = params.id as string;

  const [company, setCompany] = useState<AdminCompany | null>(null);
  const [companyUsers, setCompanyUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<AdminCompany>>({});
  const [showAddUser, setShowAddUser] = useState(false);
  const [addUserForm, setAddUserForm] = useState({ firstName: "", lastName: "", email: "", role: "team_member" as string });

  useEffect(() => {
    const companies = loadCompanies();
    const found = companies.find((c) => c.id === companyId);
    setCompany(found || null);

    const users = loadUsers();
    setCompanyUsers(users.filter((u) => u.companyId === companyId));
    setLoading(false);
  }, [companyId]);

  function handleSave() {
    if (!company) return;
    const updated = { ...company, ...editForm };
    setCompany(updated);

    const companies = loadCompanies();
    const idx = companies.findIndex((c) => c.id === companyId);
    if (idx !== -1) {
      companies[idx] = updated;
      saveCompanies(companies);
    }
    setEditing(false);
  }

  function handleViewAsCompany() {
    alert("View as Company: In production, this would switch context to this company's workspace view.");
  }

  function handleAddUser() {
    if (!addUserForm.firstName.trim() || !addUserForm.email.trim()) return;
    const newUser: AdminUser = {
      id: `user-${Date.now()}`,
      companyId,
      firstName: addUserForm.firstName,
      lastName: addUserForm.lastName,
      email: addUserForm.email,
      role: addUserForm.role as AdminUser["role"],
      isActive: true,
      lastActive: new Date().toISOString().split("T")[0],
    };
    const allUsers = loadUsers();
    allUsers.push(newUser);
    saveUsers(allUsers);
    setCompanyUsers((prev) => [...prev, newUser]);
    setAddUserForm({ firstName: "", lastName: "", email: "", role: "team_member" });
    setShowAddUser(false);
  }

  function handleRemoveUser(userId: string) {
    if (!window.confirm("Remove this user from the company?")) return;
    const allUsers = loadUsers().filter((u) => u.id !== userId);
    saveUsers(allUsers);
    setCompanyUsers((prev) => prev.filter((u) => u.id !== userId));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">Loading…</p>
      </div>
    );
  }

  if (!company) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push("/admin/companies")}
          className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Companies
        </button>
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
          <Building2 className="h-10 w-10 text-[hsl(var(--foreground-muted))]" />
          <h3 className="mt-3 text-base font-semibold text-[hsl(var(--foreground))]">Company not found</h3>
          <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))]">
            The company you&apos;re looking for doesn&apos;t exist or was deleted.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button + header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/admin/companies")}
          className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Companies
        </button>
        <button
          onClick={handleViewAsCompany}
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
        >
          <ExternalLink className="h-3.5 w-3.5" /> View as Company
        </button>
      </div>

      {/* Company Info Section */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
            Company Information
          </h2>
          {!editing ? (
            <button
              onClick={() => { setEditing(true); setEditForm(company); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] transition-colors"
            >
              Edit
            </button>
          ) : (
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                <Save className="h-3.5 w-3.5" /> Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))]"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-2">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">General</h3>
            {editing ? (
              <div className="space-y-3">
                <EditField label="Name" value={editForm.name || ""} onChange={(v) => setEditForm((f) => ({ ...f, name: v }))} />
                <EditField label="Description" value={editForm.description || ""} onChange={(v) => setEditForm((f) => ({ ...f, description: v }))} />
                <EditField label="Fiscal Year" value={String(editForm.fiscalYear || "")} onChange={(v) => setEditForm((f) => ({ ...f, fiscalYear: parseInt(v) || 2026 }))} type="number" />
                <EditField label="Planning Year" value={String(editForm.planningYear || "")} onChange={(v) => setEditForm((f) => ({ ...f, planningYear: parseInt(v) || 2026 }))} type="number" />
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Currency</label>
                  <select
                    value={editForm.currency || "USD"}
                    onChange={(e) => setEditForm((f) => ({ ...f, currency: e.target.value }))}
                    className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                  >
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="CAD">CAD</option>
                    <option value="AUD">AUD</option>
                  </select>
                </div>
              </div>
            ) : (
              <dl className="space-y-2.5 text-sm">
                <DetailRow label="Name" value={company.name} />
                <DetailRow label="Description" value={company.description || "—"} />
                <DetailRow label="Fiscal Year" value={String(company.fiscalYear)} />
                <DetailRow label="Planning Year" value={String(company.planningYear)} />
                <DetailRow label="Currency" value={company.currency} />
                <DetailRow label="Created" value={company.createdAt} />
              </dl>
            )}
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Revenue & Budget</h3>
            {editing ? (
              <div className="space-y-3">
                <EditField label="Prior-Year Revenue" value={String(editForm.priorYearRevenue || "")} onChange={(v) => setEditForm((f) => ({ ...f, priorYearRevenue: parseFloat(v) || 0 }))} type="number" />
                <EditField label="Baseline Revenue" value={String(editForm.baselineRevenue || "")} onChange={(v) => setEditForm((f) => ({ ...f, baselineRevenue: parseFloat(v) || 0 }))} type="number" />
                <EditField label="Target Revenue" value={String(editForm.targetRevenue || "")} onChange={(v) => setEditForm((f) => ({ ...f, targetRevenue: parseFloat(v) || 0 }))} type="number" />
                <EditField label="Stretch Revenue" value={String(editForm.stretchRevenue || "")} onChange={(v) => setEditForm((f) => ({ ...f, stretchRevenue: parseFloat(v) || 0 }))} type="number" />
                <EditField label="Operating Budget" value={String(editForm.operatingBudget || "")} onChange={(v) => setEditForm((f) => ({ ...f, operatingBudget: parseFloat(v) || 0 }))} type="number" />
              </div>
            ) : (
              <dl className="space-y-2.5 text-sm">
                <DetailRow label="Prior-Year Revenue" value={formatCurrency(company.priorYearRevenue, company.currency)} />
                <DetailRow label="Baseline Revenue" value={formatCurrency(company.baselineRevenue, company.currency)} />
                <DetailRow label="Target Revenue" value={formatCurrency(company.targetRevenue, company.currency)} />
                <DetailRow label="Stretch Revenue" value={formatCurrency(company.stretchRevenue, company.currency)} />
                <DetailRow label="Operating Budget" value={formatCurrency(company.operatingBudget, company.currency)} />
              </dl>
            )}
          </div>
        </div>
      </section>

      {/* Users in this Company */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
            Users in {company.name} ({companyUsers.length})
          </h2>
          <button
            onClick={() => setShowAddUser(!showAddUser)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" /> Add User
          </button>
        </div>

        {showAddUser && (
          <div className="border-b border-border px-6 py-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input
                type="text"
                placeholder="First Name"
                value={addUserForm.firstName}
                onChange={(e) => setAddUserForm((f) => ({ ...f, firstName: e.target.value }))}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              />
              <input
                type="text"
                placeholder="Last Name"
                value={addUserForm.lastName}
                onChange={(e) => setAddUserForm((f) => ({ ...f, lastName: e.target.value }))}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              />
              <input
                type="email"
                placeholder="Email"
                value={addUserForm.email}
                onChange={(e) => setAddUserForm((f) => ({ ...f, email: e.target.value }))}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              />
              <select
                value={addUserForm.role}
                onChange={(e) => setAddUserForm((f) => ({ ...f, role: e.target.value }))}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
              >
                <option value="owner">Owner</option>
                <option value="operator">Operator</option>
                <option value="team_member">Team Member</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button onClick={handleAddUser} className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
              <button onClick={() => setShowAddUser(false)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))]">
                <X className="h-3.5 w-3.5" /> Cancel
              </button>
            </div>
          </div>
        )}

        {companyUsers.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-sm text-[hsl(var(--foreground-muted))]">No users in this company yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {companyUsers.map((user) => (
              <li key={user.id} className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-xs font-medium text-white">
                    {user.firstName.charAt(0)}{user.lastName.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[hsl(var(--foreground))]">
                      {user.firstName} {user.lastName}
                    </p>
                    <p className="text-xs text-[hsl(var(--foreground-muted))]">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", getRoleBadgeClasses(user.role))}>
                    {getRoleLabel(user.role)}
                  </span>
                  <button
                    onClick={() => handleRemoveUser(user.id)}
                    className="inline-flex items-center rounded-md border border-red-300 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                    title="Remove user"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Plan Summary */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">Plan Summary</h2>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Annual Plan Year</p>
              <p className="mt-1 text-lg font-bold text-[hsl(var(--foreground))]">{company.planningYear}</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Baseline Target</p>
              <p className="mt-1 text-lg font-bold text-[hsl(var(--foreground))]">{formatCurrency(company.baselineRevenue, company.currency)}</p>
            </div>
            <div className="rounded-lg border border-border p-4">
              <p className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Stretch Target</p>
              <p className="mt-1 text-lg font-bold text-[hsl(var(--foreground))]">{formatCurrency(company.stretchRevenue, company.currency)}</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------
   Sub-components
   ------------------------------------------------------------------ */

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <dt className="min-w-[140px] font-medium text-[hsl(var(--foreground-muted))]">{label}:</dt>
      <dd className="text-[hsl(var(--foreground))]">{value}</dd>
    </div>
  );
}

function EditField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange: (v: string) => void; type?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-[hsl(var(--foreground-muted))]">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
      />
    </div>
  );
}
