/**
 * Sequencing generated initiatives so a plan is actually executable.
 *
 * The AI picks a month and a day for each initiative with no awareness of the
 * others, so left alone it produces launches on the same day and preparation
 * windows stacked on top of each other. For a small team that is not a plan,
 * it is a pile-up.
 *
 * Everything here is derived from the plan's own numbers - each initiative's
 * longest task lead time is its preparation window - so there are no arbitrary
 * gaps or minimums to tune.
 */

import {
  addDays, parseDateOnly, subDays, toDateOnly, todayDateOnly, clampNotBefore,
} from '@/lib/plan-dates';

export interface SchedulableInitiative {
  /** Where the AI wanted the event. */
  desiredEvent: Date | string;
  /** Preparation window in days, from `requiredRunwayDays(init.tasks)`. */
  runwayDays: number;
  /**
   * Whether this initiative occupies an exclusive slot. Evergreen work is
   * continuous rather than a launch, so it does not block anything and is not
   * blocked - only dated launches are sequenced against each other.
   */
  exclusive?: boolean;
}

export interface ScheduledInitiative {
  /** Final event date: distinct, in the future, with its runway intact. */
  eventDate: Date;
  /** When preparation starts: eventDate minus the runway, never before today. */
  activationDate: Date;
  /** True when the requested date had to move. */
  adjusted: boolean;
}

/**
 * Assign each initiative a launch date such that:
 *
 *   1. no two exclusive initiatives share an event date,
 *   2. an initiative's preparation window does not start before the previous
 *      launch, so the team is only ever preparing one launch at a time,
 *   3. every event leaves room for its own longest task lead, and
 *   4. nothing is dated in the past.
 *
 * Order of intent is preserved: initiatives are sequenced by the date the AI
 * asked for, so the plan's shape survives even when individual dates shift.
 */
export function sequenceEventDates(
  items: readonly SchedulableInitiative[],
  options: { now?: Date } = {}
): ScheduledInitiative[] {
  const now = options.now ?? new Date();
  const floor = todayDateOnly(now);

  // Sequence in the order the AI intended, but write results back in the
  // caller's original order so indexes still line up with the initiative array.
  const order = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const d = parseDateOnly(a.item.desiredEvent).getTime() - parseDateOnly(b.item.desiredEvent).getTime();
      return d !== 0 ? d : a.index - b.index;
    });

  const out: ScheduledInitiative[] = new Array(items.length);
  /** Event date of the last exclusive initiative placed, or null. */
  let lastLaunch: Date | null = null;

  for (const { item, index } of order) {
    const runway = Math.max(0, Math.trunc(item.runwayDays || 0));
    const desired = parseDateOnly(item.desiredEvent);
    const exclusive = item.exclusive !== false;

    // Its own runway has to fit after today.
    let event = clampNotBefore(desired, addDays(floor, runway));

    if (exclusive && lastLaunch) {
      // Preparation must not begin before the previous launch, and two launches
      // must not fall on the same day. `lastLaunch + 1 + runway` satisfies both:
      // prep starts the day after the previous event at the earliest.
      event = clampNotBefore(event, addDays(lastLaunch, runway + 1));
    }

    const activation = clampNotBefore(subDays(event, runway), floor);

    out[index] = {
      eventDate: event,
      activationDate: activation,
      adjusted: toDateOnly(event) !== toDateOnly(desired),
    };

    if (exclusive) lastLaunch = event;
  }

  return out;
}
