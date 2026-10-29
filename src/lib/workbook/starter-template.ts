/**
 * The generic starter task template.
 *
 * LAST RESORT, NOT A DEFAULT. Workbook templates win, then AI-written tasks
 * (see tasks-for-initiatives.ts); this is what an initiative gets when the
 * workbook has no template for its library key AND the AI call failed, timed
 * out, or returned nothing usable.
 *
 * It exists because the alternative is what shipped: an initiative saved with
 * ZERO tasks. "Past-Buyer Reactivation Campaign" and "Event Sponsorship &
 * Exhibitor Sales" landed on customers' plans looking scheduled with no
 * project plan behind them, because `tasks: templates.length > 0 ? ... : []`
 * had no third branch. Six honest generic steps beat an empty list.
 *
 * Shaped as `TaskTemplate[]` rather than finished tasks on purpose: it then
 * flows through `materialiseTasks` exactly like an authored workbook template,
 * so lead times, the today floor, dependency ids and derived priority all
 * behave identically. The only difference is where the list came from.
 *
 * Pure: a name in, templates out. No database, no clock.
 */

import type { TaskTemplate } from "@/lib/workbook/materialise";

/** One generic step, before the initiative's name is folded in. */
interface StarterStep {
  /** `{name}` is replaced with the initiative's name. */
  name: string;
  leadDays: number;
  durationHours: number;
  role: string;
  category: string;
  notes: string;
}

/**
 * Six steps, counted back from the event.
 *
 * The lead days describe a ~30 day runway: decide, prepare, build, promote,
 * run, follow up. 30 days is deliberately modest — it is long enough for the
 * sequencing in intake build to leave real room between launches, and short
 * enough that it does not push a plan's first event months out.
 *
 * The last two steps both sit at lead 0 (the event day). Lead times are a
 * COUNT OF DAYS BEFORE the event and `computeTaskDueDate` subtracts the
 * magnitude, so "three days AFTER the event" is not expressible here; the
 * follow-up is dated on the event day and ordered last instead of being
 * silently scheduled a month early.
 */
const STEPS: readonly StarterStep[] = [
  {
    name: "Plan {name} and set the goal",
    leadDays: 30,
    durationHours: 2,
    role: "Owner",
    category: "Plan",
    notes:
      "Decide what this initiative is meant to achieve: the revenue or lead " +
      "target, who it is aimed at, and the single action you want people to take.",
  },
  {
    name: "Prepare the offer for {name}",
    leadDays: 24,
    durationHours: 3,
    role: "Owner",
    category: "Offer",
    notes:
      "Settle what is being sold, at what price, and the words you will use " +
      "for it. Nothing else can be built until this is fixed.",
  },
  {
    name: "Build the assets for {name}",
    leadDays: 17,
    durationHours: 5,
    role: "Marketing",
    category: "Build",
    notes:
      "Create everything the initiative needs to run: page, emails, booking " +
      "or checkout link, scripts, and anything to hand over to a partner.",
  },
  {
    name: "Promote {name}",
    leadDays: 10,
    durationHours: 4,
    role: "Marketing",
    category: "Promote",
    notes:
      "Invite the audience and keep inviting them. Plan the sequence of " +
      "touches rather than a single announcement.",
  },
  {
    name: "Run {name}",
    leadDays: 0,
    durationHours: 3,
    role: "Owner",
    category: "Run",
    notes: "Deliver the initiative itself, and make the ask.",
  },
  {
    name: "Follow up and record results",
    leadDays: 0,
    durationHours: 2,
    role: "Owner",
    category: "Follow-up",
    notes:
      "Follow up with everyone who engaged, then record what actually " +
      "happened against the goal so the next occurrence starts from real numbers.",
  },
];

/** The preparation window the starter template needs: its longest lead time. */
export const STARTER_RUNWAY_DAYS = STEPS.reduce((max, s) => Math.max(max, s.leadDays), 0);

/** How many steps the starter template always produces. */
export const STARTER_TASK_COUNT = STEPS.length;

/**
 * The starter template for one initiative.
 *
 * `name` only tailors the task names ("Promote Past-Buyer Reactivation
 * Campaign"); the steps themselves are the same for every initiative, which is
 * the honest thing to do when we have no authored knowledge about it. A blank
 * or absent name falls back to "this initiative" rather than producing
 * "Promote ".
 *
 * Each step depends on the one before it, so the chain is visible on the plan
 * and `materialiseTasks` marks the blocking steps high priority.
 */
export function starterTemplate(initiativeName?: string | null): TaskTemplate[] {
  const name = String(initiativeName ?? "").trim() || "this initiative";

  return STEPS.map((step, i) => ({
    taskNumber: i + 1,
    name: step.name.replace("{name}", name),
    category: step.category,
    leadDays: step.leadDays,
    durationHours: step.durationHours,
    role: step.role,
    // Strictly sequential: step 1 blocks 2, 2 blocks 3, and so on.
    dependsOn: i === 0 ? [] : [i],
    notes: step.notes,
    displayOrder: i,
  }));
}
