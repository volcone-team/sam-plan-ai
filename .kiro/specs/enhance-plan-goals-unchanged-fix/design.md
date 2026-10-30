# Enhance Plan Goals Unchanged Bugfix Design

## Overview

Enhance Plan can change a company's baseline and stretch goals through the
`target_change` suggestion type. Three places carry that type today:

- `src/app/api/plan/enhance/route.ts`: the system prompt offers `target_change`
  to the AI (`ENHANCE_SYSTEM_PROMPT`), and `validTypes` stores it.
- `src/app/api/plan/suggestions/route.ts` (GET): returns every pending
  suggestion, `target_change` included.
- `src/app/api/plan/suggestions/[id]/route.ts` (PATCH): `applySuggestion`
  writes `baseline_revenue` / `stretch_revenue` to the newest `annual_plans`
  row (`order("year", desc).limit(1)`, regardless of the year being viewed)
  and to `companies`.
- `src/app/(app)/enhance-plan/page.tsx`: renders the "Target Change" card,
  and Accept All PATCHes every listed suggestion.

The fix retires `target_change` as an acceptable type at every layer, with the
server refusing it even if an old pending row or a hand-made request reaches
it. Nothing else about Enhance Plan changes. The goals stay in the AI context
so other suggestions can aim at or above them. Past `plan_suggestions` rows
are kept, and a read-only script lists companies whose goals were changed so
the owner can decide on a repair separately.

No migration. The `plan_suggestions.suggestion_type` CHECK keeps
`target_change` so existing rows stay valid.

## Glossary

- **Goals**: `baseline_revenue` and `stretch_revenue` on `annual_plans` and
  `companies`.
- **Goal change suggestion**: a `plan_suggestions` row, or an AI suggestion
  object, whose type is `target_change`.
- **F / F'**: the code before / after the fix.

## Bug Details

### Bug Condition

```
FUNCTION isBugCondition(X)
  INPUT: X is one of
    - AiSuggestion   { type, proposed, ... }       (enhance run output)
    - StoredRow      { suggestion_type, status }   (GET list / PATCH accept)
    - AcceptRequest  { suggestion, decision }
  OUTPUT: boolean

  RETURN (X is AiSuggestion  AND X.type = "target_change")
      OR (X is StoredRow     AND X.suggestion_type = "target_change" AND X.status = "pending")
      OR (X is AcceptRequest AND X.suggestion.suggestion_type = "target_change"
                             AND X.decision = "accepted")
END FUNCTION
```

### Examples

- AI returns `{ type: "target_change", proposed: { baselineRevenue: 120000, stretchRevenue: 150000 } }`.
  F stores it as pending. Expected: dropped, not stored.
- A pending `target_change` row exists from before the fix. F's GET returns it
  and the page shows "Target Change". Expected: not returned.
- PATCH `{ decision: "accepted" }` on that row. F writes
  `annual_plans` (newest year) and `companies` to 120000 / 150000 and marks it
  accepted. Expected: no write to either table, the row stays pending, and the
  response is a refusal that the page treats as "skipped", not as an error
  that stops Accept All.
- PATCH `{ decision: "rejected" }` on the same row. Expected (unchanged): marked
  rejected, no plan writes.

## Expected Behavior

### Preservation Requirements

Unchanged for every input where `isBugCondition` is false:

- `new_initiative`, `budget_change`, `date_change`, `product_update` accepts
  perform the same writes as today (3.1–3.4), including FIT refusal (409
  `ineligible`) and plan-limit refusal for `new_initiative`.
- Reject of any type, `target_change` included, marks the row rejected with no
  plan writes (3.5).
- Intake build, plan reset and Plan History restore still set goals
  (3.6–3.8). Their files are not touched.
- The enhance prompt still lists Baseline and Stretch under "Revenue Targets"
  (3.9).
- Enhance still deletes only `status = 'pending'` rows; accepted and rejected
  rows, including accepted `target_change` rows with their `current_value`,
  stay (3.10).

### Expected Behavior Properties

```
FUNCTION expectedBehavior(X, result)
  IF X is AiSuggestion   THEN RETURN X NOT IN storedRows(result)
  IF X is StoredRow      THEN RETURN X NOT IN getList(result)
  IF X is AcceptRequest  THEN RETURN writes(result) has no annual_plans or companies update
                                 AND X.suggestion.status remains "pending"
                                 AND result.code = "goal_change_retired"
END FUNCTION
```

And for any accepted batch: goals on every `annual_plans` row and on
`companies` are equal before and after (2.2–2.4, 2.6).

## Hypothesized Root Cause

Not a hypothesis; the code shows it directly:

1. `ENHANCE_SYSTEM_PROMPT` documents `target_change` as a valid output, so the
   AI proposes goal values that fit the current initiatives (1.1, 1.6).
2. `validTypes` in the enhance route includes `target_change` (1.1).
3. `applySuggestion`'s `target_change` branch writes goals to the newest annual
   plan and the company (1.2, 1.4).
4. Accept All loops over every listed suggestion, so a pending `target_change`
   is applied with the rest (1.3, 1.5).

## Fix Implementation

### Testable seams (behaviour-neutral moves, done before the tests)

The vitest config runs pure unit tests only (`src/**/*.test.ts`, node
environment, no route tests exist). To test the real code paths, move these
out of the routes verbatim, with the database passed in:

- `src/lib/plans/enhance-prompt.ts`: `ENHANCE_SYSTEM_PROMPT` and
  `buildPlanSummary({ today, planYear, company, annualPlan, products, initiatives })`
  (the current inline `planSummary` template).
- `src/lib/plans/suggestion-rows.ts`:
  `buildSuggestionRows(aiSuggestions, { companyId, batchId, initiatives, products, passesFit })`
  (the current `validTypes` filter + `passesFit` + map) and
  `toClientSuggestions(dbRows)` (the GET mapping).
- `src/lib/plans/apply-suggestion.ts`: `applySuggestion(db, companyId, s)`,
  `SuggestionRejected`, `SuggestionOverLimit`.

### Changes

1. **New `src/lib/plans/suggestion-policy.ts`**
   - `ENHANCE_SUGGESTION_TYPES = ["new_initiative", "budget_change", "date_change", "product_update"] as const`.
   - `isGoalChangeType(type: unknown): boolean` → `type === "target_change"`.
   - `isAcceptableSuggestionType(type)` → member of `ENHANCE_SUGGESTION_TYPES`.
2. **`enhance-prompt.ts`**: remove `target_change` from the type union and its
   shape line. Add a rule: the baseline and stretch goals are fixed for the
   year; never propose changing them; the plan's forecast may exceed them.
   Keep the "Revenue Targets" block in the plan summary (3.9).
3. **`buildSuggestionRows`**: filter with `isAcceptableSuggestionType`; log
   each dropped goal change suggestion (2.1).
4. **`toClientSuggestions`** (GET): drop rows where
   `isGoalChangeType(suggestion_type)`. The DB query is unchanged (2.5).
5. **`applySuggestion`**: delete the `target_change` branch. The PATCH route,
   before calling it on `accepted`, refuses a goal change suggestion with
   HTTP 409 `{ code: "goal_change_retired", error: "Revenue goals can't be changed from Enhance Plan." }`,
   writes nothing, and leaves the row pending (the next enhance run clears
   it). `rejected` keeps today's path (3.5).
6. **`enhance-plan/page.tsx`**: remove `target_change` from the `Suggestion`
   type and `TYPE_CONFIG` (and the unused `Target` icon import). Accept All
   skips any listed suggestion whose type is not acceptable and treats a 409
   `goal_change_retired` as skipped, so it neither counts as applied nor
   stops or misreports the rest (2.3, 2.5).
7. **Read-only report `scripts/inspect-goal-changes.mjs`**: lists accepted
   `target_change` rows (company, `decided_at`, `current_value`,
   `proposed_value`) next to today's goals on `companies` and every
   `annual_plans` row for that company. SELECT only, no writes, no `--apply`
   flag. Repair is a separate, owner-approved step (3.10).

## Testing Strategy

Plain vitest with explicit `import { describe, it, expect, vi } from "vitest"`.
No `fast-check` in the project: property tests use seeded generator loops.
`applySuggestion` is tested against a fake `db` that records every
`from(table).update/insert/delete` call; `new_initiative` collaborators are
stubbed with `vi.mock`.

### Property 1: Bug Condition (goal change suggestions never change goals)

For generated goal change inputs (random baseline/stretch values, either or
both present, numbers or strings; pending rows; accept requests):
`buildSuggestionRows` stores none, `toClientSuggestions` returns none, the
PATCH guard refuses with `goal_change_retired`, and `applySuggestion` is never
reached for them (on F it writes `annual_plans` and `companies`, so the test
fails on F). The prompt contains no `target_change`.

### Property 2: Preservation (all other suggestion behaviour unchanged)

For generated non-goal inputs: `budget_change`, `date_change`,
`product_update` produce the same recorded writes as F; `new_initiative`
inserts an initiative and never updates goals; reject of any type including
`target_change` is still allowed; `buildSuggestionRows` output for non-goal
types equals F's output; the prompt still carries the Revenue Targets context;
enhance still deletes only pending rows.
