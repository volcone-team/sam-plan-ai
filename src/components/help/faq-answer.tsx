'use client';

import { linkifySegments } from '@/lib/faq/faq';
import { cn } from '@/lib/utils';

/**
 * Renders a plain-text FAQ answer: line breaks kept (`whitespace-pre-line`),
 * validated http(s) urls as links, everything else as React text (escaped).
 * Never interprets HTML or markdown. Used by the customer FAQ and the admin
 * preview so both show exactly the same thing.
 */
export function FaqAnswer({ text, className }: { text: string; className?: string }) {
  return (
    <p className={cn('whitespace-pre-line break-words', className)}>
      {linkifySegments(text).map((seg, i) =>
        seg.type === 'link' ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[hsl(var(--primary))] underline underline-offset-2 hover:opacity-80"
          >
            {seg.value}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <span key={i}>{seg.value}</span>
        )
      )}
    </p>
  );
}
