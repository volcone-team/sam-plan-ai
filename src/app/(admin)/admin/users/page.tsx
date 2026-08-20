"use client";

import { UserManagement } from "@/components/admin/user-management";

export default function AdminUsersPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          User Management
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Manage platform users, roles, and access
        </p>
      </div>
      <UserManagement />
    </div>
  );
}
