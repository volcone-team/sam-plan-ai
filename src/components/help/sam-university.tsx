'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  Clock,
  ExternalLink,
  FileDown,
  FileText,
  GraduationCap,
  Lightbulb,
  Link2,
  Lock,
  PlayCircle,
  Rocket,
  Sparkles,
  Target,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermission } from '@/hooks/use-permission';
import {
  UPGRADE_HREF,
  formatDuration,
  moduleCount,
  resourceAction,
  resourceTypeLabel,
  summariseCatalogue,
  unlockLabel,
} from '@/lib/university/view-helpers';
import type { UniversityCatalogueResponse } from '@/lib/university/catalogue';
import type {
  UniversityCategoryView,
  UniversityIcon,
  UniversityResourceType,
  UniversityResourceView,
} from '@/types/university.types';

/**
 * SAM University — the customer catalogue.
 *
 * Everything comes from GET /api/university, which builds views server-side:
 * a locked or coming-soon resource arrives with `url: null`, so this component
 * can only ever link to what the viewer is allowed to open.
 */

// ─── Icons ───────────────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<UniversityIcon, LucideIcon> = {
  BookOpen,
  GraduationCap,
  BarChart3,
  CalendarCheck,
  Sparkles,
  Video,
  FileText,
  Lightbulb,
  Target,
  Rocket,
};

const TYPE_ICONS: Record<UniversityResourceType, LucideIcon> = {
  video: PlayCircle,
  article: FileText,
  pdf: FileDown,
  link: Link2,
};

// ─── Loading ─────────────────────────────────────────────────────────────────

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'not_ready' }
  | { kind: 'ready'; data: UniversityCatalogueResponse };

function useCatalogue(): { state: LoadState; retry: () => void } {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/university', { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        if (res.status === 503) return setState({ kind: 'not_ready' });
        if (!res.ok) return setState({ kind: 'error' });
        const data = (await res.json()) as UniversityCatalogueResponse;
        setState({ kind: 'ready', data });
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

// ─── Small pieces ────────────────────────────────────────────────────────────

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>
      {children}
    </span>
  );
}

function FreeBadge() {
  return (
    <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      Free
    </Badge>
  );
}

function PlanBadge({ name }: { name: string }) {
  return (
    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">{name}</Badge>
  );
}

function ComingSoonBadge() {
  return (
    <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
      Coming soon
    </Badge>
  );
}

const actionClass =
  'inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

// ─── Video modal ─────────────────────────────────────────────────────────────

/**
 * Radix Dialog supplies role="dialog", aria-modal, aria-labelledby (via
 * Title), Escape to close, a focus trap, and focus restored to the trigger.
 */
function WatchButton({ title, embedUrl }: { title: string; embedUrl: string }) {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger className={actionClass}>
        <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Watch
        <span className="sr-only">: {title}</span>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,960px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-background p-4 shadow-lg"
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <DialogPrimitive.Title className="text-base font-semibold text-foreground">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close video"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
            <iframe
              src={embedUrl}
              title={title}
              className="absolute inset-0 h-full w-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ─── Resource card ───────────────────────────────────────────────────────────

function ResourceAction({ resource, canUpgrade }: { resource: UniversityResourceView; canUpgrade: boolean }) {
  const action = resourceAction(resource);

  switch (action.kind) {
    case 'locked':
      return (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {unlockLabel(resource.unlockPlanNames)}
          </p>
          {canUpgrade ? (
            <Link href={UPGRADE_HREF} className={actionClass}>
              Upgrade<span className="sr-only"> to unlock {resource.title}</span>
            </Link>
          ) : (
            <p className="text-xs text-muted-foreground">Ask your account owner to upgrade</p>
          )}
        </div>
      );
    case 'watch':
      return <WatchButton title={resource.title} embedUrl={action.embedUrl} />;
    case 'open':
      return (
        <a href={action.url} target="_blank" rel="noopener noreferrer" className={actionClass}>
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          Open<span className="sr-only">: {resource.title} (opens in a new tab)</span>
        </a>
      );
    case 'coming_soon':
    case 'none':
      return null;
  }
}

function ResourceCard({ resource, canUpgrade }: { resource: UniversityResourceView; canUpgrade: boolean }) {
  const TypeIcon = TYPE_ICONS[resource.type];
  const duration = formatDuration(resource.durationMinutes);

  return (
    <li
      className={cn(
        'flex flex-col rounded-xl border border-border bg-card p-5',
        resource.locked && 'bg-card/60'
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <TypeIcon className="h-4 w-4" aria-hidden="true" />
          {resourceTypeLabel(resource.type)}
        </span>
        {resource.status === 'coming_soon' && <ComingSoonBadge />}
      </div>

      <div className="flex-1 space-y-2">
        <h3 className="text-sm font-semibold leading-tight text-foreground">{resource.title}</h3>
        {resource.description && (
          <p className="text-xs leading-relaxed text-muted-foreground">{resource.description}</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {duration && (
            <>
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{duration}</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {resource.isFree ? <FreeBadge /> : resource.unlockPlanNames.map((n) => <PlanBadge key={n} name={n} />)}
        </div>
      </div>

      <div className="mt-3 empty:hidden">
        <ResourceAction resource={resource} canUpgrade={canUpgrade} />
      </div>
    </li>
  );
}

// ─── Category ────────────────────────────────────────────────────────────────

function CategorySection({ category, canUpgrade }: { category: UniversityCategoryView; canUpgrade: boolean }) {
  const Icon = category.icon ? CATEGORY_ICONS[category.icon] : GraduationCap;
  const headingId = `university-category-${category.id}`;

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id={headingId} className="text-lg font-semibold text-foreground">
              {category.name}
            </h2>
            <span className="text-xs text-muted-foreground">{moduleCount(category.resources.length)}</span>
          </div>
          {category.description && <p className="text-sm text-muted-foreground">{category.description}</p>}
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {category.resources.map((r) => (
          <ResourceCard key={r.id} resource={r} canUpgrade={canUpgrade} />
        ))}
      </ul>
    </section>
  );
}

// ─── States ──────────────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-10" aria-busy="true">
      <span className="sr-only" role="status">Loading SAM University…</span>
      <div className="h-14 animate-pulse rounded-lg bg-muted" />
      {[0, 1].map((i) => (
        <div key={i} className="space-y-4">
          <div className="h-6 w-48 animate-pulse rounded bg-muted" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((j) => (
              <div key={j} className="h-40 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card/50 p-10 text-center">
      <GraduationCap className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      {children}
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function SamUniversity() {
  const { state, retry } = useCatalogue();
  // Owner-only, same permission that shows the Settings → Subscription tab.
  const canUpgrade = usePermission('settings.billing');

  if (state.kind === 'loading') return <LoadingSkeleton />;

  if (state.kind === 'not_ready') {
    return (
      <Notice>
        <p className="text-sm text-muted-foreground">SAM University is being set up. Check back soon.</p>
      </Notice>
    );
  }

  if (state.kind === 'error') {
    return (
      <Notice>
        <p role="alert" className="text-sm text-muted-foreground">
          We couldn&rsquo;t load SAM University.
        </p>
        <button type="button" onClick={retry} className={actionClass}>
          Retry
        </button>
      </Notice>
    );
  }

  const { categories, viewer } = state.data;
  if (categories.length === 0) {
    return (
      <Notice>
        <p className="text-sm text-muted-foreground">No training content yet.</p>
      </Notice>
    );
  }

  const totals = summariseCatalogue(categories);

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card/50 p-4">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">{moduleCount(totals.total)}</span>
        </div>
        {viewer.planName && (
          <>
            <div className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
            <span className="text-sm text-foreground">You&rsquo;re on {viewer.planName}</span>
          </>
        )}
        <div className="hidden h-4 w-px bg-border sm:block" aria-hidden="true" />
        <span className="text-xs text-muted-foreground">
          {totals.unlocked} unlocked · {totals.locked} locked
        </span>
      </div>

      {categories.map((category) => (
        <CategorySection key={category.id} category={category} canUpgrade={canUpgrade} />
      ))}
    </div>
  );
}
