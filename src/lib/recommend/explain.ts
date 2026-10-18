/**
 * Explanations for a SCORE-ranked shortlist — "the AI explains; it does not
 * choose the order".
 *
 * Claude is sent the ranked shortlist (scores, metrics, AI Context) and asked
 * for a per-initiative explanation. Its answer is VALIDATED here, never
 * trusted:
 *
 *   - the result is keyed by OUR shortlist, in OUR order; the model's order
 *     is irrelevant, so it cannot reorder anything;
 *   - keys the model invents or repeats are ignored;
 *   - a shortlisted key it omits, or a field it leaves blank, is filled from
 *     the template built from the scores and AI Context.
 *
 * The same template is the whole answer when the AI is unavailable, so the
 * screen always has an explanation and the order never depends on the AI.
 *
 * Pure: no I/O.
 */

import type { LibraryInitiative } from "@/lib/intake/library";
import type { ContextEntry } from "@/lib/workbook/read";
import { parseMetricsCell, type ParsedMetrics } from "@/lib/metrics/parse-metrics";
import type { InitiativeScore, ScoreLetter, ScoredInitiative } from "@/lib/recommend/score";

export interface RecommendationExplanation {
  /** Why this suits the business. */
  whyFits: string;
  /** What to measure. Metric labels where the workbook names them. */
  whatToTrack: string[];
  /** The main pitfall, or null when none is authored. */
  watchOutFor: string | null;
  /** Yes/no questions on what they need in place, from AI Context. */
  readinessQuestions: string[];
  /** Where `whyFits` came from. */
  source: "ai" | "template";
}

export const MAX_TRACK_ITEMS = 4;
export const MAX_READINESS_QUESTIONS = 2;
const MAX_WHY_CHARS = 400;
const MAX_ITEM_CHARS = 160;

/* ------------------------------------------------------------------ *
 * Metrics
 * ------------------------------------------------------------------ */

/**
 * The ENTERED metric labels for an initiative: stored metrics (migration 040)
 * first, else a parse of the raw Metrics cell. De-duplicated, in workbook order.
 */
export function metricLabelsFor(
  initiative: Pick<LibraryInitiative, "metrics" | "metricsRaw">
): string[] {
  const parsed: ParsedMetrics | null =
    initiative.metrics && initiative.metrics.groups.length > 0
      ? initiative.metrics
      : initiative.metricsRaw
        ? parseMetricsCell(initiative.metricsRaw)
        : null;
  if (!parsed) return [];
  const labels: string[] = [];
  for (const group of parsed.groups) {
    for (const metric of group.metrics) {
      if (metric.source === "entered" && !labels.includes(metric.label)) labels.push(metric.label);
    }
  }
  return labels;
}

/* ------------------------------------------------------------------ *
 * Template
 * ------------------------------------------------------------------ */

const STRENGTH: Record<ScoreLetter, string> = {
  S: "produces revenue quickly",
  C: "is inexpensive to run",
  O: "has strong odds of working",
  R: "has high revenue potential",
  E: "is easy to run",
};

const LETTER_ORDER: readonly ScoreLetter[] = ["S", "C", "O", "R", "E"];

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function firstSentence(text: string | null | undefined, max = 200): string | null {
  const t = clean(text);
  if (!t) return null;
  const match = t.match(/^(.+?[.!?])(\s|$)/);
  const sentence = match ? match[1] : t;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** "A proven talk." -> "Do you have a proven talk?" */
function toQuestion(asset: string): string | null {
  const t = clean(asset).replace(/^[-•*–·]+\s*/, "").replace(/[.;:,]+$/, "");
  if (!t) return null;
  if (t.endsWith("?")) return t;
  // Lower-case a leading capital, but not an acronym ("CRM", "A/B" stay).
  const lowered = /^[A-Z](?![A-Z/])/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
  return `Do you have ${lowered}?`.slice(0, MAX_ITEM_CHARS);
}

/** Readiness questions from the AI Context "minimum assets". */
export function readinessFromContext(context: ContextEntry | null | undefined): string[] {
  const assets = (context?.minAssets ?? "")
    .split(/\r\n|\r|\n|;|•/)
    .map((s) => s.trim())
    .filter(Boolean);
  return assets
    .map(toQuestion)
    .filter((q): q is string => q !== null)
    .slice(0, MAX_READINESS_QUESTIONS);
}

/** The explanation built from scores and AI Context alone. */
export function templateExplanation(
  initiative: Pick<LibraryInitiative, "metrics" | "metricsRaw">,
  score: InitiativeScore,
  context: ContextEntry | null | undefined
): RecommendationExplanation {
  const strengths = LETTER_ORDER
    .filter((l) => !score.missing.includes(l) && score.breakdown[l] >= 4)
    .sort((a, b) => score.breakdown[b] - score.breakdown[a] || LETTER_ORDER.indexOf(a) - LETTER_ORDER.indexOf(b))
    .slice(0, 2)
    .map((l) => STRENGTH[l]);

  const headline =
    `Scores ${score.total} of ${score.max}` +
    (score.weightedMax !== score.max ? ` (${score.weightedTotal} of ${score.weightedMax} with Revenue weighted)` : "") +
    (strengths.length > 0 ? `: it ${strengths.join(" and ")}.` : ", a balanced option across speed, cost, odds, revenue and ease.");

  const when = firstSentence(context?.whenToUse, 180);
  const provisional = score.complete ? null : "Not every score is filled in yet, so treat its position as provisional.";

  return {
    whyFits: [headline, when ? `Best when: ${when}` : null, provisional].filter(Boolean).join(" "),
    whatToTrack: metricLabelsFor(initiative).slice(0, MAX_TRACK_ITEMS),
    watchOutFor: firstSentence(context?.whatToAvoid),
    readinessQuestions: readinessFromContext(context),
    source: "template",
  };
}

/* ------------------------------------------------------------------ *
 * Prompt
 * ------------------------------------------------------------------ */

function scoreLine(score: InitiativeScore): string {
  const parts = LETTER_ORDER.map((l) => (score.missing.includes(l) ? `${l}?` : `${l}${score.breakdown[l]}`));
  const weighted = score.weightedMax !== score.max ? `, weighted ${score.weightedTotal}/${score.weightedMax}` : "";
  const gaps = score.complete ? "" : ` (unscored: ${score.missing.join(", ")})`;
  return `SCORE ${score.total}/${score.max}${weighted} [${parts.join(" ")}]${gaps}`;
}

/** The shortlist as the model sees it: rank, key, scores, metrics, AI Context. */
export function renderShortlistForPrompt(
  shortlist: readonly ScoredInitiative<LibraryInitiative>[],
  contextByKey: ReadonlyMap<string, ContextEntry>
): string {
  return shortlist
    .map(({ initiative, score, rank }) => {
      const c = contextByKey.get(initiative.key);
      const metrics = metricLabelsFor(initiative);
      const head = [
        `#${rank}`,
        `key=${initiative.key}`,
        initiative.name,
        scoreLine(score),
        initiative.category ? `category ${initiative.category}` : null,
        initiative.ownOrOps ? `type ${initiative.ownOrOps}` : null,
        clean(initiative.oneLiner) || null,
      ].filter(Boolean);
      const detail = [
        metrics.length > 0 ? `METRICS: ${metrics.join(", ")}` : null,
        c?.whenToUse ? `WHEN: ${clean(c.whenToUse).slice(0, 240)}` : null,
        c?.minAssets ? `NEEDS: ${clean(c.minAssets).slice(0, 200)}` : null,
        c?.whatToAvoid ? `AVOID: ${clean(c.whatToAvoid).slice(0, 200)}` : null,
        c?.whyItWorks ? `WHY IT WORKS: ${clean(c.whyItWorks).slice(0, 200)}` : null,
      ].filter(Boolean);
      return [`- ${head.join(" | ")}`, ...detail.map((d) => `    ${d}`)].join("\n");
    })
    .join("\n");
}

/* ------------------------------------------------------------------ *
 * Parsing and validation
 * ------------------------------------------------------------------ */

export interface ParsedExplanation {
  key: string;
  whyFits: string | null;
  whatToTrack: string[];
  watchOutFor: string | null;
  readinessQuestions: string[];
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = clean(value);
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function texts(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    const t = text(v, MAX_ITEM_CHARS);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

function toParsed(raw: unknown): ParsedExplanation[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { explanations?: unknown }).explanations)
      ? (raw as { explanations: unknown[] }).explanations
      : [];
  const out: ParsedExplanation[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    if (typeof e.key !== "string" || e.key.trim() === "") continue;
    out.push({
      key: e.key.trim(),
      whyFits: text(e.whyFits ?? e.why, MAX_WHY_CHARS),
      whatToTrack: texts(e.whatToTrack, MAX_TRACK_ITEMS),
      watchOutFor: text(e.watchOutFor, MAX_ITEM_CHARS * 2),
      readinessQuestions: texts(e.readinessQuestions, MAX_READINESS_QUESTIONS),
    });
  }
  return out;
}

/** Parse the model's JSON, tolerating a code fence or surrounding prose. Never throws. */
export function parseExplanations(raw: string): ParsedExplanation[] {
  const attempt = (s: string): ParsedExplanation[] | null => {
    try {
      return toParsed(JSON.parse(s));
    } catch {
      return null;
    }
  };
  const direct = attempt(raw);
  if (direct) return direct;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const r = attempt(fenced[1]);
    if (r) return r;
  }
  const object = raw.match(/\{[\s\S]*\}/);
  if (object) {
    const r = attempt(object[0]);
    if (r) return r;
  }
  const array = raw.match(/\[[\s\S]*\]/);
  if (array) {
    const r = attempt(array[0]);
    if (r) return r;
  }
  return [];
}

export interface MergedExplanations {
  /** One per shortlisted key, in shortlist order. */
  byKey: Map<string, RecommendationExplanation>;
  /** Keys the model returned that are not on the shortlist (dropped). */
  ignored: string[];
  /** Shortlisted keys the model gave no usable explanation for (templated). */
  filled: string[];
}

/**
 * The model's explanations, validated against the shortlist.
 *
 * `shortlistKeys` decides both the set and the order of the result. A key the
 * model repeats keeps its first entry. Each blank field falls back to the
 * template's, so a partial answer still yields a complete explanation.
 */
export function mergeExplanations(
  shortlistKeys: readonly string[],
  parsed: readonly ParsedExplanation[],
  template: (key: string) => RecommendationExplanation
): MergedExplanations {
  const allowed = new Set(shortlistKeys);
  const fromAi = new Map<string, ParsedExplanation>();
  const ignored: string[] = [];
  for (const entry of parsed) {
    if (!allowed.has(entry.key)) {
      if (!ignored.includes(entry.key)) ignored.push(entry.key);
      continue;
    }
    if (!fromAi.has(entry.key)) fromAi.set(entry.key, entry);
  }

  const byKey = new Map<string, RecommendationExplanation>();
  const filled: string[] = [];
  for (const key of shortlistKeys) {
    const fallback = template(key);
    const ai = fromAi.get(key);
    if (!ai || !ai.whyFits) {
      filled.push(key);
      byKey.set(key, fallback);
      continue;
    }
    byKey.set(key, {
      whyFits: ai.whyFits,
      whatToTrack: ai.whatToTrack.length > 0 ? ai.whatToTrack : fallback.whatToTrack,
      watchOutFor: ai.watchOutFor ?? fallback.watchOutFor,
      readinessQuestions: ai.readinessQuestions.length > 0 ? ai.readinessQuestions : fallback.readinessQuestions,
      source: "ai",
    });
  }
  return { byKey, ignored, filled };
}
