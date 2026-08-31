"use client";

import { UserManagement } from "@/components/admin/user-management";

export default function AdminInternalUsersPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Internal Users
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Team members with admin access (admins & super admins)
        </p>
      </div>
      <UserManagement filter="internal" />
    </div>
  );
}
