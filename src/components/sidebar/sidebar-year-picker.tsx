"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCompanyId } from "@/hooks/use-auth";
import { usePlanYears } from "@/hooks/use-plan-years";
import { planService } from "@/services/plan.service";

/**
 * "Plan year" picker, in the sidebar directly under the logo.
 *
 * REPLACES the year pills that used to sit on the dashboard. The selected year
 * already drives eight screens (both planners, both summary tables, three
 * reports and the dashboard) through `usePlanYears`, which persists the choice
 * in sessionStorage and broadcasts a change event. Putting the control in the
 * sidebar matches where its effect actually reaches — on the dashboard it looked
 * like a dashboard filter.
 *
 * No new state: this writes through the same hook, so every screen follows
 * without further wiring.
 */
export function SidebarYearPicker({ collapsed }: { collapsed: boolean }) {
  const companyId = useCompanyId() || "";
  const { years, selectedYear, setSelectedYear, currentYear } = usePlanYears(companyId);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside and Escape, so the menu cannot be left stranded open.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /**
   * Years offered: everything the plan touches, plus the current year so there
   * is always something to select on a brand-new account.
   */
  const known = Array.from(new Set([...years, selectedYear, currentYear]))
    .filter((y) => Number.isInteger(y))
    .sort((a, b) => a - b);

  /** Next year with no plan, so "Plan a future year" always advances. */
  const nextPlannable = (() => {
    let y = Math.max(currentYear, ...known);
    y += 1;
    while (known.includes(y)) y += 1;
    return y;
  })();

  /**
   * Create a DRAFT annual plan for a future year, then switch to it. The
   * dashboard shows its inline editor so goals and strategy can be sketched
   * before committing to a generated plan.
   */
  const planFutureYear = async (year: number) => {
    if (!companyId || creating) return;
    setCreating(true);
    try {
      const existing = await planService.getAnnualPlan(companyId, year);
      if (!existing) {
        await planService.createAnnualPlan({
          companyId,
          year,
          baselineRevenue: 0,
          stretchRevenue: 0,
          operatingBudget: 0,
          notes: "",
        });
      }
      setSelectedYear(year);
      setOpen(false);
    } catch (err) {
      console.error("[SidebarYearPicker] Could not create future year plan:", err);
    } finally {
      setCreating(false);
    }
  };

  const labelFor = (y: number) => (y > currentYear ? "Planned" : y < currentYear ? "Past" : "");

  // Collapsed rail: just the year, which still shows which plan is in view.
  if (collapsed) {
    return (
      <div className="px-0 py-2 text-center">
        <span
          className="text-xs font-semibold text-[hsl(var(--sidebar-foreground))]"
          title={`Plan year ${selectedYear}`}
        >
          {selectedYear}
        </span>
      </div>
    );
  }

  return (
    <div ref={ref} className="relative px-3 pb-3">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
        Plan year
      </p>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-[var(--radius-md)]",
          "border border-[hsl(var(--sidebar-border))] bg-[hsl(var(--background)/0.4)] px-3 py-2",
          "text-sm font-semibold text-[hsl(var(--sidebar-foreground))]",
          "transition-colors hover:bg-[hsl(var(--background)/0.7)]"
        )}
      >
        <span className="truncate">
          {selectedYear}
          {labelFor(selectedYear) && (
            <span className="ml-1.5 text-[10px] font-medium uppercase tracking-wider opacity-60">
              {labelFor(selectedYear)}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Plan year"
          className="absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-[var(--radius-md)] border border-border bg-card shadow-lg"
        >
          {known.map((y) => (
            <button
              key={y}
              type="button"
              role="option"
              aria-selected={y === selectedYear}
              onClick={() => {
                setSelectedYear(y);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors",
                y === selectedYear
                  ? "bg-[hsl(var(--primary)/0.12)] font-semibold text-[hsl(var(--primary))]"
                  : "hover:bg-[hsl(var(--background-muted))]"
              )}
            >
              <span>{y}</span>
              {labelFor(y) && (
                <span className="text-[10px] font-medium uppercase tracking-wider opacity-60">
                  {labelFor(y)}
                </span>
              )}
            </button>
          ))}

          <button
            type="button"
            onClick={() => planFutureYear(nextPlannable)}
            disabled={creating}
            className="flex w-full items-center gap-1.5 border-t border-border px-3 py-2 text-left text-sm font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background-muted))] hover:text-foreground disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Plan a future year
          </button>
        </div>
      )}

      <p className="mt-1.5 text-[10px] leading-snug text-[hsl(var(--foreground-subtle))]">
        Every page shows the plan year you pick here.
      </p>
    </div>
  );
}
