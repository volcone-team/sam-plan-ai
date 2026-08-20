import { AdminSettings } from "@/components/admin";

export const metadata = {
  title: "Admin Settings | SAM Flow AI",
};

export default function AdminSettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Admin Settings
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Platform configuration and system settings
        </p>
      </div>
      <AdminSettings />
    </div>
  );
}
