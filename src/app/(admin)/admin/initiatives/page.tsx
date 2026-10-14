import Link from "next/link";
import { Info } from "lucide-react";
import { InitiativeLibraryManagement } from "@/components/admin";

export const metadata = {
  title: "Initiative Types | Admin | SAM Flow AI",
};

export default function AdminInitiativesPage() {
  return (
    <div>
      <div className="mb-6">
        {/*
          RENAMED from "Initiative Library".
          There are two lists and only one of them feeds the AI. This page edits
          `initiative_types` — the records a customer's initiatives are attached
          to, carrying benchmarks and difficulty. The AI picks from
          `wb_initiative_library`, which comes from the uploaded workbook and is
          controlled on the AI Workbook page. Both being called "the initiative
          library" is how the toggles here came to look as though they decided
          what the AI recommends, which they never did.
        */}
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Initiative Types
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Benchmarks, difficulty and AI context for the initiative records plans
          are built from
        </p>
      </div>

      <div className="mb-6 flex items-start gap-2 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          These switches do <strong>not</strong> control what the AI recommends.
          To choose which initiatives the AI may use, go to{" "}
          <Link
            href="/admin/ai-workbook"
            className="font-medium text-[hsl(var(--primary))] underline underline-offset-2"
          >
            AI Workbook
          </Link>
          .
        </span>
      </div>

      <InitiativeLibraryManagement />
    </div>
  );
}
