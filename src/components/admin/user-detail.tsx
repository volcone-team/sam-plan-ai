"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ArrowLeft,
  Save,
  Users,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------
   Types
   ------------------------------------------------------------------ */

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

const MOCK_USERS: AdminUser[] = [
  { id: "user-1", companyId: "comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d", firstName: "Sarah", lastName: "Mitchell", email: "sarah@elevatecoaching.com", role: "owner", isActive: true, lastActive: "2025-01-15" },
  { id: "user-2", companyId: "comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d", firstName: "Marcus", lastName: "Chen", email: "marcus@elevatecoaching.com", role: "operator", isActive: true, lastActive: "2025-01-14" },
  { id: "user-3", companyId: "comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d", firstName: "Alex", lastName: "Rodriguez", email: "alex@elevatecoaching.com", role: "team_member", isActive: true, lastActive: "2025-01-13" },
  { id: "user-4", companyId: "comp-2nd-demo", firstName: "David", lastName: "Park", email: "david@growthagency.co", role: "owner", isActive: true, lastActive: "2025-01-15" },
  { id: "user-5", companyId: "comp-2nd-demo", firstName: "Lisa", lastName: "Wang", email: "lisa@growthagency.co", role: "operator", isActive: true, lastActive: "2025-01-12" },
];

const MOCK_COMPANIES: AdminCompany[] = [
  {
    id: "comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d",
    name: "Elevate Coaching",
    description: "A premium coaching and consulting firm",
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
    description: "Full-service digital growth agency",
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

const MOCK_ACTIVITY = [
  { id: 1, action: "Logged in", timestamp: "2025-01-15 09:32 AM", details: "From Chrome on macOS" },
  { id: 2, action: "Viewed Year-at-a-Glance", timestamp: "2025-01-15 09:35 AM", details: "Spent 4 minutes" },
  { id: 3, action: "Updated initiative", timestamp: "2025-01-14 02:15 PM", details: "Modified 'Q1 Email Campaign' targets" },
  { id: 4, action: "Entered result", timestamp: "2025-01-13 11:00 AM", details: "Added revenue entry for Week 2" },
  { id: 5, action: "Generated report", timestamp: "2025-01-12 04:45 PM", details: "Monthly performance summary" },
];

const USERS_STORAGE_KEY = "sam-flow-admin-users-list";
const COMPANIES_STORAGE_KEY = "sam-flow-admin-companies-list";

/* ------------------------------------------------------------------
   Helpers
   ------------------------------------------------------------------ */

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

function loadCompanies(): AdminCompany[] {
  if (typeof window === "undefined") return MOCK_COMPANIES;
  try {
    const stored = localStorage.getItem(COMPANIES_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch {}
  return MOCK_COMPANIES;
}

/* ------------------------------------------------------------------
   Component
   ------------------------------------------------------------------ */

export function UserDetail() {
  const router = useRouter();
  const params = useParams();
  const userId = params.id as string;

  const [user, setUser] = useState<AdminUser | null>(null);
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Partial<AdminUser>>({});

  useEffect(() => {
    const users = loadUsers();
    const found = users.find((u) => u.id === userId);
    setUser(found || null);
    setCompanies(loadCompanies());
    setLoading(false);
  }, [userId]);

  function getCompanyName(companyId: string): string {
    const company = companies.find((c) => c.id === companyId);
    return company?.name || "Unknown";
  }

  function handleSave() {
    if (!user) return;
    const updated = { ...user, ...editForm };
    setUser(updated);

    const allUsers = loadUsers();
    const idx = allUsers.findIndex((u) => u.id === userId);
    if (idx !== -1) {
      allUsers[idx] = updated;
      saveUsers(allUsers);
    }
    setEditing(false);
  }

  function handleImpersonate() {
    alert("Impersonate: In production, this would log you in as this user to debug their experience.");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push("/admin/users")}
          className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Users
        </button>
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
          <Users className="h-10 w-10 text-[hsl(var(--foreground-muted))]" />
          <h3 className="mt-3 text-base font-semibold text-[hsl(var(--foreground))]">User not found</h3>
          <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))]">
            The user you&apos;re looking for doesn&apos;t exist or was deleted.
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
          onClick={() => router.push("/admin/users")}
          className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Users
        </button>
        <button
          onClick={handleImpersonate}
          className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Shield className="h-3.5 w-3.5" /> Impersonate
        </button>
      </div>

      {/* User Profile Header */}
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-lg font-semibold text-white">
          {user.firstName.charAt(0)}{user.lastName.charAt(0)}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[hsl(var(--foreground))]">
            {user.firstName} {user.lastName}
          </h2>
          <p className="text-sm text-[hsl(var(--foreground-muted))]">{user.email}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", getRoleBadgeClasses(user.role))}>
              {getRoleLabel(user.role)}
            </span>
            <span className={cn(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
              user.isActive
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            )}>
              {user.isActive ? "Active" : "Inactive"}
            </span>
          </div>
        </div>
      </div>

      {/* Profile Section */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">Profile</h2>
          {!editing ? (
            <button
              onClick={() => { setEditing(true); setEditForm(user); }}
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

        <div className="p-6">
          {editing ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <EditField label="First Name" value={editForm.firstName || ""} onChange={(v) => setEditForm((f) => ({ ...f, firstName: v }))} />
              <EditField label="Last Name" value={editForm.lastName || ""} onChange={(v) => setEditForm((f) => ({ ...f, lastName: v }))} />
              <EditField label="Email" value={editForm.email || ""} onChange={(v) => setEditForm((f) => ({ ...f, email: v }))} type="email" />
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Role</label>
                <select
                  value={editForm.role || "team_member"}
                  onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value as AdminUser["role"] }))}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                >
                  <option value="owner">Owner</option>
                  <option value="operator">Operator</option>
                  <option value="team_member">Team Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Company</label>
                <select
                  value={editForm.companyId || ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, companyId: e.target.value }))}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Status</label>
                <select
                  value={editForm.isActive ? "active" : "inactive"}
                  onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.value === "active" }))}
                  className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>
          ) : (
            <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <DetailRow label="First Name" value={user.firstName} />
              <DetailRow label="Last Name" value={user.lastName} />
              <DetailRow label="Email" value={user.email} />
              <DetailRow label="Role" value={getRoleLabel(user.role)} />
              <DetailRow label="Company" value={getCompanyName(user.companyId)} />
              <DetailRow label="Status" value={user.isActive ? "Active" : "Inactive"} />
              <DetailRow label="Last Active" value={user.lastActive} />
            </dl>
          )}
        </div>
      </section>

      {/* Activity History */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">Activity History</h2>
        </div>
        <ul className="divide-y divide-border">
          {MOCK_ACTIVITY.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-6 py-3">
              <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--primary))]" />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[hsl(var(--foreground))]">{item.action}</p>
                  <span className="text-xs text-[hsl(var(--foreground-muted))]">{item.timestamp}</span>
                </div>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">{item.details}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------
   Sub-components
   ------------------------------------------------------------------ */

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-[hsl(var(--foreground-muted))]">{label}</dt>
      <dd className="text-sm text-[hsl(var(--foreground))]">{value}</dd>
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
