import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/require-admin";
import { AiTools } from "@/components/admin/ai-tools";

/**
 * Super-admin AI tools: spend across plan generation and the chatbot, plus the
 * chatbot's controls.
 *
 * Gated HERE as well as in the two APIs it calls. A client-only check would let
 * a plain admin read the page shell, and although both endpoints would refuse
 * the data, showing the page at all misrepresents who may use it.
 */
export default async function AiToolsPage() {
  const check = await requireSuperAdmin();
  if (!check.ok) redirect("/admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[hsl(var(--foreground))]">
          AI Usage &amp; Tools
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Token spend across plan generation and the assistant, and the controls that
          govern them.
        </p>
      </div>
      <AiTools />
    </div>
  );
}
