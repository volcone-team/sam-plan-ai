/**
 * Questionnaire Framework Types
 *
 * Defines the shape of steps, answers, and validation
 * for both Quickstart and Full Plan flows.
 */

export type QuestionnaireMode = "quickstart" | "full";

export interface StepConfig {
  id: string;
  title: string;
  description: string;
  /** Whether this step is required to proceed */
  required: boolean;
}

export interface ValidationResult {
  valid: boolean;
  errors: Record<string, string>;
}

export type StepValidator = (
  answers: Record<string, unknown>
) => ValidationResult;

export interface QuestionnaireState {
  mode: QuestionnaireMode;
  currentStep: number;
  answers: Record<string, unknown>;
  errors: Record<string, string>;
  isSubmitting: boolean;
}

export type QuestionnaireAction =
  | { type: "NEXT_STEP" }
  | { type: "PREV_STEP" }
  | { type: "GO_TO_STEP"; step: number }
  | { type: "SET_ANSWER"; key: string; value: unknown }
  | { type: "SET_ERRORS"; errors: Record<string, string> }
  | { type: "CLEAR_ERRORS" }
  | { type: "SET_SUBMITTING"; isSubmitting: boolean }
  | { type: "RESET" };
