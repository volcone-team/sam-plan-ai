import { describe, it, expect } from 'vitest';
import {
  parseWorkbook, normalizeKey, canonicalKey, parseNumeric, parseDependsOn,
  templateInitiativeName, contentRows, type RawSheet,
} from '@/lib/workbook/parse';

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
