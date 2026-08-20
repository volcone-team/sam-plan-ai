import { AdminDashboard } from "@/components/admin";

export const metadata = {
  title: "Admin Dashboard | SAM Flow AI",
};

/**
 * Admin dashboard home page.
 * Displays metrics, activity feed, and system status.
 */
export default function AdminDashboardPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Overview of platform activity and status
        </p>
      </div>
      <AdminDashboard />
    </div>
  );
}
