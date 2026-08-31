"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Users,
  Package,
  Rocket,
  DollarSign,
  Loader2,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CompanyDetail {
  company: {
    id: string;
    name: string;
    description: string;
    currency: string;
    fiscalYear: number;
    planningYear: number;
    priorYearRevenue: number;
    targetRevenue: number;
    baselineRevenue: number;
    stretchRevenue: number;
    operatingBudget: number;
    createdAt: string;
  };
  members: { id: string; email: string; firstName: string; lastName: string; role: string; isActive: boolean; createdAt: string }[];
  products: { id: string; name: string; price: number; revenueType: string; ticketTier: string; isActive: boolean }[];
  initiatives: { id: string; name: string; description: string; kind: string; channel: string; status: string; activationDate: string; revenueBetter: number; plannedBudget: number }[];
  annualPlan: { id: string; year: number; baselineRevenue: number; stretchRevenue: number; operatingBudget: number; status: string } | null;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format(amount);
}

export function CompanyDetail({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [data, setData] = useState<CompanyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/admin/companies/${companyId}`);
        const json = await res.json();

        if (!res.ok) {
          setError(json.error || "Failed to load company");
          console.error("[CompanyDetail] API error:", json.error);
          return;
        }

        console.log("[CompanyDetail] Loaded company:", json.company?.name, "| members:", json.members?.length, "| products:", json.products?.length, "| initiatives:", json.initiatives?.length);
        setData(json);
      } catch (err: any) {
        setError(err?.message || "Network error");
        console.error("[CompanyDetail] Fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [companyId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]">
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <div className="rounded-[var(--radius-lg)] border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-300">{error || "Company not found"}</p>
        </div>
      </div>
    );
  }

  const { company, members, products, initiatives, annualPlan } = data;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={() => router.push("/admin/companies")} className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]">
        <ArrowLeft className="h-4 w-4" /> Back to Companies
      </button>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 dark:bg-blue-900/30">
            <Building2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{company.name}</h1>
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            {company.description || "No description"} · Joined {new Date(company.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
          </div>
        </div>
        <button
          onClick={() => {
            console.log("[CompanyDetail] Impersonating:", company.name, company.id);
            sessionStorage.setItem("sam-admin-impersonate", JSON.stringify({ id: company.id, name: company.name }));
            router.push("/year-at-a-glance");
          }}
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Eye className="h-4 w-4" />
          View Dashboard
        </button>
      </div>

      {/* Revenue Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Target Revenue", value: company.targetRevenue },
          { label: "Baseline", value: company.baselineRevenue },
          { label: "Stretch", value: company.stretchRevenue },
          { label: "Operating Budget", value: company.operatingBudget },
        ].map((stat) => (
          <div key={stat.label} className="rounded-[var(--radius-md)] border border-border bg-card p-3">
            <p className="text-xs text-[hsl(var(--foreground-muted))]">{stat.label}</p>
            <p className="mt-1 text-lg font-semibold">{stat.value > 0 ? formatCurrency(stat.value) : "—"}</p>
          </div>
        ))}
      </div>

      {/* Members */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Users className="h-4 w-4 text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold">Team Members ({members.length})</h3>
        </div>
        <div className="divide-y divide-border">
          {members.map((m) => (
            <div key={m.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium">{m.firstName} {m.lastName}</p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">{m.email}</p>
              </div>
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
                m.role === "owner" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"
              )}>
                {m.role}
              </span>
            </div>
          ))}
          {members.length === 0 && <p className="px-5 py-4 text-sm text-[hsl(var(--foreground-muted))]">No members</p>}
        </div>
      </div>

      {/* Products */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Package className="h-4 w-4 text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold">Products ({products.length})</h3>
        </div>
        <div className="divide-y divide-border">
          {products.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">{p.revenueType} · {p.ticketTier} ticket</p>
              </div>
              <span className="text-sm font-medium">{formatCurrency(p.price)}</span>
            </div>
          ))}
          {products.length === 0 && <p className="px-5 py-4 text-sm text-[hsl(var(--foreground-muted))]">No products</p>}
        </div>
      </div>

      {/* Initiatives */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Rocket className="h-4 w-4 text-[hsl(var(--primary))]" />
          <h3 className="text-sm font-semibold">Initiatives ({initiatives.length})</h3>
        </div>
        <div className="divide-y divide-border">
          {initiatives.map((i) => (
            <div key={i.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="text-sm font-medium">{i.name}</p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">{i.channel} · {i.kind} · {i.status}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium">{formatCurrency(i.revenueBetter)}</p>
                <p className="text-xs text-[hsl(var(--foreground-muted))]">projected</p>
              </div>
            </div>
          ))}
          {initiatives.length === 0 && <p className="px-5 py-4 text-sm text-[hsl(var(--foreground-muted))]">No initiatives</p>}
        </div>
      </div>

      {/* Annual Plan */}
      {annualPlan && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="h-4 w-4 text-[hsl(var(--primary))]" />
            <h3 className="text-sm font-semibold">Annual Plan {annualPlan.year}</h3>
            <span className={cn("ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize",
              annualPlan.status === "active" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
            )}>
              {annualPlan.status}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Baseline</p>
              <p className="text-sm font-semibold">{formatCurrency(annualPlan.baselineRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Stretch</p>
              <p className="text-sm font-semibold">{formatCurrency(annualPlan.stretchRevenue)}</p>
            </div>
            <div>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">Budget</p>
              <p className="text-sm font-semibold">{formatCurrency(annualPlan.operatingBudget)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
