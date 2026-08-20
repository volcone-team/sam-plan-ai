import type { QuestionnaireData } from "./questionnaire-data";

/**
 * Per-step validation.
 * Returns an errors object — empty means valid.
 */
export function validateStep(
  stepId: string,
  data: QuestionnaireData
): Record<string, string> {
  switch (stepId) {
    case "revenue-goal":
      return validateRevenueGoal(data);
    case "products":
      return validateProducts(data);
    case "what-works":
      return validateWhatsWorked(data);
    case "ideal-customer":
      return validateIdealCustomer(data);
    case "current-assets":
      return {}; // All optional
    case "budget-team":
      return validateBudgetTeam(data);
    case "obstacles":
      return {}; // All optional
    default:
      return {};
  }
}

function validateRevenueGoal(data: QuestionnaireData): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!data.annualRevenueGoal || data.annualRevenueGoal <= 0) {
    errors.annualRevenueGoal = "Please enter your annual revenue goal";
  }
  if (!data.priorYearRevenue || data.priorYearRevenue < 0) {
    errors.priorYearRevenue = "Please enter your prior year revenue";
  }
  if (!data.planningPeriod) {
    errors.planningPeriod = "Please select a planning period";
  }

  return errors;
}

function validateProducts(data: QuestionnaireData): Record<string, string> {
  const errors: Record<string, string> = {};

  if (data.products.length === 0) {
    errors.products = "Please add at least one product or service";
  } else {
    const hasEmptyName = data.products.some((p) => !p.name.trim());
    if (hasEmptyName) {
      errors.products = "Please provide a name for all products";
    }
  }

  return errors;
}

function validateWhatsWorked(data: QuestionnaireData): Record<string, string> {
  const errors: Record<string, string> = {};

  if (data.whatsWorked.length === 0) {
    errors.whatsWorked = "Please select at least one option";
  }

  return errors;
}

function validateIdealCustomer(data: QuestionnaireData): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!data.idealCustomer.trim()) {
    errors.idealCustomer = "Please describe your ideal customer";
  }

  return errors;
}

function validateBudgetTeam(data: QuestionnaireData): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!data.monthlyMarketingBudget || data.monthlyMarketingBudget <= 0) {
    errors.monthlyMarketingBudget = "Please enter your monthly marketing budget";
  }

  return errors;
}
