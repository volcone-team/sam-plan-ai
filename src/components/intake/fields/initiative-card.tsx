"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import {
  CADENCE_OPTIONS,
  CADENCE_REPEAT,
  FIELD_COPY,
  REPEAT_FREQUENCY_OPTIONS,
  SOMETHING_ELSE_KEY,
} from "@/lib/intake/schema";
import {
  fromStoredStages,
  toInitiativeFunnel,
  type FunnelAnswers,
} from "@/lib/intake/funnel";
import type { InitiativeDraft, ProductDraft } from "@/lib/intake/draft";
import type { FieldErrors } from "@/lib/intake/validation";
import type { LibraryInitiative } from "@/lib/intake/library";
import { Field } from "./field";
import { ChipMultiSelect, PillSelect } from "./choice";
import { InitiativePicker } from "./initiative-picker";
import { FunnelFields } from "./funnel-fields";
import { MonthSelect } from "./month-select";

/**
 * One planned-initiative card on screen 5 (REQ-8.1 to REQ-8.12).
 *
 * Progressive disclosure throughout, because the full card is eleven fields and
 * most do not apply to most initiatives: the frequency appears only for "On
 * repeat", the funnel only once the user says they have run it before, and the
 * date only in the format they pick. Showing all of it at once would read as a
 * far longer form than it is.
 */

export interface InitiativeCardProps {
  index: number;
  initiative: InitiativeDraft;
  /** Screen 3's products, which this initiative sells (REQ-8.5). */
  products: readonly ProductDraft[];
  library: readonly LibraryInitiative[];
  hasEventProduct: boolean;
  errors: FieldErrors;
  onChange: (patch: Partial<InitiativeDraft>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export function InitiativeCard({
  index,
  initiative,
  products,
  library,
  hasEventProduct,
  errors,
  onChange,
  onRemove,
  canRemove,
}: InitiativeCardProps) {
  const id = (field: string) => `initiative-${index}-${field}`;

  const initiativeKey = asString(initiative.initiative_key);
  const cadence = asString(initiative.cadence);
  const ranBefore = initiative.has_run_before === true;

  /**
   * Which date format the user is entering (REQ-8.7).
   *
   * Local rather than stored: the columns are `start_month` and `exact_date`,
   * so whichever is populated tells us the format on reload. Persisting a
   * separate "mode" flag would be a third source of truth that could disagree
   * with both.
   */
  const [dateMode, setDateMode] = React.useState<"month" | "exact">(
    asString(initiative.exact_date) ? "exact" : "month"
  );

  /**
   * Products are offered as chips of their NAME, keyed by index.
   *
   * Index-keyed because an unsaved product has no id yet, and screen 5 can be
   * reached before the draft has been written. The draft's save path maps these
   * onto real `intake_products` ids.
   */
  const productOptions = products
    .map((product, productIndex) => ({
      value: String(productIndex),
      label: asString(product.name) ?? `Product ${productIndex + 1}`,
    }))
    .filter((option) => option.label.trim() !== "");

  const funnelAnswers: FunnelAnswers = fromStoredStages(
    asNumber(initiative.audience_reached),
    Array.isArray(initiative.funnel_stages)
      ? (initiative.funnel_stages as { key: string; percent: number | null }[])
      : [],
    asNumber(initiative.average_price)
  );

  const setFunnel = (next: FunnelAnswers) => {
    const funnel = toInitiativeFunnel(initiativeKey, next);
    onChange({
      audience_reached: funnel.audienceReached,
      funnel_stages: funnel.stages,
      average_price: funnel.averagePrice,
    });
  };

  return (
    <div className="space-y-5 rounded-[var(--radius-lg)] border border-border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">
          Initiative {index + 1}
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
        htmlFor={id("key")}
        label={FIELD_COPY.initiative_key.label}
        required
        error={errors.initiative_key}
      >
        <InitiativePicker
          id={id("key")}
          initiatives={library}
          value={initiativeKey}
          onChange={(key) =>
            onChange({
              initiative_key: key,
              // The library name is captured as answered, so a renamed entry
              // does not silently change what the user said they picked.
              initiative_label:
                library.find((entry) => entry.key === key)?.name ?? null,
              // Clearing the custom label when moving off "Something else"
              // keeps `needs_review` from being set by a stale answer.
              custom_label: key === SOMETHING_ELSE_KEY ? initiative.custom_label : null,
            })
          }
          hasEventProduct={hasEventProduct}
          error={Boolean(errors.initiative_key)}
        />
      </Field>

      {/* REQ-8.1 — the free text behind "Something else", flagged for review. */}
      {initiativeKey === SOMETHING_ELSE_KEY && (
        <Field
          htmlFor={id("custom")}
          label="What is it?"
          required
          error={errors.custom_label}
          className="pl-4 border-l-2 border-[hsl(var(--primary)_/_0.3)]"
        >
          <Input
            id={id("custom")}
            value={asString(initiative.custom_label) ?? ""}
            onChange={(e) => onChange({ custom_label: e.target.value })}
            placeholder="Direct mail campaign"
            error={Boolean(errors.custom_label)}
          />
        </Field>
      )}

      {/* REQ-8.5 — one initiative may sell more than one product. */}
      <Field
        label={FIELD_COPY.product_ids.label}
        required
        error={errors.product_ids}
      >
        {productOptions.length === 0 ? (
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            Go back and name at least one product first.
          </p>
        ) : (
          <ChipMultiSelect
            name={id("products")}
            options={productOptions}
            value={toStringArray(initiative.product_ids)}
            onChange={(value) => onChange({ product_ids: value })}
            error={Boolean(errors.product_ids)}
          />
        )}
      </Field>

      <Field label={FIELD_COPY.cadence.label} error={errors.cadence}>
        <PillSelect
          name={id("cadence")}
          options={CADENCE_OPTIONS}
          value={cadence}
          onChange={(value) =>
            onChange({
              cadence: value,
              // A frequency on a one-off is an answer to a question no longer
              // being asked.
              repeat_frequency:
                value === CADENCE_REPEAT ? initiative.repeat_frequency : null,
            })
          }
        />
      </Field>

      {/* REQ-8.6 — revealed by "On repeat" only. */}
      {cadence === CADENCE_REPEAT && (
        <Field
          label="How often?"
          required
          error={errors.repeat_frequency}
          className="pl-4 border-l-2 border-[hsl(var(--primary)_/_0.3)]"
        >
          <PillSelect
            name={id("frequency")}
            options={REPEAT_FREQUENCY_OPTIONS}
            value={asString(initiative.repeat_frequency)}
            onChange={(value) => onChange({ repeat_frequency: value })}
            error={Boolean(errors.repeat_frequency)}
          />
        </Field>
      )}

      {/*
        REQ-8.7 — optional, and the helper says so. Undated initiatives get
        placed by the generator and confirmed on the calendar, so pressing for a
        date here would be asking for a decision the user cannot yet make.
      */}
      <Field
        label={cadence === "once" ? "When is it?" : FIELD_COPY.start_month.label}
        helper={FIELD_COPY.start_month.helper}
        helperItalic
        error={errors.start_month}
      >
        <div className="space-y-2">
          <PillSelect
            name={id("date-mode")}
            options={[
              { value: "month", label: "Month" },
              { value: "exact", label: "Exact date" },
            ]}
            value={dateMode}
            onChange={(value) => {
              const mode = value as "month" | "exact";
              setDateMode(mode);
              // Only one column is meaningful at a time; the other is cleared
              // so a stored answer cannot contradict the visible field.
              onChange(
                mode === "month" ? { exact_date: null } : { start_month: null }
              );
            }}
          />

          {dateMode === "month" ? (
            <MonthSelect
              value={asString(initiative.start_month) ?? ""}
              onValueChange={(value) => onChange({ start_month: value || null })}
              placeholder="Not sure yet"
              className="sm:max-w-xs"
            />
          ) : (
            <DateInput
              value={asString(initiative.exact_date) ?? ""}
              onValueChange={(value) => onChange({ exact_date: value || null })}
              className="sm:max-w-xs"
            />
          )}
        </div>
      </Field>

      <Field label={FIELD_COPY.has_run_before.label} error={errors.has_run_before}>
        <PillSelect
          name={id("ran-before")}
          options={[
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]}
          value={
            initiative.has_run_before === true
              ? "yes"
              : initiative.has_run_before === false
                ? "no"
                : null
          }
          onChange={(value) => onChange({ has_run_before: value === "yes" })}
        />
      </Field>

      {/* REQ-8.9 — the funnel appears only once they say they have run it. */}
      {ranBefore && (
        <Field label="What happened last time?" error={undefined}>
          <FunnelFields
            idPrefix={id("funnel")}
            initiativeKey={initiativeKey}
            answers={funnelAnswers}
            onChange={setFunnel}
            errors={errors}
          />
        </Field>
      )}
    </div>
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** True when any product is an Event, which unlocks Ticket Map (REQ-8.3). */
export function hasEventProduct(products: readonly ProductDraft[]): boolean {
  return products.some((product) => product.product_type === "event");
}
