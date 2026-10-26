# Implementation Plan

Scope: two files, per design.md. `src/components/recommend/score-breakdown.tsx`
gains an opt-in `layout?: "grid" | "stacked"` prop (default `"grid"`);
`src/components/initiatives/initiative-why.tsx` adds the "Difficulty
Dimensions" heading with "FIT/SCORE" beneath it and passes `layout="stacked"`.
The intake recommendation card (`initiative-recommendation-card.tsx`) is not
edited; it keeps the default grid.

Bug condition (design, isBugCondition): `context = "initiative-detail"` AND
`score IS NOT NULL` AND (heading is not "Difficulty Dimensions" OR the bars are
in the five-column grid).

Expected behaviour (Property 1): h3 "Difficulty Dimensions", h4 "FIT/SCORE"
directly beneath, SCORE total, five bars stacked S, C, O, R, E, each row:
label left, digit right on one line, full-width bar beneath; "*" and dashed bar
for blank-counted scores; footnote.

Preservation (Property 2): any render that omits `layout` produces exactly the
original markup. Guaranteed by construction: `layout` defaults to `"grid"`,
every grid-branch class string is the original literal chosen by a ternary,
and the recommendation card's call site is not edited.

Testing: no new automated tests (design, Testing Strategy). The repo has no
DOM/render setup: vitest runs `environment: "node"` and includes only
`src/**/*.test.ts`. Validation is type checking, the existing suite, the build,
a git diff check and manual browser checks.

- [x] 1. Manual pre-fix check of the bug (unfixed code)
  - **Property 1: Bug Condition** - Detail card heading and stacked bars (manual)
  - Owner runs `npm run dev`; open an initiative with score data → Overview → "Why This Initiative"
  - Confirm the right card heading reads "FIT/SCORE" and there is no "Difficulty Dimensions" (fails 2.1)
  - Confirm the five bars sit side by side at about one fifth of the card width each (fails 2.2)
  - If available, open an initiative with a blank score and confirm "3*" and the dashed bar are squeezed into a grid cell (fails 2.3's stacked requirement)
  - Take a screenshot of the intake recommendations page SCORE block as the pre-fix baseline for task 4
  - Record the observations; cause is confirmed in source by the hardcoded `<h3>FIT/SCORE</h3>` and the unconditional `grid grid-cols-5 gap-2`
  - _Requirements: 1.1, 1.2_

- [x] 2. Fix the initiative detail score card heading and bar layout

  - [x] 2.1 Add the stacked layout to `ScoreBreakdownView` / `ScoreBar` (`score-breakdown.tsx`)
    - Add `layout?: "grid" | "stacked"` to `ScoreBreakdownViewProps` with the doc comment "grid: five columns, for narrow cards (default). stacked: one row per score, for a full-width card."; default `layout = "grid"` in the destructuring
    - `ul` class by ternary over literals: grid `"grid grid-cols-5 gap-2"` (unchanged), stacked `"space-y-3"`. Keep `aria-label="Score breakdown"` and the `SCORE_LETTERS` order (S, C, O, R, E)
    - Pass `layout={layout}` to `ScoreBar`; add `layout?: "grid" | "stacked"` (default `"grid"`) to its props
    - `ScoreBar` (Option A, bar beneath; structure unchanged, sizes only), each by ternary over literals:
      - label/value row: grid `"flex items-baseline justify-between gap-1 text-[11px]"`; stacked `"flex items-baseline justify-between gap-2 text-xs"`
      - bar segment height: grid `"h-1.5"`; stacked `"h-2"`, in the same argument position of the existing `cn(...)` call
    - Value text stays `{value}{missing && "*"}` in both layouts. Do not touch `role="img"`, `aria-label`, `title`, `aria-hidden` or the dashed/filled/empty colour classes
    - Update the component comment to mention the two layouts
    - _Bug_Condition: isBugCondition(input) where input.context = "initiative-detail" AND input.score IS NOT NULL_
    - _Expected_Behavior: Property 1 from design: stacked S, C, O, R, E rows, label left, digit right, full-width bar beneath, "*" and dashed bar when missing_
    - _Preservation: Property 2 from design: grid branch strings are the original literals; role="img", aria-label, visible digit, theme tokens only_
    - _Requirements: 2.2, 2.3, 3.1, 3.2, 3.3_

  - [x] 2.2 Update `initiative-why.tsx` headings and pass `layout="stacked"`
    - Replace the single `<h3>FIT/SCORE</h3>` with:
      - `<h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Difficulty Dimensions</h3>` (same style as the "When to use" `h3`)
      - `<h4 className="mt-1 mb-3 text-xs font-semibold uppercase tracking-wide text-[hsl(var(--foreground-muted))]">FIT/SCORE</h4>`
    - Render `<ScoreBreakdownView score={score} note={FIT_SCORE_NOTE} framed={false} layout="stacked" />`
    - Update the component comment ("Right: Difficulty Dimensions, with the FIT/SCORE breakdown …")
    - Leave unchanged: the `score &&` guard, the `both` two-column rule, the card wrapper classes, `FIT_SCORE_NOTE`, `useWhyData` and the "When to use" card
    - _Bug_Condition: isBugCondition(input) where input.context = "initiative-detail" AND input.score IS NOT NULL_
    - _Expected_Behavior: Property 1 from design: h3 "Difficulty Dimensions", h4 "FIT/SCORE" beneath, then SCORE total, bars and footnote_
    - _Preservation: card hidden when no score data; "When to use" unchanged; same data from GET /api/initiatives/[id]/ai-context_
    - _Requirements: 2.1, 3.4, 3.5, 3.6_

- [x] 3. Confirm the recommendation card is untouched
  - **Property 2: Preservation** - Recommendation card and shared behaviour unchanged (by construction)
  - `git diff --stat` lists only `score-breakdown.tsx` and `initiative-why.tsx`; `git diff -- src/components/intake/recommendations/initiative-recommendation-card.tsx` is empty
  - Confirm the recommendation card does not pass `layout`, so it gets `"grid"`
  - In the `score-breakdown.tsx` diff, confirm every grid-branch class string is identical to the removed original literal
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 4. Checkpoint - Ensure all checks pass
  - `npx tsc --noEmit` reports no new errors (ignore `.next/` and the two known pre-existing test-file errors)
  - `npm test -- --run` passes in full, unchanged
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run build` succeeds
  - Manual browser check (owner runs `npm run dev`), desktop (two-column section) and mobile (single column), each in light and dark mode:
    - Fully scored initiative: h3 "Difficulty Dimensions", h4 "FIT/SCORE" beneath, SCORE total, five rows Speed, Cost, Odds, Revenue, Ease, each with label left, digit right and a full-width bar beneath, footnote (2.1, 2.2)
    - Partially scored initiative: "*" after the digit and dashed bar on blank scores, provisional badge and note shown (2.3, 3.5)
    - Initiative with no score data: score card hidden, "When to use" full width and unchanged (3.4, 3.6)
    - Intake recommendations page: SCORE block matches the task 1 baseline screenshot (five columns, rank, total, weighted total, badge, footnote) (3.1)
    - Accessibility inspector reads bars as e.g. "Speed 5 of 5. …" in both cards (3.2)
  - Do not push; `main` deploys production. Ask the owner before pushing.
  - Ask the user if questions arise.
