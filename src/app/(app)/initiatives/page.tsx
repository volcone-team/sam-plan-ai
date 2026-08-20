'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout';
import { InitiativesList, AddInitiativePanel } from '@/components/initiatives';
import { initiativeService } from '@/services/initiative.service';
import { initiativeTypeService } from '@/services/initiative-type.service';
import { productService } from '@/services/product.service';
import type { Initiative, InitiativeType, CreateInitiativeDTO } from '@/types';

const ANNUAL_PLAN_ID = 'plan-annual-2026-7a8b9c0d-e1f2-43a4-9b5c-6d7e8f9a0b1c';
const companyId = 'comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d';

export default function InitiativesPage() {
  const router = useRouter();
  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [initiativeTypes, setInitiativeTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [fullInitiativeTypes, setFullInitiativeTypes] = useState<InitiativeType[]>([]);
  const [products, setProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [initiativesData, typesData, productsData] = await Promise.all([
          initiativeService.getInitiativesByCompany(companyId),
          initiativeTypeService.getAllInitiativeTypes(),
          productService.getProductsByCompany(companyId),
        ]);

        setInitiatives(initiativesData);
        setFullInitiativeTypes(typesData);
        setInitiativeTypes(
          typesData.map(t => ({
            id: t.id,
            name: t.name,
          }))
        );
        setProducts(
          productsData.map(p => ({
            id: p.id,
            name: p.name,
          }))
        );
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
  }, []);

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
          <button
            onClick={() => setAddPanelOpen(true)}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90"
          >
            <Plus className="h-4 w-4" />
            Add Initiative
          </button>
        }
      />
      <InitiativesList
        initiatives={initiatives}
        initiativeTypes={initiativeTypes}
        products={products}
        loading={loading}
        error={error}
        onInitiativeClick={handleInitiativeClick}
        onRemoveInitiative={handleRemoveInitiative}
      />

      <AddInitiativePanel
        open={addPanelOpen}
        onClose={() => setAddPanelOpen(false)}
        onSubmit={handleAddInitiative}
        initiativeTypes={fullInitiativeTypes}
        products={products}
        companyId={companyId}
        annualPlanId={ANNUAL_PLAN_ID}
      />
    </PageContainer>
  );
}
