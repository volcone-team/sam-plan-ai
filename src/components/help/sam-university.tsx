'use client';

import { Play, Clock, Lock, GraduationCap, BookOpen, BarChart3, CalendarCheck, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

type Tier = 'Free' | 'Pro' | 'Mastery';

interface Module {
  title: string;
  description: string;
  duration: number; // minutes
  tier: Tier;
}

interface Category {
  name: string;
  tier: Tier;
  icon: React.ElementType;
  modules: Module[];
}

// ─── Data ────────────────────────────────────────────────────────────────────

const categories: Category[] = [
  {
    name: 'Getting Started',
    tier: 'Free',
    icon: BookOpen,
    modules: [
      {
        title: 'Building Your First Plan',
        description: 'How to complete the questionnaire and generate your revenue plan',
        duration: 8,
        tier: 'Free',
      },
      {
        title: 'Understanding Your Initiatives',
        description: 'How initiatives work, types, and what each one means',
        duration: 12,
        tier: 'Free',
      },
      {
        title: 'Navigating Your Dashboard',
        description: 'Tour of the Year-at-a-Glance and planning views',
        duration: 6,
        tier: 'Free',
      },
    ],
  },
  {
    name: 'Initiative Strategy',
    tier: 'Pro',
    icon: GraduationCap,
    modules: [
      {
        title: 'Choosing the Right Initiatives',
        description: 'How to select initiatives based on your business stage',
        duration: 15,
        tier: 'Pro',
      },
      {
        title: 'Revenue Scenarios Explained',
        description: 'What Good, Better, Best mean and how to use them',
        duration: 10,
        tier: 'Pro',
      },
      {
        title: 'Matching Difficulty to Your Team',
        description: 'Understanding the 4 difficulty dimensions',
        duration: 12,
        tier: 'Pro',
      },
    ],
  },
  {
    name: 'Revenue Projections',
    tier: 'Pro',
    icon: BarChart3,
    modules: [
      {
        title: 'How Benchmarks Work',
        description: 'Where our benchmark data comes from and what drives accuracy',
        duration: 10,
        tier: 'Pro',
      },
      {
        title: 'Reading Your Projections',
        description: 'Interpreting monthly, quarterly, and annual projections',
        duration: 8,
        tier: 'Pro',
      },
      {
        title: 'Budget vs Actuals',
        description: 'Tracking spend against projections',
        duration: 12,
        tier: 'Pro',
      },
    ],
  },
  {
    name: 'Weekly Cadence',
    tier: 'Pro',
    icon: CalendarCheck,
    modules: [
      {
        title: 'The 5-Step Weekly Operating Loop',
        description: 'Enter results, see where you are, what\'s moving, adjust, prioritize',
        duration: 15,
        tier: 'Pro',
      },
      {
        title: 'Entering Weekly Results',
        description: 'How to log revenue and spend each week',
        duration: 8,
        tier: 'Pro',
      },
      {
        title: 'Setting Effective Priorities',
        description: 'How to pick your top 1-3 each week',
        duration: 10,
        tier: 'Pro',
      },
    ],
  },
  {
    name: 'Advanced (Mastery)',
    tier: 'Mastery',
    icon: Sparkles,
    modules: [
      {
        title: 'Quarterly Strategy Reviews',
        description: 'How to reshape your plan each quarter',
        duration: 20,
        tier: 'Mastery',
      },
      {
        title: 'Building Custom Initiatives',
        description: 'Creating your own initiative types with benchmarks',
        duration: 15,
        tier: 'Mastery',
      },
      {
        title: 'Data-Driven Plan Optimization',
        description: 'Using actuals to refine projections and strategy',
        duration: 18,
        tier: 'Mastery',
      },
    ],
  },
];

// ─── Tier Badge ──────────────────────────────────────────────────────────────

const tierStyles: Record<Tier, string> = {
  Free: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  Pro: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Mastery: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

function TierBadge({ tier, size = 'sm' }: { tier: Tier; size?: 'sm' | 'xs' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium',
        size === 'sm' && 'px-2.5 py-0.5 text-xs',
        size === 'xs' && 'px-2 py-0.5 text-[10px]',
        tierStyles[tier]
      )}
    >
      {tier === 'Free' ? 'Free' : tier === 'Pro' ? 'Pro' : 'Mastery'}
    </span>
  );
}

// ─── Module Card ─────────────────────────────────────────────────────────────

function ModuleCard({ module }: { module: Module }) {
  return (
    <div className="group relative flex flex-col rounded-xl border border-border bg-card p-5 transition-all duration-200 hover:shadow-lg hover:border-border/80 hover:-translate-y-0.5">
      {/* Coming Soon overlay */}
      <div className="absolute top-3 right-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          Coming Soon
        </span>
      </div>

      {/* Play icon placeholder */}
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-muted transition-colors group-hover:bg-primary/10">
        <Play className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
      </div>

      {/* Content */}
      <div className="flex-1 space-y-2">
        <h3 className="text-sm font-semibold leading-tight text-foreground line-clamp-2">
          {module.title}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
          {module.description}
        </p>
      </div>

      {/* Footer */}
      <div className="mt-4 flex items-center justify-between pt-3 border-t border-border/50">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          <span>{module.duration} min</span>
        </div>
        <TierBadge tier={module.tier} size="xs" />
      </div>
    </div>
  );
}

// ─── Category Section ────────────────────────────────────────────────────────

function CategorySection({ category }: { category: Category }) {
  const Icon = category.icon;

  return (
    <section className="space-y-4">
      {/* Category Header */}
      <div className="flex items-center gap-3">
        <div className={cn(
          'flex h-9 w-9 items-center justify-center rounded-lg',
          category.tier === 'Free' && 'bg-emerald-100 dark:bg-emerald-900/30',
          category.tier === 'Pro' && 'bg-blue-100 dark:bg-blue-900/30',
          category.tier === 'Mastery' && 'bg-purple-100 dark:bg-purple-900/30',
        )}>
          <Icon className={cn(
            'h-4.5 w-4.5',
            category.tier === 'Free' && 'text-emerald-600 dark:text-emerald-400',
            category.tier === 'Pro' && 'text-blue-600 dark:text-blue-400',
            category.tier === 'Mastery' && 'text-purple-600 dark:text-purple-400',
          )} />
        </div>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-foreground">
            {category.name}
          </h2>
          <TierBadge tier={category.tier} />
          <span className="text-xs text-muted-foreground">
            {category.modules.length} modules
          </span>
        </div>
        {category.tier !== 'Free' && (
          <Lock className="ml-auto h-4 w-4 text-muted-foreground/50" />
        )}
      </div>

      {/* Module Cards Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {category.modules.map((module) => (
          <ModuleCard key={module.title} module={module} />
        ))}
      </div>
    </section>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function SamUniversity() {
  const totalModules = categories.reduce((acc, cat) => acc + cat.modules.length, 0);

  return (
    <div className="space-y-10">
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card/50 p-4">
        <div className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium text-foreground">
            {totalModules} training modules
          </span>
        </div>
        <div className="hidden sm:block h-4 w-px bg-border" />
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier="Free" />
          <TierBadge tier="Pro" />
          <TierBadge tier="Mastery" />
        </div>
        <div className="hidden sm:block h-4 w-px bg-border" />
        <span className="text-xs text-muted-foreground">
          All modules are marked &ldquo;Coming Soon&rdquo; — video content is in production.
        </span>
      </div>

      {/* Categories */}
      {categories.map((category) => (
        <CategorySection key={category.name} category={category} />
      ))}
    </div>
  );
}
