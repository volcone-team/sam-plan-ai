"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Eye,
  Search,
  Loader2,
  Trash2,
  Building2,
  Shield,
  Crown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  companyId: string | null;
  companyName: string | null;
  role: string;
  isActive: boolean;
  isAdmin: boolean;
  adminLevel: string | null;
  createdAt: string;
}

const ROLE_STYLES: Record<string, string> = {
  owner: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  operator: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  viewer: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  team_member: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
};

function genPw(): string {
  const c = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let pw = "";
  for (let i = 0; i < 10; i++) pw += c[Math.floor(Math.random() * c.length)];
  return pw;
}

export function UserManagement({ filter = "all" }: { filter?: "all" | "internal" | "customers" } = {}) {
  const router = useRouter();
  const { userId: currentUserId, adminLevel } = useAuth();
  const isSuperAdmin = adminLevel === "super_admin";
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [addSuccess, setAddSuccess] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ companyId: "", email: "", firstName: "", lastName: "", password: "", role: "operator" });
  const [companiesList, setCompaniesList] = useState<{ id: string; name: string }[]>([]);

  async function loadCompaniesForDropdown() {
    try {
      const res = await fetch("/api/admin/companies?limit=100");
      if (res.ok) {
        const data = await res.json();
        setCompaniesList((data.companies || []).map((c: any) => ({ id: c.id, name: c.name })));
      }
    } catch {}
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);
    setAddSuccess(null);
    setAddLoading(true);
    try {
      const res = await fetch("/api/admin/users/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error || "Failed"); return; }
      setAddSuccess("User " + data.user.email + " created (" + data.user.role + " at " + data.user.companyName + "). Password: " + addForm.password);
      setAddForm({ companyId: "", email: "", firstName: "", lastName: "", password: genPw(), role: "operator" });
      loadUsers(search);
    } catch { setAddError("Network error"); }
    finally { setAddLoading(false); }
  }

  async function loadUsers(searchTerm: string = "") {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchTerm) params.set("search", searchTerm);
      if (filter !== "all") params.set("filter", filter);
      params.set("limit", "50");

      const res = await fetch(`/api/admin/users?${params}`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load users");
        console.error("[UserManagement] API error:", data.error);
        return;
      }

      console.log("[UserManagement] Loaded", data.users?.length, "users, total:", data.total);
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      setError(err?.message || "Network error");
      console.error("[UserManagement] Fetch error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
    loadCompaniesForDropdown();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      loadUsers(search);
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  async function handleDeactivate(userId: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to deactivate user");
        console.error("[UserManagement] Deactivate error:", data.error);
        return;
      }

      console.log("[UserManagement] Deactivated user:", userId);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isActive: false } : u));
      setDeleteConfirmId(null);
    } catch (err: any) {
      alert(err?.message || "Network error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDeletePermanently(userId: string) {
    setDeleting(true);
    console.log("[UserManagement] Permanently deleting user:", userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}?hard=true`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to delete user");
        return;
      }
      console.log("[UserManagement] Deleted user permanently:", userId);
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      setDeleteConfirmId(null);
    } catch (err: any) {
      alert(err?.message || "Network error");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRoleChange(userId: string, newRole: string) {
    console.log("[UserManagement] Changing role:", userId, "->", newRole);
    const snapshot = users;
    setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("[UserManagement] Role change failed:", data.error);
        setUsers(snapshot);
        alert(data.error || "Failed to change role");
        return;
      }
      console.log("[UserManagement] Role changed successfully");
    } catch (err: any) {
      setUsers(snapshot);
      alert(err?.message || "Network error");
    }
  }

  async function handleAdminLevelChange(userId: string, level: string | null) {
    console.log("[UserManagement] Changing admin level:", userId, "->", level);
    try {
      const res = await fetch(`/api/admin/users/${userId}/admin-level`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminLevel: level }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("[UserManagement] Admin level change failed:", data.error);
        alert(data.error || "Failed to change admin level");
        return;
      }
      console.log("[UserManagement] Admin level changed to:", level);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isAdmin: level !== null, adminLevel: level } : u));
    } catch (err: any) {
      alert(err?.message || "Network error");
    }
  }

  if (loading && users.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
        <span className="ml-2 text-sm text-[hsl(var(--foreground-muted))]">Loading users…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30">
        <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        <button
          onClick={() => loadUsers(search)}
          className="mt-3 text-sm font-medium text-red-600 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add User */}
      <div className="flex items-center justify-end mb-4">
        <button onClick={() => { setShowAddForm(!showAddForm); if (!addForm.password) setAddForm(f => ({ ...f, password: genPw() })); }} className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90">+ Add User</button>
      </div>

      {showAddForm && (
        <div className="mb-6 rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <h4 className="text-sm font-semibold mb-4">Add User to Company</h4>
          {addError && <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{addError}</div>}
          {addSuccess && <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{addSuccess}</div>}
          <form onSubmit={handleAddUser} className="space-y-3">
            <div><label className="mb-1 block text-xs font-medium">Company *</label><select required value={addForm.companyId} onChange={(e) => setAddForm(f => ({ ...f, companyId: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="">Select company...</option>{companiesList.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1 block text-xs font-medium">First Name *</label><input type="text" required value={addForm.firstName} onChange={(e) => setAddForm(f => ({ ...f, firstName: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></div>
              <div><label className="mb-1 block text-xs font-medium">Last Name</label><input type="text" value={addForm.lastName} onChange={(e) => setAddForm(f => ({ ...f, lastName: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></div>
            </div>
            <div><label className="mb-1 block text-xs font-medium">Email *</label><input type="email" required value={addForm.email} onChange={(e) => setAddForm(f => ({ ...f, email: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" /></div>
            <div><label className="mb-1 block text-xs font-medium">Role *</label><select value={addForm.role} onChange={(e) => setAddForm(f => ({ ...f, role: e.target.value }))} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"><option value="owner">Owner</option><option value="operator">Operator</option><option value="team_member">Team Member</option><option value="viewer">Viewer</option></select></div>
            <div><label className="mb-1 block text-xs font-medium">Password *</label><div className="flex gap-2"><input type="text" required value={addForm.password} onChange={(e) => setAddForm(f => ({ ...f, password: e.target.value }))} className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono" /><button type="button" onClick={() => setAddForm(f => ({ ...f, password: genPw() }))} className="rounded-md border border-border px-3 py-2 text-xs">Generate</button></div></div>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={addLoading} className="rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{addLoading ? "Creating..." : "Create User"}</button>
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
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[var(--radius-md)] border border-border bg-card pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          />
        </div>
        <span className="text-sm text-[hsl(var(--foreground-muted))]">
          {total} {total === 1 ? "user" : "users"}
        </span>
      </div>

      {/* Users Table */}
      {users.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
          <User className="h-10 w-10 text-[hsl(var(--foreground-muted))]" />
          <h3 className="mt-3 text-base font-semibold">No users found</h3>
          <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))]">
            {search ? "No users match your search." : "No users have signed up yet."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-[hsl(var(--background-muted))]">
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">User</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Company</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Role</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Status</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Joined</th>
                  <th className="px-4 py-3 font-medium text-[hsl(var(--foreground-muted))]">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-[hsl(var(--background))] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-xs font-medium text-white">
                          {(u.firstName || u.email).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-[hsl(var(--foreground))]">
                            {u.firstName} {u.lastName}
                            {u.isAdmin && (
                              <span className={cn("ml-1.5 inline-flex items-center gap-0.5 text-xs", u.adminLevel === "super_admin" ? "text-purple-600" : "text-amber-600")}>
                                <Crown className="h-3 w-3" /> {u.adminLevel === "super_admin" ? "Super Admin" : "Admin"}
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-[hsl(var(--foreground-muted))]">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {u.companyName ? (
                        <button
                          onClick={() => router.push(`/admin/companies/${u.companyId}`)}
                          className="inline-flex items-center gap-1 text-[hsl(var(--foreground))] hover:text-[hsl(var(--primary))] transition-colors"
                        >
                          <Building2 className="h-3.5 w-3.5" />
                          {u.companyName}
                        </button>
                      ) : (
                        <span className="text-[hsl(var(--foreground-muted))]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize border-0 cursor-pointer focus:ring-2 focus:ring-[hsl(var(--ring))]", ROLE_STYLES[u.role] || ROLE_STYLES.viewer)}
                        title="Change access role"
                      >
                        <option value="owner">Owner</option>
                        <option value="operator">Operator</option>
                        <option value="team_member">Team Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        u.isActive
                          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                          : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
                      )}>
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[hsl(var(--foreground-muted))]">
                      {new Date(u.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => router.push(`/admin/users/${u.id}`)}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] transition-colors"
                          title="View details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                        {isSuperAdmin && u.id !== currentUserId && (
                          <select
                            value={u.adminLevel || "none"}
                            onChange={(e) => handleAdminLevelChange(u.id, e.target.value === "none" ? null : e.target.value)}
                            className="rounded-md border border-border bg-background px-2 py-1.5 text-xs font-medium cursor-pointer"
                            title="Admin access"
                          >
                            <option value="none">Not Admin</option>
                            <option value="admin">Admin</option>
                            <option value="super_admin">Super Admin</option>
                          </select>
                        )}
                        {deleteConfirmId === u.id ? (
                          <div className="flex items-center gap-1">
                            {u.isActive && (
                              <button
                                onClick={() => handleDeactivate(u.id)}
                                disabled={deleting}
                                className="inline-flex items-center rounded-md bg-amber-500 px-2 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                                title="Deactivate (reversible)"
                              >
                                {deleting ? "…" : "Deactivate"}
                              </button>
                            )}
                            <button
                              onClick={() => handleDeletePermanently(u.id)}
                              disabled={deleting}
                              className="inline-flex items-center rounded-md bg-red-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
                              title="Delete permanently (irreversible)"
                            >
                              {deleting ? "…" : "Delete"}
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
                            onClick={() => setDeleteConfirmId(u.id)}
                            className="inline-flex items-center rounded-md border border-red-300 px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 transition-colors"
                            title="Remove user"
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
