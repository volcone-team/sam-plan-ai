import { ContentManagement } from "@/components/admin";

export const metadata = {
  title: "Content Management | Admin | SAM Flow AI",
};

export default function AdminContentPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Content Management
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Manage SAM University content, FAQ articles, and email templates
        </p>
      </div>
      <ContentManagement />
    </div>
  );
}
