"use client";

import { CompanyManagement } from "@/components/admin/company-management";

export default function AdminCompaniesPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Company Management
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Manage organizations and their subscriptions
        </p>
      </div>
      <CompanyManagement />
    </div>
  );
}
