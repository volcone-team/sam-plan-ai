import { ActivityLog } from "@/components/admin";

export const metadata = {
  title: "Activity Log | SAM Flow AI",
};

export default function AdminActivityPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Activity Log
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Append-only audit trail of admin actions across users and companies
        </p>
      </div>
      <ActivityLog />
    </div>
  );
}
