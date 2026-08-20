import { Suspense } from "react";
import { QuestionnaireEngine } from "@/components/questionnaire";

/**
 * Quickstart questionnaire — 3-step flow.
 */
export default function QuickstartPage() {
  return (
    <Suspense>
      <QuestionnaireEngine mode="quickstart" />
    </Suspense>
  );
}
