import { describe, it, expect } from 'vitest';
import {
  parseWorkbook, parseScore, splitList, canonicalKey,
  resolveLibraryColumns, resolveLibraryExtraColumns, resolveAiContextColumns,
  type RawSheet,
} from '@/lib/workbook/parse';

/**
 * The Oct 2026 library layout: 19 columns, ID first, S/C/O/R/E scores, no
 * Difficulty or text Speed. Header cells carry newlines like the real sheet.
 * Rows below are short synthetic stand-ins, not client text.
 */
const NEW_HEADERS = [
  'ID', 'Initiative Name', 'Category', 'Training', 'Metrics',
  'One-line description', 'Longer Description', 'Do you need a sales team?',
  'Primary product price tier', 'Own / Ops (future)', 'Ideal Industries', 'Call to Action Options',
  'Speed (S)\n5 = really fast\n1 = slow', 'Cost (C)\n5 = low cost\n1 = expensive',
  'Odds (O)\n5 = near certain\n1 = long shot', 'Revenue (R)\n5 = great\n1 = low',
  'Ease (E)\n5 = easy\n1 = hard', 'SCORE total\n5 is always best; max 25',
  'Weighted SCORE\n(weight on FIT then SCORE tab)',
];

interface Lib {
  id?: string; name?: string; category?: string; training?: string; metrics?: string;
  one?: string; long?: string; sales?: string; tier?: string; own?: string;
  industries?: string; cta?: string; scores?: string[]; total?: string;
}

/** One library row in the new layout. Scores default to 3s with a matching total. */
const lib = (r: Lib): string[] => {
  const scores = r.scores ?? ['3', '3', '3', '3', '3'];
  return [
    r.id ?? '', r.name ?? '', r.category ?? '', r.training ?? '', r.metrics ?? '',
    r.one ?? 'Short pitch', r.long ?? 'Longer text', r.sales ?? 'OPTIONAL', r.tier ?? 'Mid',
    r.own ?? 'OWN', r.industries ?? '', r.cta ?? '', ...scores, r.total ?? '15', '#REF!',
  ];
};

/** A banner or heading: a single non-blank cell in the name column. */
const label = (text: string, width = NEW_HEADERS.length): string[] =>
  Array.from({ length: width }, (_, i) => (i === 1 ? text : ''));

const sheet = (name: string, headers: string[], rows: string[][]): RawSheet =>
  ({ name, headers, rows, rowCount: rows.length });

const libSheet = (rows: string[][]) => sheet('1. Initiative Library', NEW_HEADERS, rows);

describe('new library layout — columns by header', () => {
  it('finds every field and drops Difficulty / text Speed instead of misreading', () => {
    expect(resolveLibraryColumns(NEW_HEADERS)).toEqual({
      category: 2, workbookId: 0, name: 1,
      // Historical positions 3/4 now hold Training and Metrics.
      difficulty: -1, speedToResults: -1,
      oneLiner: 5, description: 6, needsSalesTeam: 7, priceTier: 8, ownOrOps: 9,
    });
    expect(resolveLibraryExtraColumns(NEW_HEADERS)).toEqual({
      training: 3, metrics: 4, idealIndustries: 10, ctaOptions: 11,
      speedScore: 12, costScore: 13, oddsScore: 14, revenueScore: 15, easeScore: 16,
      sheetScoreTotal: 17, frequency: -1, allowedFrequencies: -1,
    });
  });

  it('has no new-layout columns on an old sheet', () => {
    const extra = resolveLibraryExtraColumns(['Initiative Category', 'ID', 'Initiative Name', 'Difficulty']);
    expect(Object.values(extra).every((i) => i === -1)).toBe(true);
  });

  it('parses a row into every field, without a missing-header warning', () => {
    const p = parseWorkbook([libSheet([
      lib({
        id: 'IN02', name: 'Email Campaign', category: 'Email, Text & Mail', training: 'Email Course, SOD',
        metrics: 'Opens\nClicks', one: 'Promo emails', long: 'A sequence', sales: 'NO', tier: 'Low → Mid',
        own: 'OWN', industries: 'Retail, Health & Wellness', cta: 'Offer; Lead Collect',
        scores: ['5', '4', '5', '3', '4'], total: '21',
      }),
    ])]);
    expect(p.library).toHaveLength(1);
    expect(p.library[0]).toEqual({
      initiativeKey: 'email-campaign', workbookId: 'IN02', name: 'Email Campaign',
      category: 'Email, Text & Mail', difficulty: null, speedToResults: null,
      oneLiner: 'Promo emails', description: 'A sequence', needsSalesTeam: 'NO',
      priceTier: 'Low → Mid', ownOrOps: 'OWN', displayOrder: 0,
      speedScore: 5, costScore: 4, oddsScore: 5, revenueScore: 3, easeScore: 4, scoreTotal: 21,
      idealIndustries: ['Retail', 'Health & Wellness'], ctaOptions: ['Offer', 'Lead Collect'],
      training: ['Email Course', 'SOD'], metricsRaw: 'Opens\nClicks',
      allowedKindsRaw: null, allowedFrequenciesRaw: null,
    });
    expect(p.warnings.some((w) => /Initiative Library: (could not find|no column)/.test(w))).toBe(false);
  });
});

describe('new library layout — banners, headings and stray rows', () => {
  const p = parseWorkbook([libSheet([
    label("CATEGORY: OTHER PEOPLE'S STAGES - OPS - IN-PERSON"),
    lib({ id: 'IN10', name: 'Networking Events', own: 'OPS' }),
    label('DIGITAL MARKETING'),
    lib({ id: 'IN57', name: 'Your Own Newsletter' }),
    label('Sales Team'),
    lib({ id: 'IN06', name: 'Sales Calls', sales: 'YES' }),
    lib({ id: 'IN99' }),                                   // ID, no name
  ])]);

  it('skips banners in the name column and section headings', () => {
    expect(p.library.map((r) => r.initiativeKey))
      .toEqual(['networking-events', 'your-own-newsletter', 'sales-calls']);
  });

  it('carries the banner onto rows with no category of their own', () => {
    expect(p.library[0].category).toBe("OTHER PEOPLE'S STAGES - OPS - IN-PERSON");
  });

  it('warns about each heading and the nameless row', () => {
    expect(p.warnings.some((w) => /"DIGITAL MARKETING" has no ID/.test(w))).toBe(true);
    expect(p.warnings.some((w) => /"Sales Team" has no ID/.test(w))).toBe(true);
    expect(p.warnings.some((w) => /ID IN99 has no initiative name/.test(w))).toBe(true);
  });

  it('keeps reading sales team as written', () => {
    expect(p.library.find((r) => r.name === 'Sales Calls')!.needsSalesTeam).toBe('YES');
  });
});

describe('new library layout — duplicate IDs and names', () => {
  const rows = [
    lib({ id: 'IN15', name: 'Hybrid Events', category: 'Stages - In-Person', own: 'OPS' }),
    lib({ id: 'IN01', name: 'Live Webinar', category: 'Webinars', own: 'OPS', scores: ['5', '5', '4', '4', '3'], total: '21' }),
    // Same ID, name and Own/Ops as the first, but different details — a
    // variant, not a word-for-word repeat (those collapse; see below).
    lib({ id: 'IN15', name: 'Hybrid Events', category: 'Stages - Virtual', own: 'OPS', long: 'Virtual side' }),
    lib({ id: 'IN15', name: 'Your Own Hybrid Event', category: 'Own - In-Person', own: 'OWN' }),
    lib({ id: 'IN07', name: 'Organic Social', category: 'Content', own: 'OWN' }),
    lib({ id: 'IN01', name: 'Live Webinar', category: 'Webinars', own: 'OWN', scores: ['5', '4', '4', '4', '3'], total: '20' }),
    lib({ id: 'IN15', name: 'Hybrid Events', category: 'Own - Virtual', own: 'OWN' }),
    lib({ id: 'IN07', name: 'Content', category: 'Content', own: 'OWN' }),
  ];
  const p = parseWorkbook([libSheet(rows)]);
  const keyOf = (name: string, own: string, category?: string) =>
    p.library.find((r) => r.name === name && r.ownOrOps === own && (!category || r.category === category))!.initiativeKey;

  it('keeps every distinct listing, each with a unique key', () => {
    expect(p.library).toHaveLength(8);
    expect(new Set(p.library.map((r) => r.initiativeKey)).size).toBe(8);
  });

  it('gives the first listing exactly the key the parser has always produced', () => {
    expect(keyOf('Live Webinar', 'OPS')).toBe(canonicalKey('Live Webinar'));
    expect(keyOf('Live Webinar', 'OPS')).toBe('webinar');
    expect(keyOf('Hybrid Events', 'OPS', 'Stages - In-Person')).toBe('hybrid-events');
    expect(keyOf('Your Own Hybrid Event', 'OWN')).toBe('your-own-hybrid-event');
    expect(keyOf('Organic Social', 'OWN')).toBe('organic-social');
    expect(keyOf('Content', 'OWN')).toBe('content');
  });

  it('suffixes later listings with what distinguishes them', () => {
    expect(keyOf('Live Webinar', 'OWN')).toBe('webinar-own');
    expect(keyOf('Hybrid Events', 'OPS', 'Stages - Virtual')).toBe('hybrid-events-stages-virtual');
    expect(keyOf('Hybrid Events', 'OWN')).toBe('hybrid-events-own');
  });

  it('keeps the raw ID on every listing', () => {
    expect(p.library.filter((r) => r.workbookId === 'IN15')).toHaveLength(4);
  });

  it('is deterministic and does not depend on unrelated rows moving', () => {
    const again = parseWorkbook([libSheet(rows)]);
    expect(again.library.map((r) => r.initiativeKey)).toEqual(p.library.map((r) => r.initiativeKey));

    const shuffled = parseWorkbook([libSheet([
      lib({ id: 'IN90', name: 'Direct Mail' }),
      ...rows.filter((r) => r[1] !== 'Organic Social' && r[1] !== 'Content'),
      ...rows.filter((r) => r[1] === 'Organic Social' || r[1] === 'Content').reverse(),
    ])]);
    const byIdentity = (wb: typeof p) => Object.fromEntries(
      wb.library.map((r) => [`${r.name}|${r.ownOrOps}|${r.category}`, r.initiativeKey]));
    const before = byIdentity(p);
    const after = byIdentity(shuffled);
    for (const [identity, key] of Object.entries(before)) expect(after[identity]).toBe(key);
  });

  it('never hands a suffixed key to a row that owns it by name', () => {
    const q = parseWorkbook([libSheet([
      lib({ id: 'IN01', name: 'Live Webinar', own: 'OPS' }),
      lib({ id: 'IN01', name: 'Live Webinar', own: 'OWN', long: 'Hosted' }),
      lib({ id: 'IN50', name: 'Webinar Own' }),            // normalises to "webinar-own"
    ])]);
    const keys = q.library.map((r) => r.initiativeKey);
    expect(keys[2]).toBe('webinar-own');
    expect(keys[1]).not.toBe('webinar-own');
    expect(new Set(keys).size).toBe(3);
  });

  it('warns with each duplicate and how it was resolved', () => {
    expect(p.warnings.some((w) =>
      /"Live Webinar" is listed 2 times/.test(w) && /keeps "webinar"/.test(w) && /"webinar-own" \[by Own\/Ops\]/.test(w)
    )).toBe(true);
    expect(p.warnings.some((w) => /ID IN15 is shared by 4 different listings/.test(w))).toBe(true);
    expect(p.warnings.some((w) => /ID IN07 is shared by 2/.test(w))).toBe(true);
  });

  it('still collapses a word-for-word repeat under another category', () => {
    const q = parseWorkbook([libSheet([
      lib({ id: 'IN12', name: 'Online Workshops', category: 'Large Format' }),
      lib({ id: 'IN12', name: 'Online Workshops', category: 'Small Format' }),
    ])]);
    expect(q.library.map((r) => r.initiativeKey)).toEqual(['online-workshops']);
    expect(q.warnings.some((w) => /collapsed 1 duplicate/.test(w))).toBe(true);
  });
});

describe('scores', () => {
  it('accepts whole numbers 1-5 only', () => {
    expect(parseScore('4')).toEqual({ value: 4, problem: null });
    expect(parseScore(5)).toEqual({ value: 5, problem: null });
    expect(parseScore('3.0').value).toBe(3);
    for (const bad of ['', '0', '6', '3.5', 'high', '#REF!', '-2']) {
      const r = parseScore(bad);
      expect(r.value).toBeNull();
      expect(r.problem).not.toBeNull();
    }
  });

  it('stores bad scores as null, warns, and leaves the total unknown', () => {
    const p = parseWorkbook([libSheet([
      lib({ id: 'IN04', name: 'Paid Ads', scores: ['3', '', '7', 'x', '2'], total: '12' }),
    ])]);
    const row = p.library[0];
    expect([row.speedScore, row.costScore, row.oddsScore, row.revenueScore, row.easeScore])
      .toEqual([3, null, null, null, 2]);
    expect(row.scoreTotal).toBeNull();
    const w = p.warnings.find((x) => x.startsWith('Library "Paid Ads"'))!;
    expect(w).toMatch(/Cost blank/);
    expect(w).toMatch(/Odds 7 is outside 1-5/);
    expect(w).toMatch(/Revenue "x" is not a whole number/);
    // Nothing to cross-check against when the sum is unknown.
    expect(p.warnings.some((x) => /does not match/.test(x))).toBe(false);
  });

  it('computes the total itself and flags a sheet total that disagrees', () => {
    const p = parseWorkbook([libSheet([
      lib({ id: 'IN08', name: 'Referrals', scores: ['5', '4', '4', '4', '4'], total: '20' }),
      lib({ id: 'IN09', name: 'Direct Message', scores: ['5', '4', '3', '2', '4'], total: '18' }),
      lib({ id: 'IN13', name: 'Internal Launch', scores: ['1', '4', '4', '4', '2'], total: '#REF!' }),
    ])]);
    expect(p.library.map((r) => r.scoreTotal)).toEqual([21, 18, 15]);
    const mismatches = p.warnings.filter((w) => /does not match/.test(w));
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toMatch(/"Referrals".*SCORE total 20.*= 21/);
  });
});

describe('lists and metrics', () => {
  it('splits on commas, semicolons and newlines, trimming blanks', () => {
    expect(splitList('Offer; Lead Collect;  Drive to Calls ')).toEqual(['Offer', 'Lead Collect', 'Drive to Calls']);
    expect(splitList('Retail, Brick & Mortar,')).toEqual(['Retail', 'Brick & Mortar']);
    expect(splitList('A\nB')).toEqual(['A', 'B']);
    expect(splitList('')).toEqual([]);
  });

  it('keeps Metrics verbatim and blank Metrics as null', () => {
    const metrics = 'VIRTUAL\n- Attendance \n- GA sales';
    const p = parseWorkbook([libSheet([
      lib({ id: 'IN15', name: 'Hybrid Events', metrics }),
      lib({ id: 'IN44', name: 'Behind-the-Scenes Event', metrics: '  ' }),
    ])]);
    expect(p.library[0].metricsRaw).toBe(metrics);
    expect(p.library[1].metricsRaw).toBeNull();
    expect(p.library[1].idealIndustries).toEqual([]);
  });
});

describe('AI Context with an ID column and duplicate IDs', () => {
  const CTX_HEADERS = ['ID', 'Initiative', 'When to recommend it (situation)', 'Best-fit audience',
    'Min. assets needed', "Why it works (Pete's logic)", 'What to avoid / warnings', 'Sequencing notes', 'Sequencing notes'];
  const ctx = (id: string, name: string, why: string): string[] =>
    [id, name, 'When', 'Fit', 'Assets', why, 'Avoid', 'Sequence', ''];
  const ctxLabel = (text: string) => label(text, CTX_HEADERS.length);

  const sheets: RawSheet[] = [
    libSheet([
      label('CATEGORY: OTHER STAGES - OPS'),
      lib({ id: 'IN01', name: 'Live Webinar', own: 'OPS' }),
      lib({ id: 'IN15', name: 'Hybrid Events', category: 'Virtual', own: 'OPS' }),
      label('CATEGORY: YOUR OWN STAGES - OWN'),
      lib({ id: 'IN15', name: 'Your Own Hybrid Event', own: 'OWN' }),
      lib({ id: 'IN01', name: 'Live Webinar', own: 'OWN', long: 'Hosted' }),
      label('Sales Team'),
      lib({ id: 'IN06', name: 'Sales Calls' }),
    ]),
    sheet('3. AI Context', CTX_HEADERS, [
      ctxLabel('CATEGORY: OTHER STAGES - OPS'),
      ctx('IN01', 'Live Webinar', 'guest version'),
      ctx('IN15', 'Hybrid Events', 'borrowed rooms'),
      ctxLabel('CATEGORY: YOUR OWN STAGES - OWN'),
      ctx('IN15', 'Your Own Hybrid Event', 'own both rooms'),
      ctx('IN01', 'Live Webinar', 'hosted version'),
      ctxLabel('Sales Team'),
      ctx('IN06', 'Sales Calls', 'closes'),
    ]),
  ];
  const p = parseWorkbook(sheets);
  const why = (key: string) => p.aiContext.find((c) => c.initiativeKey === key)?.whyItWorks;

  it('reads columns by header: the ID is not the initiative, and there is no budget column', () => {
    expect(resolveAiContextColumns(CTX_HEADERS)).toEqual({
      workbookId: 0, initiative: 1, whenToUse: 2, bestFit: 3, minBudget: -1,
      minAssets: 4, whyItWorks: 5, whatToAvoid: 6, sequencingNotes: 7,
    });
    const row = p.aiContext.find((c) => c.initiativeKey === 'sales-calls')!;
    expect(row).toEqual({
      initiativeKey: 'sales-calls', whenToUse: 'When', bestFit: 'Fit', minBudget: null,
      minAssets: 'Assets', whyItWorks: 'closes', whatToAvoid: 'Avoid', sequencingNotes: 'Sequence',
    });
  });

  it('attaches each duplicate to its own listing instead of overwriting', () => {
    expect(why('webinar')).toBe('guest version');
    expect(why('webinar-own')).toBe('hosted version');
    expect(why('hybrid-events')).toBe('borrowed rooms');
    expect(why('your-own-hybrid-event')).toBe('own both rooms');
  });

  it('produces exactly one context row per library key, and skips headings', () => {
    const keys = p.aiContext.map((c) => c.initiativeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(keys)).toEqual(new Set(p.library.map((r) => r.initiativeKey)));
    expect(p.warnings.some((w) => /AI Context: skipped 1 section heading row\(s\) with no ID: Sales Team/.test(w))).toBe(true);
  });

  it('keeps one row per key when two context rows land on a collapsed listing', () => {
    const q = parseWorkbook([
      libSheet([
        lib({ id: 'IN12', name: 'Online Workshops', category: 'A' }),
        lib({ id: 'IN12', name: 'Online Workshops', category: 'B' }),
      ]),
      sheet('3. AI Context', CTX_HEADERS, [
        ['IN12', 'Online Workshops', '', '', '', '', '', '', ''],
        ctx('IN12', 'Online Workshops', 'teaches one result'),
      ]),
    ]);
    expect(q.aiContext).toHaveLength(1);
    expect(q.aiContext[0].whyItWorks).toBe('teaches one result');
    expect(q.warnings.some((w) => /more than one row resolved to online-workshops/.test(w))).toBe(true);
  });
});

describe('old layout is unchanged', () => {
  it('fills the new fields as empty and leaves the old ones alone', () => {
    const p = parseWorkbook([sheet('1. Initiative Library',
      ['Initiative Category', 'ID', 'Initiative Name', 'Difficulty', 'Speed to Revenue',
        'One-line description', 'Longer Description', 'Do you need a sales team?',
        'Primary product price tier it feeds', 'Own / Ops'],
      [['Small Format', 'IN18', 'Dinners/Lunches', '4', 'Medium', 'Intimate', 'Curated', 'POSSIBLY', 'Mid/High', 'OPS']])]);
    expect(p.library[0]).toMatchObject({
      initiativeKey: 'dinners-lunches', difficulty: 4, speedToResults: 'Medium', needsSalesTeam: 'POSSIBLY',
      priceTier: 'Mid/High', ownOrOps: 'OPS', speedScore: null, scoreTotal: null,
      idealIndustries: [], ctaOptions: [], training: [], metricsRaw: null,
    });
    expect(p.warnings.some((w) => /Initiative Library: (could not find|no column)/.test(w))).toBe(false);
  });

  it('reads an ID-less AI Context positionally and keeps blank-guidance rows', () => {
    const p = parseWorkbook([sheet('3. AI Context', [], [
      ['Webinar', 'When', 'Fit', '$0', 'Assets', 'Why', 'Avoid', 'Seq'],
      ['Email Campaign', '', '', '', '', '', '', ''],
    ])]);
    expect(p.aiContext.map((c) => [c.initiativeKey, c.minBudget])).toEqual([['webinar', '$0'], ['email-campaign', null]]);
    expect(p.warnings.some((w) => /AI Context: 1 of 2/.test(w))).toBe(true);
  });
});
