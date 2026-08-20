/**
 * Planning Input domain types
 * Represents the 7 intake questions from the questionnaire
 */

export type IntakeRoute = 'quickstart' | 'full' | 'foundation';
export type TimeframeOption = 3 | 6 | 12; // months

export interface PlanningInput {
  id: string;
  companyId: string;
  intakeRoute: IntakeRoute;
  completedAt?: Date;
  // Q1: Revenue goal & timeframe
  revenueGoal: number;
  revenueTimeframe: TimeframeOption;
  // Q2: Products & pricing (references Product entities)
  productIds: string[];
  // Q3 & Q7: What's worked before / Obstacles (combined)
  successfulInitiativeTypes: string[]; // initiative type IDs
  failedInitiatives: string; // text description
  // Q4: Ideal customer
  idealCustomerDescription: string;
  // Q5: Current assets
  currentAssets: {
    emailListSize: number;
    socialFollowing: number;
    websiteMonthlyVisitors: number;
    existingCustomers: number;
  };
  // Q6: Budget & team
  monthlyMarketingBudget: number;
  teamSize: number;
  teamRoles: string[]; // e.g., ['founder', 'marketer', 'designer']
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePlanningInputDTO {
  companyId: string;
  intakeRoute: IntakeRoute;
  // Q1
  revenueGoal: number;
  revenueTimeframe: TimeframeOption;
  // Q2
  productIds: string[];
  // Q3 & Q7
  successfulInitiativeTypes?: string[];
  failedInitiatives?: string;
  // Q4
  idealCustomerDescription?: string;
  // Q5
  currentAssets?: {
    emailListSize?: number;
    socialFollowing?: number;
    websiteMonthlyVisitors?: number;
    existingCustomers?: number;
  };
  // Q6
  monthlyMarketingBudget?: number;
  teamSize?: number;
  teamRoles?: string[];
}

export interface UpdatePlanningInputDTO {
  revenueGoal?: number;
  revenueTimeframe?: TimeframeOption;
  productIds?: string[];
  successfulInitiativeTypes?: string[];
  failedInitiatives?: string;
  idealCustomerDescription?: string;
  currentAssets?: Partial<PlanningInput['currentAssets']>;
  monthlyMarketingBudget?: number;
  teamSize?: number;
  teamRoles?: string[];
}
