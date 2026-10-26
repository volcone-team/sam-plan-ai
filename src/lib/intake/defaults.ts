/**
 * Defaults a screen SHOWS as selected must also be STORED as the answer.
 *
 * Screen 3's period pills render 12 months as chosen when nothing is saved. If
 * that stays display-only, `answers.horizon_months` is still blank, validation
 * blocks Continue with "Choose how far ahead to plan." and the user has to pick
 * another period and back again to get through. Writing the default into the
 * answers when the screen is shown makes what they see and what is saved agree.
 *
 * `plan_start_month` is deliberately NOT defaulted: its select shows a
 * "Choose a month…" placeholder, so a blank answer is visible as blank and the
 * required error is the honest response.
 */

import { DEFAULT_PLANNING_PERIOD, isPlanningPeriod } from "@/lib/intake/schema";
import type { IntakeAnswers } from "@/lib/intake/validation";

/**
 * The answers screen 3 should hold before the user touches it, as a patch.
 *
 * Empty when nothing needs setting, so the caller can skip the state update —
 * which is also what stops an effect using this from looping. A saved valid
 * period (3, 6, 12, 18) is never overwritten.
 */
export function productScreenDefaults(answers: IntakeAnswers): IntakeAnswers {
  if (isPlanningPeriod(answers.horizon_months)) return {};
  return { horizon_months: DEFAULT_PLANNING_PERIOD };
}

/** `answers` with screen 3's defaults applied. Returns the same object when none apply. */
export function withProductScreenDefaults(answers: IntakeAnswers): IntakeAnswers {
  const patch = productScreenDefaults(answers);
  return Object.keys(patch).length === 0 ? answers : { ...answers, ...patch };
}
