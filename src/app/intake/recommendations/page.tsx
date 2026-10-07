import { RecommendationsPage } from "./recommendations-page";

/**
 * `/intake/recommendations` — the output screen.
 *
 * A sibling of `/intake/[screen]` rather than another screen slug, because it
 * is not part of the questionnaire: `flow.ts` owns the ten screens and their
 * progress, and adding an eleventh entry would have every screen report "Step n
 * of 11" while this one sits outside the sequence.
 *
 * Also outside the `(app)` route group, for the same reason as the intake
 * screens: there is no plan to navigate to until "Build my plan" runs.
 */
export default function Page() {
  return <RecommendationsPage />;
}
