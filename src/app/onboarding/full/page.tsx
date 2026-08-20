import { Suspense } from "react";
import { QuestionnaireEngine } from "@/components/questionnaire";

/**
 * Full Plan questionnaire — 7-step flow.
 */
export default function FullPlanPage() {
  return (
    <Suspense>
      <QuestionnaireEngine mode="full" />
    </Suspense>
  );
}
