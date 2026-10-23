/**
 * Pure view helpers for <IntakePicker>: interpreting the GET
 * /api/intake-v3/picker response and the text the live region announces.
 * The picker logic itself (tiles, lists, search, index, recents) lives in
 * src/lib/intake-v3/picker.ts.
 */

import type { CategoryList, PickerItem } from '@/lib/intake-v3/picker';
import type { LibraryRecordConfig } from '@/lib/intake-v3/library-config';

export type PickerReady = {
  status: 'ready';
  items: PickerItem[];
  recentKeys: string[];
  /** Effective config per item key, for the intake form. */
  configs: Record<string, LibraryRecordConfig>;
  /**
   * True when the admin switch is off and this super admin is seeing the new
   * form only as a preview (customers still get the current form).
   */
  preview: boolean;
};

export type PickerLoad =
  | PickerReady
  /** The admin switch is off: the panel keeps the current form. */
  | { status: 'disabled' }
  | { status: 'error'; httpStatus: number | null; message: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const serverMessage = (body: unknown): string | null =>
  isObject(body) && typeof body.error === 'string' && body.error.trim() !== '' ? body.error.trim() : null;

/**
 * One response → ready data or a user-facing error. `body` is the parsed JSON,
 * or undefined if it was not JSON. `httpStatus` null means the request never
 * got a response (network failure).
 */
export function interpretPickerResponse(httpStatus: number | null, body: unknown): PickerLoad {
  if (httpStatus === null) {
    return { status: 'error', httpStatus, message: 'Could not reach the server. Check your connection and try again.' };
  }
  if (httpStatus === 401) {
    return { status: 'error', httpStatus, message: 'Your session has ended. Sign in again to see initiatives.' };
  }
  if (httpStatus === 503) {
    return {
      status: 'error',
      httpStatus,
      message: serverMessage(body) ?? 'The initiative library is unavailable right now. Please try again shortly.',
    };
  }
  if (httpStatus < 200 || httpStatus >= 300) {
    return { status: 'error', httpStatus, message: `Could not load initiatives (${httpStatus}).` };
  }
  // Switch off. A super admin's preview carries enabled: false with real data.
  const preview = isObject(body) && body.preview === true;
  if (isObject(body) && body.enabled === false && !preview) {
    return { status: 'disabled' };
  }
  if (!isObject(body) || !Array.isArray(body.items)) {
    return { status: 'error', httpStatus, message: 'Could not load initiatives (unexpected response).' };
  }
  const recentKeys = Array.isArray(body.recentKeys)
    ? body.recentKeys.filter((k): k is string => typeof k === 'string')
    : [];
  const configs = isObject(body.configs) && !Array.isArray(body.configs)
    ? (body.configs as Record<string, LibraryRecordConfig>)
    : {};
  return { status: 'ready', items: body.items as PickerItem[], recentKeys, configs, preview };
}

/** How many initiatives a category list shows, across groups and sections. */
export function countCategoryList(list: CategoryList): number {
  return list.groups.reduce((n, g) => n + g.sections.reduce((m, s) => m + s.items.length, 0), 0);
}

const plural = (n: number) => (n === 1 ? 'initiative' : 'initiatives');

/** Text for the polite live region while searching. */
export function searchAnnouncement(count: number, query: string): string {
  const q = query.trim();
  if (q === '') return '';
  if (count === 0) return `No initiatives match “${q}”.`;
  return `${count} ${plural(count)} ${count === 1 ? 'matches' : 'match'} “${q}”.`;
}

/** Text for the polite live region on screen 2. */
export function categoryAnnouncement(count: number, label: string): string {
  return `${count} ${plural(count)} in ${label}.`;
}
