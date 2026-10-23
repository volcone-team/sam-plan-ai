import { describe, expect, it } from 'vitest';
import type { PickerItem } from '@/lib/intake-v3/picker';
import type { LibraryRecordConfig } from '@/lib/intake-v3/library-config';
import { chooseAddFlow } from './add-initiative-flow';
import { interpretPickerResponse, type PickerReady } from './intake-picker-view';

const item = (key: string): PickerItem => ({
  key,
  name: key,
  oneLiner: null,
  categoryId: 'webinars',
  audience: 'own',
});

const config = (key: string) => ({ initiativeKey: key }) as unknown as LibraryRecordConfig;

const ready = (keys: string[], configKeys: string[] = keys): PickerReady => ({
  status: 'ready',
  items: keys.map(item),
  recentKeys: [],
  configs: Object.fromEntries(configKeys.map(k => [k, config(k)])),
  preview: false,
});

describe('chooseAddFlow', () => {
  it('is loading while the picker request is in flight', () => {
    expect(chooseAddFlow(null)).toEqual({ flow: 'loading' });
  });

  it('falls back to the legacy flow on any error', () => {
    expect(chooseAddFlow({ status: 'error', httpStatus: 503, message: 'x' })).toEqual({ flow: 'legacy' });
    expect(chooseAddFlow({ status: 'error', httpStatus: null, message: 'x' })).toEqual({ flow: 'legacy' });
  });

  it('uses the legacy flow when the admin switch is off', () => {
    expect(chooseAddFlow({ status: 'disabled' })).toEqual({ flow: 'legacy' });
    expect(
      chooseAddFlow(interpretPickerResponse(200, { enabled: false, items: [], configs: {}, recentKeys: [] }))
    ).toEqual({ flow: 'legacy' });
  });

  it("uses the intake flow for a super admin's preview, carrying preview", () => {
    const load = interpretPickerResponse(200, {
      enabled: false,
      preview: true,
      items: [item('a')],
      configs: { a: config('a') },
      recentKeys: [],
    });
    const r = chooseAddFlow(load);
    expect(r.flow).toBe('intake');
    expect(r.flow === 'intake' && r.load.preview).toBe(true);
  });

  it('falls back to the legacy flow when nothing is offered', () => {
    expect(chooseAddFlow(ready([]))).toEqual({ flow: 'legacy' });
  });

  it('falls back when no offered item has a config', () => {
    expect(chooseAddFlow(ready(['a', 'b'], []))).toEqual({ flow: 'legacy' });
  });

  it('uses the intake flow, keeping only items with a config', () => {
    const r = chooseAddFlow(ready(['a', 'b', 'c'], ['a', 'c']));
    expect(r.flow).toBe('intake');
    expect(r.flow === 'intake' && r.load.items.map(i => i.key)).toEqual(['a', 'c']);
  });

  it('does not treat inherited properties as configs', () => {
    expect(chooseAddFlow(ready(['toString', 'constructor'], []))).toEqual({ flow: 'legacy' });
  });

  /**
   * Intake is chosen exactly when some item has a config, and then every
   * item shown can open the form.
   */
  it('property (exhaustive over 4 keys): intake iff some item has a config; every shown item has one', () => {
    const ALL = ['a', 'b', 'c', 'd'];
    const subset = (mask: number) => ALL.filter((_, i) => mask & (1 << i));
    for (let m = 0; m < 16; m++) {
      for (let n = 0; n < 16; n++) {
        const keys = subset(m);
        const configKeys = subset(n);
        const r = chooseAddFlow(ready(keys, configKeys));
        expect(r.flow === 'intake').toBe(keys.some(k => configKeys.includes(k)));
        if (r.flow === 'intake') {
          expect(r.load.items.map(i => i.key)).toEqual(keys.filter(k => configKeys.includes(k)));
        }
      }
    }
  });
});
