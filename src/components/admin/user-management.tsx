"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Plus,
  Trash2,
  Eye,
  X,
  ArrowUpDown,
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

function getStatusBadgeClasses(isActive: boolean): string {
  return isActive
    ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
}

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
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

type SortField = "name" | "lastActive";
type SortDir = "asc" | "desc";

export function UserManagement() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [addForm, setAddForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    role: "team_member" as string,
    companyId: "",
  });

  useEffect(() => {
    setUsers(loadUsers());
    setCompanies(loadCompanies());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!loading) saveUsers(users);
  }, [users, loading]);

  function getCompanyName(companyId: string): string {
    const company = companies.find((c) => c.id === companyId);
    return company?.name || "Unknown";
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const sortedUsers = [...users].sort((a, b) => {
    if (sortField === "name") {
      const nameA = `${a.firstName} ${a.lastName}`.toLowerCase();
      const nameB = `${b.firstName} ${b.lastName}`.toLowerCase();
      return sortDir === "asc" ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
    }
    // lastActive
    return sortDir === "asc"
      ? a.lastActive.localeCompare(b.lastActive)
      : b.lastActive.localeCompare(a.lastActive);
  });

  function handleAddUser() {
    if (!addForm.firstName.trim() || !addForm.email.trim() || !addForm.companyId) return;
    const newUser: AdminUser = {
      id: `user-${Date.now()}`,
      companyId: addForm.companyId,
      firstName: addForm.firstName,
      lastName: addForm.lastName,
      email: addForm.email,
      role: addForm.role as AdminUser["role"],
      isActive: true,
      lastActive: new Date().toISOString().split("T")[0],
    };
    setUsers((prev) => [...prev, newUser]);
    setAddForm({ firstName: "", lastName: "", email: "", role: "team_member", companyId: "" });
    setShowAddForm(false);
  }

  function handleDelete(id: string) {
    setUsers((prev) => prev.filter((u) => u.id !== id));
    setDeleteConfirmId(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-[hsl(var(--foreground-muted))]">Loading users…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary + Add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
            <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-[hsl(var(--foreground-muted))]">Total Users</p>
            <p className="text-xl font-bold text-[hsl(var(--foreground))]">{users.length}</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {/* Add User Form */}
      {showAddForm && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5 space-y-4">
          <h4 className="text-sm font-semibold text-[hsl(var(--foreground))]">Add New User</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              type="text"
              placeholder="First Name *"
              value={addForm.firstName}
              onChange={(e) => setAddForm((f) => ({ ...f, firstName: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <input
              type="text"
              placeholder="Last Name"
              value={addForm.lastName}
              onChange={(e) => setAddForm((f) => ({ ...f, lastName: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <input
              type="email"
              placeholder="Email *"
              value={addForm.email}
              onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            />
            <select
              value={addForm.role}
              onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            >
              <option value="owner">Owner</option>
              <option value="operator">Operator</option>
              <option value="team_member">Team Member</option>
              <option value="viewer">Viewer</option>
            </select>
            <select
              value={addForm.companyId}
              onChange={(e) => setAddForm((f) => ({ ...f, companyId: e.target.value }))}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]"
            >
              <option value="">Assign to Company *</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleAddUser}
              disabled={!addForm.firstName.trim() || !addForm.email.trim() || !addForm.companyId}
              className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="h-3.5 w-3.5" /> Add User
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

      {/* Users Table */}
      {users.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
          <Users className="h-10 w-10 text-[hsl(var(--foreground-muted))]" />
          <h3 className="mt-3 text-base font-semibold text-[hsl(var(--foreground))]">No users</h3>
          <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))]">
            No users registered yet. Add one to get started.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                    <button
                      onClick={() => toggleSort("name")}
                      className="inline-flex items-center gap-1 hover:text-[hsl(var(--foreground))]"
                    >
                      User
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Email</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Company</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Role</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Status</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">
                    <button
                      onClick={() => toggleSort("lastActive")}
                      className="inline-flex items-center gap-1 hover:text-[hsl(var(--foreground))]"
                    >
                      Last Active
                      <ArrowUpDown className="h-3.5 w-3.5" />
                    </button>
                  </th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sortedUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-[hsl(var(--background))] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-xs font-medium text-white">
                          {getInitials(user.firstName, user.lastName)}
                        </div>
                        <span className="font-medium text-[hsl(var(--foreground))]">
                          {user.firstName} {user.lastName}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">{user.email}</td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">{getCompanyName(user.companyId)}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", getRoleBadgeClasses(user.role))}>
                        {getRoleLabel(user.role)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", getStatusBadgeClasses(user.isActive))}>
                        {user.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">{user.lastActive}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => router.push(`/admin/users/${user.id}`)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] transition-colors"
                          title="View details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          View
                        </button>
                        {deleteConfirmId === user.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDelete(user.id)}
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
                            onClick={() => setDeleteConfirmId(user.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                            title="Delete user"
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
