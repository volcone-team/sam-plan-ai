import type {
  QuestionnaireState,
  QuestionnaireAction,
  QuestionnaireMode,
} from "./questionnaire-types";
import { getStepsForMode } from "./questionnaire-config";

export function createInitialState(mode: QuestionnaireMode): QuestionnaireState {
  return {
    mode,
    currentStep: 0,
    answers: {},
    errors: {},
    isSubmitting: false,
  };
}

export function questionnaireReducer(
  state: QuestionnaireState,
  action: QuestionnaireAction
): QuestionnaireState {
  const steps = getStepsForMode(state.mode);
  const maxStep = steps.length - 1;

  switch (action.type) {
    case "NEXT_STEP":
      return {
        ...state,
        currentStep: Math.min(state.currentStep + 1, maxStep),
        errors: {},
      };

    case "PREV_STEP":
      return {
        ...state,
        currentStep: Math.max(state.currentStep - 1, 0),
        errors: {},
      };

    case "GO_TO_STEP":
      return {
        ...state,
        currentStep: Math.max(0, Math.min(action.step, maxStep)),
        errors: {},
      };

    case "SET_ANSWER":
      return {
        ...state,
        answers: { ...state.answers, [action.key]: action.value },
      };

    case "SET_ERRORS":
      return {
        ...state,
        errors: action.errors,
      };

    case "CLEAR_ERRORS":
      return {
        ...state,
        errors: {},
      };

    case "SET_SUBMITTING":
      return {
        ...state,
        isSubmitting: action.isSubmitting,
      };

    case "RESET":
      return createInitialState(state.mode);

    default:
      return state;
  }
}
