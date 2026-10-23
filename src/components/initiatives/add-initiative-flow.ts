/**
 * Which flow the Add Initiative panel shows. Pure; see useIntakePickerLoad
 * for where the input comes from.
 *
 *   loading  GET /api/intake-v3/picker is in flight.
 *   intake   the new Initiative Intake: IntakePicker → IntakeForm.
 *   legacy   the old library picker and configure form, unchanged.
 *
 * LEGACY IS THE FALLBACK. The admin switch off (status 'disabled'), any
 * failure, or nothing offered keeps the old flow:
 * until initiative_library_config is filled in, nothing is offered and the
 * panel must keep working exactly as before. An item the server returned
 * without a config cannot open the form, so it is dropped here; if that
 * leaves nothing, the panel falls back too.
 */

import type { PickerLoad, PickerReady } from './intake-picker-view';

export type AddFlow =
  | { flow: 'loading' }
  | { flow: 'legacy' }
  | { flow: 'intake'; load: PickerReady };

export function chooseAddFlow(load: PickerLoad | null): AddFlow {
  if (load === null) return { flow: 'loading' };
  if (load.status !== 'ready') return { flow: 'legacy' };
  const items = load.items.filter(i => Object.prototype.hasOwnProperty.call(load.configs, i.key));
  if (items.length === 0) return { flow: 'legacy' };
  return { flow: 'intake', load: { ...load, items } };
}
