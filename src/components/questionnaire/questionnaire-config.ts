import type { StepConfig, QuestionnaireMode } from "./questionnaire-types";

/**
 * Step configurations for each questionnaire mode.
 * No actual questions — just the framework structure.
 * Business questions will be added in a future phase.
 */

export const quickstartSteps: StepConfig[] = [
  {
    id: "revenue-goal",
    title: "Revenue Goal",
    description: "What revenue are you aiming for?",
    required: true,
  },
  {
    id: "products",
    title: "Products & Services",
    description: "What do you sell?",
    required: true,
  },
  {
    id: "what-works",
    title: "What's Worked",
    description: "Which initiatives have driven real results?",
    required: true,
  },
];

export const fullPlanSteps: StepConfig[] = [
  {
    id: "revenue-goal",
    title: "Revenue Goal",
    description: "What revenue are you aiming for, and over what period?",
    required: true,
  },
  {
    id: "products",
    title: "Products & Pricing",
    description: "Add your products or services, with pricing.",
    required: true,
  },
  {
    id: "what-works",
    title: "What's Worked",
    description: "Which marketing or sales initiatives have driven real results?",
    required: true,
  },
  {
    id: "ideal-customer",
    title: "Ideal Customer",
    description: "Describe who you're trying to reach.",
    required: true,
  },
  {
    id: "current-assets",
    title: "Current Assets",
    description: "What do you already have? Email list, social following, traffic.",
    required: true,
  },
  {
    id: "budget-team",
    title: "Budget & Team",
    description: "What's your monthly marketing budget, and who's on your team?",
    required: true,
  },
  {
    id: "obstacles",
    title: "Obstacles",
    description: "What's held you back, or what hasn't worked?",
    required: false,
  },
];

export function getStepsForMode(mode: QuestionnaireMode): StepConfig[] {
  return mode === "quickstart" ? quickstartSteps : fullPlanSteps;
}
