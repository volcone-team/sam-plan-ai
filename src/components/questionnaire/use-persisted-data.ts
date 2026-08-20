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
 */
export function usePersistedData(mode: QuestionnaireMode) {
  const [data, setData] = useState<QuestionnaireData>(() => loadFromStorage(mode));
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);

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
