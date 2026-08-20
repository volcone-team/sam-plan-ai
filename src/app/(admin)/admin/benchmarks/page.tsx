import { BenchmarkManagement } from "@/components/admin";

export const metadata = {
  title: "Benchmark Management | Admin | SAM Flow AI",
};

export default function AdminBenchmarksPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Benchmark Management
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Manage industry benchmarks and conversion metrics
        </p>
      </div>
      <BenchmarkManagement />
    </div>
  );
}
