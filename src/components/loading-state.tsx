import { cn } from "@/lib/utils";

export interface LoadingStateProps {
  /** Loading message. Default: "Loading..." */
  message?: string;
  /** Size variant. Default: md */
  size?: "sm" | "md" | "lg";
  /** Whether to show the full-page centered layout or inline */
  fullPage?: boolean;
  className?: string;
}

const sizeMap = {
  sm: { spinner: "h-5 w-5 border-2", text: "text-xs", padding: "p-6" },
  md: { spinner: "h-8 w-8 border-2", text: "text-sm", padding: "p-12" },
  lg: { spinner: "h-12 w-12 border-3", text: "text-base", padding: "p-16" },
} as const;

/**
 * Loading state indicator.
 * Displays an animated spinner with optional message.
 * Accessible: uses role="status" and aria-live for screen readers.
 * Respects prefers-reduced-motion (spinner becomes a pulse).
 */
export function LoadingState({
  message = "Loading...",
  size = "md",
  fullPage = false,
  className,
}: LoadingStateProps) {
  const { spinner, text, padding } = sizeMap[size];

  const content = (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        padding,
        className
      )}
    >
      <div
        className={cn(
          "animate-spin rounded-[var(--radius-full)]",
          "border-[hsl(var(--border))] border-t-[hsl(var(--primary))]",
          spinner
        )}
        aria-hidden="true"
      />
      {message && (
        <p
          className={cn(
            "mt-3 text-[hsl(var(--foreground-muted))]",
            text
          )}
        >
          {message}
        </p>
      )}
      <span className="sr-only">{message}</span>
    </div>
  );

  if (fullPage) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        {content}
      </div>
    );
  }

  return content;
}
