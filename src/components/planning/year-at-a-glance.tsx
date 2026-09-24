'use client';

import { useAuth, useCompanyId } from '@/hooks/use-auth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { useEffect, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  AlertTriangle,
  Clock,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Info,
  Plus,
  ChevronDown,
  CalendarDays,
  CalendarRange,
  CalendarCheck,
  Sun,
  Save,
  Trash2,
  Download,
} from 'lucide-react';
import { planService } from '@/services/plan.service';
import { projectionService } from '@/services/projection.service';
import { initiativeService } from '@/services/initiative.service';
import { productService } from '@/services/product.service';
import { resultService } from '@/services/result.service';
import { RegenerateModal } from './regenerate-modal';
import type { AnnualPlan, QuarterlyPlan, Initiative, Result } from '@/types';
import { cacheGet, cacheSet, cacheInvalidatePrefix, CacheKeys, TTL } from '@/lib/client-cache';
import { useToast } from '@/components/ui/toast';

const CURRENT_YEAR = new Date().getFullYear();

/** localStorage key for dismissing the page explainer. */
const EXPLAINER_KEY = 'sam-yag-explainer-dismissed';

interface MonthlyData {
  month: number;
  good: number;
  better: number;
  best: number;
}

interface TimelineInitiative {
  id: string;
  name: string;
  status: string;
  activationDate: Date;
  eventDate?: Date;
}

function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(2)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}K`;
  }
  return `$${value.toLocaleString()}`;
}

export function YearAtAGlance() {
  const companyId = useCompanyId() || "";
  const { loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const router = useRouter();
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  /** Year currently being viewed. Users can review past years or plan ahead. */
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  /** Bumped to force a data reload after saving a draft. */
  const [reloadKey, setReloadKey] = useState(0);
  const [showPastYears, setShowPastYears] = useState(false);
  const [explainerDismissed, setExplainerDismissed] = useState(true);
  /** Inline draft editor state for a future-year plan. */
  const [draftBaseline, setDraftBaseline] = useState('');
  const [draftStretch, setDraftStretch] = useState('');
  const [draftStrategy, setDraftStrategy] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);
  const [removingYear, setRemovingYear] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [annualPlan, setAnnualPlan] = useState<AnnualPlan | null>(null);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [initiatives, setInitiatives] = useState<TimelineInitiative[]>([]);
  /** Full initiative rows for the redesigned Active Initiatives cards. */
  const [initiativeRows, setInitiativeRows] = useState<Initiative[]>([]);
  /** Actual revenue + spend per initiative, from results/expenses. */
  const [actualsByInitiative, setActualsByInitiative] = useState<Map<string, { revenue: number; spend: number }>>(new Map());
  /** Month/Quarter/Year-to-date actual vs expected. */
  const [periodStats, setPeriodStats] = useState<{
    mtd: { actual: number; expected: number };
    qtd: { actual: number; expected: number };
    ytd: { actual: number; expected: number };
  }>({ mtd: { actual: 0, expected: 0 }, qtd: { actual: 0, expected: 0 }, ytd: { actual: 0, expected: 0 } });
  const [projectionTotals, setProjectionTotals] = useState({
    good: 0,
    better: 0,
    best: 0,
  });

  useEffect(() => {
    if (!companyId) {
      // Auth resolved but no company: stop spinning and say so, rather than
      // showing an indefinite loader.
      if (!authLoading) {
        setLoading(false);
        setError('No company is linked to your account yet.');
      }
      return;
    }
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Cache-first: these five queries cost ~2-4s combined because each is a
        // separate network round trip. Serve the cached copy instantly and
        // revalidate in the background when it goes stale.
        const cacheKey = CacheKeys.dashboard(companyId, selectedYear);
        const cached = cacheGet<any>(cacheKey, TTL.planData);

        let plan: AnnualPlan | null = null;
        let quarters: QuarterlyPlan[] = [];
        let projections: any[] = [];
        let products: Array<{ id: string; name: string }> = [];
        let initiativesData: Initiative[] = [];

        if (cached) {
          ({ plan, quarters, projections, products, initiativesData } = cached.value);
          console.log('[YearAtAGlance] Served from cache (stale:', cached.stale, ')');
        }

        if (!cached || cached.stale) {
          const fresh = await Promise.all([
            planService.getAnnualPlan(companyId, selectedYear),
            planService.getQuarterlyPlans(companyId, selectedYear),
            projectionService.getProjectionsByCompany(companyId),
            productService.getProductsByCompany(companyId),
            initiativeService.getInitiativesByCompany(companyId),
          ]);
          [plan, quarters, projections, products, initiativesData] = fresh;

          // Scope initiatives and projections to THIS year's annual plan.
          // Both services return every year's rows, so without this a future
          // year showed the current year's initiatives and projections next to
          // its own zeroed goals - and the draft editor never appeared, because
          // the leaked rows made the year look already-generated.
          if (plan?.id) {
            projections = projections.filter((pr: { annualPlanId?: string }) => pr.annualPlanId === plan!.id);
            initiativesData = initiativesData.filter((i) => i.annualPlanId === plan!.id);
          } else {
            // No plan row for this year yet - nothing belongs to it.
            projections = [];
            initiativesData = [];
          }

          cacheSet(cacheKey, {
            plan, quarters, projections, products, initiativesData,
          });
        }

        setAnnualPlan(plan);

        // Build monthly data from projections
        const goodProj = projections.find((p: any) => p.scenario === 'good');
        const betterProj = projections.find((p: any) => p.scenario === 'better');
        const bestProj = projections.find((p: any) => p.scenario === 'best');

        const monthly: MonthlyData[] = [];
        for (let m = 1; m <= 12; m++) {
          monthly.push({
            month: m,
            good: goodProj?.monthly?.find((x: any) => x.month === m)?.revenue || 0,
            better: betterProj?.monthly?.find((x: any) => x.month === m)?.revenue || 0,
            best: bestProj?.monthly?.find((x: any) => x.month === m)?.revenue || 0,
          });
        }
        setMonthlyData(monthly);

        // Calculate totals
        const goodTotal = monthly.reduce((sum, m) => sum + m.good, 0);
        const betterTotal = monthly.reduce((sum, m) => sum + m.better, 0);
        const bestTotal = monthly.reduce((sum, m) => sum + m.best, 0);
        setProjectionTotals({ good: goodTotal, better: betterTotal, best: bestTotal });

        // Build initiative timeline data
        const timelineInitiatives: TimelineInitiative[] = initiativesData.map((i: Initiative) => ({
          id: i.id,
          name: i.name,
          status: i.status,
          activationDate: i.activationDate,
          eventDate: i.eventDate,
        }));
        setInitiatives(timelineInitiatives);
        setInitiativeRows(initiativesData);

        // --- Dashboard/Accountability data ---
        // Primary content is ready; let the page paint now and finish the
        // secondary panels below. This is what makes the dashboard feel fast.
        setLoading(false);

        const now = new Date();




        // --- Full-year results power "Where you are" and the initiative cards ---
        const yearStart = new Date(selectedYear, 0, 1);
        const yearEnd = new Date(selectedYear, 11, 31);
        const yearResults = await resultService.getResultsByDateRange(yearStart, yearEnd, companyId);

        // Per-initiative actual revenue + spend
        const actuals = new Map<string, { revenue: number; spend: number }>();
        for (const r of yearResults) {
          const key = (r as Result & { initiativeId?: string }).initiativeId || '';
          if (!key) continue;
          const cur = actuals.get(key) || { revenue: 0, spend: 0 };
          cur.revenue += r.actualRevenue || 0;
          cur.spend += r.actualSpend || 0;
          actuals.set(key, cur);
        }
        setActualsByInitiative(actuals);

        // Actual vs expected for month / quarter / year to date.
        // "Expected" is driven by when initiatives are SCHEDULED: an initiative
        // contributes its "better" projection once its activation date passes.
        const monthStart = new Date(selectedYear, now.getMonth(), 1);
        const quarterStart = new Date(selectedYear, Math.floor(now.getMonth() / 3) * 3, 1);
        const isViewingCurrentYear = selectedYear === CURRENT_YEAR;
        // For a past year the whole year has elapsed.
        const cutoff = isViewingCurrentYear ? now : yearEnd;

        const sumActual = (from: Date) =>
          yearResults
            .filter((r) => {
              const d = new Date(r.weekStartDate);
              return d >= from && d <= cutoff;
            })
            .reduce((sum, r) => sum + (r.actualRevenue || 0), 0);

        const sumExpected = (from: Date) =>
          initiativesData
            .filter((i) => {
              const d = new Date(i.activationDate);
              return d >= from && d <= cutoff;
            })
            .reduce((sum, i) => sum + (i.revenueScenarios?.better || 0), 0);

        setPeriodStats({
          mtd: { actual: sumActual(monthStart), expected: sumExpected(monthStart) },
          qtd: { actual: sumActual(quarterStart), expected: sumExpected(quarterStart) },
          ytd: { actual: sumActual(yearStart), expected: sumExpected(yearStart) },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load data';
        setError(message);
        console.error('Error loading year-at-a-glance data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [companyId, authLoading, selectedYear, reloadKey]);

  // Which years this company has plans for, so the switcher is accurate.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const years = await planService.getPlanYears(companyId);
        if (cancelled) return;
        setAvailableYears(years);
        // Prefer the current year when a plan exists for it, otherwise the
        // most recent year on record, so the page is never empty by default.
        if (years.length > 0 && !years.includes(CURRENT_YEAR)) {
          setSelectedYear(years[0]);
        }
      } catch {
        /* non-fatal - switcher just shows the current year */
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  // Keep the draft inputs in sync with whichever year's plan is loaded.
  useEffect(() => {
    setDraftBaseline(annualPlan?.baselineRevenue ? String(annualPlan.baselineRevenue) : '');
    setDraftStretch(annualPlan?.stretchRevenue ? String(annualPlan.stretchRevenue) : '');
    setDraftStrategy(annualPlan?.notes || '');
  }, [annualPlan]);

  // Explainer visibility is per-browser and dismissed with "Got it".
  useEffect(() => {
    try {
      setExplainerDismissed(localStorage.getItem(EXPLAINER_KEY) === '1');
    } catch {
      setExplainerDismissed(false);
    }
  }, []);

  const dismissExplainer = () => {
    try { localStorage.setItem(EXPLAINER_KEY, '1'); } catch {}
    setExplainerDismissed(true);
  };

  /**
   * Plan a future year: create a DRAFT annual plan for that year and switch to
   * it. The page then shows an inline editor so the user can sketch goals and
   * strategy before committing to a full generated plan.
   */
  const planFutureYear = async (year: number) => {
    if (!companyId) return;
    console.log('[YearAtAGlance] Planning future year:', year);
    try {
      const existing = await planService.getAnnualPlan(companyId, year);
      if (!existing) {
        await planService.createAnnualPlan({
          companyId,
          year,
          baselineRevenue: 0,
          stretchRevenue: 0,
          operatingBudget: 0,
          notes: '',
        });
      }
      const years = await planService.getPlanYears(companyId);
      setAvailableYears(years);
      setSelectedYear(year);
    } catch (err) {
      console.error('[YearAtAGlance] Could not create future year plan:', err);
      showToast('Could not start planning that year.', { variant: 'error', duration: 5000 });
    }
  };

  /** Export the year's initiatives (plan vs actual) as CSV. */
  const exportCsv = () => {
    const rows = [
      ['Initiative', 'Kind', 'Status', 'Activation date', 'Planned revenue (better)', 'Actual revenue', 'Planned budget', 'Actual spend', 'Net', 'Good', 'Best'],
      ...initiativeRows.map((i) => {
        const a = actualsByInitiative.get(i.id) || { revenue: 0, spend: 0 };
        const spend = a.spend || i.actualSpend || 0;
        return [
          i.name,
          i.kind,
          i.status,
          new Date(i.activationDate).toISOString().split('T')[0],
          String(i.revenueScenarios?.better || 0),
          String(a.revenue),
          String(i.plannedBudget || 0),
          String(spend),
          String(a.revenue - spend),
          String(i.revenueScenarios?.good || 0),
          String(i.revenueScenarios?.best || 0),
        ];
      }),
    ];
    // Quote every field so names containing commas cannot break the columns.
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `sam-plan-${selectedYear}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${initiativeRows.length} initiative(s) for ${selectedYear}.`, { variant: 'success', duration: 4000 });
  };

  /** Persist the draft goals + strategy for the selected future year. */
  const saveDraft = async () => {
    if (!annualPlan) return;
    setSavingDraft(true);
    try {
      await planService.updateAnnualPlan(annualPlan.id, {
        baselineRevenue: Number(draftBaseline) || 0,
        stretchRevenue: Number(draftStretch) || 0,
        notes: draftStrategy,
      });
      cacheInvalidatePrefix(CacheKeys.planPrefix);
      showToast(`${selectedYear} draft saved.`, { variant: 'success', duration: 4000 });
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error('[YearAtAGlance] Save draft failed:', err);
      showToast('Could not save the draft.', { variant: 'error', duration: 5000 });
    } finally {
      setSavingDraft(false);
    }
  };

  /**
   * Generate initiatives for a future-year draft via Claude. Saves the current
   * goals first, then routes into the onboarding/full questionnaire flagged
   * with the target year so generation attaches to THIS plan.
   */
  const generateInitiativesForYear = async () => {
    if (!annualPlan) return;
    setGenerating(true);
    try {
      // Persist whatever the user has sketched so it is not lost.
      await planService.updateAnnualPlan(annualPlan.id, {
        baselineRevenue: Number(draftBaseline) || 0,
        stretchRevenue: Number(draftStretch) || 0,
        notes: draftStrategy,
      });
      cacheInvalidatePrefix(CacheKeys.planPrefix);
      try {
        localStorage.setItem('sam-plan-target-year', String(selectedYear));
        localStorage.removeItem('sam-regen-mode');
        localStorage.removeItem('sam-questionnaire-full');
        localStorage.removeItem('sam-questionnaire-quickstart');
        localStorage.removeItem('sam-questionnaire-mode');
      } catch {}
      router.push(`/onboarding/full?year=${selectedYear}`);
    } catch (err) {
      console.error('[YearAtAGlance] Generate for year failed:', err);
      showToast('Could not start generation.', { variant: 'error', duration: 5000 });
      setGenerating(false);
    }
  };

  /** Delete the future-year draft entirely and return to the current year. */
  const removeYear = async () => {
    if (!annualPlan || !companyId) return;
    setRemovingYear(true);
    try {
      const ok = await planService.deleteAnnualPlan(annualPlan.id);
      if (!ok) {
        showToast('Could not remove that year.', { variant: 'error', duration: 5000 });
        return;
      }
      cacheInvalidatePrefix(CacheKeys.planPrefix);
      const years = await planService.getPlanYears(companyId);
      setAvailableYears(years);
      setSelectedYear(years.includes(CURRENT_YEAR) ? CURRENT_YEAR : (years[0] ?? CURRENT_YEAR));
      showToast('Year removed.', { variant: 'success', duration: 4000 });
    } finally {
      setRemovingYear(false);
    }
  };


  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--foreground-muted))]" />
      </div>
    );
  }

  if (error && selectedYear <= CURRENT_YEAR) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-10 text-center">
        <AlertCircle className="h-8 w-8 text-[hsl(var(--foreground-muted))] mx-auto mb-3" />
        <h3 className="text-base font-semibold mb-1">No plan yet</h3>
        <p className="text-sm text-[hsl(var(--foreground-muted))] mb-4">
          Answer a few questions and we&apos;ll build your revenue plan — initiatives,
          projections, and a week-by-week execution timeline.
        </p>
        <a
          href="/onboarding/welcome"
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Generate Your Plan
        </a>
      </div>
    );
  }

  // Whether a plan has actually been GENERATED.
  //
  // Signup auto-creates an `annual_plans` row with zeroed targets, so the mere
  // existence of that row proves nothing - checking `!!annualPlan` made a
  // brand-new account render a dashboard full of $0 cards instead of the
  // "generate your plan" prompt. Look for real generated content instead:
  // initiatives, projections, or non-zero revenue targets.
  const hasGeneratedPlan =
    initiatives.length > 0 ||
    monthlyData.some(m => m.good || m.better || m.best) ||
    Number(annualPlan?.baselineRevenue || 0) > 0 ||
    Number(annualPlan?.stretchRevenue || 0) > 0;

  // A future year legitimately has no generated plan - that is the draft
  // planning state, handled further down. Only show the "generate" prompt for
  // the current or a past year.
  if (!hasGeneratedPlan && selectedYear <= CURRENT_YEAR) {
    return (
      <div className="rounded-[var(--radius-lg)] border border-border bg-card p-10 text-center">
        <AlertCircle className="h-8 w-8 text-[hsl(var(--foreground-muted))] mx-auto mb-3" />
        <h3 className="text-base font-semibold mb-1">No plan generated yet</h3>
        <p className="text-sm text-[hsl(var(--foreground-muted))] mb-4">
          Complete the questionnaire to generate your personalized revenue plan.
        </p>
        <a
          href="/onboarding/welcome"
          className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Generate Your Plan
        </a>
      </div>
    );
  }

  // Year switcher buckets. Past years collapse into a dropdown so the row stays
  // short as years accumulate; current and future years stay visible.
  const knownYears = Array.from(new Set([...availableYears, selectedYear, CURRENT_YEAR]));
  const pastYears = knownYears.filter((y) => y < CURRENT_YEAR).sort((a, b) => b - a);
  const switcherYears = knownYears.filter((y) => y >= CURRENT_YEAR).sort((a, b) => a - b);
  // A future year is in "draft planning" mode until it has actual INITIATIVES.
  // Saving goals/strategy is PART of the draft, not an exit from it - basing
  // this on hasGeneratedPlan meant saving goals hid the editor (and its
  // Save/Remove controls) with no way back. Initiatives are what turn a draft
  // into a real generated plan.
  const isFutureYear = selectedYear > CURRENT_YEAR;
  const hasInitiatives = initiativeRows.length > 0;
  const isDraftPlanning = isFutureYear && !hasInitiatives;

  // Next year that has no plan yet, so "Plan future year" always advances.
  const nextPlannableYear = (() => {
    let y = CURRENT_YEAR;
    while (knownYears.includes(y)) y += 1;
    return y;
  })();

  // "Start from Scratch" — clears upcoming initiatives and rebuilds via questionnaire.
  const handleStartFromScratch = () => {
    console.log("[YearAtAGlance] Start from Scratch confirmed for year:", selectedYear);
    cacheInvalidatePrefix(CacheKeys.planPrefix);
    setShowRegenConfirm(false);
    // Flag the intent so the generating flow knows to run the selective (not full) reset.
    localStorage.setItem("sam-regen-mode", "scratch");
    // ALWAYS pin the year being regenerated to the year on screen. This used to
    // be left alone, so a stale "plan future year" flag kept sending every
    // later regeneration to that future year - the viewed year stayed empty
    // no matter how many times the user regenerated.
    localStorage.setItem("sam-plan-target-year", String(selectedYear));
    localStorage.removeItem("sam-questionnaire-full");
    localStorage.removeItem("sam-questionnaire-quickstart");
    localStorage.removeItem("sam-questionnaire-mode");
    router.push("/onboarding/full");
  };

  // "Enhance Current Plan" — AI suggestions (built in Group B). Placeholder route for now.
  const handleEnhance = () => {
    console.log("[YearAtAGlance] Enhance Current Plan chosen");
    cacheInvalidatePrefix(CacheKeys.planPrefix);
    setShowRegenConfirm(false);
    // Enhance flow (suggestions + accept/reject) is implemented in Group B.
    // For now, route to the enhance entry point which will be built next.
    router.push("/enhance-plan");
  };

  return (
    <div className="space-y-6">
      {/* Two-step regenerate modal (choice → hard confirm for scratch) */}
      <RegenerateModal
        open={showRegenConfirm}
        onClose={() => setShowRegenConfirm(false)}
        onStartFromScratch={handleStartFromScratch}
        onEnhance={handleEnhance}
      />

      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
            Year-at-a-Glance
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{selectedYear} Plan</h1>
          <p className="mt-1 text-xs font-medium uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
            {isDraftPlanning ? `Draft · Planning for ${selectedYear}` : 'Jan 1 — Dec 31'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--background-muted))] transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            onClick={() => { console.log("[YearAtAGlance] Enhance Plan clicked"); router.push("/enhance-plan"); }}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-orange-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-600 transition-colors"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Enhance Plan
          </button>
          <button
            onClick={() => { console.log("[YearAtAGlance] Regenerate clicked"); setShowRegenConfirm(true); }}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Regenerate Plan
          </button>
          <Link
            href="/initiatives"
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" />
            New Initiative
          </Link>
        </div>
      </div>

      {/* Explainer — dismissed with "Got it", stays dismissed per browser */}
      {!explainerDismissed && (
        <div className="rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted)/0.5)] p-6">
          <h2 className="text-lg font-semibold">Here&apos;s your plan for the year.</h2>
          <p className="mt-2 max-w-3xl text-sm text-[hsl(var(--foreground-muted))]">
            This page is your whole year in one view. From top to bottom: your revenue goals,
            how you&apos;re tracking against them, whether your initiatives add up to your goals,
            the strategy behind the plan, and the initiatives that will get you there.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={dismissExplainer}
              className="rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              Got it
            </button>
            <Link
              href="/planner/weekly"
              className="rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--background-muted))] transition-colors"
            >
              Enter your first numbers
            </Link>
          </div>
        </div>
      )}

      {/* Year switcher — review a past year, or plan the next one */}
      <div className="flex flex-wrap items-center gap-2">
        {(
          <div className="relative">
            <button
              onClick={() => pastYears.length > 0 && setShowPastYears((v) => !v)}
              disabled={pastYears.length === 0}
              title={pastYears.length === 0 ? 'No past years yet' : 'Switch to a past year'}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-full)] border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-muted))] transition-colors enabled:hover:bg-[hsl(var(--background-muted))] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Past Years
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {showPastYears && (
              <div className="absolute left-0 top-full z-20 mt-1 min-w-[8rem] overflow-hidden rounded-[var(--radius-md)] border border-border bg-card shadow-lg">
                {pastYears.map((y) => (
                  <button
                    key={y}
                    onClick={() => { setSelectedYear(y); setShowPastYears(false); }}
                    className="block w-full px-4 py-2 text-left text-sm hover:bg-[hsl(var(--background-muted))]"
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Years with a plan, current/future first */}
        {switcherYears.map((y) => (
          <button
            key={y}
            onClick={() => setSelectedYear(y)}
            className={
              'rounded-[var(--radius-full)] px-4 py-1.5 text-sm font-semibold transition-colors ' +
              (y === selectedYear
                ? 'bg-[hsl(var(--foreground))] text-[hsl(var(--background))]'
                : 'border border-border text-[hsl(var(--foreground-muted))] hover:bg-[hsl(var(--background-muted))]')
            }
          >
            {y}
            {y > CURRENT_YEAR && (
              <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider opacity-70">
                Draft
              </span>
            )}
          </button>
        ))}

        <button
          onClick={() => planFutureYear(nextPlannableYear)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-full)] border border-border px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--background-muted))] transition-colors"
          title={`Plan ${nextPlannableYear}`}
        >
          <Plus className="h-3.5 w-3.5" />
          Plan future year
        </button>
      </div>

      {/* Future-year draft editor. Replaces the dashboard body, since there is
          nothing to report on until a plan is generated for that year. */}
      {isDraftPlanning ? (
        <section className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Planning {selectedYear}</h2>
              <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
                Sketch the goals and strategy for {selectedYear}. Currently a draft — save when you&apos;re ready.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <button
                onClick={saveDraft}
                disabled={savingDraft || generating}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium hover:bg-[hsl(var(--background-muted))] disabled:opacity-50 transition-colors"
              >
                {savingDraft ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </button>
              <button
                onClick={removeYear}
                disabled={removingYear || generating}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30 transition-colors"
              >
                {removingYear ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Remove year
              </button>
              <button
                onClick={generateInitiativesForYear}
                disabled={generating || savingDraft || removingYear}
                className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generate initiatives with AI
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="draft-baseline" className="text-sm font-medium">Baseline goal ($)</label>
              <input
                id="draft-baseline"
                type="number"
                min="0"
                value={draftBaseline}
                onChange={(e) => setDraftBaseline(e.target.value)}
                placeholder="850000"
                className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            </div>
            <div>
              <label htmlFor="draft-stretch" className="text-sm font-medium">Stretch goal ($)</label>
              <input
                id="draft-stretch"
                type="number"
                min="0"
                value={draftStretch}
                onChange={(e) => setDraftStretch(e.target.value)}
                placeholder="1200000"
                className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
              />
            </div>
          </div>

          <div className="mt-4">
            <label htmlFor="draft-strategy" className="text-sm font-medium">The annual strategy</label>
            <textarea
              id="draft-strategy"
              rows={5}
              value={draftStrategy}
              onChange={(e) => setDraftStrategy(e.target.value)}
              placeholder={`What's the bet for ${selectedYear}? Which plays scale, which sunset, where's the budget going?`}
              className="mt-1.5 w-full rounded-[var(--radius-md)] border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors resize-y"
            />
          </div>

          {/* Live preview of the entered goals */}
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted)/0.4)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">Baseline</p>
              <p className="mt-1 text-2xl font-bold">{formatCurrency(Number(draftBaseline) || 0)}</p>
            </div>
            <div className="rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted)/0.4)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">Stretch</p>
              <p className="mt-1 text-2xl font-bold">{formatCurrency(Number(draftStretch) || 0)}</p>
            </div>
          </div>

          <p className="mt-5 text-sm text-[hsl(var(--foreground-muted))]">
            When you&apos;re ready for initiatives and projections, use{' '}
            <button onClick={() => setShowRegenConfirm(true)} className="font-medium text-[hsl(var(--primary))] hover:underline">
              Regenerate Plan
            </button>{' '}
            to build out {selectedYear}.
          </p>
        </section>
      ) : (
      <>

      {/* YOUR GOALS — the two targets the user actually set. Deliberately larger
          than the projection cards below, which previously sat in the same
          6-column row and made the real goals easy to miss. */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          Your Goals
        </p>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Your two revenue targets for the year. Baseline is the number you need to hit.
          Stretch is what a great year looks like.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          <GoalCard
            label="Baseline Goal"
            value={formatCurrency(annualPlan?.baselineRevenue || 0)}
            caption="Conservative annual target"
            hint="The revenue you need to hit this year."
          />
          <GoalCard
            label="Stretch Goal"
            value={formatCurrency(annualPlan?.stretchRevenue || 0)}
            caption="Ambitious annual target"
            hint="What an excellent year looks like."
            accent
          />
        </div>
      </section>

      {/* WHERE YOU ARE — actual revenue vs where the plan says you should be.
          "Expected" is driven by initiative scheduling: an initiative counts
          once its activation date has passed. */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          Where you are
        </p>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Your actual revenue compared to where your plan says you should be by now.
          &apos;Expected&apos; is based on when your initiatives are scheduled.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <PaceCard label="Month-to-date" actual={periodStats.mtd.actual} expected={periodStats.mtd.expected} />
          <PaceCard label="Quarter-to-date" actual={periodStats.qtd.actual} expected={periodStats.qtd.expected} />
          <PaceCard label="Year-to-date" actual={periodStats.ytd.actual} expected={periodStats.ytd.expected} />
        </div>
      </section>

      {/* DOES YOUR PLAN ADD UP? — the same Good/Better/Best projections as before,
          now with the explanation of what each scenario means and how it compares
          to the goals above. */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-card p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          Does your plan add up?
        </p>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          We add up the projected revenue from every initiative and compare it to your goals.
          Good assumes your initiatives underperform, Better assumes they land as planned,
          Best assumes they overperform.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ScenarioCard
            label="Good"
            value={formatCurrency(projectionTotals.good)}
            assumption="If initiatives underperform"
            body={`The year produces ~${formatCurrency(projectionTotals.good)} even in the conservative case.`}
          />
          <ScenarioCard
            label="Better"
            value={formatCurrency(projectionTotals.better)}
            assumption="If initiatives land as planned"
            comparisonLabel="vs Baseline"
            comparisonValue={formatCurrency(annualPlan?.baselineRevenue || 0)}
            covers={projectionTotals.better >= (annualPlan?.baselineRevenue || 0)}
            coversText="Your initiatives cover your baseline goal."
            missesText="Your initiatives fall short of your baseline goal."
          />
          <ScenarioCard
            label="Best"
            value={formatCurrency(projectionTotals.best)}
            assumption="If initiatives overperform"
            comparisonLabel="vs Stretch"
            comparisonValue={formatCurrency(annualPlan?.stretchRevenue || 0)}
            covers={projectionTotals.best >= (annualPlan?.stretchRevenue || 0)}
            coversText="Your initiatives cover your stretch goal."
            missesText="Your initiatives fall short of your stretch goal."
            accent
          />
        </div>
      </section>

      {/* YOUR ANNUAL STRATEGY — the reasoning behind the plan. Stored on the
          annual plan (same field the future-year draft editor writes to). */}
      <section className="rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted)/0.4)] p-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          Your annual strategy
        </p>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          The reasoning behind your plan, based on what you told us about your business.
        </p>
        {annualPlan?.notes ? (
          <p className="mt-4 whitespace-pre-line text-lg leading-relaxed text-[hsl(var(--foreground))]">
            {annualPlan.notes}
          </p>
        ) : (
          <p className="mt-4 text-sm italic text-[hsl(var(--foreground-subtle))]">
            No strategy captured for {selectedYear} yet. Regenerate the plan, or add one when
            planning a future year.
          </p>
        )}
      </section>

      {/* ACTIVE INITIATIVES — the projects that produce the revenue */}
      <section>
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
              Active initiatives
            </p>
            <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
              The specific projects that produce your revenue. Each card shows revenue earned,
              money spent, and what the initiative could produce.
            </p>
          </div>
          <Link href="/initiatives" className="shrink-0 text-sm font-medium text-[hsl(var(--primary))] hover:underline">
            View all
          </Link>
        </div>

        {initiativeRows.length === 0 ? (
          <p className="mt-4 rounded-[var(--radius-lg)] border border-dashed border-border p-8 text-center text-sm text-[hsl(var(--foreground-muted))]">
            No initiatives yet for {selectedYear}.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {initiativeRows.map((init) => (
              <InitiativeSummaryCard
                key={init.id}
                initiative={init}
                actuals={actualsByInitiative.get(init.id) || { revenue: 0, spend: 0 }}
              />
            ))}
          </div>
        )}
      </section>

      {/* YOUR PLANNING RHYTHM — entry points into each cadence */}
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          Your Planning Rhythm
        </p>
        <h3 className="mt-1 text-lg font-semibold">Click below to dive into each time period</h3>
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          Your plan only works if you check in. Start with Weekly.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RhythmCard href="/planner/daily" icon={<Sun className="h-4 w-4" />} label="Daily" description="The top priority for today" />
          <RhythmCard href="/planner/weekly" icon={<CalendarCheck className="h-4 w-4" />} label="Weekly" description="Review progress and decide" />
          <RhythmCard href="/planner/monthly" icon={<CalendarDays className="h-4 w-4" />} label="Monthly" description="Align monthly milestones" />
          <RhythmCard href="/planner/quarterly" icon={<CalendarRange className="h-4 w-4" />} label="Quarterly" description="Set the quarter&apos;s priorities" />
        </div>
      </section>

      </>
      )}
    </div>
  );
}

/* --- Sub-components --- */

/** Large goal card — Baseline / Stretch. Bigger than scenario cards on purpose. */
function GoalCard({
  label, value, caption, hint, accent = false,
}: { label: string; value: string; caption: string; hint: string; accent?: boolean }) {
  return (
    <div
      className={
        'rounded-[var(--radius-lg)] border border-border bg-card p-6 ' +
        (accent ? 'border-l-4 border-l-[hsl(var(--primary))]' : '')
      }
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          {label}
        </span>
        <span title={hint}>
          <Info className="h-3 w-3 text-[hsl(var(--foreground-subtle))]" />
        </span>
      </div>
      <p className="mt-2 text-4xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">{caption}</p>
    </div>
  );
}

/** Good / Better / Best scenario card with its assumption and goal comparison. */
function ScenarioCard({
  label, value, assumption, body, comparisonLabel, comparisonValue,
  covers, coversText, missesText, accent = false,
}: {
  label: string; value: string; assumption: string; body?: string;
  comparisonLabel?: string; comparisonValue?: string;
  covers?: boolean; coversText?: string; missesText?: string; accent?: boolean;
}) {
  return (
    <div
      className={
        'rounded-[var(--radius-lg)] border border-border p-5 ' +
        (accent ? 'bg-[hsl(var(--primary)/0.04)]' : 'bg-[hsl(var(--background-muted)/0.4)]')
      }
    >
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          {label}
        </span>
        <span title={assumption}>
          <Info className="h-3 w-3 text-[hsl(var(--foreground-subtle))]" />
        </span>
      </div>
      <p className="mt-1.5 text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
        {assumption}
      </p>
      {comparisonLabel && (
        <p className="mt-1 text-sm text-[hsl(var(--foreground-muted))]">
          {comparisonLabel}: {comparisonValue}
        </p>
      )}
      {body && <p className="mt-3 text-sm text-[hsl(var(--foreground-muted))]">{body}</p>}
      {coversText && (
        <>
          <div className="mt-3 border-t border-border" />
          <p className="mt-3 flex items-start gap-1.5 text-sm">
            {covers ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            )}
            <span className="text-[hsl(var(--foreground-muted))]">
              {covers ? coversText : missesText}
            </span>
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Month/Quarter/Year-to-date actual vs expected, with a pace read-out.
 * Expected comes from initiative scheduling, so a period with nothing
 * scheduled yet reports that rather than showing a misleading shortfall.
 */
function PaceCard({ label, actual, expected }: { label: string; actual: number; expected: number }) {
  const nothingScheduled = expected <= 0;
  const pct = nothingScheduled ? 0 : Math.round((actual / expected) * 100);
  const delta = actual - expected;
  const behind = delta < 0;

  return (
    <div className="rounded-[var(--radius-lg)] border border-border bg-[hsl(var(--background-muted)/0.4)] p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight">{formatCurrency(actual)}</p>
      <p className="mt-1 flex items-center gap-1 text-sm text-[hsl(var(--foreground-muted))]">
        Expected: {formatCurrency(expected)}
        <span title="Based on the initiatives scheduled to have launched by now.">
          <Info className="h-3 w-3 text-[hsl(var(--foreground-subtle))]" />
        </span>
      </p>
      <div className="mt-3 border-t border-border" />
      <p className="mt-3 flex items-start gap-1.5 text-sm">
        {nothingScheduled ? (
          <>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span className="text-[hsl(var(--foreground-muted))]">
              No initiatives scheduled in this period yet.
            </span>
          </>
        ) : (
          <>
            <Clock className={'mt-0.5 h-4 w-4 shrink-0 ' + (behind ? 'text-amber-500' : 'text-emerald-500')} />
            <span className="text-[hsl(var(--foreground-muted))]">
              {pct}% of pace · {behind ? 'behind by' : 'ahead by'} {formatCurrency(Math.abs(delta))}
            </span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Health label for an initiative.
 *
 * Derived, not stored: the DB status enum is planned/in_progress/launched/...
 * which says nothing about whether the work is on pace. Rule:
 *   - not yet launched            -> Draft
 *   - launched, >=80% of planned  -> On track
 *   - launched, 50-79%            -> At risk
 *   - launched, <50%              -> Behind
 */
function initiativeHealth(initiative: Initiative, actualRevenue: number): {
  label: string; dot: string; tone: string;
} {
  const planned = initiative.revenueScenarios?.better || 0;
  const started = new Date(initiative.activationDate) <= new Date();
  if (!started || initiative.status === 'planned') {
    return { label: 'Draft', dot: 'bg-[hsl(var(--foreground-subtle))]', tone: 'text-[hsl(var(--foreground-muted))]' };
  }
  if (planned <= 0) {
    return { label: 'On track', dot: 'bg-emerald-500', tone: 'text-[hsl(var(--foreground-muted))]' };
  }
  const ratio = actualRevenue / planned;
  if (ratio >= 0.8) return { label: 'On track', dot: 'bg-emerald-500', tone: 'text-[hsl(var(--foreground-muted))]' };
  if (ratio >= 0.5) return { label: 'At risk', dot: 'bg-teal-500', tone: 'text-[hsl(var(--foreground-muted))]' };
  return { label: 'Behind', dot: 'bg-red-500', tone: 'text-[hsl(var(--foreground-muted))]' };
}

/** Compact progress bar used for revenue and spend on initiative cards. */
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[hsl(var(--background-muted))]">
      <div className={'h-full rounded-full ' + color} style={{ width: `${Math.max(pct, value > 0 ? 3 : 0)}%` }} />
    </div>
  );
}

/** Active-initiative summary card: revenue/spend progress, NET, ROI, scenarios. */
function InitiativeSummaryCard({
  initiative, actuals,
}: { initiative: Initiative; actuals: { revenue: number; spend: number } }) {
  const plannedRevenue = initiative.revenueScenarios?.better || 0;
  const plannedSpend = initiative.plannedBudget || 0;
  const spend = actuals.spend || initiative.actualSpend || 0;
  const net = actuals.revenue - spend;
  const roi = spend > 0 ? Math.round((net / spend) * 100) : null;
  const health = initiativeHealth(initiative, actuals.revenue);

  return (
    <Link
      href={`/initiatives/${initiative.id}`}
      className="block rounded-[var(--radius-lg)] border border-border bg-card p-5 transition-colors hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--background-muted)/0.3)]"
    >
      {/* Title + kind */}
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-semibold">{initiative.name}</h4>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          {initiative.kind}
        </span>
      </div>

      {/* Health */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className={'h-1.5 w-1.5 rounded-full ' + health.dot} />
        <span className={'text-[10px] font-semibold uppercase tracking-wider ' + health.tone}>
          {health.label}
        </span>
      </div>

      {/* Revenue */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          <span>Revenue</span>
          <span className="normal-case tracking-normal text-[hsl(var(--foreground-muted))]">
            {formatCurrency(actuals.revenue)} / {formatCurrency(plannedRevenue)}
          </span>
        </div>
        <MiniBar value={actuals.revenue} max={plannedRevenue} color="bg-[hsl(var(--foreground))]" />
      </div>

      {/* Spend */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">
          <span>Spend</span>
          <span className="normal-case tracking-normal text-[hsl(var(--foreground-muted))]">
            {formatCurrency(spend)} / {formatCurrency(plannedSpend)}
          </span>
        </div>
        <MiniBar value={spend} max={plannedSpend} color="bg-emerald-500" />
      </div>

      {/* NET / ROI */}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-[var(--radius-md)] bg-[hsl(var(--background-muted)/0.6)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">Net</p>
          <p className={'mt-0.5 text-sm font-bold ' + (net < 0 ? 'text-red-500' : '')}>
            {net < 0 ? '-' : ''}${Math.abs(net).toLocaleString()}
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] bg-[hsl(var(--background-muted)/0.6)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">ROI</p>
          <p className={'mt-0.5 text-sm font-bold ' + (roi !== null && roi < 0 ? 'text-red-500' : '')}>
            {roi === null ? '—' : `${roi > 0 ? '+' : ''}${roi}%`}
          </p>
        </div>
      </div>

      {/* Good / Better / Best */}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <ScenarioCell label="Good" value={initiative.revenueScenarios?.good || 0} />
        <ScenarioCell label="Better" value={initiative.revenueScenarios?.better || 0} />
        <ScenarioCell label="Best" value={initiative.revenueScenarios?.best || 0} accent />
      </div>
    </Link>
  );
}

function ScenarioCell({ label, value, accent = false }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className={'rounded-[var(--radius-md)] p-2.5 ' + (accent ? 'bg-[hsl(var(--primary)/0.08)]' : 'bg-[hsl(var(--background-muted)/0.6)]')}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[hsl(var(--foreground-subtle))]">{label}</p>
      <p className="mt-0.5 text-sm font-bold">{formatCurrency(value)}</p>
    </div>
  );
}

/** Planning cadence entry point. */
function RhythmCard({
  href, icon, label, description,
}: { href: string; icon: React.ReactNode; label: string; description: string }) {
  return (
    <Link
      href={href}
      className="rounded-[var(--radius-lg)] border border-border bg-card p-5 text-center transition-colors hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--background-muted))]"
    >
      <div className="flex items-center justify-center gap-1.5 text-[hsl(var(--foreground-muted))]">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))]">{description}</p>
    </Link>
  );
}

