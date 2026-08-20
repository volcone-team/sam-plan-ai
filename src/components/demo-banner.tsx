import Link from "next/link";
import { Info, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DemoBannerProps {
  className?: string;
}

/**
 * Banner indicating the user is viewing a read-only demo plan.
 * Displayed at the top of the sample plan experience.
 */
export function DemoBanner({ className }: DemoBannerProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-between gap-3 rounded-[var(--radius-md)]",
        "border border-[hsl(var(--info-border))] bg-[hsl(var(--info-background))] px-4 py-3",
        className
      )}
    >
      <div className="flex items-center gap-2.5">
        <Info className="h-4 w-4 shrink-0 text-[hsl(var(--info))]" />
        <p className="text-sm text-[hsl(var(--foreground))]">
          <span className="font-medium">Demo Mode</span>
          <span className="hidden sm:inline">
            {" "}— You&apos;re viewing a sample plan for Elevate Coaching. Editing is
            disabled.
          </span>
        </p>
      </div>
      <Link
        href="/onboarding"
        className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--info))] hover:underline shrink-0"
      >
        Create your own plan
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
