"use client";

import * as React from "react";
import { Lightbulb, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared field furniture for the intake: label, helper, error, required mark.
 *
 * One component rather than hand-rolled markup per screen, because ten screens
 * each repeating this structure is ten chances for the required asterisk, the
 * error wiring or the label association to drift. The accessibility plumbing in
 * particular — `htmlFor`, `aria-describedby`, `role="alert"` — is the kind of
 * thing that gets omitted when it is retyped.
 */

export interface FieldProps {
  /** Must match the control's `id` so clicking the label focuses it. */
  htmlFor?: string;
  label: string;
  /** Grey line under the label. */
  helper?: string;
  /** Rendered italic, for the spec's italic helpers. */
  helperItalic?: boolean;
  required?: boolean;
  /** Validation message. Its presence is what marks the field invalid. */
  error?: string;
  /** Hover explanation on the label. */
  tooltip?: string;
  className?: string;
  children: React.ReactNode;
}

export function Field({
  htmlFor,
  label,
  helper,
  helperItalic,
  required,
  error,
  tooltip,
  className,
  children,
}: FieldProps) {
  // Derived ids so the control can point at whichever of these exist.
  const helperId = helper && htmlFor ? `${htmlFor}-helper` : undefined;
  const errorId = error && htmlFor ? `${htmlFor}-error` : undefined;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="space-y-1">
        <label
          htmlFor={htmlFor}
          className="flex items-start gap-1.5 text-sm font-medium text-foreground"
        >
          <span>
            {label}
            {required && (
              // Marked for sighted users and named for screen readers, since a
              // bare asterisk conveys nothing when read aloud.
              <span
                className="ml-0.5 text-[hsl(var(--destructive))]"
                aria-label="required"
              >
                *
              </span>
            )}
          </span>
          {tooltip && (
            <span
              className="mt-0.5 inline-flex cursor-help text-[hsl(var(--foreground-muted))]"
              title={tooltip}
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only">{tooltip}</span>
            </span>
          )}
        </label>

        {helper && (
          <p
            id={helperId}
            className={cn(
              "text-xs text-[hsl(var(--foreground-muted))]",
              helperItalic && "italic"
            )}
          >
            {helper}
          </p>
        )}
      </div>

      {/*
        The control is cloned rather than wrapped so the error and helper ids
        reach it without every screen having to wire them up by hand.
      */}
      {describeChild(children, { helperId, errorId, invalid: Boolean(error) })}

      {error && (
        // role="alert" so the message is announced when it appears, not only
        // when the field is next focused.
        <p
          id={errorId}
          role="alert"
          className="text-xs text-[hsl(var(--destructive))]"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Attach `aria-describedby` and `aria-invalid` to a single child control.
 *
 * Skipped for fragments and multiple children — a chip group or card set has no
 * one element to describe, and guessing would put the attributes on a wrapper
 * where they mean nothing.
 */
function describeChild(
  children: React.ReactNode,
  { helperId, errorId, invalid }: { helperId?: string; errorId?: string; invalid: boolean }
): React.ReactNode {
  if (!React.isValidElement(children)) return children;

  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;
  if (!describedBy && !invalid) return children;

  const existing = (children.props as { "aria-describedby"?: string })[
    "aria-describedby"
  ];

  return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    "aria-describedby": [existing, describedBy].filter(Boolean).join(" ") || undefined,
    "aria-invalid": invalid || undefined,
  });
}

/**
 * The lightbulb helper line under a screen's subtitle (REQ-2.9).
 *
 * Shown on every screen except 0, 5 and 9. `flow.ts` owns that decision so the
 * rule lives in one tested place rather than as three conditionals in markup.
 */
export function HelperLine({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 text-sm text-[hsl(var(--foreground-muted))]">
      <Lightbulb
        className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]"
        aria-hidden="true"
      />
      <span>{text}</span>
    </p>
  );
}

/** A screen's title, subtitle and helper line, in the spec's order. */
export function ScreenHeader({
  title,
  subtitle,
  helperLine,
}: {
  title: string;
  subtitle?: string;
  helperLine?: string;
}) {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h1>
      {subtitle && (
        <p className="text-sm text-[hsl(var(--foreground-muted))] sm:text-base">
          {subtitle}
        </p>
      )}
      {helperLine && <HelperLine text={helperLine} />}
    </div>
  );
}

/** Error that belongs to a whole section rather than one field. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-[var(--radius-md)] border border-[hsl(var(--invalid-border))] bg-[hsl(var(--invalid)_/_0.08)] px-3 py-2 text-sm text-[hsl(var(--destructive))]"
    >
      {message}
    </p>
  );
}
