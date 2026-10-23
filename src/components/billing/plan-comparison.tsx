"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { Check, Loader2, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { BrandLogo } from "@/components/brand-logo";
import type {
  PricingSection,
  PricingTable,
  PricingTableSection,
} from "@/lib/billing/pricing-table";
import {
  accentFor,
  buttonLabel,
  cellView,
  formatCents,
  isPurchasable,
  planSectionTotal,
  priceLines,
  rowValueLabel,
  sharedPriceLabel,
  type Accent,
  type BillingCycle,
  type ComparisonPlan,
} from "./plan-comparison-view";

/**
 * The plan comparison table shared by /get-started and /choose-plan.
 *
 * ALWAYS DARK, like /welcome, regardless of the app theme. The root carries
 * the `dark` class, which switches the theme tokens and BrandLogo's CSS swap
 * to their dark versions for everything inside, on top of explicit colours.
 *
 * Presentation only. The page decides which plans are offered and what a
 * button does (`onChoose`); this component owns only the cycle toggle.
 *
 * Plan limits and feature lists are deliberately NOT shown here.
 */

export interface PlanComparisonProps {
  table: PricingTable;
  annualNote: string | null;
  annualNoteValueCents: number | null;
  /** Already matched against the table and in table order (selectComparisonPlans). */
  plans: ComparisonPlan[];
  title: string;
  subtitle: string;
  /** Right-hand side of the header (sign-in link, or email + sign out). */
  headerRight?: ReactNode;
  onChoose: (planId: string, cycle: BillingCycle) => void;
  /** The plan whose action is in flight; disables every button while set. */
  busyPlanId?: string | null;
  /** Shown in place of the toggle and table (e.g. "only the owner can buy"). */
  notice?: ReactNode;
  error?: string | null;
  /** Extra footer lines under the Stripe note. */
  footerExtra?: ReactNode;
}

const SECTION_TITLE: Record<PricingSection, string> = {
  included: "Included",
  bonus: "+Plus these one-time bonuses",
};
const SECTION_FOOTER: Record<PricingSection, string> = {
  included: "Monthly value",
  bonus: "Additional value",
};

const ACCENT: Record<
  Accent,
  { card: string; text: string; button: string; check: string; ring: string }
> = {
  cyan: {
    card: "border-cyan-400/40 bg-[#0d1e2c]/90 shadow-[0_0_40px_rgba(34,211,238,0.15)]",
    text: "text-cyan-300",
    button: "bg-gradient-to-r from-teal-400 to-blue-500 text-white",
    check: "text-cyan-300",
    ring: "focus-visible:ring-cyan-300",
  },
  lime: {
    card: "border-lime-400/40 bg-[#14261c]/90 shadow-[0_0_40px_rgba(163,230,53,0.15)]",
    text: "text-lime-300",
    button: "bg-gradient-to-r from-lime-300 to-green-500 text-[#0b1520]",
    check: "text-lime-300",
    ring: "focus-visible:ring-lime-300",
  },
};

const PANEL =
  "rounded-xl border border-white/10 bg-white/[0.04] backdrop-blur-sm shadow-[0_0_30px_rgba(0,0,0,0.35)]";
const SMALL_CAPS = "text-[11px] font-semibold uppercase tracking-[0.12em]";
const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b1520]";

export function PlanComparison(props: PlanComparisonProps) {
  const { title, subtitle, headerRight, notice, error, footerExtra } = props;
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  return (
    <div className="dark flex min-h-dvh flex-col bg-[#0b1520] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <BrandLogo width={120} height={40} />
          {headerRight}
        </div>
      </header>

      <main className="flex-1 px-4 py-12 sm:px-6">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="gradient-heading text-3xl font-bold tracking-tight sm:text-5xl">
              {title}
            </h1>
            <p className="mt-4 text-sm text-white/70 sm:text-base">{subtitle}</p>
          </div>

          {notice ?? (
            <>
              <CycleToggle cycle={cycle} onChange={setCycle} />
              <DesktopTable {...props} cycle={cycle} />
              <MobileCards {...props} cycle={cycle} />
            </>
          )}

          {error && (
            <p
              role="alert"
              className="mx-auto mt-6 max-w-md rounded-md border border-red-400/40 bg-red-500/10 px-4 py-3 text-center text-sm text-red-300"
            >
              {error}
            </p>
          )}

          <p className="mt-10 text-center text-xs text-white/50">
            Payment is handled by Stripe. We never see your card details.
          </p>
          {footerExtra}
        </div>
      </main>
    </div>
  );
}

function CycleToggle({
  cycle,
  onChange,
}: {
  cycle: BillingCycle;
  onChange: (c: BillingCycle) => void;
}) {
  const options: { value: BillingCycle; label: string }[] = [
    { value: "monthly", label: "Monthly" },
    { value: "annual", label: "Yearly" },
  ];
  return (
    <div className="mt-8 flex justify-center">
      <div
        role="group"
        aria-label="Billing cycle"
        className="inline-flex rounded-full border border-white/15 bg-white/[0.05] p-1"
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            aria-pressed={cycle === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full px-5 py-1.5 text-sm font-semibold motion-safe:transition-colors",
              FOCUS,
              "focus-visible:ring-cyan-300",
              cycle === o.value
                ? "bg-gradient-to-r from-teal-400 to-blue-500 text-white"
                : "text-white/60 hover:text-white"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── Shared pieces ───────────────────────────── */

function CellMark({
  plan,
  index,
  row,
}: {
  plan: ComparisonPlan;
  index: number;
  row: PricingTableSection["rows"][number];
}) {
  const view = cellView(row.cells[plan.id], row.label);
  const accent = ACCENT[accentFor(index)];
  return (
    <>
      <span className="sr-only">{view.srText}</span>
      {view.kind === "included" && (
        <Check aria-hidden="true" className={cn("h-5 w-5", accent.check)} strokeWidth={2.5} />
      )}
      {view.kind === "excluded" && (
        <Minus aria-hidden="true" className="h-5 w-5 text-white/30" />
      )}
      {view.kind === "value" && (
        <span aria-hidden="true" className="text-sm font-semibold tabular-nums text-white">
          {view.text}
        </span>
      )}
    </>
  );
}

function RowLabel({ row }: { row: PricingTableSection["rows"][number] }) {
  const value = rowValueLabel(row.valueCents);
  return (
    <div className="min-w-0">
      <p className="text-sm text-white">
        {row.label}
        {value && (
          <span className="ml-2 whitespace-nowrap text-xs font-medium text-cyan-300">{value}</span>
        )}
      </p>
      {row.sublabel && <p className="mt-0.5 text-xs text-white/50">{row.sublabel}</p>}
    </div>
  );
}

function PriceBlock({
  plan,
  index,
  cycle,
  align,
}: {
  plan: ComparisonPlan;
  index: number;
  cycle: BillingCycle;
  align: "center" | "right";
}) {
  const lines = priceLines(plan, cycle);
  const accent = ACCENT[accentFor(index)];
  return (
    <div className={align === "center" ? "text-center" : "text-right"}>
      <p className="whitespace-nowrap">
        {lines.strike && (
          <>
            <span className="sr-only">Was </span>
            <s className="mr-2 text-sm text-white/40">{lines.strike}</s>
            <span className="sr-only">, now </span>
          </>
        )}
        <span className={cn("text-xl font-bold", accent.text)}>{lines.price}</span>
      </p>
      {lines.sub && <p className="mt-0.5 text-xs text-white/50">{lines.sub}</p>}
    </div>
  );
}

function ChooseButton({
  plan,
  index,
  cycle,
  busyPlanId,
  onChoose,
}: {
  plan: ComparisonPlan;
  index: number;
  cycle: BillingCycle;
  busyPlanId?: string | null;
  onChoose: (planId: string, cycle: BillingCycle) => void;
}) {
  const buyable = isPurchasable(plan, cycle);
  const busy = busyPlanId != null;
  const accent = ACCENT[accentFor(index)];
  return (
    <button
      type="button"
      onClick={() => onChoose(plan.id, cycle)}
      disabled={!buyable || busy}
      className={cn(
        "inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold motion-safe:transition-opacity",
        FOCUS,
        accent.ring,
        buyable
          ? cn(accent.button, "hover:opacity-90")
          : "cursor-not-allowed border border-white/15 text-white/50",
        busy && "opacity-50"
      )}
    >
      {busyPlanId === plan.id && (
        <Loader2 aria-hidden="true" className="h-4 w-4 motion-safe:animate-spin" />
      )}
      {buttonLabel(plan, cycle)}
    </button>
  );
}

/* ─────────────────────────────── Desktop ─────────────────────────────── */

/**
 * One CSS grid for the whole table: column 1 is the wide label panel, then one
 * narrow column per plan. Each section's panel and plan cards span the same
 * grid rows and use `subgrid`, so a row's label and every plan's mark share a
 * height and line up even when a label wraps.
 */
function DesktopTable({
  table,
  plans,
  annualNote,
  annualNoteValueCents,
  cycle,
  busyPlanId,
  onChoose,
}: PlanComparisonProps & { cycle: BillingCycle }) {
  const [included, bonus] = table.sections;
  const includedSpan = included.rows.length + 2;
  const bonusSpan = bonus.rows.length + 2;
  const priceRow = includedSpan + 1;
  const bonusStart = priceRow + 1;
  const buttonRow = bonusStart + bonusSpan;
  const label = sharedPriceLabel(plans);
  const noteValue =
    annualNoteValueCents != null ? `${formatCents(annualNoteValueCents)} Value` : null;

  return (
    <div
      className="mt-10 hidden gap-x-4 md:grid"
      style={{ gridTemplateColumns: `minmax(0,1fr) repeat(${plans.length}, minmax(9rem, 12rem))` }}
    >
      <SectionPanel section={included} start={1} span={includedSpan} />
      {plans.map((p, i) => (
        <PlanSectionCard key={p.id} section={included} plan={p} index={i} start={1} span={includedSpan} showName />
      ))}

      {/* Price row: unboxed, between the two sections. */}
      <div className="px-5 py-6" style={{ gridColumn: 1, gridRow: priceRow }}>
        {label && <p className="text-lg font-bold text-white">{label}</p>}
        {annualNote && (
          <p className="mt-1 text-sm text-white/70">
            Annual: {annualNote}
            {noteValue && (
              <span className="ml-2 whitespace-nowrap text-xs font-medium text-cyan-300">{noteValue}</span>
            )}
          </p>
        )}
      </div>
      {plans.map((p, i) => (
        <div
          key={p.id}
          role="group"
          aria-label={`${p.name} plan price`}
          className="flex items-center justify-center px-2 py-6"
          style={{ gridColumn: i + 2, gridRow: priceRow }}
        >
          <PriceBlock plan={p} index={i} cycle={cycle} align="center" />
        </div>
      ))}

      <SectionPanel section={bonus} start={bonusStart} span={bonusSpan} />
      {plans.map((p, i) => (
        <PlanSectionCard key={p.id} section={bonus} plan={p} index={i} start={bonusStart} span={bonusSpan} />
      ))}

      {plans.map((p, i) => (
        <div key={p.id} className="pt-5" style={{ gridColumn: i + 2, gridRow: buttonRow }}>
          <ChooseButton plan={p} index={i} cycle={cycle} busyPlanId={busyPlanId} onChoose={onChoose} />
        </div>
      ))}
    </div>
  );
}

function spanStyle(column: number, start: number, span: number): CSSProperties {
  return {
    gridColumn: column,
    gridRow: `${start} / span ${span}`,
    display: "grid",
    gridTemplateRows: "subgrid",
  };
}

function SectionPanel({
  section,
  start,
  span,
}: {
  section: PricingTableSection;
  start: number;
  span: number;
}) {
  return (
    <div className={cn(PANEL, "px-5")} style={spanStyle(1, start, span)}>
      <p className={cn(SMALL_CAPS, "flex items-end pb-3 pt-5 text-white/80")}>
        {SECTION_TITLE[section.section]}
      </p>
      {section.rows.map((row) => (
        <div key={row.id} className="flex items-center border-t border-white/10 py-3">
          <RowLabel row={row} />
        </div>
      ))}
      <p className={cn(SMALL_CAPS, "flex items-center border-t border-white/10 py-4 text-cyan-300")}>
        {SECTION_FOOTER[section.section]}
      </p>
    </div>
  );
}

function PlanSectionCard({
  section,
  plan,
  index,
  start,
  span,
  showName,
}: {
  section: PricingTableSection;
  plan: ComparisonPlan;
  index: number;
  start: number;
  span: number;
  showName?: boolean;
}) {
  const accent = ACCENT[accentFor(index)];
  return (
    <div
      role="group"
      aria-label={`${plan.name} plan: ${SECTION_TITLE[section.section].replace(/^\+/, "")}`}
      className={cn("rounded-xl border px-3", accent.card)}
      style={spanStyle(index + 2, start, span)}
    >
      <p
        className={cn(
          "flex items-end justify-center pb-3 pt-5 text-center font-bold uppercase tracking-wide",
          showName ? cn("text-base", accent.text) : "text-xs text-white/40"
        )}
      >
        {plan.name}
      </p>
      {section.rows.map((row) => (
        <div key={row.id} className="flex items-center justify-center border-t border-white/10 py-3">
          <CellMark plan={plan} index={index} row={row} />
        </div>
      ))}
      <p
        className={cn(
          "flex items-center justify-center border-t border-white/10 py-4 text-lg font-bold tabular-nums",
          accent.text
        )}
      >
        <span className="sr-only">{SECTION_FOOTER[section.section]}: </span>
        {planSectionTotal(section, plan.id)}
      </p>
    </div>
  );
}

/* ─────────────────────────────── Mobile ─────────────────────────────── */

function MobileCards({
  table,
  plans,
  annualNote,
  annualNoteValueCents,
  cycle,
  busyPlanId,
  onChoose,
}: PlanComparisonProps & { cycle: BillingCycle }) {
  const noteValue =
    annualNoteValueCents != null ? `${formatCents(annualNoteValueCents)} Value` : null;
  return (
    <div className="mt-8 space-y-6 md:hidden">
      {plans.map((plan, i) => {
        const accent = ACCENT[accentFor(i)];
        return (
          <section
            key={plan.id}
            aria-label={`${plan.name} plan`}
            className={cn("rounded-xl border p-5", accent.card)}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className={cn("text-lg font-bold uppercase tracking-wide", accent.text)}>
                {plan.name}
              </h2>
              <PriceBlock plan={plan} index={i} cycle={cycle} align="right" />
            </div>

            {table.sections.map((section) => (
              <div key={section.section} className="mt-5">
                <p className={cn(SMALL_CAPS, "text-white/80")}>{SECTION_TITLE[section.section]}</p>
                <ul className="mt-2">
                  {section.rows.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-3 border-t border-white/10 py-2.5"
                    >
                      <RowLabel row={row} />
                      <span className="shrink-0">
                        <CellMark plan={plan} index={i} row={row} />
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between border-t border-white/10 pt-3">
                  <span className={cn(SMALL_CAPS, "text-cyan-300")}>
                    {SECTION_FOOTER[section.section]}
                  </span>
                  <span className={cn("text-lg font-bold tabular-nums", accent.text)}>
                    {planSectionTotal(section, plan.id)}
                  </span>
                </div>
              </div>
            ))}

            {annualNote && (
              <p className="mt-5 text-sm text-white/70">
                <span className={cn(SMALL_CAPS, "mr-1 text-white/80")}>Annual payment:</span>
                {annualNote}
                {noteValue && (
                  <span className="ml-2 whitespace-nowrap text-xs font-medium text-cyan-300">
                    {noteValue}
                  </span>
                )}
              </p>
            )}

            <div className="mt-5">
              <ChooseButton plan={plan} index={i} cycle={cycle} busyPlanId={busyPlanId} onChoose={onChoose} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
