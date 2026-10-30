# Implementation Plan

Rules for every task:
- **Stop after EACH task and wait for the user's approval before starting the next one.**
- No commits, no pushes (`main` deploys production).
- **No database writes.** The Supabase project is shared with production. The only script this spec adds (`scripts/inspect-goal-changes.mjs`) is SELECT-only; no restore of goals happens in this spec.
- No migration. The `plan_suggestions.suggestion_type` CHECK keeps `target_change`.
- The dev server may be running: never delete `.next`.
- New tests are plain vitest with explicit `import { describe, it, expect, vi } from "vitest"`, colocated `*.test.ts` under `src/`. Property-style tests use seeded generator loops (no `fast-check` in the project).

Verification (referenced as **V** below) means all of:
1. `npx tsc --noEmit 2>&1 | grep -v "^\.next/"` shows no new errors.
2. `npm test -- --run` passes.
3. `npx eslint <touched files>` shows no new errors.

---

- [x] 0. Create testable seams (behaviour-neutral moves, no fix yet)
  - Move verbatim, routes import them back; no logic change:
    - `ENHANCE_SYSTEM_PROMPT` and the inline `planSummary` template → `src/lib/plans/enhance-prompt.ts` (`buildPlanSummary({ today, planYear, company, annualPlan, products, initiatives })`)
    - the `validTypes` filter + `passesFit` + row map from `src/app/api/plan/enhance/route.ts` → `buildSuggestionRows(aiSuggestions, { companyId, batchId, initiatives, products, passesFit })` in `src/lib/plans/suggestion-rows.ts`
    - the GET mapping in `src/app/api/plan/suggestions/route.ts` → `toClientSuggestions(dbRows)` in the same file
    - `applySuggestion`, `SuggestionRejected`, `SuggestionOverLimit` from `src/app/api/plan/suggestions/[id]/route.ts` → `src/lib/plans/apply-suggestion.ts`
  - Run **V**; the diff must be moves and imports only
  - _Requirements: 2.1, 2.2, 2.5_

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Goal change suggestions never change goals
  - **CRITICAL**: This test MUST FAIL on unfixed code. Failure confirms the bug exists.
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior and will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: the bug is deterministic, so scope to `isBugCondition(X)` from design: AI suggestions with `type = "target_change"`, pending rows with `suggestion_type = "target_change"`, and accept requests for them
  - File: `src/lib/plans/goal-change.test.ts`. Seeded generator: baseline/stretch values (0, small, millions, numeric strings), either or both present, random `current_value`
  - `applySuggestion(fakeDb, companyId, row)` for generated `target_change` rows: assert no `update` on `annual_plans` or `companies` (on F it writes both, to the newest year only)
  - `buildSuggestionRows` over mixed AI output containing `target_change`: assert no row has `suggestion_type = "target_change"`
  - `toClientSuggestions` over pending rows containing `target_change`: assert none returned
  - `ENHANCE_SYSTEM_PROMPT` does not contain `target_change` and states goals are fixed
  - Run on UNFIXED code. **EXPECTED OUTCOME**: FAILS
  - Document counterexamples (e.g. "applySuggestion target_change {baselineRevenue: 120000} → annual_plans.update + companies.update")
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.4, 2.5, 2.6_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - All other suggestion behaviour unchanged
  - **IMPORTANT**: Follow observation-first methodology: record F's outputs for non-bug inputs (`isBugCondition` false), then assert them
  - File: `src/lib/plans/suggestion-preservation.test.ts`, same fake db
  - `budget_change`: one `initiatives.update({ planned_budget })` scoped by id and company (3.2)
  - `date_change`: ISO and month-number inputs give the same `activation_date` as F, floored at today (3.3)
  - `product_update`: one `products.update({ price })` (3.4)
  - `new_initiative` with collaborators stubbed via `vi.mock` (`loadLibrary`, `loadCompanyFit`, `rejectionReason`, `checkLiveLimit`, `resolveSuggestionInitiative`, `resolveTaskTemplates`, `insertWithLibraryKey`): inserts an initiative and tasks; FIT refusal throws `SuggestionRejected`; limit refusal throws `SuggestionOverLimit`; never updates goals (3.1)
  - `buildSuggestionRows` for generated non-goal suggestions equals F's output (target_id mapping, title/rationale truncation, FIT drop)
  - `toClientSuggestions` for non-goal rows equals F's output
  - `buildPlanSummary` still contains `Baseline: $` and `Stretch: $` with the plan's values (3.9)
  - Run on UNFIXED code. **EXPECTED OUTCOME**: PASS
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.9_

- [x] 3. Fix for Enhance Plan changing baseline and stretch goals

  - [x] 3.1 Add the policy module
    - `src/lib/plans/suggestion-policy.ts`: `ENHANCE_SUGGESTION_TYPES` (`new_initiative`, `budget_change`, `date_change`, `product_update`), `isGoalChangeType`, `isAcceptableSuggestionType`
    - _Bug_Condition: isBugCondition(X) where type = "target_change"_
    - _Requirements: 2.1, 2.5_

  - [x] 3.2 Stop asking for and storing goal changes
    - `enhance-prompt.ts`: remove `target_change` from the type union and its shape line; add the rule that baseline and stretch goals are fixed for the year, must never be proposed for change, and the plan may exceed them
    - `buildPlanSummary` keeps the Revenue Targets block unchanged
    - `buildSuggestionRows`: filter with `isAcceptableSuggestionType`; log each dropped goal change
    - _Expected_Behavior: AiSuggestion NOT IN storedRows_
    - _Preservation: 3.9, non-goal row output identical_
    - _Requirements: 1.1, 1.6, 2.1, 2.6, 3.9_

  - [x] 3.3 Hide stored goal change suggestions
    - `toClientSuggestions` drops rows where `isGoalChangeType(suggestion_type)`; the DB query is unchanged
    - _Expected_Behavior: StoredRow NOT IN getList_
    - _Requirements: 1.5, 2.5_

  - [x] 3.4 Refuse goal change accepts on the server
    - `apply-suggestion.ts`: delete the `target_change` branch (it now falls to "Unknown suggestion type")
    - `src/app/api/plan/suggestions/[id]/route.ts`: on `accepted` with `isGoalChangeType`, return 409 `{ code: "goal_change_retired", error: "Revenue goals can't be changed from Enhance Plan." }` before `applySuggestion`; no writes, row stays pending. `rejected` path unchanged
    - Update the route's doc comment (remove the `target_change` line)
    - _Bug_Condition: AcceptRequest for target_change_
    - _Expected_Behavior: no annual_plans/companies writes, status stays pending, code goal_change_retired_
    - _Preservation: reject of any type still marks rejected (3.5)_
    - _Requirements: 1.2, 1.4, 1.5, 2.2, 2.4, 2.5, 3.5_

  - [x] 3.5 Update the Enhance Plan page
    - `src/app/(app)/enhance-plan/page.tsx`: remove `target_change` from the `Suggestion` type and `TYPE_CONFIG`, and the unused `Target` import
    - Accept All: skip listed suggestions whose type is not acceptable; treat 409 `goal_change_retired` as skipped (not applied, not an error, does not stop the loop or change the limit notice)
    - _Requirements: 1.3, 2.3, 2.5_

  - [x] 3.6 Read-only affected-companies report
    - `scripts/inspect-goal-changes.mjs`, following the `scripts/inspect-reports.mjs` pattern (reads `.env.local`, service-role client)
    - SELECT only: accepted `plan_suggestions` with `suggestion_type = 'target_change'` (company, `decided_at`, `current_value`, `proposed_value`), plus today's `companies` goals and every `annual_plans` row (year, goals) for those companies. Print a table; flag where today's goals equal the proposed values
    - No `insert`/`update`/`delete`/`upsert`/`rpc` calls, no `--apply` flag. Header comment says repair is a separate, owner-approved step
    - Check by grep that the file contains none of those write calls. Run it only with the user's go-ahead and report the output
    - _Requirements: 3.10_

  - [x] 3.7 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Goal change suggestions never change goals
    - **IMPORTANT**: Re-run the SAME test from task 1. Do NOT write a new test
    - Add the route-guard assertion if not already covered: `isGoalChangeType("target_change")` is true and blocks the accept path
    - **EXPECTED OUTCOME**: PASSES
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.8 Verify preservation tests still pass
    - **Property 2: Preservation** - All other suggestion behaviour unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2. Do NOT write new tests
    - Confirm by `git diff --stat` that `src/app/api/intake/build/route.ts`, `src/app/api/plan/reset/route.ts` and `src/app/api/plan/history/[id]/restore/route.ts` are untouched (3.6–3.8), and the enhance route still deletes only `status = 'pending'` rows (3.10)
    - **EXPECTED OUTCOME**: PASS
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run **V**. Ask the user if questions arise
  - Report: files changed, the report script's output if it was run, and that goal restoration for affected companies is still pending owner approval
