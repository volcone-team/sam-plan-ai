/**
 * Product Service
 * Manages products/offerings
 */

import type { Product, CreateProductDTO, UpdateProductDTO } from '@/types';
import productsData from '@/mock-data/products.json';

export class ProductService {
  /**
   * Get all products for a company
   */
  async getProductsByCompany(companyId: string): Promise<Product[]> {
    await this.delay();
    
    return productsData
      .filter(p => p.companyId === companyId)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map(p => this.transformProductData(p));
  }

  /**
   * Get a specific product
   */
  async getProduct(id: string): Promise<Product> {
    await this.delay();
    
    const product = productsData.find(p => p.id === id);
    if (!product) {
      throw new Error(`Product ${id} not found`);
    }

    return this.transformProductData(product);
  }

  /**
   * Get active products (available for initiatives)
   */
  async getActiveProducts(companyId: string): Promise<Product[]> {
    await this.delay();
    
    return productsData
      .filter(p => p.companyId === companyId && p.isActive)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map(p => this.transformProductData(p));
  }

  /**
   * Get products by revenue type
   */
  async getProductsByRevenueType(
    companyId: string,
    revenueType: 'one-time' | 'recurring'
  ): Promise<Product[]> {
    await this.delay();
    
    return productsData
      .filter(p => p.companyId === companyId && p.revenueType === revenueType)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map(p => this.transformProductData(p));
  }

  /**
   * Get products by ticket tier
   */
  async getProductsByTier(
    companyId: string,
    tier: 'low' | 'mid' | 'high'
  ): Promise<Product[]> {
    await this.delay();
    
    return productsData
      .filter(p => p.companyId === companyId && p.ticketTier === tier)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0))
      .map(p => this.transformProductData(p));
  }

  /**
   * Create a new product
   */
  async createProduct(dto: CreateProductDTO): Promise<Product> {
    await this.delay();
    
    const newProduct = {
      id: `prod-${Date.now()}`,
      ...dto,
      isActive: true,
      displayOrder: productsData.filter(p => p.companyId === dto.companyId).length,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    productsData.push(newProduct as typeof productsData[0]);
    return this.transformProductData(newProduct as typeof productsData[0]);
  }

  /**
   * Update product
   */
  async updateProduct(id: string, dto: UpdateProductDTO): Promise<Product> {
    await this.delay();
    
    const index = productsData.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`Product ${id} not found`);
    }

    const updated = {
      ...productsData[index],
      ...dto,
      updatedAt: new Date().toISOString(),
    };

    productsData[index] = updated;
    return this.transformProductData(updated);
  }

  /**
   * Delete a product
   */
  async deleteProduct(id: string): Promise<void> {
    await this.delay();

    const index = productsData.findIndex(p => p.id === id);
    if (index === -1) {
      throw new Error(`Product ${id} not found`);
    }

    productsData.splice(index, 1);
  }

  /**
   * Archive a product
   */
  async archiveProduct(id: string): Promise<Product> {
    return this.updateProduct(id, { isActive: false });
  }

  /**
   * Get revenue ladder
   * Returns products sorted by price (low → high)
   */
  async getRevenueLadder(companyId: string): Promise<Product[]> {
    await this.delay();
    
    return productsData
      .filter(p => p.companyId === companyId && p.isActive)
      .sort((a, b) => a.price - b.price)
      .map(p => this.transformProductData(p));
  }

  /**
   * Transform raw product data to domain type
   */
  private transformProductData(data: typeof productsData[0]): Product {
    return {
      id: data.id,
      companyId: data.companyId,
      name: data.name,
      description: data.description,
      price: data.price,
      revenueType: (data.revenueType as 'one-time' | 'recurring') || 'one-time',
      ticketTier: (data.ticketTier as 'low' | 'mid' | 'high') || 'mid',
      displayOrder: data.displayOrder ?? 0,
      isActive: data.isActive ?? true,
      createdAt: new Date(data.createdAt),
      updatedAt: new Date(data.updatedAt),
    };
  }

  /**
   * Simulate network delay
   */
  private delay(ms: number = 50): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, Math.random() * ms));
  }
}

export const productService = new ProductService();
