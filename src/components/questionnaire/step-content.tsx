import type { StepConfig } from "./questionnaire-types";
import type { QuestionnaireData } from "./questionnaire-data";
import {
  RevenueGoalStep,
  ProductsStep,
  WhatsWorkedStep,
  IdealCustomerStep,
  CurrentAssetsStep,
  BudgetTeamStep,
  ObstaclesStep,
} from "./steps";

export interface StepContentProps {
  step: StepConfig;
  answers: Record<string, unknown>;
  errors: Record<string, string>;
  onAnswer: (key: string, value: unknown) => void;
  questionnaireData: QuestionnaireData;
  onDataChange: (updates: Partial<QuestionnaireData>) => void;
}

/**
 * Renders the appropriate question component for the current step.
 */
export function StepContent({
  step,
  errors,
  questionnaireData,
  onDataChange,
}: StepContentProps) {
  return (
    <div className="py-8">
      <div className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {step.title}
        </h2>
        <p className="mt-2 text-sm text-[hsl(var(--foreground-muted))]">
          {step.description}
        </p>
      </div>

      {renderStepComponent(step.id, questionnaireData, onDataChange, errors)}
    </div>
  );
}

function renderStepComponent(
  stepId: string,
  data: QuestionnaireData,
  onChange: (updates: Partial<QuestionnaireData>) => void,
  errors: Record<string, string>
) {
  switch (stepId) {
    case "revenue-goal":
      return <RevenueGoalStep data={data} onChange={onChange} errors={errors} />;
    case "products":
      return <ProductsStep data={data} onChange={onChange} errors={errors} />;
    case "what-works":
      return <WhatsWorkedStep data={data} onChange={onChange} errors={errors} />;
    case "ideal-customer":
      return <IdealCustomerStep data={data} onChange={onChange} errors={errors} />;
    case "current-assets":
      return <CurrentAssetsStep data={data} onChange={onChange} errors={errors} />;
    case "budget-team":
      return <BudgetTeamStep data={data} onChange={onChange} errors={errors} />;
    case "obstacles":
      return <ObstaclesStep data={data} onChange={onChange} errors={errors} />;
    default:
      return (
        <div className="rounded-[var(--radius-lg)] border border-dashed border-border bg-[hsl(var(--background-muted))] p-8 text-center">
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            Unknown step: {stepId}
          </p>
        </div>
      );
  }
}
