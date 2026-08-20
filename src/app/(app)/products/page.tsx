'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Check,
  RefreshCw,
  DollarSign,
  Rocket,
} from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout';
import { productService } from '@/services/product.service';
import { projectionService } from '@/services/projection.service';
import { initiativeService } from '@/services/initiative.service';
import type { Product, CreateProductDTO, UpdateProductDTO, RevenueType, ProductTicketTier } from '@/types';

const companyId = 'comp-8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d';
type ProductType = 'Service' | 'Course' | 'Membership' | 'Coaching' | 'Digital Product' | 'Subscription';

const PRODUCT_TYPES: ProductType[] = [
  'Service',
  'Course',
  'Membership',
  'Coaching',
  'Digital Product',
  'Subscription',
];

const TYPE_COLORS: Record<ProductType, string> = {
  Service: 'bg-blue-100 text-blue-800',
  Course: 'bg-purple-100 text-purple-800',
  Membership: 'bg-green-100 text-green-800',
  Coaching: 'bg-amber-100 text-amber-800',
  'Digital Product': 'bg-pink-100 text-pink-800',
  Subscription: 'bg-teal-100 text-teal-800',
};

const TIER_LABELS: Record<ProductTicketTier, string> = {
  low: 'Low Ticket',
  mid: 'Mid Ticket',
  high: 'High Ticket',
};

const TIER_COLORS: Record<ProductTicketTier, string> = {
  low: 'bg-slate-100 text-slate-700',
  mid: 'bg-indigo-100 text-indigo-700',
  high: 'bg-emerald-100 text-emerald-700',
};

function inferProductType(product: Product): ProductType {
  const name = product.name.toLowerCase();
  if (name.includes('coaching') || name.includes('coach')) return 'Coaching';
  if (name.includes('course') || name.includes('masterclass')) return 'Course';
  if (name.includes('membership') || name.includes('circle')) return 'Membership';
  if (name.includes('subscription')) return 'Subscription';
  if (name.includes('digital') || name.includes('download')) return 'Digital Product';
  return 'Service';
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface ProductFormData {
  name: string;
  price: string;
  type: ProductType;
  revenueType: RevenueType;
  ticketTier: ProductTicketTier;
}

const emptyForm: ProductFormData = {
  name: '',
  price: '',
  type: 'Service',
  revenueType: 'one-time',
  ticketTier: 'mid',
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revenueMap, setRevenueMap] = useState<Map<string, number>>(new Map());
  const [initiativeCountMap, setInitiativeCountMap] = useState<Map<string, number>>(new Map());

  // Add product state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<ProductFormData>(emptyForm);
  const [addLoading, setAddLoading] = useState(false);

  // Edit product state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ProductFormData>(emptyForm);
  const [editLoading, setEditLoading] = useState(false);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [productsData, revenueData] = await Promise.all([
        productService.getProductsByCompany(companyId),
        projectionService.getProjectedRevenueByProduct(companyId, 'better'),
      ]);

      setProducts(productsData);

      // Build revenue map
      const revMap = new Map<string, number>();
      for (const item of revenueData) {
        revMap.set(item.productId, item.revenue);
      }
      setRevenueMap(revMap);

      // Load initiative counts per product
      const countMap = new Map<string, number>();
      const countPromises = productsData.map(async (product) => {
        const initiatives = await initiativeService.getInitiativesByProduct(companyId, product.id);
        countMap.set(product.id, initiatives.length);
      });
      await Promise.all(countPromises);
      setInitiativeCountMap(countMap);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load products';
      setError(message);
      console.error('Error loading products:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddProduct = async () => {
    if (!addForm.name.trim() || !addForm.price) return;
    try {
      setAddLoading(true);
      const dto: CreateProductDTO = {
        companyId: companyId,
        name: addForm.name.trim(),
        price: parseFloat(addForm.price),
        revenueType: addForm.revenueType,
        ticketTier: addForm.ticketTier,
      };
      const newProduct = await productService.createProduct(dto);
      setProducts((prev) => [...prev, newProduct]);
      setAddForm(emptyForm);
      setShowAddForm(false);
    } catch (err) {
      console.error('Error creating product:', err);
    } finally {
      setAddLoading(false);
    }
  };

  const handleStartEdit = (product: Product) => {
    setEditingId(product.id);
    setEditForm({
      name: product.name,
      price: String(product.price),
      type: inferProductType(product),
      revenueType: product.revenueType,
      ticketTier: product.ticketTier,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editForm.name.trim() || !editForm.price) return;
    try {
      setEditLoading(true);
      const dto: UpdateProductDTO = {
        name: editForm.name.trim(),
        price: parseFloat(editForm.price),
        revenueType: editForm.revenueType,
        ticketTier: editForm.ticketTier,
      };
      const updated = await productService.updateProduct(editingId, dto);
      setProducts((prev) => prev.map((p) => (p.id === editingId ? updated : p)));
      setEditingId(null);
    } catch (err) {
      console.error('Error updating product:', err);
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setDeleteLoading(true);
      await productService.deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      setDeletingId(null);
    } catch (err) {
      console.error('Error deleting product:', err);
    } finally {
      setDeleteLoading(false);
    }
  };

  // Calculate total projected revenue
  const totalRevenue = Array.from(revenueMap.values()).reduce((sum, r) => sum + r, 0);

  return (
    <PageContainer>
      <PageHeader
        title="Products"
        description="Manage your products and revenue offerings"
        actions={
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90"
          >
            <Plus className="h-4 w-4" />
            Add Product
          </button>
        }
      />

      {/* Revenue Summary */}
      {!loading && totalRevenue > 0 && (
        <div className="mb-6 rounded-[var(--radius-md)] border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-[hsl(var(--foreground-muted))]">
            <DollarSign className="h-4 w-4" />
            <span>Total Projected Revenue (Better scenario)</span>
          </div>
          <p className="mt-1 text-2xl font-semibold text-[hsl(var(--foreground))]">
            {formatCurrency(totalRevenue)}
          </p>
        </div>
      )}

      {/* Add Product Form */}
      {showAddForm && (
        <div className="mb-6 rounded-[var(--radius-md)] border border-border bg-card p-5">
          <h3 className="mb-4 text-sm font-semibold text-[hsl(var(--foreground))]">
            New Product
          </h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground-muted))]">
                Name
              </label>
              <input
                type="text"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Product name"
                className="w-full rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground-muted))]">
                Price
              </label>
              <input
                type="number"
                value={addForm.price}
                onChange={(e) => setAddForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0"
                min="0"
                step="1"
                className="w-full rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--foreground-muted))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground-muted))]">
                Type
              </label>
              <select
                value={addForm.type}
                onChange={(e) => setAddForm((f) => ({ ...f, type: e.target.value as ProductType }))}
                className="w-full rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground-muted))]">
                Ticket Tier
              </label>
              <select
                value={addForm.ticketTier}
                onChange={(e) => setAddForm((f) => ({ ...f, ticketTier: e.target.value as ProductTicketTier }))}
                className="w-full rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
              >
                <option value="low">Low Ticket</option>
                <option value="mid">Mid Ticket</option>
                <option value="high">High Ticket</option>
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-[hsl(var(--foreground))]">
                <input
                  type="checkbox"
                  checked={addForm.revenueType === 'recurring'}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      revenueType: e.target.checked ? 'recurring' : 'one-time',
                    }))
                  }
                  className="h-4 w-4 rounded border-border"
                />
                Recurring
              </label>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={handleAddProduct}
              disabled={addLoading || !addForm.name.trim() || !addForm.price}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90 disabled:opacity-50"
            >
              {addLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Create
            </button>
            <button
              onClick={() => {
                setShowAddForm(false);
                setAddForm(emptyForm);
              }}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-border px-4 py-2 text-sm font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background))]"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="animate-pulse rounded-[var(--radius-md)] border border-border bg-card p-5"
            >
              <div className="mb-3 h-5 w-3/4 rounded bg-[hsl(var(--foreground-muted))]/20" />
              <div className="mb-2 h-4 w-1/2 rounded bg-[hsl(var(--foreground-muted))]/20" />
              <div className="h-4 w-1/3 rounded bg-[hsl(var(--foreground-muted))]/20" />
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="rounded-[var(--radius-md)] border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Product Grid */}
      {!loading && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((product) => {
            const productType = inferProductType(product);
            const revenue = revenueMap.get(product.id);
            const initiativeCount = initiativeCountMap.get(product.id) ?? 0;
            const isEditing = editingId === product.id;
            const isDeleting = deletingId === product.id;

            if (isEditing) {
              return (
                <div
                  key={product.id}
                  className="rounded-[var(--radius-md)] border-2 border-[hsl(var(--primary))]/50 bg-card p-5"
                >
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground-muted))]">
                        Name
                      </label>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                        className="w-full rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground-muted))]">
                        Price
                      </label>
                      <input
                        type="number"
                        value={editForm.price}
                        onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                        min="0"
                        step="1"
                        className="w-full rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground-muted))]">
                        Type
                      </label>
                      <select
                        value={editForm.type}
                        onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value as ProductType }))}
                        className="w-full rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                      >
                        {PRODUCT_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-[hsl(var(--foreground-muted))]">
                        Ticket Tier
                      </label>
                      <select
                        value={editForm.ticketTier}
                        onChange={(e) => setEditForm((f) => ({ ...f, ticketTier: e.target.value as ProductTicketTier }))}
                        className="w-full rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
                      >
                        <option value="low">Low Ticket</option>
                        <option value="mid">Mid Ticket</option>
                        <option value="high">High Ticket</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-[hsl(var(--foreground))]">
                      <input
                        type="checkbox"
                        checked={editForm.revenueType === 'recurring'}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            revenueType: e.target.checked ? 'recurring' : 'one-time',
                          }))
                        }
                        className="h-4 w-4 rounded border-border"
                      />
                      Recurring
                    </label>
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={handleSaveEdit}
                        disabled={editLoading || !editForm.name.trim() || !editForm.price}
                        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90 disabled:opacity-50"
                      >
                        {editLoading ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background))]"
                      >
                        <X className="h-3.5 w-3.5" />
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={product.id}
                className="group relative rounded-[var(--radius-md)] border border-border bg-card p-5 transition-shadow hover:shadow-sm"
              >
                {/* Delete Confirmation Overlay */}
                {isDeleting && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-[var(--radius-md)] bg-card/95 backdrop-blur-sm">
                    <p className="mb-3 text-sm font-medium text-[hsl(var(--foreground))]">
                      Delete this product?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDelete(product.id)}
                        disabled={deleteLoading}
                        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleteLoading ? (
                          <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                        Confirm
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-border px-3 py-1.5 text-xs font-medium text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background))]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Card Header */}
                <div className="mb-3 flex items-start justify-between">
                  <h3 className="text-sm font-semibold text-[hsl(var(--foreground))] leading-tight">
                    {product.name}
                  </h3>
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => handleStartEdit(product)}
                      className="rounded p-1 text-[hsl(var(--foreground-muted))] transition-colors hover:bg-[hsl(var(--background))] hover:text-[hsl(var(--foreground))]"
                      aria-label={`Edit ${product.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingId(product.id)}
                      className="rounded p-1 text-[hsl(var(--foreground-muted))] transition-colors hover:bg-red-50 hover:text-red-600"
                      aria-label={`Delete ${product.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Price */}
                <p className="mb-3 text-lg font-bold text-[hsl(var(--foreground))]">
                  {formatCurrency(product.price)}
                  {product.revenueType === 'recurring' && (
                    <span className="ml-1 text-xs font-normal text-[hsl(var(--foreground-muted))]">
                      /mo
                    </span>
                  )}
                </p>

                {/* Badges */}
                <div className="mb-3 flex flex-wrap gap-1.5">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[productType]}`}
                  >
                    {productType}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      product.revenueType === 'recurring'
                        ? 'bg-cyan-100 text-cyan-800'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {product.revenueType === 'recurring' ? 'Recurring' : 'One-time'}
                  </span>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TIER_COLORS[product.ticketTier]}`}
                  >
                    {TIER_LABELS[product.ticketTier]}
                  </span>
                </div>

                {/* Revenue & Initiatives */}
                <div className="space-y-1.5 border-t border-border pt-3">
                  {revenue !== undefined && (
                    <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--foreground-muted))]">
                      <DollarSign className="h-3.5 w-3.5" />
                      <span>Projected: {formatCurrency(revenue)}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--foreground-muted))]">
                    <Rocket className="h-3.5 w-3.5" />
                    <span>
                      {initiativeCount} initiative{initiativeCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && products.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-[var(--radius-md)] border border-border bg-card py-16">
          <p className="mb-2 text-sm font-medium text-[hsl(var(--foreground))]">
            No products yet
          </p>
          <p className="mb-4 text-xs text-[hsl(var(--foreground-muted))]">
            Create your first product to start tracking revenue
          </p>
          <button
            onClick={() => setShowAddForm(true)}
            className="inline-flex items-center gap-2 rounded-[var(--radius-md)] bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-colors hover:bg-[hsl(var(--primary))]/90"
          >
            <Plus className="h-4 w-4" />
            Add Product
          </button>
        </div>
      )}
    </PageContainer>
  );
}
