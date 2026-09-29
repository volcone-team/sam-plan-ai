'use client';

import { useEffect, useState } from 'react';

/**
 * Optional deterrent against casual inspection of the page.
 *
 * READ THIS BEFORE RELYING ON IT.
 *
 * This is NOT a security control and cannot be made into one. The JavaScript
 * bundle is downloaded by every visitor — that is how the app runs — so it is
 * readable via `view-source:`, curl, a proxy, the browser's own menu, or simply
 * turning JavaScript off, none of which this component can touch. Anyone who
 * actually wants the client code already has it.
 *
 * What it DOES do is stop over-the-shoulder poking: a right-click or an F12
 * reflex during a demo or on a shared screen. That is the entire goal.
 *
 * Deliberately NOT included (common in "disable devtools" snippets, all bad):
 *   - Window-size heuristics to detect an open inspector: they fire on split
 *     screens and zoom, and punish innocent users.
 *   - `debugger`-in-a-loop traps: they freeze the tab, and a paused script is
 *     indistinguishable from a crash to the person using it.
 *   - Blanket text-selection or copy blocking: breaks genuine use (copying a
 *     value out of the plan) and fights the browser's accessibility features.
 *
 * Real protection is server-side: secrets live in route handlers and env vars
 * and never reach the client, every /api route is authorization-guarded, and
 * RLS constrains the database.
 */
export function DevtoolsDeterrent() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/settings', { credentials: 'same-origin' });
        if (!res.ok) return;
        const body = await res.json();
        if (active) setEnabled(body?.deterDevtools === true);
      } catch {
        // Default off: a failed settings read must never make the app feel broken.
      }
    })();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onContextMenu = (e: MouseEvent) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();

      // F12 — the usual DevTools shortcut.
      if (e.key === 'F12') {
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd+Shift+I / J / C — inspector, console, element picker.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && ['i', 'j', 'c'].includes(key)) {
        e.preventDefault();
        return;
      }

      // Ctrl/Cmd+U — view source.
      if ((e.ctrlKey || e.metaKey) && key === 'u') {
        e.preventDefault();
      }

      // Ctrl/Cmd+S is deliberately left alone: users legitimately save pages,
      // and blocking it does not stop anyone from reading the source.
    };

    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [enabled]);

  return null;
}
