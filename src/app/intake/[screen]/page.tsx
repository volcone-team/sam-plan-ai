import { notFound } from "next/navigation";
import { screensFor, type ScreenId } from "@/lib/intake/flow";
import { IntakePage } from "./intake-page";

/**
 * `/intake/[screen]` — one route per intake screen.
 *
 * Deliberately OUTSIDE the `(app)` route group: that layout wraps pages in the
 * sidebar, header and mobile nav, and a user part-way through the intake has no
 * plan to navigate to yet. Offering them the chrome invites them to leave
 * through a half-finished form, so the intake owns the full viewport like
 * `/onboarding` does.
 *
 * `params` is a promise in this version of Next, hence the await.
 */

/**
 * Validated against the LONGEST path, so every slug that exists anywhere is
 * routable. Whether a given screen belongs on the user's own path is a separate
 * question, answered by `flow.ts` — a Path C user who types /intake/initiatives
 * gets a real screen rather than a 404, and the resume logic moves them on.
 */
const VALID_SCREENS = new Set<string>(screensFor("know_most"));

export default async function Page({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  const { screen } = await params;

  if (!VALID_SCREENS.has(screen)) notFound();

  return <IntakePage screen={screen as ScreenId} />;
}

/** Pre-renders the ten screen shells; the answers load client-side. */
export function generateStaticParams() {
  return screensFor("know_most").map((screen) => ({ screen }));
}
