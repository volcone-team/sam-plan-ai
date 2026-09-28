'use client';
import { useCompanyId } from '@/hooks/use-auth';
import { cacheInvalidatePrefix, CacheKeys } from '@/lib/client-cache';
import { usePermissions } from '@/hooks/use-permission';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout';
import {
  InitiativesList,
  AddInitiativePanel,
  TopPerformersBand,
  type InitiativeTypeOption,
} from '@/components/initiatives';
import { initiativeService } from '@/services/initiative.service';
import { planService } from '@/services/plan.service';
import { planningService } from '@/services/planning.service';
import { companyService } from '@/services/company.service';
import { initiativeTypeService } from '@/services/initiative-type.service';
import { productService } from '@/services/product.service';
import { resultService } from '@/services/result.service';
import { rankTopPerformers, type RankedPerformer } from '@/lib/top-performers';
import type { Initiative, InitiativeType, CreateInitiativeDTO, Result } from '@/types';


export default function InitiativesPage() {
  const companyId = useCompanyId() || "";
  const { canCreate, canDelete } = usePermissions({
    canCreate: 'initiatives.create',
    canDelete: 'initiatives.delete',
  });
  const router = useRouter();
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [initiativeTypes, setInitiativeTypes] = useState<InitiativeTypeOption[]>([]);
  /** Actual revenue + spend per initiative for the current year, from results. */
  const [actualsByInitiative, setActualsByInitiative] = useState<
    Map<string, { revenue: number; spend: number }>
  >(new Map());
  /** Last year's initiatives ranked by their own actual revenue. */
  const [lastYearRanking, setLastYearRanking] = useState<RankedPerformer[]>([]);
  /**
   * Self-reported "what's worked" from intake, used only when no real revenue
   * has been logged. Not measured data - the band labels it as such.
   */
  const [selfReported, setSelfReported] = useState<string[]>([]);
  const [priorYearRevenue, setPriorYearRevenue] = useState(0);
  /**
   * The plan new initiatives attach to. `initiatives.annual_plan_id` is a
   * NOT NULL FK, so this must be a real row for THIS company - it used to be a
   * hardcoded mock-data UUID, which meant every manually created initiative
   * either failed the FK or attached to unrelated data.
   */
  const [annualPlanId, setAnnualPlanId] = useState<string | null>(null);
  const [fullInitiativeTypes, setFullInitiativeTypes] = useState<InitiativeType[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [initiativesData, typesData, productsData] = await Promise.all([
          initiativeService.getInitiativesByCompany(companyId),
          initiativeTypeService.getAllInitiativeTypes(),
          productService.getProductsByCompany(companyId),
        ]);

        // Resolve the plan to attach new initiatives to: this calendar year if
        // it has one, otherwise the most recent year on record (same order
        // year-at-a-glance uses, so both pages agree on "the current plan").
        const thisYear = new Date().getFullYear();
        let plan = await planService.getAnnualPlan(companyId, thisYear);
        if (!plan) {
          const years = await planService.getPlanYears(companyId);
          if (years.length > 0) {
            plan = await planService.getAnnualPlan(companyId, years[0]);
          }
        }
        setAnnualPlanId(plan?.id ?? null);

        // Questionnaire fallback for the top-performers band. Best effort: it
        // only feeds an empty state, so a failure here must not break the page.
        try {
          const [input, company] = await Promise.all([
            planningService.getPlanningInputByCompany(companyId),
            companyService.getCompany(companyId),
          ]);
          // `successful_initiative_types` may hold initiative type IDs or plain
          // labels depending on intake route, so resolve IDs and pass through
          // anything that isn't one.
          const nameById = new Map(typesData.map(t => [t.id, t.name]));
          setSelfReported(
            (input?.successfulInitiativeTypes || []).map(v => nameById.get(v) || v)
          );
          setPriorYearRevenue(company?.priorYearRevenue || 0);
        } catch (err) {
          console.error('Error loading questionnaire fallback:', err);
        }

        setInitiatives(initiativesData);
        setFullInitiativeTypes(typesData);
        setInitiativeTypes(
          typesData.map(t => ({
            id: t.id,
            name: t.name,
            channel: t.channel,
            difficulty: t.difficulty,
          }))
        );
        setProducts(
          productsData.map(p => ({
            id: p.id,
            name: p.name,
          }))
        );

        // The grid can paint now; actuals and last year's ranking enrich it.
        setLoading(false);

        // Results are an enrichment: a failure here leaves the cards showing
        // zeros and no band, which is the same as an account with no results.
        try {
          const currentYear = new Date().getFullYear();
          const previousYear = currentYear - 1;
          const [currentYearResults, previousYearResults] = await Promise.all([
            resultService.getResultsByDateRange(
              new Date(currentYear, 0, 1),
              new Date(currentYear, 11, 31),
              companyId
            ),
            resultService.getResultsByDateRange(
              new Date(previousYear, 0, 1),
              new Date(previousYear, 11, 31),
              companyId
            ),
          ]);

          // Per-initiative actual revenue + spend for the current year.
          const actuals = new Map<string, { revenue: number; spend: number }>();
          for (const r of currentYearResults) {
            const key = (r as Result & { initiativeId?: string }).initiativeId || '';
            if (!key) continue;
            const cur = actuals.get(key) || { revenue: 0, spend: 0 };
            cur.revenue += r.actualRevenue || 0;
            cur.spend += r.actualSpend || 0;
            actuals.set(key, cur);
          }
          setActualsByInitiative(actuals);

          // Last year's initiatives are separate rows (scoped by annual_plan_id),
          // so they rank on their own results - no cross-year matching needed here.
          setLastYearRanking(
            rankTopPerformers(initiativesData, previousYearResults, { year: previousYear })
          );
        } catch (err) {
          console.error('Error loading initiative results:', err);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load initiatives';
        setError(message);
        console.error('Error loading initiatives:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [companyId]);

  const handleInitiativeClick = (id: string) => {
    router.push(`/initiatives/${id}`);
  };

  const handleAddInitiative = async (dto: CreateInitiativeDTO) => {
    const newInitiative = await initiativeService.createInitiative(dto);
    setInitiatives(prev => [newInitiative, ...prev]);
  };

  const handleRemoveInitiative = async (id: string) => {
    try {
      await initiativeService.deleteInitiative(id);
      setInitiatives(prev => prev.filter(i => i.id !== id));
      // Same reason as the products page: Year-at-a-Glance caches its dashboard
      // payload, so a delete here must invalidate it or the old revenue totals
      // survive the deletion on screen.
      cacheInvalidatePrefix(CacheKeys.planPrefix);
    } catch (err) {
      console.error('Error removing initiative:', err);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        title="Initiatives"
        description="Manage your revenue-driving initiatives"
        actions={
          canCreate ? (
          <button
            onClick={() => setAddPanelOpen(true)}
            disabled={!annualPlanId}
            title={annualPlanId ? undefined : 'Generate your plan first'}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[hsl(var(--primary))]"
          >
            <Plus className="h-4 w-4" />
            Add Initiative
          </button>
          ) : null
        }
      />
      {/* An initiative needs a plan to hang off. Say so rather than offering a
          create action that cannot succeed. */}
      {!loading && !error && canCreate && !annualPlanId && (
        <p className="mb-6 rounded-[var(--radius-md)] border border-dashed border-border px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
          You need a plan before you can add initiatives. Generate one from Year-at-a-Glance first.
        </p>
      )}
      {/* Always rendered once loaded: the band explains an empty ranking itself
          rather than vanishing, which previously made it look unbuilt. */}
      {!loading && !error && (
        <div className="mb-6">
          <TopPerformersBand
            performers={lastYearRanking}
            year={new Date().getFullYear() - 1}
            selfReported={selfReported}
            priorYearRevenue={priorYearRevenue}
          />
        </div>
      )}

      <InitiativesList
        initiatives={initiatives}
        initiativeTypes={initiativeTypes}
        products={products}
        loading={loading}
        error={error}
        actualsByInitiative={actualsByInitiative}
        lastYearRanking={lastYearRanking}
        onInitiativeClick={handleInitiativeClick}
        onRemoveInitiative={canDelete ? handleRemoveInitiative : undefined}
      />

      <AddInitiativePanel
        open={addPanelOpen && !!annualPlanId}
        onClose={() => setAddPanelOpen(false)}
        onSubmit={handleAddInitiative}
        initiativeTypes={fullInitiativeTypes}
        products={products}
        companyId={companyId}
        annualPlanId={annualPlanId ?? ''}
      />
    </PageContainer>
  );
}
