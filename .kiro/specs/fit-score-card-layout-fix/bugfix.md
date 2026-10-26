# Bugfix Requirements Document

## Introduction

On the initiative detail page (Overview → "Why This Initiative"), the right-hand card was recently changed from "Difficulty Dimensions" to a card headed only "FIT/SCORE". The client wants the card to keep "Difficulty Dimensions" as its heading, with the FIT/SCORE breakdown underneath it. The client also wants the five SCORE bars (Speed, Cost, Odds, Revenue, Ease) in this card stacked vertically, one row per score, instead of squeezed side by side in a five-column grid.

The same score component is shared with the intake recommendation card, which must keep its current compact five-column layout exactly as it is.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the initiative detail "Why This Initiative" section shows the score card THEN the system renders the card heading as "FIT/SCORE" only, with no "Difficulty Dimensions" heading

1.2 WHEN the initiative detail score card renders the five SCORE bars THEN the system lays them out side by side in a five-column grid, so each label, value and bar is cramped into one fifth of the card width

### Expected Behavior (Correct)

2.1 WHEN the initiative detail "Why This Initiative" section shows the score card THEN the system SHALL render "Difficulty Dimensions" as the card's heading, followed by the FIT/SCORE content (the SCORE total, the bars and the footnote) beneath it

2.2 WHEN the initiative detail score card renders the five SCORE bars THEN the system SHALL stack them vertically in the order Speed, Cost, Odds, Revenue, Ease, one row per score, each row showing the score label, its numeric value as text, and its bar spanning the full width of the row

2.3 WHEN the initiative detail score card renders a score that was blank and counted as 3 THEN the system SHALL still mark that value with "*" and the dashed bar style in the stacked layout

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the intake recommendation card renders its SCORE breakdown THEN the system SHALL CONTINUE TO show the five bars side by side in the compact five-column grid, with the same rank, total, weighted total, provisional badge and footnote as before

3.2 WHEN any SCORE bar renders, in either the initiative detail card or the recommendation card, THEN the system SHALL CONTINUE TO expose it as `role="img"` with an `aria-label` stating the score as text (e.g. "Speed 5 of 5") and the visible digit, so nothing depends on colour or bar length alone

3.3 WHEN the score card renders in dark mode THEN the system SHALL CONTINUE TO use the theme tokens (foreground, foreground-muted, primary, background-muted, border, card) so it reads correctly in both themes

3.4 WHEN the initiative has no score data THEN the system SHALL CONTINUE TO hide the score card and let the "When to use" card take the full width

3.5 WHEN the initiative detail score card renders THEN the system SHALL CONTINUE TO show the SCORE total, the provisional badge and note when scores are incomplete, and the FIT/SCORE footnote, from the same data returned by GET /api/initiatives/[id]/ai-context

3.6 WHEN the left "When to use" card renders THEN the system SHALL CONTINUE TO render it unchanged
