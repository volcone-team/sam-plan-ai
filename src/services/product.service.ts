/**
 * Product Service
 * Manages products/offerings.
 *
 * Strategy: Try Supabase first. If not configured or query fails,
 * fall back to mock JSON data.
 */

import type { Product, CreateProductDTO, UpdateProductDTO } from '@/types';
import { isSupabaseConfigured, getSupabase, camelToSnake } from '@/lib/supabase/db';

export class ProductService {
  /**
   * Get all products for a company
   */
  async getProductsByCompany(companyId: string): Promise<Product[]> {
    if (!companyId) { console.log("[product] getProductsByCompany - no companyId"); return []; }
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('company_id', companyId)
          .order('display_order', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRowToProduct(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[product] No data in Supabase, returning empty");
    console.log("[product] No data, returning []"); return [];
  }

  /**
   * Get a specific product
   */
  async getProduct(id: string): Promise<Product> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('id', id)
          .single();

        if (!error && data) {
          return this.mapRowToProduct(data);
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[product] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  /**
   * Get active products (available for initiatives)
   */
  async getActiveProducts(companyId: string): Promise<Product[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('display_order', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRowToProduct(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[product] No data in Supabase, returning empty");
    console.log("[product] No data, returning []"); return [];
  }

  /**
   * Get products by revenue type
   */
  async getProductsByRevenueType(
    companyId: string,
    revenueType: 'one-time' | 'recurring'
  ): Promise<Product[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('company_id', companyId)
          .eq('revenue_type', revenueType)
          .order('display_order', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRowToProduct(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[product] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  /**
   * Get products by ticket tier
   */
  async getProductsByTier(
    companyId: string,
    tier: 'low' | 'mid' | 'high'
  ): Promise<Product[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('company_id', companyId)
          .eq('ticket_tier', tier)
          .order('display_order', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRowToProduct(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[product] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  /**
   * Create a new product
   */
  async createProduct(dto: CreateProductDTO): Promise<Product> {
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      const insertData = {
        company_id: dto.companyId,
        name: dto.name,
        description: dto.description || '',
        price: dto.price,
        revenue_type: dto.revenueType || 'one-time',
        ticket_tier: dto.ticketTier || 'mid',
        is_active: true,
        display_order: dto.displayOrder ?? 0,
      };

      const { data, error } = await supabase
        .from('products')
        .insert(insertData)
        .select()
        .single();

      // Surface write failures instead of returning throwaway mock data.
      if (error || !data) {
        console.error('[Supabase createProduct]', (error as any)?.message, '|details:', (error as any)?.details, '|hint:', (error as any)?.hint, insertData);
        throw new Error((error as any)?.message || 'Could not save the product.');
      }

      return this.mapRowToProduct(data);
    }

    // Mock data removed - return empty
    console.log("[product] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  /**
   * Update product
   */
  async updateProduct(id: string, dto: UpdateProductDTO): Promise<Product> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const updateData = camelToSnake(dto as unknown as Record<string, unknown>);

        const { data, error } = await supabase
          .from('products')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (!error && data) {
          return this.mapRowToProduct(data);
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[product] No data in Supabase, returning empty");
    throw new Error("Not found");
  }

  /**
   * Delete a product
   */
  async deleteProduct(id: string): Promise<void> {
    if (isSupabaseConfigured()) {
      const supabase = getSupabase();
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) {
        // FK constraint = product is in use by an initiative
        if (error.code === '23503') {
          throw new Error('Cannot delete this product because it is linked to one or more initiatives. Remove or reassign those initiatives first.');
        }
        throw new Error(error.message);
      }
      return;
    }

    // Mock data removed - return empty
    console.log("[product] No data in Supabase, returning empty");
    console.log("[product] No data"); return;
  }

  /**
   * Get revenue ladder (sorted by price low → high)
   */
  async getRevenueLadder(companyId: string): Promise<Product[]> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('company_id', companyId)
          .eq('is_active', true)
          .order('price', { ascending: true });

        if (!error && data) {
          return data.map(row => this.mapRowToProduct(row));
        }
      } catch (e) { console.error("[Supabase]", e); }
    }

    // Mock data removed - return empty
    console.log("[product] No data in Supabase, returning empty");
    console.log("[product] No data, returning []"); return [];
  }

  /**
   * Map Supabase row to Product type
   */
  private mapRowToProduct(row: Record<string, unknown>): Product {
    return {
      id: row.id as string,
      companyId: row.company_id as string,
      name: row.name as string,
      description: (row.description as string) || '',
      price: Number(row.price) || 0,
      revenueType: (row.revenue_type as Product['revenueType']) || 'one-time',
      ticketTier: (row.ticket_tier as Product['ticketTier']) || 'mid',
      isActive: row.is_active as boolean ?? true,
      displayOrder: (row.display_order as number) ?? 0,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    };
  }

  

  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const productService = new ProductService();
