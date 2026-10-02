'use client';

import * as React from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDictation } from "@/hooks/use-dictation";

export interface DictationTextareaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> {
  value: string;
  onValueChange: (value: string) => void;
  error?: boolean;
}

/**
 * Textarea with optional voice input.
 *
 * Long free-text answers are the ones people most often skip, and speaking is
 * faster than typing. The microphone appends finalised phrases to whatever is
 * already in the field, so dictation and typing can be mixed freely rather than
 * one replacing the other.
 *
 * The button is RENDERED ONLY where the browser supports recognition (Chrome,
 * Edge, Safari — not Firefox). A control that appears but cannot work is worse
 * than no control, so on an unsupported browser this is exactly the plain
 * textarea it replaces, with identical styling and behaviour.
 */
const DictationTextarea = React.forwardRef<HTMLTextAreaElement, DictationTextareaProps>(
  ({ className, value, onValueChange, error, ...props }, ref) => {
    // Appends rather than overwrites, and inserts a separating space only when
    // one is actually needed, so dictating twice does not run words together.
    const appendTranscript = React.useCallback(
      (text: string) => {
        const separator = !value || /\s$/.test(value) ? "" : " ";
        onValueChange(`${value}${separator}${text}`);
      },
      [value, onValueChange]
    );

    const { supported, listening, error: dictationError, toggle } =
      useDictation(appendTranscript);

    return (
      <div className="space-y-1.5">
        <div className="relative">
          <textarea
            className={cn(
              "flex min-h-[80px] w-full rounded-[var(--radius-md)] border bg-background px-3 py-2 text-sm",
              "placeholder:text-[hsl(var(--foreground-muted))]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed disabled:opacity-50",
              "transition-colors duration-[var(--duration-default)]",
              // Room for the button so typed text cannot run underneath it.
              supported && "pr-11",
              error
                ? "border-[hsl(var(--invalid-border))] focus-visible:ring-[hsl(var(--invalid))]"
                : "border-input",
              className
            )}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            ref={ref}
            {...props}
          />

          {supported && (
            <button
              type="button"
              onClick={toggle}
              // Explicit label and pressed state: the icon alone conveys
              // nothing to a screen reader, and the control is a toggle.
              aria-label={listening ? "Stop voice input" : "Start voice input"}
              aria-pressed={listening}
              title={listening ? "Stop dictating" : "Dictate your answer"}
              className={cn(
                "absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)]",
                "transition-colors duration-[var(--duration-default)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                listening
                  ? "bg-[hsl(var(--destructive)_/_0.1)] text-[hsl(var(--destructive))]"
                  : "text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))] hover:text-foreground"
              )}
            >
              {listening ? (
                <MicOff className="h-3.5 w-3.5" />
              ) : (
                <Mic className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>

        {/* aria-live so the state change is announced, not just shown. */}
        {listening && (
          <p
            className="flex items-center gap-1.5 text-xs text-[hsl(var(--destructive))]"
            aria-live="polite"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[hsl(var(--destructive))] opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[hsl(var(--destructive))]" />
            </span>
            Listening — speak now, then press the icon to stop.
          </p>
        )}

        {dictationError && (
          <p className="text-xs text-[hsl(var(--destructive))]" role="alert">
            {dictationError}
          </p>
        )}
      </div>
    );
  }
);
DictationTextarea.displayName = "DictationTextarea";

export { DictationTextarea };
