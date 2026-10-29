'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  ChevronDown,
  CreditCard,
  HelpCircle,
  Layers,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { countFaqItems, filterFaq } from '@/lib/faq/faq';
import { FaqAnswer } from './faq-answer';
import type {
  FaqIcon,
  FaqPublicCategory,
  FaqPublicItem,
  FaqPublicResponse,
} from '@/types/faq.types';

/**
 * The customer FAQ. Content comes from GET /api/faq (admin-managed, published
 * only). Answers are plain text rendered by <FaqAnswer>, never as HTML.
 */

// ─── Icons ───────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<FaqIcon, LucideIcon> = {
  Rocket,
  CreditCard,
  Layers,
  ShieldCheck,
  HelpCircle,
  BookOpen,
  Settings,
  Users,
  BarChart3,
  Sparkles,
};

// ─── Loading ─────────────────────────────────────────────────────────────────

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not_ready' }
  | { kind: 'ready'; categories: FaqPublicCategory[] };

function useFaq(): { state: LoadState; retry: () => void } {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/faq', { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        if (res.status === 503) return setState({ kind: 'not_ready' });
        if (!res.ok) return setState({ kind: 'error' });
        const data = (await res.json()) as FaqPublicResponse;
        setState({ kind: 'ready', categories: data.categories });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setState({ kind: 'error' });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = () => {
    setState({ kind: 'loading' });
    setAttempt((n) => n + 1);
  };

  return { state, retry };
}

const actionClass =
  'inline-flex items-center gap-1.5 rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] focus-visible:ring-offset-2';

// ─── Accordion Item ──────────────────────────────────────────────────────────

function AccordionItem({
  item,
  isOpen,
  onToggle,
}: {
  item: FaqPublicItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const baseId = useId();
  const buttonId = `${baseId}-q`;
  const panelId = `${baseId}-a`;

  return (
    <div className="border-b border-[hsl(var(--border))] last:border-b-0">
      <h3>
        <button
          id={buttonId}
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          aria-controls={panelId}
          className="flex w-full items-center justify-between gap-4 py-4 px-1 text-left transition-colors hover:text-[hsl(var(--primary))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))] rounded-sm"
        >
          <span className="text-sm font-medium text-[hsl(var(--foreground))]">
            {item.question}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))] transition-transform duration-200',
              isOpen && 'rotate-180'
            )}
          />
        </button>
      </h3>
      <div id={panelId} role="region" aria-labelledby={buttonId} hidden={!isOpen}>
        <FaqAnswer
          text={item.answer}
          className="pb-4 px-1 text-sm leading-relaxed text-[hsl(var(--foreground-muted))]"
        />
      </div>
    </div>
  );
}

// ─── Category Section ────────────────────────────────────────────────────────

function CategorySection({ category }: { category: FaqPublicCategory }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const Icon = category.icon ? CATEGORY_ICONS[category.icon] : HelpCircle;
  const headingId = `faq-category-${category.id}`;
  const count = category.items.length;

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"
    >
      {/* Category Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.1)]">
          <Icon className="h-[18px] w-[18px] text-[hsl(var(--primary))]" aria-hidden="true" />
        </div>
        <h2 id={headingId} className="text-base font-semibold text-[hsl(var(--foreground))]">
          {category.name}
        </h2>
        <span className="ml-auto text-xs text-[hsl(var(--foreground-muted))]">
          {count} question{count === 1 ? '' : 's'}
        </span>
      </div>

      {/* Accordion Items */}
      <div>
        {category.items.map((item) => (
          <AccordionItem
            key={item.id}
            item={item}
            isOpen={openId === item.id}
            onToggle={() => setOpenId(openId === item.id ? null : item.id)}
          />
        ))}
      </div>
    </section>
  );
}

// ─── States ──────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <span className="sr-only" role="status">Loading FAQ…</span>
      <div className="h-10 animate-pulse rounded-lg bg-[hsl(var(--foreground-muted)/0.12)]" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="space-y-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6"
        >
          <div className="h-6 w-48 animate-pulse rounded bg-[hsl(var(--foreground-muted)/0.12)]" />
          {[0, 1, 2].map((j) => (
            <div key={j} className="h-5 animate-pulse rounded bg-[hsl(var(--foreground-muted)/0.12)]" />
          ))}
        </div>
      ))}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-10 text-center">
      <HelpCircle className="h-8 w-8 text-[hsl(var(--foreground-muted))]" aria-hidden="true" />
      {children}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function FaqPage() {
  const { state, retry } = useFaq();
  const [query, setQuery] = useState('');
  const searchId = useId();

  const categories = useMemo(() => (state.kind === 'ready' ? state.categories : []), [state]);
  const filtered = useMemo(() => filterFaq(categories, query), [categories, query]);

  if (state.kind === 'loading') return <LoadingSkeleton />;

  if (state.kind === 'not_ready') {
    return (
      <Notice>
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          Help articles are being set up. Check back soon.
        </p>
      </Notice>
    );
  }

  if (state.kind === 'error') {
    return (
      <Notice>
        <p role="alert" className="text-sm text-[hsl(var(--foreground-muted))]">
          We couldn&rsquo;t load the FAQ.
        </p>
        <button type="button" onClick={retry} className={actionClass}>
          Retry
        </button>
      </Notice>
    );
  }

  if (categories.length === 0) {
    return (
      <Notice>
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          No questions here yet. Can&apos;t find what you&apos;re looking for? Reach out to support.
        </p>
      </Notice>
    );
  }

  const searching = query.trim() !== '';
  const matches = countFaqItems(filtered);

  return (
    <div className="space-y-6">
      {/* Summary. The answer/category count was removed at the client's request. */}
      <p className="text-sm text-[hsl(var(--foreground-muted))]">
        Can&apos;t find what you&apos;re looking for? Reach out to support.
      </p>

      {/* Search */}
      <div role="search">
        <label htmlFor={searchId} className="sr-only">
          Search the FAQ
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--foreground-muted))]"
            aria-hidden="true"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search questions and answers"
            autoComplete="off"
            className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-2 pl-9 pr-9 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] outline-none focus:border-[hsl(var(--primary))] focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <p aria-live="polite" className={cn('mt-2 text-xs text-[hsl(var(--foreground-muted))]', !searching && 'sr-only')}>
          {searching ? `${matches} result${matches === 1 ? '' : 's'}` : ''}
        </p>
      </div>

      {/* Category Cards */}
      {searching && matches === 0 ? (
        <Notice>
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            No questions match &ldquo;{query.trim()}&rdquo;. Try different words, or reach out to support.
          </p>
        </Notice>
      ) : (
        <div className="space-y-6">
          {filtered.map((category) => (
            <CategorySection key={category.id} category={category} />
          ))}
        </div>
      )}
    </div>
  );
}
