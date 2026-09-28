'use client';

import { useCallback, useEffect, useState } from 'react';
import { initiativeService } from '@/services/initiative.service';

/**
 * The calendar years a company's plan covers, plus the year currently being
 * viewed.
 *
 * A 12-month plan generated in September spans two calendar years but is ONE
 * `annual_plans` row, so the later year has no row of its own. Deriving the span
 * from initiative dates is the only way that year becomes reachable - previously
 * every screen pinned itself to `new Date().getFullYear()` and the second half of
 * such a plan was invisible.
 *
 * The selected year is kept in sessionStorage rather than component state so it
 * survives navigation: choosing 2027 on Year-at-a-Glance keeps 2027 when you open
 * Monthly or Quarterly. Deliberately NOT a React context - these screens mount
 * independently and a provider would have to wrap the whole app for no other gain.
 */

const STORAGE_KEY = 'sam-selected-plan-year';
/** Notifies other mounted screens in this tab when the year changes. */
const CHANGE_EVENT = 'sam-plan-year-change';

function readStored(): number | null {
  try {
    const n = Number(sessionStorage.getItem(STORAGE_KEY));
    return Number.isInteger(n) && n > 2000 && n < 2200 ? n : null;
  } catch {
    return null;
  }
}

export function usePlanYears(companyId: string) {
  const currentYear = new Date().getFullYear();
  const [years, setYears] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [stored, setStored] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : readStored()
  );

  // Keep every mounted screen in step within the tab.
  useEffect(() => {
    const sync = () => setStored(readStored());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      try {
        const initiatives = await initiativeService.getInitiativesByCompany(companyId);
        if (cancelled) return;
        const set = new Set<number>();
        for (const i of initiatives) {
          for (const d of [i.activationDate, i.eventDate]) {
            const y = d ? new Date(d).getFullYear() : NaN;
            if (Number.isInteger(y)) set.add(y);
          }
        }
        setYears([...set].sort((a, b) => a - b));
      } catch (err) {
        console.error('[usePlanYears] load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  const setSelectedYear = useCallback((year: number) => {
    try { sessionStorage.setItem(STORAGE_KEY, String(year)); } catch { /* private mode */ }
    setStored(year);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  // Honour an explicit choice only while the plan still covers it; otherwise fall
  // back to the current year, else the nearest year the plan reaches.
  const selectedYear = (() => {
    if (stored !== null && (years.length === 0 || years.includes(stored))) return stored;
    if (years.includes(currentYear)) return currentYear;
    const ahead = years.filter((y) => y >= currentYear);
    if (ahead.length) return ahead[0];
    return years.length ? years[years.length - 1] : currentYear;
  })();

  return { years, selectedYear, setSelectedYear, currentYear, loading };
}
