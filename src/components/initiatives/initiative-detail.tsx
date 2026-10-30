'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Initiative } from '@/types';
import type { InitiativeType } from '@/types/initiative-type.types';
import { initiativeService } from '@/services/initiative.service';
import { initiativeTypeService } from '@/services/initiative-type.service';
import { productService } from '@/services/product.service';
import { PageContainer, PageHeader } from '@/components/layout';
import { LoadingState } from '@/components/loading-state';
import { ErrorState } from '@/components/error-state';
import { InitiativeOverview } from './initiative-overview';
import { InitiativeWhy } from './initiative-why';
import { InitiativeRevenue } from './initiative-revenue';
import { InitiativeMetrics } from './initiative-metrics';
import { InitiativeProjectPlan } from './initiative-project-plan';
import { InitiativeTasks } from './initiative-tasks';
import { InitiativeResults } from './initiative-results';
import { RecurringPrompts } from './recurring-prompts';
import { LeadHandoffCard } from './lead-handoff-card';
import { usePermissions } from '@/hooks/use-permission';

/** The "Why This Initiative" heading and "When to use" card on the Overview tab. Hidden for now (client request, Oct 2026); Difficulty Dimensions stays. */
const SHOW_WHY_CARD = false;

export interface InitiativeDetailProps {
  initiativeId: string;
  onBack: () => void;
}

type DetailTab = 'overview' | 'revenue' | 'metrics' | 'plan' | 'tasks' | 'results';

interface TabConfig {
  id: DetailTab;
  label: string;
}

const tabs: TabConfig[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'revenue', label: 'Revenue & Financials' },
  { id: 'metrics', label: 'Conversion Metrics' },
  // 'plan' (Project Plan) is hidden: its progress summary now sits at the top
  // of the Tasks tab. To restore it, add back { id: 'plan', label: 'Project Plan' }.
  { id: 'tasks', label: 'Tasks' },
  { id: 'results', label: 'Results' },
];

/**
 * Main initiative detail container.
 * Fetches all data, manages tab state, and delegates to sub-components.
 */
export function InitiativeDetail({ initiativeId, onBack }: InitiativeDetailProps) {
  const [initiative, setInitiative] = useState<Initiative | null>(null);
  const [initiativeType, setInitiativeType] = useState<InitiativeType | null>(null);
  const [productName, setProductName] = useState<string>('');
  const [initiativeTypes, setInitiativeTypes] = useState<InitiativeType[]>([]);
  const [products, setProducts] = useState<
    Array<{ id: string; name: string; price: number | null; goalUnits: number | null }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');
  /** The company's initiatives, for the lead handoff (both directions). */
  const [companyInitiatives, setCompanyInitiatives] = useState<Initiative[]>([]);
  const { canEdit } = usePermissions({ canEdit: 'initiatives.edit' });

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        /**
         * TWO PHASES, SEPARATELY FATAL.
         *
         * All five fetches used to share one try/catch, so a failure in any of
         * them rendered "Initiative not found" — including when the initiative
         * had loaded perfectly and it was the PRODUCT NAME lookup that failed.
         * That turned a cosmetic gap into an apparently missing record and sent
         * us looking for the wrong bug.
         *
         * Phase 1 is the initiative itself. Without it there is nothing to
         * show, so a failure here is fatal and its message is surfaced
         * verbatim — the service now distinguishes "no such initiative on this
         * account" from "the lookup failed".
         */
        const initiativeData = await initiativeService.getInitiative(initiativeId);
        setInitiative(initiativeData);

        /**
         * Phase 2 is decoration: the type, the product name and the lists the
         * edit form offers. Every one of these is recoverable — a missing
         * product name costs a label, not the page — so they are settled
         * individually and never blank the screen.
         */
        // A new-intake row may have no product (product_id NULL, migration
        // 045). No id means "none", not a lookup that can only fail.
        const typeId = initiativeData.initiativeTypeId;
        const productId = initiativeData.productId;
        const [typeData, productData, allTypes, allProducts, allInitiatives] = await Promise.allSettled([
          typeId ? initiativeTypeService.getInitiativeType(typeId) : Promise.resolve(null),
          productId ? productService.getProduct(productId) : Promise.resolve(null),
          initiativeTypeService.getAllInitiativeTypes(),
          productService.getProductsByCompany(initiativeData.companyId),
          initiativeService.getInitiativesByCompany(initiativeData.companyId),
        ]);
        if (allInitiatives.status === "fulfilled") setCompanyInitiatives(allInitiatives.value);
        else console.error("[initiative-detail] company initiatives unavailable:", allInitiatives.reason);

        if (typeData.status === "fulfilled") setInitiativeType(typeData.value);
        else console.error("[initiative-detail] initiative type unavailable:", typeData.reason);

        if (productData.status === "fulfilled") setProductName(productData.value?.name ?? '');
        else console.error("[initiative-detail] product unavailable:", productData.reason);

        if (allTypes.status === "fulfilled") setInitiativeTypes(allTypes.value);
        if (allProducts.status === "fulfilled") {
          // Price and goal units: the edit form's units x price target.
          setProducts(
            allProducts.value.map(p => ({ id: p.id, name: p.name, price: p.price ?? null, goalUnits: p.goalUnits ?? null }))
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load initiative';
        setError(message);
        console.error('Error loading initiative detail:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [initiativeId]);

  /**
   * Apply a saved initiative and re-derive the display values (type + product name)
   * from the already-loaded lists, so the header and overview reflect changes
   * without a full reload.
   */
  const handleSaved = (updated: Initiative) => {
    setInitiative(updated);

    const matchedType = updated.initiativeTypeId
      ? initiativeTypes.find(t => t.id === updated.initiativeTypeId)
      : undefined;
    if (matchedType) setInitiativeType(matchedType);

    const matchedProduct = updated.productId ? products.find(p => p.id === updated.productId) : undefined;
    setProductName(matchedProduct ? matchedProduct.name : '');
  };

  if (loading) {
    return (
      <PageContainer>
        <LoadingState message="Loading initiative..." fullPage />
      </PageContainer>
    );
  }

  if (error || !initiative) {
    return (
      <PageContainer>
        <ErrorState
          title="Initiative not found"
          description={error || 'The initiative could not be loaded.'}
          action={
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:bg-[hsl(var(--primary-hover))] transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Initiatives
            </button>
          }
          fullPage
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header with back button */}
      <PageHeader
        title={initiative.name}
        description={initiativeType?.name}
        breadcrumbs={
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-sm text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--primary))] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Initiatives
          </button>
        }
      />

      {/* "Did this run?" and the correction card; renders nothing when there is nothing to ask */}
      <div className="mb-6 empty:hidden">
        <RecurringPrompts
          initiativeId={initiativeId}
          onInitiativeChanged={() => {
            initiativeService
              .getInitiative(initiativeId)
              .then(setInitiative)
              .catch(err => console.error('[initiative-detail] reload after correction failed:', err));
          }}
        />
      </div>

      {/* Tab Navigation */}
      <nav className="border-b border-border" aria-label="Initiative sections">
        <div className="-mb-px flex gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                  : 'border-transparent text-[hsl(var(--foreground-muted))] hover:text-[hsl(var(--foreground))] hover:border-[hsl(var(--border-strong))]'
              }`}
              aria-current={activeTab === tab.id ? 'page' : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      {/* Tab Content */}
      <div className="pt-2">
        {activeTab === 'overview' && (
          <div className="space-y-8">
            <LeadHandoffCard
              initiative={initiative}
              all={companyInitiatives}
              canEdit={canEdit}
              onSaved={attrs => {
                setInitiative(prev => (prev ? { ...prev, attrs } : prev));
                setCompanyInitiatives(prev => prev.map(i => (i.id === initiative.id ? { ...i, attrs } : i)));
              }}
            />
            <InitiativeOverview
              initiative={initiative}
              initiativeType={initiativeType}
              productName={productName}
              initiativeTypes={initiativeTypes}
              products={products}
              onSaved={handleSaved}
            />
            {/* Difficulty Dimensions always shows; the "Why This Initiative" / "When to use"
                part is hidden at the client's request (SHOW_WHY_CARD brings it back). */}
            <InitiativeWhy
              initiativeId={initiative.id}
              libraryKey={initiative.libraryKey}
              initiativeType={initiativeType}
              showWhy={SHOW_WHY_CARD}
            />
          </div>
        )}

        {activeTab === 'revenue' && (
          <InitiativeRevenue
            initiative={initiative}
            initiativeType={initiativeType}
          />
        )}

        {activeTab === 'metrics' && (
          <InitiativeMetrics
            initiative={initiative}
            initiativeType={initiativeType}
          />
        )}

        {activeTab === 'plan' && (
          <InitiativeProjectPlan initiativeId={initiativeId} />
        )}

        {activeTab === 'tasks' && (
          <InitiativeTasks initiativeId={initiativeId} />
        )}

        {activeTab === 'results' && (
          <InitiativeResults initiativeId={initiativeId} />
        )}
      </div>
    </PageContainer>
  );
}

function PlaceholderTab({ label, description }: { label: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-border bg-card p-12 text-center">
      <h3 className="text-base font-semibold text-[hsl(var(--foreground))]">{label}</h3>
      <p className="mt-1.5 text-sm text-[hsl(var(--foreground-muted))] max-w-sm">
        {description}
      </p>
    </div>
  );
}
