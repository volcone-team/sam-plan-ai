"use client";

import { UserDetail } from "@/components/admin/user-detail";

export default function AdminUserDetailPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          User Details
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          View and manage user profile
        </p>
      </div>
      <UserDetail />
    </div>
  );
}
