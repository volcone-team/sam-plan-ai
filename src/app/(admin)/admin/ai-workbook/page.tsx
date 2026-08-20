import { AIWorkbook } from "@/components/admin";

export const metadata = {
  title: "AI Workbook | Admin | SAM Flow AI",
};

export default function AdminAIWorkbookPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          AI Workbook
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Manage AI prompts, model configuration, and test prompt behavior
        </p>
      </div>
      <AIWorkbook />
    </div>
  );
}
