"use client";

import { useEffect, useState } from "react";
import { NO_LEGAL_URLS, type LegalUrls } from "@/lib/legal-urls";

/**
 * The Privacy Policy and Terms links, as set on /admin/settings.
 *
 * Shared by every surface that links to the policies (the signup form and the
 * Benchmarks settings tab). Reads the public /api/legal-urls endpoint, which
 * re-validates on the way out, and defaults to nulls so a failed request
 * renders plain text instead of breaking the page.
 */
export function useLegalUrls(): LegalUrls {
  const [legal, setLegal] = useState<LegalUrls>(NO_LEGAL_URLS);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch("/api/legal-urls", { cache: "no-store" });
        if (!response.ok) return;
        const body = (await response.json()) as LegalUrls;
        if (!cancelled) setLegal(body);
      } catch {
        // Links stay plain text. Nothing here should block the page.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return legal;
}
