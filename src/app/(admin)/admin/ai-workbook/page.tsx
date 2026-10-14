import { AIWorkbook } from "@/components/admin";
import { InitiativeLibraryToggles } from "@/components/admin/initiative-library-toggles";

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
          Upload the initiative workbook and choose what the AI may recommend
        </p>
      </div>

      <AIWorkbook />

      {/*
        The toggles sit directly under the upload because that is where the
        library comes from. Seeing "22 initiatives, 6 active" beside the file
        that produced them is the context that makes the switches meaningful —
        on their own page they would just look like another list.
      */}
      <section className="mt-10 border-t border-border pt-8">
        <InitiativeLibraryToggles />
      </section>
    </div>
  );
}
