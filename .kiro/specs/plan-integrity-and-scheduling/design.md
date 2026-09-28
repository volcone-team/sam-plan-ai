# Plan Integrity and Scheduling Design

## Overview

This design addresses the correctness cluster captured in `requirements.md` (Requirements 1–10, evidence D1–D8): plan generation times out against the deployment platform's request limit and leaves the customer on a blank page; generated task due dates land *after* the event they prepare for and are anchored to a hardcoded mid-month placeholder; date-only values drift a calendar day for any user behind UTC; tasks are invisible in the Weekly/Daily views unless their parent initiative happens to fall in the same window; and four cadence views are frozen to the calendar year their JavaScript chunk was parsed in.

The shape of the solution is four structural moves plus one historical repair:

1. **Split generation into small, client-orchestrated requests with a draft-then-commit boundary.** No plan table is written until a final validation-and-commit step, so a failure at any point leaves the customer's data untouched and a retry needs no manual repair (Requirements 1, 2).
2. **Move all date-only arithmetic into one pure module** with local-midnight parsing and `toISOString()`-free formatting, and route every read, write, and window comparison through it (Requirement 5).
3. **Make the schedule derivable.** One documented lead-time convention, a due date derived from the *magnitude* of the lead time subtracted from the initiative's real event date, and an event day supplied by the model rather than hardcoded (Requirements 3, 4).
4. **Give every cadence view one query path and one aggregation function.** A company-scoped, due-date-range task query plus a shared pure selector makes cross-view agreement a structural property instead of a coincidence, and a URL-backed selected year makes every view reachable (Requirements 6, 7, 8).
5. **Repair the existing rows.** The original lead time is exactly recoverable from the two stored columns, so remediation is deterministic arithmetic rather than a guess (Requirement 9).

All of the testable logic lands in pure modules so that Requirement 10 is satisfiable with the project's existing Vitest setup and no DOM harness.

**Relationship to `plan-data-integrity`.** That spec governs what happens to *existing* plan data when a regeneration fails: snapshot-before-reset, abort on a failed reset, auto-restore on a failed generation. Its Defect-1 fix is already in the code (`src/app/onboarding/generating/page.tsx` aborts on a non-OK reset at lines 150–160 and rolls back through `attemptRollback`, defined at lines 223–236 and called at 201 and 213). This design does not redesign that rollback; it repositions *when* the reset runs relative to generation so that the rollback almost never has to fire, and it keeps returning `snapshotId` to the client so the existing rollback path continues to work unchanged.

## Premise Corrections

Five statements in the surrounding brief and in `requirements.md` do not survive contact with the code. They are recorded here rather than worked around.

1. **No cadence view reports task counts or hours today.** Requirement 7 and D6 describe Year-at-a-Glance "reporting active tasks and hours for a timeframe in which Weekly and Daily report zero." `src/components/planning/year-at-a-glance.tsx` does not import `taskService` at all and never reads `estimated_hours`; its only "Active" surface is **Active initiatives** (line 926). A grep for `estimatedHours|estimated_hours` across `src/components/planning/` returns nothing but `setHours(...)` time-zeroing calls. So the contradiction reviewers saw is between *initiative* counts (Year-at-a-Glance) and *task* counts (Weekly/Daily) — which is still a real trust problem, and is still caused by D4. Consequence for this design: Requirements 7.2 and 7.3 cannot be satisfied by *repairing* an hours total, because none exists. Section D therefore **introduces** task-count and hour reporting to the monthly, quarterly, and year surfaces. That is new UI, small but non-zero, and it is in scope because Requirement 7 is otherwise unsatisfiable.
2. **The destructive-reset problem is already partly fixed.** The brief describes the flow as still calling `/api/plan/reset` before generating with no protection. The reset does still run first, but the client already aborts on a non-OK reset and already auto-restores the snapshot when generation fails. What remains wrong is the *window*: the reset is followed by a ~40 s AI call, so the customer spends 40 s with a wiped plan and depends on a rollback round trip. Section A closes the window to a couple of seconds rather than adding protection that exists.
3. **There is a fifth D4 call site.** The brief lists `weekly-planner.tsx` and `daily-planner.tsx`. `src/components/planning/calendar-view.tsx:117` runs the identical `for (const init of ...) { getTasksByInitiative(init.id) }` pattern. Leaving it would make the Calendar view disagree with the others, breaking Requirement 7.1 for that view. It is included in Section D.
4. **There is a sixth timezone-drift site.** `src/lib/format-date.ts` exports four formatters (lines 11, 25, 35, 44) that all begin `const d = new Date(date)` and accept `Date | string`. Passing a `YYYY-MM-DD` string parses as UTC midnight and renders the previous local day. This is not listed in D3 but it is the same defect on the presentation path, and it is reachable: `weekly-planner.tsx:2` and `monthly-summary-table.tsx:2` both import it.
5. **`const YEAR` count is right; `year-at-a-glance` differs in name.** Four files declare `const YEAR = new Date().getFullYear()` (`quarterly-summary-table.tsx:22`, `monthly-summary-table.tsx:22`, `monthly-planner.tsx:27`, `quarterly-planner.tsx:24`) as the brief says. `year-at-a-glance.tsx:38` declares the same expression under a different name, `CURRENT_YEAR`, and it is used for comparisons (`isViewingCurrentYear`, line 239) and defaults, not as the display year. It has the same staleness bug for those comparisons and is included in Section E.

Everything else in the brief was confirmed against the code: `maxDuration = 300` (`route.ts:10`), `max_tokens: 16000` (`route.ts:377`), the misleading 10 s comment (`route.ts:9`), the due-date bug (`route.ts:581`), the hardcoded day 1 / day 15 anchors (`route.ts:545–546`), the read mapping (`task.service.ts:358`), both write paths (`task.service.ts:222`, `:258`), `initiatives.event_date DATE` nullable and `activation_date DATE NOT NULL` (`001_initial_schema.sql:195–196`), `tasks.due_date DATE NOT NULL` (`001_initial_schema.sql:242`), one daily cron in `vercel.json`, and next free migration number **017** (016 is the highest present).

## Glossary

Terms already defined in `requirements.md` (event date, activation date, lead time, date-only value, cadence view, window, selected year, truncated generation, partial plan) are not repeated. New to this design:

- **Generation run**: a row in the new `plan_generation_runs` table representing one attempt to build a plan. Holds the accumulated draft and the phase the attempt has reached. Never read by any cadence view.
- **Draft**: the JSONB payload on a generation run — skeleton plus per-batch tasks — accumulated across phases and discarded or committed as a unit. Scratch space, not plan data.
- **Phase**: one of the three steps of a generation run (`skeleton`, `tasks`, `commit`), each a single HTTP request that must finish inside the platform request limit.
- **Commit**: the terminal phase. No AI call. Validates the draft, runs the reset, writes every plan table in batched multi-row inserts, marks the run complete.
- **Plan tables**: `annual_plans`, `initiatives`, `tasks`, `projections`, `products`, and the revenue columns on `companies` — the rows a customer's dashboard reads. `plan_generation_runs` is deliberately *not* one.
- **Client-driven orchestration**: the browser, not a server-side queue, decides when the next phase request is made. The page is the state machine driver.
- **Stale run**: a generation run left in a non-terminal phase past a fixed timeout (the customer closed the tab), eligible to be marked `abandoned`.
- **`DateOnly`**: the string type alias for a `YYYY-MM-DD` calendar day. The canonical representation at every storage and query boundary.
- **Anchor date**: the date a task's lead time is subtracted from — the initiative's `event_date`, or `activation_date` when `event_date` is null.
- **Window partition**: the property that a set of windows covering a period are disjoint and contiguous, so per-window totals sum exactly to the period total when every task is attributed by its own due date.
- **Schedule selector**: the pure aggregation layer (`src/lib/plan-schedule.ts`) that turns a flat task list plus a window into counts, hour totals, and per-month groupings. The single source of every number a cadence view displays.
- **Remediation**: the one-time correction of stored `tasks.due_date` values written by the defective calculation.

## Deployment Constraints

These are settled and form the basis of Section A. They are not open questions.

**Platform: Vercel Hobby (free).**

**Cron cadence — once per day, maximum.** Vercel's [cron jobs usage and pricing docs](https://vercel.com/docs/cron-jobs/usage-and-pricing) state that on Hobby a cron job can only run once per day, and that a more frequent expression (hourly, every 30 minutes) fails deployment with an explicit error naming the daily limit. The project already declares its one cron in `vercel.json`:

```json
{ "crons": [{ "path": "/api/cron/initiative-reminders", "schedule": "0 13 * * *" }] }
```

**Therefore a queue plus polling-cron background job is not viable.** A background worker that picks up queued generation jobs needs to poll on the order of seconds; the tightest schedule this tier permits is once every 24 hours. A customer who submits the questionnaire would wait up to a day for a plan. This is the reason the orchestration in Section A is **client-driven**: the browser drives the phase loop because the platform offers no server-side scheduler at a usable cadence.

**Function duration — target under ~50 seconds per request, declare `maxDuration = 60`.** Vercel's published Hobby ceiling has moved: older documentation states 10 s default, configurable up to 60 s, while the [current Fluid-compute changelog](https://vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute) states a 300 s default across all plans. The deployed code already declares `maxDuration = 300` (`src/app/api/generate-plan/route.ts:10`) and both reviewers still hit `FUNCTION_INVOCATION_TIMEOUT`, which proves the effective cap on *this* project is lower than 300 regardless of which documentation page applies.

The design does not attempt to discover the true number. It targets **every request completing in under ~50 seconds**, which is inside the lowest plausible configurable ceiling (60 s) and comfortably inside the highest (300 s). The fix therefore holds whether or not Fluid Compute is enabled and whatever the dashboard's Function Max Duration is set to. `maxDuration = 60` is declared on each generation route as an upper bound consistent with that target (Requirement 1.2: the declared value must not exceed what the tier enforces).

`maxDuration` is the documented route-segment config for this — confirmed in `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`: a plain `export const maxDuration = <seconds>` from a `route.ts`, which deployment platforms read out of the Next.js build output. No other Next.js API is involved.

**Source-comment correction.** `route.ts:9` reads:

```ts
// NOTE: Vercel Hobby caps functions at 10s regardless of this value; Pro honours it.
```

This is wrong in two ways and must be replaced. 10 s was the *default*, not a cap, and it was configurable up to 60 s; and the number is out of date. The replacement comment should state the design target and where the real value lives, not a number that will rot again:

```ts
// Every generation phase is sized to finish in well under 50s. The declared
// bound is 60s because the effective platform ceiling on this project is known
// to be below 300s (a 300s declaration still timed out in production) but is
// not otherwise pinned down. See Deployment Constraints in
// .kiro/specs/plan-integrity-and-scheduling/design.md
export const maxDuration = 60;
```

**Operator verification (one-time, before implementation lands).** Confirm in the Vercel dashboard under **Settings → Functions**: (a) the **Function Max Duration** value configured for the project, and (b) whether **Fluid Compute** is enabled. Record both in this section. If the configured maximum turns out to be below 50 s, the phase-2 batch size in Section A drops from 2 initiatives to 1; nothing else in the design changes. This is the only parameter in the design that depends on the answer, which is deliberate.

## Architecture

Two independent paths carry the correctness weight: the **write path** that produces a plan, and the **read path** that displays it. They share nothing but the plan tables, and each gets one structural guarantee.

### Write path — generation

The browser is the state machine driver; the server exposes one short request per phase. Nothing reaches a plan table until the final request.

```
 client (generating/page.tsx)                server                        database
 ────────────────────────────                ──────                        ────────
  POST /start          ──────────►  create run row                  plan_generation_runs
                       ◄──────────  { runId, batchTotal, phase }        (scratch only)
        │
        │  phase 1: skeleton          AI call, max_tokens 5000
  POST /tasks          ──────────►  draft.skeleton               ──►  runs.draft
                       ◄──────────  { phase, batchCursor, batchTotal }
        │
        │  phase 2: loop while batchCursor < batchTotal
  POST /tasks  ×N      ──────────►  AI call, max_tokens 3000     ──►  runs.draft.tasksByBatch[n]
                       ◄──────────  { phase, batchCursor, batchTotal }
        │
        │  phase 3: commit — no AI call
  POST /commit         ──────────►  validateDraft
                                      ├─ fail ─────────────────►  nothing written, run failed
                                      └─ pass ─► snapshot ─► reset ─► batched inserts
                       ◄──────────  { success, snapshotId, counts }    PLAN TABLES
```

The draft boundary sits between phase 2 and phase 3. Everything to its left is scratch space on a `plan_generation_runs` row; everything to its right happens inside a single invocation whose duration is bounded by database round trips alone (~2–4 s). Detail in **A.1**–**A.5**; run states and resume-versus-restart in **A.3**; the batched-insert shape in **A.5**.

### Read path — cadence views

Every cadence view is a projection of one query through one pure selector. No view computes its own window math, its own task set, or its own totals.

```
   ?year=  ──►  useSelectedYear()  ──►  selectedYear
                                            │
                                            ▼
                              windowFor{Day,Week,Month,Quarter,Year}
                                            │
                                            ▼
        getTasksByCompanyDueBetween(companyId, w.start, w.end)   ← one company-scoped
                                            │                      due-date range query
                                            ▼
                    plan-schedule.ts: tasksInWindow / summarise / groupByMonth
                                            │
        ┌───────────┬───────────┬───────────┼───────────┬───────────┬───────────┐
      Daily      Weekly     Calendar     Monthly    Quarterly   Summary     Year-at-
                                                                 tables    a-Glance
```

The task's own `due_date` is the sole membership criterion; the parent initiative is not in the predicate, which is what makes a task visible in the window it is actually due in. Detail in **D.1**–**D.4**. The selected year has exactly one input — the `?year=` search param, read per render through one hook — so there is no second source of truth to go stale or disagree. Detail in **E.1**–**E.6**.

### The two invariants this architecture buys

1. **Nothing reaches the plan tables until commit.** Phases 1 and 2 are where the AI calls live and therefore where essentially all failures happen, and they write only to `plan_generation_runs.draft`. A failure there leaves the customer's existing plan byte-for-byte untouched, so a retry needs no repair and a partial plan cannot exist (Requirements 1.4, 2.5). This is a property of the request topology, not of cleanup code.
2. **No view can disagree with another, because they share the selector.** Two views showing the same period are not independently arriving at matching numbers; they are reading the same numbers out of the same pure function over the same rows. Divergence is not detectable-by-test, it is unrepresentable (Requirements 7.1–7.4, 7.7).

Both invariants replace a per-site discipline with a structural one, which is the same reason the seven private copies of the window math in **B.3** are consolidated rather than individually corrected.

## A. Chunked generation with draft-then-commit

**Satisfies: Requirements 1.1–1.6, 2.1–2.6.** (2.7 is covered in Section D, since it concerns cadence-view load failures rather than generation.)

### A.1 Why chunking, and why the draft boundary matters more than the chunking

Two separate problems hide behind the single `FUNCTION_INVOCATION_TIMEOUT`:

- **Duration.** One Anthropic call with `max_tokens: 16000` (`route.ts:377`) routinely runs 60–120 s, and the persistence block that follows it adds tens of sequential round trips (A.5).
- **Atomicity.** `/api/generate-plan` writes straight into the live rows as it goes: `annual_plans` at 7a (line 417), `products` at 7b (line 430), `initiatives` and `tasks` at 7d (line 509), `projections` at 7e (line 599), `companies` at 7f (line 654). A timeout partway through 7d leaves some initiatives written and the rest missing — exactly the "partial plan" Requirement 2.5 forbids, and exactly the state Requirement 1.4 says a retry must not have to repair by hand.

Chunking alone fixes duration. It makes atomicity *worse*, because more requests means more places to fail halfway. So the design pairs chunking with a draft boundary: **phases 1 and 2 write only to a scratch draft; phase 3 is the only phase that touches a plan table.** That single rule is what satisfies 2.5 and 1.4, and it is the load-bearing decision in this section.

### A.2 The three phases

| Phase | AI call | Token budget | Writes to | Expected duration |
| --- | --- | --- | --- | --- |
| 1 — skeleton | one | `max_tokens: 5000` | `plan_generation_runs.draft` only | ~15–25 s |
| 2 — tasks (repeated) | one per batch | `max_tokens: 3000` | `plan_generation_runs.draft` only | ~8–15 s each |
| 3 — commit | none | — | all plan tables, once | ~2–4 s |

**Phase 1 — skeleton.** One call producing the annual plan financials (`baselineRevenue`, `stretchRevenue`, `operatingBudget`), the initiative list with its scheduling and revenue fields, and the three `monthlyProjections` arrays — and **no tasks**. The `tasks` array is removed from the phase-1 schema in the prompt entirely, along with the "max 4 tasks per initiative" guidance (`route.ts:127`). This is the bulk of the token reduction: the task lists are the largest part of a 16k completion.

**Phase 2 — tasks, batched.** One call per batch of initiatives, asking only for that batch's tasks. The prompt for this phase carries the batch's initiative names, kinds, channels, event dates, and the questionnaire's team-size/hours constraints — not the whole workbook context. Batch size **2**, giving 2–4 batches for the 4–8 initiatives the prompt asks for (`route.ts:116`). The client loops until `batch_cursor === batch_total`, and each response drives the progress UI (A.7).

**Phase 3 — commit.** No AI call, so its duration is bounded by database round trips alone. It validates the accumulated draft (A.6), runs the reset (A.4), writes every plan table in batched inserts (A.5), and marks the run `complete`.

Total AI-bearing requests for a typical 6-initiative plan: 1 + 3 = 4, none of them near the ceiling. The token-budget bound Requirement 1.5 asks for is per-phase and explicit: 5000 for the skeleton, 3000 per task batch.

### A.3 The run record: states and transitions

The accumulated draft lives on a new `plan_generation_runs` row (schema in **Data Models**), not in the plan tables. `phase` is the state:

```
                      ┌──────────────────────── failed ◄──────────────────┐
                      │                                                   │
  (start) ──► skeleton_pending ──► tasks_pending ──► commit_pending ──► complete
                      │                 │                   │
                      └──────► abandoned ◄──────────────────┘   (stale, or superseded)
```

| Transition | Trigger | Effect on plan tables |
| --- | --- | --- |
| → `skeleton_pending` | `POST /api/generate-plan/start` creates the run | none |
| `skeleton_pending` → `tasks_pending` | phase 1 returns valid JSON; `draft.skeleton` and `batch_total` set | none |
| `tasks_pending` → `tasks_pending` | a batch succeeds; `batch_cursor` incremented, `draft.tasksByBatch[n]` appended | none |
| `tasks_pending` → `commit_pending` | `batch_cursor === batch_total` | none |
| `commit_pending` → `complete` | commit validated and all writes succeeded | fully written |
| any `*_pending` → `failed` | truncation, parse failure, schema-validation failure, AI error, or an error thrown inside commit | none, unless the failure was inside commit after the reset (see A.4) |
| any `*_pending` → `abandoned` | run is older than the stale timeout, or a new `start` supersedes it | none |

Rules:

- **One active run per company.** `start` first marks any non-terminal run for the company `abandoned`, then inserts the new one. This makes a customer who reloads the page mid-generation safe: the old run is abandoned, not raced.
- **Stale timeout: 30 minutes.** A run in a `*_pending` phase whose `updated_at` is older than 30 minutes is treated as `abandoned` by every reader, and is marked so lazily — on the next `start` or `status` call for that company. No cron is needed (and, per Deployment Constraints, none is available at a useful cadence).
- **Retry semantics.** The error screen's "Try again" offers two paths, and the design specifies both rather than leaving it implicit:
  - **Resume** when the run is non-terminal, not stale, and has at least a valid skeleton (`phase = tasks_pending` or `commit_pending`). `GET /api/generate-plan/status?runId=` returns `{ phase, batchCursor, batchTotal }` and the client re-enters the loop at `batchCursor`. The already-generated skeleton and completed batches are reused, so a retry costs only the batches that did not finish. Because no plan table has been written, resuming is always safe.
  - **Restart** in every other case (`phase = failed`, or stale, or the skeleton itself failed). A fresh `start` abandons the old run. Nothing needs cleaning up, because nothing outside the run record was written — this is Requirement 1.4, and it holds by construction rather than by careful cleanup code.
- **Pruning.** `start` also deletes this company's terminal runs (`complete` / `failed` / `abandoned`) older than 7 days. Opportunistic, no scheduler.

### A.4 Where the reset now sits

Today: `reset` → `generate` (`generating/page.tsx`, reset at line 145, generate at line 174). The customer's plan is destroyed and then a ~40 s AI call decides whether they get a new one. `plan-data-integrity` made that survivable (abort on non-OK reset, `attemptRollback` on failure) but could not make it short.

**New ordering: phase 1 → phase 2 (all batches) → reset → write, with the reset and the write inside the single commit request.**

```
client:  start ─────► tasks ─► tasks ─► tasks ─────► commit
                                                      │
server (commit, one invocation):  snapshot ─► reset ─► batched writes ─► complete
```

Consequences:

- A failure in phase 1 or phase 2 — which is where essentially all failures happen, because that is where the AI calls are — **never touches the customer's data at all.** The reset has not run. There is nothing to roll back. This is the substantive improvement over the current flow.
- The residual window where data is deleted but the new plan is not yet written shrinks from ~40 s (a network call to Anthropic) to ~2–4 s (a handful of local database round trips inside one invocation).
- The commit route calls the reset logic **server-side**, by extracting the body of `src/app/api/plan/reset/route.ts` into a shared helper. That route currently returns `{ success, snapshotId, snapshotLabel }` (line 207) or a 207 with the same fields (line 203); the helper keeps that shape.
- **The existing rollback path is preserved, not replaced.** The commit response includes `snapshotId` on both success and failure, so `attemptRollback(rollbackSnapshotId)` in `generating/page.tsx` (defined at lines 223–236) continues to work with no change to its logic — only to where the snapshot id comes from. Scratch-mode regeneration (`sam-regen-mode === "scratch"` → `/api/plan/reset-scratch`) keeps its selective behaviour; the commit helper picks the same endpoint logic the client picks today (`generating/page.tsx:139–141`). Rollback correctness, snapshot labelling, and the 207 partial-delete semantics are **owned by `plan-data-integrity`** and are not redesigned here.
- The reset must stay year-scoped. `generating/page.tsx:132–137` reads `sam-plan-target-year` and appends `?year=` (line 141); the commit request carries `targetYear` from the run record instead of from localStorage, which also removes the "flag consumed before generation" fragility noted in that file's comments.

### A.5 Fixing the write path's latency

Step 7d (`route.ts:509–597`) inserts one initiative, awaits it, then inserts each of its tasks one at a time, awaiting each. For 8 initiatives with 4 tasks each that is 8 + 32 = **40 sequential round trips**, plus 3 more for projections (7e) and the per-channel `initiative_types` insert inside the loop (line 515). At even 80 ms each that is well over three seconds of pure serialisation, and it is a material contributor to the timeout — and, worse, it is the part of the flow where a timeout produces a partial plan.

Commit uses batched multi-row inserts:

```ts
// Generate ids client-side so task rows can reference their initiative without
// depending on the order Postgres returns from a multi-row INSERT ... RETURNING.
const initiativeRows = draft.skeleton.initiatives.map((init) => ({
  id: crypto.randomUUID(),
  company_id: companyId,
  annual_plan_id: annualPlanId,
  /* ...as today, but activation_date / event_date from Section C... */
}));

const taskRows = draft.skeleton.initiatives.flatMap((init, i) =>
  tasksFor(init).map((task, order) => ({
    initiative_id: initiativeRows[i].id,
    company_id: companyId,
    due_date: computeTaskDueDate(anchorFor(initiativeRows[i]), task.daysBeforeEvent),
    /* ... */
  }))
);

const { error: initErr } = await supabase.from("initiatives").insert(initiativeRows);
if (initErr) throw new Error("Failed to save initiatives: " + initErr.message);
const { error: taskErr } = await supabase.from("tasks").insert(taskRows);
if (taskErr) throw new Error("Failed to save tasks: " + taskErr.message);
```

Round-trip count in commit drops from ~45 to roughly 10: one `products` select, the product upserts (bounded by the questionnaire's product count, typically 1–3), one `initiative_types` select, **one** initiatives insert, **one** tasks insert, one projections delete plus **one** three-row projections insert (replacing the per-scenario loop at `route.ts:616–652`), one `annual_plans` update, one conditional `companies` update, one event log. Generating ids with `crypto.randomUUID()` rather than trusting `RETURNING` order also removes a correctness assumption the current code would have needed if it batched naively.

The unknown-channel `initiative_types` insert currently sits inside the per-initiative loop (`route.ts:514–535`). Commit hoists it: collect the distinct channels in the draft, diff against the existing types selected once, insert the missing ones in one batch, then map.

### A.6 Truncation and validation

**Requirement 2.4 — truncation is a failure, not a log line.** `route.ts:391` currently detects `stop_reason === "max_tokens"` and only `console.error`s, then falls through into `JSON.parse`. Every phase now treats it as terminal:

```ts
if (response.stop_reason === "max_tokens") {
  await failRun(runId, "truncated", `Phase ${phase} exhausted its token budget`);
  return NextResponse.json(
    { error: "The AI response was cut off before it finished.", code: "GENERATION_TRUNCATED", runId },
    { status: 422 }
  );
}
```

The same treatment applies to a `JSON.parse` failure and to the markdown-fence fallback failing (`route.ts:400–415`). All three mark the run `failed` and return a machine-readable `code` so the client can name the failure (Requirement 2.2).

**Requirement 1.6 and 2.6 — nothing dropped, nothing over-reported.** Commit validates the draft before its first write and refuses to write anything if validation fails:

| Check | Requirement |
| --- | --- |
| `batch_cursor === batch_total` | 1.6 — every batch the skeleton called for actually completed |
| every initiative in the skeleton has ≥ 1 task in the draft | 1.6, 2.6 |
| each of `good` / `better` / `best` has exactly `planMonths` numeric entries | 1.6, 2.6 |
| every initiative's `productIndex` resolves to a product | 2.6 |
| `annualPlan` has three finite numbers | 2.6 |

A failed check marks the run `failed` **before the reset runs**, returns 422, and writes nothing (2.5). On success, commit's response reports what it actually wrote — `{ initiativesCreated, tasksCreated, projectionsCreated }` counted from the inserted arrays, not from the draft — so a success response cannot claim more than was persisted (2.6).

### A.7 Progress and failure UI

**Requirement 2.1, 2.3.** `generating/page.tsx` currently cycles nine canned messages on an 1800 ms timer (`GENERATION_MESSAGES`, `MESSAGE_DURATION`) and drives a `ProgressBar` with a hardcoded `estimatedMs={35000}` (line 331). That fabricated progress is why a platform timeout produced a blank page: the page had no model of where generation actually was.

The page becomes the phase state machine. Progress is derived from real state — `phase`, `batchCursor`, `batchTotal` — so the indicator names the active operation truthfully: "Building your plan outline", then "Planning the work for initiative 3 of 6", then "Saving your plan". The canned message list is retained only as flavour *within* a phase, not as the progress signal.

Failure handling: every phase request either resolves with a 2xx or produces an error state with a code. Because the page owns the loop, a rejected fetch, a non-2xx status, an empty body, and a gateway timeout all land in the same error branch that already exists (`!res.ok` at line 190 and the outer `catch` at 211) — which is what removes the blank page (2.3). The error screen already offers "Try again" and "Skip for now"; "Try again" now calls resume-or-restart per A.3. The existing `raw`-text-first parsing (line 182) is kept: it is why a non-JSON gateway response still yields a message.

### A.8 Route layout

The single `POST /api/generate-plan` becomes four handlers plus a shared library. Route Handler conventions confirmed in `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`: `route.ts` under `app/`, one exported function per HTTP method, `POST`/`GET` both supported, not cached by default for non-`GET` methods, `NextResponse` available for convenience. Nothing exotic is used.

```
src/app/api/generate-plan/start/route.ts     POST  → { runId, batchTotal, phase }
src/app/api/generate-plan/tasks/route.ts     POST  { runId } → { phase, batchCursor, batchTotal }
src/app/api/generate-plan/commit/route.ts    POST  { runId } → { success, snapshotId, counts }
src/app/api/generate-plan/status/route.ts    GET   ?runId= → { phase, batchCursor, batchTotal, error }

src/lib/plan-generation/prompts.ts           buildSkeletonPrompt / buildTaskBatchPrompt
src/lib/plan-generation/schema.ts            draft types + validateDraft
src/lib/plan-generation/runs.ts              run record CRUD, state transitions, staleness
src/lib/plan-generation/commit.ts            reset + batched writes
```

Each of the four routes declares `export const maxDuration = 60` and repeats the existing `requirePlanEditor()` guard (`route.ts:143`) plus a check that the run belongs to the caller's company — a `runId` from another company must 403, since the run id is the only thing the client holds. The existing `POST /api/generate-plan` file is removed rather than left as a shim: it is only called from `generating/page.tsx:174`, so there is no external caller to keep compatible.

### A.9 Rejected alternatives

- **Queue plus cron polling.** A `generation_jobs` table and a worker route invoked by cron. Rejected outright by the platform: Hobby crons run at most once per day (Deployment Constraints), so the worker could not pick up a job in under 24 hours. Viable on Pro, and the natural design there — recorded so that a tier upgrade has an obvious migration path.
- **Edge-runtime streaming.** `export const runtime = 'edge'` and stream the Anthropic response so the connection stays alive past the normal function limit. Rejected for two reasons. It does not address atomicity at all — a stream that dies at 80% still leaves the persistence step half-done, so Requirement 2.5 remains unsatisfied and the real problem is untouched. And it constrains the runtime: the Edge runtime is a different execution environment from Node, which means revalidating the `@supabase/ssr` server client and the Anthropic SDK against it for no correctness benefit. Streaming is a duration trick; the defect is a durability one.
- **Single call with a smaller token budget.** Drop `max_tokens` from 16000 to, say, 6000 and keep everything else. Simpler than chunking, and would probably stop most timeouts. Rejected because the bound is still unenforced — a 6000-token completion that runs slow still hits the ceiling, and nothing tells the code it is about to — and because it buys the time back by shrinking the plan, which trades Requirement 1 against Requirement 1.6 ("with none dropped to meet the time or token bound"). It also leaves the partial-write problem completely untouched.
- **Raising `maxDuration` alone.** Already proven insufficient: the deployed code declares 300 and still timed out (`route.ts:10`). Kept in the list because it is the first thing anyone will suggest.
- **A database transaction around the whole flow.** Wrap reset and write in one transaction. Not available cleanly through the Supabase JS client used here, and `plan-data-integrity` already rejected it for the same reason. The draft boundary gets most of the benefit: the only non-atomic stretch left is the 2–4 s inside commit, covered by the existing snapshot rollback.

## B. Date-only value handling

**Satisfies: Requirements 5.1–5.8.**

### B.1 The decision: keep `Date` in the domain type, make `DateOnly` canonical at every boundary

`requirements.md` lists this as an open decision ("whether date-only values move to a string-based representation app-wide, or keep `Date` with explicit local-timezone parsing helpers"). **Resolved: a hybrid, weighted by blast radius.**

- `Task.dueDate` stays `Date` in the domain type. Every comparison, sort, and formatter in the components already treats it as a `Date` (`weekly-planner.tsx:210,221`, `daily-planner.tsx:169`, `calendar-view.tsx`, `initiative-tasks.tsx`, `initiative-project-plan.tsx`). Flipping the type would touch every one of them and produce no correctness gain, because once the *parse* is local-midnight the existing `getMonth()`/`getDate()` reads are already correct.
- **`DateOnly` strings are canonical at the storage boundary and inside all pure logic.** Every read parses `YYYY-MM-DD` to a *local* midnight `Date`; every write formats a `Date` to `YYYY-MM-DD` on *local* calendar fields; every window comparison and every query predicate is done on `DateOnly` strings, never on `Date` objects.

Why not strings app-wide: it is the theoretically cleaner answer and the right long-term target, but it is a ~15-file type change across components that would land simultaneously with the generation rewrite and the cadence-view rewrite. The hybrid gets all eight clauses of Requirement 5 by changing the *two* functions that touch the boundary in `task.service.ts` plus the formatters, and leaves the larger refactor available later. Recorded as a deliberate deferral, not an oversight.

Why the local-midnight parse is sufficient: `new Date("2026-08-31")` is specified to parse as UTC midnight, which in `America/New_York` (UTC−4/−5) is 2026-08-30 20:00 local — so `getDate()` returns 30. `new Date(2026, 7, 31)` is local midnight, and `getDate()` returns 31 in every timezone. There is no remaining UTC involvement, so clauses 5.2, 5.3, 5.6, and 5.7 hold for every offset, not just for Eastern.

### B.2 New module: `src/lib/plan-dates.ts`

Pure, dependency-free, no `toISOString()` anywhere in the file.

```ts
/** A calendar day with no time component, exactly `YYYY-MM-DD`. */
export type DateOnly = string;

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse a date-only string to LOCAL midnight. Never UTC. */
export function parseDateOnly(value: DateOnly): Date {
  const m = RE.exec(value);
  if (!m) throw new RangeError(`Not a date-only value: ${value}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Format a Date as its LOCAL calendar day. Deliberately not toISOString(). */
export function toDateOnly(d: Date): DateOnly {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isDateOnly(value: unknown): value is DateOnly {
  return typeof value === "string" && RE.test(value);
}

export function todayDateOnly(): DateOnly {         // evaluated per call, never cached
  return toDateOnly(new Date());
}

/** Day arithmetic. setDate handles month and year rollover natively. */
export function addDays(value: DateOnly, n: number): DateOnly {
  const d = parseDateOnly(value);
  d.setDate(d.getDate() + n);
  return toDateOnly(d);
}
export function subDays(value: DateOnly, n: number): DateOnly {
  return addDays(value, -n);
}

/** Difference in whole calendar days, b - a. */
export function diffDays(a: DateOnly, b: DateOnly): number;

/** Membership. Lexicographic comparison is valid for zero-padded YYYY-MM-DD. */
export function isSameDay(a: DateOnly, b: DateOnly): boolean { return a === b; }
export function isWithin(value: DateOnly, start: DateOnly, end: DateOnly): boolean {
  return value >= start && value <= end;          // inclusive both ends (5.8, 6.6)
}

/** Window construction, all on local calendar days. */
export function startOfWeek(value: DateOnly, weekStartsOn?: 0 | 1): DateOnly;
export function endOfWeek(value: DateOnly, weekStartsOn?: 0 | 1): DateOnly;
export function startOfMonth(year: number, month: number): DateOnly;   // month is 1-12
export function endOfMonth(year: number, month: number): DateOnly;
export function daysInMonth(year: number, month: number): number;      // month is 1-12
export function clampDayToMonth(year: number, month: number, day: number): number;
export function weeksInMonth(year: number, month: number, weekStartsOn?: 0 | 1)
  : { start: DateOnly; end: DateOnly }[];
```

Two notes on the implementation that matter for correctness:

- `addDays` delegating to `Date.prototype.setDate` is what makes 5.6, 5.7, and Requirements 3.9/3.10 (month and year rollover) correct without any manual month-length arithmetic. `new Date(2026, 8, 14).setDate(14 - 14)` → `setDate(0)` → 2026-08-31, which is exactly the case Requirement 3.9 names as the thing not to get wrong.
- `isWithin` uses string comparison rather than `Date` comparison. Zero-padded `YYYY-MM-DD` sorts lexicographically in calendar order, so this is exact and has no time-of-day edge (the current `weekly-planner.tsx:68` has to do `setHours(23,59,59,999)` on the window end precisely because it compares `Date` objects; that workaround disappears).

### B.3 Every call site that must change

**`src/services/task.service.ts` — the read mapping and both write paths:**

| Line | Today | Becomes |
| --- | --- | --- |
| 358 | `dueDate: new Date(row.due_date as string)` | `dueDate: parseDateOnly(row.due_date as string)` |
| 222 | `due_date: dto.dueDate instanceof Date ? dto.dueDate.toISOString().split('T')[0] : dto.dueDate` | `due_date: dto.dueDate instanceof Date ? toDateOnly(dto.dueDate) : dto.dueDate` |
| 258 | same expression in `updateTask` | same replacement |
| 133 | `.gte('due_date', new Date().toISOString().split('T')[0])` (upcoming) | `.gte('due_date', todayDateOnly())` |
| 155 | `.lt('due_date', new Date().toISOString().split('T')[0])` (overdue) | `.lt('due_date', todayDateOnly())` |
| 177–178 | `.gte(..., startDate.toISOString().split('T')[0])` / `.lte(...)` | `.gte(..., toDateOnly(startDate))` / `.lte(..., toDateOnly(endDate))` |

Line 262 (`completed_at: ...toISOString()`) is **correct as written** and must not be changed: `completed_at` is `TIMESTAMPTZ` (`001_initial_schema.sql:250`), an instant, not a calendar day. The rule is per-column, not global — only `DATE` columns go through `plan-dates`.

**`src/services/initiative.service.ts:220–221`** — `getInitiativesByDateRange` converts its bounds with `toISOString().split('T')[0]` against `activation_date` and `event_date`, both `DATE` columns (`001_initial_schema.sql:195–196`). Same replacement. Left uncorrected, the monthly and quarterly summary tables would pull the wrong initiative set at month boundaries even after the task path is fixed.

**`src/app/api/generate-plan/route.ts`** — the three generation formatters:

| Line | Today | Becomes |
| --- | --- | --- |
| 545 | `new Date(actualYear, actualMonth, 1).toISOString().split("T")[0]` | `startOfMonth(actualYear, actualMonth + 1)` |
| 546 | `new Date(actualYear, actualMonth, 15).toISOString().split("T")[0]` | the anchored event date from Section C |
| 582 | `dueDate.toISOString().split("T")[0]` | `computeTaskDueDate(...)`, which already returns a `DateOnly` |

These matter more than they look: Vercel functions run with `TZ=UTC`, so `new Date(y, m, 15).toISOString()` currently yields the 15th in production — but the same code run locally in any UTC+ timezone yields the **14th**. That is a silent dev/prod divergence in the data being written, and it disappears once the formatting never round-trips through UTC.

**`src/lib/format-date.ts`** — all four exported formatters (lines 11, 25, 35, 44) accept `Date | string` and start with `const d = new Date(date)`. When handed a `YYYY-MM-DD` string they render the previous local day. Fix by normalising at the top of each:

```ts
function coerce(date: Date | string): Date {
  return isDateOnly(date) ? parseDateOnly(date) : new Date(date);
}
```

This is the sixth drift site noted in Premise Corrections. It is not named in D3 but it is reachable from `weekly-planner.tsx:2` and `monthly-summary-table.tsx:2`, and it is the one a reviewer would actually *see*.

**Per-component window helpers — delete and replace.** Each cadence view carries a private copy of the window math, all of it `Date`-based:

| File:line | Helper | Replaced by |
| --- | --- | --- |
| `weekly-planner.tsx:56` | `getWeekStart` | `startOfWeek` |
| `daily-planner.tsx:79` | `isSameDay` | `isSameDay` (string) |
| `daily-planner.tsx:85` | `getWeekStart` | `startOfWeek` |
| `calendar-view.tsx:40` | `isSameDay` | `isSameDay` (string) |
| `monthly-planner.tsx:53` | `getWeeksInMonth` | `weeksInMonth` |
| `monthly-summary-table.tsx:33` | `getMonthDateRange` | `windowForMonth` (Section D) |
| `quarterly-planner.tsx:46` | `getQuarterDateRange` | `windowForQuarter` (Section D) |
| `quarterly-summary-table.tsx:39` | `getQuarterDateRange` | `windowForQuarter` (Section D) |

Seven private implementations of the same arithmetic is why D3 and D6 could coexist: fixing one view's boundary handling had no effect on the others. Consolidating them is a precondition for Section D's consistency guarantee, not a tidiness exercise.

### B.4 How each clause of Requirement 5 is satisfied

| Clause | Mechanism |
| --- | --- |
| 5.1, 5.2, 5.3 | `parseDateOnly` builds a local-midnight `Date` from calendar fields; no UTC interpretation exists on the read path |
| 5.4 | `toDateOnly` reads `getFullYear/getMonth/getDate`, so the persisted day is the local day |
| 5.5 | Round-trip is `toDateOnly(parseDateOnly(s)) === s` by construction, for any `TZ` |
| 5.6, 5.7 | `addDays`/`subDays` roll over via `setDate` on local fields; a task on the 1st has `dueDate.getMonth()` equal to that month in every timezone |
| 5.8 | All window membership goes through `isWithin`, inclusive on both ends, on `DateOnly` strings |

## C. Lead-time convention and event anchoring

**Satisfies: Requirements 3.1–3.10, 4.1–4.8.**

### C.1 The convention

> **`daysBeforeEvent` is a non-negative count of days before the initiative's event date.** `21` means the task is due 21 days before the event. `0` means the task is due **on** the event date. Negative values are not part of the convention; if one arrives its magnitude is used.

Requirement 3.6 requires this statement to appear identically in two places that currently contradict each other:

- **`src/app/api/generate-plan/route.ts:94`** documents `"daysBeforeEvent": number` with no sign convention at all. The phase-1 and phase-2 prompts both carry the sentence above verbatim, plus an example: `"daysBeforeEvent": 14 means the task is due 14 days BEFORE the event. Use 0 for a task due on the event day. Never use negative numbers."`
- **`src/types/initiative-type.types.ts:31`** documents the opposite:
  ```ts
  daysBeforeEvent: number; // relative to event date (e.g., -21 for 21 days before)
  ```
  becomes
  ```ts
  /**
   * Non-negative count of days BEFORE the event date.
   * 21 = due 21 days before the event. 0 = due on the event date.
   * See Section C of .kiro/specs/plan-integrity-and-scheduling/design.md
   */
  daysBeforeEvent: number;
  ```

The convention is chosen as non-negative-days-before rather than signed-offset because the field is *named* `daysBeforeEvent`; a negative value in a field with that name is self-contradictory, which is precisely how the two docs drifted apart.

### C.2 The calculation

New pure module `src/lib/plan-schedule-math.ts` (or co-located in `plan-dates.ts`; either is fine, it must be importable by both the route and a test with no Supabase dependency):

```ts
export const DEFAULT_LEAD_DAYS = 7;
export const MAX_LEAD_DAYS = 365;

/**
 * Resolve a model-supplied lead time to a usable non-negative day count.
 * - missing / non-numeric / non-finite  -> DEFAULT_LEAD_DAYS      (Req 3.8)
 * - wrong sign                          -> magnitude              (Req 3.7)
 * - fractional                          -> truncated toward zero
 * - absurd                              -> clamped to MAX_LEAD_DAYS
 */
export function resolveLeadDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LEAD_DAYS;
  return Math.min(Math.trunc(Math.abs(n)), MAX_LEAD_DAYS);
}

/** Due date = anchor - |lead|. Always on or before the anchor. (Req 3.1, 3.4, 3.5) */
export function computeTaskDueDate(anchor: DateOnly, rawLead: unknown): DateOnly {
  return subDays(anchor, resolveLeadDays(rawLead));
}
```

`route.ts:581` — `new Date(actualYear, actualMonth, 15 + (task.daysBeforeEvent || 0))` — is replaced by `computeTaskDueDate(anchor, task.daysBeforeEvent)`. The two bugs in that line die separately: the `+` becomes a subtraction inside `subDays`, and the `15` is replaced by a real anchor (C.3).

How each clause falls out:

| Clause | Mechanism |
| --- | --- |
| 3.1 | `subDays(anchor, lead)` |
| 3.2 | `subDays("2026-09-14", 14)` → `setDate(14 - 14)` → `setDate(0)` → `2026-08-31` |
| 3.3 | `subDays("2026-09-14", 20)` → `setDate(-6)` → `2026-08-25` |
| 3.4 | `resolveLeadDays` returns ≥ 0 and the operation is always subtraction, so the result is always ≤ anchor. There is no input that produces a later date. |
| 3.5 | `resolveLeadDays(0) === 0` → `subDays(anchor, 0) === anchor` |
| 3.6 | C.1 — same wording in the prompt and the type doc |
| 3.7 | `Math.abs`. A model that returns `-21` under the old convention still produces a task 21 days early. The sign is never trusted. |
| 3.8 | `Number.isFinite` guard → `DEFAULT_LEAD_DAYS = 7`, which is still a subtraction, so the result is still on or before the anchor |
| 3.9, 3.10 | `setDate` rollover inside `addDays` (Section B.2); `subDays("2027-01-05", 10)` → `2026-12-26` |

`MAX_LEAD_DAYS` is not required by any clause. It is included as a documented decision: a model that emits `1e9` would otherwise place a task tens of thousands of years back, which is indistinguishable from corruption in the UI. Clamping to a year keeps the failure legible. Recorded here so it is not mistaken for accidental scope.

### C.3 Event anchoring

**The current state makes Requirement 4 unsatisfiable server-side.** The AI schema returns only `activationMonth` (`route.ts:83`), an offset into the plan period. The server then invents both dates (`route.ts:545–546`):

```ts
const activationDate = new Date(actualYear, actualMonth, 1).toISOString().split("T")[0];
const eventDate      = new Date(actualYear, actualMonth, 15).toISOString().split("T")[0];
```

Day 15 is a placeholder with no relationship to when anything happens. No amount of server-side arithmetic can recover the real event day from data that never contained it. **The generation schema must be extended.**

**Schema extension.** Two optional fields are added to the initiative object in the phase-1 prompt:

```
"activationMonth": number (1-${planMonths}),   // unchanged: when work begins
"eventMonth":      number (1-${planMonths}),   // NEW, optional, defaults to activationMonth
"eventDay":        number (1-31),              // NEW, optional: day of eventMonth the initiative happens
```

with prompt guidance: *"`eventDay` is the day of the month the initiative actually happens — the webinar airs, the campaign sends, the challenge starts. For an evergreen initiative with no single event, omit both fields."*

`eventMonth` is included, not just `eventDay`, because without it Requirements 4.6 and 4.7 (event in a different calendar month or year from activation) would be satisfied only vacuously — the generator could never produce such an initiative, so the clauses would describe untested code. With `eventMonth` the case is real and testable. It costs one prompt line.

**Server-side resolution and clamping:**

```ts
const activationMonthIdx = (init.activationMonth || 1) - 1;
const eventMonthIdx = Number.isFinite(init.eventMonth)
  ? Math.max(Math.trunc(init.eventMonth) - 1, activationMonthIdx)  // an event before work starts is nonsense
  : activationMonthIdx;                                            // default: same month

const { year: evYear, month: evMonth } = offsetMonth(startYear, startMonth, eventMonthIdx); // month 1-12

export const DEFAULT_EVENT_DAY = 15;
const rawDay = Number.isFinite(init.eventDay) ? Math.trunc(init.eventDay) : DEFAULT_EVENT_DAY;
const eventDay = clampDayToMonth(evYear, evMonth, rawDay);  // 31 in Feb 2027 -> 28

const eventDate: DateOnly = `${evYear}-${pad(evMonth)}-${pad(eventDay)}`;
```

`clampDayToMonth` clamps into `[1, daysInMonth(year, month)]`, so `eventDay: 31` against February 2027 yields the 28th rather than rolling into March — which is the failure mode `new Date(y, 1, 31)` would produce silently.

`activation_date` stays day 1 of the activation month, unchanged and now documented as "work on this initiative begins at the start of its activation month." Requirement 4 says nothing about the activation *day*, and changing it would alter the initiative-window filters in `getInitiativesByDateRange` for no required benefit.

**Fallback anchor (Requirements 4.4, 4.5).** A pure function, used identically by generation, by the cadence views, and by remediation:

```ts
/** The date a task's lead time is subtracted from. */
export function anchorFor(i: { eventDate: DateOnly | null; activationDate: DateOnly }): DateOnly {
  return i.eventDate ?? i.activationDate;   // documented fallback: the activation date
}
```

`activation_date` is `NOT NULL` (`001_initial_schema.sql:195`), so `anchorFor` is total — every initiative has an anchor, therefore every task gets a due date (4.4). Because the fallback feeds the same `computeTaskDueDate`, all of Requirement 3 holds relative to it (4.5).

**Resolving the open question: does `event_date` become required? No.** `initiatives.event_date` stays nullable `DATE` (`001_initial_schema.sql:196`). Reasons:

1. Evergreen initiatives genuinely have no event. Forcing `NOT NULL` would require writing a fabricated date — which is the exact class of defect (a hardcoded day 15) this section exists to remove.
2. A `NOT NULL` constraint needs every existing row backfilled first, and the only value available to backfill with is another guess.
3. Initiatives can be created outside generation (`add-initiative-panel.tsx`, `/api/plan/suggestions/[id]`); a hard constraint would force those paths to invent dates too.
4. `anchorFor` gives Requirement 4.4/4.5 the documented fallback the requirement actually asks for, at zero schema risk.

Generation, however, **always writes a non-null `event_date`** (defaulting to day 15 when the model omits `eventDay`), so generated data never relies on the fallback. The fallback exists for manually created and legacy rows.

| Clause | Mechanism |
| --- | --- |
| 4.1 | `anchorFor` reads the initiative's stored `event_date` |
| 4.2 | the hardcoded `15` at `route.ts:546` and `route.ts:581` is gone; the day comes from the model, clamped |
| 4.3 | `eventMonth`/`eventDay` resolve independently of `activationMonth` |
| 4.4, 4.5 | `anchorFor` falls back to `activation_date`; `computeTaskDueDate` is unchanged, so Requirement 3 still holds |
| 4.6, 4.7 | `eventMonth` may exceed `activationMonth` and `offsetMonth` carries into the next year; due dates are computed from the event month/year, never the activation month |
| 4.8 | `computeTaskDueDate` is pure and total: `(anchor, rawLead)` fully determines the result, with no `Date.now()`, no timezone input, and no randomness. Same inputs, same due date, forever. |

## D. Company-wide task queries and cross-view consistency

**Satisfies: Requirements 6.1–6.9, 7.1–7.8, and 2.7.**

### D.1 The query that does not exist

`task.service.ts` exposes `getTasksByCompany(companyId)` (line 34, all tasks, unbounded) and `getTasksByDueDate(initiativeId, start, end)` (line 169, due-date range but scoped to **one** initiative). Neither is the right shape for a cadence view, so the views built their own: iterate the window's initiatives and call `getTasksByInitiative` per initiative (`weekly-planner.tsx:209`, `daily-planner.tsx:168`, `calendar-view.tsx:117`).

That construction makes D4 structural. A task due this week whose initiative activates in three months is unreachable, because the initiative was filtered out before the task query ran (`weekly-planner.tsx:189–201` filters on `activation <= end && eventDate >= weekStart`). It is also N+1: one round trip per initiative in the window.

**New method on `TaskService`:**

```ts
/**
 * Every task for a company whose due date falls in [start, end], inclusive.
 * Bounds are DateOnly strings compared against the DATE column in Postgres,
 * so no timezone is involved on either side.
 */
async getTasksByCompanyDueBetween(
  companyId: string,
  start: DateOnly,
  end: DateOnly,
): Promise<Task[]> {
  if (!companyId) return [];
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("company_id", companyId)      // defence in depth; RLS already enforces this
    .gte("due_date", start)
    .lte("due_date", end)
    .order("due_date", { ascending: true });
  if (error) throw error;             // see D.5 - must not collapse to []
  return data.map((row) => this.mapRow(row));
}
```

**Filtered in the database, not the client** (resolving that open decision). `tasks.due_date` is `DATE NOT NULL` (`001_initial_schema.sql:242`), so `gte`/`lte` against `YYYY-MM-DD` are native date comparisons evaluated in Postgres with no timezone conversion on either side — the predicate is exactly the calendar-day semantics Requirement 5.8 demands, for free. Client-side filtering would mean fetching every task a company has ever had on every view render, and would reintroduce the `Date` comparison the whole of Section B exists to eliminate.

**Interaction with RLS.** `tasks` has RLS enabled with `USING (company_id = get_user_company_id())` on SELECT (`002_rls_policies.sql:311–315`). The explicit `.eq('company_id', companyId)` is therefore redundant for security but is kept for two reasons: Requirement 6.5 should hold at the application layer too, and the predicate lets Postgres use a `company_id`-leading index rather than relying on the policy's function call for selectivity. **No RLS change is needed** — the policy is already exactly the scoping the requirement asks for. Note also that server routes using the service role bypass RLS entirely (documented in `014_plan_table_role_enforcement.sql`), which is why the application-level predicate is not optional on the server side.

`getTasksByDueDate(initiativeId, ...)` is **kept**, not repurposed: `initiative-tasks.tsx` and `initiative-project-plan.tsx` legitimately want one initiative's tasks. Two methods with different scopes is correct; one method doing double duty is what produced the confusion.

### D.2 The shared selector: `src/lib/plan-schedule.ts`

One query path is necessary but not sufficient for Requirement 7 — two views could still aggregate the same rows differently. So the aggregation is shared too, and it is pure:

```ts
export type ScheduleWindow = { start: DateOnly; end: DateOnly };

export function windowForDay(day: DateOnly): ScheduleWindow;
export function windowForWeek(anyDayInWeek: DateOnly): ScheduleWindow;
export function windowForMonth(year: number, month: number): ScheduleWindow;    // month 1-12
export function windowForQuarter(year: number, quarter: number): ScheduleWindow; // quarter 1-4
export function windowForYear(year: number): ScheduleWindow;

export type ScheduleSummary = {
  taskCount: number;
  estimatedHours: number;
  byStatus: Record<TaskStatus, number>;
};

/** Deduplicated by task id, filtered by the task's OWN due date. */
export function tasksInWindow<T extends { id: string; dueDate: Date }>(
  tasks: readonly T[],
  w: ScheduleWindow,
): T[];

export function summarise(tasks: readonly Task[], w: ScheduleWindow): ScheduleSummary;

/** Attribution by the task's own due date, so a straddling week splits correctly. */
export function groupByMonth(tasks: readonly Task[], year: number): Map<number, ScheduleSummary>;
export function groupByQuarter(tasks: readonly Task[], year: number): Map<number, ScheduleSummary>;
```

`tasksInWindow` is implemented over a `Map<string, T>` keyed on `task.id`, then filtered with `isWithin(toDateOnly(t.dueDate), w.start, w.end)`.

**Every cadence view derives both its task list and its hour total from this pair — `getTasksByCompanyDueBetween` then `summarise`/`groupByMonth`.** That is what makes Requirement 7 a structural property rather than a coincidence: the views are not independently computing agreeing numbers, they are reading the same numbers.

### D.3 What changes in each view

| File | Today | Becomes |
| --- | --- | --- |
| `weekly-planner.tsx:207–217` | loop over `weekInitiatives` calling `getTasksByInitiative` (line 209), then filter by `Date` comparison | one `getTasksByCompanyDueBetween(companyId, w.start, w.end)` with `w = windowForWeek(...)` |
| `daily-planner.tsx:166–173` | loop over `dayInitiatives` calling `getTasksByInitiative` (line 168), then `isSameDay` | one call with `w = windowForDay(selectedDay)` |
| `calendar-view.tsx:117` | same loop pattern | one call with `w = windowForMonth(...)`, then `groupByDay` for cell rendering |
| `monthly-planner.tsx` | no task data | `summarise` for the month, plus `weeksInMonth` for the per-week breakdown |
| `monthly-summary-table.tsx` | revenue only (the 12-month loop at line 103, window math at line 104) | adds Tasks / Hours columns from `groupByMonth` |
| `quarterly-summary-table.tsx` | revenue only (the four-quarter loop at line 113, window math at line 115) | adds Tasks / Hours columns from `groupByQuarter` |
| `quarterly-planner.tsx` | no task data | `summarise` for the quarter |
| `year-at-a-glance.tsx` | initiative counts only | adds per-month task/hour totals from `groupByMonth` |

Initiatives are still loaded, but their role changes: they supply the **display** join (`initiativeName` on `TaskWithInitiative`, `weekly-planner.tsx:215`) and the revenue panels. They no longer gate which tasks are visible. `weekly-planner.tsx:189–201` and `daily-planner.tsx:151–162` keep their initiative filters for the initiative *sections* of those pages; the task section no longer consults them. Where a task's initiative is outside the window, its name is resolved by a single `getInitiativesByIds` lookup over the distinct `initiative_id` values in the returned task set — one extra round trip, not N.

The per-month task and hour columns on the summary tables and Year-at-a-Glance are **new UI**, required because no view reports hours today (Premise Correction 1). Without them Requirements 7.2 and 7.3 have nothing to compare.

### D.4 How Requirements 6 and 7 fall out

| Clause | Mechanism |
| --- | --- |
| 6.1, 6.2 | inclusion is decided solely by the `due_date` predicate in SQL; the parent initiative is not in the query |
| 6.3, 6.4 | a task due 2026-03-04 whose initiative activates 2026-09-01 matches `due_date BETWEEN '2026-03-02' AND '2026-03-08'` — the initiative is never consulted |
| 6.5 | `.eq('company_id', ...)` plus the RLS SELECT policy at `002_rls_policies.sql:313` |
| 6.6 | `gte`/`lte` are inclusive, and `isWithin` is inclusive on both ends |
| 6.7 | `windowForWeek("2026-08-31")` → `{ start: "2026-08-31", end: "2026-09-06" }`; the predicate spans the month boundary because it is a single range, not a per-month query |
| 6.8 | `windowForWeek("2026-12-28")` → `{ start: "2026-12-28", end: "2027-01-03" }`; same reason, no year logic involved |
| 6.9 | an empty result array renders the empty state; a thrown error renders the error state (D.5) |
| 7.1, 7.2 | overlapping windows read the same rows through the same predicate and aggregate through the same `summarise` |
| 7.3 | Year-at-a-Glance's per-month figure *is* `groupByMonth(...).get(m)`, and the Monthly view's figure *is* `summarise(tasks, windowForMonth(y, m))`; both reduce to "tasks whose due date is in month m", so they cannot differ |
| 7.4 | contrapositive of 7.3: if the month's set is empty, every sub-window's set is a subset of empty |
| 7.5 | see below |
| 7.6 | see below |
| 7.7 | see below |
| 7.8 | `summarise` and `groupByMonth` are pure; same task array and window ⇒ same output. See the caching note in Risks. |

**Requirement 7.5 — month-boundary attribution, concretely.** A week window may straddle two months; a *task* never does. `groupByMonth` keys strictly off `toDateOnly(task.dueDate).slice(5, 7)` — the task's own calendar month — so for the week 2026-08-31 → 2026-09-06, the task due 08-31 is attributed to August and the rest to September. Each task is attributed to **exactly one** month.

The rule this implies must be stated because it is the part people get wrong: **a month's total is defined as `summarise(tasks, windowForMonth(y, m))`, and is never computed as a sum of its weeks' totals.** Weeks are not a partition of a month (the first and last may hang outside it), so summing them would double-count or miss. The requirement's "except where a week straddles a month boundary" clause is satisfied by never doing that sum in the first place. If a view wants to show weeks within a month, it uses `weeksInMonth(y, m)` and clips each week to the month window — so the clipped weeks *are* a partition and *do* sum.

**Requirement 7.6 — no double counting, concretely.** The query returns a flat list of task rows. There is no per-initiative iteration, so there is no mechanism by which an initiative also falling in the window could contribute a second row for the same task. `tasksInWindow` additionally deduplicates on `task.id` via a `Map`, which makes the property hold even if a caller concatenates results from two overlapping fetches. The old code's exposure was real: a task belonging to two initiatives in the same window (or a view that unioned per-initiative results) would append twice at `weekly-planner.tsx:214–216`.

**Requirement 7.7 — quarters sum to the year.** `windowForQuarter(y, 1..4)` produce four disjoint, contiguous ranges whose union is exactly `windowForYear(y)` — a partition. Combined with 7.6 (each task counted once) and 7.5 (each task attributed by its own due date), each task lands in exactly one quarter, so `Σ quarters = year` exactly. This is a property of the partition, proved once in a test over the selector rather than asserted per view.

### D.5 Load failure versus empty window

**Requirement 2.7, 6.9.** Every method in `task.service.ts` currently swallows errors and returns `[]`:

```ts
} catch { /* fall through */ }
// Mock data removed - return empty
console.log("[task] No data in Supabase, returning empty");
console.log("[task] No data, returning []"); return [];
```

A view therefore cannot tell "no tasks due this week" from "the query failed." That is the same masking defect `plan-data-integrity` Defect 3 addresses app-wide, and this design does not duplicate that work. `getTasksByCompanyDueBetween` is **new**, so it is written to the target behaviour from the start: it throws on error rather than returning `[]`. The cadence views already have `error` state and a catch that sets it (`weekly-planner.tsx:233–236`, `daily-planner.tsx:183–185`, `monthly-summary-table.tsx:132–135`), so the throw lands somewhere that renders a distinguishable state; the views must additionally stop rendering zero totals in that branch. Existing `task.service.ts` methods keep their current behaviour here and are converged by `plan-data-integrity`'s `assertSupabaseConfigured()` / `ConfigurationError` work — cross-referenced, not re-specified.

## E. Selected year

**Satisfies: Requirements 8.1–8.9.**

### E.1 The decision: the URL search param is the single source of truth

Resolving the open decision "where selected-year state lives: URL search param, React context, or a shared store" — **URL search param `?year=`, read through one shared hook.**

Justification against the alternatives:

- **Survives navigation between cadence views (Requirement 8.8).** React context dies at the route boundary unless a provider is hoisted into `src/app/(app)/layout.tsx`, and a layout is the one place that *cannot* see search params (confirmed in `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`: layouts do not receive the `searchParams` prop, because a shared layout is not re-rendered during navigation and would go stale). A store (module singleton or Zustand-style) would survive navigation but is lost on reload and invisible to the user.
- **Shareable and bookmarkable.** "Look at my Q3 2027" is a link. With context or a store it is not.
- **No provider plumbing.** The four planner pages are plain Server Components rendering a client component (`src/app/(app)/planner/{monthly,quarterly,weekly,daily}/page.tsx`); adding a provider means touching the app-group layout and wrapping every consumer.
- **Reload-stable, back-button-correct.** Requirement 8.7 (navigating from the week of 2026-12-28 to the week of 2027-01-04) becomes a URL change, which means the browser's history already does the right thing.

The cost, stated plainly: a plain `<Link href="/planner/weekly">` in the app navigation **drops the param**. Section E.4 covers that.

### E.2 The hook

Confirmed APIs, from `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`: `useSearchParams` is a Client Component hook imported from `next/navigation`, returns a **read-only** `URLSearchParams`, takes no arguments, and is not supported in Server Components. The documented way to *update* params is to build a fresh `URLSearchParams` from `searchParams.toString()`, `set` the key, and navigate with `useRouter` or `<Link>` — the doc's own "Updating `searchParams`" example. That is exactly what the hook does.

```ts
// src/hooks/use-selected-year.ts
"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

export function useSelectedYear(fallbackYear?: number) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const raw = searchParams.get("year");
  const parsed = raw === null ? NaN : Number(raw);
  const isValid = Number.isInteger(parsed) && parsed >= MIN_YEAR && parsed <= MAX_YEAR;

  // Evaluated on every render, NOT at module load. This is the Req 8.6 fix.
  const selectedYear = isValid ? parsed : (fallbackYear ?? new Date().getFullYear());

  const setSelectedYear = useCallback(
    (year: number) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("year", String(year));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  return { selectedYear, setSelectedYear, isExplicit: isValid };
}
```

Two deliberate deviations from the doc's example, both noted so they are not read as mistakes:

- `router.replace` rather than `router.push`. Flipping between years is a filter change, not navigation; `push` would make the back button walk through every year the user clicked.
- `{ scroll: false }`, so changing the year does not jump the page to the top.

An out-of-range or non-numeric `?year=` falls back rather than erroring, so a hand-edited URL degrades to the current year (and `isExplicit` lets a caller distinguish "user chose this" from "we defaulted").

### E.3 Suspense is mandatory, not optional

From the same doc: if a route is prerendered, calling `useSearchParams` forces the client tree up to the nearest `Suspense` boundary to be client-rendered, and — explicitly — *"During production builds, a static page that calls `useSearchParams` from a Client Component must be wrapped in a `Suspense` boundary, otherwise the build fails with the Missing Suspense boundary with useSearchParams error."* The doc also warns this will appear to work in development, where routes render on demand.

The six planner pages are Server Components that render their planner client component directly, with no `Suspense` anywhere. Introducing the hook therefore **breaks `next build`** unless each is wrapped:

```tsx
// src/app/(app)/planner/monthly/page.tsx
import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/layout";
import { MonthlyPlanner } from "@/components/planning";

export default function MonthlyPlannerPage() {
  return (
    <PageContainer>
      <PageHeader title="Monthly Planner" description="Monthly trajectory tuning and trend analysis" />
      <Suspense fallback={<PlannerSkeleton />}>
        <MonthlyPlanner />
      </Suspense>
    </PageContainer>
  );
}
```

The doc offers an alternative — call `connection()` from `next/server` in the page to force dynamic rendering — and explicitly marks the older `export const dynamic = 'force-dynamic'` as superseded by it. `Suspense` is preferred here: it keeps the page shell (container, header) prerendered and sent in the initial HTML, and only the data-bearing planner is client-rendered. `force-dynamic` must not be used. (`next.config.ts` has no `cacheComponents` flag, so the Cache Components model and its removal of `dynamic`/`revalidate` do not apply to this project.)

Pages to wrap: `planner/daily`, `planner/weekly`, `planner/monthly`, `planner/quarterly`, `planner/calendar`, `planner/timeline`, plus wherever `year-at-a-glance` is mounted.

### E.4 Removing the module-load constants

Four files declare the frozen year:

- `src/components/planning/monthly-planner.tsx:27`
- `src/components/planning/quarterly-planner.tsx:24`
- `src/components/planning/monthly-summary-table.tsx:22`
- `src/components/planning/quarterly-summary-table.tsx:22`

all as `const YEAR = new Date().getFullYear();`, and all used for the window math and the labels (`monthly-planner.tsx:126–133,177,261`; `quarterly-planner.tsx:106,111,204`; `monthly-summary-table.tsx:104,160,198,282`; `quarterly-summary-table.tsx:115,171,209,293`). All four are deleted and replaced by `const { selectedYear } = useSelectedYear();`.

**Why a module-load constant is the wrong construct, specifically:**

- It is evaluated **once**, when the JavaScript chunk is first parsed in the tab — not on mount, not on render. Nothing can change it for the life of the tab. A session open across midnight on 31 December keeps reporting the previous year on every subsequent date-dependent evaluation, which is precisely what Requirement 8.6 forbids.
- Being a module constant, it is **unaddressable from the UI**: there is no setter, so no control could ever be added without first removing it. That is why these four views have no year navigation at all while `year-at-a-glance.tsx` does — Requirement 8.3.
- It conflates two different notions that the fix must keep separate: *the year being viewed* (now `selectedYear`, from the URL) and *what today is* (now `todayDateOnly()`, called at the point of use). `quarterly-planner.tsx` needs both — the window comes from the selected year, the "current quarter" highlight comes from today.

### E.5 Reconciling `year-at-a-glance.tsx`

This file already has year navigation, so it must be converted without creating a second source of truth:

- **Remove** `const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR)` (line 77). Four call sites write it today and each is reclassified: the auto-select at line 288 and the post-scratch reset at line 446 become the one-shot URL normalisation below; the future-year draft handler at line 340 and the switcher handlers at lines 664 and 679 become `setSelectedYear` from the hook, which writes the URL.
- **Keep** `availableYears` state (line 78, populated from `planService.getPlanYears` at line 282). It is *derived data* — the set of years this company has plans for — not a competing selection. It feeds the switcher's options (lines 517–519) and the fallback below.
- **Replace** `const CURRENT_YEAR = new Date().getFullYear()` (line 38) with a per-render value. It is used for comparisons, not display — `isViewingCurrentYear` (line 239), `isFutureYear` (line 525), the past/future switcher split (lines 518–519), and the error/empty gates (lines 462, 497) — and every one of those comparisons goes stale across a year boundary for the same reason as `const YEAR`.
- **The "prefer the most recent year on record" behaviour** currently at lines 287–289 (`if (years.length > 0 && !years.includes(CURRENT_YEAR)) setSelectedYear(years[0])`) becomes a **one-shot URL normalisation**, guarded on the param being absent:

  ```ts
  const { selectedYear, setSelectedYear, isExplicit } = useSelectedYear();

  useEffect(() => {
    if (isExplicit) return;                        // the URL wins, always
    if (availableYears.length === 0) return;
    if (availableYears.includes(selectedYear)) return;
    setSelectedYear(availableYears[0]);            // writes the URL, then the URL is authoritative
  }, [isExplicit, availableYears, selectedYear, setSelectedYear]);
  ```

  The `isExplicit` guard is what prevents a second source of truth: once `?year=` is present the effect is inert, so the component can never override a year the user chose or a link they followed.
- The year switcher's `onClick` handlers (lines 664 and 679) call `setSelectedYear`, which now writes the URL instead of local state. The data-loading effect's dependency array (line 274, `[companyId, authLoading, selectedYear, reloadKey]`) is unchanged — `selectedYear` simply arrives from a different place, so Requirement 8.2 (no page reload) holds because `router.replace` is a client-side transition, not a document load.
- `localStorage.setItem('sam-plan-target-year', ...)` (lines 419, 548) and `router.push('/onboarding/full?year=...')` (line 425) are left as they are: that is the generation handoff, a different concern, and it already passes the year explicitly.

### E.6 Carrying the year across navigation

Requirement 8.8 requires the year to survive switching from Monthly to Quarterly or Weekly. With the URL as the source of truth, that means the navigation links must carry it. A small helper, used by the planner navigation and any in-app link between cadence views:

```ts
export function withYear(href: string, year: number): string {
  const [path, qs] = href.split("?");
  const params = new URLSearchParams(qs);
  params.set("year", String(year));
  return `${path}?${params.toString()}`;
}
```

This is the price of the URL approach and it is accepted rather than worked around. The tempting alternative — persist the last-selected year in `localStorage` and have the hook fall back to it — is **rejected**: it is a second source of truth, it would make the URL and the display disagree for a shared link, and it reintroduces exactly the "which value wins" ambiguity that E.5 works to eliminate.

| Clause | Mechanism |
| --- | --- |
| 8.1 | `?year=` plus the switcher, now available to every view |
| 8.2 | `router.replace` is a client-side transition; the loading effect re-runs on the new `selectedYear` |
| 8.3 | the four module constants are deleted; the year is read per render |
| 8.4 | Quarterly/Monthly/Weekly/Daily all read `selectedYear`, so `?year=2027` reaches all of them |
| 8.5 | the summary tables' window math takes `selectedYear` rather than `YEAR` |
| 8.6 | the fallback is `new Date().getFullYear()` evaluated inside the hook body on each render, and "today" comes from `todayDateOnly()` at the point of use |
| 8.7 | week windows are computed from a `DateOnly`, which carries its own year; `windowForWeek("2027-01-04")` needs no `selectedYear` at all, and the view updates the param to match the window it lands on |
| 8.8 | `withYear` on every inter-view link, plus the param surviving reload |
| 8.9 | an empty result for the selected year renders that year's empty state; nothing falls back to another year, because the fallback in E.5 only fires when the param is absent |

## Components and Interfaces

An index of every module, route, and hook this design adds or changes. Full signatures, rationale, and line-level call sites live in the referenced section; nothing is decided here that is not already decided there.

### New modules

| Path | Purpose | Signatures in |
| --- | --- | --- |
| `src/lib/plan-dates.ts` | Pure date-only primitives: `DateOnly`, `parseDateOnly`, `toDateOnly`, `isDateOnly`, `todayDateOnly`, `addDays`, `subDays`, `diffDays`, `isSameDay`, `isWithin`, `startOfWeek`/`endOfWeek`, `startOfMonth`/`endOfMonth`, `daysInMonth`, `clampDayToMonth`, `weeksInMonth`. No `toISOString()` anywhere in the file. | **B.2** |
| `src/lib/plan-schedule.ts` | The shared selector: `ScheduleWindow`, `windowForDay/Week/Month/Quarter/Year`, `ScheduleSummary`, `tasksInWindow`, `summarise`, `groupByMonth`, `groupByQuarter`. The single source of every number a cadence view displays. | **D.2** |
| `src/lib/plan-schedule-math.ts` | Lead-time resolution and anchoring: `DEFAULT_LEAD_DAYS`, `MAX_LEAD_DAYS`, `resolveLeadDays`, `computeTaskDueDate`, `anchorFor`, `DEFAULT_EVENT_DAY`, `offsetMonth`. May be co-located in `plan-dates.ts`; must stay importable with no Supabase dependency. | **C.2**, **C.3** |
| `src/hooks/use-selected-year.ts` | `useSelectedYear(fallbackYear?)` → `{ selectedYear, setSelectedYear, isExplicit }`. Reads `?year=` per render; writes via `router.replace(..., { scroll: false })`. `MIN_YEAR`/`MAX_YEAR` bounds with fallback to the current year. | **E.2** |
| `src/lib/plan-generation/prompts.ts` | `buildSkeletonPrompt` / `buildTaskBatchPrompt`. Carries the lead-time convention wording verbatim. | **A.2**, **C.1** |
| `src/lib/plan-generation/schema.ts` | Draft types plus `validateDraft` — the five completeness checks commit runs before its first write. | **A.6** |
| `src/lib/plan-generation/runs.ts` | Run-record CRUD, phase transitions, staleness, pruning, `failRun`. | **A.3** |
| `src/lib/plan-generation/commit.ts` | Reset (via the helper extracted from `/api/plan/reset`) plus the batched plan-table writes. | **A.4**, **A.5** |

### Routes

| Path | New / changed | Purpose | Contract in |
| --- | --- | --- | --- |
| `POST /api/generate-plan/start` | new | Abandons non-terminal runs, prunes old terminal ones, inserts the run → `{ runId, batchTotal, phase }` | **A.8**, **A.3** |
| `POST /api/generate-plan/tasks` | new | One phase-1 skeleton call, then one call per task batch → `{ phase, batchCursor, batchTotal }` | **A.8**, **A.2** |
| `POST /api/generate-plan/commit` | new | Validate, snapshot, reset, batched inserts → `{ success, snapshotId, counts }` | **A.8**, **A.4**–**A.6** |
| `GET /api/generate-plan/status?runId=` | new | Resume support → `{ phase, batchCursor, batchTotal, error }` | **A.8**, **A.3** |
| `POST /api/generate-plan` | **removed** | Replaced by the four above; its only caller is `generating/page.tsx:174` | **A.8** |
| `src/app/api/plan/reset/route.ts` | changed | Body extracted into a server-callable helper returning the same `{ success, snapshotId, snapshotLabel }` shape | **A.4** |

All four new routes declare `export const maxDuration = 60`, repeat the `requirePlanEditor()` guard, and 403 a `runId` belonging to another company.

### Changed services and types

| Path | Change | Detail in |
| --- | --- | --- |
| `src/services/task.service.ts` | **Adds** `getTasksByCompanyDueBetween(companyId, start: DateOnly, end: DateOnly): Promise<Task[]>` — inclusive `gte`/`lte` on the `DATE` column, ordered by due date, **throws** on error rather than returning `[]`. Read mapping (line 358) and both write paths (222, 258) move to `plan-dates`; the three `toISOString().split('T')[0]` query bounds (133, 155, 177–178) move to `todayDateOnly`/`toDateOnly`. `getTasksByDueDate(initiativeId, …)` is kept as-is. | **D.1**, **D.5**, **B.3** |
| `src/services/initiative.service.ts` | `getInitiativesByDateRange` bounds (220–221) move to `toDateOnly`. | **B.3** |
| `src/lib/format-date.ts` | All four formatters gain a `coerce()` that routes `DateOnly` strings through `parseDateOnly`. | **B.3** |
| `src/types/initiative-type.types.ts` | `daysBeforeEvent` doc comment replaced with the non-negative convention. | **C.1** |

### Cadence views

All eight derive their task list and totals from `getTasksByCompanyDueBetween` + `plan-schedule.ts`, and their year from `useSelectedYear`. Per-view before/after in **D.3**; the deleted private window helpers in **B.3**; the `const YEAR` removals in **E.4**.

| Path | Change |
| --- | --- |
| `src/components/planning/weekly-planner.tsx` | Per-initiative task loop (209) → one windowed query; `getWeekStart` → `startOfWeek` |
| `src/components/planning/daily-planner.tsx` | Per-initiative task loop (168) → one windowed query; private `isSameDay`/`getWeekStart` deleted |
| `src/components/planning/calendar-view.tsx` | Per-initiative task loop (117) → one windowed query; private `isSameDay` deleted |
| `src/components/planning/monthly-planner.tsx` | Gains task/hour totals from `summarise`; `getWeeksInMonth` → `weeksInMonth`; `const YEAR` → `selectedYear` |
| `src/components/planning/quarterly-planner.tsx` | Gains task/hour totals from `summarise`; `getQuarterDateRange` → `windowForQuarter`; `const YEAR` → `selectedYear` |
| `src/components/planning/monthly-summary-table.tsx` | Gains Tasks / Hours columns from `groupByMonth`; `getMonthDateRange` → `windowForMonth`; `const YEAR` → `selectedYear` |
| `src/components/planning/quarterly-summary-table.tsx` | Gains Tasks / Hours columns from `groupByQuarter`; `getQuarterDateRange` → `windowForQuarter`; `const YEAR` → `selectedYear` |
| `src/components/planning/year-at-a-glance.tsx` | Gains per-month task/hour totals from `groupByMonth`; local `selectedYear` state and `CURRENT_YEAR` removed in favour of the hook plus a one-shot URL normalisation |

### Supporting changes

| Path | Change | Detail in |
| --- | --- | --- |
| `src/app/onboarding/generating/page.tsx` | Becomes the phase state machine: drives start → tasks loop → commit, derives progress from `phase`/`batchCursor`/`batchTotal`, keeps `attemptRollback` unchanged | **A.7**, **A.4** |
| `src/app/(app)/planner/{daily,weekly,monthly,quarterly,calendar,timeline}/page.tsx` | Each wraps its planner in `<Suspense>` — mandatory, or `next build` fails | **E.3** |
| `withYear(href, year)` helper + planner navigation | Carries `?year=` across inter-view links | **E.6** |
| `supabase/migrations/017_plan_generation_runs.sql` | New table, index, RLS policies | **Data Models** |
| `supabase/migrations/018_remediate_task_due_dates.sql` | One-time due-date correction | **F.5** |

## F. Remediation of existing bad due dates

**Satisfies: Requirements 9.1–9.9.**

### F.1 The original lead time is exactly recoverable

This is the most important fact in this section, so the derivation is written out. For every task written by the defective code, let `A` be the activation month and `L` be `task.daysBeforeEvent || 0`:

```
route.ts:546   event_date = <the 15th of A>                       -- call it E
route.ts:581   due_date   = <the 15th of A> + L  =  E + L
```

Both values were produced in the same invocation from the same `(actualYear, actualMonth)` pair, and `E` is the *same* 15th in both expressions. Therefore:

```
due_date − event_date  =  (E + L) − E  =  L          exactly
```

The lead time is not estimated — it is stored, spread across two columns. The corrected date follows directly:

```
corrected  =  event_date − L
           =  event_date − (due_date − event_date)
           =  2 · event_date − due_date
```

**Remediation is therefore deterministic arithmetic, not a guess** (Requirement 9.6's "rather than writing a guessed date" is satisfied because no guessing occurs for the target set at all).

Two consequences worth stating:

- Doing the arithmetic **in SQL on the stored `DATE` columns removes timezone from the problem entirely.** Postgres `date − date` yields an integer day count and `date − integer` yields a date; no local time, no UTC, no DST. Doing the same arithmetic in JavaScript would reintroduce the `toISOString()` question that Section B exists to close, and would be exposed to a DST transition falling between `E` and `due_date` in a non-UTC process. SQL is not just convenient here, it is the correct tool.
- The correction is exact **only because the bug was arithmetically clean.** It added a known quantity to a known anchor. Had it, say, jittered the date or clamped it, `L` would not be recoverable and this section would have had to propose regeneration instead.

### F.2 Selection predicate

```sql
WHERE i.event_date IS NOT NULL
  AND t.due_date > i.event_date
  AND t.status = 'not_started'
```

`due_date > i.event_date` selects exactly the rows where `L > 0` — every task the bug actually misplaced, and nothing else:

| Stored case | `due_date` vs `event_date` | Selected? | Correct? |
| --- | --- | --- | --- |
| `L > 0` (the bug) | `E + L > E` | yes | yes — this is the target set |
| `L = 0` | `E = E` | no (strict `>`) | yes — a zero-lead task is already due on the event date, which is what Requirement 3.5 asks for |
| `L < 0` (model used the old signed convention) | `E + L < E` | no | yes — `E − |L|` is already before the event, i.e. accidentally correct relative to the stored anchor |
| `event_date IS NULL` | undefined | no | reported unremediatable (F.4) |

### F.3 Idempotence (Requirement 9.5)

After the update, for a selected row: `due_date' = event_date − L` where `L > 0`, so `due_date' < event_date`. The predicate `due_date > event_date` is therefore **false** for every row the first pass touched. A second run selects zero rows and the data is a fixed point after one pass.

This is a property of the predicate rather than of a bookkeeping flag — there is no "already remediated" column to keep in sync, and no risk of the flag and the data disagreeing. It is verified two ways: by construction above, and empirically by running the reporting `SELECT` again after the `UPDATE` and asserting `will_change = 0`.

### F.4 Treatment of tasks the user may have acted on (Requirement 9.8)

**Decision: remediate only `status = 'not_started'`. Leave `in_progress`, `completed`, `blocked`, and `cancelled` untouched, and report them as deliberately skipped.**

Rationale: for a task nobody has started, the due date is still purely a plan, and correcting it is unambiguously helpful. For a task someone has worked to — or completed — the date has become part of a record. Rewriting it moves a deadline the person already organised around, invalidates any note or conversation that referenced it, and for a completed task can put the due date after `completed_at`, producing a nonsensical "completed 3 weeks before it was due" reading. Silently rewriting a date someone has already worked to is worse than leaving a wrong date on work that is already done.

The rule is applied **uniformly** — status-based, evaluated by the predicate, with no per-task judgement — which is what Requirement 9.8 asks for ("the same treatment to every such task rather than deciding case by case").

Skipped-by-status is reported as its own count, **distinct from unremediatable**: the first is a policy decision (we could have fixed it and chose not to), the second is an information limit (we cannot).

**Unremediatable (Requirement 9.6):** tasks whose `initiatives.event_date IS NULL`. With no anchor, `due_date − event_date` is undefined and `L` is unrecoverable. These are left unchanged and reported. For generated data the set should be empty — generation has always written a non-null `event_date` (`route.ts:560`) — so a non-zero count points at manually created initiatives or another write path, which is useful signal in itself.

### F.5 Delivery mechanism

**Chosen: a guarded SQL migration, `018_remediate_task_due_dates.sql`.** (017 is taken by the generation run table; see Data Models.)

Justified against an admin-triggered route:

- The correction is one arithmetic expression over two stored columns. In SQL it is a single `UPDATE ... FROM`; as a route it is a paginated read-modify-write loop plus an endpoint, auth guards, a response schema, and a UI — none of which has a second use once the run is done.
- **Migrations run in the Supabase SQL editor execute as `postgres`, bypassing RLS.** That is what makes a cross-company repair possible in one statement. An admin route running on the cookie-based client would be filtered by `USING (company_id = get_user_company_id())` (`002_rls_policies.sql:313`) and could only ever see one company; a route using the service role would bypass RLS (as `014_plan_table_role_enforcement.sql` documents) but then needs its own authorisation, which is new security surface for a one-time job.
- This is genuinely one-off historical repair. `plan-data-integrity` chose an admin endpoint for its recovery, and correctly — that work is repeatable, needs a dry-run UI, reuses restore logic, and may need re-running as new corruption is found. Remediation here is a fixed point (F.3): after one run there is nothing left to do, and the generation fix means no new rows join the target set.
- The counts Requirement 9.7 asks for come out of the statement itself.

```sql
-- supabase/migrations/018_remediate_task_due_dates.sql
--
-- Corrects task due dates written by the defect at
-- src/app/api/generate-plan/route.ts:581, which ADDED the lead time to a
-- hardcoded 15th-of-the-activation-month anchor instead of subtracting it.
--
-- Because event_date was set to that same 15th (route.ts:546), the original
-- lead time is exactly (due_date - event_date), so the corrected date is
-- (event_date - (due_date - event_date)).  Pure DATE arithmetic: no timezone.
--
-- IDEMPOTENT: after the update, due_date <= event_date, so the selection
-- predicate no longer matches. A second run changes nothing.
--
-- HOW TO RUN (manual, Supabase SQL editor - this project has no migration
-- runner): run the report SELECT first, record the four counts, then run the
-- UPDATE. To dry-run, run everything except the UPDATE.

BEGIN;

CREATE TEMP TABLE remediation_plan AS
SELECT t.id,
       t.due_date                                      AS old_due_date,
       i.event_date,
       (t.due_date - i.event_date)                      AS lead_days,
       (i.event_date - (t.due_date - i.event_date))     AS new_due_date
FROM tasks t
JOIN initiatives i ON i.id = t.initiative_id
WHERE i.event_date IS NOT NULL
  AND t.due_date > i.event_date
  AND t.status = 'not_started';

-- Requirement 9.7: changed / unchanged / skipped / unremediatable.
SELECT
  (SELECT count(*) FROM remediation_plan)                                  AS will_change,
  (SELECT count(*) FROM tasks t JOIN initiatives i ON i.id = t.initiative_id
     WHERE i.event_date IS NOT NULL AND t.due_date <= i.event_date)        AS already_correct,
  (SELECT count(*) FROM tasks t JOIN initiatives i ON i.id = t.initiative_id
     WHERE i.event_date IS NOT NULL AND t.due_date > i.event_date
       AND t.status <> 'not_started')                                      AS skipped_by_status,
  (SELECT count(*) FROM tasks t JOIN initiatives i ON i.id = t.initiative_id
     WHERE i.event_date IS NULL)                                           AS unremediatable;

-- Per-company detail, so the operator can see the blast radius before writing.
SELECT i.company_id, count(*) AS tasks, min(p.lead_days), max(p.lead_days)
FROM remediation_plan p
JOIN tasks t      ON t.id = p.id
JOIN initiatives i ON i.id = t.initiative_id
GROUP BY i.company_id
ORDER BY 2 DESC;

UPDATE tasks t
SET due_date = p.new_due_date,
    updated_at = NOW()
FROM remediation_plan p
WHERE t.id = p.id;

COMMIT;
```

**Operator note:** this project has no migration runner — `package.json` has `dev`, `build`, `start`, `lint`, `test`, and nothing else — so every migration in `supabase/migrations/` is applied by hand in the Supabase SQL editor. Run the two `SELECT`s, record the counts, then run the `UPDATE`. Record the four counts in the spec's completion notes so Requirement 9.7's report has somewhere to live.

**Ordering: the generation fix (Sections A and C) must ship before this migration runs.** Otherwise new defective rows keep arriving behind the repair — the same "stop the bleed before mopping the floor" reasoning `plan-data-integrity` applies to its Defect 1.

### F.6 Scope and known limitation

**Scope (Requirement 9.9).** The only `UPDATE` in the migration targets `tasks`, and sets only `due_date` and `updated_at`. `initiatives`, `projections`, `annual_plans`, and `companies` appear in read positions only. No `DELETE` appears at all.

**Verification (Requirements 9.2, 9.3).** After the run, `SELECT count(*) FROM tasks t JOIN initiatives i ON i.id = t.initiative_id WHERE t.due_date > i.event_date AND t.status = 'not_started'` must be `0`. Requirement 9.2 additionally asks that remediated dates satisfy Requirement 5: they do trivially, because the values never leave `DATE` columns — no JavaScript date object is constructed anywhere in the repair.

**Known limitation, stated rather than hidden.** A task whose due date a user *manually* edited to a date after its initiative's event date is indistinguishable from a buggy row. Both look like `due_date > event_date` and nothing records which write produced the value. Restricting to `status = 'not_started'` reduces the exposure (someone who cared enough to move a date has often started the work) but does not remove it — a user can reschedule a task without starting it. The only way to distinguish them would have been a provenance column on `tasks`, and adding one now cannot recover history that was never written. Accepted: the correction is right for the overwhelming majority and the affected user sees a date that moved, not data loss.

## Error Handling

**Satisfies: Requirements 1.3, 1.4, 2.2–2.7, 9.6.** The failure paths are designed in **A.3**, **A.6**, **A.7**, **D.5**, and **F.6**; this section is the consolidated view.

Three rules govern all of them:

- **No silent fall-through.** Every detected failure sets a terminal state and returns a machine-readable `code`. The current `console.error`-then-continue at `route.ts:391` is the defect this replaces (2.4).
- **No blank page.** Because the client owns the phase loop, a rejected fetch, a non-2xx status, an empty body, and a gateway timeout all land in the same error branch, and the existing raw-text-first parse means a non-JSON gateway response still yields a message (2.3).
- **Failure is distinguishable from emptiness.** A view that cannot load its data must never render zeros (2.7, 6.9).

| Failure mode | Detection | User-visible outcome | Recovery | Req |
| --- | --- | --- | --- | --- |
| AI response truncated | `stop_reason === "max_tokens"` on any phase | Named error: the response was cut off | Resume from `batchCursor` if the skeleton is valid, else restart | 2.4, 2.2, 1.3 |
| Response is not parseable JSON | `JSON.parse` throws and the markdown-fence fallback also fails | Named error with `code` | Same as above | 2.2, 1.3 |
| AI provider error / non-2xx upstream | thrown inside the phase handler | Named error with `code` | Same as above | 2.2 |
| Gateway timeout, empty body, network failure | client-side: `!res.ok`, rejected fetch, or unparseable body | Error screen, never a stalled progress bar | "Try again" → resume or restart | 2.3, 1.3 |
| Draft fails a completeness check | `validateDraft` at the top of commit — **before the reset** | Named error; plan is visibly unchanged | Restart; nothing to clean up | 1.6, 2.5, 2.6 |
| Reset returns non-OK | commit aborts before any insert | Error screen; plan intact | Restart | 2.5 |
| Error thrown inside commit after the reset | commit catch; response carries `snapshotId` on failure too | Error screen after `attemptRollback` restores the snapshot | Restart; rollback semantics owned by `plan-data-integrity` | 2.5 |
| `runId` belongs to another company | ownership check in every route | 403 | — | — |
| Tab closed mid-run | run left `*_pending`, `updated_at` older than 30 min | Run treated as `abandoned` by every reader | Marked lazily on the next `start`/`status`; a fresh `start` supersedes it | 1.4 |
| Retry after any pre-commit failure | run phase read from `GET /status` | — | **Resume** when non-terminal, not stale, skeleton valid; **restart** otherwise. Safe in both cases because no plan table was written | 1.4 |
| Cadence-view task query fails | `getTasksByCompanyDueBetween` **throws** rather than returning `[]` | The view's existing error state — not a zero total | Reload / retry | 2.7, 6.9 |
| Window genuinely has no tasks | query resolves to `[]` | Empty state, distinct copy from the error state | none needed | 6.9 |
| Out-of-range or non-numeric `?year=` | `MIN_YEAR`/`MAX_YEAR` integer check in the hook | Degrades to the current year; `isExplicit` is `false` | User picks a year, which rewrites the param | 8.6 |
| Task has no recoverable anchor (`event_date IS NULL`) | remediation selection predicate | Counted as **unremediatable** in the migration's report; date left unchanged rather than guessed | Operator inspects the per-company detail query | 9.6 |
| Task misplaced but not `not_started` | status clause in the predicate | Counted as **skipped by status**, reported separately from unremediatable | Deliberate policy, no action | 9.8 |

`skipped_by_status` and `unremediatable` are kept as separate counts on purpose: the first is a policy decision, the second an information limit (**F.4**).

## Correctness Properties

The invariants asserted across **B.4**, **C.2**, **D.4**, and **F.3**, restated as checkable properties. Each is a statement about all inputs, not about a worked example, which is what makes it a property.

### Property 1: Due date never after anchor

For every anchor and **every** value of `rawLead` — negative, zero, fractional, absurd, `null`, `NaN`, `Infinity`, a non-numeric string — `computeTaskDueDate(anchor, rawLead) <= anchor`. There is no input that places a preparation task after the thing it prepares for, because the operation is always a subtraction of a non-negative magnitude. Holds identically when the anchor is the `activation_date` fallback.

**Validates: Requirements 3.4, 3.7, 3.8, 4.4, 4.5**

### Property 2: Date-only round-trip

For every supported timezone and every valid `DateOnly` string `s`: `toDateOnly(parseDateOnly(s)) === s`, and `parseDateOnly(s).getDate()` equals the day component of `s`. A date-only value round-trips to the same calendar day under `TZ=UTC`, under a UTC− offset, and under a UTC+ offset.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 10.5**

### Property 3: Initiative-independent membership

Window membership is inclusive at both ends and independent of the parent initiative: for every task `t` and window `w`, `t ∈ tasksInWindow(tasks, w) ⟺ isWithin(toDateOnly(t.dueDate), w.start, w.end)`. The initiative's activation and event dates do not appear in the predicate, so no initiative filter can hide a task that is due in the window.

**Validates: Requirements 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**

### Property 4: Exactly-once partition and count

For every window set that partitions a period, every task with a due date in that period appears in **exactly one** partition and is counted **exactly once** within it. Deduplication is by `task.id`, so the property survives a caller concatenating two overlapping fetches.

**Validates: Requirements 7.5, 7.6**

### Property 5: Quarters partition the year

For every year `y`, `windowForQuarter(y, 1..4)` are disjoint, contiguous, and their union is exactly `windowForYear(y)`. Combined with Property 4: `Σ_{q=1..4} summarise(tasks, windowForQuarter(y, q)) === summarise(tasks, windowForYear(y))` for both `taskCount` and `estimatedHours`.

**Validates: Requirements 7.7**

### Property 6: Remediation idempotence

Remediation is idempotent: for every `(eventDate, dueDate)` pair the predicate selects, `needsRemediation(correctedDueDate(eventDate, dueDate), eventDate, "not_started")` is `false`. One pass reaches a fixed point; a second pass selects zero rows. This follows from the predicate itself, not from a bookkeeping flag.

**Validates: Requirements 9.5, 9.4**

### Property 7: Selector purity

The aggregation layer is pure and total: for every task array and window, repeated calls to `summarise` / `groupByMonth` / `groupByQuarter` return deep-equal results, with no `Date.now()`, timezone, or randomness in the path. `computeTaskDueDate` has the same property — same inputs, same due date, forever.

**Validates: Requirements 7.8, 4.8**

### Property 8: Period total never summed from sub-windows

A period's total is always computed from that period's own window, never summed from sub-windows: for every `(y, m)`, `summarise(tasks, windowForMonth(y, m))` equals `groupByMonth(tasks, y).get(m)`. Weeks are not a partition of a month, so a week-sum is never the definition of a month total.

**Validates: Requirements 7.3, 7.5**

**Which of these want property-based tests rather than examples.** Property 1, Property 2, Property 5, Property 6, and Property 7 are universally quantified over generated input and are the natural targets: Property 1 over an arbitrary anchor crossed with an adversarial lead-value generator (the sign, validity, and magnitude cases are the point); Property 2 over a generated span of dates run under each zone in `test:tz`; Property 5 over an arbitrary year, which also exercises leap years; Property 6 over generated `(eventDate, lead)` pairs; Property 7 as a deep-equality check over an arbitrary fixture. Property 3, Property 4, and Property 8 are better served by example-based assertions over one hand-built fixture, because what they need is *specific* adversarial shapes — a task due 2026-03-04 under an initiative activating 2026-09-01, the week straddling 2026-08-31→09-06, a task whose initiative also falls in the window — and a generator is unlikely to produce those reliably. The concrete test files and cases are in **Testing Strategy**.

## Testing Strategy

**Satisfies: Requirements 10.1–10.11.**

### G.1 What the project actually has

Verified by reading `vitest.config.ts` and running `npm test` this session:

- **Runner: Vitest 3.2.7** (`package.json` devDependencies), `npm test` → `vitest run`, `npm run test:watch` → `vitest`.
- **Current suite: 58 tests across 7 files, all passing** — `two-factor`, `generation-metrics`, and five under `src/lib/notifications/`.
- `vitest.config.ts` sets `globals: true`, `environment: "node"`, `include: ["src/**/*.test.ts"]`, an `@` → `src` alias, and explicitly excludes two foundation-era files (`src/services/__tests__/initiative-type.service.test.ts`, `src/components/initiatives/__tests__/initiatives-list.test.ts`) that were written against the removed mock-JSON layer.
- **The include glob is `.test.ts`, not `.test.tsx`.** A component test would not even be collected today.
- **No DOM environment and no component-testing library.** `package.json` contains no `jsdom`, no `happy-dom`, and no `@testing-library/*`. The config's own comment says as much: *"Unit tests only — pure logic, no DB. Integration is verified via probes."*

### G.2 The honest gap, and the decision about it

**Cross-view consistency (Requirement 10.8) can be verified at the selector and aggregation level, but not by rendering components.** There is no way to mount `WeeklyPlanner` and `MonthlySummaryTable` and compare what they display, because there is no DOM to mount them into.

**Adding a DOM harness is out of scope for this spec.** Justification:

- Every behaviour in Requirements 3 through 8 is expressible over pure functions once the logic lives in `plan-dates.ts`, the lead-time module, and `plan-schedule.ts`. That is not a testing convenience — it is the same consolidation Sections B and D require for correctness. The tests follow the architecture rather than the architecture bending for the tests.
- A DOM harness would add `jsdom` plus three `@testing-library` packages, require splitting the Vitest config into `node` and `jsdom` projects (the existing `environment: "node"` is load-bearing for the current 58 tests), and need the Supabase client stubbed at the module boundary — and per the project's own rule, tests must not substitute fabricated results (Requirement 10.11), so stubbing the data layer to render a component is in tension with that.
- What a harness would actually buy is verification of *wiring*: that each component calls the shared selector. That is real, but it is one bit of information per component.

**What that leaves uncovered, and the cheap substitute.** The uncovered risk is a component that keeps its own aggregation instead of calling the shared one — which is exactly how D6 happened. A grep-level guard test costs nothing and catches it directly:

```ts
// src/lib/__tests__/no-per-initiative-task-queries.test.ts
// Guards Requirement 7: cadence views must derive tasks from the shared
// company-wide query, never by iterating a window's initiatives.
test("no planning component calls getTasksByInitiative", async () => {
  const files = await readdir("src/components/planning");
  for (const f of files) {
    const src = await readFile(join("src/components/planning", f), "utf8");
    expect(src, `${f} must use getTasksByCompanyDueBetween`).not.toContain("getTasksByInitiative");
  }
});
```

It is a structural assertion, not a behavioural one, and it is labelled as such. `src/components/initiatives/` is deliberately not covered by it — those views legitimately want one initiative's tasks.

### G.3 Test files and coverage map

All under `src/lib/__tests__/`, all `.test.ts`, all pure, no mocks, no Supabase.

**`plan-dates.test.ts`** — Requirements 10.3, 10.5, 10.7
- `parseDateOnly("2026-08-31")` → local Date with `getDate() === 31`
- round trip: `toDateOnly(parseDateOnly(s)) === s` over a generated span of dates
- `addDays`/`subDays` across a month end, a month start, a year end, a leap-February
- `isWithin` inclusive at both ends
- `startOfWeek`/`endOfWeek` for a week straddling 2026-08-31→09-06 and 2026-12-28→2027-01-03
- `clampDayToMonth(2027, 2, 31) === 28`, `clampDayToMonth(2028, 2, 31) === 29`

**`plan-lead-time.test.ts`** — Requirements 10.1, 10.2, 10.4
- `computeTaskDueDate("2026-09-14", 14) === "2026-08-31"` (the exact case Requirement 10.1 names)
- `computeTaskDueDate("2026-09-14", 20) === "2026-08-25"`
- `computeTaskDueDate("2027-01-05", 10) === "2026-12-26"`
- sign inversion: `computeTaskDueDate("2026-09-14", -14) === "2026-08-31"` — same as `+14`
- zero: `computeTaskDueDate(E, 0) === E`
- missing / `null` / `"abc"` / `NaN` / `Infinity` → `subDays(E, DEFAULT_LEAD_DAYS)`, and in every case the result is `<= E`
- null event date: `anchorFor({ eventDate: null, activationDate: "2026-09-01" })` → `"2026-09-01"`, and the resulting due dates satisfy the same `<= anchor` invariant

**`plan-schedule.test.ts`** — Requirements 10.6, 10.7, 10.8, 10.9
- a task due 2026-03-04 whose initiative activates 2026-09-01 is returned by `tasksInWindow` for the week and day windows covering 2026-03-04 (10.6 — the D4 regression guard)
- tasks on the first and last day of every window shape are included (10.7)
- **consistency assertions (10.8), stated as equalities over one fixture:**
  - `summarise(all, windowForMonth(2026, 8)) === groupByMonth(all, 2026).get(8)`
  - `Σ_{q=1..4} summarise(all, windowForQuarter(2026, q)) === summarise(all, windowForYear(2026))` for both `taskCount` and `estimatedHours` (Requirement 7.7's partition property)
  - for the straddling week 2026-08-31→09-06, the 08-31 task appears in August's group and not September's, and each task appears in exactly one month (7.5)
  - a task whose initiative also falls in the window appears exactly once (7.6)
  - calling `summarise` twice on the same inputs returns deep-equal results (7.8)
- selected-year independence (10.9): the same fixture aggregated for 2027 returns 2027's tasks, and a year with no tasks returns a zeroed summary rather than another year's numbers

**`plan-remediation.test.ts`** — Requirement 9's arithmetic
- a pure `correctedDueDate(eventDate, oldDueDate)` mirroring the SQL expression, tested against the derivation in F.1
- `needsRemediation(dueDate, eventDate, status)` matching the predicate in F.2 across all four stored cases in that table
- idempotence: `needsRemediation(correctedDueDate(E, d), E, "not_started") === false`

This module is the executable statement of the SQL's logic. The SQL itself is verified by the report-then-update procedure in F.5, not by a unit test — there is no database in the test environment, and inventing one would violate Requirement 10.11.

**`no-per-initiative-task-queries.test.ts`** — the structural guard from G.2.

Requirement 10.10 ("the suite SHALL fail if any behaviour in Requirements 3 through 8 regresses") is satisfied by all of the above running under `npm test`, with the caveat named in G.2: it covers the logic, and the structural guard covers the wiring.

### G.4 Timezone-dependent tests (Requirement 10.5)

Requirement 10.5 asks that a date written is read back as the same calendar day **in `America/New_York`**, and 5.2 generalises that to any offset. The tests must therefore run under more than one `TZ`.

Setting `process.env.TZ` inside a test file is not reliable across Node versions — the runtime may have already cached the zone before the assignment. The zone must be set **before the process starts**, so this is a script-level concern:

```json
"scripts": {
  "test": "vitest run",
  "test:tz": "TZ=America/New_York vitest run && TZ=UTC vitest run && TZ=Asia/Tokyo vitest run"
}
```

`America/New_York` (UTC−4/−5) is the app's stated default and the zone where the bug manifests. `UTC` is what Vercel functions run under, so it proves the generation-side formatting. `Asia/Tokyo` (UTC+9) is included because it exercises the *mirror* failure — a UTC+ zone shifts `toISOString()`-based writes forward a day rather than back, and a fix that only handles UTC− offsets would pass the first two runs and fail the third. The pure date modules must pass under all three.

`npm test` stays single-zone (whatever the machine's zone is) so the default developer loop is fast; `npm run test:tz` is the one that proves Requirement 5.2, and it is what a pre-merge check should run.

## Data Models

Migrations in this project are numbered sequentially in `supabase/migrations/` and applied **by hand in the Supabase SQL editor** — there is no migration runner in `package.json`. The highest existing number is `016_generation_events_hardening.sql`, so **the next free number is 017**.

| Migration | Purpose | Section |
| --- | --- | --- |
| `017_plan_generation_runs.sql` | new table holding the generation draft and phase state | A |
| `018_remediate_task_due_dates.sql` | one-time correction of stored `tasks.due_date` values | F |

Ordering is significant: 017 (with the application changes in A and C) must be deployed and verified before 018 runs, so the repair is not undone by new defective writes.

### 017 — `plan_generation_runs`

```sql
CREATE TABLE plan_generation_runs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id     UUID NOT NULL REFERENCES companies(id)    ON DELETE CASCADE,
  annual_plan_id UUID NOT NULL REFERENCES annual_plans(id)  ON DELETE CASCADE,
  created_by     UUID          REFERENCES profiles(id)      ON DELETE SET NULL,

  target_year    INT,                       -- null = current-year plan
  is_regeneration BOOLEAN NOT NULL DEFAULT false,

  phase          TEXT NOT NULL DEFAULT 'skeleton_pending'
                 CHECK (phase IN ('skeleton_pending','tasks_pending','commit_pending',
                                  'complete','failed','abandoned')),
  batch_cursor   INT  NOT NULL DEFAULT 0,   -- batches completed
  batch_total    INT,                       -- set when the skeleton lands

  questionnaire  JSONB NOT NULL,            -- the request payload, so a resume needs no client state
  draft          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { skeleton, tasksByBatch }

  snapshot_id    UUID,                      -- plan_snapshots row created by commit's reset
  error_code     TEXT,                      -- e.g. 'GENERATION_TRUNCATED', 'VALIDATION_FAILED'
  error_message  TEXT,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active run per company is an application rule (A.3), not a constraint:
-- a partial unique index would make superseding a run a two-statement dance.
CREATE INDEX plan_generation_runs_company_phase_idx
  ON plan_generation_runs (company_id, phase, updated_at DESC);
```

**Why JSONB for the draft rather than staging tables.** Staging copies of `initiatives` and `tasks` would need every column, every constraint, and a swap step — the same objection `plan-data-integrity` raised against its staging-swap option. The draft is opaque intermediate state that only the commit phase reads, and its shape is the AI response shape, which is already JSON. It is validated by `validateDraft` (A.6) before it is trusted, so the lack of column-level constraints costs nothing.

**`plan_generation_runs` is deliberately not a plan table.** No service reads it, no cadence view queries it, and it is excluded from `plan_snapshots` and from both reset endpoints. A row sitting in `skeleton_pending` forever is invisible to the customer's plan — which is the whole basis of Requirement 2.5 holding.

**RLS.** Enable RLS and follow the established pattern: a company-scoped `SELECT` policy mirroring `tasks` (`002_rls_policies.sql:311–315`, `USING (company_id = get_user_company_id())`), and `INSERT`/`UPDATE`/`DELETE` policies gated on `can_edit_plan() AND company_id = get_user_company_id()`, matching the plan-table write enforcement established in `014_plan_table_role_enforcement.sql` (which uses `can_edit_plan()`, defined in 008, to restrict plan writes to owner/operator). Reads stay open to all company members, consistent with 014's stated policy. The generation routes run through the cookie-based server client and already call `requirePlanEditor()` (`route.ts:143`), so the database policies and the application checks agree. The exact policy text should be confirmed against 008 and 014 during implementation rather than transcribed from here.

### No column changes to `initiatives` or `tasks`

Stated explicitly, because two plausible changes were considered and rejected:

- **`initiatives.event_date` stays nullable `DATE`** (`001_initial_schema.sql:196`). Reasoning in C.3: evergreen initiatives have no event, a `NOT NULL` would require backfilling with invented values, and `anchorFor` gives Requirement 4.4/4.5 the documented fallback the requirement actually asks for. `activation_date DATE NOT NULL` (line 195) is unchanged, which is what makes `anchorFor` total.
- **No provenance column on `tasks`.** A `due_date_source` column would let future remediation distinguish a generated date from a user-edited one — but it cannot recover history that was never recorded, so it does nothing for the known limitation in F.6. Adding it would be speculative work for a repair that is a fixed point after one run.

`tasks.due_date` and `initiatives.activation_date` / `event_date` remain `DATE`, which is what makes the `gte`/`lte` predicates in Section D timezone-free and the SQL arithmetic in Section F exact. Nothing in this design would be improved by moving them to `TIMESTAMPTZ`; several things would break.

## Rejected Alternatives

Alternatives are argued inline where the reasoning depends on local context — generation execution models in **A.9**, string-versus-`Date` representation in **B.1**, requiring `event_date` in **C.3**, database-versus-client filtering in **D.1**, context and store for selected year in **E.1**, `localStorage` as a year fallback in **E.6**, an admin route for remediation in **F.5**, and a DOM test harness in **G.2**. Two cross-cutting ones do not belong to a single section:

- **Force regeneration instead of remediating (Requirement 9).** Tell affected customers to regenerate. Rejected because it destroys work: regeneration replaces the initiative and task set wholesale, so any task a customer renamed, reassigned, re-estimated, or completed is gone. Requirement 9's user story is explicit that the customer should not have to regenerate. It is also strictly more expensive — one AI call per company versus one `UPDATE`.
- **Independent queries per view, verified by tests (Requirement 7).** `requirements.md` lists this as an open decision against a single shared query/selector. Rejected: tests can demonstrate that two implementations agree on the cases tested, but they cannot make agreement a property of the code. D6 is the evidence — four views with four private copies of the window math drifted apart precisely because nothing structurally tied them together. A shared selector makes divergence impossible rather than detectable, and it reduces the test burden to one module instead of one per view.

## Risks and Open Items

**Operator verification required before implementation lands**
1. **Vercel Function Max Duration and Fluid Compute status** (Deployment Constraints). Confirm both in Settings → Functions and record them. If the configured maximum is below 50 s, phase 2's batch size drops from 2 initiatives to 1. This is the only design parameter that depends on the answer.
2. **Re-test against a current deploy first.** `requirements.md` records an operational precondition: production runs commit `aa3cec8` with 43 files of completed work uncommitted. The `plan-data-integrity` Defect-1 fix is visibly present in the local `generating/page.tsx` but may not be deployed. Some reviewer findings may already be resolved in code that has not shipped. Re-testing a current deploy should precede implementation, and any requirement whose defect cannot be reproduced locally should be re-triaged rather than re-fixed.

**Risks accepted**
3. **Client-driven orchestration depends on the tab staying open.** A customer who closes the tab mid-generation leaves a stale run (handled: A.3) but gets no plan. The current flow has the same exposure — `generating/page.tsx:320` already tells the customer "Please keep this tab open" — and Deployment Constraints rules out the server-side alternative on this tier. Chunking makes each individual request short, which reduces the window in which a closed tab loses meaningful work, and resume means reopening the flow does not start from zero.
4. **Plan quality with a split prompt.** Phase 2 generates tasks with only its batch's initiatives in context, so it cannot balance effort across the full plan the way a single call could. Mitigated by passing the questionnaire's team-size and weekly-hours constraints into every batch prompt. Worth checking on the first few real generations; if task hour totals come out implausible, the batch prompt needs the running total of hours allocated so far.
5. **Manually edited due dates are indistinguishable from buggy ones** (F.6). Accepted and documented.
6. **Client cache coherence across views (Requirement 7.8).** `year-at-a-glance.tsx:129` reads through `CacheKeys.dashboard(companyId, selectedYear)`, and `src/lib/client-cache.ts` is a stale-while-revalidate cache backed by memory plus `sessionStorage`. If the cadence views cache task data under differently-shaped keys, two views could legitimately read different snapshots within one session and disagree — defeating Requirement 7.8 at the cache layer even though the selector is pure. **Open item:** define a single cache key shape for task data, keyed on `(companyId, window.start, window.end)`, or have the cadence views share one key per `(companyId, year)` fetch and slice it locally. This needs a read of `client-cache.ts`'s key registry during implementation; it is flagged rather than specified because the right answer depends on the existing key conventions.

**Open items needing a decision during implementation**
7. **Phase-2 batch size.** Specified as 2 pending item 1. Also worth measuring: if a single AI call reliably produces tasks for 4 initiatives in under 20 s, larger batches mean fewer round trips and less prompt duplication.
8. **`DEFAULT_LEAD_DAYS = 7` and `DEFAULT_EVENT_DAY = 15`.** Both are documented fallbacks satisfying Requirements 3.8 and 4.4, and both are guesses about what reads sensibly rather than derived values. 15 is chosen to preserve current behaviour for a model that omits `eventDay`; 7 is chosen as a plausible prep window. Either could be tuned after the first real generations; neither affects correctness.
9. **Whether `plan_generation_runs` rows should be snapshotted.** They are excluded from `plan_snapshots` here, on the grounds that they are scratch space. If a future feature wants "show me what the AI proposed before I edited it," that changes — noted so the exclusion is a decision rather than an omission.
10. **`monthly-planner.tsx` and `quarterly-planner.tsx` currently show no task data at all.** Section D adds it. That is new surface area in views that have their own layout conventions, and the design does not specify the visual treatment beyond "Tasks / Hours fed by `summarise`". The placement is a UI decision, not a correctness one, and Requirement 7 constrains only the numbers.

## Requirements Traceability

Every requirement 1–10 maps to the section that satisfies it. No requirement is orphaned.

| Req | Title | Satisfied by | Notes |
| --- | --- | --- | --- |
| **1** | Plan generation completes within platform limits | **A** (A.1, A.2, A.8), **Deployment Constraints** | 1.1 in-progress state = the run record's phase; 1.2 `maxDuration = 60` against a ~50 s target; 1.3 every phase returns a terminal or in-progress state; 1.4 nothing written before commit, so retry needs no repair (A.3); 1.5 per-phase token budgets 5000 / 3000; 1.6 commit's completeness validation (A.6) |
| **2** | Generation progress and failure are always visible | **A** (A.6, A.7), **D.5** | 2.1–2.3 phase-driven progress and the error branch (A.7); 2.4 `stop_reason === "max_tokens"` is terminal (A.6); 2.5 draft-then-commit — the load-bearing property (A.1); 2.6 counts reported from inserted rows (A.6); **2.7** cadence-view load failure versus empty window (**D.5**) |
| **3** | Preparation tasks fall before the event | **C** (C.1, C.2), **B.2** | 3.1–3.5 `computeTaskDueDate`; 3.6 identical wording in the prompt (`route.ts:94`) and the type doc (`initiative-type.types.ts:31`); 3.7 `Math.abs`; 3.8 `Number.isFinite` → `DEFAULT_LEAD_DAYS`; 3.9–3.10 `setDate` rollover in `addDays` (B.2) |
| **4** | Tasks are anchored to the initiative's real dates | **C** (C.3) | 4.1 `anchorFor`; 4.2 hardcoded day 15 removed from `route.ts:546` and `:581`; 4.3 `eventDay` from the model, clamped; 4.4–4.5 documented fallback to `activation_date`; 4.6–4.7 `eventMonth` extension; 4.8 `computeTaskDueDate` is pure and total |
| **5** | Date-only values are timezone-safe | **B** | 5.1–5.5 `parseDateOnly` / `toDateOnly` and the call-site table (B.3); 5.6–5.7 local-field rollover; 5.8 `isWithin`, inclusive, on `DateOnly` strings |
| **6** | Every task due in a window is visible in that window | **D** (D.1, D.3, D.4) | 6.1–6.4 `getTasksByCompanyDueBetween`, initiative not in the predicate; 6.5 `.eq('company_id')` plus RLS (`002_rls_policies.sql:313`); 6.6 inclusive bounds; 6.7–6.8 single range spans month and year boundaries; 6.9 empty versus error (D.5) |
| **7** | Cadence views agree with each other | **D** (D.2, D.3, D.4) | 7.1–7.4 one query path plus one `summarise`; **7.5** month attribution by the task's own due date, and a month total is never a sum of weeks; **7.6** flat task list deduplicated on `task.id`; 7.7 quarter windows are a partition of the year; 7.8 pure selector — see Risks item 6 for the cache caveat. Note Premise Correction 1: hour reporting is **introduced** here, not repaired |
| **8** | Every cadence view honours the selected year | **E** | 8.1–8.2 `?year=` plus `useSelectedYear`; 8.3 four module constants deleted (E.4); 8.4–8.5 every view reads `selectedYear`; 8.6 per-render evaluation and `todayDateOnly()` at point of use; 8.7 windows carry their own year; 8.8 `withYear` on inter-view links (E.6); 8.9 no cross-year fallback once the param is explicit (E.5) |
| **9** | Existing incorrect task due dates are remediated | **F** | 9.1 migration 018; 9.2–9.3 SQL `DATE` arithmetic plus the post-run verification query; 9.4 the predicate excludes already-correct rows (F.2); 9.5 idempotent by construction (F.3); 9.6 `event_date IS NULL` → unremediatable, reported; 9.7 the four counts plus the per-company detail query; 9.8 `status = 'not_started'` only, applied uniformly (F.4); 9.9 only `tasks.due_date` and `updated_at` are written (F.6) |
| **10** | The scheduling and boundary rules are protected by automated tests | **Testing Strategy** (G.1–G.4) | 10.1–10.4 `plan-lead-time.test.ts`; 10.5 `plan-dates.test.ts` under three zones via `test:tz` (G.4); 10.6–10.7 `plan-schedule.test.ts`; 10.8 selector-level equalities — **with the explicit gap that components are not rendered** (G.2); 10.9 selected-year independence in the selector tests; 10.10 the whole suite under `npm test` plus the structural guard; 10.11 pure modules called with literal dates, no mocks, no fabricated results |

**Requirement 2.7 cross-reference.** It is the one clause that sits outside its parent requirement's section: Requirement 2 is about generation, but 2.7 is about cadence-view load failures, so it is satisfied in D.5 alongside Requirement 6.9, which says the same thing from the other direction.

**Cross-spec boundary.** Snapshot creation, reset semantics, rollback-on-failure, and the fail-loud configuration work belong to `.kiro/specs/plan-data-integrity/`. This design repositions *when* the reset runs (A.4) and consumes its `snapshotId` contract unchanged; it does not redefine any of it.
