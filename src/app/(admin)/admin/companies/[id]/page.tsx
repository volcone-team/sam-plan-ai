"use client";

import { CompanyDetail } from "@/components/admin/company-detail";

export default function AdminCompanyDetailPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Company Details
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          View and manage company information
        </p>
      </div>
      <CompanyDetail />
    </div>
  );
}
