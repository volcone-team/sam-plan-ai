/**
 * Shared questionnaire data model.
 * Full Plan is the master set. Quickstart uses a subset.
 * Unanswered fields remain undefined until upgraded.
 */

export type ProductType =
  | "service"
  | "course"
  | "membership"
  | "coaching"
  | "digital-product"
  | "subscription"
  | "other";

export type BusinessStage =
  | "solo"
  | "small-team"
  | "growing-business"
  | "established-business";

export interface ProductEntry {
  id: string;
  name: string;
  type: ProductType;
  price: number | null;
}

export const PRODUCT_TYPE_OPTIONS: { value: ProductType; label: string }[] = [
  { value: "service", label: "Service" },
  { value: "course", label: "Course" },
  { value: "membership", label: "Membership" },
  { value: "coaching", label: "Coaching" },
  { value: "digital-product", label: "Digital Product" },
  { value: "subscription", label: "Subscription" },
  { value: "other", label: "Other" },
];

export const WHATS_WORKED_OPTIONS = [
  "Webinars",
  "Email Marketing",
  "Referrals",
  "Paid Ads",
  "Organic Social",
  "Podcast",
  "Speaking",
  "Partnerships",
  "Content Marketing",
  "Other",
] as const;

export const OBSTACLE_OPTIONS = [
  "Need More Leads",
  "Low Conversion Rate",
  "Weak Sales Process",
  "No Audience",
  "Limited Budget",
  "Limited Time",
  "Team Capacity",
  "Marketing Strategy",
  "Product Positioning",
  "Other",
] as const;

export const BUSINESS_STAGE_OPTIONS: { value: BusinessStage; label: string }[] = [
  { value: "solo", label: "Solo" },
  { value: "small-team", label: "Small Team" },
  { value: "growing-business", label: "Growing Business" },
  { value: "established-business", label: "Established Business" },
];

export interface QuestionnaireData {
  // Q1 — Revenue Goal
  annualRevenueGoal: number | null;
  priorYearRevenue: number | null;
  planningPeriod: "3-months" | "6-months" | "12-months" | null;

  // Q2 — Products & Pricing
  products: ProductEntry[];

  // Q3 — What's Worked
  whatsWorked: string[];
  whatsWorkedNotes: string;

  // Q4 — Ideal Customer
  idealCustomer: string;
  industry: string;
  businessType: string;
  biggestProblem: string;

  // Q5 — Current Assets
  emailListSize: number | null;
  monthlyWebsiteVisitors: number | null;
  socialFollowing: number | null;
  existingCustomers: number | null;
  monthlyLeads: number | null;

  // Q6 — Budget & Team
  monthlyMarketingBudget: number | null;
  teamSize: number | null;
  hoursAvailablePerWeek: number | null;
  businessStage: BusinessStage | null;

  // Q7 — Obstacles
  obstacles: string[];
  obstacleNotes: string;
}

export function createEmptyQuestionnaireData(): QuestionnaireData {
  return {
    annualRevenueGoal: null,
    priorYearRevenue: null,
    planningPeriod: null,
    products: [],
    whatsWorked: [],
    whatsWorkedNotes: "",
    idealCustomer: "",
    industry: "",
    businessType: "",
    biggestProblem: "",
    emailListSize: null,
    monthlyWebsiteVisitors: null,
    socialFollowing: null,
    existingCustomers: null,
    monthlyLeads: null,
    monthlyMarketingBudget: null,
    teamSize: null,
    hoursAvailablePerWeek: null,
    businessStage: null,
    obstacles: [],
    obstacleNotes: "",
  };
}
