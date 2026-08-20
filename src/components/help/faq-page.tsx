'use client';

import { useState } from 'react';
import {
  ChevronDown,
  Rocket,
  CreditCard,
  Layers,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqCategory {
  name: string;
  icon: React.ElementType;
  items: FaqItem[];
}

// ─── Data ────────────────────────────────────────────────────────────────────

const faqCategories: FaqCategory[] = [
  {
    name: 'Getting Started',
    icon: Rocket,
    items: [
      {
        question: 'What is SAM Plan AI?',
        answer:
          'A revenue operating system that generates personalized annual plans with execution-ready project plans, then drives weekly accountability.',
      },
      {
        question: 'How does the plan get generated?',
        answer:
          'You answer 7 questions about your business (revenue goal, products, what\u2019s worked, audience, assets, budget, obstacles). The AI selects 6\u201310 initiatives from our library, calculates revenue projections, and creates project plans.',
      },
      {
        question: 'What\u2019s the difference between Quickstart and Full Plan?',
        answer:
          'Quickstart asks ~3 questions for an instant rough plan. Full Plan asks all 7 for a tailored, higher-confidence result. You can always upgrade from Quickstart to Full later.',
      },
      {
        question: 'Can I change my plan after it\u2019s generated?',
        answer:
          'Yes. You can add, remove, or swap initiatives from the library at any time. The plan is a living document, not a one-time artifact.',
      },
    ],
  },
  {
    name: 'Plans & Billing',
    icon: CreditCard,
    items: [
      {
        question: 'What are the subscription tiers?',
        answer:
          'Starter ($49/mo), Pro ($149/mo), and Mastery ($4,997/yr). Each tier adds more accountability and support.',
      },
      {
        question: 'Is there a free trial?',
        answer:
          'Yes, 14-day full-feature free trial. No credit card required to start.',
      },
      {
        question: 'What\u2019s the refund policy?',
        answer:
          '30-day money-back guarantee. After 30 days, no refunds on monthly; annual plans are prorated.',
      },
    ],
  },
  {
    name: 'Features',
    icon: Layers,
    items: [
      {
        question: 'What are Good/Better/Best revenue scenarios?',
        answer:
          'Three projection levels based on conversion benchmarks: Good (conservative), Better (moderate), Best (aggressive). They show the range of possible outcomes for your plan.',
      },
      {
        question: 'How does the weekly operating cadence work?',
        answer:
          'Each week you: (1) Enter results, (2) See where you are vs plan, (3) See what\u2019s due/slipping, (4) Adjust if needed, (5) Set top 1\u20133 priorities.',
      },
      {
        question: 'What initiative types are available?',
        answer:
          '9 core types in v1: Webinar, Email Campaign, LinkedIn Outreach, Referral Program, Challenge/Bootcamp, VSL/Sales Page, Paid Ads, Sales Calls, Content & Organic Social.',
      },
      {
        question: 'Where do the benchmarks come from?',
        answer:
          'First-party data from real businesses, partner-shared anonymized data, and published industry reports. Never invented.',
      },
    ],
  },
  {
    name: 'Data & Privacy',
    icon: ShieldCheck,
    items: [
      {
        question: 'What data do you share?',
        answer:
          'Only anonymized, aggregated conversion rates. Never your company name, revenue, or identifiable information.',
      },
      {
        question: 'Can I opt out of benchmark sharing?',
        answer:
          'Yes. Toggle it off in Settings \u2192 Benchmarks at any time.',
      },
      {
        question: 'Is my data secure?',
        answer:
          'Yes. We use industry-standard encryption. When Supabase is connected, Row Level Security ensures only you see your data.',
      },
    ],
  },
];

// ─── Accordion Item ──────────────────────────────────────────────────────────

function AccordionItem({
  item,
  isOpen,
  onToggle,
}: {
  item: FaqItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border-b border-[hsl(var(--border))] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between gap-4 py-4 px-1 text-left transition-colors hover:text-[hsl(var(--primary))]"
      >
        <span className="text-sm font-medium text-[hsl(var(--foreground))]">
          {item.question}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-[hsl(var(--foreground-muted))] transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
        />
      </button>
      <div
        className={cn(
          'overflow-hidden transition-[max-height] duration-300 ease-in-out',
          isOpen ? 'max-h-96' : 'max-h-0'
        )}
      >
        <p className="pb-4 px-1 text-sm leading-relaxed text-[hsl(var(--foreground-muted))]">
          {item.answer}
        </p>
      </div>
    </div>
  );
}

// ─── Category Section ────────────────────────────────────────────────────────

function CategorySection({ category }: { category: FaqCategory }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const Icon = category.icon;

  return (
    <section className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6">
      {/* Category Header */}
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[hsl(var(--primary)/0.1)]">
          <Icon className="h-[18px] w-[18px] text-[hsl(var(--primary))]" />
        </div>
        <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
          {category.name}
        </h2>
        <span className="ml-auto text-xs text-[hsl(var(--foreground-muted))]">
          {category.items.length} questions
        </span>
      </div>

      {/* Accordion Items */}
      <div className="divide-y-0">
        {category.items.map((item, idx) => (
          <AccordionItem
            key={item.question}
            item={item}
            isOpen={openIndex === idx}
            onToggle={() => setOpenIndex(openIndex === idx ? null : idx)}
          />
        ))}
      </div>
    </section>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function FaqPage() {
  const totalQuestions = faqCategories.reduce(
    (acc, cat) => acc + cat.items.length,
    0
  );

  return (
    <div className="space-y-6">
      {/* Summary */}
      <p className="text-sm text-[hsl(var(--foreground-muted))]">
        {totalQuestions} answers across {faqCategories.length} categories.
        Can&apos;t find what you&apos;re looking for? Reach out to support.
      </p>

      {/* Category Cards */}
      <div className="space-y-6">
        {faqCategories.map((category) => (
          <CategorySection key={category.name} category={category} />
        ))}
      </div>
    </div>
  );
}
