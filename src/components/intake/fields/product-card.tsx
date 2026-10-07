"use client";

import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { NumberInput } from "@/components/ui/number-input";
import { formatMoney } from "@/lib/format-money";
import { productGoal } from "@/lib/intake-forecast";
import {
  DELIVERY_OPTIONS,
  FIELD_COPY,
  PRICE_TIER_OPTIONS,
  PRICING_MODEL_OPTIONS,
  PRICING_MODEL_RECURRING,
  PRODUCT_TYPE_OPTIONS,
  RECURRING_INTERVAL_OPTIONS,
  unitsGoalLabel,
} from "@/lib/intake/schema";
import type { ProductDraft } from "@/lib/intake/draft";
import type { FieldErrors } from "@/lib/intake/validation";
import { Field } from "./field";
import { PillSelect } from "./choice";

/**
 * One product card on screen 3 (REQ-6.3 to REQ-6.10).
 *
 * The live `product_goal` at the foot is calculated by `productGoal` from the
 * forecast module rather than inline, so the figure the user sees is produced
 * by the same tested function the plan is built from. An inline `price * units`
 * here would be a second implementation that could drift.
 */
export function ProductCard({
  index,
  product,
  periodMonths,
  errors,
  onChange,
  onRemove,
  canRemove,
}: {
  index: number;
  product: ProductDraft;
  periodMonths: number | null;
  errors: FieldErrors;
  onChange: (patch: Partial<ProductDraft>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const id = (field: string) => `product-${index}-${field}`;
  const pricingModel = asString(product.payment_type);
  const isRecurring = pricingModel === PRICING_MODEL_RECURRING;

  const goal = productGoal(
    asNumber(product.average_price),
    asNumber(product.units_in_period)
  );

  return (
    <div className="space-y-5 rounded-[var(--radius-lg)] border border-border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          Product {index + 1}
        </h3>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1 text-xs text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--destructive)_/_0.1)] hover:text-[hsl(var(--destructive))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Remove
          </button>
        )}
      </div>

      <Field
        htmlFor={id("name")}
        label={FIELD_COPY.product_name.label}
        required
        error={errors.name}
      >
        <Input
          id={id("name")}
          value={asString(product.name) ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Group coaching program"
          error={Boolean(errors.name)}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          htmlFor={id("type")}
          label={FIELD_COPY.product_type.label}
          error={errors.product_type}
        >
          <Select
            id={id("type")}
            value={asString(product.product_type) ?? ""}
            onChange={(e) => onChange({ product_type: e.target.value || null })}
          >
            <option value="">Choose one…</option>
            {PRODUCT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          htmlFor={id("delivery")}
          label={FIELD_COPY.delivery_mode.label}
          error={errors.delivery_mode}
        >
          <Select
            id={id("delivery")}
            value={asString(product.delivery_mode) ?? ""}
            onChange={(e) => onChange({ delivery_mode: e.target.value || null })}
          >
            <option value="">Choose one…</option>
            {DELIVERY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {/* Sub-labels carry the example ranges the spec asks for in a tooltip. */}
      <Field label={FIELD_COPY.price_level.label} error={errors.price_level}>
        <PillSelect
          name={id("price-level")}
          options={PRICE_TIER_OPTIONS}
          value={asString(product.price_level)}
          onChange={(value) => onChange({ price_level: value })}
        />
      </Field>

      <Field label={FIELD_COPY.payment_type.label} error={errors.payment_type}>
        <PillSelect
          name={id("payment-type")}
          options={PRICING_MODEL_OPTIONS}
          value={pricingModel}
          onChange={(value) =>
            onChange({
              payment_type: value,
              // Clearing the interval when leaving Recurring keeps the card
              // from holding an answer its own question no longer asks.
              recurring_interval:
                value === PRICING_MODEL_RECURRING ? product.recurring_interval : null,
            })
          }
        />
      </Field>

      {/* REQ-6.6 — revealed by Recurring only. */}
      {isRecurring && (
        <Field
          label="Billed"
          required
          error={errors.recurring_interval}
          className="pl-4 border-l-2 border-[hsl(var(--primary)_/_0.3)]"
        >
          <PillSelect
            name={id("interval")}
            options={RECURRING_INTERVAL_OPTIONS}
            value={asString(product.recurring_interval)}
            onChange={(value) => onChange({ recurring_interval: value })}
            error={Boolean(errors.recurring_interval)}
          />
        </Field>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          htmlFor={id("price")}
          label={FIELD_COPY.average_price.label}
          helper={FIELD_COPY.average_price.helper}
          required
          error={errors.average_price}
        >
          <NumberInput
            id={id("price")}
            value={asNumber(product.average_price)}
            onValueChange={(value) => onChange({ average_price: value })}
            placeholder="5,000"
            error={Boolean(errors.average_price)}
          />
        </Field>

        {/*
          REQ-6.9 — the label names the chosen period, and a recurring product
          is asked about subscribers instead. A hardcoded "in the next 12
          months" on a 6-month plan is a figure the user enters wrong rather
          than a label they notice.
        */}
        <Field
          htmlFor={id("units")}
          label={unitsGoalLabel(periodMonths, pricingModel)}
          required
          error={errors.units_in_period}
        >
          <NumberInput
            id={id("units")}
            value={asNumber(product.units_in_period)}
            onValueChange={(value) => onChange({ units_in_period: value })}
            placeholder="20"
            error={Boolean(errors.units_in_period)}
          />
        </Field>
      </div>

      {/* REQ-6.10 — calculated, read-only. */}
      <div className="flex items-baseline justify-between border-t border-border pt-4">
        <span className="text-sm text-[hsl(var(--foreground-muted))]">
          Product goal
        </span>
        <span className="text-lg font-semibold tabular-nums text-foreground">
          {formatMoney(goal)}
        </span>
      </div>
    </div>
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
