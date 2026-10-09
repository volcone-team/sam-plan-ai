import Link from "next/link";
import { ClipboardList, TriangleAlert } from "lucide-react";

export const metadata = {
  title: "Questionnaire Management | Admin | SAM Plan AI",
};

/**
 * Questionnaire Management — DISABLED.
 *
 * The editor that used to live here was not connected to anything. It let an
 * admin add, reorder, reword and delete questions, and those edits survived a
 * refresh — but they were written to that one admin's `localStorage` under
 * `sam-flow-admin-questionnaire`. There was no API route behind it, and the
 * customer intake reads definitions from code, so nothing an admin did here
 * ever reached a customer.
 *
 * That is worse than having no page: it looks like it works. An admin could
 * reword every question, see it stick, and ship nothing.
 *
 * The route is kept (rather than deleted) so an existing link or bookmark lands
 * on an explanation instead of a 404. The previous editor component is still in
 * the repo at `src/components/admin/questionnaire-management.tsx` for whoever
 * wires it up properly.
 *
 * To change the customer questions today, edit `src/lib/intake/schema.ts`
 * (copy and option lists) and the screens under `src/components/intake/`.
 */
export default function AdminQuestionnairePage() {
  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-[hsl(var(--foreground))]">
          <ClipboardList className="h-6 w-6 text-[hsl(var(--foreground-muted))]" />
          Questionnaire Management
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Temporarily unavailable
        </p>
      </div>

      <div className="rounded-[var(--radius-lg)] border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/20">
        <p className="flex items-start gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          This editor was not connected to the customer questionnaire.
        </p>
        <p className="mt-3 text-sm text-amber-900/90 dark:text-amber-200/90">
          Edits made here were saved only in this browser. They never reached
          customers, so questions could be reworded or reordered with no effect
          on anyone filling the form. It has been disabled rather than left in
          place looking functional.
        </p>
      </div>

      <div className="mt-5 rounded-[var(--radius-lg)] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Changing the questions today</h2>
        <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
          The intake is currently defined in code. Ask the development team to
          update it — question wording, option lists and which screens appear
          can all be changed and deployed.
        </p>
        <p className="mt-3 text-sm text-[hsl(var(--foreground-muted))]">
          A database-backed editor that genuinely drives the customer form is on
          the roadmap. Until it ships, this page stays disabled so no one
          configures questions believing they are live.
        </p>
        <Link
          href="/admin"
          className="mt-4 inline-flex items-center rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[hsl(var(--background-muted))]"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
