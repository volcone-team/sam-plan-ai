# Bugfix Requirements Document

## Introduction

Three related data-integrity defects in the SAM Plan AI app cause users to lose their annual plan, leave existing plans permanently zeroed, and allow fabricated data to be served as if it were real. All three were empirically confirmed during a live debugging session (code inspection plus direct database queries against the production Supabase project).

**Defect 1 — Failed plan generation destroys the existing plan.** `src/app/onboarding/generating/page.tsx` calls the reset endpoint *before* calling `/api/generate-plan`. The non-scratch path (`src/app/api/plan/reset/route.ts`) deletes initiatives, tasks, projections, results and expenses, zeroes `annual_plans.baseline_revenue / stretch_revenue / operating_budget`, sets status to `draft`, and zeroes the matching `companies` revenue columns. If generation then fails, the user is left with no plan and zeroed revenue targets. Confirmed for company `8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d` (Elevate Coaching): snapshot "Plan v9" saved at 2026-09-10 22:44:22 with 7 projections and baseline 800, then the annual plan zeroed at 22:44:24 — two seconds later. `/api/plan/reset-scratch` intentionally preserves projections and annual-plan targets, so the defect is specific to the full-reset path.

**Defect 2 — 10 of 25 companies already have zeroed plans.** A direct query confirmed that of 25 companies with a 2026 annual plan, 10 have `baseline_revenue = 0` *and* zero `projections` rows. Their dashboards show Baseline Revenue $0, Stretch Revenue $0 and Good/Better/Best Projection $0. The data is recoverable: `plan_snapshots` rows still hold it (for the example company, "Plan v9" = 7 projections / baseline 800, "Plan v8" = 4 projections / baseline 40,000, "Plan v5" = 3 projections / baseline 600,000). A separate restore bug (already fixed in code) accumulated duplicates rather than replacing — one company grew from 11 to 34 initiatives across repeated restores — and that dirty data still exists.

**Defect 3 — Silent mock-data fallback masks misconfiguration.** `src/services/company.service.ts` and `src/services/user.service.ts` import `@/mock-data/company.json` and `@/mock-data/users.json` and branch on `isSupabaseConfigured()` from `src/lib/supabase/db.ts`, which only checks that `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are non-empty. A missing or misspelled env var in production makes the app serve seed data silently, so users see a fabricated company and user list and have no signal that it is not their own. 14 mock JSON files remain in `src/mock-data/`; Phase 11 in `docs/phases.md` lists "No JSON dependency" as an unmet exit criterion.

Fixes are to be delivered and empirically verified one defect at a time. `plan_snapshots` is the safety net that makes recovery possible, so snapshotting must remain intact throughout.

## Bug Analysis

### Current Behavior (Defect)

Defect 1 — destructive reset ordering:

1.1 WHEN a user regenerates a plan in any mode other than "scratch" THEN the system deletes the existing plan data and zeroes revenue targets before attempting generation
1.2 WHEN `/api/generate-plan` fails after the reset has run THEN the system leaves the user with zero initiatives, zero tasks, zero projections and `baseline_revenue = stretch_revenue = operating_budget = 0` on both `annual_plans` and `companies`
1.3 WHEN the reset endpoint returns a non-OK status THEN the client logs a warning and continues into generation anyway, so a partially-wiped plan is neither restored nor reported to the user
1.4 WHEN generation fails and the user is shown the error screen THEN the system offers no automatic restoration of the snapshot it just took, and recovery requires manual admin action through plan history

Defect 2 — existing zeroed plans:

1.5 WHEN a company's plan was wiped by the failed-generation path THEN the system continues to show Baseline Revenue $0, Stretch Revenue $0 and Good/Better/Best Projection $0 on the dashboard indefinitely
1.6 WHEN a company has `baseline_revenue = 0` and no `projections` rows but does have non-zero `plan_snapshots` THEN the system provides no mechanism to detect or repair that inconsistency
1.7 WHEN a plan was restored repeatedly under the earlier restore bug THEN the system retains the accumulated duplicate initiatives, tasks and projections (one company holds 34 initiatives where 11 are correct)

Defect 3 — silent mock fallback:

1.8 WHEN `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is missing or misspelled THEN the system returns mock JSON company and user records instead of failing
1.9 WHEN mock data is served in place of real data THEN the system emits no user-visible error and no distinguishable signal, so fabricated records are indistinguishable from the user's own
1.10 WHEN an env var is present but points at the wrong project or carries an invalid key THEN `isSupabaseConfigured()` still returns true, so the misconfiguration surfaces only as downstream query failures

### Expected Behavior (Correct)

Defect 1 — destructive reset ordering:

2.1 WHEN a user regenerates a plan in any mode THEN the system SHALL generate and validate the new plan before any existing plan data is deleted or zeroed
2.2 WHEN `/api/generate-plan` fails at any point THEN the system SHALL leave the user's existing plan fully intact, including initiatives, tasks, projections, results, expenses, `annual_plans` revenue fields and `companies` revenue fields
2.3 WHEN the reset endpoint returns a non-OK status THEN the system SHALL abort the regeneration, surface the failure to the user, and SHALL NOT proceed to a generation step that could compound the damage
2.4 WHEN a plan reset runs THEN the system SHALL have persisted a `plan_snapshots` row containing the pre-reset plan first, and SHALL abort the reset if the snapshot cannot be written
2.5 WHEN generation fails after data has already been removed (any residual path) THEN the system SHALL automatically restore the most recent snapshot and report the restoration outcome to the user
2.6 WHEN a regeneration completes successfully THEN the system SHALL leave exactly one current plan with non-zero revenue targets and no orphaned rows from the previous plan

Defect 2 — existing zeroed plans:

2.7 WHEN an administrator requests an integrity scan THEN the system SHALL report every company whose 2026 annual plan has `baseline_revenue = 0` together with zero `projections` rows, and SHALL report whether a recoverable snapshot exists for each
2.8 WHEN recovering a zeroed company THEN the system SHALL select the most recent `plan_snapshots` row whose snapshot contains non-zero `baseline_revenue` and at least one projection, and SHALL report the chosen snapshot label before writing anything
2.9 WHEN a recovery is performed THEN the system SHALL require explicit operator confirmation for the destructive write, SHALL be restricted to companies identified by the scan, and SHALL support a dry-run that reports the intended changes without mutating data
2.10 WHEN restoring a snapshot THEN the system SHALL replace the company's plan rows rather than append to them, so restoring twice produces the same row counts as restoring once
2.11 WHEN a company has no snapshot that satisfies the non-zero criteria THEN the system SHALL skip that company, leave its data untouched, and report it as unrecoverable rather than writing zeroes or partial data
2.12 WHEN a company carries duplicate rows accumulated by the earlier restore bug THEN the system SHALL report the duplication and SHALL NOT silently delete rows without operator confirmation

Defect 3 — silent mock fallback:

2.13 WHEN required Supabase configuration is missing at runtime THEN the system SHALL fail loudly with an explicit configuration error and SHALL NOT substitute mock data
2.14 WHEN the app runs in a production environment THEN the system SHALL NOT import or serve any file from `src/mock-data/` for company or user data
2.15 WHEN a Supabase query fails because of misconfiguration or an invalid key THEN the system SHALL surface an error state that names configuration as the cause, distinct from an empty-result state
2.16 WHEN mock data is intentionally used for local development THEN the system SHALL require an explicit opt-in flag and SHALL make the mock mode visible in logs and in the UI

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user regenerates with `sam-regen-mode = "scratch"` THEN the system SHALL CONTINUE TO run the selective reset that preserves projections, annual-plan targets, and past or in-progress initiatives
3.2 WHEN a plan reset or restore runs THEN the system SHALL CONTINUE TO write a labelled `plan_snapshots` row (`Plan vN`) capturing initiatives, tasks, projections, results, expenses and the annual plan
3.3 WHEN a user restores a plan from history manually THEN the system SHALL CONTINUE TO restore that specific snapshot and leave other companies untouched
3.4 WHEN plan generation succeeds THEN the system SHALL CONTINUE TO produce initiatives, tasks and projections and redirect the user to the dashboard with the draft cleared from local storage
3.5 WHEN a request has no authenticated user or no `company_id` on the profile THEN the reset and recovery endpoints SHALL CONTINUE TO return 401 or 400 without mutating data
3.6 WHEN a company legitimately has no plan yet (first-time onboarding) THEN the system SHALL CONTINUE TO allow generation to proceed and SHALL NOT flag that company as corrupted by the integrity scan
3.7 WHEN a company's plan has non-zero revenue and at least one projection THEN the recovery mechanism SHALL CONTINUE TO leave it completely untouched
3.8 WHEN Supabase is correctly configured THEN all services SHALL CONTINUE TO read and write real data with unchanged method signatures and return shapes
3.9 WHEN dashboards, planner views and reports read plan data THEN the system SHALL CONTINUE TO render the same values for companies whose data was never corrupted
3.10 WHEN each fix lands THEN `npx next build` SHALL CONTINUE TO pass with no new TypeScript errors and no increase in the existing ESLint error count
