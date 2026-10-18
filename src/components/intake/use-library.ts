"use client";

import { useEffect, useState } from "react";
import type { LibraryInitiative } from "@/lib/intake/library";

/**
 * Loads the initiative library for the screen 5 and 6 pickers.
 *
 * Fetched once per mount and held in state. The library is ~22 rows that change
 * only when an admin re-uploads the workbook, so there is nothing to revalidate
 * mid-intake.
 *
 * An EMPTY library is surfaced as an error rather than as an empty picker. If
 * the workbook has never been uploaded there is genuinely nothing to choose
 * from, and a silent empty list looks like a broken page — the user would sit
 * there searching for a webinar that the picker cannot offer.
 */
export interface UseLibrary {
  initiatives: LibraryInitiative[];
  loading: boolean;
  error: string | null;
}

/**
 * `plan` (screen 5): the ACTIVE library — what may go into the plan.
 * `history` (screen 6): the whole library, admin-disabled included — what the
 * customer has run before. See /api/intake/library.
 */
export type LibraryScope = "plan" | "history";

interface Loaded {
  scope: LibraryScope;
  initiatives: LibraryInitiative[];
  error: string | null;
}

export function useLibrary(scope: LibraryScope = "plan"): UseLibrary {
  /**
   * The last completed load, tagged with its scope. `loading` is DERIVED —
   * true until a load for the current scope lands — so switching screens
   * never shows the other scope's list as if it were this one's.
   */
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let result: Loaded;
      try {
        const url = scope === "history" ? "/api/intake/library?scope=history" : "/api/intake/library";
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Could not load the initiative list (${response.status}).`);
        }

        const data = (await response.json()) as { initiatives?: LibraryInitiative[] };
        const rows = data.initiatives ?? [];
        result =
          rows.length === 0
            ? {
                scope,
                initiatives: [],
                error: "No initiatives are available yet. Ask your administrator to upload the workbook.",
              }
            : { scope, initiatives: rows, error: null };
      } catch (err) {
        result = { scope, initiatives: [], error: err instanceof Error ? err.message : String(err) };
      }
      if (!cancelled) setLoaded(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [scope]);

  const current = loaded?.scope === scope ? loaded : null;
  return {
    initiatives: current?.initiatives ?? [],
    loading: current === null,
    error: current?.error ?? null,
  };
}
