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
  String(row?.[i] ?? '').replace(/\s+/g, ' ').trim();

const orNull = (v: string): string | null => (v === '' ? null : v);

const isBlankRow = (row: string[]): boolean =>
  !row || row.every((c) => String(c ?? '').trim() === '');

/** Rows that carry content. The sheets are padded to ~1000 rows. */
export function contentRows(sheet: RawSheet): string[][] {
  return (sheet.rows || []).filter((r) => !isBlankRow(r));
}

/** "CATEGORY: OTHER PEOPLE'S STAGES - OPS" style banner rows. */
function isCategoryBanner(row: string[]): boolean {
  const first = cell(row, 0);
  if (!first) return false;
  const rest = row.slice(1).every((c) => String(c ?? '').trim() === '');
  return rest && /^category\s*:/i.test(first);
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
  'dinner': 'dinners',
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

export function parseWorkbook(sheets: RawSheet[]): ParsedWorkbook {
  const warnings: string[] = [];
  const out: ParsedWorkbook = { library: [], benchmarks: [], taskTemplates: [], aiContext: [], warnings };

  // ---- Initiative Library ----
  const lib = findSheet(sheets, /initiative\s*library/i);
  if (!lib) warnings.push('No "Initiative Library" sheet found.');
  else {
    let category: string | null = null;
    let order = 0;
    for (const row of contentRows(lib)) {
      if (isCategoryBanner(row)) {
        category = cell(row, 0).replace(/^category\s*:\s*/i, '');
        continue;
      }
      const name = cell(row, 2);
      if (!name) continue;                       // header repeats / stray rows
      if (/^initiative\s*name$/i.test(name)) continue;
      const rowCategory = orNull(cell(row, 0)) || category;
      const difficulty = parseNumeric(cell(row, 3));
      if (difficulty !== null && (difficulty < 1 || difficulty > 5)) {
        warnings.push(`Library "${name}": difficulty ${difficulty} outside 1-5, stored as null.`);
      }
      out.library.push({
        initiativeKey: canonicalKey(name),
        workbookId: orNull(cell(row, 1)),
        name,
        category: rowCategory,
        difficulty: difficulty !== null && difficulty >= 1 && difficulty <= 5 ? Math.round(difficulty) : null,
        speedToResults: orNull(cell(row, 4)),
        oneLiner: orNull(cell(row, 5)),
        description: orNull(cell(row, 6)),
        needsSalesTeam: orNull(cell(row, 7)),
        priceTier: orNull(cell(row, 8)),
        ownOrOps: orNull(cell(row, 9)),
        displayOrder: order++,
      });
    }
    if (out.library.length === 0) warnings.push('Initiative Library parsed to zero rows.');

    // The library sheet repeats initiatives under several category banners, so
    // the same initiative appears multiple times. initiative_key is unique in
    // the database, so collapse duplicates here - keeping the first occurrence,
    // which is the one with its category banner - rather than failing on insert.
    const seen = new Set<string>();
    const deduped: LibraryRow[] = [];
    let dupes = 0;
    for (const row of out.library) {
      if (seen.has(row.initiativeKey)) { dupes++; continue; }
      seen.add(row.initiativeKey);
      deduped.push(row);
    }
    if (dupes > 0) warnings.push(`Initiative Library: collapsed ${dupes} duplicate rows (same initiative listed under multiple categories).`);
    out.library = deduped;
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
    let empty = 0;
    for (const row of contentRows(ctx)) {
      const initiative = cell(row, 0);
      if (!initiative || /^initiative$/i.test(initiative)) continue;
      const rec = {
        initiativeKey: canonicalKey(initiative),
        whenToUse: orNull(cell(row, 1)),
        bestFit: orNull(cell(row, 2)),
        minBudget: orNull(cell(row, 3)),
        minAssets: orNull(cell(row, 4)),
        whyItWorks: orNull(cell(row, 5)),
        whatToAvoid: orNull(cell(row, 6)),
        sequencingNotes: orNull(cell(row, 7)),
      };
      const hasAny = [rec.whenToUse, rec.bestFit, rec.minBudget, rec.minAssets,
        rec.whyItWorks, rec.whatToAvoid, rec.sequencingNotes].some(Boolean);
      if (!hasAny) empty++;
      out.aiContext.push(rec);
    }
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
