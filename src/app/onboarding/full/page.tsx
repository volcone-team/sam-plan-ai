import { redirect } from "next/navigation";

/**
 * Retired: the 7-question Full Plan questionnaire.
 *
 * Replaced by intake v2. See the note in `../quickstart/page.tsx` — redirected
 * rather than deleted so existing links do not 404 someone part-way through
 * onboarding.
 */
export default function FullPlanPage() {
  redirect("/intake/start");
}
