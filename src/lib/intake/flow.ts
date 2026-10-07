/**
 * Intake path and progress.
 *
 * ONE declarative sequence per path; progress, navigation and the output
 * variant all derive from it. The alternative — a screen list plus separate
 * "is this screen visible" checks plus a hardcoded total — is how a Path C user
 * ends up reading "Step 6 of 10" on a 9-screen flow.
 *
 * Path C genuinely OMITS screen 5. It is not hidden or skipped at runtime: it
 * is absent from the array, so there is nothing to accidentally navigate into
 * and nothing to subtract from the total.
 *
 * Pure and framework-free so the traversal can be tested exhaustively.
 */

/** Screen 0's answer. Drives screen 5, screen 6 filtering, the button and the output. */
export type PlanPath = "know_most" | "know_some" | "recommend_all";

/**
 * Screen identifiers. SLUGS, not indexes — an index means a different screen on
 * different paths, so a stored position would resume a user somewhere they had
 * never been if they changed their screen-0 answer.
 */
export type ScreenId =
  | "start"
  | "business"
  | "team"
  | "products"
  | "goal"
  | "initiatives"
  | "wins"
  | "customer"
  | "audience"
  | "obstacles";

/** Everything after the revenue goal, shared by all three paths. */
const AFTER_GOAL: readonly ScreenId[] = ["wins", "customer", "audience", "obstacles"];

/** Everything up to and including the revenue goal, shared by all three paths. */
const UP_TO_GOAL: readonly ScreenId[] = ["start", "business", "team", "products", "goal"];

/**
 * The screens this path actually has.
 *
 * A null path (screen 0 not yet answered) returns the longest sequence so the
 * progress bar does not jump once the user chooses. It settles to 9 for Path C
 * the moment they pick, which is honest: before answering, we do not know.
 */
export function screensFor(path: PlanPath | null): ScreenId[] {
  if (path === "recommend_all") {
    return [...UP_TO_GOAL, ...AFTER_GOAL];
  }
  return [...UP_TO_GOAL, "initiatives", ...AFTER_GOAL];
}

/** Does this path include the planned-initiatives screen? */
export function hasInitiativesScreen(path: PlanPath | null): boolean {
  return path !== "recommend_all";
}

export interface Progress {
  /** 1-based position within this path. */
  step: number;
  /** Total screens on this path: 9 for Path C, 10 otherwise. */
  total: number;
  /** 0-100, for the bar. */
  percent: number;
}

/**
 * Where the user is within THEIR path.
 *
 * An unknown screen reports step 0 rather than throwing: a stale URL should
 * show an empty bar, not break the page.
 */
export function progressFor(path: PlanPath | null, screen: ScreenId): Progress {
  const screens = screensFor(path);
  const index = screens.indexOf(screen);
  const total = screens.length;

  if (index === -1) {
    return { step: 0, total, percent: 0 };
  }

  const step = index + 1;
  return { step, total, percent: Math.round((step / total) * 100) };
}

/** The next screen, or null at the end of the path. */
export function nextScreen(path: PlanPath | null, screen: ScreenId): ScreenId | null {
  const screens = screensFor(path);
  const index = screens.indexOf(screen);
  if (index === -1 || index === screens.length - 1) return null;
  return screens[index + 1];
}

/** The previous screen, or null at the start. */
export function prevScreen(path: PlanPath | null, screen: ScreenId): ScreenId | null {
  const screens = screensFor(path);
  const index = screens.indexOf(screen);
  if (index <= 0) return null;
  return screens[index - 1];
}

/** Is this the last screen before the recommendations output? */
export function isFinalScreen(path: PlanPath | null, screen: ScreenId): boolean {
  const screens = screensFor(path);
  return screens[screens.length - 1] === screen;
}

/**
 * Label for the primary button on the final screen.
 *
 * A lookup rather than a conditional in JSX: the three labels are product copy
 * from the spec, and burying them in a ternary makes them easy to lose.
 */
export function finalButtonLabel(path: PlanPath | null): string {
  switch (path) {
    case "know_most":
      return "Check my plan";
    case "know_some":
      return "Fill in my plan";
    case "recommend_all":
      return "Recommend my initiatives";
    default:
      // Screen 0 is unanswered, so no final screen is reachable yet.
      return "Continue";
  }
}

/**
 * Which variant of the recommendations screen to render.
 *
 * Named by what the user SEES rather than by path letter, so the component does
 * not have to know that "know_most" means "your own initiatives, plus
 * suggestions only if there is a gap".
 */
export type OutputVariant = "check_math" | "fill_gaps" | "full_recommendation";

export function outputVariantFor(path: PlanPath | null): OutputVariant {
  switch (path) {
    case "know_most":
      return "check_math";
    case "know_some":
      return "fill_gaps";
    default:
      return "full_recommendation";
  }
}

export function outputHeadline(variant: OutputVariant): string {
  switch (variant) {
    case "check_math":
      return "Here's what your plan adds up to";
    case "fill_gaps":
      return "Your initiatives, plus what we'd add";
    case "full_recommendation":
      return "Here's where we'd start";
  }
}

/**
 * Screens that do NOT show the "Rough numbers are fine" helper line.
 *
 * Screens 0, 5 and 9 per the spec: the first is a single choice with its own
 * explanation, and the other two are not about estimating figures.
 */
const NO_HELPER_LINE: ReadonlySet<ScreenId> = new Set(["start", "initiatives", "obstacles"]);

export function showsHelperLine(screen: ScreenId): boolean {
  return !NO_HELPER_LINE.has(screen);
}

export const HELPER_LINE = "Rough numbers are fine. You can change any of this later.";

/**
 * Validate a resume slug.
 *
 * An unknown or off-path slug falls back to the start rather than erroring: a
 * user who changed their screen-0 answer may have a stored screen their new
 * path does not contain, and stranding them is worse than restarting.
 */
export function resolveResumeScreen(
  path: PlanPath | null,
  stored: string | null | undefined
): ScreenId {
  if (!stored) return "start";
  const screens = screensFor(path);
  return (screens as string[]).includes(stored) ? (stored as ScreenId) : "start";
}
