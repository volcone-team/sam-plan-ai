import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Single loading indicator for the whole app.
 *
 * Exists because loading states had drifted: some panels showed a bare spinner,
 * others a spinner plus prose like "Loading billing...", so moving between admin
 * tabs looked like moving between different applications. One component keeps
 * them identical.
 *
 * Coloured with the primary token rather than inheriting muted text, so it is
 * visible against both card and page backgrounds in dark mode.
 */
export function Spinner({
  size = 'md',
  className,
  label = 'Loading',
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Announced to screen readers; never rendered as visible text. */
  label?: string;
}) {
  const dimension = size === 'sm' ? 'h-4 w-4' : size === 'lg' ? 'h-8 w-8' : 'h-6 w-6';

  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn('animate-spin text-[hsl(var(--primary))]', dimension, className)}
    />
  );
}

/**
 * Centred spinner for a panel that has nothing to show yet.
 *
 * Deliberately WITHOUT a text label: a spinner already means "loading", and
 * per-panel wording was the inconsistency this replaces.
 */
export function LoadingPanel({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-12', className)}>
      <Spinner size="lg" />
    </div>
  );
}
