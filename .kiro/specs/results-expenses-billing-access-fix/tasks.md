# Implementation Plan

Rules for every task:
- **Stop after EACH task and wait for the user's approval before starting the next one.**
- Units run in order A → B → C. No unit starts until the previous unit's checkpoint is approved.
- No commits, no pushes. The database is shared with production: live checks are read-only probes run with `node_modules/.bin/vite-node -c vitest.config.ts <probe>.mts`, deleted straight after they run. No script writes.
- The dev server may be running: never delete `.next`.
- New tests are plain vitest with explicit `import { describe, it, expect } from "vitest"`. Property-style tests use seeded generator loops (no `fast-check`).
- Property numbers follow design.md (A: 1/2, B: 3/4, C: 5/6).

Verification task (referenced as **V** below) means all of:
1. `npx tsc --noEmit 2>&1 | grep -v "^\.next/"` shows no new errors (the two known pre-existing test-file errors are not counted).
2. `npm test -- --run` passes.
3. `npx eslint <touched files>` shows no new errors.
4. Read-only live re-check probe: counts of `results.actual_spend > 0`, `initiatives.actual_spend > 0` and `expenses` rows (design: 0 / 0 / 0 at design time). Report the counts, then delete the probe.

---

## Unit A: Results tab

- [x] 1. Confirm decision D1 with the user
  - Present D1 from design.md. Default: keep `results.actual_spend`, stop writing it from the Results tab, show non-zero legacy amounts read-only as "Legacy spend (from results)", not added to totals. Alternative: migration 038 (owner-applied) copying legacy spend into `expenses`.
  - Record the user's choice here. Tasks 2–5 do not start until this is answered.
  - **Answer (user, verbatim): "go with the recommendation, but use comma formatting for the overall website numbers, not just results. Now proceed with implementation".**
  - **D1 = recommended default chosen**: keep the `results.actual_spend` column, stop writing it from the Results tab, show non-zero legacy amounts read-only as "Legacy spend (from results)", not added to totals. No migration 038, so task 4.4 is not applicable.
  - Scope added: site-wide thousands-separator formatting (requirements 1.12, 2.15, 3.18), task 4.7.
  - _Requirements: 1.5, 2.6_

- [x] 2. Write bug condition exploration tests for the Results tab
  - **Property 1: Bug Condition** - Results tab records spend only as expenses, deletes for real, totals match rows
  - **CRITICAL**: these tests MUST FAIL on unfixed code. Do not fix code or tests when they fail.
  - Scope to `isBugCondition_A`: `action ∈ {view, addResult, editResult, deleteResult, reload}` or money shown without separators
  - `src/services/__tests__/` (existing service-test pattern, mocked Supabase): `resultService.deleteResult(id)` exists and issues `delete().eq('id', id).select('id')`; `{ data: [], error: null }` throws "You don't have permission to delete results"; a Supabase error throws
  - Totals table: a fixture copy of today's inline totals logic, fed generated tab states, yields three cards (two spend totals) where two are expected
  - Run, record counterexamples (e.g. "no deleteResult on ResultService", "Total Spend (Results) card present")
  - _Requirements: 1.1, 1.3, 2.1, 2.3, 2.4_

- [x] 3. Write preservation property tests for the Results tab (BEFORE the fix)
  - **Property 2: Preservation** - Results revenue, metrics, notes, expenses and planner behavior unchanged
  - Observation-first: record today's outputs for non-bug inputs, then lock them in with seeded generators
  - Revenue sum over generated result sets (whole, fractional, empty, NaN guards) equals the original reduce
  - `createInitiativeResult` with `actualSpend` supplied (planner/onboarding callers) still inserts it unchanged; company-level planner results still insert with no initiative
  - Expense create/delete payloads unchanged (category, description, amount, date)
  - Run on UNFIXED code: **EXPECTED OUTCOME** pass
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 4. Fix the Results tab
  - [x] 4.1 Pure helper `src/lib/results-tab-totals.ts` + colocated `results-tab-totals.test.ts`
    - `summariseResultsTab(results, expenses) -> { totalRevenue, totalExpenses, legacySpend, hasLegacySpend }`, integer-cent sums, non-finite → 0
    - `pickMoneyFormatter(amounts)`: `formatMoney` when all whole dollars, else `formatMoneyPrecise` (from `src/lib/format-money.ts`)
    - Seeded generator test: totals = Σ rows at 2-dp for any mix of amounts
    - _Requirements: 2.4, 2.5, 2.6_
  - [x] 4.2 `src/services/result.service.ts`
    - Add `deleteResult(id)` (zero rows → permission error; Supabase error → descriptive error)
    - Make `actualSpend` optional on `CreateInitiativeResultDTO`, default 0 in the insert
    - _Bug_Condition: isBugCondition_A, action = deleteResult/reload_
    - _Requirements: 2.3, 3.4_
  - [x] 4.3 `src/components/initiatives/initiative-results.tsx`
    - Two cards (Total Revenue, Total Expenses) from `summariseResultsTab`; D1 legacy line / per-row chip only if D1 default was chosen
    - Remove Spend from `ResultForm`, `ResultFormData`, `ResultRow` edit and read views; add/update no longer send `actualSpend`; update replaces the row with the returned one
    - `handleDeleteResult` awaits `deleteResult`, removes from state only on success, else inline `role="alert"` error
    - `NumberInputRaw` for revenue and amount inputs; metric chips via `formatNumber` (keep `<1 → %`); remove local `formatCurrency`/`Intl.NumberFormat` copies
    - _Expected_Behavior: Property 1 from design_
    - _Preservation: Property 2 from design_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2_
  - [x] 4.4 Not applicable (D1 default chosen in task 1, no migration 038). Originally: if D1 alternative was chosen, write `scripts/gen-migration-038.mjs` (`String.fromCharCode(36)` for `$`), generate the SQL, read it back from disk, hand it to the owner to apply.
    - _Requirements: 2.6_
  - [x] 4.5 Verify the exploration tests now pass
    - **Property 1: Expected Behavior** - re-run the SAME tests from task 2; **EXPECTED OUTCOME** pass
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [x] 4.6 Verify the preservation tests still pass
    - **Property 2: Preservation** - re-run the SAME tests from task 3; **EXPECTED OUTCOME** pass; add a test that the edit payload never contains `actualSpend`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [x] 4.7 Site-wide thousands-separator formatting
    - Audit `src/` (excluding tests) per design.md "Unit A addition": `.toFixed(` on display money/counts, `.toLocaleString()` without locale/options, local `Intl.NumberFormat`/`formatCurrency` copies, raw `${n}` / `$${n}` / `"$" + n` / `{"$"}{n}` money interpolation, `<input type="number">` money/count inputs. List hits (file:line) before editing.
    - Replace display sites with `formatMoney` / `formatMoneyPrecise` / `formatMoneyFromMinor` / `formatAxisMoney` / `formatNumber` from `src/lib/format-money.ts`; replace money/count inputs with `NumberInputRaw`
    - Leave unchanged: CSV exports (raw numbers), percentages, stored values and API payloads, AI prompt text
    - Re-run the audit; only the documented exceptions remain
    - _Requirements: 1.12, 2.15, 3.18_

- [x] 5. Verify Unit A (V)
  - Run V1–V4. Owner's manual localhost check on a dummy account: no Spend field, delete survives reload, totals match rows, separators shown on the Results tab and across the site (dashboard, reports, initiatives, settings/billing, admin), CSV exports still raw numbers, team-member delete shows the permission error.
  - _Requirements: 2.1–2.6, 2.15, 3.1–3.4, 3.18_

- [x] 6. Checkpoint A: Stop and wait for the user's approval before starting the next unit

---

## Unit B: ROI and actual spend

- [x] 7. Confirm decision D2 with the user
  - Present D2 from design.md. Default: every displayed initiative "actual spend" = Σ its expenses, labelled "Actual spend (from expenses)"; Overview Actual spend input removed (read-only derived figure shown); `planned_budget` unchanged. Alternative: keep the hand field relabelled "Manual spend estimate" beside the expenses figure.
  - Record the user's choice here. Tasks 8–11 do not start until this is answered.
  - **Answered (with D1, same reply in task 1): D2 = recommended default chosen**: every displayed initiative "actual spend" = Σ its expenses, labelled "Actual spend (from expenses)"; Overview Actual spend input removed, read-only derived figure shown; `planned_budget` unchanged. Task 10.3 follows the default branch.
  - _Requirements: 2.10, 3.9_

- [x] 8. Write bug condition exploration tests for ROI spend
  - **Property 3: Bug Condition** - ROI and every "actual spend" use recorded expenses
  - **CRITICAL**: MUST FAIL on unfixed code. Do not fix code or tests when they fail.
  - Scope to `isBugCondition_B`: `roiSpend(i) ≠ Σ expenses(i)`
  - Fixture copy of today's `roi-report.tsx` computation: expenses $2,000, hand field 0, revenue $5,000 → expected spend $2,000, net $3,000, ROI +150.0%; hand field $1,000, no expenses → expected spend $0, ROI N/A; ROI Total Spend = Expenses-report total
  - Run, record counterexamples (e.g. "spend 0, ROI null")
  - _Requirements: 1.6, 1.7, 1.8, 2.7, 2.8, 2.9_

- [x] 9. Write preservation property tests for ROI (BEFORE the fix)
  - **Property 4: Preservation** - ROI revenue, zero-spend handling, report columns and planned budget unchanged
  - Observation-first, seeded generators against a verbatim copy of today's logic as oracle
  - Revenue per initiative = Σ results revenue; zero spend → ROI `null` and excluded from ranking; row and type sort orders equal the original comparator; CSV column list unchanged
  - Existing `plan-totals.test.ts` passes untouched; `planned_budget` still written by the Overview update
  - Run on UNFIXED code: **EXPECTED OUTCOME** pass
  - _Requirements: 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 10. Fix ROI and actual spend
  - [x] 10.1 Pure helper `src/lib/initiative-spend.ts` + colocated `initiative-spend.test.ts`
    - `sumExpensesByInitiative` (cents-safe) and `buildRoiReport` per design (spend, net, roi, sorts copied from today, `totalSpend`, `unattributedSpend`)
    - Seeded generator test: `totalSpend = Σ rows.spend`, `totalSpend + unattributedSpend = companyExpenseTotal`
    - _Requirements: 2.7, 2.8, 2.9, 3.6, 3.7_
  - [x] 10.2 `src/components/reports/roi-report.tsx`
    - Load `expenseService.getAllExpenses()` once, render from `buildRoiReport`; "Recorded expenses" subtext; unattributed note when non-zero; CSV columns unchanged
    - _Bug_Condition: isBugCondition_B_
    - _Expected_Behavior: Property 3 from design_
    - _Requirements: 2.7, 2.8, 2.9, 3.5, 3.7_
  - [x] 10.3 D2 surfaces (per the choice recorded in task 7)
    - `initiative-revenue.tsx`: budget bar, over-budget text, ROI line from `getTotalSpendByInitiative`
    - `initiative-overview.tsx`: Actual spend input removed, `actualSpend` no longer sent, read-only derived figure; `plannedBudget` untouched
    - `src/app/(app)/initiatives/page.tsx` + `initiative-card.tsx`, `year-at-a-glance.tsx` (cards and CSV): spend from expenses, no `initiative.actualSpend` fallback; `sumInitiatives` signature unchanged
    - _Preservation: Property 4 from design_
    - _Requirements: 2.10, 3.8, 3.9_
  - [x] 10.4 Verify the exploration tests now pass
    - **Property 3: Expected Behavior** - re-run the SAME tests from task 8; **EXPECTED OUTCOME** pass
    - _Requirements: 2.7, 2.8, 2.9_
  - [x] 10.5 Verify the preservation tests still pass
    - **Property 4: Preservation** - re-run the SAME tests from task 9; **EXPECTED OUTCOME** pass
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 11. Verify Unit B (V)
  - Run V1–V4. Owner's manual check: expenses on one initiative show the same figure on the ROI row, Revenue budget bar, initiative card, Year at a Glance card and CSV; ROI Total Spend = Reports > Expenses total.
  - _Requirements: 2.7–2.10, 3.5–3.9_

- [x] 12. Checkpoint B: Stop and wait for the user's approval before starting the next unit

---

## Unit C: Billing after grant then revoke

Investigation first. No code fix is written until task 18 is approved. Probes are root-level `probe-bugc-<step>.mts`, load `.env.local` like `scripts/inspect-stripe-orphans.mjs`, use only `select` and Stripe `retrieve`/`list`, take a company id (never a name), print no emails/keys and only the last 6 characters of Stripe ids, and are deleted straight after running.

- [x] 13. C1: subscription row and owner probe
  - `probe-bugc-row.mts <companyId>` for Volcone Admin, and to identify a test company whose only owner is not a super admin (for C5)
  - Record the C1 fields from design.md and which hypotheses they point to (H1 shape, admin bypass, role, mode). Delete the probe.
  - Findings (probe run once, select-only, deleted; `ls probe-bugc-*` → no matches):
    - Settings: `stripe_enabled=true`, `trial_enabled=false`, `trial_plan_id=null`, `dunning_grace_days=7`.
    - Volcone Admin `5348835c` row: `plan_id=de1815a6` (Starter), `tier=starter`, `status=cancelled`, `stripe_status=canceled`, `billing_cycle=annual`, `is_comped=false`, `comped_until/reason/by` all cleared, `trial_ends_at=null`, `is_trial_active=false`, `stripe_customer_id=…zODE3L`, `stripe_subscription_id=…lFBebS`, `stripe_price_id=…1oyYQ9`, `stripe_mode=live`, period 2026-10-08 → 2027-10-08, `cancel_at_period_end=false`, `past_due_since=null`, `pending_plan_id=null`, `is_paused=false`.
    - `stripe_price_id …1oyYQ9` has NO row in `stripe_prices` (new fact: the price the old subscription used is unknown to our price table).
    - Profiles: owner (`is_admin=true`, `admin_level=super_admin`), viewer (not admin). Comp log: 6 comped / 5 uncomped, last `billing.uncomped` 2026-10-15.
    - Hypotheses: **H1 shape present** (comped `plan_id` + canceled Stripe sub id kept by revoke, confirmed in `/api/admin/subscribers` `uncomp`: writes only `is_comped=false`, `comped_until/reason/by=null`, `updated_at`). **Admin bypass applies** (owner `is_admin` → middleware gate skipped, `src/lib/supabase/middleware.ts` ~527), so this subject only exercises the Settings-panel path (H3); C5 required. Role = `owner` → `not_permitted` (H4) refuted. Mode = `live` = `STRIPE_MODE_TAG` → mode mismatch (H4) refuted.
    - What the row makes each path do (from code, not yet replayed — C3/C4 confirm):
      - `/api/billing/me`: `hasPurchasedPlan=false` (not comped, `stripe_status` not live) → no plan `isCurrent` (2.13 "current plan" part already OK). `hasStripeSubscription=true` (only checks id present + mode, ignores status).
      - `billing-panel.tsx`: heading "Change plan", buttons "Switch to this plan" → confirm → `POST /api/stripe/change-plan`; never calls Checkout. Portal link also shown.
      - `/api/stripe/change-plan`: comp guard passes; `no_subscription` guard passes (id + mode only, no live-status check); `subscriptions.retrieve(…lFBebS)` succeeds for a canceled sub; current price not in table → falls back to Stripe item amount; `classifyPlanChange` vs stale `plan_id` Starter/annual → Starter annual = 400 `no_change`; upgrade → `subscriptions.update` on a canceled sub (Stripe expected to refuse → 500 with Stripe message); downgrade → schedule path on a canceled sub (expected 500). Predicted: H1/H3 dead end.
      - `/api/stripe/checkout` (only if reached, e.g. via `/choose-plan`): owner check passes; DB guard passes (`canceled` not in active/trialing/past_due); Stripe guard depends on C2 (`subscriptions.list` for `…zODE3L`).
      - `evaluateAccess` input status = `stripe_status ?? status` = `canceled`, not comped, trial off → expected no access; non-admin owners would be redirected to `/choose-plan`, this owner is not.
    - C5 subject: **`bc7b0df6`** (1 member, sole owner not a super admin, `status=cancelled`, no Stripe sub, no plan, not comped, not paused, no comp history). Alternatives with the same shape: `c9f747c1`, `93aa6225`. Caveat: no non-admin company has a canceled Stripe sub id, and the three with live subs (`c0673a62`, `ef03ec4c`, `c252ebcb`) cannot be comped (`has_paid_subscription` guard), so after grant→revoke `bc7b0df6` will carry the stale `plan_id` but `hasStripeSubscription=false`, i.e. it tests the Checkout path, not the stale-sub-id path. `3b92ac9f` (PMA, currently comped) has a super-admin owner, so it is not a C5 subject.
  - _Requirements: 1.10, 2.11_

- [x] 14. C2: Stripe state probe
  - `probe-bugc-stripe.mts <companyId>`: customer exists/deleted, `subscriptions.list({status:'all'})` with status and schedule, `subscriptionSchedules.list`
  - Record H2 / H4 (`resource_missing`) outcome. Delete the probe.
  - Findings (probe run on `5348835c`, select + Stripe retrieve/list only, app's pinned API version `2026-08-26.dahlia`, deleted; `ls probe-bugc-*` → no matches):
    - Key kind in `.env.local` = **test**. The customer is `livemode=false`, so the row's `stripe_mode='live'` is just `STRIPE_MODE_TAG` and matches the key's universe (no mismatch).
    - Customer `…zODE3L`: exists, **not deleted**.
    - `subscriptions.list({status:'all'})`: **1 subscription**, `…lFBebS` (= the row's sub), `status=canceled`, `isLiveSubscription=false`, `cancel_at_period_end=false`, `canceled_at = ended_at = 2026-10-14T14:58:56Z`, `schedule=null`, metadata `company_id` matches. Item price `…1oyYQ9` (active, yearly, unit_amount 149000 = $1,490/yr), product `…2n0dxs` (active).
    - `subscriptionSchedules.list`: 1 schedule `…ktxp7R`, `status=released`, `released_subscription=…lFBebS` (left over from an earlier downgrade schedule; nothing pending).
    - `subscriptions.retrieve(…lFBebS)`: succeeds, `canceled`, same customer (no `resource_missing`).
    - `prices.retrieve(…1oyYQ9)`: succeeds, active. It is a valid Stripe price that is simply absent from `stripe_prices` (not current for any plan). Current `stripe_prices` rows exist for all 3 plans × monthly/annual (`99ddd34b`, `de1815a6`, `90a5b85c`), so Checkout would not hit `price_not_found` for any of them.
    - Side note (not verified further): the canceled sub was $1,490/yr while the row's stale `plan_id` is Starter `de1815a6`; the row's plan/price pair is internally inconsistent after grant → revoke.
    - Checkout guard replay (from `src/app/api/stripe/checkout/route.ts`): DB guard (`stripe_subscription_id` + mode `live` + `stripe_status ∈ {active,trialing,past_due}`) → **passes** (`canceled`). Stripe guard (`subscriptions.list({customer, status:'all', limit:20})`, refuse if any `isLiveSubscription` status `active|trialing|past_due|unpaid`) → runs, finds none → **passes**. Customer reused. So **Checkout would not be refused** for this company if reached; it would create a session.
    - **H2 refuted** (Stripe has no live subscription the row misses). **H4 `resource_missing` refuted** (customer, sub and price all retrievable). H4 `price_not_found` / mode mismatch refuted. Remaining lead: **H1/H3**, the Settings panel offering Change plan (`hasStripeSubscription=true` on a canceled sub) instead of Checkout. Change-plan would call `subscriptions.update` on a `canceled` sub, which Stripe is expected to refuse (to be replayed in C3, observed in C4).
  - _Requirements: 2.11, 2.14_

- [x] 15. C3: decision replay probe
  - `probe-bugc-decide.mts <companyId>` imports the real pure modules and replays (a)–(g) from design.md on the C1/C2 data, no HTTP
  - Record the predicted landing screen, offered action and server answer, mapped to H1–H4. Delete the probe.
  - Findings (probe run on `5348835c` as-is and on `bc7b0df6` as-is + in-memory grant→revoke; select + Stripe `subscriptions.list`/`retrieve` only, no `update`; deleted, `ls probe-bugc-*` → no matches):
    - Real modules imported: `evaluateAccess`, `requiresPurchase`, `lockoutCopy`, `isAllowedWhileLockedOut`, `isLiveSubscription`, `canStartCheckout`, `scheduleActionFor`, `describePlanChange`, `classifyPlanChange`/`changeTiming` (these two live in `src/lib/billing/limits.ts`, not `plan-change.ts`), `canCancel`/`canReactivate`, `loadBillingConfig`. Inline logic replicated verbatim: middleware gate `src/lib/supabase/middleware.ts:518-633` (admin bypass :527); `/choose-plan` `page.tsx:96-135`; `/api/billing/me` `hasPurchasedPlan` :478-482, `isCurrent` :615, `hasStripeSubscription` :657-658; billing panel heading :709, card button :792-812, `changeKindFor` :272-282, repurchase button :617; checkout guards `checkout/route.ts:108-182` (inline, does NOT call `canStartCheckout`, same answer here); change-plan `change-plan/route.ts:85-189` + timing branches.
    - Live plans: only **Starter** (`de1815a6`) and **Pro** (`90a5b85c`) are active; all 4 plan × cycle prices are current. The canceled Volcone sub's item (149000/yr, `…1oyYQ9`) equals **Pro annual**'s current amount, while the row's stale `plan_id` says Starter (confirms the C2 side note: plan/price pair inconsistent).
    - **Volcone Admin `5348835c`** (owner is super admin):

      | Path | Result |
      |---|---|
      | (a) Middleware | `evaluateAccess` → `canceled`, not allowed, but **admin bypass**, so `/settings` and the app render (no redirect). |
      | (b) `/choose-plan` (only if typed) | Renders: "Your subscription has ended / Your **Starter** subscription has been cancelled…" (stale plan name). Buttons "Choose Starter"/"Choose Pro" → `POST /api/stripe/checkout` `returnTo:"welcome"` → DB guard passes, Stripe guard passes → **200 {url}** (customer `…zODE3L` reused). |
      | (c) `/api/billing/me` | `hasPurchasedPlan=false`, no plan `isCurrent`, **`hasStripeSubscription=true`**, `planName="Starter"`, `access.reason=canceled`. |
      | (d) Settings > Billing (where this owner lands) | Notice "Your subscription has been cancelled. Pick a plan to start again." `canReactivate` → `repurchase` → "Start a new subscription" (scrolls to picker). Portal link "Manage payment & invoices" shown. Picker heading **"Change plan"**, every card button **"Switch to this plan"** → `PlanChangeModal` with client kind `upgrade` for every target (no `isCurrent`) → confirm label **"Upgrade and pay now"** → `POST /api/stripe/change-plan`. Checkout is never called from this screen. |
      | (f) change-plan answer | Starter annual → **400 `no_change`**; Pro annual → **400 `no_change`** (different plan, same 149000 price → `classifyPlanChange` "same"); Starter monthly → `cycle_change` → `subscriptions.update` on a `canceled` sub → **500 `{error:<Stripe message>}`**; Pro monthly → `downgrade` → `subscriptionSchedules.create(from_subscription)` on a `canceled` sub → **500 `{error:<Stripe message>}`**. UI shows "Could not change plan: no_change" or "Could not change plan: <Stripe message>". Current amount came from the Stripe item (price not in our table). |
      | (g) Allow-list | `/settings` false, `/api/stripe/change-plan` false (irrelevant here because of the admin bypass), `/choose-plan`, `/api/billing/me`, `/api/stripe/checkout`, `/api/stripe/portal`, `/api/billing/reconcile` true. |
      | Hypothesis | **H1 + H3 confirmed on paper**: stale `stripe_subscription_id` (H1) makes `hasStripeSubscription` true, so the panel routes every purchase to change-plan (H3), which cannot succeed on a canceled sub. Every result is a dead end. H2/H4 refuted (C2). |

      - Stripe dry check: `subscriptions.retrieve(…lFBebS)` → `status=canceled`, `schedule=null`. Not updated. Per [Stripe: Cancel subscriptions](https://docs.stripe.com/billing/subscriptions/cancel), once a subscription is canceled only its metadata and cancellation_details can be updated, and a canceled subscription cannot be reactivated, so the `update` (and a schedule created from it) is refused. Content was rephrased for compliance with licensing restrictions. The exact Stripe error text is unconfirmed until C4.
    - **C5 subject `bc7b0df6`** (sole owner, not admin). Comp writes `is_comped, comped_until, comped_reason, comped_by, plan_id, updated_at` (`/api/admin/subscribers` route.ts:380-392); uncomp clears only the comp fields (:419-427). **Net effect of grant→revoke is `plan_id` only.** Replayed as-is and with `plan_id` = Starter and = Pro; all three give the same answers:

      | Path | Result |
      |---|---|
      | (a) Middleware | `evaluateAccess` input status = `stripe_status ?? status` = **`'cancelled'`** (British spelling, `stripe_status` null). `evaluateAccess` only knows `'canceled'`, so it falls through to **`incomplete`**. `requiresPurchase` → true → `/settings` and app pages redirect to **`/choose-plan`**. |
      | (b) `/choose-plan` | Renders with **wrong copy**: "Your payment wasn't completed / It looks like checkout was interrupted…", CTA "Finish checkout". Buttons "Choose Starter"/"Choose Pro" (monthly + annual) → `POST /api/stripe/checkout` `returnTo:"welcome"` → owner ok, prices found, DB guard passes, no customer so no Stripe guard → **200 {url}** (a new Stripe customer is created and its id written to the row by the checkout route). |
      | (c)/(d) Settings | Not reachable (redirected). If it were: `hasStripeSubscription=false` → "Choose a plan" / "Upgrade to this plan" → Checkout. |
      | (f) change-plan | Not offered. Would be 404 `no_subscription` (and 402 from the middleware, not allow-listed). |
      | Hypothesis | Purchase works on paper. The non-admin grant→revoke path is **not** blocked; only the lockout copy is wrong (a `'cancelled'` vs `'canceled'` mismatch, present before the grant too, so not caused by grant/revoke). Note: `bc7b0df6` has no stale Stripe sub id, so it cannot exercise the H1 stale-sub path (see task 13 caveat). |

    - **Expected browser observation, C4 (Volcone Admin owner, Settings > Billing, DevTools Network open):** lands on `/settings` (no redirect). Picker heading "Change plan", buttons "Switch to this plan". Clicking any plan opens a modal "Upgrade to <plan>?" with "Upgrade and pay now". Confirm sends `POST /api/stripe/change-plan` `{planId, billingCycle}`, never `/api/stripe/checkout`. Expected responses: Starter annual or Pro annual → `400 {"error":"no_change"}`; Starter monthly or Pro monthly → `500 {"error":"<Stripe message about a canceled subscription>"}` with Vercel log `[stripe/change-plan] Error: …`. No Stripe page is reached. Typing `/choose-plan` by hand should instead show "Your Starter subscription has been cancelled" and "Choose <plan>" should return `200 {url}` and open the Stripe page (stop there).
    - **Expected browser observation, C5 (`bc7b0df6` owner after grant→revoke):** any app URL redirects to `/choose-plan`. Heading "Your payment wasn't completed", CTA copy "Finish checkout". "Choose Starter"/"Choose Pro" sends `POST /api/stripe/checkout` with `returnTo:"welcome"` → `200 {"url":"https://checkout.stripe.com/…"}` → Stripe-hosted page (stop there; this creates a Stripe test customer). If C5 instead shows a refusal, the replay is wrong and must be re-hypothesised.
  - _Requirements: 1.11, 2.11, 2.13_

- [x] 16. C4: observed failure (owner-performed, browser)
  - The owner, signed in as the subject's owner with DevTools Network open, attempts a purchase and stops at the Stripe-hosted page (test key, no payment). No script writes.
  - Record landing URL, button text, request, response status/body, matching Vercel log line. Compare with C3; a mismatch means re-hypothesise.
  - Findings (owner report from the browser as Volcone Admin `5348835c` super-admin owner, verbatim: "when trying to switch to this plan I am unable to do it with this error Could not change plan: no_change"):
    - Observed: Settings > Billing, button "Switch to this plan" → confirm → UI error "Could not change plan: no_change", i.e. `/api/stripe/change-plan` answered `400 {"error":"no_change"}`. No Stripe page reached.
    - Comparison with C3: matches the C3 prediction for an annual target (Starter annual or Pro annual → 400 `no_change`). The panel offered change-plan instead of Checkout, confirming **H3**, driven by the stale canceled `stripe_subscription_id` (**H1**) making `hasStripeSubscription=true`. No mismatch, so no re-hypothesis needed.
    - Not separately observed: the monthly-target 500 path and the hand-typed `/choose-plan` Checkout path (C3 predicts 500 Stripe error and `200 {url}` respectively); the exact network body and Vercel log line were not supplied by the owner.
  - _Requirements: 1.9, 2.11_

- [x] 17. C5: non-admin reproduction (owner-performed, browser)
  - The owner grants then revokes on `/admin/companies` for the non-admin test company found in task 13, then repeats C1–C4 as that owner (C1–C3 probes recreated, run, deleted). No script writes.
  - Record whether the defect is admin-owner only or every customer.
  - Findings:
    - The owner reported verbatim: "It is working well for customers". The non-admin customer path after grant then revoke reaches purchase. This matches the C3 prediction for `bc7b0df6` (redirect to `/choose-plan`, Checkout returns 200).
    - Conclusion: the purchase blocker is limited to companies that still hold a stale canceled `stripe_subscription_id`. That is the admin-owner subject (H1+H3). Normal customers aren't blocked; their only defect is the `'cancelled'` vs `'canceled'` lockout copy.
  - _Requirements: 1.9, 2.11, 2.12_

- [x] 18. Write the confirmed root cause and chosen fix into this file, and get approval
  - Add a "Confirmed root cause" section: evidence from tasks 13–17, which of H1–H4 is confirmed and which refuted
  - Add the chosen fix (from design.md "Candidate fixes", or a new one agreed with the user) as concrete sub-tasks under task 19, including the exploration test (**Property 5: Bug Condition**) and the preservation test (**Property 6: Preservation**)
  - Stop and wait for approval. Task 19 does not start until it is approved.
  - _Requirements: 2.11_

  ### Confirmed root cause

  - **H1 + H3 confirmed.** Revoke (`uncomp`) clears only the comp fields, so a company that once paid keeps its canceled `stripe_subscription_id` (Volcone Admin `5348835c`: `…lFBebS`, `stripe_status=canceled`). `/api/billing/me` sets `hasStripeSubscription` from "id present + mode tag" and ignores status (H1). The Settings billing panel picks Change plan vs Checkout from that flag alone, so it offers "Switch to this plan" and calls `/api/stripe/change-plan` (H3). That route has no live-status check either; it classifies against the stale `plan_id`/price and answers `400 no_change` (annual targets) or calls Stripe on a canceled subscription → `500` (monthly targets). Checkout is never reached from this screen.
    - Evidence: task 13 (row shape, `uncomp` writes), task 14 (Stripe: only a `canceled` sub, no schedule pending), task 15 (decision replay predicting `no_change`/500), task 16 (owner observed "Could not change plan: no_change", matching the replay), task 17 (non-admin customer after grant→revoke reaches Checkout: "It is working well for customers").
  - **H2 refuted** (task 14): Stripe has no live subscription the row misses; both Checkout guards pass.
  - **H4 refuted** (tasks 13–14): role is `owner`, mode matches, the customer/sub/price all retrieve (no `resource_missing`), every plan × cycle has a current price.
  - **Second, independent defect (copy):** rows written as `status='cancelled'` (British spelling, `stripe_status` null) fall through `evaluateAccess` to `incomplete`, so `/choose-plan` says "Your payment wasn't completed / Finish checkout" to someone whose subscription ended. Present before any grant/revoke (task 15, `bc7b0df6`).
  - **Pause interaction:** a paused company is sent to `/account-paused` (pages) or gets `403 account_paused` (every non-public API, including `/api/stripe/checkout` and `/api/billing/me`), and `/choose-plan` redirects paused accounts to `/account-paused`. So a paused company with no live subscription has no way to buy. Probe at task-18 time (`5348835c`, select + Stripe retrieve only, deleted): **the row is NOT currently paused** (`is_paused=false`, `pause_origin=null`, no row in the database has `is_paused=true`). Last pause events are 2026-10-09 (before the sub was canceled, Stripe then `active`, unpaused 17:28 the same day); no `billing.paused` event after the 2026-10-14 cancellation. So the owner's current `no_change` symptom is the H1+H3 path alone. Admin pause code path (`/api/admin/subscribers/pause`): calls `stripe.subscriptions.update(pause_collection)` whenever a sub id exists; on a canceled sub Stripe refuses, the error is caught, the local `is_paused` is still written, and the response is `200 { paused: true, stripeSynced: false, stripeError }`. It does not crash (the admin sees "Stripe could not be updated"). Not changed.

  ### Approved fix (user)

  - **Fix 4 approved**: a canceled or otherwise non-live Stripe subscription is treated as NO subscription (billing/me flag, panel, change-plan route).
  - **Fix 5 approved**: the lockout copy handles the `'cancelled'` spelling (`evaluateAccess` normalises it to `canceled`).
  - **Pause decision, verbatim: "Buying a plan ends the pause"**: a paused company with no live Stripe subscription (and not comped) can reach Checkout from where it lands; when the purchase completes the webhook writes the subscription and clears every pause column (`is_paused`, `paused_at`, `paused_by`, `pause_reason`, `pause_resumes_at`, `pause_origin`, `pause_reminder_sent_at`). A paused company WITH a live subscription keeps today's behaviour (admin must resume; change-plan refused while paused).
  - **Fix 6 NOT approved**: revoke does not clear the comped `plan_id`.
  - Implementation choice (minor, noted): a paused account that is also comped is NOT offered Checkout while paused (the comp is admin-held; buying on top of it would create a paid sub that change-plan and cancel then refuse to manage).

- [x] 19. Fix billing after grant then revoke (sub-tasks written in task 18)
  - Order once written: exploration test fails on unfixed code → preservation tests pass on unfixed code → pure helper + colocated test → route/UI changes → exploration test passes → preservation tests still pass
  - Preservation must cover: comp guard, Checkout double-billing guards, change-plan timing, webhook-only writes, `evaluateAccess` precedence, paused redirect, super-admin bypass; existing `entitlement.test.ts`, `lockout.test.ts`, `plan-change.test.ts` pass untouched
  - _Requirements: 2.12, 2.13, 2.14, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17_
  - [x] 19.1 Exploration test `src/lib/billing/__tests__/revoked-purchase.exploration.test.ts`
    - **Property 5: Bug Condition** - A revoked customer can buy a plan
    - **CRITICAL**: MUST FAIL on unfixed code. `computeUnderTest` starts as a verbatim copy of today's decisions, then is pointed at the new helpers (19.4)
    - (a) canceled sub id → `hasStripeSubscription=false`, panel action `checkout`; (b) paused + no live sub → non-admin owner reaches `/choose-plan` and `/api/stripe/checkout`, panel action `checkout`; (c) `status='cancelled'`, `stripe_status=null` → `evaluateAccess` reason `canceled`, lockout copy "Your subscription has ended"; (d) change-plan guard refuses a non-live sub with `409 no_live_subscription`, not `no_change`/500
    - _Requirements: 1.9, 1.11, 2.12, 2.13, 2.14_
  - [x] 19.2 Preservation test `src/lib/billing/__tests__/revoked-purchase.preservation.test.ts`
    - **Property 6: Preservation** - Entitlement, comp, Checkout and change-plan rules unchanged for every other state
    - Seeded generator loops; MUST PASS on unfixed code. Covers: comp guard, Checkout DB + Stripe guards, change-plan guard/classification/timing for LIVE subs, webhook-only writes (checkout route writes only customer id/mode; webhook comp/status mapping; pause never cleared for a sub that predates the pause), `evaluateAccess` precedence vs a verbatim oracle (statuses other than `'cancelled'`), paused + live sub always blocked, super-admin bypass, `/api/me` exact match
    - _Requirements: 3.10–3.17_
  - [x] 19.3 Pure helpers + colocated tests
    - `src/lib/billing/live-subscription.ts` (+ `.test.ts`): `normaliseSubscriptionStatus` (`'cancelled'`→`'canceled'`), `hasLiveStripeSubscription(row)` (id + mode tag + `isLiveSubscription(stripe_status ?? status)`), `canPurchaseWhilePaused(row)`, `isAllowedWhilePausedWithoutSubscription(path)`, `changePlanGuard(row)`
    - `src/lib/billing/billing-gate.ts` (+ `.test.ts`): `decideBillingGate` — the middleware's paused + entitlement decision as a pure function
    - `webhook-logic.ts`: `shouldClearPauseOnSync` (paused, incoming live, no `pause_collection`, sub created after `paused_at`) + `PAUSE_CLEAR_PATCH`
    - _Requirements: 2.12, 2.13, 2.14_
  - [x] 19.4 Route/UI changes
    - `entitlement.ts`: normalise `'cancelled'`; `lockout.ts`: copy for a paused account that can buy
    - `/api/billing/me`: `hasStripeSubscription` via `hasLiveStripeSubscription` (also feeds `canCancel`)
    - `billing-panel.tsx`: paused-no-live notice points at the picker; picker already switches to Checkout when the flag is false
    - `/api/stripe/change-plan`: `changePlanGuard` before any Stripe call (`409 no_live_subscription`; `403 account_paused` for paused + live)
    - `middleware.ts`: uses `decideBillingGate`; paused + no live sub may reach `/choose-plan`, `/checkout`, `/welcome`, `/api/stripe/checkout`, `/api/billing/me`, `/api/billing/reconcile`, `/api/me`, `/api/auth/*`
    - `/choose-plan`: renders for paused + no live sub (copy "Your account is paused"); `/account-paused`: "Choose a plan" button for that case
    - Stripe webhook: clears pause columns via `shouldClearPauseOnSync`
    - Checkout route unchanged (guards pass for paused + canceled); admin pause unchanged (does not crash)
    - _Requirements: 2.12, 2.13, 2.14, 3.13, 3.14, 3.15, 3.17_
  - [x] 19.5 Exploration test passes after the fix; preservation tests still pass
    - _Requirements: 2.12–2.14, 3.10–3.17_
    - Results: exploration 7/7 failed on unfixed code (counterexamples: canceled sub id → `hasStripeSubscription=true`/panel `change_plan`; paused + no live sub → gate `paused` on `/api/stripe/checkout`; webhook never clears the pause; `'cancelled'` → `incomplete`; change-plan guard proceeds to Stripe), 7/7 pass after. Preservation 11/11 passed on unfixed code and after. `entitlement.test.ts`, `lockout.test.ts`, `plan-change.test.ts` untouched and passing. Full suite 63 files / 1,580 tests pass; `tsc --noEmit` clean outside `.next/`; eslint on touched files: only the 2 errors already present at HEAD in `billing-panel.tsx`.
    - Not changed: `/api/billing/reconcile` (does not clear the pause; if it records the new sub before the webhook lands, the customer sees `/account-paused` for those seconds until the webhook clears it), `/api/admin/subscribers/pause` (does not crash on a canceled sub, see task 18).

- [x] 20. Verify Unit C (V)
  - Run V1–V4. Owner repeats C4 (admin-owner) and C5 (non-admin): Checkout reaches the Stripe-hosted page from the screen each owner lands on. Re-run the C1 probe to confirm the fix itself wrote nothing to the row, then delete it.
  - Findings (automated, combined tree = Unit C fix + retention-coupon fix in `retention-coupon.ts`/`.test.ts`/`cancel-subscription-modal.tsx`; nothing fixed, nothing committed):
    - V1 `npx tsc --noEmit 2>&1 | grep -v "^\.next/"` → **0 lines**.
    - V2 `npm test -- --run` → **63 files / 1,580 tests passed** (includes `retention-coupon.test.ts` 7/7, `live-subscription`, `billing-gate`, revoked-purchase exploration + preservation).
    - V3 eslint vs HEAD (`git show HEAD:<f> | npx eslint --stdin`): **no new errors**. Modified files checked: `middleware.ts`, `stripe/webhook`, `stripe/change-plan`, `billing/me`, `billing-panel.tsx`, `choose-plan/page.tsx`, `account-paused/page.tsx`, `retention-coupon.ts`, `cancel-subscription-modal.tsx`, `entitlement.ts`, `lockout.ts`, `webhook-logic.ts`; all 0 errors except `billing-panel.tsx` with the same 2 pre-existing HEAD errors (`react-hooks/set-state-in-effect`, `react-hooks/immutability`). New files (`live-subscription(.test).ts`, `billing-gate(.test).ts`, `retention-coupon.test.ts`, both `__tests__/revoked-purchase.*`) are clean.
    - C1 re-probe (`probe-unit-c.mts`, select-only, run 2026-10-16T13:17Z, deleted; `ls probe-unit-c*` → no matches). Volcone Admin `5348835c` row identical to task 13: `is_paused=false`, `status=cancelled`, `stripe_status=canceled`, `is_comped=false`, `plan_id=de1815a6`, customer `…zODE3L`, sub `…lFBebS`, price `…1oyYQ9`, `pause_origin=null`. `updated_at=2026-10-15T18:58:37Z`, before today's fix and consistent with the last `billing.uncomped` (2026-10-15) from task 13, so **the fix wrote nothing to the row**. (Stale `paused_at=2026-10-09` remains from the earlier pause/unpause; pre-existing, not written by the fix.)
    - Counts: `results.actual_spend>0` = **0**, `initiatives.actual_spend>0` = **0**, `expenses` rows = **1**.
    - Owner browser re-check (verbatim): "tested subscriotion works well now." Purchase from the fixed screens confirmed.
  - _Requirements: 2.11–2.14, 3.10–3.17_

- [x] 21. Checkpoint C: Stop and wait for the user's approval before closing the spec
  - Approved by the owner after the task 20 re-check. The spec is closed.
