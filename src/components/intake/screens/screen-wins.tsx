"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DictationTextarea } from "@/components/ui/dictation-textarea";
import { FIELD_COPY } from "@/lib/intake/schema";
import {
  fromStoredStages,
  toInitiativeFunnel,
  type FunnelAnswers,
} from "@/lib/intake/funnel";
import { labelFor, type LibraryInitiative } from "@/lib/intake/library";
import type { InitiativeDraft } from "@/lib/intake/draft";
import type { FieldErrors, IntakeAnswers } from "@/lib/intake/validation";
import { trackIntakeEvent, voiceUsed } from "@/lib/intake/events";
import type { PlanPath } from "@/lib/intake/flow";
import { Field, FormError } from "../fields/field";
import { InitiativePicker } from "../fields/initiative-picker";
import { FunnelFields } from "../fields/funnel-fields";

/**
 * Screen 6 — wins and struggles (REQ-9.1 to REQ-9.6).
 *
 * This screen is how the generator learns what NOT to recommend: a `failed`
 * entry excludes that initiative outright (REQ-13.8). That makes it the highest
 * value screen per field in the intake, and the reason nothing on it is
 * required — a user with no history still has a usable plan, while a user
 * forced to invent an answer poisons the recommendations.
 *
 * EVERY selected win expands its own funnel (REQ-9.3), not one at a time. A
 * user who picks a webinar and an email campaign is asked about both.
 */
export function ScreenWins({
  answers,
  setAnswer,
  initiatives,
  setInitiatives,
  library,
  libraryLoading,
  libraryError,
  errors,
  path,
}: {
  answers: IntakeAnswers;
  setAnswer: (field: string, value: unknown) => void;
  initiatives: InitiativeDraft[];
  setInitiatives: (initiatives: InitiativeDraft[]) => void;
  library: readonly LibraryInitiative[];
  libraryLoading: boolean;
  libraryError: string | null;
  errors: FieldErrors;
  path: PlanPath | null;
}) {
  const worked = initiatives.filter((i) => i.source === "worked");
  const failed = initiatives.filter((i) => i.source === "failed");

  /**
   * REQ-9.2 — hide anything already given results on screen 5.
   *
   * The user has entered those figures once; asking again reads as the form not
   * having listened, and two sets of numbers for one initiative would then have
   * to be reconciled.
   */
  const alreadyAnswered = React.useMemo(
    () =>
      initiatives
        .filter((i) => (i.source ?? "planned") === "planned" && i.has_run_before === true)
        .map((i) => asString(i.initiative_key))
        .filter((key): key is string => key !== null),
    [initiatives]
  );

  const addRow = (source: "worked" | "failed", key: string) => {
    setInitiatives([
      ...initiatives,
      {
        source,
        initiative_key: key,
        initiative_label: library.find((entry) => entry.key === key)?.name ?? null,
      },
    ]);
  };

  const updateRow = (target: InitiativeDraft, patch: Partial<InitiativeDraft>) => {
    setInitiatives(
      initiatives.map((item) => (item === target ? { ...item, ...patch } : item))
    );
  };

  const removeRow = (target: InitiativeDraft) => {
    setInitiatives(initiatives.filter((item) => item !== target));
  };

  if (libraryLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2
          className="h-5 w-5 animate-spin text-[hsl(var(--foreground-muted))]"
          aria-label="Loading initiatives"
        />
      </div>
    );
  }

  if (libraryError) return <FormError message={libraryError} />;

  const chosenKeys = [...worked, ...failed]
    .map((i) => asString(i.initiative_key))
    .filter((key): key is string => key !== null);

  return (
    <>
      <Field label={FIELD_COPY.worked_initiatives.label} error={errors.worked_initiatives}>
        <div className="space-y-4">
          {worked.map((row, index) => (
            <WinRow
              key={`worked-${index}`}
              row={row}
              library={library}
              idPrefix={`worked-${index}`}
              onChange={(patch) => updateRow(row, patch)}
              onRemove={() => removeRow(row)}
            />
          ))}

          <InitiativePicker
            initiatives={library}
            value={null}
            onChange={(key) => key && addRow("worked", key)}
            // Already-chosen rows plus screen 5's answers (REQ-9.2).
            exclude={[...chosenKeys, ...alreadyAnswered]}
            allowSomethingElse={false}
            placeholder="Search what's driven sales…"
          />
        </div>
      </Field>

      <Field
        htmlFor="what_worked_notes"
        label={FIELD_COPY.what_worked_notes.label}
        error={errors.what_worked_notes}
      >
        <DictationTextarea
          id="what_worked_notes"
          value={asString(answers.what_worked_notes) ?? ""}
          onValueChange={(value) => setAnswer("what_worked_notes", value)}
          placeholder="Our webinars convert best when we run them right after a podcast appearance."
          rows={3}
          onFocus={() => void trackIntakeEvent(voiceUsed("wins", "what_worked_notes", path))}
        />
      </Field>

      {/*
        REQ-9.5 and REQ-13.8 — this list is a hard exclusion on the
        recommendations, which is why each entry gets a "Why?" rather than just
        being recorded.
      */}
      <Field label={FIELD_COPY.didnt_work.label} error={errors.didnt_work}>
        <div className="space-y-3">
          {failed.map((row, index) => (
            <FailedRow
              key={`failed-${index}`}
              row={row}
              library={library}
              onChange={(patch) => updateRow(row, patch)}
              onRemove={() => removeRow(row)}
            />
          ))}

          <InitiativePicker
            initiatives={library}
            value={null}
            onChange={(key) => key && addRow("failed", key)}
            exclude={chosenKeys}
            allowSomethingElse={false}
            placeholder="Search what didn't work…"
          />
        </div>
      </Field>
    </>
  );
}

/** A win, with its own funnel expanded (REQ-9.3). */
function WinRow({
  row,
  library,
  idPrefix,
  onChange,
  onRemove,
}: {
  row: InitiativeDraft;
  library: readonly LibraryInitiative[];
  idPrefix: string;
  onChange: (patch: Partial<InitiativeDraft>) => void;
  onRemove: () => void;
}) {
  const key = asString(row.initiative_key);
  const entry = library.find((i) => i.key === key);

  const funnelAnswers: FunnelAnswers = fromStoredStages(
    asNumber(row.audience_reached),
    Array.isArray(row.funnel_stages)
      ? (row.funnel_stages as { key: string; percent: number | null }[])
      : [],
    asNumber(row.average_price)
  );

  return (
    <div className="space-y-3 rounded-[var(--radius-lg)] border border-border p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          {entry ? labelFor(entry, library) : (key ?? "Unknown")}
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-[var(--radius-md)] px-2 py-1 text-xs text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--destructive)_/_0.1)] hover:text-[hsl(var(--destructive))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Remove
        </button>
      </div>

      <FunnelFields
        idPrefix={idPrefix}
        initiativeKey={key}
        answers={funnelAnswers}
        onChange={(next) => {
          const funnel = toInitiativeFunnel(key, next);
          onChange({
            audience_reached: funnel.audienceReached,
            funnel_stages: funnel.stages,
            average_price: funnel.averagePrice,
          });
        }}
      />
    </div>
  );
}

/** A failure, with an optional reason (REQ-9.6). */
function FailedRow({
  row,
  library,
  onChange,
  onRemove,
}: {
  row: InitiativeDraft;
  library: readonly LibraryInitiative[];
  onChange: (patch: Partial<InitiativeDraft>) => void;
  onRemove: () => void;
}) {
  const key = asString(row.initiative_key);
  const entry = library.find((i) => i.key === key);

  return (
    <div className="space-y-2 rounded-[var(--radius-lg)] border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          {entry ? labelFor(entry, library) : (key ?? "Unknown")}
        </p>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-[var(--radius-md)] px-2 py-1 text-xs text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--destructive)_/_0.1)] hover:text-[hsl(var(--destructive))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Remove
        </button>
      </div>

      <Input
        value={asString(row.failure_reason) ?? ""}
        onChange={(e) => onChange({ failure_reason: e.target.value })}
        placeholder="Why? (optional)"
        aria-label={`Why didn't ${entry?.name ?? "this"} work?`}
      />
    </div>
  );
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
