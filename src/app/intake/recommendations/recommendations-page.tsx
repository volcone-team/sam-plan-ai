"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";
import { formatMoney } from "@/lib/format-money";
import { goalGap, type GoalGap } from "@/lib/intake-forecast";
import { outputHeadline, outputVariantFor, type PlanPath } from "@/lib/intake/flow";
import {
  planBuilt,
  recommendationAccepted,
  recommendationDismissed,
  recommendationShown,
  trackIntakeEvent,
} from "@/lib/intake/events";
import { FormError } from "@/components/intake/fields/field";
import { GapBar } from "@/components/intake/recommendations/gap-bar";
import {
  RecommendationCard,
  type RecommendationCardData,
} from "@/components/intake/recommendations/initiative-recommendation-card";

/**
 * The recommendations screen (REQ-13.1 to REQ-13.16).
 *
 * THE SINGLE COMMIT POINT. Accept, dismiss and swap are all local until "Build
 * my plan" — which is what lets the old review screen be removed (D2). Two
 * confirmations back to back was one too many, and this screen already shows
 * more than the review page did.
 *
 * The gap recalculates live off `goalGap`, the same tested function the forecast
 * module uses everywhere else, rather than a running total maintained here.
 */

interface ApiRecommendation {
  key: string;
  name: string;
  oneLiner: string | null;
  category: string | null;
  difficulty: number | null;
  speedToResults: string | null;
  forecast: number;
  fromBenchmarks: boolean;
  why: string | null;
  productIds: string[];
}

interface RecommendResponse {
  gap: GoalGap;
  goal: number;
  horizonMonths: number;
  yours: { key: string; name: string; forecast: number | null; productIds: string[] }[];
  recommended: ApiRecommendation[];
  alternatives: ApiRecommendation[];
  planLimit: number | null;
  aiUnavailable: string | null;
  error?: string;
}

export function RecommendationsPage() {
  const router = useRouter();

  const [data, setData] = React.useState<RecommendResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [building, setBuilding] = React.useState(false);
  const [buildError, setBuildError] = React.useState<string | null>(null);
  const [path, setPath] = React.useState<PlanPath | null>(null);

  /** The visible shortlist. Swaps replace entries in place. */
  const [shortlist, setShortlist] = React.useState<ApiRecommendation[]>([]);
  const [accepted, setAccepted] = React.useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  /** Everything the user has seen, so a swap never repeats (D3). */
  const [seen, setSeen] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // The path comes from the draft rather than the recommend response, so
        // the headline and button are right even if recommendations are empty.
        const draftResponse = await fetch("/api/intake/draft", { cache: "no-store" });
        if (draftResponse.ok) {
          const draft = (await draftResponse.json()) as { path?: PlanPath | null };
          if (!cancelled) setPath(draft.path ?? null);
        }

        const response = await fetch("/api/intake/recommend", { method: "POST" });
        const body = (await response.json()) as RecommendResponse;

        if (!response.ok) {
          throw new Error(body.error || `Could not build your forecast (${response.status}).`);
        }

        if (cancelled) return;

        setData(body);
        setShortlist(body.recommended);
        setSeen(new Set(body.recommended.map((r) => r.key)));

        // REQ-14.1 — one event per card shown, with where it came from.
        const source = sourceFor(body.aiUnavailable);
        for (const recommendation of body.recommended) {
          void trackIntakeEvent(recommendationShown(recommendation.key, source, null));
        }
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The live gap.
   *
   * Recomputed from the accepted set on every render rather than tracked as a
   * number, so it cannot drift out of step with the cards — which is the bug
   * REQ-13.3 would otherwise invite.
   */
  const gap = React.useMemo<GoalGap | null>(() => {
    if (!data) return null;
    return goalGap({
      goal: data.goal,
      yours: data.yours.map((y) => y.forecast),
      recommended: shortlist
        .filter((r) => accepted.has(r.key) && !dismissed.has(r.key))
        .map((r) => r.forecast),
    });
  }, [data, shortlist, accepted, dismissed]);

  const acceptedCount = shortlist.filter(
    (r) => accepted.has(r.key) && !dismissed.has(r.key)
  ).length;
  const totalInitiatives = (data?.yours.length ?? 0) + acceptedCount;

  // REQ-13.15 — warn and block the button, not the selection itself.
  const overLimit =
    data?.planLimit !== null &&
    data?.planLimit !== undefined &&
    totalInitiatives > data.planLimit;

  const toggleAccept = (key: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        void trackIntakeEvent(recommendationAccepted(key, path));
      }
      return next;
    });
    // Accepting something previously dismissed restores it.
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const dismiss = (key: string) => {
    setDismissed((prev) => new Set(prev).add(key));
    setAccepted((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    void trackIntakeEvent(recommendationDismissed(key, "dismiss", path));
  };

  const restore = (key: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  /**
   * Swap auto-replaces with the next unseen alternative (D3).
   *
   * The replacement takes the outgoing card's POSITION, because the list is
   * ranked and appending would reorder the screen under the user mid-decision.
   * The server has already filtered `alternatives` through the eligibility
   * rules, so anything here is a valid substitution.
   */
  const swap = (key: string) => {
    if (!data) return;

    const replacement = data.alternatives.find((entry) => !seen.has(entry.key));
    if (!replacement) return;

    void trackIntakeEvent(recommendationDismissed(key, "swap", path));

    setShortlist((prev) =>
      prev.map((entry) => (entry.key === key ? replacement : entry))
    );
    setSeen((prev) => new Set(prev).add(replacement.key));
    setAccepted((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

    void trackIntakeEvent(
      recommendationShown(replacement.key, sourceFor(data.aiUnavailable), path)
    );
  };

  const swapAvailable = Boolean(
    data?.alternatives.some((entry) => !seen.has(entry.key))
  );

  const build = async () => {
    if (!data || !gap) return;

    setBuilding(true);
    setBuildError(null);

    try {
      const acceptedKeys = shortlist
        .filter((r) => accepted.has(r.key) && !dismissed.has(r.key))
        .map((r) => r.key);

      const response = await fetch("/api/intake/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptedKeys }),
      });

      const body = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(body.error || `Could not build your plan (${response.status}).`);
      }

      void trackIntakeEvent(planBuilt(path, totalInitiatives, gap.gap));
      router.push("/year-at-a-glance");
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  };

  if (loading) {
    return (
      <Frame>
        <div className="flex flex-col items-center gap-3 py-20">
          <Loader2
            className="h-6 w-6 animate-spin text-[hsl(var(--foreground-muted))]"
            aria-hidden="true"
          />
          <p className="text-sm text-[hsl(var(--foreground-muted))]">
            Working out what your plan adds up to…
          </p>
        </div>
      </Frame>
    );
  }

  if (loadError || !data || !gap) {
    return (
      <Frame>
        <FormError message={loadError ?? "Something went wrong."} />
        <Button variant="outline" onClick={() => router.push("/intake/obstacles")}>
          Back to the questionnaire
        </Button>
      </Frame>
    );
  }

  const variant = outputVariantFor(path);
  // Path A's additions are "Suggested"; B and C get "Recommended" (REQ-13.5).
  const badge = variant === "check_math" ? "Suggested" : "Recommended";

  return (
    <Frame>
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {outputHeadline(variant)}
        </h1>
        <p className="text-sm text-[hsl(var(--foreground-muted))]">
          Nothing is saved until you build your plan.
        </p>
      </div>

      <GapBar gap={gap} goal={data.goal} />

      {/*
        Stated plainly rather than hidden. The forecast is still usable — the
        eligible library is ranked by our own heuristic — but the user should
        know the figures are not AI-tailored.
      */}
      {data.aiUnavailable && (
        <p className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--warning)_/_0.4)] bg-[hsl(var(--warning)_/_0.08)] px-3 py-2.5 text-sm text-foreground">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]"
            aria-hidden="true"
          />
          <span>
            {data.aiUnavailable} These suggestions are ranked by speed and
            effort instead, and you can still build your plan.
          </span>
        </p>
      )}

      {data.yours.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            What you&apos;re already planning
          </h2>
          <ul className="space-y-2">
            {data.yours.map((initiative, index) => (
              <li
                key={`${initiative.key}-${index}`}
                className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border px-4 py-3"
              >
                <span className="text-sm font-medium text-foreground">
                  {initiative.name}
                </span>
                <span className="text-sm tabular-nums text-[hsl(var(--foreground-muted))]">
                  {initiative.forecast === null
                    ? // Null is not zero: an unforecast initiative has
                      // incomplete inputs, not no value.
                      "No forecast yet"
                    : formatMoney(initiative.forecast)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {shortlist.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Sparkles className="h-4 w-4 text-[hsl(var(--primary))]" aria-hidden="true" />
            {variant === "check_math" ? "To close the gap" : "What we'd add"}
          </h2>

          <div className="space-y-3">
            {shortlist.map((recommendation) => (
              <RecommendationCard
                key={recommendation.key}
                data={toCardData(recommendation)}
                badge={badge}
                accepted={accepted.has(recommendation.key)}
                dismissed={dismissed.has(recommendation.key)}
                canSwap={swapAvailable}
                onAccept={() => toggleAccept(recommendation.key)}
                onDismiss={() => dismiss(recommendation.key)}
                onRestore={() => restore(recommendation.key)}
                onSwap={() => swap(recommendation.key)}
              />
            ))}
          </div>
        </section>
      )}

      {shortlist.length === 0 && data.yours.length > 0 && (
        <p className="rounded-[var(--radius-md)] border border-border px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
          Your own initiatives cover your goal, so we have nothing to add.
        </p>
      )}

      {/* REQ-13.15 — names the limit and the number to deselect. */}
      {overLimit && data.planLimit !== null && (
        <p
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--invalid-border))] bg-[hsl(var(--invalid)_/_0.08)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Your plan allows {data.planLimit} initiatives and you have{" "}
            {totalInitiatives}. Remove {totalInitiatives - data.planLimit} to
            continue.
          </span>
        </p>
      )}

      <FormError message={buildError} />

      <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
        <Button
          variant="ghost"
          onClick={() => router.push("/intake/obstacles")}
          disabled={building}
        >
          Back
        </Button>

        <Button
          size="lg"
          onClick={build}
          // Disabled while over the limit: billing enforces the cap
          // server-side anyway, so letting them past would fail later with a
          // worse message.
          disabled={building || overLimit}
        >
          {building && <Loader2 className="h-4 w-4 animate-spin" />}
          Build my plan
        </Button>
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="shrink-0 border-b border-border">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-center px-4 sm:px-6">
          <BrandLogo />
        </div>
      </header>
      <main className="flex-1 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-6">{children}</div>
      </main>
    </div>
  );
}

function toCardData(recommendation: ApiRecommendation): RecommendationCardData {
  return {
    key: recommendation.key,
    name: recommendation.name,
    oneLiner: recommendation.oneLiner,
    difficulty: recommendation.difficulty,
    speedToResults: recommendation.speedToResults,
    forecast: recommendation.forecast,
    fromBenchmarks: recommendation.fromBenchmarks,
    why: recommendation.why,
    // Resolved server-side in a later pass; the card handles an empty list.
    productNames: [],
    startMonth: null,
  };
}

/**
 * Whether a shown card came from the model or from our fallback ranking.
 *
 * Recorded so the acceptance-rate report in REQ-14.4 can tell the two apart —
 * otherwise a period of AI downtime would look like the model suddenly getting
 * worse at recommending.
 */
function sourceFor(aiUnavailable: string | null): "recommended" | "suggested" {
  return aiUnavailable ? "suggested" : "recommended";
}
