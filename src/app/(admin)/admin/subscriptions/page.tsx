import { SubscriptionTabsClient } from "@/components/admin/subscription-tabs-client";

export const metadata = {
  title: "Subscriptions | Admin | SAM Plan AI",
};

export default function AdminSubscriptionsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Subscriptions
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Manage subscription plans, billing, and payment integrations
        </p>
      </div>
      <SubscriptionTabsClient />
    </div>
  );
}
