import { redirect } from "next/navigation";

/**
 * Retired: the 3-step Quickstart questionnaire.
 *
 * Intake v2 replaces both Quickstart and the 7-question Full flow with a single
 * path-aware questionnaire. The Quickstart/Full split asked users to predict
 * how much detail they wanted before seeing a single question; screen 0 of the
 * new intake asks how much of their plan they already know, which they can
 * actually answer.
 *
 * REDIRECTED rather than deleted: this path is linked from old emails, the
 * welcome screen's history, and anyone's bookmarks. A 404 for a user mid-
 * onboarding is worse than landing them on the current flow.
 */
export default function QuickstartPage() {
  redirect("/intake/start");
}
