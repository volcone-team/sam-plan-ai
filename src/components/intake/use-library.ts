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

export function useLibrary(): UseLibrary {
  const [initiatives, setInitiatives] = useState<LibraryInitiative[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/intake/library", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Could not load the initiative list (${response.status}).`);
        }

        const data = (await response.json()) as { initiatives?: LibraryInitiative[] };
        if (cancelled) return;

        const rows = data.initiatives ?? [];
        if (rows.length === 0) {
          setError(
            "No initiatives are available yet. Ask your administrator to upload the workbook."
          );
          return;
        }

        setInitiatives(rows);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { initiatives, loading, error };
}
