"use client";

import { useImpersonation } from "@/hooks/use-impersonation";
import { useRouter } from "next/navigation";
import { X, Eye } from "lucide-react";

/**
 * Banner displayed at the top of the app when an admin is viewing as another company.
 */
export function ImpersonationBanner() {
  const { isImpersonating, impersonatedCompanyName, stopImpersonation } = useImpersonation();
  const router = useRouter();

  if (!isImpersonating) return null;

  const handleExit = () => {
    stopImpersonation();
    router.push("/admin/companies");
  };

  return (
    <div className="sticky top-0 z-[60] flex items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-white shadow-sm">
      <Eye className="h-4 w-4" />
      <span>Viewing as: <strong>{impersonatedCompanyName}</strong></span>
      <button
        onClick={handleExit}
        className="ml-2 inline-flex items-center gap-1 rounded-md bg-white/20 px-2.5 py-1 text-xs font-medium hover:bg-white/30 transition-colors"
      >
        <X className="h-3 w-3" />
        Exit
      </button>
    </div>
  );
}
