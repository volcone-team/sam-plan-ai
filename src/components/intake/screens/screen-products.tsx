"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format-money";
import { productsTotal } from "@/lib/intake-forecast";
import {
  DEFAULT_PLANNING_PERIOD,
  FIELD_COPY,
  PLANNING_PERIODS,
  PRODUCTS_TOTAL_LABEL,
  SINGLE_TIER_COACHING_LINE,
} from "@/lib/intake/schema";
import type { ProductDraft } from "@/lib/intake/draft";
import type { FieldErrors, IntakeAnswers } from "@/lib/intake/validation";
import { Field, FormError } from "../fields/field";
import { PillSelect } from "../fields/choice";
import { MonthSelect } from "../fields/month-select";
import { ProductCard } from "../fields/product-card";

/**
 * Screen 3 — products (REQ-6.1 to REQ-6.12).
 *
 * The period selectors sit ABOVE the cards because they change what the cards
 * ask: `units_in_period`'s label names the chosen period, so picking the period
 * afterwards would mean the user answered a different question than the one
 * they were shown.
 */
export function ScreenProducts({
  answers,
  setAnswer,
  products,
  setProducts,
  errors,
  rowErrors,
  formError,
}: {
  answers: IntakeAnswers;
  setAnswer: (field: string, value: unknown) => void;
  products: ProductDraft[];
  setProducts: (products: ProductDraft[]) => void;
  errors: FieldErrors;
  rowErrors: Record<number, FieldErrors>;
  formError: string | null;
}) {
  const periodMonths = asNumber(answers.horizon_months) ?? DEFAULT_PLANNING_PERIOD;

  const total = productsTotal(
    products.map((p) => ({
      averagePrice: asNumber(p.average_price),
      unitsInPeriod: asNumber(p.units_in_period),
    }))
  );

  const updateProduct = (index: number, patch: Partial<ProductDraft>) => {
    setProducts(products.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  return (
    <>
      {/*
        The period gets its own full-width row rather than sharing one with the
        start month. Four pills inside a half-width column would be about 60px
        each, which crops "12 months" — and this answer changes the labels on
        every product card below, so it is worth the space.
      */}
      <Field
        label={FIELD_COPY.horizon_months.label}
        required
        error={errors.horizon_months}
      >
        <PillSelect
          name="horizon_months"
          options={PLANNING_PERIODS.map((months) => ({
            value: String(months),
            label: `${months} months`,
          }))}
          value={String(periodMonths)}
          onChange={(value) => setAnswer("horizon_months", Number(value))}
          error={Boolean(errors.horizon_months)}
        />
      </Field>

      <Field
        htmlFor="plan_start_month"
        label={FIELD_COPY.plan_start_month.label}
        required
        error={errors.plan_start_month}
      >
        <MonthSelect
          id="plan_start_month"
          value={asString(answers.plan_start_month) ?? ""}
          onValueChange={(value) => setAnswer("plan_start_month", value || null)}
          placeholder="Choose a month…"
          error={Boolean(errors.plan_start_month)}
        />
      </Field>

      <div className="space-y-4">
        {products.map((product, index) => (
          <ProductCard
            // Index as key: the cards have no stable id until saved, and the
            // draft replaces its rows on every save. Reordering is not offered
            // on this screen, so the index is stable while it is mounted.
            key={index}
            index={index}
            product={product}
            periodMonths={periodMonths}
            errors={rowErrors[index] ?? {}}
            onChange={(patch) => updateProduct(index, patch)}
            onRemove={() =>
              setProducts(products.filter((_, i) => i !== index))
            }
            canRemove={products.length > 1}
          />
        ))}

        <FormError message={formError} />

        <Button
          type="button"
          variant="outline"
          onClick={() => setProducts([...products, {}])}
          className="w-full"
        >
          <Plus className="h-4 w-4" />
          Add another product
        </Button>
      </div>

      {/*
        REQ-6.11 — reference only. It never caps anything and never sets the
        revenue goal, which is why it is styled as a quiet summary rather than
        as a headline figure the user is meant to match.
      */}
      <div className="space-y-2 rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-foreground">
            {PRODUCTS_TOTAL_LABEL}
          </span>
          <span className="text-xl font-bold tabular-nums text-foreground">
            {formatMoney(total)}
          </span>
        </div>
        <p className="text-xs text-[hsl(var(--foreground-muted))]">
          For reference. You&apos;ll set your revenue goal on the next screen.
        </p>

        {/* REQ-6.12 — only when every product shares one tier. */}
        {sharesOneTier(products) && (
          <p className="border-t border-border pt-2 text-xs text-[hsl(var(--foreground-muted))]">
            {SINGLE_TIER_COACHING_LINE}
          </p>
        )}
      </div>
    </>
  );
}

/**
 * True when every product that HAS a tier shares the same one.
 *
 * Requires at least two products: a single product trivially shares its own
 * tier, and telling someone with one offer that their lineup lacks variety
 * before they have added a second is unhelpful rather than coaching.
 */
function sharesOneTier(products: readonly ProductDraft[]): boolean {
  const tiers = products
    .map((p) => asString(p.price_level))
    .filter((tier): tier is string => tier !== null);

  return tiers.length >= 2 && new Set(tiers).size === 1;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
