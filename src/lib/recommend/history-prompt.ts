/**
 * The intake's "wins and struggles" answers, as the recommendation prompt
 * states them. Pure, so the wording is testable outside the route.
 *
 * Two kinds of history reach the model:
 *
 *   what_worked_notes / what_failed_notes  free text from the wins screen
 *                                          (planning_inputs, migration 025).
 *   didntWork                              library keys from LEGACY 'failed'
 *                                          intake_initiatives rows, saved
 *                                          before the screen became free text.
 *
 * Only the legacy keys are a HARD exclusion (passesDidntWork in
 * eligibility.ts). Free text cannot be matched to a library key reliably, so it
 * is guidance to the model, which explains a shortlist it does not choose.
 */

/** One line per answer given; blanks produce no line. */
export function historyPromptLines(
  input: Record<string, unknown>,
  didntWork: readonly string[]
): string[] {
  const worked = text(input.what_worked_notes);
  const failed = text(input.what_failed_notes);

  return [
    worked ? `What has worked: ${worked}` : null,
    failed ? `What has not worked: ${failed}` : null,
    // Stated so the explanations do not lean on something that already flopped.
    didntWork.length > 0 ? `Already tried and failed: ${didntWork.join(", ")}` : null,
  ].filter((line): line is string => line !== null);
}

/**
 * The system-prompt rule that goes with those lines.
 *
 * The model cannot drop a shortlisted initiative (the server keys everything by
 * the shortlist), so "do not recommend" is expressed as what it CAN control:
 * not arguing for the play, and flagging it in `watchOutFor`.
 */
export const HISTORY_PROMPT_RULE =
  '- "What has not worked" and "Already tried and failed" list plays this business ' +
  "tried that did not work. Do not recommend those plays or argue for them. If a " +
  "shortlisted initiative is one of them, do not present it as a good fit: say plainly " +
  "in `whyFits` what would have to be different this time, and use `watchOutFor` to " +
  'name what went wrong before. Lean on "What has worked" where it is relevant.';

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
