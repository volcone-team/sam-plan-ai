"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format-money";
import { goalGap, type GoalGap } from "@/lib/intake-forecast";
import { MAX_RECOMMENDED_INITIATIVES } from "@/lib/recommend/sizing";
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
  yours: {
    /** `intake_initiatives` row id — the stable handle for deselecting one. */
    id: string;
    key: string;
    name: string;
    forecast: number | null;
    productIds: string[];
  }[];
  recommended: ApiRecommendation[];
  alternatives: ApiRecommendation[];
  planLimit: number | null;
  /** The most initiatives this plan may hold in total, counting the user's own. */
  capacity: number;
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

  const [accepted, setAccepted] = React.useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());
  /**
   * The user's OWN initiatives they have switched off, by row id.
   *
   * Stored as the dropped set rather than the kept set so the default — keep
   * everything they entered — needs no initialisation from the response, and
   * so an id that arrives late cannot start out deselected.
   *
   * By id, not key or index: two of a user's initiatives can share a library
   * key (two webinars for different products), and indices shift if the draft
   * is re-read in another order.
   */
  const [droppedOwn, setDroppedOwn] = React.useState<Set<string>>(new Set());
  /**
   * Shown when a click was refused because the plan is already full.
   *
   * Set by the toggles rather than derived from `atCapacity`: being at the cap
   * is a normal resting state that needs no warning, whereas being refused is
   * an event. Rendering it off `atCapacity` would nag everyone who legitimately
   * selected five and was perfectly happy.
   *
   * Cleared by the next successful change, so it cannot outlive the condition
   * it describes.
   */
  const [capacityNotice, setCapacityNotice] = React.useState<string | null>(null);
  /**
   * One CAROUSEL per card slot, and where each slot currently sits.
   *
   * WHY RINGS RATHER THAN A ONE-WAY LIST. Swap used to consume from a shared
   * pool of alternatives and mark each as seen, so it ran out after one or two
   * clicks and — worse — the card you started from was gone for good. A user
   * shown Dinners, who swapped to see what else there was, could not get back
   * to Dinners. That makes the button a gamble rather than a browse.
   *
   * Each slot now owns a ring: its original recommendation first, then the
   * alternatives dealt to it. Swapping advances the position and WRAPS, so the
   * original always comes back round and the number of swaps is unlimited.
   *
   * Alternatives are dealt ROUND-ROBIN across slots rather than shared, so two
   * slots can never show the same initiative — which a shared pool with
   * independent positions would eventually do.
   */
  const [slotRings, setSlotRings] = React.useState<ApiRecommendation[][]>([]);
  const [slotPositions, setSlotPositions] = React.useState<number[]>([]);
  /**
   * Keys already counted for the REQ-14.1 "shown" event.
   *
   * A ref, not state: it must not cause a re-render, and cycling back to a
   * card the user has already seen should not log a second impression.
   */
  const shownOnce = React.useRef<Set<string>>(new Set());

  /**
   * The visible shortlist: whatever each slot's ring currently points at.
   *
   * DERIVED, not stored. It used to be its own state that swaps mutated, which
   * meant the displayed list and the swap history were two sources of truth
   * that could disagree. Computing it from the rings makes that impossible.
   *
   * Declared after the rings deliberately — a useMemo reads its dependencies
   * immediately, so referencing them above their own declaration is a temporal
   * dead zone error at runtime rather than a compile error.
   */
  const shortlist = React.useMemo(
    () =>
      slotRings
        .map((ring, index) => ring[(slotPositions[index] ?? 0) % ring.length])
        .filter((entry): entry is ApiRecommendation => Boolean(entry)),
    [slotRings, slotPositions]
  );

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

        /**
         * Deal the alternatives round-robin into one ring per slot.
         *
         * Round-robin rather than in blocks so the best alternatives are
         * spread across the slots instead of all landing behind the first
         * card: `alternatives` is ranked, so chunking would give slot 1 the
         * three strongest and slot 3 the three weakest.
         */
        const rings: ApiRecommendation[][] = body.recommended.map((r) => [r]);
        if (rings.length > 0) {
          body.alternatives.forEach((alternative, index) => {
            rings[index % rings.length].push(alternative);
          });
        }

        setSlotRings(rings);
        setSlotPositions(rings.map(() => 0));

        // REQ-14.1 — one event per card shown, with where it came from.
        const source = sourceFor(body.aiUnavailable);
        for (const recommendation of body.recommended) {
          shownOnce.current.add(recommendation.key);
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
      // Only the ones they are keeping contribute — a deselected initiative is
      // not in the plan, so counting its revenue would overstate the forecast.
      yours: data.yours.filter((y) => !droppedOwn.has(y.id)).map((y) => y.forecast),
      recommended: shortlist
        .filter((r) => accepted.has(r.key) && !dismissed.has(r.key))
        .map((r) => r.forecast),
    });
  }, [data, shortlist, accepted, dismissed, droppedOwn]);

  const acceptedCount = shortlist.filter(
    (r) => accepted.has(r.key) && !dismissed.has(r.key)
  ).length;
  const keptOwnCount = (data?.yours.length ?? 0) - droppedOwn.size;
  const totalInitiatives = keptOwnCount + acceptedCount;

  /**
   * The selection cap: the tightest of the stage/plan capacity the server sent
   * and the hard ceiling.
   *
   * Falls back to the ceiling rather than to "unlimited" if the field is
   * missing — a cached bundle meeting an older response must not be able to
   * build a nine-initiative plan.
   */
  const capacity = Math.min(data?.capacity ?? MAX_RECOMMENDED_INITIATIVES, MAX_RECOMMENDED_INITIATIVES);
  const atCapacity = totalInitiatives >= capacity;

  /**
   * MORE than the cap, not merely at it.
   *
   * Distinct from `atCapacity`, which means full and blocks further additions.
   * This means the cap is already exceeded, and the only way in is the user's
   * OWN initiatives: `toggleAccept` and `toggleOwn` both refuse to grow the
   * selection past capacity, so nothing we offer can cause it. Someone who
   * described six things they are already running arrives here at six.
   *
   * WITHOUT THIS the Build button stayed enabled and the server answered 422
   * — "A plan can hold at most 5 initiatives, and this one has 6" — after the
   * click. The cap was real but enforced in the wrong place, which is the
   * failure mode the screen's own checks exist to avoid.
   *
   * NOT folded into `overLimit`: that one names the customer's PLAN
   * ("your plan allows 10"), while this is the product's five-initiative rule.
   * One message cannot say both truthfully, and at current settings only this
   * one can actually fire — Starter allows 10 and Pro and Mastery are
   * unlimited.
   */
  const overCapacity = totalInitiatives > capacity;

  // REQ-13.15 — kept as a separate signal because the plan limit has its own
  // wording, naming the plan rather than the five-initiative rule.
  const overLimit =
    data?.planLimit !== null &&
    data?.planLimit !== undefined &&
    totalInitiatives > data.planLimit;

  const toggleAccept = (key: string) => {
    /**
     * Nothing may be added once the plan is full — but SAY SO.
     *
     * This used to `return` silently. From the user's side a click on "Add to
     * plan" simply did nothing, which reads as a broken button rather than as
     * a rule, and the only hint was a counter further up the page that they
     * had no reason to be looking at.
     */
    if (!accepted.has(key) && atCapacity) {
      setCapacityNotice(
        `A plan holds up to ${capacity} initiatives, and you already have ` +
        `${capacity} selected. Deselect one to make room for this.`
      );
      return;
    }

    // Any successful change makes the warning stale.
    setCapacityNotice(null);

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

  /**
   * Keep or drop one of the user's OWN initiatives.
   *
   * Turning one back on is blocked at capacity for the same reason as
   * accepting a recommendation: the cap is on the total, so something has to
   * come out first.
   */
  const toggleOwn = (id: string) => {
    const dropping = !droppedOwn.has(id);

    // Re-selecting one of their own is blocked at capacity for the same reason
    // as accepting a recommendation, and gets the same explanation.
    if (!dropping && atCapacity) {
      setCapacityNotice(
        `A plan holds up to ${capacity} initiatives, and you already have ` +
        `${capacity} selected. Deselect one to put this back.`
      );
      return;
    }

    setCapacityNotice(null);

    setDroppedOwn((prev) => {
      const next = new Set(prev);
      if (dropping) next.add(id);
      else next.delete(id);
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
   * Show the next initiative in this slot's ring, wrapping at the end.
   *
   * The replacement takes the outgoing card's POSITION, because the list is
   * ranked and appending would reorder the screen under the user mid-decision.
   * Every entry in the ring came from the server's eligible, already-filtered
   * set, so each is a valid substitution.
   *
   * WRAPPING IS THE POINT. Reaching the end of the ring returns to the
   * original recommendation rather than disabling the button, which is what
   * makes a swap reversible: keep clicking and Dinners comes back.
   */
  const swapSlot = (slotIndex: number) => {
    if (!data) return;

    const ring = slotRings[slotIndex];
    if (!ring || ring.length < 2) return;

    const current = ring[slotPositions[slotIndex] % ring.length];
    const nextPosition = (slotPositions[slotIndex] + 1) % ring.length;
    const incoming = ring[nextPosition];

    void trackIntakeEvent(recommendationDismissed(current.key, "swap", path));

    setSlotPositions((prev) => {
      const next = [...prev];
      next[slotIndex] = nextPosition;
      return next;
    });

    /**
     * The outgoing card loses its acceptance.
     *
     * Selection follows what is on screen: leaving a swapped-away initiative
     * in the accepted set would build a plan containing something the user can
     * no longer see. Cycling back to it shows it unaccepted, ready to add
     * again.
     */
    setAccepted((prev) => {
      const next = new Set(prev);
      next.delete(current.key);
      return next;
    });

    // Only the first sighting is an impression; coming back round is not.
    if (!shownOnce.current.has(incoming.key)) {
      shownOnce.current.add(incoming.key);
      void trackIntakeEvent(
        recommendationShown(incoming.key, sourceFor(data.aiUnavailable), path)
      );
    }
  };

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
        // The dropped set travels too: the build reads the user's own
        // initiatives straight from the draft, so without it a deselected one
        // would silently reappear in the plan.
        body: JSON.stringify({ acceptedKeys, droppedOwnIds: [...droppedOwn] }),
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

      {/*
        THE SELECTION COUNTER.
        The screen is one pool of the user's own initiatives plus ours, and a
        plan holds at most `capacity`. Stating the count here — rather than only
        complaining once they exceed it — is what makes "deselect one of yours
        to take one of ours" discoverable instead of a dead end.
      */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-border bg-[hsl(var(--background-muted))] px-4 py-3">
        <p className="text-sm font-medium text-foreground">
          {totalInitiatives} of {capacity} selected
        </p>
        <p className="text-xs text-[hsl(var(--foreground-muted))]">
          {atCapacity
            ? "Your plan is full. Deselect one to swap in another."
            : `A plan runs best with up to ${capacity} initiatives.`}
        </p>
      </div>

      {/*
        THE REFUSED CLICK, explained.

        `role="status"` rather than `role="alert"`: this is the consequence of
        something the user just did, not an error in their plan, and an
        assertive live region would interrupt a screen reader mid-sentence.

        Placed under the counter so the message and the number it refers to are
        read together, and rendered only after a refusal — sitting at the cap is
        a perfectly good place to be and needs no warning.
      */}
      {capacityNotice && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--warning)_/_0.4)] bg-[hsl(var(--warning)_/_0.08)] px-3 py-2.5 text-sm text-foreground"
        >
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(var(--warning))]"
            aria-hidden="true"
          />
          <span>{capacityNotice}</span>
        </p>
      )}

      {data.yours.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground">
            What you&apos;re already planning
          </h2>
          <ul className="space-y-2">
            {data.yours.map((initiative, index) => {
              const kept = !droppedOwn.has(initiative.id);
              // Blocked only when turning one back ON would exceed the cap.
              const blocked = !kept && atCapacity;
              return (
                <li key={initiative.id || `${initiative.key}-${index}`}>
                  {/*
                    The user's own initiatives are now DESELECTABLE. They used
                    to be a fixed list, which made the cap unreachable for
                    anyone who had entered five of their own — they could see
                    our alternatives but never choose one.
                  */}
                  <label
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-md)] border px-4 py-3 transition-colors",
                      kept
                        ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)_/_0.06)]"
                        : "border-border opacity-60",
                      blocked && "cursor-not-allowed"
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={kept}
                        disabled={blocked}
                        onChange={() => toggleOwn(initiative.id)}
                        className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                      />
                      <span className="text-sm font-medium text-foreground">
                        {initiative.name}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-[hsl(var(--foreground-muted))]">
                      {initiative.forecast === null
                        ? // Null is not zero: an unforecast initiative has
                          // incomplete inputs, not no value.
                          "No forecast yet"
                        : formatMoney(initiative.forecast)}
                    </span>
                  </label>
                </li>
              );
            })}
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
            {shortlist.map((recommendation, slotIndex) => (
              <RecommendationCard
                key={recommendation.key}
                data={toCardData(recommendation)}
                badge={badge}
                accepted={accepted.has(recommendation.key)}
                dismissed={dismissed.has(recommendation.key)}
                /*
                  PER SLOT, not global. Swap used to share one pool across every
                  card, so exhausting it disabled the button everywhere at once.
                  A slot with more than one entry in its ring can always swap,
                  and because the ring wraps it can always get back to where it
                  started.
                */
                canSwap={(slotRings[slotIndex]?.length ?? 0) > 1}
                onAccept={() => toggleAccept(recommendation.key)}
                onDismiss={() => dismiss(recommendation.key)}
                onRestore={() => restore(recommendation.key)}
                onSwap={() => swapSlot(slotIndex)}
              />
            ))}
          </div>
        </section>
      )}

      {shortlist.length === 0 && data.yours.length > 0 && (
        <p className="rounded-[var(--radius-md)] border border-border px-4 py-3 text-sm text-[hsl(var(--foreground-muted))]">
          {/*
            No longer "your initiatives cover your goal" — a covered goal no
            longer suppresses recommendations, so an empty shortlist now means
            we genuinely had nothing eligible left to offer.
          */}
          You&apos;ve already planned everything we&apos;d suggest, so there&apos;s
          nothing to add.
        </p>
      )}

      {/*
        OVER FIVE. Only reachable by the user's own initiatives, so the message
        says which ones to deselect rather than implying we added too many.

        Shown instead of the plan-limit alert below when both would fire: two
        alerts about the same count, differing only in which number they quote,
        reads as a bug rather than as two rules.
      */}
      {overCapacity && (
        <p
          className="flex items-start gap-2 rounded-[var(--radius-md)] border border-[hsl(var(--invalid-border))] bg-[hsl(var(--invalid)_/_0.08)] px-3 py-2.5 text-sm text-[hsl(var(--destructive))]"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            A plan runs best with up to {capacity} initiatives, and you have{" "}
            {totalInitiatives} selected. Deselect{" "}
            {totalInitiatives - capacity} of your own to continue — you can
            swap one of ours in afterwards.
          </span>
        </p>
      )}

      {/* REQ-13.15 — names the limit and the number to deselect. */}
      {!overCapacity && overLimit && data.planLimit !== null && (
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
          /*
            Disabled while over EITHER cap. Both are enforced server-side by
            /api/intake/build regardless, so letting the click through would
            only trade a clear on-screen message for a 422 after a round trip.
          */
          disabled={building || overLimit || overCapacity}
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
