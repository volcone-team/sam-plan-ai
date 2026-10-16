/**
 * SAM University — pure display helpers for the customer page
 * (src/components/help/sam-university.tsx). No React, no network.
 *
 * Everything here works on customer VIEWS, so it can only ever see a url the
 * server already decided this viewer may have.
 */
import { videoEmbedUrl } from "./access";
import type {
  UniversityCategoryView,
  UniversityResourceType,
  UniversityResourceView,
} from "@/types/university.types";

/** Settings → Subscription tab (`?tab=` is read by src/app/(app)/settings/page.tsx). */
export const UPGRADE_HREF = "/settings?tab=subscription";

/** "Available on Pro", "Available on Starter or Pro", "Available on A or B or C". */
export function unlockLabel(names: readonly string[]): string {
  const list = names.map((n) => n.trim()).filter((n) => n !== "");
  if (list.length === 0) return "Not included in your plan";
  return `Available on ${list.join(" or ")}`;
}

const TYPE_LABELS: Record<UniversityResourceType, string> = {
  video: "Video",
  article: "Article",
  pdf: "PDF",
  link: "Link",
};

export function resourceTypeLabel(type: UniversityResourceType): string {
  return TYPE_LABELS[type];
}

/** "8 min", "1 h", "1 h 15 min"; `null` when unknown or zero. */
export function formatDuration(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** Totals for the summary bar. */
export function summariseCatalogue(categories: readonly UniversityCategoryView[]): {
  total: number;
  unlocked: number;
  locked: number;
} {
  let total = 0;
  let locked = 0;
  for (const c of categories) {
    for (const r of c.resources) {
      total++;
      if (r.locked) locked++;
    }
  }
  return { total, unlocked: total - locked, locked };
}

/** "1 module", "3 modules". */
export function moduleCount(n: number): string {
  return `${n} ${n === 1 ? "module" : "modules"}`;
}

/**
 * What a card offers:
 *   locked       teaser; upgrade prompt, nothing to open
 *   coming_soon  badge; nothing to open
 *   watch        video with an embeddable player → modal
 *   open         anything else with a url → new tab
 *   none         published + unlocked but no url (should not happen; render inert)
 */
export type ResourceAction =
  | { kind: "locked" }
  | { kind: "coming_soon" }
  | { kind: "watch"; embedUrl: string }
  | { kind: "open"; url: string }
  | { kind: "none" };

export function resourceAction(view: UniversityResourceView): ResourceAction {
  if (view.locked) return { kind: "locked" };
  if (view.status === "coming_soon") return { kind: "coming_soon" };
  if (!view.url) return { kind: "none" };
  if (view.type === "video") {
    const embedUrl = videoEmbedUrl(view.url);
    if (embedUrl) return { kind: "watch", embedUrl };
  }
  return { kind: "open", url: view.url };
}
