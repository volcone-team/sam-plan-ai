# Intake v2 — Tasks

Implements `design.md` against `requirements.md`.

Ordered so each stage is independently verifiable. Pure logic lands before the
UI that depends on it, because the forecast and eligibility rules are where a
silent error is most costly.

## Stage 1 — Schema and foundations

- [x] 1. Migration 026: remaining fields
  - [x] 1.1 `industry_other`, `resume_screen`, `onboarding_status` + 5 timestamps on `planning_inputs`
  - [x] 1.2 `recurring_interval` on `intake_products`
  - [x] 1.3 `custom_label`, `needs_review` on `intake_initiatives`
  - [x] 1.4 `intake_events` table with RLS
  - [x] 1.5 Extend `scripts/verify-intake-schema.mjs` to cover the new columns

- [x] 2. `lib/intake/schema.ts` — field definitions
  - [x] 2.1 The 13 industries + Other, matching the Library's Ideal Industries column
  - [x] 2.2 All option lists (sales model, stage, who closes, product type, price tier, pricing model, delivery, obstacles, other audiences)
  - [x] 2.3 Per-screen required-field map, mirroring the asterisks in the mockups
  - [x] 2.4 Exact copy strings (titles, subtitles, helpers, placeholders) in one place

- [x] 3. `lib/intake/flow.ts` — path and progress
  - [x] 3.1 `screensFor(path)` — Path C omits `initiatives` entirely
  - [x] 3.2 `progressFor(path, screen)` — step/total off the same array
  - [x] 3.3 `nextScreen` / `prevScreen`
  - [x] 3.4 Final button label per path
  - [x] 3.5 Tests: 9 vs 10 screens, progress never exceeds total, traversal from every screen on every path

- [x] 4. `lib/intake/funnel.ts` — the one generic funnel (D1)
  - [x] 4.1 Three percentage stages + audience and price brackets
  - [x] 4.2 Per-initiative label overrides, presentation only
  - [x] 4.3 Tests: overrides never alter arithmetic; a blank stage yields no forecast, never zero

- [x] 5. `lib/intake/validation.ts` — per-screen validation
  - [x] 5.1 Required fields block; optional never do
  - [x] 5.2 Obstacles capped at 3
  - [x] 5.3 "Not sure" produces null, never 0
  - [x] 5.4 Percent fields bounded 0–100
  - [x] 5.5 Tests for each rule

## Stage 2 — Draft persistence

- [x] 6. `lib/intake/draft.ts` + `/api/intake/draft`
  - [x] 6.1 Serialise answers to `planning_inputs` + `intake_products` + `intake_initiatives`
  - [x] 6.2 Restore on return, resuming at `resume_screen` (slug, not index)
  - [x] 6.3 Partial saves from screen 1 so an abandoned intake still leaves data
  - [x] 6.4 `company_id` from the session only, never the body
  - [x] 6.5 Tests: round-trip, partial restore, nulls survive as nulls

## Stage 3 — Screens 0 to 4

- [x] 7. `components/intake/intake-shell.tsx`
  - [x] 7.1 Path-aware progress bar
  - [x] 7.2 Back/Next with autosave on advance
  - [x] 7.3 Helper line on every screen except 0, 5 and 9
  - [x] 7.4 Fires `intake_screen_viewed` / `intake_screen_completed`

- [x] 8. Screen 0 — starting point (3 path cards, tooltip)
- [x] 9. Screen 1 — business (industry dropdown + Other, description with mic, sales model, last-12 revenue, 3 stage cards)
- [x] 10. Screen 2 — team and capacity (team size, who closes, plan owner, hours, budget)
- [x] 11. Screen 3 — products
  - [x] 11.1 Period selectors: 3/6/12/18, start month, no past months
  - [x] 11.2 Product card: 7 fields, live `product_goal`
  - [x] 11.3 `units_goal` label tracks the chosen period
  - [x] 11.4 Recurring reveals per month / per year
  - [x] 11.5 Running total as reference only; single-tier coaching line
- [x] 12. Screen 4 — revenue goal
  - [x] 12.1 Prorated last-12 and prorated × 1.3 stretch
  - [x] 12.2 Warning above 1.5×, never blocking

## Stage 4 — Screens 5 and 6

- [ ] 13. `components/intake/fields/initiative-picker.tsx`
  - [ ] 13.1 Searchable, grouped by parent category, from the full library
  - [ ] 13.2 Exclude Maximizers
  - [ ] 13.3 Ticket Map items only when an Event product is selected
  - [ ] 13.4 OPS/OWN variants labelled "on your own platform" / "on someone else's platform"
  - [ ] 13.5 "Something else" reveals text, sets `needs_review`

- [ ] 14. `components/intake/fields/funnel-fields.tsx` — the 5 fields, all optional, with the skip helper

- [ ] 15. Screen 5 — planned initiatives (Paths A and B)
  - [ ] 15.1 Repeater, minimum 1
  - [ ] 15.2 Multi-select products per initiative
  - [ ] 15.3 Cadence, with frequency when On repeat
  - [ ] 15.4 Month / exact date toggle, optional
  - [ ] 15.5 `run_before` reveals the funnel

- [ ] 16. Screen 6 — wins and struggles
  - [ ] 16.1 Hide initiatives already given results on screen 5
  - [ ] 16.2 EVERY selected chip expands its own funnel
  - [ ] 16.3 `worked_notes` with mic
  - [ ] 16.4 `didnt_work` chips, each with an optional "Why?"

## Stage 5 — Screens 7 to 9

- [ ] 17. Screen 7 — ideal customer (customer type, industries when Businesses, two required long-text fields with mic)
- [ ] 18. Screen 8 — audience today (5 numbers each with "Not sure", other audiences multi-select)
- [ ] 19. Screen 9 — obstacles (chips capped at 3, notes with mic, path-specific primary button)

## Stage 6 — Recommendation engine

- [ ] 20. `lib/recommend/eligibility.ts` — the six rules as pure predicates
  - [ ] 20.1 Exclude anything in `didnt_work`
  - [ ] 20.2 Respect `monthly_budget` and `hours_per_week`
  - [ ] 20.3 No sales-call initiatives when "We don't do sales calls"
  - [ ] 20.4 Two initiatives behind any product carrying over half the goal
  - [ ] 20.5 Industry eligibility, honouring Broad fit
  - [ ] 20.6 A test per rule

- [ ] 21. `lib/recommend/sizing.ts` — Start 1–2, Momentum 2–4, Scale 4+, with tests
- [ ] 22. `lib/recommend/swap.ts` — next-best, skipping shown and dismissed, null when exhausted, with tests
- [ ] 23. `/api/intake/recommend` — forecast, ask the AI, filter server-side through `isEligible`, size to stage

## Stage 7 — Recommendations screen

- [ ] 24. Gap bar with live recalculation on accept/dismiss
- [ ] 25. Initiative cards (name, products, start month, forecast, effort, why it fits)
- [ ] 26. Three path variants with their headlines and actions
- [ ] 27. Benchmark notice on benchmark-derived forecasts only
- [ ] 28. Accept / dismiss / swap, with dismissed restorable until build
- [ ] 29. Plan-limit warning; "Build my plan" disabled until within the limit
- [ ] 30. `/api/intake/build` — products, initiatives, workbook tasks, date sequencing, `onboarding_status`

## Stage 8 — Analytics

- [x] 31. `lib/intake/events.ts` + `/api/intake/events`, session-derived ids
- [ ] 32. Wire all 11 events — 4 wired (path_selected, screen_viewed,
      screen_completed, voice_used). field_skipped and the 5 recommendation
      events need the screens and output they fire from.
- [ ] 33. Derived `intake_abandoned` (30 minutes idle, not client-fired)
- [ ] 34. `onboarding_status` transitions with timestamps
- [ ] 35. Admin report: path share, per-screen completion by path, acceptance rate per initiative

## Stage 9 — Cutover

- [ ] 36. Route `/onboarding/*` to the new intake
- [ ] 37. Remove the old 7-step questionnaire and its review screen (D2)
- [ ] 38. Rewrite the generator prompt for the v2 fields
- [ ] 39. Point Settings → Business profile at the new fields, with "Update my plan?"
- [ ] 40. Full verification: all paths, resume, build, generation
