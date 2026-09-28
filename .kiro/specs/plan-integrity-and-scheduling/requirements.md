# Requirements Document

## Introduction

This feature fixes a cluster of **correctness and blocker defects in plan generation and task scheduling** in the SAM Plan AI app. Two reviewers (Marie and Jay) tested the deployed Vercel app against a Lovable prototype and reported that plan generation times out onto a blank page, that task due dates land after the event they are meant to prepare for, and that tasks set for a week do not appear in the Weekly, Daily, or Monthly views while Year-at-a-Glance simultaneously reports active tasks and hours for the same timeframe. Those reports trace to a small number of verified code defects, listed below as D1–D8.

Scope is limited to correctness. **Onboarding UX, coaching language and tone, the missing Glossary page, terminology alignment, icon choices, and visual polish are explicitly deferred** to a separate later spec so that nothing from the reviewer feedback is lost while this spec stays focused on data and scheduling correctness. The deferred items are: onboarding flow and first-run guidance; coaching/advisory copy and tone; the absent Glossary page; terminology consistency between the app and the prototype; icon and iconography choices; and general visual/layout polish.

This spec also excludes the plan **reset / restore / snapshot** defects. Those are already covered by `.kiro/specs/plan-data-integrity/` (destructive reset ordering, zeroed companies recoverable from `plan_snapshots`, and silent mock-data fallback on misconfiguration). The overlap is narrow and deliberate: both specs touch the generation flow, but `plan-data-integrity` governs what happens to **existing** plan data when a regeneration fails, while this spec governs whether generation **completes at all**, and whether the tasks it writes carry correct dates and are visible in the planner. Where a requirement here concerns a failed generation, it addresses feedback and truncation detection only, and defers data preservation and rollback to `plan-data-integrity`.

**Operational precondition (not a requirement):** production is currently running commit `aa3cec8`, with 43 files of completed work uncommitted and unpushed. Some reviewer findings may therefore already be resolved locally and simply not deployed. Re-testing against a current deploy should precede any further triage, and should precede design work on any requirement below whose defect cannot be reproduced locally.

### Confirmed defects (factual basis)

These were verified by code inspection. File paths and line numbers are given so the design phase can go straight to the code.

- **D1 — Generation times out.** `src/app/api/generate-plan/route.ts` declares `export const maxDuration = 300` and requests `max_tokens: 16000`. Both reviewers hit `FUNCTION_INVOCATION_TIMEOUT` and were left on a completely blank page. A 16k-token completion routinely runs 60–120s, and the platform limit was reached anyway, which indicates the deployment tier does not honour 300s.
- **D2 — Due dates computed on the wrong side of the event.** `src/app/api/generate-plan/route.ts:581`: `const dueDate = new Date(actualYear, actualMonth, 15 + (task.daysBeforeEvent || 0));` — two bugs in one line: the lead time is **added** rather than subtracted, so preparation tasks land after the event; and the event date is **hardcoded to the 15th of the activation month** instead of the initiative's real event date. Sign convention is also contradictory: the generation prompt (`route.ts` ~line 94) documents `"daysBeforeEvent": number` with no sign convention, while `src/types/initiative-type.types.ts:31` documents the opposite (`-21` meaning 21 days before).
- **D3 — Date-only values drift a day across timezones.** `src/services/task.service.ts` maps rows with `dueDate: new Date(row.due_date as string)`. `due_date` is a Postgres `DATE` serialised as `YYYY-MM-DD`, which JavaScript parses as UTC midnight; for any user behind UTC (the app default timezone is `America/New_York`) every due date shifts to the previous local day, corrupting `isSameDay` and week-boundary comparisons. Writes carry the mirror risk: `dto.dueDate.toISOString().split('T')[0]` converts a local `Date` to a UTC calendar day.
- **D4 — Tasks invisible unless their parent initiative falls in the same window.** `src/components/planning/weekly-planner.tsx` (~line 208) and `src/components/planning/daily-planner.tsx` (~line 167) build their task lists by iterating `weekInitiatives` / `dayInitiatives` and calling `taskService.getTasksByInitiative(init.id)`, then filtering by due date. A task due this week whose initiative activates in three months can never appear. `task.service.ts` exposes `getTasksByDueDate(initiativeId, start, end)` but scoped to a single initiative, so no company-wide due-date query exists.
- **D5 — Cadence views cannot leave the current calendar year.** `src/components/planning/quarterly-planner.tsx`, `monthly-planner.tsx`, `monthly-summary-table.tsx`, and `quarterly-summary-table.tsx` each declare a module-level `const YEAR = new Date().getFullYear()`. `year-at-a-glance.tsx` by contrast has full year navigation (`selectedYear` state, `availableYears`, a past-year dropdown, future-year drafts). A plan spanning Aug 2026 – Jul 2027 cannot be viewed past 2026, and because the constant is evaluated once at module load it can go stale within a long session or across a year boundary.
- **D6 — Views contradict each other.** Year-at-a-Glance reports active tasks and hours for a timeframe in which Weekly and Daily report zero — a consequence of D4 (different query paths) compounded by D3 (boundary drift). Reviewers called this out as breaking trust in the planner.
- **D7 — Failures render blank pages.** The generation timeout produced no error UI at all. A second, related failure mode is currently handled only by a log line: `response.stop_reason === "max_tokens"` (route.ts ~line 391) means the model's JSON was truncated.
- **D8 — Existing stored data is already wrong.** Tasks written by past generations carry incorrect due dates from D2. Fixing the code does not repair them.

## Glossary
- **Event date**: the initiative's real `event_date` — the date the initiative happens (a webinar airs, a campaign sends). Distinct from `activation_date`.
- **Activation date**: the initiative's `activation_date` — when work on the initiative begins. Required today; `event_date` is optional.
- **Lead time**: the number of days before an initiative's event date that a preparation task is due. Currently carried on generated tasks as `daysBeforeEvent`.
- **Date-only value**: a calendar day with no time component, stored as a Postgres `DATE` and serialised as `YYYY-MM-DD` (for example a task's `due_date`).
- **Cadence view**: any of Year-at-a-Glance, Quarterly, Monthly, Weekly, and Daily, plus their summary tables.
- **Window**: the inclusive date range a cadence view covers (a day, a week, a month, a quarter, or a year).
- **Selected year**: the calendar year the user is currently viewing, as opposed to the year the code happens to be running in.
- **Truncated generation**: an AI response whose stop reason indicates the token budget was exhausted, so the returned JSON is incomplete.
- **Partial plan**: plan data persisted from a generation that did not complete or validate — some initiatives, tasks, or projections written, others missing.

## Open Decisions for Design (do not resolve in requirements)
- **Biggest open scoping question:** which Vercel plan tier this project is on, and consequently whether generation becomes a background/queued job, a streamed response, or a synchronous call with a reduced token budget. The answer changes the shape of Requirements 1 and 2 substantially and should be settled first.
- Where selected-year state lives: URL search param, React context, or a shared store.
- Whether `event_date` becomes required on initiatives, and what the fallback is when it is absent.
- Whether date-only values move to a string-based representation app-wide, or keep `Date` with explicit local-timezone parsing helpers.
- Whether D8 remediation is a one-off migration, a backfill script, or a forced regeneration — and how already-completed tasks are treated.
- Whether cross-view consistency is enforced by a single shared query/selector, or by independent queries verified with tests.
- Whether a company-wide task query is filtered in the database or in the client, and how it interacts with existing row-level security.

---

## Requirements

### Requirement 1: Plan generation completes within platform limits

**User Story:** As a customer, I want plan generation to finish, so that I get a plan instead of a timeout.

*Evidence: D1 — `src/app/api/generate-plan/route.ts`, `maxDuration = 300` with `max_tokens: 16000`; both reviewers hit `FUNCTION_INVOCATION_TIMEOUT`.*

#### Acceptance Criteria

1. WHEN a customer requests plan generation THEN the system SHALL either return a completed plan, or return a defined in-progress state that the customer can wait on or return to, within the deployment platform's enforced request limit.
2. The system SHALL NOT rely on a declared `maxDuration` that exceeds the limit actually enforced by the deployment tier.
3. WHEN generation cannot complete within the enforced platform limit THEN the system SHALL surface a terminal failure or in-progress state to the customer, and SHALL NOT terminate with an unhandled platform timeout.
4. WHEN generation ends without producing a complete, validated plan THEN the system SHALL leave the customer in a state from which generation can be retried without manual data repair.
5. The system SHALL define and enforce an upper bound on the AI token budget that is consistent with whichever execution model the design selects, such that a normal-size plan request completes within that bound.
6. WHEN a plan is generated successfully THEN the resulting plan SHALL contain every initiative, task, and projection the request called for, with none dropped to meet the time or token bound.

---

### Requirement 2: Generation progress and failure are always visible

**User Story:** As a customer, I want to see what is happening while my plan generates and what went wrong if it fails, so that I am never left staring at a blank page.

*Evidence: D7 — the generation timeout produced no error UI; D1 — both reviewers saw a completely blank page.*

#### Acceptance Criteria

1. WHILE plan generation is in progress the system SHALL display a progress indication that identifies generation as the active operation.
2. WHEN plan generation fails for any reason — platform timeout, AI error, validation failure, or network error — THEN the system SHALL display an error message naming what failed and offering at least one recovery action.
3. The system SHALL NOT render a blank page for any generation outcome.
4. WHEN the AI response indicates the token budget was exhausted (`stop_reason === "max_tokens"`, route.ts ~line 391) THEN the system SHALL treat the response as a failed generation.
5. WHEN a generation response is truncated or fails schema validation THEN the system SHALL NOT persist any part of it, and SHALL NOT leave a partial plan in the customer's data.
6. The system SHALL NOT report a generation as successful when the persisted plan is missing initiatives, tasks, or projections that the response called for.
7. WHEN a planner or cadence view fails to load task data THEN the system SHALL display an error state distinguishable from a legitimately empty window, and SHALL NOT render zero counts as if they were a confirmed result.

---

### Requirement 3: Preparation tasks fall before the event

**User Story:** As a customer, I want a task with a 14-day lead time to be due 14 days before my event, so that the plan tells me to prepare in advance rather than after the fact.

*Evidence: D2(a) — `route.ts:581` adds `daysBeforeEvent` instead of subtracting it; Jay reported a webinar around Sep 14 whose 14-day-lead task was due Sep 28 and whose 20-day-lead task was due Oct 5.*

#### Acceptance Criteria

1. WHEN a task has a lead time of N days relative to an initiative's event date THEN the system SHALL set that task's due date to the event date minus N days.
2. WHEN an initiative has an event date of 2026-09-14 and a task with a 14-day lead time THEN the system SHALL set that task's due date to 2026-08-31.
3. WHEN an initiative has an event date of 2026-09-14 and a task with a 20-day lead time THEN the system SHALL set that task's due date to 2026-08-25.
4. The system SHALL NOT assign a preparation task a due date later than its initiative's event date.
5. WHEN a task has a lead time of 0 days THEN the system SHALL set its due date equal to the initiative's event date.
6. The system SHALL define a single documented sign convention for the lead-time value, and that convention SHALL be stated identically in the generation prompt (`route.ts` ~line 94) and in the type documentation (`src/types/initiative-type.types.ts:31`), which currently contradict each other.
7. WHEN the AI returns a lead-time value whose sign is opposite to the documented convention THEN the system SHALL still schedule the task before the event date, deriving the due date from the magnitude of the lead time rather than trusting its sign.
8. WHEN the AI returns a lead-time value that is missing, non-numeric, or non-finite THEN the system SHALL apply a defined default lead time and SHALL still produce a due date on or before the initiative's event date.
9. WHEN subtracting the lead time crosses a month boundary THEN the system SHALL produce the correct calendar date in the preceding month — for example event date 2026-09-14 with a 14-day lead time SHALL yield 2026-08-31, not 2026-09-00 or 2026-08-30.
10. WHEN subtracting the lead time crosses a calendar-year boundary THEN the system SHALL produce the correct date in the preceding year — for example event date 2027-01-05 with a 10-day lead time SHALL yield 2026-12-26.

---

### Requirement 4: Tasks are anchored to the initiative's real dates

**User Story:** As a customer, I want my tasks scheduled around the actual date of my initiative, so that the plan matches my calendar rather than an arbitrary mid-month placeholder.

*Evidence: D2(b) — `route.ts:581` hardcodes day `15` of the activation month as the event date.*

#### Acceptance Criteria

1. WHEN the system computes a task's due date THEN it SHALL derive the anchor date from the initiative's stored event date.
2. The system SHALL NOT use a hardcoded day of the month as the anchor for task due dates.
3. WHEN an initiative has an event date of 2026-09-14 THEN the system SHALL anchor that initiative's tasks to 2026-09-14, irrespective of the initiative's activation month.
4. WHEN an initiative's event date is null THEN the system SHALL apply a single defined, documented fallback anchor and SHALL still produce a due date for every task of that initiative.
5. WHEN an initiative's event date is null and the fallback anchor is applied THEN the resulting task due dates SHALL still satisfy Requirement 3 relative to that fallback anchor.
6. WHEN an initiative's event date falls in a different calendar month than its activation date THEN the system SHALL use the event date, and the resulting task due dates SHALL fall relative to the event month, not the activation month.
7. WHEN an initiative's event date falls in a different calendar year than its activation date THEN the system SHALL use the event date, and the resulting task due dates SHALL fall relative to the event year.
8. The system SHALL record, for every generated task, a due date that is reproducible from the initiative's stored dates and the task's lead time, so that the same inputs always yield the same due date.

---

### Requirement 5: Date-only values are timezone-safe

**User Story:** As a customer in Eastern time, I want a task due on the 31st to appear on the 31st, so that my planner does not shift every date back a day.

*Evidence: D3 — `src/services/task.service.ts` reads `new Date(row.due_date as string)` (parsed as UTC midnight) and writes `dto.dueDate.toISOString().split('T')[0]`; the app default timezone is `America/New_York`.*

#### Acceptance Criteria

1. WHEN a task's stored due date is the calendar day `2026-08-31` THEN the system SHALL present that task as due on 2026-08-31 for a user in `America/New_York`.
2. The system SHALL present a date-only value as the same calendar day regardless of the viewing user's timezone offset from UTC.
3. WHEN a date-only value is read from storage THEN the system SHALL NOT interpret it as UTC midnight in a way that resolves to the previous calendar day in the user's local timezone.
4. WHEN a date-only value is written to storage THEN the system SHALL persist the calendar day the user selected, and SHALL NOT shift it to the previous or next day via a UTC conversion.
5. WHEN a task due date is written and then read back THEN the calendar day returned SHALL equal the calendar day written, for every timezone the app supports.
6. WHEN a task's due date equals the first calendar day of a month THEN the system SHALL count that task in that month and SHALL NOT count it in the preceding month.
7. WHEN a task's due date equals the first calendar day of a year THEN the system SHALL count that task in that year and SHALL NOT count it in the preceding year.
8. WHEN a cadence view tests whether a task's due date falls on a given day, or inside a given week, month, quarter, or year THEN the comparison SHALL be performed on calendar days in the user's timezone, so that a task due on the first or last day of a window is included in that window.

---

### Requirement 6: Every task due in a window is visible in that window

**User Story:** As a customer, I want to see all the tasks I need to do this week, so that the planner reflects my actual workload regardless of when the parent initiative starts.

*Evidence: D4 — `weekly-planner.tsx` (~line 208) and `daily-planner.tsx` (~line 167) derive tasks by iterating the window's initiatives; `task.service.ts` only offers `getTasksByDueDate` scoped to one initiative.*

#### Acceptance Criteria

1. WHEN a cadence view displays a window THEN the system SHALL list every task for the company whose due date falls within that window.
2. The system SHALL determine a task's inclusion in a window solely from the task's own due date, and SHALL NOT require the parent initiative's activation, event, or date range to overlap the window.
3. WHEN a task is due on 2026-03-04 and its parent initiative activates on 2026-09-01 THEN the week and day views covering 2026-03-04 SHALL list that task.
4. WHEN the only tasks due in a window belong to initiatives outside that window THEN the view SHALL list those tasks rather than reporting the window as empty.
5. The system SHALL scope every task query to the requesting user's company, and SHALL NOT return tasks belonging to another company.
6. WHEN a task is due on the first or last day of the displayed window THEN the system SHALL include it in that window.
7. WHEN a week window straddles a month boundary — for example Monday 2026-08-31 to Sunday 2026-09-06 — THEN the system SHALL list tasks due on every day in that range, across both months.
8. WHEN a week window straddles a calendar-year boundary — for example Monday 2026-12-28 to Sunday 2027-01-03 — THEN the system SHALL list tasks due on every day in that range, across both years.
9. WHEN a window contains no task with a due date in range THEN the system SHALL report the window as empty, distinguishably from a load failure (see Requirement 2.7).

---

### Requirement 7: Cadence views agree with each other

**User Story:** As a customer, I want the Weekly, Daily, Monthly, Quarterly, and Year views to tell me the same thing about the same timeframe, so that I can trust the planner.

*Evidence: D6 — Year-at-a-Glance reports active tasks and hours for a timeframe in which Weekly and Daily report zero; reviewers cited this as breaking trust.*

#### Acceptance Criteria

1. WHEN two cadence views cover overlapping timeframes THEN the system SHALL report mutually consistent task counts for the overlap.
2. WHEN two cadence views cover overlapping timeframes THEN the system SHALL report mutually consistent hour totals for the overlap.
3. WHEN Year-at-a-Glance reports a non-zero task count or hour total for a month THEN the Monthly view for that month SHALL report the same totals, and the Weekly and Daily views covering that month SHALL account for the same tasks.
4. WHEN Year-at-a-Glance reports zero tasks for a timeframe THEN no other cadence view SHALL report a non-zero task count for that same timeframe.
5. The sum of a month's task counts and hour totals across its constituent weeks SHALL equal the month's reported totals, except where a week straddles a month boundary, in which case each task SHALL be attributed to exactly one month according to its own due date.
6. A task SHALL be counted exactly once within any single cadence view's window, and SHALL NOT be double-counted because its parent initiative also falls in that window.
7. The sum of the four quarters' totals for a selected year SHALL equal that year's reported totals.
8. WHEN the same timeframe is requested twice in a session without intervening data changes THEN every cadence view SHALL report the same totals both times.

---

### Requirement 8: Every cadence view honours the selected year

**User Story:** As a customer with a plan running from August 2026 to July 2027, I want to view every part of it, so that the second half of my plan is not unreachable.

*Evidence: D5 — `quarterly-planner.tsx`, `monthly-planner.tsx`, `monthly-summary-table.tsx`, and `quarterly-summary-table.tsx` each declare a module-level `const YEAR = new Date().getFullYear()`; only `year-at-a-glance.tsx` supports year navigation.*

#### Acceptance Criteria

1. The system SHALL allow the customer to select which calendar year every cadence view displays.
2. WHEN the customer changes the selected year THEN every cadence view SHALL display data for the newly selected year without a page reload.
3. The system SHALL NOT fix any cadence view's year to the year the application code was loaded in.
4. WHEN a plan spans 2026-08 to 2027-07 THEN the system SHALL allow the customer to view the 2027 portion in the Quarterly, Monthly, Weekly, and Daily views as well as in Year-at-a-Glance.
5. WHEN the selected year is a year other than the current year THEN quarterly and monthly summaries SHALL report totals for the selected year, not for the current year.
6. WHEN the system clock crosses a calendar-year boundary during an open session THEN the cadence views SHALL reflect the current year on the next date-dependent evaluation, and SHALL NOT continue to use a year captured at module load.
7. WHEN the customer navigates from a window in one year to an adjacent window in another year — for example from the week of 2026-12-28 to the week of 2027-01-04 — THEN the system SHALL display the destination window's data for its own year.
8. The selected year SHALL be consistent across cadence views, so that switching from Monthly to Quarterly or Weekly preserves the year the customer was viewing.
9. WHEN a selected year contains no plan data THEN the system SHALL report the year as empty rather than falling back to another year's data.

---

### Requirement 9: Existing incorrect task due dates are remediated

**User Story:** As a customer whose plan was generated before the fix, I want my stored task dates corrected, so that I do not have to regenerate my plan to get a usable schedule.

*Evidence: D8 — tasks written by past generations carry due dates computed by `route.ts:581`, which fixing the code does not repair.*

#### Acceptance Criteria

1. The system SHALL provide a defined remediation path for tasks already stored with due dates computed by the defective calculation.
2. WHEN remediation runs for a company THEN every remediated task's due date SHALL satisfy Requirements 3, 4, and 5.
3. WHEN remediation completes for a company THEN no remaining task for that company SHALL have a due date later than its initiative's event date.
4. The system SHALL identify which stored tasks require remediation, and SHALL NOT alter tasks whose due dates already satisfy Requirements 3, 4, and 5.
5. WHEN remediation is run twice THEN the resulting task due dates SHALL be identical to the result of running it once.
6. WHEN remediation cannot determine a correct due date for a task — for example because the initiative's event date is absent and no lead time was recorded — THEN the system SHALL leave that task unchanged and report it as unremediated rather than writing a guessed date.
7. WHEN remediation runs THEN the system SHALL report which tasks were changed, which were left unchanged, and which could not be remediated.
8. WHEN remediation encounters a task that is already marked complete THEN the system SHALL apply the treatment decided in design, and SHALL apply the same treatment to every such task rather than deciding case by case.
9. Remediation SHALL be scoped to the tasks it is targeting, and SHALL NOT modify initiatives, projections, annual plan targets, or company revenue fields.

---

### Requirement 10: The scheduling and boundary rules are protected by automated tests

**User Story:** As a developer, I want the date rules covered by tests, so that these defects cannot silently return.

*Evidence: D2, D3, D4, D5 all concern arithmetic and boundary logic that no current test exercises.*

#### Acceptance Criteria

1. The system SHALL have automated tests covering lead-time-relative due-date calculation, including that a task with a 14-day lead time against a 2026-09-14 event date is due 2026-08-31.
2. The system SHALL have automated tests covering the lead-time sign convention, including a lead-time value whose sign is opposite to the documented convention, a zero lead time, and a missing or non-numeric lead time.
3. The system SHALL have automated tests covering month-boundary and calendar-year-boundary crossings in due-date calculation.
4. The system SHALL have automated tests covering initiatives with a null event date.
5. The system SHALL have automated tests covering timezone-safe round-tripping of date-only values, asserting that a date written is read back as the same calendar day in `America/New_York`.
6. The system SHALL have automated tests asserting that a task whose due date falls in a window is listed in that window even when its parent initiative falls outside the window.
7. The system SHALL have automated tests covering window boundaries, including a week that straddles a month end and a week that straddles a calendar-year end, and tasks due on the first and last day of a window.
8. The system SHALL have automated tests asserting cross-view consistency of task counts and hour totals for a shared timeframe.
9. The system SHALL have automated tests asserting that cadence views report data for a selected year other than the current year.
10. WHEN the test suite runs THEN it SHALL fail if any of the behaviours in Requirements 3 through 8 regresses.
11. The tests SHALL exercise the real date and query logic, and SHALL NOT substitute fabricated results that would pass irrespective of that logic.
