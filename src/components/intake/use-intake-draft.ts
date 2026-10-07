"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanPath, ScreenId } from "@/lib/intake/flow";
import type { IntakeAnswers } from "@/lib/intake/validation";
import type { ProductDraft, InitiativeDraft } from "@/lib/intake/draft";

/**
 * The intake's single source of answers: load once, edit locally, save on
 * advance.
 *
 * WHY LOCAL STATE AND NOT SAVE-PER-KEYSTROKE. Every field would otherwise hit
 * the network, and the draft endpoint replaces the child rows on each write.
 * Typing a product name would mean a delete-and-insert per character. Saving on
 * screen advance matches what REQ-2.4 actually asks for — answers survive a
 * screen change — at one request per screen.
 *
 * The trade is that a crash mid-screen loses that screen. Accepted: the
 * alternative is a save storm, and the shell also saves when the tab is hidden,
 * which covers the common case of wandering off.
 */

export interface DraftState {
  answers: IntakeAnswers;
  products: ProductDraft[];
  initiatives: InitiativeDraft[];
}

export interface UseIntakeDraft {
  state: DraftState;
  /** True until the first load settles, so screens do not flash empty. */
  loading: boolean;
  /** Set when the draft could not be loaded, so the shell can say so. */
  loadError: string | null;
  saving: boolean;
  saveError: string | null;
  /** The screen the server says to resume at, or null when starting fresh. */
  resumeScreen: ScreenId | null;
  path: PlanPath | null;

  setAnswer: (field: string, value: unknown) => void;
  setAnswers: (patch: IntakeAnswers) => void;
  setProducts: (products: ProductDraft[]) => void;
  setInitiatives: (initiatives: InitiativeDraft[]) => void;
  /** Persist the current state. Resolves true on success. */
  save: (resumeScreen: ScreenId) => Promise<boolean>;
}

const EMPTY: DraftState = { answers: {}, products: [], initiatives: [] };

export function useIntakeDraft(): UseIntakeDraft {
  const [state, setState] = useState<DraftState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resumeScreen, setResumeScreen] = useState<ScreenId | null>(null);

  /**
   * The state a save reads from.
   *
   * A ref alongside the state because `save` is called from event handlers and
   * from the visibility listener, and a closure over `state` would capture
   * whatever it was when the handler was created — saving stale answers.
   */
  const stateRef = useRef<DraftState>(EMPTY);
  stateRef.current = state;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/intake/draft", { cache: "no-store" });

        if (!response.ok) {
          // 409 means the profile has no company yet. Treated as "nothing
          // saved" rather than an error: the user can still fill the intake,
          // and the save will surface the real problem if it persists.
          if (response.status === 409) {
            if (!cancelled) setLoading(false);
            return;
          }
          throw new Error(`Could not load your answers (${response.status}).`);
        }

        const data = (await response.json()) as {
          found?: boolean;
          answers?: IntakeAnswers;
          products?: ProductDraft[];
          initiatives?: InitiativeDraft[];
          resumeScreen?: ScreenId;
        };

        if (cancelled) return;

        if (data.found) {
          setState({
            answers: data.answers ?? {},
            products: data.products ?? [],
            initiatives: data.initiatives ?? [],
          });
          setResumeScreen(data.resumeScreen ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const setAnswer = useCallback((field: string, value: unknown) => {
    setState((prev) => ({ ...prev, answers: { ...prev.answers, [field]: value } }));
  }, []);

  const setAnswers = useCallback((patch: IntakeAnswers) => {
    setState((prev) => ({ ...prev, answers: { ...prev.answers, ...patch } }));
  }, []);

  const setProducts = useCallback((products: ProductDraft[]) => {
    setState((prev) => ({ ...prev, products }));
  }, []);

  const setInitiatives = useCallback((initiatives: InitiativeDraft[]) => {
    setState((prev) => ({ ...prev, initiatives }));
  }, []);

  const save = useCallback(async (screen: ScreenId): Promise<boolean> => {
    setSaving(true);
    setSaveError(null);

    const current = stateRef.current;

    try {
      const response = await fetch("/api/intake/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: current.answers,
          products: current.products,
          initiatives: current.initiatives,
          resumeScreen: screen,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Save failed (${response.status}).`);
      }

      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    state,
    loading,
    loadError,
    saving,
    saveError,
    resumeScreen,
    path: asPath(state.answers.intake_path),
    setAnswer,
    setAnswers,
    setProducts,
    setInitiatives,
    save,
  };
}

function asPath(value: unknown): PlanPath | null {
  return value === "know_most" || value === "know_some" || value === "recommend_all"
    ? value
    : null;
}
