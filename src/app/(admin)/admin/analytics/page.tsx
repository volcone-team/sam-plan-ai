import { AdminAnalytics } from "@/components/admin";

export const metadata = {
  title: "Analytics | Admin | SAM Flow AI",
};

export default function AdminAnalyticsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Analytics
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Platform usage metrics and user engagement data
        </p>
      </div>
      <AdminAnalytics />
    </div>
  );
}
