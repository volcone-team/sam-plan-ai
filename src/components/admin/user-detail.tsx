"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  User,
  Building2,
  Shield,
  Crown,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface UserData {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  companyId: string | null;
  companyName: string | null;
  role: string;
  isActive: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export function UserDetail({ userId }: { userId: string }) {
  const router = useRouter();
  const [data, setData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/admin/users/${userId}`);
        const json = await res.json();

        if (!res.ok) {
          setError(json.error || "Failed to load user");
          console.error("[UserDetail] API error:", json.error);
          return;
        }

        console.log("[UserDetail] Loaded user:", json.user?.email, "| company:", json.user?.companyName);
        setData(json.user);
      } catch (err: any) {
        setError(err?.message || "Network error");
        console.error("[UserDetail] Fetch error:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [userId]);

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
          <p className="text-sm text-red-700 dark:text-red-300">{error || "User not found"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button onClick={() => router.push("/admin/users")} className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))]">
        <ArrowLeft className="h-4 w-4" /> Back to Users
      </button>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-lg font-semibold text-white">
          {(data.firstName || data.email).charAt(0).toUpperCase()}
        </div>
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            {data.firstName} {data.lastName}
            {data.isAdmin && (
              <span className="inline-flex items-center gap-0.5 text-sm text-amber-600">
                <Crown className="h-4 w-4" /> Admin
              </span>
            )}
          </h1>
          <p className="text-sm text-[hsl(var(--foreground-muted))]">{data.email}</p>
        </div>
      </div>

      {/* Info Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Role */}
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="h-4 w-4 text-[hsl(var(--primary))]" />
            <p className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Role</p>
          </div>
          <p className="text-sm font-semibold capitalize">{data.role.replace("_", " ")}</p>
        </div>

        {/* Company */}
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="h-4 w-4 text-[hsl(var(--primary))]" />
            <p className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Company</p>
          </div>
          {data.companyName ? (
            <button
              onClick={() => router.push(`/admin/companies/${data.companyId}`)}
              className="text-sm font-semibold text-[hsl(var(--primary))] hover:underline"
            >
              {data.companyName}
            </button>
          ) : (
            <p className="text-sm text-[hsl(var(--foreground-muted))]">No company</p>
          )}
        </div>

        {/* Status */}
        <div className="rounded-[var(--radius-lg)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <User className="h-4 w-4 text-[hsl(var(--primary))]" />
            <p className="text-xs font-medium text-[hsl(var(--foreground-muted))]">Status</p>
          </div>
          <span className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
            data.isActive
              ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
          )}>
            {data.isActive ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      {/* Metadata */}
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-5">
        <h3 className="text-sm font-semibold mb-3">Account Info</h3>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
          <div>
            <dt className="text-[hsl(var(--foreground-muted))]">User ID</dt>
            <dd className="font-mono text-xs mt-0.5 text-[hsl(var(--foreground))]">{data.id}</dd>
          </div>
          <div>
            <dt className="text-[hsl(var(--foreground-muted))]">Joined</dt>
            <dd className="mt-0.5">{new Date(data.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
