/**
 * Product domain types
 * Represents what the business sells
 */

export type ProductTicketTier = 'low' | 'mid' | 'high';
export type RevenueType = 'one-time' | 'recurring';
/** How a recurring product is billed (migration 055). Matches intake_products.recurring_interval. */
export type RecurringInterval = 'month' | 'year';

export interface Product {
  id: string;
  companyId: string;
  name: string;
  description?: string;
  price: number;
  revenueType: RevenueType;
  /** Recurring products only; null for one-time. An unrecorded interval reads as 'month'. */
  recurringInterval: RecurringInterval | null;
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
  recurringInterval?: RecurringInterval | null;
  ticketTier?: ProductTicketTier;
  displayOrder?: number;
}

export interface UpdateProductDTO {
  name?: string;
  description?: string;
  price?: number;
  revenueType?: RevenueType;
  recurringInterval?: RecurringInterval | null;
  ticketTier?: ProductTicketTier;
  isActive?: boolean;
  displayOrder?: number;
}
