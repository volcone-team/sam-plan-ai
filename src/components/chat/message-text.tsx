import { Fragment } from 'react';

/**
 * Minimal inline formatter for assistant replies.
 *
 * The model answers in light markdown (**bold**, `- ` bullets), which previously
 * rendered as literal asterisks on screen. This handles just the two constructs
 * that actually appear rather than pulling in a markdown library: a full parser
 * would also need sanitising, since the output is model-generated text being
 * placed into the DOM.
 *
 * Everything is rendered as TEXT — no HTML is ever interpreted — so a reply
 * containing markup cannot inject anything into the page.
 */

/** Split on **bold** spans, leaving other asterisks alone. */
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <Fragment key={`${keyPrefix}-t${i}`}>{part}</Fragment>;
  });
}

export function MessageText({ content }: { content: string }) {
  const lines = content.split('\n');

  return (
    <>
      {lines.map((line, i) => {
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);

        if (bullet) {
          return (
            <span key={i} className="flex gap-1.5">
              <span aria-hidden="true" className="select-none">•</span>
              <span>{renderInline(bullet[1], `l${i}`)}</span>
            </span>
          );
        }

        // Blank line: preserve the paragraph break the model intended.
        if (line.trim() === '') return <span key={i} className="block h-2" />;

        return <span key={i} className="block">{renderInline(line, `l${i}`)}</span>;
      })}
    </>
  );
}
