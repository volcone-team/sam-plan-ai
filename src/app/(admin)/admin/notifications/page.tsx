import { NotificationSettings } from "@/components/admin";

export const metadata = {
  title: "Notifications | SAM Flow AI",
};

export default function AdminNotificationsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Configure automatic initiative reminder emails
        </p>
      </div>
      <NotificationSettings />
    </div>
  );
}
