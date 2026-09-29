'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Minus, Send, Loader2, Mail, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MessageText } from './message-text';

/**
 * Workbook-grounded chat widget.
 *
 * MINIMISE KEEPS THE CONVERSATION. Minimising only hides the panel — state stays
 * mounted, and the transcript lives server-side anyway (chat_messages), so a
 * page reload or another device resumes the same thread via /api/chat/session.
 * Closing is the explicit end: it soft-closes the conversation server-side and
 * the next message starts fresh.
 *
 * Renders nothing at all when the super admin has chat switched off, or for
 * signed-out visitors — /api/chat/session answers { enabled: false } and this
 * returns null rather than showing a button that cannot work.
 */

type Message = { role: string; content: string; createdAt?: string };

type Usage = {
  usedToday: number;
  dailyCap: number;
  remaining: number;
  exhausted: boolean;
  disabled: boolean;
};

export function ChatWidget() {
  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [contactEmail, setContactEmail] = useState<string | null>(null);
  /**
   * Replies that landed while the panel was minimised.
   *
   * The request itself always completes when minimised — this component stays
   * mounted and only the panel is hidden — but without a count there was no way
   * to tell that an answer had arrived, so it looked like minimising cancelled
   * the reply.
   */
  const [unread, setUnread] = useState(0);
  /**
   * Expanded panel. Persisted in localStorage because it is a readability
   * preference, not conversation state — someone who needs the wider panel needs
   * it on every visit, and re-expanding each time would be tedious.
   */
  const [expanded, setExpanded] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * Read inside async callbacks so they see the CURRENT panel state rather than
   * whatever it was when the request started. A plain `open` capture would go
   * stale the moment the user minimised mid-reply — exactly the case this is for.
   */
  const openRef = useRef(open);
  useEffect(() => { openRef.current = open; }, [open]);

  // Restore the size preference. Read in an effect rather than in useState's
  // initialiser so the server and first client render agree — reading
  // localStorage during render is a hydration mismatch.
  useEffect(() => {
    try {
      setExpanded(localStorage.getItem('sam-chat-expanded') === '1');
    } catch {
      // Private mode or blocked storage: default width is fine.
    }
  }, []);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      try { localStorage.setItem('sam-chat-expanded', next ? '1' : '0'); } catch {}
      return next;
    });
  }, []);

  // Load availability + any in-progress conversation.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/chat/session', { credentials: 'same-origin' });
        if (!res.ok) return; // 401 for signed-out visitors: stay hidden.
        const body = await res.json();
        if (!active) return;
        setEnabled(body?.enabled === true);
        if (body?.enabled) {
          setConversationId(body.conversationId ?? null);
          setMessages(Array.isArray(body.messages) ? body.messages : []);
          setUsage(body.usage ?? null);
          setContactEmail(body.contactEmail ?? null);
        }
      } catch {
        // Stay hidden on failure rather than showing a broken affordance.
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => { active = false; };
  }, []);

  // Keep the newest message in view, and treat anything visible as read.
  useEffect(() => {
    if (!open) return;
    setUnread(0);
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open, sending]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    setError(null);
    setSending(true);
    // Optimistic: the user's own message appears immediately.
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    setInput('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, conversationId }),
      });

      let body: Record<string, unknown> = {};
      try { body = await res.json(); } catch { body = {}; }

      if (res.status === 429 && body.error === 'budget_exhausted') {
        setUsage({
          usedToday: Number(body.usedToday) || 0,
          dailyCap: Number(body.dailyCap) || 0,
          remaining: 0,
          exhausted: !body.disabled,
          disabled: body.disabled === true,
        });
        if (typeof body.contactEmail === 'string') setContactEmail(body.contactEmail);
        return;
      }

      if (!res.ok) {
        setError(
          typeof body.error === 'string' && body.error !== 'message'
            ? 'The assistant could not answer that. Please try again.'
            : 'Something went wrong. Please try again.'
        );
        return;
      }

      if (typeof body.conversationId === 'string') setConversationId(body.conversationId);
      setMessages((prev) => [...prev, { role: 'assistant', content: String(body.reply ?? '') }]);
      // Only count it as unread if the panel is shut RIGHT NOW, which is why
      // this reads the ref rather than the captured `open` value.
      if (!openRef.current) setUnread((n) => n + 1);

      const u = body.usage as { remaining?: number; dailyCap?: number } | undefined;
      if (u) {
        setUsage((prev) => ({
          usedToday: prev?.usedToday ?? 0,
          dailyCap: Number(u.dailyCap) || 0,
          remaining: Number(u.remaining) || 0,
          exhausted: false,
          disabled: false,
        }));
      }
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }, [input, sending, conversationId]);

  /** Explicit end: closes server-side so the next message is a new thread. */
  const endConversation = useCallback(async () => {
    setOpen(false);
    if (!conversationId) return;
    try {
      await fetch('/api/chat/session', { method: 'DELETE', credentials: 'same-origin' });
    } catch {
      // Non-fatal: the thread simply stays open server-side.
    }
    setConversationId(null);
    setMessages([]);
    setError(null);
  }, [conversationId]);

  if (!ready || !enabled) return null;

  const blocked = usage?.exhausted || usage?.disabled;

  return (
    <>
      {/* Launcher. Hidden while the panel is open. */}
      {!open && (
        <button
          type="button"
          onClick={() => { setOpen(true); setUnread(0); }}
          aria-label={
            unread > 0
              ? `Open the assistant, ${unread} new ${unread === 1 ? 'reply' : 'replies'}`
              : 'Open the assistant'
          }
          className="fixed bottom-5 right-5 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-white shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))] focus:ring-offset-2"
        >
          <MessageCircle className="h-5 w-5" />

          {/* Unread replies: red badge with a count. */}
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}

          {/* Still working: pulsing red dot, no count yet. */}
          {unread === 0 && sending && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full border-2 border-white bg-red-600"
            />
          )}
        </button>
      )}

      {open && (
        <div
          role="dialog"
          aria-label="SAM assistant"
          className={cn(
            'fixed bottom-5 right-5 z-50 flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card shadow-2xl',
            // Both sizes are viewport-clamped so the panel can never grow past
            // the screen on a laptop or phone.
            expanded
              ? 'h-[min(44rem,calc(100dvh-2.5rem))] w-[min(46rem,calc(100vw-2.5rem))]'
              : 'h-[32rem] w-[22rem] max-w-[calc(100vw-2.5rem)]'
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">
                SAM Assistant
              </p>
              <p className="text-xs text-[hsl(var(--foreground-muted))]">
                Answers from the SAM initiative library
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {/* Width toggle: long grounded answers are hard to read in a
                  narrow column, so the panel can be widened and the choice
                  remembered. */}
              <button
                type="button"
                onClick={toggleExpanded}
                aria-label={expanded ? 'Shrink the assistant' : 'Expand the assistant'}
                aria-pressed={expanded}
                className="rounded p-1.5 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))] hover:text-foreground"
              >
                {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>
              {/* Minimise: keeps the conversation exactly where it is. */}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Minimise the assistant"
                className="rounded p-1.5 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))] hover:text-foreground"
              >
                <Minus className="h-4 w-4" />
              </button>
              {/* End: explicit close, starts fresh next time. */}
              <button
                type="button"
                onClick={endConversation}
                aria-label="End this conversation"
                className="rounded p-1.5 text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))] hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Transcript */}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && !blocked && (
              <p className="py-6 text-center text-sm text-[hsl(var(--foreground-muted))]">
                Ask about any initiative — what it takes, what to expect, or where to start.
              </p>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-[var(--radius-md)] px-3 py-2 text-sm',
                  // Allow more of the extra width to be used when expanded,
                  // otherwise widening the panel just adds empty margins.
                  expanded ? 'max-w-[92%]' : 'max-w-[85%]',
                  m.role === 'user'
                    ? 'ml-auto whitespace-pre-wrap bg-[hsl(var(--primary))] text-white'
                    // --background-muted, NOT --muted: the latter is not defined
                    // in globals.css, so it resolved to nothing and these
                    // bubbles rendered with no background at all.
                    : 'mr-auto space-y-0.5 border border-[hsl(var(--border))] bg-[hsl(var(--background-muted))] text-[hsl(var(--foreground))]'
                )}
              >
                {/*
                  Assistant replies arrive in light markdown, so they are parsed
                  for **bold** and bullets. User messages are shown verbatim —
                  whatever they typed is what they meant.
                */}
                {m.role === 'assistant' ? <MessageText content={m.content} /> : m.content}
              </div>
            ))}

            {sending && (
              <div className="mr-auto flex items-center gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--border))] bg-[hsl(var(--background-muted))] px-3 py-2 text-sm text-[hsl(var(--foreground-muted))]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Thinking...
              </div>
            )}

            {error && (
              <p role="alert" className="text-xs text-[hsl(var(--destructive))]">
                {error}
              </p>
            )}
          </div>

          {/*
            Budget spent: replace the composer with a contact route rather than
            leaving an input that will only fail. Pooled across the whole account,
            so the wording avoids implying it is this user's personal limit.
          */}
          {blocked ? (
            <div className="border-t border-border px-4 py-3">
              <p className="text-xs text-[hsl(var(--foreground-muted))]">
                {usage?.disabled
                  ? 'Chat is not enabled for your account.'
                  : "Your account has used today's assistant allowance. It resets tomorrow."}
              </p>
              {contactEmail && (
                <a
                  href={`mailto:${contactEmail}?subject=${encodeURIComponent('SAM assistant — help request')}`}
                  className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-[hsl(var(--primary))] hover:underline"
                >
                  <Mail className="h-4 w-4" />
                  Email us instead
                </a>
              )}
            </div>
          ) : (
            <form
              onSubmit={(e) => { e.preventDefault(); send(); }}
              className="border-t border-border px-3 py-3"
            >
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends; Shift+Enter is a newline.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  rows={1}
                  placeholder="Ask about an initiative..."
                  aria-label="Message"
                  className="max-h-24 min-h-[2.25rem] flex-1 resize-none rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
                <button
                  type="submit"
                  disabled={sending || input.trim().length === 0}
                  aria-label="Send message"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[hsl(var(--primary))] text-white disabled:opacity-40"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
