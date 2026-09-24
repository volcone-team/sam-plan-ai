# Plan Data Integrity Bugfix Design

## Overview

This design addresses a cluster of three related data-integrity defects in the SAM Plan AI app. All three were confirmed during a live debugging session (code inspection plus direct queries against the production Supabase project), and all three are captured as numbered requirement clauses in `bugfix.md` (1.1–1.10 current behavior, 2.1–2.16 expected behavior, 3.1–3.10 regression-prevention).

- **Defect 1 — destructive reset ordering.** `src/app/onboarding/generating/page.tsx` calls `/api/plan/reset` (full reset) *before* `/api/generate-plan`. If generation then fails, the user is left with no initiatives/tasks/projections and zeroed revenue targets on both `annual_plans` and `companies` (clauses 1.1–1.4). The fix must make regeneration safe end-to-end (clauses 2.1–2.6).
- **Defect 2 — 10 companies already zeroed.** 10 of 25 companies with a 2026 annual plan have `baseline_revenue = 0` AND zero `projections` rows. Their data survives in `plan_snapshots`. One company also carries duplicate rows (34 initiatives where 11 are correct) from an earlier restore bug. The fix is a recovery mechanism (clauses 2.7–2.12).
- **Defect 3 — silent mock-data fallback.** `isSupabaseConfigured()` only checks that two `NEXT_PUBLIC_*` vars are non-empty. When config is missing/wrong, `company.service.ts` and `user.service.ts` serve fabricated mock JSON as if real, and 10 other services silently return `[]`/throw — making a misconfigured deploy look like "you have no plan." The fix is to fail loudly and gate mock data behind an explicit dev-only opt-in (clauses 2.13–2.16).

**Scope correction (verified this session):** `isSupabaseConfigured()` guards appear at **100 call sites across 12 services** — not 2 as the bugfix doc implies. There are two distinct wrong behaviors: (1) *fabricated data* (only `company.service.ts` + `user.service.ts` return mock JSON) and (2) *silent empty* (the other 10 services fall through to `return []` / `throw new Error("Not found")` with a `console.log("...returning empty")`). Both mask misconfiguration and both must be addressed.

**Verified architectural fact (Defect 1):** `/api/generate-plan` writes directly into the live `annual_plans`, `initiatives`, `tasks`, `projections`, and `companies` rows (confirmed: it updates `annual_plans` at route line ~320, inserts `tasks`/`projections`, and updates `companies` targets at line ~503). Therefore clause 2.1 ("generate and validate before any existing data is deleted") *cannot* be satisfied by merely reordering the two `fetch` calls — generation mutates the very rows the reset clears.

**Delivery model:** fixes ship and are verified **one defect at a time**, empirically (real DB queries + real HTTP probes; there is no test framework or CI yet). Each defect below is independently implementable and verifiable. `plan_snapshots` is the safety net and MUST remain intact throughout (clause 3.2).

**Recommended order:** Defect 1 → Defect 2 → Defect 3. Justification:
1. **Defect 1 first** stops *new* damage. Every regeneration attempt today risks zeroing another company; until the destroy-before-generate ordering is fixed, the Defect 2 population can keep growing (and a recovery run could be re-corrupted the next day). Fixing the bleed before mopping the floor is the correct sequence.
2. **Defect 2 second** repairs the 10 known-corrupted companies once new corruption is prevented. It also *reuses the already-fixed restore logic* (`src/app/api/plan/history/[id]/restore/route.ts`) as a proven building block, so it depends on that code being stable.
3. **Defect 3 last** is the largest blast radius (100 sites) and the least time-sensitive: it changes read behavior app-wide but does not itself destroy data. Doing it last means the fail-loud change lands on a codebase whose data has already been repaired, so a newly-strict config check does not collide with in-flight recovery work.

## Glossary

- **Bug_Condition (C)**: The condition that triggers a given defect. Each defect defines its own C (formalized per-defect below).
- **Property (P)**: The desired behavior when C holds — the correct outcome the fixed code SHALL produce.
- **Preservation (¬C)**: Inputs where the bug does not apply; the fixed code SHALL behave identically to the original.
- **F / F'**: Original (unfixed) function / fixed function.
- **Full reset**: `DELETE /api/plan/reset` — deletes initiatives, tasks, projections, results, expenses; zeroes `annual_plans` revenue fields and status→`draft`; zeroes `companies` revenue columns.
- **Scratch reset**: `DELETE /api/plan/reset-scratch` — selective; deletes only `planned` + future-dated initiatives, preserves projections and annual-plan targets. Triggered by `sam-regen-mode = "scratch"` in localStorage.
- **plan_snapshots**: Table holding labelled (`Plan vN`) JSON snapshots of `{ annualPlan, initiatives, tasks, projections, results, expenses }`. The recovery safety net.
- **Recoverable snapshot**: The newest `plan_snapshots` row for a company whose snapshot JSON has non-zero `baseline_revenue` AND at least one projection.
- **isSupabaseConfigured()**: Guard in `src/lib/supabase/db.ts` that returns true iff `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are both non-empty. Cannot detect a wrong project or invalid key.
- **Fabricated-data path**: `company.service.ts` / `user.service.ts` returning imported mock JSON (`@/mock-data/company.json`, `@/mock-data/users.json`).
- **Silent-empty path**: the 10 other services returning `[]` or throwing `"Not found"` with a `console.log` when the query yields nothing or config is absent.

## Bug Details

### Bug Condition — Defect 1 (destructive reset ordering)

The bug manifests whenever a user regenerates a plan in any mode other than `scratch`: the client destroys and zeroes the existing plan before generation is confirmed, and treats both a non-OK reset status and a failed snapshot write as non-fatal — so a generation failure leaves a wiped plan with no recovery.

**Formal Specification:**
```
FUNCTION isBugCondition_D1(input)
  INPUT: input of type RegenerationRequest { regenMode, snapshotWritten, resetStatus, generationOutcome }
  OUTPUT: boolean

  RETURN input.regenMode != "scratch"
         AND fullResetHasRun(input)                       // live rows deleted / zeroed
         AND ( input.generationOutcome == "failed"        // 1.2: wiped, nothing generated
               OR input.resetStatus == "non-OK"           // 1.3: proceeded anyway
               OR input.snapshotWritten == false )         // 2.4: reset ran without a snapshot
         AND NOT existingPlanRestored(input)               // 1.4: no auto-restore offered
END FUNCTION
```

### Bug Condition — Defect 2 (existing zeroed plans)

The bug manifests for any company whose 2026 annual plan was wiped: baseline revenue is zero, no projections exist, yet a recoverable snapshot is available and there is no mechanism to detect or repair the inconsistency.

**Formal Specification:**
```
FUNCTION isBugCondition_D2(company)
  INPUT: company with { annualPlan2026, projections, snapshots, initiatives }
  OUTPUT: boolean

  RETURN company.annualPlan2026 EXISTS
         AND company.annualPlan2026.baseline_revenue == 0
         AND count(company.projections) == 0
         AND ( hasRecoverableSnapshot(company)             // repairable (2.7, 2.8)
               OR hasDuplicateContamination(company) )      // dirty rows (1.7, 2.12)
END FUNCTION
```

### Bug Condition — Defect 3 (silent mock / silent empty on misconfiguration)

The bug manifests when Supabase configuration is absent, wrong, or carries an invalid key, and a service responds by substituting mock JSON or an indistinguishable empty result instead of surfacing a configuration error.

**Formal Specification:**
```
FUNCTION isBugCondition_D3(request)
  INPUT: request with { env, queryOutcome, service }
  OUTPUT: boolean

  configBroken := isMissing(env.NEXT_PUBLIC_SUPABASE_URL)
                  OR isMissing(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
                  OR request.queryOutcome == "auth/connection-error"   // wrong project / bad key (1.10, 2.15)

  RETURN configBroken
         AND ( servedFabricatedMock(request.service)                   // 1.8, 1.9
               OR returnedSilentEmpty(request.service) )               // silent [] / "Not found"
         AND NOT surfacedConfigError(request)                          // no loud, distinct signal
END FUNCTION
```

### Examples

**Defect 1:**
- Elevate Coaching (`8a3f2c91-7e4d-4b2a-9d1f-6c5e8a2b3f4d`): snapshot "Plan v9" saved 2026-09-10 22:44:22 (7 projections, baseline 800); annual plan zeroed 22:44:24 — two seconds later. Expected: on generation failure the plan stays byte-for-byte intact. Actual: wiped and zeroed.
- Reset returns HTTP 207 (partial delete errors): client logs a warning and proceeds into generation anyway. Expected: abort and surface the failure (2.3).
- Snapshot insert fails inside reset: reset continues and deletes anyway. Expected: abort the reset (2.4).

**Defect 2:**
- 10 of 25 companies: `baseline_revenue = 0` + zero projections; each dashboard shows Baseline $0 / Stretch $0 / Good-Better-Best $0. Expected: an integrity scan reports them and whether each has a recoverable snapshot (2.7).
- One company holds 34 initiatives where 11 are correct (duplicate accumulation from the earlier restore bug). Expected: report the duplication, do not silently delete (2.12).
- A first-time-onboarding company with no plan yet: must NOT be flagged as corrupted (3.6, edge case).

**Defect 3:**
- Production deploy with a misspelled `NEXT_PUBLIC_SUPABASE_URL`: `company.service.getCompany()` returns `@/mock-data/company.json`; the user sees a fabricated company as if real. Expected: loud configuration error, no mock (2.13).
- Same deploy: `projection.service.getProjectionsByCompany()` returns `[]` with `console.log("...returning empty")`; dashboard renders "$0 / no plan." Expected: a config-error state distinct from a legitimately empty result (2.15).
- Local dev with `SAM_USE_MOCK_DATA=1` explicitly set: mock data is allowed, but the log and UI announce mock mode (2.16, edge case).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Scratch-mode regeneration (`sam-regen-mode = "scratch"`) SHALL continue to run the selective reset that preserves projections, annual-plan targets, and past/in-progress initiatives (3.1).
- Every reset or restore SHALL continue to write a labelled `plan_snapshots` row (`Plan vN`) capturing initiatives, tasks, projections, results, expenses, and the annual plan (3.2).
- Manual restore-from-history SHALL continue to restore the specified snapshot and leave other companies untouched (3.3).
- Successful generation SHALL continue to produce initiatives/tasks/projections, redirect to the dashboard, and clear the draft from local storage (3.4).
- Reset and recovery endpoints SHALL continue to return 401/400 for unauthenticated requests or missing `company_id`, without mutating data (3.5).
- A first-time-onboarding company (no plan yet) SHALL continue to be allowed to generate and SHALL NOT be flagged as corrupted (3.6).
- A company with non-zero revenue and ≥1 projection SHALL be left completely untouched by recovery (3.7).
- When Supabase is correctly configured, all services SHALL continue to read/write real data with unchanged method signatures and return shapes (3.8).
- Dashboards, planner views, and reports SHALL render identical values for companies whose data was never corrupted (3.9).
- After each fix, `npx next build` SHALL pass with no new TypeScript errors and no increase over the existing 241 ESLint errors (3.10).

**Scope:**
All inputs where a defect's bug condition does NOT hold SHALL be completely unaffected. Specifically:
- Defect 1: scratch-mode regen, first-time generation with nothing to keep, and any successful generation.
- Defect 2: healthy companies (non-zero baseline + ≥1 projection), companies still onboarding, and any company not identified by the scan.
- Defect 3: any request made while Supabase is correctly configured — same signatures, same return shapes, same values.

**Note:** The correct positive behavior for each bug condition is defined in the Correctness Properties section below (Properties 1, 3, 5). This section enumerates what must NOT change.

## Hypothesized Root Cause

**Defect 1 — ordering + non-fatal error handling.**
1. **Destroy-before-generate ordering**: `generating/page.tsx` awaits the reset `fetch` and then the generate `fetch`. Because `/api/generate-plan` mutates the *same live rows* the reset clears, there is no separation between "old plan" and "new plan" — reordering alone cannot help.
2. **Non-fatal reset failure on the client**: a non-OK reset response only logs `console.warn` and falls through to generation (violates 2.3).
3. **Non-fatal snapshot failure in the endpoint**: `/api/plan/reset` catches snapshot errors and continues to delete (violates 2.4 — the snapshot is the rollback mechanism, so losing it must abort).
4. **No auto-restore on failure**: the error screen offers "Try again"/"Skip" but never restores the snapshot it just took (violates 2.5).

**Defect 2 — no detection or idempotent repair path.**
1. **No integrity scan**: nothing queries for the `baseline = 0 AND zero projections` signature (2.7).
2. **Earlier append-not-replace restore bug**: repeated restores accumulated duplicates; the dirty rows persist (1.7). The restore endpoint has since been fixed (clears not-started initiatives before re-inserting; replaces projections and annual-plan targets), but historical contamination remains.
3. **No idempotency/dry-run/confirmation guardrails** around a destructive repair write (2.9, 2.10, 2.11).

**Defect 3 — a guard that lies, and two masking fallbacks.**
1. **`isSupabaseConfigured()` is too weak**: it only checks presence of two env vars; it cannot detect a wrong project or invalid key, so misconfiguration returns `true` and surfaces only as downstream query failures (1.10, 2.15).
2. **Fabricated-data fallback**: `company.service.ts` / `user.service.ts` import mock JSON and return it on `!configured` or on a caught query error (1.8, 1.9).
3. **Silent-empty fallback**: 10 other services return `[]` / throw `"Not found"` with a `console.log`, making misconfiguration indistinguishable from an empty plan — the same trap that made Defect 1's damage look benign.
4. **No dev opt-in**: mock usage is implicit rather than gated behind an explicit, visible flag (2.16).

## Correctness Properties

These are the single source of truth for the correctness properties used in traceability and property-based testing. Two properties per defect: a Bug-Condition property (correct behavior when C holds) and a Preservation property (unchanged behavior when C does not hold).

Property 1: Bug Condition — Failed regeneration leaves the existing plan intact

_For any_ regeneration request where the bug condition holds (`isBugCondition_D1` returns true) — a non-scratch regen whose generation fails, or whose reset returned non-OK, or whose pre-reset snapshot could not be written — the fixed system SHALL leave the user's existing plan fully intact (initiatives, tasks, projections, results, expenses, `annual_plans` revenue fields, and `companies` revenue fields), OR, if data was already removed on any residual path, SHALL automatically restore the most recent snapshot and report the restoration outcome.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation — Scratch mode and successful generation unchanged

_For any_ request where the Defect-1 bug condition does NOT hold (scratch-mode regen, first-time generation with nothing to keep, or a generation that succeeds), the fixed system SHALL produce the same result as the original: scratch reset still preserves projections/targets/past initiatives, successful generation still produces initiatives/tasks/projections and redirects with the draft cleared, and unauthenticated/no-company requests still return 401/400 without mutation.

**Validates: Requirements 3.1, 3.4, 3.5**

Property 3: Bug Condition — Zeroed companies are detected and safely recoverable

_For any_ company where the Defect-2 bug condition holds (`isBugCondition_D2` returns true) — a 2026 plan with `baseline_revenue = 0` and zero projections — the fixed system SHALL report the company in an integrity scan together with whether a recoverable snapshot exists; SHALL, on operator-confirmed recovery, select the most recent snapshot with non-zero baseline and ≥1 projection and replace (not append) the company's plan rows so restoring twice equals restoring once; SHALL support a dry-run that mutates nothing; SHALL skip and report companies with no recoverable snapshot; and SHALL report duplicate-row contamination without deleting rows unconfirmed.

**Validates: Requirements 2.7, 2.8, 2.9, 2.10, 2.11, 2.12**

Property 4: Preservation — Healthy and onboarding companies untouched

_For any_ company where the Defect-2 bug condition does NOT hold (non-zero baseline with ≥1 projection, or a first-time-onboarding company with no plan yet), the fixed recovery mechanism SHALL leave the company's data completely untouched, SHALL NOT flag onboarding companies as corrupted, and manual restore-from-history SHALL continue to affect only the targeted company.

**Validates: Requirements 3.3, 3.6, 3.7, 3.9**

Property 5: Bug Condition — Misconfiguration fails loudly, never fabricates

_For any_ request where the Defect-3 bug condition holds (`isBugCondition_D3` returns true) — required config missing, wrong project, or invalid key — the fixed system SHALL surface an explicit configuration error state that is distinct from a legitimately empty result, SHALL NOT import or serve any `src/mock-data/` file for company or user data in production, and SHALL only use mock data when an explicit dev-only opt-in flag is set, making mock mode visible in logs and in the UI.

**Validates: Requirements 2.13, 2.14, 2.15, 2.16**

Property 6: Preservation — Correctly-configured reads/writes unchanged

_For any_ request where the Defect-3 bug condition does NOT hold (Supabase correctly configured), the fixed services SHALL produce the same result as the original with unchanged method signatures and return shapes, and dashboards/planner/reports SHALL render identical values for companies whose data was never corrupted.

**Validates: Requirements 3.8, 3.9, 3.10**

## Fix Implementation

Each defect is independently implementable. Implement and verify strictly in the recommended order (Defect 1 → 2 → 3).

### Defect 1 — Make regeneration safe (snapshot-as-rollback)

**Chosen approach: option (c) — keep the current order but make it safe.** Take the snapshot, run the reset, and on generation failure automatically restore the snapshot; treat the snapshot as the rollback mechanism, and make snapshot-write failure fatal to the reset.

**Why (c) over (a) staging-swap or (b) single server-side transaction:**
- Generation is a slow (~30–40s) Anthropic call. Option (b) — wrapping reset + generate in one DB transaction — would hold a transaction open across a 30–40s external network call, which is fragile (connection/statement timeouts, lock contention) and not supported cleanly through the Supabase JS client used here.
- Option (a) — generate into staging/temp rows then atomically swap — is the most robust long-term design but is a large change: `/api/generate-plan` currently writes directly into the live `annual_plans`/`initiatives`/`tasks`/`projections`/`companies` rows, so staging means duplicating every write path plus a swap step. That is disproportionate for a one-defect-at-a-time bugfix and risks new regressions.
- Option (c) reuses infrastructure that already exists and is already the safety net (`plan_snapshots`, clauses 2.4/3.2) and an already-fixed restore path. It satisfies clause 2.5 directly ("automatically restore the most recent snapshot") and keeps the change surface small and verifiable. The residual window (data removed, generation not yet confirmed) is explicitly covered by the auto-restore requirement, so (c) is compliant, not a workaround.

**Files & changes:**

**File**: `src/app/api/plan/reset/route.ts`
1. **Make snapshot write fatal (clause 2.4)**: when there is data to snapshot, if the `plan_snapshots` insert errors, return a non-OK status (e.g. 500) and DO NOT proceed to any delete. Remove the "Non-fatal: continue with reset even if snapshot fails" behavior and the outer non-fatal catch around the snapshot block. Return the snapshot label/id in the success payload so the client can restore it.
2. **Report the snapshot identity**: include `{ snapshotId, snapshotLabel }` in the 200 response so the client's auto-restore targets the exact snapshot just written.

**File**: `src/app/onboarding/generating/page.tsx`
3. **Abort on non-OK reset (clause 2.3)**: if `resetRes` is not OK, set the error phase and STOP — do not call `/api/generate-plan`. Surface the reset failure message to the user.
4. **Capture the snapshot id** from the successful reset response for use in step 5.
5. **Auto-restore on generation failure (clause 2.5)**: in the `!res.ok` branch and the `catch`, if a reset already ran (non-scratch path), call the restore endpoint for the captured snapshot, then set an error message that reports the restoration outcome ("We couldn't finish your plan; your previous plan has been restored." vs. "…restore also failed, contact support."). Only then show the error screen.
6. Preserve the scratch-mode branch untouched (clause 3.1) and the success branch untouched (clause 3.4).

**Reuse note:** the restore call in step 5 reuses `POST /api/plan/history/[id]/restore` (full mode), which already replaces-not-appends and restores projections + annual-plan targets — a proven building block.

### Defect 2 — Integrity scan + guarded recovery

**Recommendation: an admin-triggered endpoint, not a one-off script.** Rationale: it can reuse the existing auth/role guards (owner/operator) and the proven restore logic already in the codebase; it gives the operator a UI-visible dry-run and confirmation flow (clause 2.9); and it is repeatable/idempotent (clause 2.10) rather than a throwaway. A one-off script would duplicate the restore logic and bypass the role checks.

**Files & changes:**

**File (new)**: `src/app/api/admin/plan-integrity/scan/route.ts` (GET)
1. **Integrity scan (clause 2.7)**: for every company with a 2026 annual plan, report those with `baseline_revenue = 0` AND zero `projections` rows. For each affected company, evaluate its snapshots and report whether a recoverable snapshot exists (newest snapshot whose JSON has non-zero `baseline_revenue` AND ≥1 projection) and its label (clause 2.8). Also report duplicate-row contamination counts (e.g. initiatives count vs. expected) without proposing deletion (clause 2.12).
2. **Exclusions (clauses 3.6, 3.7)**: a company with no annual plan (onboarding) is NOT flagged; a company with non-zero baseline and ≥1 projection is NOT flagged.

**File (new)**: `src/app/api/admin/plan-integrity/recover/route.ts` (POST)
3. **Guarded recovery (clauses 2.8–2.11)**: accept a target `companyId` (must be one the scan identified) plus `dryRun` and `confirm` flags. Select the most recent recoverable snapshot, report the chosen label. In dry-run, report intended changes and mutate nothing. With explicit `confirm`, perform the destructive write.
4. **Replace-not-append (clause 2.10)**: reuse the fixed restore semantics — clear not-started initiatives before re-inserting, and replace projections + annual-plan targets — so restoring twice yields the same row counts as once. Extract the restore body into a shared helper (e.g. `src/lib/plan/restore-snapshot.ts`) called by both the history-restore route and this recovery route, keeping the history route's public behavior unchanged (clause 3.3).
5. **Skip-and-report unrecoverable (clause 2.11)**: if no snapshot satisfies the non-zero criteria, leave the company untouched and report it as unrecoverable — never write zeroes or partial data.
6. **Report duplicates, don't auto-delete (clause 2.12)**: surface duplicate counts; deletion requires a separate, explicitly-confirmed operator action (out of scope for the automatic path).
7. **Auth (clause 3.5)**: 401 if unauthenticated, 400 if no `company_id`/target, restrict to owner/operator roles.

### Defect 3 — Fail loud, gate mock behind explicit opt-in

**Recommendation: centralize in `db.ts` / `getSupabase()`, do NOT touch all 100 sites individually.** Rationale: the 100 guards all delegate to the same two helpers, so hardening the helpers fixes the class of bug in one place and keeps every service's method signatures and return shapes unchanged (clause 3.8). Touching 100 sites would be a large, error-prone diff that risks new ESLint/TS errors (clause 3.10).

**Files & changes:**

**File**: `src/lib/supabase/db.ts`
1. **Introduce an explicit dev-only mock flag (clause 2.16)**: add `isMockDataEnabled()` returning true only when a dedicated opt-in env var (e.g. `SAM_USE_MOCK_DATA === "1"`) is set AND `NODE_ENV !== "production"`. On first use, `console.warn` a clearly-labelled "MOCK DATA MODE" banner so it is visible in logs.
2. **Harden `isSupabaseConfigured()` semantics (clauses 2.13, 2.14)**: keep the name/signature but make callers' decision explicit: configured-and-real vs. mock-opt-in vs. misconfigured. Add a helper `assertSupabaseConfigured()` that throws a typed `ConfigurationError` (distinct from a generic error) when config is missing and mock mode is off (clause 2.15). `getSupabase()` already throws when unconfigured; upgrade that thrown error to the typed `ConfigurationError` so downstream can distinguish config failure from empty results.
3. **Production guard on mock imports (clause 2.14)**: mock JSON must only be reachable when `isMockDataEnabled()` is true. Because static `import` cannot be conditionally excluded, load mock JSON lazily (dynamic `import()` inside the mock branch) so production never serves it.

**File**: `src/services/company.service.ts` and `src/services/user.service.ts`
4. **Remove the fabricated-data path (clauses 2.13, 1.8, 1.9)**: replace `if (isSupabaseConfigured()) { …; } catch { /* fall through */ } … return mock` with: if mock mode is explicitly enabled, return mock (lazily imported) and log/mark mock mode; otherwise call `getSupabase()` and let the typed `ConfigurationError` propagate on misconfiguration. Do NOT swallow query errors into a mock fallback.

**The 10 silent-empty services** (`benchmark`, `expense`, `initiative-type`, `initiative`, `plan`, `planning`, `product`, `projection`, `result`, `task`)
5. **Distinguish config error from empty (clause 2.15)**: route their config check through `assertSupabaseConfigured()` so a misconfiguration throws a `ConfigurationError` (loud, distinct) instead of a `console.log("...returning empty")` + `return []`. A genuinely empty query result on a correctly-configured client still returns `[]` — that path is unchanged (clause 3.8). This is a mechanical swap of the guard, not a signature change.

**UI surface (clause 2.15, 2.16)**
6. **Surface both states in the UI**: where dashboards/reports read plan data, distinguish (a) a `ConfigurationError` → a visible "Configuration error" state naming config as the cause, and (b) mock mode → a visible "Mock data" banner. A legitimately empty plan continues to render its existing empty state (unchanged).

## Testing Strategy

### Validation Approach

There is no test framework or CI yet, so verification is **empirical and manual**, matching the session's pattern: real SQL queries against the Supabase project and real HTTP probes against the running app. The strategy is two-phase per defect: first surface counterexamples on the UNFIXED code that demonstrate the bug, then verify the fix produces the correct behavior and preserves everything else. Destructive DB operations on real user data require explicit user confirmation before running. After each defect lands, `npx next build` must pass with clean TypeScript and no increase over the existing 241 ESLint errors (clause 3.10).

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate each defect BEFORE implementing the fix, to confirm or refute the root-cause analysis. If refuted, re-hypothesize.

**Test Plan**: Reproduce each bug condition on the current code with a DB query or HTTP probe and observe the failure.

**Test Cases:**

*Defect 1:*
1. **Forced generation failure**: temporarily make `/api/generate-plan` return non-OK (e.g. bad payload / injected error) for a test company that has a plan, trigger a non-scratch regen, then query `annual_plans`/`initiatives`/`projections` for that company — will show wiped/zeroed data on unfixed code (validates 1.1, 1.2).
2. **Non-OK reset**: force `/api/plan/reset` to return 207/500 and observe the client proceeds into generation anyway (validates 1.3).
3. **Snapshot-write failure**: simulate a `plan_snapshots` insert failure and observe the reset deletes anyway (validates 2.4 gap).

*Defect 2:*
4. **Scan target query**: run the SQL that counts 2026 companies with `baseline_revenue = 0` AND zero projections — expect the 10 known companies (validates 1.5, 1.6, 2.7).
5. **Duplicate detection**: query initiative counts per company — expect the one company at 34 initiatives (validates 1.7, 2.12).

*Defect 3:*
6. **Missing env var**: unset `NEXT_PUBLIC_SUPABASE_URL` in a local run and call company/user reads — observe fabricated mock JSON returned with no error (validates 1.8, 1.9).
7. **Silent empty**: same misconfig, call a projection/plan read — observe `[]` + `console.log("...returning empty")`, indistinguishable from an empty plan (validates 1.10, 2.15 gap).

**Expected Counterexamples**: wiped plan two seconds after snapshot (D1); exactly 10 flagged companies + one 34-initiative company (D2); mock/empty served silently under misconfig (D3).

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed code produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition_D1(input) DO
  runRegeneration_fixed(input)
  ASSERT existingPlan(input) is byte-for-byte intact
         OR (dataRemoved(input) AND snapshotAutoRestored(input) AND outcomeReported(input))
END FOR

FOR ALL company WHERE isBugCondition_D2(company) DO
  scan := runScan()
  ASSERT company IN scan.affected AND scan.reportsRecoverability(company)
  IF confirmed recover THEN ASSERT rowsReplacedNotAppended(company) AND targetsAndProjectionsRestored(company)
  ELSE IF unrecoverable THEN ASSERT company untouched AND reportedUnrecoverable(company)
END FOR

FOR ALL request WHERE isBugCondition_D3(request) DO
  result := callService_fixed(request)
  ASSERT result is ConfigurationError (loud, distinct from empty) AND NOT fabricatedMock(result)
END FOR
```

**Verification method (empirical):**
- **D1**: with the fix in place, force a generation failure for a test company and assert (SQL) the plan is byte-for-byte intact vs. a pre-run snapshot of counts and revenue fields; separately, force a mid-reset residual state and assert the auto-restore ran and the outcome was reported (2.5).
- **D2**: run the scan (dry-run) and assert it reports the 10 companies with correct recoverability; run a confirmed recovery on one company and re-run it, asserting identical row counts both times (idempotent, 2.10); assert an unrecoverable company is skipped and reported (2.11).
- **D3**: unset an env var and assert each read raises a `ConfigurationError` (loud) rather than mock/empty; with `SAM_USE_MOCK_DATA=1` in dev, assert mock is served AND the mock banner appears in logs and UI (2.16).

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the same result as the original.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT original(input) == fixed(input)
END FOR
```

**Testing Approach**: Property-based testing is the recommended future direction (generate many inputs across the domain, catch edge cases, guarantee unchanged behavior for non-buggy inputs). Until a framework exists, preservation is verified empirically by capturing behavior on the UNFIXED code first, then re-checking after the fix.

**Test Cases:**
1. **Scratch-mode preservation (3.1)**: observe scratch regen preserves projections/targets/past initiatives on unfixed code; assert unchanged after D1 fix.
2. **Successful generation preservation (3.4)**: observe a healthy generation produces initiatives/tasks/projections, redirects, clears the draft; assert unchanged after D1 fix.
3. **Auth preservation (3.5)**: assert reset/recovery endpoints still return 401/400 without mutation.
4. **Healthy-company preservation (3.7, 3.9)**: snapshot dashboard values for a healthy company before D2 recovery; assert the scan skips it and the values are identical after.
5. **Onboarding preservation (3.6)**: assert a no-plan company is not flagged and can still generate.
6. **Manual restore preservation (3.3)**: assert history-restore still restores the targeted snapshot only, after the shared-helper extraction.
7. **Correct-config preservation (3.8)**: with valid config, capture representative service return shapes before the D3 change; assert byte-identical after — including that a legitimately empty query still returns `[]`.

### Unit Tests

(To be added when a framework is introduced; documented here as the intended coverage.)
- Reset endpoint: aborts when snapshot write fails; returns snapshot id on success.
- Generating page: aborts on non-OK reset; auto-restores on generation failure.
- Scan/recover endpoints: correct affected set, dry-run mutates nothing, idempotent recover, skip-and-report unrecoverable.
- `db.ts`: `assertSupabaseConfigured()` throws `ConfigurationError` when unconfigured; `isMockDataEnabled()` false in production even with the flag set.

### Property-Based Tests

(Future direction, aligned with the Correctness Properties.)
- D1: for random plan states, a forced generation failure leaves the plan intact or auto-restored.
- D2: restoring any recoverable snapshot twice yields identical row counts (idempotence).
- D3: for random misconfiguration shapes, reads raise a distinct configuration error and never return fabricated mock.

### Integration Tests

- **D1**: full regeneration flow (scratch and non-scratch) with an injected generation failure; assert intact/auto-restored and correct error UI.
- **D2**: scan → dry-run → confirmed recover → re-scan flow against a copy of affected companies; assert the 10 shrink to 0 recoverable-and-recovered, unrecoverable ones reported, duplicates reported not deleted.
- **D3**: boot with (a) valid config, (b) missing config, (c) dev mock opt-in; assert real data / loud config error / visible mock mode respectively, and that dashboards render the config-error state distinctly from an empty-plan state.
