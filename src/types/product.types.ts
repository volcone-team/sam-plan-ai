/**
 * Product domain types
 * Represents what the business sells
 */

export type ProductTicketTier = 'low' | 'mid' | 'high';
export type RevenueType = 'one-time' | 'recurring';

export interface Product {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  price: number;
  revenueType: RevenueType;
  ticketTier: ProductTicketTier;
  isActive: boolean;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateProductDTO {
  companyId: string;
  name: string;
  description?: string;
  price: number;
  revenueType: RevenueType;
  ticketTier?: ProductTicketTier;
  displayOrder?: number;
}

export interface UpdateProductDTO {
  name?: string;
  description?: string;
  price?: number;
  revenueType?: RevenueType;
  ticketTier?: ProductTicketTier;
  isActive?: boolean;
  displayOrder?: number;
}
