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
  { id: 'plan', label: 'Project Plan' },
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTab>('overview');

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const initiativeData = await initiativeService.getInitiative(initiativeId);
        setInitiative(initiativeData);

        const [typeData, productData] = await Promise.all([
          initiativeTypeService.getInitiativeType(initiativeData.initiativeTypeId),
          productService.getProduct(initiativeData.productId),
        ]);

        setInitiativeType(typeData);
        setProductName(productData.name);
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
            <InitiativeOverview
              initiative={initiative}
              initiativeType={initiativeType}
              productName={productName}
            />
            <InitiativeWhy initiativeType={initiativeType} />
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
