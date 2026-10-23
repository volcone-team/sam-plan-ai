import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/require-admin";
import { InitiativeConfigEditor } from "@/components/admin/initiative-config-editor";
import { IntakeV3Toggle } from "@/components/admin/intake-v3-toggle";

export const metadata = {
  title: "Intake Config | Admin | SAM Flow AI",
};

/**
 * Per-initiative configuration for the new Initiative Intake form.
 *
 * Gated here as well as in the API, like /admin/ai-tools: both endpoints are
 * super-admin only, so showing a plain admin the page shell would advertise a
 * tool whose every request is refused.
 */
export default async function AdminInitiativeConfigPage() {
  const check = await requireSuperAdmin();
  if (!check.ok) redirect("/admin");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[hsl(var(--foreground))]">
          Intake Config
        </h1>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Configure how each initiative behaves in the new intake form
        </p>
      </div>
      <IntakeV3Toggle />
      <InitiativeConfigEditor />
    </div>
  );
}
