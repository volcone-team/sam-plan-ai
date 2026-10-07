import { redirect } from "next/navigation";

/**
 * Retired: the review screen (D2).
 *
 * The recommendations screen replaces it and is now the single commit point.
 * Two confirmations back to back was one too many, and the recommendations
 * screen already shows more than this page did — the gap to goal, a forecast
 * per initiative, and the ability to change the shortlist before anything is
 * written.
 *
 * This page also read its answers from `localStorage`, which the v2 intake
 * does not write: answers live in `planning_inputs` so the chatbot and the
 * generator can read them. Rendering it against v2 data would show an empty
 * review, which is worse than a redirect.
 */
export default function ReviewPage() {
  redirect("/intake/recommendations");
}
