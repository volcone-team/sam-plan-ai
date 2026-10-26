/**
 * Workbook parser: turns the uploaded sheets into the structured rows that
 * generation reads.
 *
 * The sheets are human spreadsheets, not data files, so this has to cope with:
 *   - ~1000 declared rows where only 8-50 carry content (blank padding)
 *   - category banner rows interleaved with data ("CATEGORY: OTHER PEOPLE'S STAGES")
 *   - mixed units: "15%" in one row, 0.3 in the next, for the same kind of metric
 *   - sheet names that are truncated and inconsistently spaced
 *     ("4. 5 Task Template Sales Calls", "4.35 Task Template Paid Ads")
 *   - a first column that is sometimes the initiative name and sometimes a
 *     section label ("Initial Steps"), so the initiative is taken from the
 *     SHEET NAME and the column is only a fallback
 *
 * Pure: no database, no network. Everything is unit testable.
 */

export interface RawSheet {
  name: string;
  headers?: string[];
  rows?: string[][];
  rowCount?: number;
}

export interface LibraryRow {
  initiativeKey: string; workbookId: string | null; name: string; category: string | null;
  difficulty: number | null; speedToResults: string | null; oneLiner: string | null;
  description: string | null; needsSalesTeam: string | null; priceTier: string | null;
  ownOrOps: string | null; displayOrder: number;
  /*
   * Fields from the Oct 2026 library layout (19 columns, S/C/O/R/E scores).
   * Optional so rows built elsewhere in the old shape still type-check; the
   * parser always fills them (null / [] when the sheet has no such column).
   */
  /** Each 1-5, where 5 is always best. Null when blank or not a whole 1-5. */
  speedScore?: number | null; costScore?: number | null; oddsScore?: number | null;
  revenueScore?: number | null; easeScore?: number | null;
  /** S+C+O+R+E computed here (the sheet's own total is not trusted). Null unless all five are present. */
  scoreTotal?: number | null;
  idealIndustries?: string[]; ctaOptions?: string[]; training?: string[];
  /** The Metrics cell exactly as written, newlines and all. */
  metricsRaw?: string | null;
  /**
   * Set ONLY on a variant listing ("webinar-own"): the key of the initiative
   * it is a variant of ("webinar"). Task templates and benchmarks join by name,
   * so they land on the base key; readers fall back to it (see read.ts).
   * Absent / null on a base listing.
   */
  baseKey?: string | null;
  /**
   * The "Frequency" cell verbatim (trimmed), e.g. "Once, Recurring". Which
   * KINDS the initiative allows; parsed by parseWorkbookKinds
   * (src/lib/intake-v3/workbook-kinds.ts). Null when the column or cell is blank.
   */
  allowedKindsRaw?: string | null;
  /**
   * The "Allowed Frequencies" cell verbatim (trimmed), e.g. "Monthly, Quarterly"
   * or "n/a". Parsed by parseWorkbookFrequencies. Null when blank or absent.
   */
  allowedFrequenciesRaw?: string | null;
  /**
   * The "Start Date" cell verbatim (trimmed), "Yes" / "No": whether the New
   * Initiative form asks for a start date. Parsed by parseWorkbookYesNo
   * (src/lib/intake-v3/workbook-kinds.ts). Null when the column or cell is blank.
   */
  startDateRaw?: string | null;
  /** The "Event Date" cell verbatim (trimmed), "Yes" / "No". Same rules as startDateRaw. */
  eventDateRaw?: string | null;
}

/**
 * Difficulty and text Speed, derived from the S/C/O/R/E scores when the sheet
 * does not author them.
 *
 * The Oct 2026 layout dropped both columns, but eligibility (passesCapacity,
 * HIGH_EFFORT_DIFFICULTY) reads `difficulty`, and the heuristic ranking and the
 * recommendation cards read `speedToResults` as "Fast" / "Medium" / "Slow"
 * (matched by substring in rankHeuristically). Both scales put 5 at the
 * desirable end, so:
 *
 *   difficulty     = 6 - easeScore, clamped to 1-5
 *   speedToResults = speedScore 5|4 -> "Fast", 3 -> "Medium", 2|1 -> "Slow"
 *
 * A value the sheet DOES provide is never overwritten. Pure; the parser output
 * stays a faithful reading of the sheet, and ingest applies this on the way
 * into wb_initiative_library, so the derived values are stored even on a
 * database without migration 040 (which is where the scores themselves live).
 */
export function deriveLegacyFields<T extends Pick<LibraryRow, 'difficulty' | 'speedToResults' | 'speedScore' | 'easeScore'>>(
  row: T
): T {
  let { difficulty, speedToResults } = row;
  const ease = row.easeScore;
  if (difficulty === null && typeof ease === 'number' && Number.isFinite(ease)) {
    difficulty = Math.min(5, Math.max(1, Math.round(6 - ease)));
  }
  const speed = row.speedScore;
  if ((speedToResults === null || speedToResults.trim() === '') && typeof speed === 'number' && speed >= 1 && speed <= 5) {
    speedToResults = speed >= 4 ? 'Fast' : speed >= 3 ? 'Medium' : 'Slow';
  }
  if (difficulty === row.difficulty && speedToResults === row.speedToResults) return row;
  return { ...row, difficulty, speedToResults };
}
export interface BenchmarkRow {
  initiativeKey: string; metric: string; conservative: number | null; moderate: number | null;
  aggressive: number | null; unit: string | null; source: string | null;
  isPlaceholder: boolean; ruleOfThumb: string | null;
}
export interface TaskTemplateRow {
  initiativeKey: string; taskNumber: number | null; name: string; category: string | null;
  leadDays: number; durationHours: number | null; role: string | null;
  dependsOn: number[]; notes: string | null; displayOrder: number;
}
export interface AiContextRow {
  initiativeKey: string; whenToUse: string | null; bestFit: string | null; minBudget: string | null;
  minAssets: string | null; whyItWorks: string | null; whatToAvoid: string | null;
  sequencingNotes: string | null;
}
export interface ParsedWorkbook {
  library: LibraryRow[]; benchmarks: BenchmarkRow[];
  taskTemplates: TaskTemplateRow[]; aiContext: AiContextRow[];
  /** Human-readable problems: unmatched sheets, unparseable rows, empty templates. */
  warnings: string[];
}

/** Join key used across every workbook table. Collapses case, spacing and punctuation. */
export function normalizeKey(name: unknown): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-');
}

const cell = (row: string[] | undefined, i: number): string =>
  i < 0 ? '' : String(row?.[i] ?? '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------------------ *
 * Library columns, located by HEADER NAME
 * ------------------------------------------------------------------ */

/**
 * Which column holds what on the Initiative Library sheet.
 *
 * WHY THIS IS NOT JUST POSITIONS. The library sheet gained a "Cost to Run"
 * column at index 5, which shifted every field after it by one. Read
 * positionally, that stored the one-liner as blank (Cost to Run is empty for
 * every row), the long description as the one-liner, "POSSIBLY" as the price
 * tier and "Mid → High" as Own/Ops — silently, with no parse warning, because
 * every cell still contained *something*.
 *
 * The damage was not cosmetic: `needs_sales_team` feeds the sales-call
 * eligibility filter and `own_or_ops` feeds the platform split, so both were
 * deciding recommendations from the wrong column.
 *
 * Resolving by header name means the client can insert, reorder or rename
 * columns without silently corrupting the library again.
 */
export interface LibraryColumns {
  category: number;
  workbookId: number;
  name: number;
  difficulty: number;
  speedToResults: number;
  oneLiner: number;
  description: number;
  needsSalesTeam: number;
  priceTier: number;
  ownOrOps: number;
}

/**
 * The layout BEFORE "Cost to Run" existed.
 *
 * Used per-field when a header cannot be matched, so an older workbook — or one
 * stored without a headers array at all — parses exactly as it used to instead
 * of losing the column entirely.
 */
const LIBRARY_FALLBACK: LibraryColumns = {
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
};

/**
 * Collapse a header for comparison.
 *
 * Real headers carry newlines ("Difficulty \n1 easy - 5 very hard"), trailing
 * question marks and parenthetical notes ("Own / Ops (future)"), none of which
 * are stable enough to match on.
 */
function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?.:]+$/g, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Candidate header names per field, most specific first.
 *
 * ORDER MATTERS between oneLiner and description: both headers end in
 * "description", so a loose contains-match would resolve whichever came first
 * in the sheet. Each is matched on its distinguishing word instead.
 */
const LIBRARY_HEADERS: Record<keyof LibraryColumns, readonly string[]> = {
  category: ['initiative category', 'category'],
  // Exact only: "id" as a substring appears in unrelated words.
  workbookId: ['id', 'initiative id'],
  name: ['initiative name', 'name'],
  difficulty: ['difficulty'],
  speedToResults: ['speed to revenue', 'speed to results', 'speed'],
  oneLiner: ['one line description', 'one liner', 'short description'],
  description: ['longer description', 'long description', 'full description'],
  needsSalesTeam: ['do you need a sales team', 'needs sales team', 'sales team'],
  priceTier: ['primary product price tier it feeds', 'price tier', 'product price tier'],
  ownOrOps: ['own / ops', 'own ops', 'own or ops'],
};

/**
 * First header matching any candidate: exact, then prefix, then substring.
 * Substring is the last resort, and never for very short candidates where it
 * would match almost anything. Columns in `blocked` are never matched.
 */
function findHeader(
  normalized: readonly string[],
  candidates: readonly string[],
  blocked: ReadonlySet<number>
): number {
  for (const candidate of candidates) {
    let found = normalized.findIndex((h, i) => !blocked.has(i) && h === candidate);
    if (found >= 0) return found;
    found = normalized.findIndex((h, i) => !blocked.has(i) && h.startsWith(candidate));
    if (found >= 0) return found;
    if (candidate.length >= 5) {
      found = normalized.findIndex((h, i) => !blocked.has(i) && h.includes(candidate));
      if (found >= 0) return found;
    }
  }
  return -1;
}

/**
 * Columns that only exist in the Oct 2026 library layout. -1 when absent:
 * these have no historical position to fall back to.
 *
 * The new layout is ID, Initiative Name, Category, Training, Metrics,
 * One-line description, Longer Description, Do you need a sales team?,
 * Primary product price tier, Own / Ops (future), Ideal Industries,
 * Call to Action Options, Speed (S), Cost (C), Odds (O), Revenue (R), Ease (E),
 * SCORE total, Weighted SCORE. Difficulty and the text "Speed to ..." are gone.
 * Weighted SCORE is deliberately not read (it is #REF! on every row).
 */
export interface LibraryExtraColumns {
  training: number;
  metrics: number;
  idealIndustries: number;
  ctaOptions: number;
  speedScore: number;
  costScore: number;
  oddsScore: number;
  revenueScore: number;
  easeScore: number;
  /** The sheet's own SCORE total — used only to cross-check the computed sum. */
  sheetScoreTotal: number;
  /**
   * "Frequency": which kinds (Once / Recurring / Evergreen) the initiative
   * allows. Matched by FREQUENCY_HEADER, never by "Allowed Frequencies".
   */
  frequency: number;
  /** "Allowed Frequencies" / "Allowed frequency": the repeat intervals. */
  allowedFrequencies: number;
  /** "Start Date" (Yes / No): whether the form asks for a start date. Exact header only. */
  startDate: number;
  /** "Event Date" (Yes / No): whether the form asks for an event date. Exact header only. */
  eventDate: number;
}

/**
 * The two date-flag headers, compared EXACTLY against the normalised header
 * ("Start Date" -> "start date"). No prefix or substring matching, so no other
 * column ("Start Date Notes", "Event Date Range") can be claimed, and resolved
 * before the looser synonyms so nothing else can claim these.
 */
const START_DATE_HEADER = 'start date';
const EVENT_DATE_HEADER = 'event date';

/**
 * The two frequency headers, on the NORMALISED header. Anchored at the start
 * so "Frequency" can never claim "Allowed Frequencies" (a plain substring or
 * prefix match of "frequenc" would), and both accept singular and plural.
 * Resolved BEFORE anything else, so the looser synonyms of the other fields
 * cannot take these columns either.
 */
const ALLOWED_FREQUENCIES_HEADER = /^allowed frequenc(y|ies)\b/;
const FREQUENCY_HEADER = /^frequenc(y|ies)\b/;

export type ScoreField = 'speedScore' | 'costScore' | 'oddsScore' | 'revenueScore' | 'easeScore';
export const SCORE_FIELDS: readonly ScoreField[] =
  ['speedScore', 'costScore', 'oddsScore', 'revenueScore', 'easeScore'];

/**
 * Score headers are matched on the RAW header ("Speed (S)\n5 = really fast"),
 * because the letter in brackets is what identifies them and normalizeHeader
 * strips parentheticals. This also keeps "Speed (S)" away from the old
 * free-text speedToResults field, whose bare "speed" synonym would otherwise
 * claim it by prefix.
 */
const SCORE_HEADER_PATTERNS: Record<ScoreField, RegExp> = {
  speedScore: /^\s*speed\s*\(\s*s\s*\)/i,
  costScore: /^\s*cost\s*\(\s*c\s*\)/i,
  oddsScore: /^\s*odds\s*\(\s*o\s*\)/i,
  revenueScore: /^\s*revenue\s*\(\s*r\s*\)/i,
  easeScore: /^\s*ease\s*\(\s*e\s*\)/i,
};

const LIBRARY_EXTRA_HEADERS: Record<
  Exclude<keyof LibraryExtraColumns, ScoreField | 'frequency' | 'allowedFrequencies' | 'startDate' | 'eventDate'>,
  readonly string[]
> = {
  training: ['training'],
  metrics: ['metrics'],
  idealIndustries: ['ideal industries'],
  ctaOptions: ['call to action options', 'call to action', 'cta options'],
  sheetScoreTotal: ['score total'],
};

export function resolveLibraryExtraColumns(headers?: readonly string[]): LibraryExtraColumns {
  const raw = (headers ?? []).map((h) => String(h ?? ''));
  const normalized = raw.map(normalizeHeader);
  const taken = new Set<number>();
  const out: LibraryExtraColumns = {
    training: -1, metrics: -1, idealIndustries: -1, ctaOptions: -1,
    speedScore: -1, costScore: -1, oddsScore: -1, revenueScore: -1, easeScore: -1,
    sheetScoreTotal: -1, frequency: -1, allowedFrequencies: -1,
    startDate: -1, eventDate: -1,
  };
  // Optional columns: a workbook without them leaves them at -1 (read as blank).
  const start = normalized.indexOf(START_DATE_HEADER);
  if (start >= 0) { out.startDate = start; taken.add(start); }
  const event = normalized.indexOf(EVENT_DATE_HEADER);
  if (event >= 0) { out.eventDate = event; taken.add(event); }
  const allowed = normalized.findIndex((h) => ALLOWED_FREQUENCIES_HEADER.test(h));
  if (allowed >= 0) { out.allowedFrequencies = allowed; taken.add(allowed); }
  const kinds = normalized.findIndex((h, i) => !taken.has(i) && FREQUENCY_HEADER.test(h));
  if (kinds >= 0) { out.frequency = kinds; taken.add(kinds); }
  for (const field of SCORE_FIELDS) {
    const found = raw.findIndex((h, i) => !taken.has(i) && SCORE_HEADER_PATTERNS[field].test(h));
    if (found >= 0) { out[field] = found; taken.add(found); }
  }
  for (const field of Object.keys(LIBRARY_EXTRA_HEADERS) as (keyof typeof LIBRARY_EXTRA_HEADERS)[]) {
    const found = findHeader(normalized, LIBRARY_EXTRA_HEADERS[field], taken);
    if (found >= 0) { out[field] = found; taken.add(found); }
  }
  return out;
}

/**
 * Map the library sheet's headers onto field positions.
 *
 * Matching is exact first, then prefix, then substring — so "difficulty" finds
 * "Difficulty 1 easy - 5 very hard" by prefix, while "id" only ever matches a
 * cell that IS "id". A field whose header is absent keeps its historical
 * position from LIBRARY_FALLBACK.
 *
 * A column already claimed by an earlier field is not reused, which stops a
 * loose synonym ("name", "category") from stealing a column that a more
 * specific header already matched.
 *
 * Columns that belong to the new-layout fields (resolveLibraryExtraColumns) are
 * off limits, both for matching and as a fallback. In the Oct 2026 layout
 * Difficulty and Speed-to-results no longer exist, and their historical
 * positions (3, 4) now hold Training and Metrics; those fields resolve to -1
 * (read as blank) instead of reading the wrong column.
 *
 * The optional "Frequency" and "Allowed Frequencies" columns are located the
 * same way, by header only, in resolveLibraryExtraColumns; they are reserved
 * here like the other new-layout columns, so no older field can claim them.
 */
export function resolveLibraryColumns(headers?: readonly string[]): LibraryColumns {
  const normalized = (headers ?? []).map(normalizeHeader);
  const resolved = { ...LIBRARY_FALLBACK };
  const extras = resolveLibraryExtraColumns(headers);
  const reserved = new Set(Object.values(extras).filter((i) => i >= 0));
  const blocked = new Set<number>(reserved);

  // Deterministic order: the declaration order of LIBRARY_HEADERS, which runs
  // most-specific-header first within each field.
  for (const field of Object.keys(LIBRARY_HEADERS) as (keyof LibraryColumns)[]) {
    const found = findHeader(normalized, LIBRARY_HEADERS[field], blocked);
    if (found >= 0) {
      resolved[field] = found;
      blocked.add(found);
    } else if (reserved.has(resolved[field])) {
      resolved[field] = -1;
    }
  }

  return resolved;
}

/* ------------------------------------------------------------------ *
 * AI Context columns, located by HEADER NAME
 * ------------------------------------------------------------------ */

/**
 * The AI Context sheet gained a leading ID column and lost "Min. budget" in the
 * Oct 2026 workbook, so positional reading would key every row by its ID
 * ("in03") and shift every guidance field by one. -1 means "not on this sheet".
 */
export interface AiContextColumns {
  workbookId: number;
  initiative: number;
  whenToUse: number;
  bestFit: number;
  minBudget: number;
  minAssets: number;
  whyItWorks: number;
  whatToAvoid: number;
  sequencingNotes: number;
}

/** The historical, ID-less layout. */
const AI_CONTEXT_FALLBACK: AiContextColumns = {
  workbookId: -1, initiative: 0, whenToUse: 1, bestFit: 2, minBudget: 3,
  minAssets: 4, whyItWorks: 5, whatToAvoid: 6, sequencingNotes: 7,
};

const AI_CONTEXT_HEADERS: Record<keyof AiContextColumns, readonly string[]> = {
  workbookId: ['id', 'initiative id'],
  initiative: ['initiative', 'initiative name'],
  whenToUse: ['when to recommend', 'when to use'],
  bestFit: ['best fit'],
  minBudget: ['min budget', 'minimum budget'],
  minAssets: ['min assets', 'minimum assets'],
  whyItWorks: ['why it works'],
  whatToAvoid: ['what to avoid'],
  sequencingNotes: ['sequencing notes', 'sequencing'],
};

/**
 * Same matching rules as the library. A field with no header keeps its
 * historical position only if no matched field already owns that column —
 * otherwise it is absent (-1). The ID column is never guessed positionally.
 * With no headers at all, the historical layout is used unchanged.
 */
export function resolveAiContextColumns(headers?: readonly string[]): AiContextColumns {
  if (!headers || headers.length === 0) return { ...AI_CONTEXT_FALLBACK };
  const normalized = headers.map(normalizeHeader);
  const taken = new Set<number>();
  const matched: Partial<AiContextColumns> = {};
  const fields = Object.keys(AI_CONTEXT_HEADERS) as (keyof AiContextColumns)[];
  for (const field of fields) {
    const found = field === 'workbookId'
      // Exact only: a prefix "id" could match an unrelated header.
      ? normalized.findIndex((h, i) => !taken.has(i) && AI_CONTEXT_HEADERS.workbookId.includes(h))
      : findHeader(normalized, AI_CONTEXT_HEADERS[field], taken);
    if (found >= 0) { matched[field] = found; taken.add(found); }
  }
  const out = { ...AI_CONTEXT_FALLBACK };
  for (const field of fields) {
    const m = matched[field];
    if (m !== undefined) out[field] = m;
    else if (out[field] >= 0 && taken.has(out[field])) out[field] = -1;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Cell helpers for the new library fields
 * ------------------------------------------------------------------ */

/** Split a list cell ("A, B; C") into trimmed, non-empty items. */
export function splitList(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/[,;\n]/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/**
 * A 1-5 score. Whole numbers only ("4", 4, "4.0"); anything else — blank,
 * out of range, fractional, text, "#REF!" — is null with the reason.
 */
export function parseScore(raw: unknown): { value: number | null; problem: string | null } {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: null, problem: 'blank' };
  if (!/^\d+(\.0+)?$/.test(s)) return { value: null, problem: `"${s}" is not a whole number` };
  const n = Number(s);
  if (n < 1 || n > 5) return { value: null, problem: `${n} is outside 1-5` };
  return { value: n, problem: null };
}

/** Indices of the non-blank cells in a row. */
const filledCells = (row: string[]): number[] =>
  row.reduce<number[]>((acc, c, i) => (String(c ?? '').trim() !== '' ? [...acc, i] : acc), []);

const orNull = (v: string): string | null => (v === '' ? null : v);

const isBlankRow = (row: string[]): boolean =>
  !row || row.every((c) => String(c ?? '').trim() === '');

/** Rows that carry content. The sheets are padded to ~1000 rows. */
export function contentRows(sheet: RawSheet): string[][] {
  return (sheet.rows || []).filter((r) => !isBlankRow(r));
}

/**
 * "CATEGORY: OTHER PEOPLE'S STAGES - OPS" style banner rows: one non-blank
 * cell, starting "CATEGORY:". The old layout put the banner in column 0; the
 * Oct 2026 layout puts it in column 1 (Initiative Name), so any column counts.
 * Returns the banner text without the prefix, or null.
 */
function categoryBanner(row: string[]): string | null {
  const filled = filledCells(row);
  if (filled.length !== 1) return null;
  const text = cell(row, filled[0]);
  return /^category\s*:/i.test(text) ? text.replace(/^category\s*:\s*/i, '') : null;
}

/**
 * Numbers arrive as "15%", "0.3", "$1,200" or "". Percentages are returned as
 * FRACTIONS so Conservative/Moderate/Aggressive are directly comparable: "15%"
 * and 0.15 both become 0.15. A bare value > 1 with a % unit is treated as a
 * percentage too ("25" meaning 25%).
 */
export function parseNumeric(raw: unknown, unitHint?: string): number | null {
  const s = String(raw ?? '').trim();
  if (s === '') return null;
  const hadPercent = s.includes('%');
  const cleaned = s.replace(/[%$,\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  const isPct = hadPercent || /%/.test(unitHint || '');
  if (isPct && Math.abs(n) > 1) return n / 100;
  return n;
}

/**
 * Plausibility ceilings. Spreadsheet cells get mistyped and, worse, silently
 * date-formatted: one Duration cell in the real workbook held 46025, an Excel
 * date serial, which overflows `tasks.estimated_hours NUMERIC(6,2)` and failed
 * the whole generation with "numeric field overflow". Values beyond these bounds
 * are treated as unusable rather than clamped, because clamping 46025 to 9999.99
 * would just store a different wrong number.
 */
const MAX_TASK_HOURS = 200;   // a single task beyond ~5 weeks of work is not a task
const MAX_LEAD_DAYS = 365;    // a lead time beyond a year is not a lead time

/** "1", "1, 2", "1 & 3", "n/a" -> [1], [1,2], [1,3], [] */
export function parseDependsOn(raw: unknown): number[] {
  const s = String(raw ?? '');
  const out: number[] = [];
  for (const m of s.matchAll(/\d+/g)) {
    const n = Number(m[0]);
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * Initiative name for a task-template sheet.
 *
 * The SHEET NAME is unreliable: Excel truncates tab names to 31 characters, so
 * the stored workbook contains "4.2 Task Template Email Campaig" and
 * "4.4 Task Template VSL  Sales Pa". Deriving keys from those produced
 * `email-campaig` and `vsl-sales-pa`, which match nothing in the library.
 *
 * Column 0 holds the full initiative name on most rows, but on some sheets it
 * also carries section labels ("Initial Steps", "For opt-in Campaigns: ..."),
 * so we take the MOST FREQUENT column-0 value rather than the first. Genuine
 * initiative names repeat down the sheet; section labels appear once or twice.
 * The truncated sheet name is the last resort.
 */
export function templateInitiativeName(sheetName: string, rows: string[][] = []): string {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const v = cell(row, 0);
    // Section labels tend to be long sentences; initiative names are short.
    if (!v || v.length > 40 || /^initiative$/i.test(v)) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = ''; let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  if (best && bestN >= 2) return best;

  const m = /task\s*template\s*(.*)$/i.exec(sheetName);
  const tail = (m?.[1] || '').replace(/[-–]/g, ' ').replace(/\s+/g, ' ').trim();
  return best || tail || sheetName.trim();
}

/**
 * Library and template sheets name the same initiative differently
 * ("Live Webinar" vs "Webinar", "Hybrid Events" vs "Hybrid Event"). Aliases map
 * template/benchmark keys onto the library key so the four sheets join.
 * Anything still unmatched is reported as a warning rather than dropped silently.
 */
const KEY_ALIASES: Record<string, string> = {
  // template/benchmark name -> library name
  'live-webinar': 'webinar',
  'hybrid-event': 'hybrid-events',
  /*
   * The library row is "Dinners/Lunches" -> `dinners-lunches`, but the task
   * template sheet is "5.7 Task Template Dinners" -> `dinners`. The old alias
   * mapped `dinner` onto `dinners`, which is not a library key either, so the
   * template never joined and Dinners generated a plan with ZERO tasks. Both
   * spellings now point at the row that actually exists.
   */
  'dinner': 'dinners-lunches',
  'dinners': 'dinners-lunches',
  'dinners-lunches': 'dinners-lunches',
  'other-peoples-stages-ops': 'ops-in-person-other-peoples-stages',
  'sales-call': 'sales-calls',
  'direct-message': 'direct-message-reach-out',
  'evergreen-webinar': 'evergreen-webinars',
  'own-event': 'your-own-event',
  'your-own-in-person-event': 'your-own-event',
  'affiliate-launch': 'affiliate-launches',
  'opt-in-funnels': 'funnels',
};

/** Canonical join key: normalised, then alias-resolved. */
export function canonicalKey(name: unknown): string {
  const k = normalizeKey(name);
  return KEY_ALIASES[k] || k;
}

const findSheet = (sheets: RawSheet[], re: RegExp) => sheets.find((s) => re.test(s.name));

/* ------------------------------------------------------------------ *
 * Initiative Library sheet
 * ------------------------------------------------------------------ */

/**
 * One library LISTING (before identical duplicates collapse), kept so AI
 * Context rows — which mirror the library row for row, banners included — can
 * be attached to the key their listing ended up with.
 */
interface LibraryLink {
  key: string;
  baseKey: string;
  workbookId: string | null;
  banner: string | null;
}

const SCORE_LABEL: Record<ScoreField, string> = {
  speedScore: 'Speed', costScore: 'Cost', oddsScore: 'Odds', revenueScore: 'Revenue', easeScore: 'Ease',
};

/** Everything that describes the initiative except where it is listed. */
function rowSignature(r: LibraryRow): string {
  return JSON.stringify([
    r.workbookId, r.name, r.difficulty, r.speedToResults, r.oneLiner, r.description,
    r.needsSalesTeam, r.priceTier, r.ownOrOps, r.speedScore, r.costScore, r.oddsScore,
    r.revenueScore, r.easeScore, r.idealIndustries, r.ctaOptions, r.training, r.metricsRaw,
  ]);
}

const describeRow = (r: LibraryRow): string =>
  `${r.workbookId ?? 'no ID'}, ${r.ownOrOps ?? 'no Own/Ops'}, ${r.category ?? 'no category'}`;

/**
 * Key for a second (third, ...) listing of an initiative whose base key is
 * already held by its first listing.
 *
 * Suffixed with the first field that tells the two apart — Own/Ops, then
 * category, then ID, then combinations — so the key says what the variant is
 * ("webinar-own") and depends only on the row's content, never its position.
 * A counter is the last resort, for listings that differ only in detail text,
 * and is the one case that is order-dependent; it is called out in the reason.
 */
function variantKey(
  row: LibraryRow,
  canonical: LibraryRow,
  baseKey: string,
  used: ReadonlySet<string>
): { key: string; reason: string } {
  const own = normalizeKey(row.ownOrOps);
  const cat = normalizeKey(row.category);
  const id = normalizeKey(row.workbookId);
  const candidates: Array<[string, string]> = [];
  if (own && own !== normalizeKey(canonical.ownOrOps)) candidates.push(['Own/Ops', own]);
  if (cat && cat !== normalizeKey(canonical.category)) candidates.push(['category', cat]);
  if (id && id !== normalizeKey(canonical.workbookId)) candidates.push(['ID', id]);
  if (own && cat) candidates.push(['Own/Ops + category', `${own}-${cat}`]);
  if (cat && id) candidates.push(['category + ID', `${cat}-${id}`]);
  for (const [reason, suffix] of candidates) {
    const key = `${baseKey}-${suffix}`;
    if (!used.has(key)) return { key, reason };
  }
  for (let n = 2; ; n++) {
    const key = `${baseKey}-${n}`;
    if (!used.has(key)) return { key, reason: 'listing order — nothing else distinguishes it' };
  }
}

function parseLibrarySheet(
  lib: RawSheet,
  warnings: string[]
): { library: LibraryRow[]; links: LibraryLink[] } {
  /**
   * Columns by HEADER NAME, not position — see resolveLibraryColumns. The
   * sheet gained a "Cost to Run" column which shifted five fields by one and
   * corrupted the library silently.
   */
  const col = resolveLibraryColumns(lib.headers);
  const extra = resolveLibraryExtraColumns(lib.headers);
  const hasScores = SCORE_FIELDS.some((f) => extra[f] >= 0);

  // Say so when the sheet does not look like the library at all, rather than
  // parsing 22 rows of nothing from fallback positions.
  if ((lib.headers?.length ?? 0) > 0) {
    const fields = Object.keys(LIBRARY_HEADERS) as (keyof LibraryColumns)[];
    const unmatched = fields.filter((field) => col[field] >= 0 && !lib.headers?.[col[field]]);
    if (unmatched.length > 0) {
      warnings.push(
        `Initiative Library: could not find a header for ${unmatched.join(', ')} — ` +
        `read from the historical column position instead. Headers seen: ` +
        `${(lib.headers ?? []).join(' | ')}`
      );
    }
    // The scored layout dropped Difficulty and the text Speed on purpose.
    const absent = fields.filter((field) =>
      col[field] < 0 && !(hasScores && (field === 'difficulty' || field === 'speedToResults')));
    if (absent.length > 0) {
      warnings.push(
        `Initiative Library: no column for ${absent.join(', ')} (its historical position ` +
        `now holds a different column), so it is left blank.`
      );
    }
  }

  const raw = (row: string[], i: number): string => (i < 0 ? '' : String(row[i] ?? ''));

  // ---- 1. Rows ----
  const listed: Array<{ row: LibraryRow; banner: string | null }> = [];
  let banner: string | null = null;
  let order = 0;
  for (const row of contentRows(lib)) {
    const bannerText = categoryBanner(row);
    if (bannerText !== null) { banner = bannerText; continue; }

    const name = cell(row, col.name);
    const id = cell(row, col.workbookId);
    if (!name) {                                 // header repeats / stray rows
      if (id) warnings.push(`Initiative Library: row with ID ${id} has no initiative name — skipped.`);
      continue;
    }
    if (/^initiative\s*name$/i.test(name)) continue;

    // "Sales Team", "DIGITAL MARKETING": a label in the name column and
    // nothing else. A section heading, not an initiative.
    const filled = filledCells(row);
    if (!id && filled.length === 1 && filled[0] === col.name) {
      warnings.push(
        `Initiative Library: "${name}" has no ID and no other data — treated as a section heading, not an initiative.`
      );
      banner = name;
      continue;
    }

    const difficulty = parseNumeric(cell(row, col.difficulty));
    if (difficulty !== null && (difficulty < 1 || difficulty > 5)) {
      warnings.push(`Library "${name}": difficulty ${difficulty} outside 1-5, stored as null.`);
    }

    const scores: Record<ScoreField, number | null> = {
      speedScore: null, costScore: null, oddsScore: null, revenueScore: null, easeScore: null,
    };
    const problems: string[] = [];
    for (const f of SCORE_FIELDS) {
      if (extra[f] < 0) continue;
      const { value, problem } = parseScore(cell(row, extra[f]));
      scores[f] = value;
      if (problem) problems.push(`${SCORE_LABEL[f]} ${problem}`);
    }
    if (problems.length > 0) {
      warnings.push(`Library "${name}" (${id || 'no ID'}): ${problems.join('; ')} — stored as null.`);
    }

    // The sheet's SCORE total is not stored; it is recomputed so one stale
    // formula cannot disagree with the five scores it is meant to sum.
    const present = SCORE_FIELDS.map((f) => scores[f]).filter((v): v is number => v !== null);
    const scoreTotal = present.length === SCORE_FIELDS.length ? present.reduce((a, b) => a + b, 0) : null;
    if (scoreTotal !== null && extra.sheetScoreTotal >= 0) {
      const sheetTotal = parseNumeric(cell(row, extra.sheetScoreTotal));
      if (sheetTotal !== null && sheetTotal !== scoreTotal) {
        warnings.push(
          `Library "${name}" (${id || 'no ID'}): sheet SCORE total ${sheetTotal} does not match ` +
          `S+C+O+R+E = ${scoreTotal}; using ${scoreTotal}.`
        );
      }
    }

    const metrics = raw(row, extra.metrics);
    listed.push({
      banner,
      row: {
        initiativeKey: canonicalKey(name),
        workbookId: orNull(id),
        name,
        category: orNull(cell(row, col.category)) || banner,
        difficulty: difficulty !== null && difficulty >= 1 && difficulty <= 5 ? Math.round(difficulty) : null,
        speedToResults: orNull(cell(row, col.speedToResults)),
        oneLiner: orNull(cell(row, col.oneLiner)),
        description: orNull(cell(row, col.description)),
        needsSalesTeam: orNull(cell(row, col.needsSalesTeam)),
        priceTier: orNull(cell(row, col.priceTier)),
        ownOrOps: orNull(cell(row, col.ownOrOps)),
        displayOrder: order++,
        ...scores,
        scoreTotal,
        idealIndustries: splitList(raw(row, extra.idealIndustries)),
        ctaOptions: splitList(raw(row, extra.ctaOptions)),
        training: splitList(raw(row, extra.training)),
        // Verbatim: structuring the metrics is a separate step.
        metricsRaw: metrics.trim() === '' ? null : metrics,
        // Verbatim but trimmed (newlines kept: they may separate items).
        // Parsed later by src/lib/intake-v3/workbook-kinds.ts.
        allowedKindsRaw: orNull(raw(row, extra.frequency).trim()),
        allowedFrequenciesRaw: orNull(raw(row, extra.allowedFrequencies).trim()),
        // Yes / No, parsed later by parseWorkbookYesNo.
        startDateRaw: orNull(raw(row, extra.startDate).trim()),
        eventDateRaw: orNull(raw(row, extra.eventDate).trim()),
      },
    });
  }
  if (listed.length === 0) warnings.push('Initiative Library parsed to zero rows.');

  // ---- 2. Identical listings collapse ----
  // The same initiative is sometimes repeated, word for word, under a second
  // category banner. initiative_key is unique in the database, so those
  // collapse onto the first listing, as they always have.
  const kept: Array<{ row: LibraryRow; baseKey: string }> = [];
  const keptIndexOf: number[] = [];
  const bySignature = new Map<string, number>();
  let dupes = 0;
  for (const { row } of listed) {
    const baseKey = row.initiativeKey;
    const sig = `${baseKey}\u0000${rowSignature(row)}`;
    const existing = bySignature.get(sig);
    if (existing !== undefined) {
      dupes++;
      keptIndexOf.push(existing);
      // The frequency cells are deliberately NOT in the signature (adding them
      // could split a collapsed pair into a new variant key). Say so when the
      // dropped listing disagrees, rather than losing its value silently.
      const first = kept[existing].row;
      if ((first.allowedKindsRaw ?? null) !== (row.allowedKindsRaw ?? null) ||
          (first.allowedFrequenciesRaw ?? null) !== (row.allowedFrequenciesRaw ?? null)) {
        warnings.push(
          `Initiative Library: "${row.name}" is listed twice with different Frequency / Allowed ` +
          `Frequencies cells; the first listing's ("${first.allowedKindsRaw ?? ''}" / ` +
          `"${first.allowedFrequenciesRaw ?? ''}") is kept.`
        );
      }
      if ((first.startDateRaw ?? null) !== (row.startDateRaw ?? null) ||
          (first.eventDateRaw ?? null) !== (row.eventDateRaw ?? null)) {
        warnings.push(
          `Initiative Library: "${row.name}" is listed twice with different Start Date / Event ` +
          `Date cells; the first listing's ("${first.startDateRaw ?? ''}" / ` +
          `"${first.eventDateRaw ?? ''}") is kept.`
        );
      }
      continue;
    }
    bySignature.set(sig, kept.length);
    keptIndexOf.push(kept.length);
    kept.push({ row, baseKey });
  }
  if (dupes > 0) warnings.push(`Initiative Library: collapsed ${dupes} duplicate rows (same initiative listed under multiple categories).`);

  // ---- 3. Distinct listings sharing a key get their own ----
  // e.g. "Live Webinar" as OPS (guest speaking) and as OWN (hosting). The first
  // listing keeps the base key — exactly what the parser has always produced,
  // so admin toggles and existing links stay attached — and later ones are
  // suffixed. Every base key is reserved up front, so a suffix can never take
  // a key that a later, differently-named initiative needs.
  const used = new Set(kept.map((k) => k.baseKey));
  const canonicalByBase = new Map<string, LibraryRow>();
  const variantNotes = new Map<string, string[]>();
  for (const k of kept) {
    const canonical = canonicalByBase.get(k.baseKey);
    if (!canonical) { canonicalByBase.set(k.baseKey, k.row); continue; }
    const { key, reason } = variantKey(k.row, canonical, k.baseKey, used);
    used.add(key);
    k.row.initiativeKey = key;
    k.row.baseKey = k.baseKey;
    const notes = variantNotes.get(k.baseKey) ?? [];
    notes.push(`(${describeRow(k.row)}) → "${key}" [by ${reason}]`);
    variantNotes.set(k.baseKey, notes);
  }
  for (const [baseKey, notes] of variantNotes) {
    const canonical = canonicalByBase.get(baseKey);
    if (!canonical) continue;
    warnings.push(
      `Initiative Library: "${canonical.name}" is listed ${notes.length + 1} times with different details. ` +
      `The first listing (${describeRow(canonical)}) keeps "${baseKey}"; ${notes.join('; ')}.`
    );
  }

  // ---- 4. One ID, several different initiatives ----
  const byId = new Map<string, LibraryRow[]>();
  for (const { row } of kept) {
    if (!row.workbookId) continue;
    byId.set(row.workbookId, [...(byId.get(row.workbookId) ?? []), row]);
  }
  for (const [id, rows] of byId) {
    if (new Set(rows.map((r) => canonicalKey(r.name))).size < 2) continue;
    warnings.push(
      `Initiative Library: ID ${id} is shared by ${rows.length} different listings — ` +
      `${rows.map((r) => `"${r.name}" → "${r.initiativeKey}"`).join(', ')}. ` +
      `Each keeps its own key; workbook ID stays ${id} on all of them.`
    );
  }

  const links = listed.map(({ row, banner: listedBanner }, i) => ({
    key: kept[keptIndexOf[i]].row.initiativeKey,
    baseKey: canonicalKey(row.name),
    workbookId: row.workbookId,
    banner: listedBanner,
  }));

  return { library: kept.map((k) => k.row), links };
}

/* ------------------------------------------------------------------ *
 * AI Context sheet
 * ------------------------------------------------------------------ */

const hasGuidance = (r: AiContextRow): boolean =>
  [r.whenToUse, r.bestFit, r.minBudget, r.minAssets, r.whyItWorks, r.whatToAvoid, r.sequencingNotes]
    .some(Boolean);

/**
 * The library key an AI Context row belongs to.
 *
 * Same derivation as the library: the name's base key. When the library has
 * several listings for that name (OPS and OWN variants), the row's ID narrows
 * the choice, then the category banner it sits under, then the first listing
 * not yet claimed — the two sheets list initiatives in the same order, so the
 * Nth "Live Webinar" context row belongs to the Nth "Live Webinar" listing.
 * A name with no library listing keeps its base key, as it always has.
 */
function linkContextKey(
  links: readonly LibraryLink[],
  claimed: Set<number>,
  baseKey: string,
  workbookId: string,
  banner: string | null
): string {
  const byName = links.map((_, i) => i).filter((i) => links[i].baseKey === baseKey);
  if (byName.length === 0) return baseKey;
  const id = workbookId.toUpperCase();
  const byId = id ? byName.filter((i) => (links[i].workbookId ?? '').toUpperCase() === id) : [];
  const pool = byId.length > 0 ? byId : byName;
  const free = pool.filter((i) => !claimed.has(i));
  const bannerKey = normalizeKey(banner);
  const pick = free.find((i) => normalizeKey(links[i].banner) === bannerKey) ?? free[0] ?? pool[0];
  claimed.add(pick);
  return links[pick].key;
}

function parseAiContextSheet(
  ctx: RawSheet,
  links: readonly LibraryLink[],
  warnings: string[]
): AiContextRow[] {
  const col = resolveAiContextColumns(ctx.headers);
  const hasIdColumn = col.workbookId >= 0;
  const claimed = new Set<number>();
  const rows: AiContextRow[] = [];
  const headings: string[] = [];
  let banner: string | null = null;

  for (const row of contentRows(ctx)) {
    const bannerText = categoryBanner(row);
    if (bannerText !== null) { banner = bannerText; continue; }
    const initiative = cell(row, col.initiative);
    if (!initiative || /^initiative$/i.test(initiative)) continue;
    const id = hasIdColumn ? cell(row, col.workbookId) : '';

    // Only a sheet WITH an ID column can tell a section heading from an
    // initiative whose guidance is simply blank.
    const filled = filledCells(row);
    if (hasIdColumn && !id && filled.length === 1 && filled[0] === col.initiative) {
      headings.push(initiative);
      banner = initiative;
      continue;
    }

    rows.push({
      initiativeKey: linkContextKey(links, claimed, canonicalKey(initiative), id, banner),
      whenToUse: orNull(cell(row, col.whenToUse)),
      bestFit: orNull(cell(row, col.bestFit)),
      minBudget: orNull(cell(row, col.minBudget)),
      minAssets: orNull(cell(row, col.minAssets)),
      whyItWorks: orNull(cell(row, col.whyItWorks)),
      whatToAvoid: orNull(cell(row, col.whatToAvoid)),
      sequencingNotes: orNull(cell(row, col.sequencingNotes)),
    });
  }

  if (headings.length > 0) {
    warnings.push(`AI Context: skipped ${headings.length} section heading row(s) with no ID: ${headings.join(', ')}.`);
  }

  // wb_ai_context.initiative_key is UNIQUE: one row per key, preferring the
  // first that actually carries guidance.
  const byKey = new Map<string, AiContextRow>();
  const doubled = new Set<string>();
  for (const r of rows) {
    const prev = byKey.get(r.initiativeKey);
    if (!prev) { byKey.set(r.initiativeKey, r); continue; }
    doubled.add(r.initiativeKey);
    if (!hasGuidance(prev) && hasGuidance(r)) byKey.set(r.initiativeKey, r);
  }
  if (doubled.size > 0) {
    warnings.push(
      `AI Context: more than one row resolved to ${[...doubled].join(', ')} — kept one per initiative ` +
      `(the first with guidance filled in).`
    );
  }
  return [...byKey.values()];
}

export function parseWorkbook(sheets: RawSheet[]): ParsedWorkbook {
  const warnings: string[] = [];
  const out: ParsedWorkbook = { library: [], benchmarks: [], taskTemplates: [], aiContext: [], warnings };
  let libraryLinks: LibraryLink[] = [];

  // ---- Initiative Library ----
  const lib = findSheet(sheets, /initiative\s*library/i);
  if (!lib) warnings.push('No "Initiative Library" sheet found.');
  else {
    const parsedLib = parseLibrarySheet(lib, warnings);
    out.library = parsedLib.library;
    libraryLinks = parsedLib.links;
  }

  // ---- Benchmarks ----
  const bench = findSheet(sheets, /^\d*\.?\s*benchmarks$/i) || findSheet(sheets, /benchmarks/i);
  if (!bench) warnings.push('No "Benchmarks" sheet found.');
  else {
    for (const row of contentRows(bench)) {
      const initiative = cell(row, 0);
      const metric = cell(row, 1);
      if (!initiative || !metric) continue;
      if (/^initiative$/i.test(initiative)) continue;
      const unit = orNull(cell(row, 5));
      const source = orNull(cell(row, 6));
      out.benchmarks.push({
        initiativeKey: canonicalKey(initiative),
        metric,
        conservative: parseNumeric(cell(row, 2), unit || ''),
        moderate: parseNumeric(cell(row, 3), unit || ''),
        aggressive: parseNumeric(cell(row, 4), unit || ''),
        unit,
        source,
        isPlaceholder: /placeholder/i.test(source || ''),
        ruleOfThumb: orNull(cell(row, 7)),
      });
    }
  }

  // ---- Task templates (many sheets) ----
  const templateSheets = sheets.filter((s) => /task\s*template/i.test(s.name));
  if (templateSheets.length === 0) warnings.push('No "Task Template" sheets found.');
  for (const sheet of templateSheets) {
    const rows = contentRows(sheet);
    const name = templateInitiativeName(sheet.name, rows);
    const key = canonicalKey(name);
    let order = 0;
    let added = 0;
    for (const row of rows) {
      const taskName = cell(row, 2);
      if (!taskName) continue;
      if (/^task\s*name$/i.test(taskName)) continue;
      const leadRaw = parseNumeric(cell(row, 4));
      let leadDays = leadRaw === null ? 0 : Math.abs(Math.trunc(leadRaw));
      if (leadDays > MAX_LEAD_DAYS) {
        warnings.push(`"${sheet.name}" task "${taskName}": lead time ${leadDays} exceeds ${MAX_LEAD_DAYS} days - treated as 0. Check the cell is a number of days, not a date.`);
        leadDays = 0;
      }

      const hoursRaw = parseNumeric(cell(row, 5));
      let durationHours = hoursRaw;
      if (hoursRaw !== null && (hoursRaw < 0 || hoursRaw > MAX_TASK_HOURS)) {
        warnings.push(`"${sheet.name}" task "${taskName}": duration ${hoursRaw}h is implausible (limit ${MAX_TASK_HOURS}h) - stored as unknown. A value in the tens of thousands is usually a date-formatted cell.`);
        durationHours = null;
      }

      out.taskTemplates.push({
        initiativeKey: key,
        taskNumber: parseNumeric(cell(row, 1)) ?? null,
        name: taskName,
        category: orNull(cell(row, 3)),
        // Authored as "days before launch", so non-negative. Magnitude guards a
        // stray minus sign, matching resolveLeadDays elsewhere.
        leadDays,
        durationHours,
        role: orNull(cell(row, 6)),
        dependsOn: parseDependsOn(cell(row, 7)),
        notes: orNull(cell(row, 8)),
        displayOrder: order++,
      });
      added++;
    }
    if (added === 0) warnings.push(`Task template "${sheet.name}" parsed to zero tasks.`);
  }

  // ---- AI Context ----
  const ctx = findSheet(sheets, /ai\s*context/i);
  if (!ctx) warnings.push('No "AI Context" sheet found.');
  else {
    out.aiContext = parseAiContextSheet(ctx, libraryLinks, warnings);
    const empty = out.aiContext.filter((r) => !hasGuidance(r)).length;
    if (empty > 0) {
      warnings.push(`AI Context: ${empty} of ${out.aiContext.length} initiatives have no guidance filled in.`);
    }
  }

  // ---- Cross-sheet coverage ----
  const libKeys = new Set(out.library.map((r) => r.initiativeKey));
  const tplKeys = new Set(out.taskTemplates.map((r) => r.initiativeKey));
  const orphanTemplates = [...tplKeys].filter((k) => !libKeys.has(k));
  if (orphanTemplates.length > 0) {
    warnings.push(`Task templates with no matching library entry: ${orphanTemplates.join(', ')}`);
  }
  const noTemplate = [...libKeys].filter((k) => !tplKeys.has(k));
  if (noTemplate.length > 0) {
    warnings.push(`Library initiatives with no task template: ${noTemplate.length} (${noTemplate.slice(0, 6).join(', ')}${noTemplate.length > 6 ? ', ...' : ''})`);
  }

  return out;
}
