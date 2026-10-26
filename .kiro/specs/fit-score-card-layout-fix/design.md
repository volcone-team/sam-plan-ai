# FIT/SCORE Card Layout Fix Bugfix Design

## Overview

The right-hand card in the initiative detail "Why This Initiative" section
(`src/components/initiatives/initiative-why.tsx`) is headed "FIT/SCORE" only,
and its five SCORE bars render in the five-column grid used by the compact
intake recommendation card. The client wants the card headed "Difficulty
Dimensions", with "FIT/SCORE" kept as a small sub-heading beneath it, and the
bars stacked one row per score.

Both cards render the same component, `ScoreBreakdownView` in
`src/components/recommend/score-breakdown.tsx`. The fix adds an opt-in
`layout?: "grid" | "stacked"` prop that defaults to `"grid"`. The detail card
passes `layout="stacked"` and renders the two headings. The recommendation
card passes nothing, so its markup stays byte-for-byte the same.

## Glossary

- **Bug_Condition (C)**: The score card is rendered in the initiative detail
  "Why This Initiative" section (heading is wrong and the bars are in a
  five-column grid).
- **Property (P)**: In the detail card, the heading is "Difficulty Dimensions",
  "FIT/SCORE" sits beneath it as a sub-heading, and the five bars are stacked
  vertically in S, C, O, R, E order, each row showing label, digit value and a
  full-width bar.
- **Preservation**: Everything rendered by the recommendation card, the bar
  accessibility text, theme tokens, the hide-when-no-score rule, and the
  "When to use" card.
- **ScoreBreakdownView**: Component in
  `src/components/recommend/score-breakdown.tsx` that renders the SCORE total,
  provisional badge, the five bars and the footnote.
- **ScoreBar**: Component in the same file that renders one score: a
  label/value row and a five-segment bar, wrapped in `role="img"` with an
  `aria-label` from `barLabel`.
- **layout**: The new prop. `"grid"` is today's behaviour; `"stacked"` is the
  detail card's vertical list.
- **missing**: Letters that were blank in the workbook and counted as 3. Shown
  with "*" after the digit and a dashed bar.

## Bug Details

### Bug Condition

The bug manifests whenever `InitiativeWhy` has score data and renders the
right-hand card. That card hardcodes `<h3>FIT/SCORE</h3>`, and
`ScoreBreakdownView` has only one list layout (`grid grid-cols-5 gap-2`), so
the detail card cannot ask for anything else.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { context: "initiative-detail" | "recommendation-card",
                         score: ScoreBreakdownData | null }
  OUTPUT: boolean

  RETURN input.context = "initiative-detail"
         AND input.score IS NOT NULL
         AND ( cardHeading(input) != "Difficulty Dimensions"
               OR scoreListLayout(input) = "five-column grid" )
END FUNCTION
```

On unfixed code this is true for every initiative detail page that has score
data, and false for every recommendation card render.

### Examples

- Initiative with scores S5 C4 O3 R5 E2, all present. Actual: card heading
  "FIT/SCORE", five bars side by side at one fifth width each. Expected:
  heading "Difficulty Dimensions", sub-heading "FIT/SCORE", SCORE 19, then five
  full-width rows "Speed 5", "Cost 4", "Odds 3", "Revenue 5", "Ease 2".
- Initiative with Odds blank (counted as 3). Actual: cramped grid cell showing
  "3*". Expected: stacked row "Odds" … "3*" with a dashed bar, plus the
  provisional badge and note, as today.
- Intake recommendation card for any initiative. Actual and expected are the
  same: compact five-column grid with rank, total, weighted total, badge and
  footnote. This must not change.
- Edge case: initiative with no score data. The right card is hidden and "When
  to use" takes the full width, before and after the fix.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- The recommendation card (`initiative-recommendation-card.tsx`) renders the
  same HTML as before: same `ul` classes, same `ScoreBar` classes, same rank,
  total, weighted total, provisional badge and footnote (3.1).
- Every bar in both layouts keeps `role="img"`, the `aria-label` built by
  `barLabel(letter, value, missing)` plus the "best" hint, the `title`, and the
  visible digit with "*" when missing (3.2).
- Only theme tokens are used for colour (foreground, foreground-muted,
  primary, background-muted, border, card); the stacked layout adds no
  hardcoded colours (3.3).
- No score data still hides the right card, and the left card takes the full
  width (3.4).
- The detail card still shows the SCORE total, provisional badge and note, and
  `FIT_SCORE_NOTE`, from the same `GET /api/initiatives/[id]/ai-context`
  response. No API or data change (3.5).
- The "When to use" card is untouched (3.6).

**Scope:**
Only the `InitiativeWhy` score card changes. Not affected:
- The intake recommendation card and the recommendations page.
- `score-display.ts`, `score.ts`, `why-score.ts` and the ai-context route.
- Any other caller of `ScoreBreakdownView` or `ScoreBar` that does not pass
  `layout` (the default is `"grid"`).

## Hypothesized Root Cause

This is a direct code defect rather than an intermittent one, so the cause is
known from reading the source:

1. **Hardcoded heading**: `initiative-why.tsx` renders
   `<h3 ...>FIT/SCORE</h3>` as the card's only heading. The recent change
   replaced "Difficulty Dimensions" instead of adding beneath it.
2. **Single list layout**: `ScoreBreakdownView` renders
   `<ul className="grid grid-cols-5 gap-2">` unconditionally. It was built for
   the narrow recommendation card and has no option for a vertical list.
3. **Bar sized for a fifth of the width**: `ScoreBar` uses `text-[11px]` and
   `h-1.5` segments, and `truncate` on the label, all tuned for a narrow grid
   cell. In a full-width row these read as undersized.

There is no data or API cause: the score values, missing letters and
footnote already arrive correctly.

## Correctness Properties

Property 1: Bug Condition - Detail card heading and stacked bars

_For any_ score data rendered in the initiative detail "Why This Initiative"
card (isBugCondition returns true), the fixed code SHALL render
"Difficulty Dimensions" as the card heading, "FIT/SCORE" as a sub-heading
directly beneath it, then the SCORE total, the five bars stacked vertically in
the order Speed, Cost, Odds, Revenue, Ease (one row each: label left, digit
value right, full-width bar beneath), and the footnote; a blank-counted score
SHALL show "*" after its digit and the dashed bar style.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Recommendation card and shared behaviour unchanged

_For any_ render where isBugCondition returns false (the recommendation card,
or any caller that omits `layout`), the fixed code SHALL produce exactly the
same markup as the original code; and for both layouts every bar SHALL keep
`role="img"`, its text `aria-label` and visible digit, theme-token colours,
the hide-when-no-score rule, and the unchanged "When to use" card.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Layout choice for a stacked row

Two options were considered for each stacked row:

| Option | Row | Fits 2.2 ("bar spanning the full width of the row") | Change to ScoreBar |
|---|---|---|---|
| A. Bar beneath | `Label ........ 5` then a full-width bar on the next line | Yes | Sizes only; the structure already is label/value over bar |
| B. Bar between | `Label [=====    ] 5` on one line | No, the label and value take width from the bar | New structure (three-part row, fixed label width) |

**Chosen: A (bar beneath).** It is the only option that satisfies 2.2 as
written. It also reuses the existing `ScoreBar` structure (label/value row
over a segmented bar), so the stacked variant differs only in a few size
classes, and the grid variant needs no structural branch. Option B would need
a fixed label column to keep bars aligned ("Revenue" vs "Odds") and a second
markup shape to maintain.

### Changes Required

**File**: `src/components/recommend/score-breakdown.tsx`

**Function**: `ScoreBreakdownView`, `ScoreBar`

**Specific Changes**:
1. **New prop on `ScoreBreakdownViewProps`**: add
   `layout?: "grid" | "stacked"` with a doc comment ("grid: five columns, for
   narrow cards (default). stacked: one row per score, for a full-width card.").
   Default `layout = "grid"` in the destructuring.
2. **List container**: choose the `ul` class with a ternary over two string
   literals, so the grid branch emits exactly today's string:
   - grid: `"grid grid-cols-5 gap-2"` (unchanged)
   - stacked: `"space-y-3"`
   Keep `aria-label="Score breakdown"` and the `SCORE_LETTERS` order, which is
   already S, C, O, R, E.
3. **Pass layout to `ScoreBar`**: `<ScoreBar ... layout={layout} />`. Add
   `layout?: "grid" | "stacked"` (default `"grid"`) to its props, so any other
   direct caller is unaffected.
4. **`ScoreBar` size classes**, again chosen by ternary over literals so the
   grid branch strings are identical to today:
   - label/value row: grid `"flex items-baseline justify-between gap-1 text-[11px]"`;
     stacked `"flex items-baseline justify-between gap-2 text-xs"`
   - bar segment height: grid `"h-1.5"`; stacked `"h-2"`, passed into the
     existing `cn(...)` call in the same argument position
   - value text stays the digit only (`{value}{missing && "*"}`) in both
     layouts, matching the recommendation card. `role`, `aria-label`, `title`,
     `aria-hidden` and the dashed/filled/empty colour classes are untouched.
5. **Docs**: update the component comment to mention the two layouts.

**File**: `src/components/initiatives/initiative-why.tsx`

**Function**: `InitiativeWhy`

**Specific Changes**:
1. **Headings**: replace the single `<h3>FIT/SCORE</h3>` with:
   - `<h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Difficulty Dimensions</h3>`
     (same style as the "When to use" `h3`, so the two cards match)
   - `<h4 className="mt-1 mb-3 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">FIT/SCORE</h4>`
     (small sub-heading, same treatment as "FIT/SCORE SYSTEM EXPLAINED" on the
     recommendations page; `h4` keeps the heading order h2 → h3 → h4)
2. **Layout**: `<ScoreBreakdownView score={score} note={FIT_SCORE_NOTE} framed={false} layout="stacked" />`.
3. **Docs**: update the component comment ("Right: Difficulty Dimensions, with
   the FIT/SCORE breakdown …").
4. **Unchanged**: the `score &&` guard, the `both` two-column rule, the card
   wrapper classes, `FIT_SCORE_NOTE`, `useWhyData` and the left card.

**File**: `src/components/intake/recommendations/initiative-recommendation-card.tsx`

No change. It passes no `layout`, so it gets `"grid"`.

## Testing Strategy

### Validation Approach

The repository has no DOM test setup: `vitest.config.ts` runs
`environment: "node"` and includes only `src/**/*.test.ts`, and components are
not render-tested (see the note in
`src/services/__tests__/result.service.test.ts`). This fix is presentation
only and adds no new logic worth extracting; the score values, missing
letters, `barLabel` and the footnote come from existing pure modules that
already have tests (`score.test.ts`, `score-display` tests).

Validation therefore relies on:
1. `tsc --noEmit` (the new prop types and both call sites compile).
2. The existing test suite, `npm test -- --run`, passing unchanged.
3. `npm run build` succeeding.
4. A manual browser check of both cards, in light and dark mode.

No new automated tests are planned. This is stated deliberately, not an
omission.

### Exploratory Bug Condition Checking

**Goal**: Confirm the defect on unfixed code before changing it.

**Test Plan**: Open an initiative detail page whose initiative has a workbook
library key with scores, and inspect the "Why This Initiative" right card.

**Test Cases**:
1. **Heading check**: The card heading reads "FIT/SCORE" and there is no
   "Difficulty Dimensions" (fails 2.1 on unfixed code).
2. **Layout check**: The five bars sit side by side, each about one fifth of
   the card width (fails 2.2 on unfixed code).
3. **Blank score check**: For an initiative with a blank score, the "3*" and
   dashed bar are squeezed into a grid cell (fails 2.3's stacked requirement).

**Expected Counterexamples**:
- Any scored initiative shows the wrong heading and the grid layout. The
  cause is confirmed by source: the hardcoded `h3` and the unconditional
  `grid grid-cols-5` class.

### Fix Checking

**Goal**: For every detail-card render, the fixed card shows the headings and
stacked rows.

**Pseudocode:**
```
FOR ALL score WHERE isBugCondition({ context: "initiative-detail", score }) DO
  card := render InitiativeWhy with score
  ASSERT card.h3 = "Difficulty Dimensions"
  ASSERT card.h4 = "FIT/SCORE" AND h4 follows h3
  ASSERT rows(card) = [Speed, Cost, Odds, Revenue, Ease], one per line
  ASSERT each row: label left, digit (+ "*" if missing) right, bar full width beneath
  ASSERT missing rows use the dashed bar
END FOR
```

Checked manually in the browser on: one fully scored initiative and one with
at least one blank score.

### Preservation Checking

**Goal**: For every render outside the bug condition, output is unchanged.

**Pseudocode:**
```
FOR ALL render WHERE NOT isBugCondition(render) DO
  ASSERT ScoreBreakdownView_original(render) = ScoreBreakdownView_fixed(render)
END FOR
```

**Testing Approach**: Property-based testing would suit this (generate random
`ScoreBreakdownData` and compare original vs fixed markup), but it needs a
renderer the test setup does not include, so it is not used here. Preservation
is instead guaranteed by construction and checked by review:
- `layout` defaults to `"grid"`.
- Every grid-branch class string is the original literal, selected by a
  ternary, so the grid output is identical character for character.
- The recommendation card's call site is not edited.

**Test Cases** (manual, observe before and after the fix):
1. **Recommendation card**: On `/intake/recommendations`, the SCORE block is
   the same five-column grid with rank, total, weighted total (when the
   Revenue weight is not 1), provisional badge and footnote.
2. **Accessibility**: In both cards, a screen reader or the accessibility
   inspector reads each bar as e.g. "Speed 5 of 5. …"; the digit is visible.
3. **Dark mode**: Both cards read correctly in dark mode.
4. **No score**: An initiative without score data shows only "When to use" at
   full width.
5. **Left card**: "When to use" text, clamping and Show more/less are
   unchanged.

### Unit Tests

- No new unit tests: the change adds no pure logic. The existing tests for
  `score.ts` and `score-display.ts` (values, `barLabel`, `provisionalNote`,
  `formatTotal`) must keep passing.

### Property-Based Tests

- None added. The properties above are verified by type checking, by the
  literal-preserving construction of the grid branch, and by the manual
  checks. Adding a markup-comparison property test would first require a
  render setup (for example `react-dom/server` in a `.test.tsx` file, which
  the current `include` pattern excludes); that is out of scope for this fix.

### Integration Tests

- `tsc --noEmit`, `npm test -- --run` and `npm run build`
  (with `NODE_OPTIONS=--max-old-space-size=8192`) all pass.
- Manual: initiative detail page, fully scored and partially scored
  initiatives, at desktop width (two-column section) and mobile width (single
  column), light and dark mode.
- Manual: intake recommendations page, compare the SCORE block against the
  pre-fix screenshot.
