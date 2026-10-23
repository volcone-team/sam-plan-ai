import { describe, expect, it } from 'vitest';
import { buildCategoryList, type PickerItem } from '@/lib/intake-v3/picker';
import {
  categoryAnnouncement,
  countCategoryList,
  interpretPickerResponse,
  searchAnnouncement,
} from './intake-picker-view';

const item = (key: string, audience: PickerItem['audience'] = 'own'): PickerItem => ({
  key,
  name: key,
  oneLiner: null,
  categoryId: 'webinars',
  audience,
});

describe('interpretPickerResponse', () => {
  it('returns items and string recent keys on 200', () => {
    const r = interpretPickerResponse(200, { items: [item('a')], recentKeys: ['a', 3, null, 'b'] });
    expect(r).toEqual({ status: 'ready', items: [item('a')], recentKeys: ['a', 'b'], configs: {}, preview: false });
  });

  it('treats an empty item list as ready, not an error', () => {
    expect(interpretPickerResponse(200, { items: [], recentKeys: [] })).toEqual({
      status: 'ready',
      items: [],
      recentKeys: [],
      configs: {},
      preview: false,
    });
  });

  it('maps the switched-off body to disabled', () => {
    expect(
      interpretPickerResponse(200, { enabled: false, items: [], configs: {}, recentKeys: [] })
    ).toEqual({ status: 'disabled' });
  });

  it("keeps a super admin's preview ready, marked preview", () => {
    const r = interpretPickerResponse(200, { enabled: false, preview: true, items: [item('a')], recentKeys: [] });
    expect(r).toMatchObject({ status: 'ready', preview: true });
  });

  it('reads enabled: true as ready, not preview', () => {
    const r = interpretPickerResponse(200, { enabled: true, items: [item('a')] });
    expect(r).toMatchObject({ status: 'ready', preview: false });
  });

  it('passes configs through, and ignores a non-object configs', () => {
    const configs = { a: { initiativeKey: 'a' } };
    const r = interpretPickerResponse(200, { items: [item('a')], configs });
    expect(r.status === 'ready' && r.configs).toEqual(configs);
    const bad = interpretPickerResponse(200, { items: [item('a')], configs: ['x'] });
    expect(bad.status === 'ready' && bad.configs).toEqual({});
  });

  it('defaults missing recentKeys to empty', () => {
    const r = interpretPickerResponse(200, { items: [] });
    expect(r.status === 'ready' && r.recentKeys).toEqual([]);
  });

  it('rejects a 200 without an items array', () => {
    for (const body of [undefined, null, {}, { items: 'x' }]) {
      expect(interpretPickerResponse(200, body).status).toBe('error');
    }
  });

  it('maps 401 to a sign-in message', () => {
    const r = interpretPickerResponse(401, { error: 'Unauthorized' });
    expect(r).toMatchObject({ status: 'error', httpStatus: 401 });
    expect(r.status === 'error' && r.message).toMatch(/sign in/i);
  });

  it("uses the server's 503 message, with a fallback", () => {
    expect(interpretPickerResponse(503, { error: 'Down for a bit.' })).toMatchObject({ message: 'Down for a bit.' });
    expect(interpretPickerResponse(503, undefined)).toMatchObject({
      message: expect.stringMatching(/unavailable/),
    });
  });

  it('reports other statuses and network failure', () => {
    expect(interpretPickerResponse(500, { error: 'boom' })).toMatchObject({
      httpStatus: 500,
      message: 'Could not load initiatives (500).',
    });
    expect(interpretPickerResponse(null, undefined)).toMatchObject({
      httpStatus: null,
      message: expect.stringMatching(/reach the server/),
    });
  });
});

describe('countCategoryList', () => {
  it('counts across audience groups', () => {
    const list = buildCategoryList([item('a'), item('b', 'borrowed'), item('c', 'borrowed')], 'webinars')!;
    expect(list.groups).toHaveLength(2);
    expect(countCategoryList(list)).toBe(3);
  });
});

describe('announcements', () => {
  it('is silent for a blank query', () => {
    expect(searchAnnouncement(5, '   ')).toBe('');
  });

  it('pluralises and quotes the trimmed query', () => {
    expect(searchAnnouncement(0, ' web ')).toBe('No initiatives match “web”.');
    expect(searchAnnouncement(1, 'web')).toBe('1 initiative matches “web”.');
    expect(searchAnnouncement(2, 'web')).toBe('2 initiatives match “web”.');
    expect(categoryAnnouncement(1, 'Webinars')).toBe('1 initiative in Webinars.');
  });
});
