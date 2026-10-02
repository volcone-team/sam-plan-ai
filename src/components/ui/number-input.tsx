'use client';

import * as React from "react";
import { cn } from "@/lib/utils";
import {
  formatNumberInput,
  formatNumberValue,
  parseNumberInput,
  stripFormatting,
  caretPositionAfterFormat,
} from "@/lib/number-input";

export interface NumberInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type"
  > {
  /** Current value. `null` means "not answered", which is not the same as 0. */
  value: number | null | undefined;
  /** Called with the parsed number, or null when the field is cleared. */
  onValueChange: (value: number | null) => void;
  error?: boolean;
}

/**
 * Number field that shows thousands separators as you type: 1,000,000.
 *
 * WHY NOT `<input type="number">`: a number input rejects any value containing a
 * comma. The browser reports it as invalid and `e.target.value` comes back as an
 * empty string, so formatted text cannot be displayed in one at all. This is
 * therefore `type="text"` with `inputMode="numeric"`, which keeps the numeric
 * keypad on mobile while allowing separators on screen.
 *
 * What is deliberately preserved from the plain inputs this replaces:
 *   - the same visual styling as `Input`, so nothing shifts
 *   - `number | null` in and out, so callers and stored data are unchanged
 *   - null for an empty field, never 0 — the questionnaire distinguishes
 *     "unanswered" from "answered zero", and conflating them would change a
 *     validated form into a silently-passing one
 *
 * CARET HANDLING is the fiddly part. Reformatting on each keystroke moves the
 * text, and the browser would otherwise drop the cursor at the end of the field
 * — so editing the first digit of a long number flings you to the end on the
 * next keypress. The caret is restored by digit count (see
 * caretPositionAfterFormat) rather than character offset, because commas shift
 * as digits are added.
 */
const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ className, value, onValueChange, error, onBlur, ...props }, ref) => {
    // Local display string so partial input ("1,200." or "-") survives typing.
    // Reformatting straight from the numeric prop would erase a trailing
    // decimal point before its digits arrived.
    const [display, setDisplay] = React.useState(() => formatNumberValue(value));

    // Our own ref, needed to set the caret, merged with any forwarded one.
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) {
          (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
        }
      },
      [ref]
    );

    /**
     * Re-sync when the value changes from OUTSIDE this component (a form reset,
     * a loaded draft, a programmatic update).
     *
     * Guarded on the parsed display still differing from the incoming value, so
     * ordinary typing is never clobbered: while the user types, the parent's
     * value and the display already agree numerically, and overwriting here
     * would discard in-progress text like "1,200.".
     */
    React.useEffect(() => {
      const current = parseNumberInput(display);
      const incoming = value ?? null;
      if (current !== incoming) {
        setDisplay(formatNumberValue(value));
      }
      // `display` is intentionally omitted: including it would re-run this on
      // every keystroke and fight the user's own input.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawInput = e.target.value;
      const caret = e.target.selectionStart ?? rawInput.length;

      const formatted = formatNumberInput(rawInput);
      setDisplay(formatted);
      onValueChange(parseNumberInput(formatted));

      // Restore the caret after React paints the reformatted value.
      const nextCaret = caretPositionAfterFormat(formatted, caret, rawInput);
      requestAnimationFrame(() => {
        const el = innerRef.current;
        if (el) el.setSelectionRange(nextCaret, nextCaret);
      });
    };

    // Tidy up partial input on blur: "1,200." becomes "1,200", a lone "-" clears.
    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const parsed = parseNumberInput(display);
      setDisplay(formatNumberValue(parsed));
      onBlur?.(e);
    };

    return (
      <input
        type="text"
        // Numeric keypad on mobile while still permitting commas on screen.
        inputMode="numeric"
        autoComplete="off"
        className={cn(
          "flex h-10 w-full rounded-[var(--radius-md)] border bg-background px-3 py-2 text-sm",
          "placeholder:text-[hsl(var(--foreground-muted))]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "transition-colors duration-[var(--duration-default)]",
          error
            ? "border-[hsl(var(--invalid-border))] focus-visible:ring-[hsl(var(--invalid))]"
            : "border-input",
          className
        )}
        value={display}
        onChange={handleChange}
        onBlur={handleBlur}
        ref={setRefs}
        {...props}
      />
    );
  }
);
NumberInput.displayName = "NumberInput";

export interface NumberInputRawProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type"
  > {
  /** Raw string value, exactly as the caller stores it (digits only). */
  value: string;
  /** Receives the UNFORMATTED string, so existing parse/save logic is unchanged. */
  onValueChange: (value: string) => void;
  error?: boolean;
}

/**
 * String-state variant of NumberInput.
 *
 * Several screens predate this component and hold their input as a raw string
 * (`useState("")`), parsing it only on save — often with their own
 * `.trim() === ""` emptiness checks. Converting those to `number | null` would
 * mean rewriting working save paths for a purely visual change, so this variant
 * meets them where they are: it DISPLAYS grouped digits while handing back the
 * plain string the caller already expects.
 *
 * Formatting is display-only here. The value passed out never contains commas,
 * so `Number(value)` and `value.trim() === ""` keep behaving as before.
 */
const NumberInputRaw = React.forwardRef<HTMLInputElement, NumberInputRawProps>(
  ({ className, value, onValueChange, error, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) {
          (ref as React.MutableRefObject<HTMLInputElement | null>).current = node;
        }
      },
      [ref]
    );

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const rawInput = e.target.value;
      const caret = e.target.selectionStart ?? rawInput.length;
      const formatted = formatNumberInput(rawInput);

      // Hand back the digits only — the caller's own parsing is untouched.
      onValueChange(stripFormatting(formatted));

      const nextCaret = caretPositionAfterFormat(formatted, caret, rawInput);
      requestAnimationFrame(() => {
        const el = innerRef.current;
        if (el) el.setSelectionRange(nextCaret, nextCaret);
      });
    };

    return (
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        className={cn(
          error && "border-[hsl(var(--invalid-border))]",
          className
        )}
        // Derived straight from the prop: this field holds no local state, so
        // it cannot drift from the value the caller is about to save.
        value={formatNumberInput(value)}
        onChange={handleChange}
        ref={setRefs}
        {...props}
      />
    );
  }
);
NumberInputRaw.displayName = "NumberInputRaw";

export { NumberInput, NumberInputRaw };
