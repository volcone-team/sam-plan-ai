import { describe, it, expect } from 'vitest';
import {
  parseWorkbook, normalizeKey, canonicalKey, parseNumeric, parseDependsOn,
  templateInitiativeName, contentRows, resolveLibraryColumns, type RawSheet,
} from '@/lib/workbook/parse';

/**
 * The REAL headers from the client's workbook, copied verbatim out of
 * `workbook_data` — newlines, trailing "(future)" and all.
 *
 * "Cost to Run" at index 5 is the column that broke positional parsing: every
 * field after it shifted by one, so the one-liner came out blank (Cost to Run
 * is empty for every row), the long description landed in needs_sales_team,
 * "POSSIBLY" became the price tier and "Mid → High" became Own/Ops.
 */
const REAL_LIBRARY_HEADERS = [
  'Initiative Category',
  'ID',
  'Initiative Name',
  'Difficulty \n1 easy - 5 very hard',
  'Speed to Revenue',
  'Cost to Run',
  'One-line description',
  'Longer Description',
  'Do you need a sales team?',
  'Primary product price tier it feeds',
  'Own / Ops (future)',
  'Training',
];

/** The same sheet before "Cost to Run" was inserted. */
const LEGACY_LIBRARY_HEADERS = [
  'Initiative Category',
  'ID',
  'Initiative Name',
  'Difficulty',
  'Speed to Revenue',
  'One-line description',
  'Longer Description',
  'Do you need a sales team?',
  'Primary product price tier it feeds',
  'Own / Ops',
];

/** Pad a sheet the way the real workbook does: ~1000 rows, most of them blank. */
const padded = (name: string, headers: string[], rows: string[][]): RawSheet => ({
  name, headers, rowCount: 1000,
  rows: [...rows, ...Array.from({ length: 20 }, () => headers.map(() => ''))],
});

describe('normalizeKey / canonicalKey', () => {
  it('collapses case, punctuation and spacing', () => {
    expect(normalizeKey("OPS - In Person (Other People's Stages)"))
      .toBe('ops-in-person-other-peoples-stages');
    expect(normalizeKey('VSL / Sales Page')).toBe('vsl-sales-page');
    expect(normalizeKey('  Content & Organic Social  ')).toBe('content-organic-social');
  });
  it('resolves template names onto library names', () => {
    expect(canonicalKey('Live Webinar')).toBe('webinar');
    expect(canonicalKey('Hybrid Event')).toBe('hybrid-events');
    expect(canonicalKey('Sales Call')).toBe('sales-calls');
    expect(canonicalKey('Evergreen Webinar')).toBe('evergreen-webinars');
  });
  it('leaves an unaliased name as its normalised form', () => {
    expect(canonicalKey('Referral')).toBe('referral');
  });

  /**
   * The Dinners task template sheet is named "Dinners" while the library row is
   * "Dinners/Lunches". The alias used to resolve to `dinners`, which is not a
   * library key either — so the template never joined and a plan containing
   * Dinners was generated with no tasks at all.
   */
  it('joins every spelling of Dinners onto the library row that exists', () => {
    for (const name of ['Dinner', 'Dinners', 'Dinners/Lunches', 'dinners  ']) {
      expect(canonicalKey(name)).toBe('dinners-lunches');
    }
  });
});

describe('parseNumeric', () => {
  it('normalises percentages to fractions', () => {
    expect(parseNumeric('15%')).toBe(0.15);
    expect(parseNumeric('2%')).toBe(0.02);
  });
  it('leaves an existing fraction alone', () => {
    expect(parseNumeric('0.3')).toBe(0.3);   // email open rate is stored this way
    expect(parseNumeric(0.35)).toBe(0.35);
  });
  it('treats a bare number over 1 as a percentage when the unit says %', () => {
    expect(parseNumeric('25', '%')).toBe(0.25);
  });
  it('strips currency and separators', () => {
    expect(parseNumeric('$1,200')).toBe(1200);
  });
  it('returns null for empty or unparseable input', () => {
    expect(parseNumeric('')).toBeNull();
    expect(parseNumeric('n/a')).toBeNull();
    expect(parseNumeric(undefined)).toBeNull();
  });
});

describe('parseDependsOn', () => {
  it('extracts one or many task numbers', () => {
    expect(parseDependsOn('1')).toEqual([1]);
    expect(parseDependsOn('1, 2')).toEqual([1, 2]);
    expect(parseDependsOn('1 & 3')).toEqual([1, 3]);
  });
  it('is empty for blanks and prose', () => {
    expect(parseDependsOn('')).toEqual([]);
    expect(parseDependsOn('n/a')).toEqual([]);
  });
  it('de-duplicates', () => {
    expect(parseDependsOn('2, 2')).toEqual([2]);
  });
});

describe('templateInitiativeName', () => {
  it('prefers the repeated column-0 value over a truncated sheet name', () => {
    // Excel truncates tab names at 31 chars: "Email Campaign" became "Email Campaig".
    const rows = [
      ['Email Campaign', '1', 'Pick the offer', '', '21', '2', '', '', '', ''],
      ['Email Campaign', '2', 'Write emails', '', '14', '4', '', '1', '', ''],
    ];
    expect(templateInitiativeName('4.2 Task Template Email Campaig', rows)).toBe('Email Campaign');
  });
  it('ignores one-off section labels', () => {
    const rows = [
      ['Initial Steps', '', 'Section', '', '', '', '', '', '', ''],
      ['Direct Message', '1', 'Build list', '', '10', '1', '', '', '', ''],
      ['Direct Message', '2', 'Send DMs', '', '5', '1', '', '', '', ''],
    ];
    expect(templateInitiativeName('4.8 Task Template Direct Messag', rows)).toBe('Direct Message');
  });
  it('falls back to the sheet name when column 0 is unusable', () => {
    expect(templateInitiativeName('5.9 Task Template SMS', [])).toBe('SMS');
  });
});

describe('contentRows', () => {
  it('drops the blank padding', () => {
    const sheet = padded('X', ['a', 'b'], [['1', '2']]);
    expect(sheet.rows!.length).toBeGreaterThan(1);
    expect(contentRows(sheet)).toEqual([['1', '2']]);
  });
});

const LIB_HEADERS = ['Initiative Category', 'ID', 'Initiative Name', 'Difficulty', 'Speed to See Results',
  'One-line description', 'Longer Description', 'Do you need a sales team?', 'Primary product price tier it feeds', 'Own / Ops (future)'];

describe('parseWorkbook', () => {
  const sheets: RawSheet[] = [
    padded('1. Initiative Library', LIB_HEADERS, [
      ["CATEGORY: OTHER PEOPLE'S STAGES - OPS", '', '', '', '', '', '', '', '', ''],
      ['', 'IN11', 'Hybrid Events', '5', 'Slow', 'One-liner', 'Longer', 'POSSIBLY', 'High', 'OPS'],
      ['Large Format', 'IN12', 'Webinar', '3', 'Fast', 'Teach then offer', 'Longer', 'NO', 'Mid', 'Own'],
      // Repeated under a second category, as the real sheet does.
      ['Small Format', 'IN12', 'Webinar', '3', 'Fast', 'Teach then offer', 'Longer', 'NO', 'Mid', 'Own'],
    ]),
    padded('2. Benchmarks',
      ['Initiative', 'Input metric', 'Conservative', 'Moderate', 'Aggressive', 'Unit', 'Source (required)', "Pete's rule of thumb"], [
      ['Webinar', 'Registration rate', '15%', '25%', '40%', '%', "PLACEHOLDER — verify w/ Pete's data", 'Warm list converts higher.'],
      ['Email Campaign', 'Open rate', '0.3', '0.35', '0.4', '%', '', ''],
    ]),
    padded('4.1 Task Template Live Webinar',
      ['Initiative', 'Task #', 'Task name', 'Category', 'Lead time (days before launch)', 'Duration (hours)', 'Role', 'Depends on (task #)', "Pete's notes"], [
      ['Webinar', '1', 'Decide the product', 'Build', '35', '3', 'Owner', '', 'Offer first.'],
      ['Webinar', '2', 'Decide pricing', 'Build', '35', '3', 'Owner', '1', 'Price sets expectations.'],
      ['Webinar', '3', 'Promote', 'Promote', '7', '2', 'Owner', '2', ''],
    ]),
    padded('3. AI Context',
      ['Initiative', 'When to recommend it', 'Best-fit audience', 'Min. budget', 'Min. assets needed', 'Why it works', 'What to avoid', 'Sequencing notes'], [
      ['Live Webinar', 'Has a teachable topic', 'Coaches', '$0', 'An offer', 'Builds trust', 'Not for cold', 'Mid-funnel'],
      ['Email Campaign', '', '', '', '', '', '', ''],
    ]),
  ];

  const p = parseWorkbook(sheets);

  it('collapses library duplicates so the unique key holds', () => {
    expect(p.library.map((l) => l.initiativeKey)).toEqual(['hybrid-events', 'webinar']);
    expect(p.warnings.some((w) => /collapsed 1 duplicate/.test(w))).toBe(true);
  });

  it('carries the category banner down onto the rows beneath it', () => {
    expect(p.library[0].category).toBe("OTHER PEOPLE'S STAGES - OPS");
  });

  it('keeps difficulty on the workbook 1-5 scale', () => {
    expect(p.library.find((l) => l.initiativeKey === 'hybrid-events')!.difficulty).toBe(5);
    expect(p.library.find((l) => l.initiativeKey === 'webinar')!.difficulty).toBe(3);
  });

  it('captures Own/Ops', () => {
    expect(p.library[0].ownOrOps).toBe('OPS');
  });

  it('flags placeholder benchmarks and normalises both notations', () => {
    const reg = p.benchmarks.find((b) => b.metric === 'Registration rate')!;
    expect([reg.conservative, reg.moderate, reg.aggressive]).toEqual([0.15, 0.25, 0.4]);
    expect(reg.isPlaceholder).toBe(true);
    const open = p.benchmarks.find((b) => b.metric === 'Open rate')!;
    expect([open.conservative, open.moderate, open.aggressive]).toEqual([0.3, 0.35, 0.4]);
    expect(open.isPlaceholder).toBe(false);
  });

  it('joins the truncated template sheet onto the library key', () => {
    const keys = [...new Set(p.taskTemplates.map((t) => t.initiativeKey))];
    expect(keys).toEqual(['webinar']);
  });

  it('reads authored lead times, durations and dependencies', () => {
    const tasks = p.taskTemplates;
    expect(tasks.map((t) => t.leadDays)).toEqual([35, 35, 7]);
    expect(tasks.map((t) => t.durationHours)).toEqual([3, 3, 2]);
    expect(tasks[1].dependsOn).toEqual([1]);
    expect(tasks[0].dependsOn).toEqual([]);
  });

  it('preserves task order', () => {
    expect(p.taskTemplates.map((t) => t.displayOrder)).toEqual([0, 1, 2]);
  });

  it('aliases AI Context onto the library key and reports empty guidance', () => {
    expect(p.aiContext.map((c) => c.initiativeKey)).toEqual(['webinar', 'email-campaign']);
    expect(p.warnings.some((w) => /AI Context: 1 of 2/.test(w))).toBe(true);
  });

  it('reports library entries that have no task template', () => {
    expect(p.warnings.some((w) => /no task template/.test(w))).toBe(true);
  });

  it('reports missing sheets rather than failing', () => {
    const empty = parseWorkbook([]);
    expect(empty.library).toEqual([]);
    expect(empty.warnings.length).toBeGreaterThanOrEqual(4);
  });
});

describe('resolveLibraryColumns', () => {
  /**
   * THE BUG, stated as a test. Read positionally, oneLiner was index 5 — which
   * is now the always-blank "Cost to Run" — and everything after it was off by
   * one. These are the indices from the client's actual workbook.
   */
  it('finds every field in the real workbook, past the inserted Cost to Run', () => {
    expect(resolveLibraryColumns(REAL_LIBRARY_HEADERS)).toEqual({
      category: 0,
      workbookId: 1,
      name: 2,
      difficulty: 3,
      speedToResults: 4,
      // 5 is Cost to Run, which no field wants.
      oneLiner: 6,
      description: 7,
      needsSalesTeam: 8,
      priceTier: 9,
      ownOrOps: 10,
    });
  });

  it('still reads a workbook from before that column existed', () => {
    expect(resolveLibraryColumns(LEGACY_LIBRARY_HEADERS)).toEqual({
      category: 0,
      workbookId: 1,
      name: 2,
      difficulty: 3,
      speedToResults: 4,
      oneLiner: 5,
      description: 6,
      needsSalesTeam: 7,
      priceTier: 8,
      ownOrOps: 9,
    });
  });

  /** Matches "Difficulty \n1 easy - 5 very hard" by prefix, newline included. */
  it('tolerates newlines, trailing punctuation and parentheticals', () => {
    const cols = resolveLibraryColumns([
      'initiative   category',
      'ID',
      'Initiative\nName',
      'Difficulty \n1 easy - 5 very hard',
      'Speed to Revenue',
      'One-line description',
      'Longer Description',
      'Do you need a sales team?',
      'Price tier',
      'Own / Ops (future)',
    ]);
    expect(cols.difficulty).toBe(3);
    expect(cols.name).toBe(2);
    expect(cols.needsSalesTeam).toBe(7);
    expect(cols.ownOrOps).toBe(9);
  });

  /**
   * Both headers end in "description", so a loose contains-match would resolve
   * whichever appeared first and swap the two fields.
   */
  it('does not confuse the one-liner with the longer description', () => {
    const cols = resolveLibraryColumns(REAL_LIBRARY_HEADERS);
    expect(cols.oneLiner).not.toBe(cols.description);
    expect(REAL_LIBRARY_HEADERS[cols.oneLiner]).toBe('One-line description');
    expect(REAL_LIBRARY_HEADERS[cols.description]).toBe('Longer Description');
  });

  it('survives columns being reordered', () => {
    const cols = resolveLibraryColumns([
      'Initiative Name',
      'Own / Ops (future)',
      'Initiative Category',
      'One-line description',
      'ID',
    ]);
    expect(cols.name).toBe(0);
    expect(cols.ownOrOps).toBe(1);
    expect(cols.category).toBe(2);
    expect(cols.oneLiner).toBe(3);
    expect(cols.workbookId).toBe(4);
  });

  it('falls back to historical positions with no headers at all', () => {
    for (const headers of [undefined, []]) {
      expect(resolveLibraryColumns(headers)).toEqual({
        category: 0, workbookId: 1, name: 2, difficulty: 3, speedToResults: 4,
        oneLiner: 5, description: 6, needsSalesTeam: 7, priceTier: 8, ownOrOps: 9,
      });
    }
  });

  /** No two fields may claim the same column, or one silently shadows another. */
  it('never assigns one column to two fields', () => {
    for (const headers of [REAL_LIBRARY_HEADERS, LEGACY_LIBRARY_HEADERS]) {
      const indices = Object.values(resolveLibraryColumns(headers));
      expect(new Set(indices).size).toBe(indices.length);
    }
  });
});

describe('parseWorkbook — library fields land in the right columns', () => {
  /** One real row from the client's workbook, verbatim. */
  const DINNERS = [
    'Small Format',
    'IN18',
    'Dinners/Lunches',
    '4',
    'Medium',
    '',                                        // Cost to Run — always blank
    'A self-hosted and intimate, in-person event.',
    'This is one of the more curated initiatives.',
    'POSSIBLY',
    'Mid/High',
    'OPS',
    'Dinner course assets',
  ];

  it('reads the real sheet without shifting a single field', () => {
    const parsed = parseWorkbook([
      padded('1. Initiative Library', REAL_LIBRARY_HEADERS, [DINNERS]),
    ]);

    expect(parsed.library).toHaveLength(1);
    const row = parsed.library[0];

    expect(row.initiativeKey).toBe('dinners-lunches');
    expect(row.name).toBe('Dinners/Lunches');
    expect(row.category).toBe('Small Format');
    expect(row.workbookId).toBe('IN18');
    expect(row.difficulty).toBe(4);
    expect(row.speedToResults).toBe('Medium');
    // The four fields the old parser got wrong:
    expect(row.oneLiner).toBe('A self-hosted and intimate, in-person event.');
    expect(row.description).toBe('This is one of the more curated initiatives.');
    expect(row.needsSalesTeam).toBe('POSSIBLY');
    expect(row.priceTier).toBe('Mid/High');
    expect(row.ownOrOps).toBe('OPS');
  });

  /**
   * Regression guard phrased as the symptom that was in production: the
   * one-liner was null and "POSSIBLY" was being stored as a price tier, which
   * is what the sales-call eligibility filter then read.
   */
  it('no longer stores a blank one-liner or POSSIBLY as the price tier', () => {
    const row = parseWorkbook([
      padded('1. Initiative Library', REAL_LIBRARY_HEADERS, [DINNERS]),
    ]).library[0];

    expect(row.oneLiner).not.toBeNull();
    expect(row.priceTier).not.toBe('POSSIBLY');
    expect(row.ownOrOps).not.toBe('Mid/High');
  });

  it('warns when a header cannot be matched instead of silently guessing', () => {
    const parsed = parseWorkbook([
      padded('1. Initiative Library', ['Thing', 'Another', 'Initiative Name'], [
        ['x', 'y', 'Referral'],
      ]),
    ]);
    expect(parsed.warnings.some((w) => /could not find a header/i.test(w))).toBe(true);
    // Still parses what it can — the name header matched.
    expect(parsed.library[0]?.name).toBe('Referral');
  });
});
