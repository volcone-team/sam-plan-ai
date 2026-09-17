"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  createEmptyQuestionnaireData,
  type QuestionnaireData,
} from "./questionnaire-data";
import type { QuestionnaireMode } from "./questionnaire-types";

const STORAGE_KEY_PREFIX = "sam-questionnaire-";

function getStorageKey(mode: QuestionnaireMode): string {
  return `${STORAGE_KEY_PREFIX}${mode}`;
}

function loadFromStorage(mode: QuestionnaireMode): QuestionnaireData {
  if (typeof window === "undefined") return createEmptyQuestionnaireData();
  try {
    const stored = localStorage.getItem(getStorageKey(mode));
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<QuestionnaireData>;
      return { ...createEmptyQuestionnaireData(), ...parsed };
    }
  } catch {
    // Ignore parse errors
  }
  return createEmptyQuestionnaireData();
}

/**
 * Persists questionnaire data to localStorage.
 * Loads once on mount, auto-saves on every change with debounce.
 * If localStorage is empty, attempts to load saved answers from the DB (for regeneration).
 */
export function usePersistedData(mode: QuestionnaireMode) {
  const [data, setData] = useState<QuestionnaireData>(() => loadFromStorage(mode));
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);
  const dbLoadAttempted = useRef(false);

  // If localStorage is empty, try loading from DB (pre-fill for regeneration)
  useEffect(() => {
    if (dbLoadAttempted.current) return;
    dbLoadAttempted.current = true;

    // Only load from DB if current data is empty
    const hasData = data.annualRevenueGoal || data.products?.length || data.whatsWorked?.length;
    if (hasData) {
      console.log("[usePersistedData] localStorage has data, skipping DB load");
      return;
    }

    async function loadFromDB() {
      try {
        console.log("[usePersistedData] No local data, trying DB...");
        const res = await fetch("/api/plan/answers");
        if (!res.ok) return;
        const json = await res.json();
        if (!json.answers) {
          console.log("[usePersistedData] No saved answers in DB");
          return;
        }
        console.log("[usePersistedData] Pre-filling from DB:", Object.keys(json.answers).length, "fields");
        // Ensure every pre-filled product has a stable id so list keys and
        // edit/remove handlers work (DB rows use UUIDs; guard anyway).
        const answers = { ...json.answers };
        if (Array.isArray(answers.products)) {
          answers.products = answers.products.map((p: any, i: number) => ({
            ...p,
            id: p.id || `prod-prefill-${i}-${Math.random().toString(36).slice(2, 7)}`,
          }));
        }
        setData((prev) => ({ ...prev, ...answers }));
      } catch (err) {
        console.log("[usePersistedData] DB load failed:", err);
      }
    }
    loadFromDB();
  }, []);

  // Save to localStorage on every data change (debounced), skip initial
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(getStorageKey(mode), JSON.stringify(data));
      } catch {
        // Ignore quota errors
      }
    }, 200);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [data, mode]);

  const updateData = useCallback((updates: Partial<QuestionnaireData>) => {
    setData((prev) => {
      const next = { ...prev, ...updates };
      // Immediately save for reliability (in addition to debounced save)
      try {
        localStorage.setItem(getStorageKey(mode), JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [mode]);

  const resetData = useCallback(() => {
    setData(createEmptyQuestionnaireData());
    try {
      localStorage.removeItem(getStorageKey(mode));
    } catch {
      // ignore
    }
  }, [mode]);

  return { data, updateData, resetData, hydrated: true };
}
