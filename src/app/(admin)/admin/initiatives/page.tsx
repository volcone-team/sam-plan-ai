import { InitiativeLibraryManagement } from "@/components/admin";

export const metadata = {
  title: "Initiative Library | Admin | SAM Flow AI",
};

export default function AdminInitiativesPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Initiative Library
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Manage initiative types, benchmarks, difficulty, and AI context
        </p>
      </div>
      <InitiativeLibraryManagement />
    </div>
  );
}
