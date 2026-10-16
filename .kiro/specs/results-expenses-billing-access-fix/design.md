# Results, Expenses and Billing Access Bugfix Design

## Overview

Three defects, designed as three independently shippable units, in the order A, B, C. Each unit is a separate task and each needs the user's approval before the next starts.

- **Unit A, Results tab.** Remove "Spend" from the Initiative > Results tab so Expenses is the only place spending is recorded. Make the tab's totals come from the same arrays as its rows. Make Delete actually delete. Format every amount with thousands separators. Legacy `results.actual_spend` values are kept and shown read-only (decision D1, **confirmed: recommended default**). Thousands-separator formatting is extended to the whole website (requirements 1.12 / 2.15 / 3.18), still inside Unit A.
- **Unit B, ROI and "actual spend".** Use recorded expenses as the only source of an initiative's actual spend on the ROI tab, and on every screen that shows an initiative's "actual spend". The hand-typed `initiatives.actual_spend` stops being an input (decision D2, **confirmed: recommended default**). `planned_budget` is unchanged.
- **Unit C, billing after grant then revoke.** The root cause is not confirmed. This unit is a step-by-step, read-only debugging plan. Each outcome maps to a hypothesis (H1–H4), and each hypothesis has a candidate fix. **The code fix is chosen only after the probes have run.**

Ground rules for all three units (from `AGENTS.md` and the project handover):

- Nothing is pushed. `main` deploys production.
- The database is shared with production. Live checks are read-only probes run with `node_modules/.bin/vite-node -c vitest.config.ts <probe>.mts`, deleted afterwards.
- Any schema or data change is a hand-applied migration. Any SQL containing `$$` is produced by a generator in the `scripts/gen-migration-0XX.mjs` pattern. The latest migration is 037, so the next number is 038. **None of the recommended defaults needs a migration.**
- New logic goes in pure helpers in `src/lib`, with colocated vitest tests that import `{ describe, it, expect }` from `"vitest"` explicitly.
- No new dependencies. `fast-check` is not installed, so property-style tests are table-driven generators written in plain vitest (seeded loops over generated inputs).

### Evidence gathered while writing this design

A read-only probe (`probe-revoked.mts`, run once, then deleted) read `activity_log`, `subscriptions`, `profiles`, `app_settings` and Stripe `subscriptions.list`. It wrote nothing.

| Finding | Value |
|---|---|
| `results` rows with `actual_spend > 0` | 0 |
| `initiatives` rows with `actual_spend > 0` | 0 |
| `expenses` rows (any) | 0 |
| Billing settings | `stripe_enabled = true`, `trial_enabled = false`, `dunning_grace_days = 7` |
| Companies with comp/uncomp events | 5 (3 since deleted) |
| **Volcone Admin**: last action `billing.uncomped` (2026-10-15), 6 grants / 5 revokes | `is_comped=false`, `plan_id=de1815a6…` (the comped plan), `status='cancelled'`, `stripe_status='canceled'`, `stripe_subscription_id=…lFBebS`, `stripe_mode='live'`, `current_period_end=2027-10-08`, trial fields null. Stripe has that one subscription, `canceled`. Profiles: owner (**super admin**), viewer. |
| **PMA** (one of several companies with this name): currently comped | `is_comped=true`, same shape underneath (canceled Stripe subscription `…uCf3Nj`). Profiles: owner (super admin), owner (not admin). |

So a grant-then-revoked subject already exists (Volcone Admin). Its owner is a super admin, and super admins skip the middleware billing gate. It therefore exercises the admin-owner path only. A non-admin subject has to be produced by the owner through the admin UI (see C-step 5). No script writes to the database.

The zero counts mean D1 and D2 affect no live data today. The database is shared with production, so these counts are re-checked by the same read-only query just before Units A and B close.

## Glossary

- **Bug_Condition (C)**: the inputs that trigger a defect. One per unit: `C_A`, `C_B`, `C_C`.
- **Property (P)**: the required behavior for inputs where C holds.
- **Preservation**: behavior for inputs where C does not hold. It must be identical before and after the fix.
- **F / F'**: the original / fixed function or screen.
- **Results tab**: `InitiativeResults` in `src/components/initiatives/initiative-results.tsx`.
- **Results spend / legacy spend**: `results.actual_spend` (`NUMERIC(12,2) NOT NULL DEFAULT 0`). Written today by the Results tab, the weekly planner (`src/components/planning/weekly-planner.tsx`) and onboarding (always 0).
- **Expenses**: rows in `expenses` (`initiative_id` is `NOT NULL` in `001_initial_schema.sql`). Read by Reports > Expenses through `expenseService.getAllExpenses()`, which is scoped by RLS to the caller's company.
- **Initiative actual spend**: `initiatives.actual_spend`, typed by hand in the Overview edit form (`initiative-overview.tsx`). Read today by the ROI report, the Revenue tab budget bar (`initiative-revenue.tsx`), and as a fallback on initiative cards and in Year at a Glance.
- **Comp / grant / revoke**: `POST /api/admin/subscribers` with `action: 'comp'` or `'uncomp'`, called from `/admin/companies` (`company-management.tsx`).
- **Live Stripe subscription**: Stripe status in `isLiveSubscription` (`src/lib/billing/plan-change.ts`): `active`, `trialing`, `past_due`, `unpaid`.
- **evaluateAccess**: the single access decision in `src/lib/billing/entitlement.ts`.
- **Lockout allow-list**: `isAllowedWhileLockedOut` in `src/lib/billing/lockout.ts`.
- **D1, D2**: the two decisions (requirements 2.6 and 2.10). Both **confirmed by the user: recommended defaults**.

## Bug Details

### Bug A: Results tab

#### Bug Condition

Confirmed by reading `initiative-results.tsx` and `result.service.ts`:

- The tab renders three summary cards. One of them, "Total Spend (Results)", sums `results.actual_spend`.
- `ResultForm` and the `ResultRow` edit mode both have a Spend input, and the row's read view shows Spend.
- `handleDeleteResult` only filters local state. `ResultService` has no delete method. Nothing reaches the database, so the row returns on reload.
- Revenue, spend and expense inputs are `<input type="number">`, so they show raw digits. Metric chips print the raw value (`12500`). The cards and rows use `Intl.NumberFormat` currency, which does add separators. Formatting is therefore inconsistent across the tab.

**Formal Specification:**
```
FUNCTION isBugCondition_A(input)
  INPUT: input = { action, tabState }
         action ∈ {view, addResult, editResult, deleteResult, reload}
  OUTPUT: boolean

  RETURN action = view                                   // a separate Spend total/field is shown
      OR action IN {addResult, editResult}               // a Spend field is offered
      OR (action = deleteResult AND rowStillInDatabase(input))
      OR (action = reload AND aPreviouslyDeletedResultIsBack(input))
      OR anyMoneyShown(tabState) WITHOUT thousands separators
END FUNCTION
```

#### Examples

- An initiative has one result with revenue 12,500 and spend 300, plus one expense of 450. Actual: cards show "$12,500 / $300 / $450", with two spend totals. Expected: "Total Revenue $12,500" and "Total Expenses $450" only. The 300 appears as "Legacy spend (from results) $300" (D1).
- The user deletes a result with revenue 5,000 and reloads. Actual: it is back, and Total Revenue includes 5,000 again. Expected: it is gone and the total drops by 5,000.
- The user edits a result. Actual: the revenue input shows `12500`. Expected: `12,500`.
- Edge case: a team member (`can_execute` but not `can_edit_plan`) deletes a result. The RLS delete policy filters the row, so Supabase returns no error and deletes 0 rows. Expected: the row stays and the user sees "You don't have permission to delete results". It must not vanish from the screen and then reappear.

### Bug B: ROI tab and "actual spend"

#### Bug Condition

Confirmed in `roi-report.tsx`: `spend = initiative.actualSpend || 0`. Expenses are never read. Other screens each pick a different source:

| Screen | Spend source today |
|---|---|
| Reports > ROI (cards, table, by-type, CSV) | `initiatives.actual_spend` |
| Reports > Expenses | `expenses` |
| Initiative > Results | `results.actual_spend` and `expenses`, side by side |
| Initiative > Revenue (budget bar, ROI line) | `initiatives.actual_spend` |
| Initiative cards, Year at a Glance cards and CSV | `results.actual_spend` for this year, else `initiatives.actual_spend` |

**Formal Specification:**
```
FUNCTION isBugCondition_B(i)
  INPUT: i = an initiative, with expenses E(i), results R(i), hand field H(i)
  OUTPUT: boolean

  LET expenseSpend = Σ e.amount FOR e IN E(i)
  RETURN roiSpend(i) ≠ expenseSpend
      OR EXISTS screen s: displayedActualSpend(s, i) ≠ expenseSpend
                          AND s does not say what its figure is
END FUNCTION
```

#### Examples

- Expenses $2,000, hand field 0, revenue $5,000. Actual ROI row: spend $0, net $5,000, ROI "N/A". Expected: spend $2,000, net $3,000, ROI +150.0%.
- Hand field $1,000, no expenses. Actual: ROI shows $1,000 while Reports > Expenses shows $0. Expected: ROI shows $0 and ROI "N/A" (3.6), matching the Expenses report.
- ROI Total Spend ≠ Reports > Expenses total for the same company. Expected: equal. Any scope gap (an expense whose initiative is not in the ROI list) is stated on screen.

### Bug C: Billing after grant then revoke

#### Bug Condition

Confirmed in code: `uncomp` clears only `is_comped`, `comped_until`, `comped_reason` and `comped_by`. The live data shows the resulting shape: comped `plan_id`, a canceled Stripe subscription id and `stripe_status='canceled'` all stay. Not confirmed: which purchase path fails, and why.

**Formal Specification:**
```
FUNCTION isBugCondition_C(company)
  INPUT: company with subscription row S, Stripe state T, activity log L
  OUTPUT: boolean

  RETURN L contains billing.comped followed later by billing.uncomped
     AND S.is_comped = false
     AND NOT EXISTS t IN T.subscriptions: isLiveSubscription(t.status)   // 2.12 scope
     AND NOT purchaseCanBeCompleted(company, from ∈ {/choose-plan, /settings billing panel})
END FUNCTION
```
`purchaseCanBeCompleted` means the customer gets a Stripe Checkout URL, or a successful change-plan, from the screen they are actually shown. The 2.14 case (T has a live subscription) is handled separately under H2.

#### Examples

- Predicted from code for Volcone Admin. **To be confirmed by C-steps 3–4.** The owner is a super admin, so the gate does not redirect them and Settings > Billing renders. `/api/billing/me` sets `hasStripeSubscription = true` because it checks only that the id exists and the mode matches, not the status. The panel therefore shows "Change plan" and "Switch to this plan". `/api/stripe/change-plan` then either returns `no_change` (target = the comped plan on the same cycle, compared against the stale `plan_id`) or calls `subscriptions.update` on a canceled subscription, which Stripe refuses → 500.
- Predicted for a non-admin owner in the same state. **To be confirmed by C-step 5.** `evaluateAccess` → `canceled` → redirect to `/choose-plan` → Checkout. The DB guard passes (`canceled`) and the Stripe guard finds no live subscription, so Checkout should succeed. If it does, the defect is specific to the Settings panel path.
- Edge case (H4): the stored Stripe customer was deleted in Stripe. `subscriptions.list` throws `resource_missing`, and the checkout catch block maps that to `price_stale` ("This plan is not set up correctly in Stripe yet"). The message is wrong and the purchase is blocked.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

Unit A
- Adding, editing and viewing a result still records and shows revenue, week dates, metrics and notes (3.1).
- Expense add and delete still save category, description, amount and date. They still appear in the Expenses list and the Expenses report (3.2).
- Revenue figures that come from results are unchanged everywhere they are read: Initiatives list actuals, Year at a Glance, weekly planner, top-performer ranking, chat account context (3.3).
- The weekly planner still saves company-level results with no initiative, including its own Spend field (3.4). Removing Spend from the planner is out of scope for A (see Out of scope).
- Editing a result in the Results tab no longer sends `actualSpend`, so an existing legacy value is never overwritten with 0.

Unit B
- ROI revenue is still the sum of the initiative's results revenue (3.5).
- Zero spend still shows ROI "N/A" and stays out of the ranking (3.6).
- ROI CSV columns, ranking and by-type tables keep their columns and sort order (3.7).
- The Revenue, Products and Expenses report tabs show the same figures as today (3.8).
- `planned_budget` is still entered, stored and shown as the plan figure (3.9).

Unit C
- Grant still gives access on the chosen plan with its limits, until revoke or end date (3.10).
- Revoking a company with no other entitlement still removes access (3.11).
- Granting to a company with a live paid subscription is still refused (3.12).
- Change plan for a live subscriber keeps its timing: upgrades immediate and prorated, downgrades at period end (3.13).
- A second Checkout for a live subscriber is still refused (3.14).
- The webhook stays the only writer of paid subscription state, and Checkout grants nothing (3.15).
- `evaluateAccess` stays the single decision, with unchanged precedence (3.16).
- Paused accounts still go to `/account-paused`, and super admins are never locked out (3.17).

**Scope:**
Inputs outside each bug condition are unaffected:
- A: other initiative tabs, the weekly planner, onboarding's first-result write, expense CRUD.
- B: any revenue computation, `planned_budget`, report tabs other than ROI, plan generation and Enhance (which write `actual_spend: 0` and are left alone).
- C: every subscription state other than "revoked comp with no live Stripe subscription", plus the 2.14 live-subscription case. In particular: active, trialing, past_due within grace, paused, comped, and never-comped canceled accounts.

## Hypothesized Root Cause

### Unit A (confirmed in code)
1. **No delete in the data layer.** `ResultService` has no `deleteResult`, and `handleDeleteResult` only updates React state.
2. **Two spend fields by design.** The tab was built when results carried spend. Expenses were added later beside it, and nothing was removed.
3. **Raw number inputs and ad-hoc formatters.** `<input type="number">` cannot show separators. The project's answer, `NumberInputRaw` in `src/components/ui/number-input.tsx`, is not used on this tab, and `src/lib/format-money.ts` is not used either.
4. **Totals and rows can drift.** `handleUpdateResult` merges `updates` into local state without the row the server returned. Delete drifts as described above. The totals are computed from state, so they are only as right as that state.

### Unit B (confirmed in code)
1. `roi-report.tsx` reads `initiative.actualSpend` and never loads expenses.
2. There is no shared "actual spend for an initiative" function, so every screen picks its own source.

### Unit C (to be confirmed by probes)
1. **H1, stale state.** Revoke leaves the comped `plan_id`, `stripe_subscription_id` of a canceled subscription, `stripe_status` and the period columns. A purchase path that reads these as "already has a plan" fails. Candidates found in code: `hasStripeSubscription` in `/api/billing/me` ignores status; `change-plan` compares the target against the stale `plan_id`; `/choose-plan` names the comped plan in its "Your X subscription has been cancelled" copy.
2. **H2, Stripe disagrees.** Stripe has a live subscription the row does not reflect. Checkout's Stripe guard refuses with `already_subscribed`, while change-plan has nothing local to change. The DB guard uses `active|trialing|past_due` but the Stripe guard uses `isLiveSubscription`, which adds `unpaid`. Initial evidence refutes H2 for Volcone Admin (Stripe has only a `canceled` subscription). It is still checked for the non-admin subject.
3. **H3, screens disagree.** Middleware, `/choose-plan`, `/api/billing/me` and the Settings panel reach different conclusions. Known divergences: super admins bypass the gate, so they see Settings while `evaluateAccess` says "purchase required"; `/api/stripe/change-plan` is not on the lockout allow-list; the panel decides Change plan vs Checkout from `hasStripeSubscription` alone.
4. **H4, other.** Candidates: the role is not `owner` (`not_permitted`); the Stripe customer was deleted and `resource_missing` is mis-mapped to `price_stale`; there is no current price for the target plan (`price_not_found`); `stripe_mode` mismatch; or something new found during the steps.

## Correctness Properties

Property 1: Bug Condition - Results tab records spend only as expenses, deletes for real, and totals match rows

_For any_ Results-tab state and action where isBugCondition_A holds, the fixed tab SHALL show exactly two totals, Total Revenue and Total Expenses. It SHALL offer no Spend input when adding or editing a result. Deleting a result SHALL remove it from the database, so it does not reappear after reload. If the delete is refused, the row SHALL stay and an error SHALL be shown. Total Revenue SHALL equal the sum of the listed results' revenue, and Total Expenses SHALL equal the sum of the listed expense amounts. Every monetary amount SHALL be formatted with thousands separators. Any non-zero legacy results spend SHALL be shown read-only as "Legacy spend (from results)" (D1, confirmed).

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6**

Property 2: Preservation - Results revenue, metrics, notes, expenses and planner behavior unchanged

_For any_ input where isBugCondition_A does not hold, the fixed code SHALL produce the same result as the original. That covers revenue, dates, metrics and notes on results; expense creation and deletion; results revenue consumed by other screens; and weekly-planner company-level results. Editing a result SHALL NOT change its stored `actual_spend`.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4**

Property 3: Bug Condition - ROI and every "actual spend" use recorded expenses

_For any_ initiative where isBugCondition_B holds, the fixed ROI tab SHALL use Σ expenses for that initiative as spend. Net SHALL be revenue − spend, and ROI SHALL be (revenue − spend) / spend × 100. ROI Total Spend SHALL equal the sum of the per-initiative spend figures and SHALL equal the Expenses report total for the same company, with any scope difference stated on screen. Every other screen that shows an initiative's actual spend SHALL show that same expenses-derived figure, labelled as coming from expenses (D2, confirmed).

**Validates: Requirements 2.7, 2.8, 2.9, 2.10**

Property 4: Preservation - ROI revenue, zero-spend handling, report columns and planned budget unchanged

_For any_ input where isBugCondition_B does not hold, the fixed code SHALL produce the same result as the original. That covers revenue per initiative, "N/A" ROI and ranking exclusion for zero spend, CSV columns and sort orders, the Revenue, Products and Expenses report figures, and `planned_budget` storage and display.

**Validates: Requirements 3.5, 3.6, 3.7, 3.8, 3.9**

Property 5: Bug Condition - A revoked customer can buy a plan

_For any_ company where isBugCondition_C holds, the fixed system SHALL let the owner start Checkout from whichever purchase screen they are shown (`/choose-plan` or Settings > Billing) and complete it. It SHALL NOT mark the previously comped plan as current, and it SHALL NOT offer Change plan unless a live Stripe subscription exists. Where Stripe does have a live subscription the row does not reflect (2.14), the system SHALL reconcile it or explain it, rather than refusing both Checkout and Change plan.

**Validates: Requirements 2.11, 2.12, 2.13, 2.14**

Property 6: Preservation - Entitlement, comp, Checkout and change-plan rules unchanged for every other state

_For any_ subscription state where isBugCondition_C does not hold, `evaluateAccess`, the comp/uncomp guards, the Checkout double-billing guards, change-plan timing, the webhook-only write rule, the paused redirect and the super-admin bypass SHALL behave exactly as before.

**Validates: Requirements 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17**

## Fix Implementation

### Pending decisions (the tasks phase gates on these)

| ID | Requirement | Recommended default (designed for) | Alternative | Status |
|---|---|---|---|---|
| D1 | 2.6 legacy `results.actual_spend` | Keep the column, with no destructive migration. Stop writing it from the Results tab. Show any non-zero legacy amount as a read-only "Legacy spend (from results)" line on the Results tab, so nothing disappears silently. It is not added to Total Expenses or ROI. | Migration 038, hand-applied by the owner: copy each non-zero `results.actual_spend` into an `expenses` row (`category='other'`, `description='Migrated from weekly result <week>'`, `date=week_start_date`, `source='manual'`, same `company_id`/`initiative_id`, skipping rows with no initiative), then set the source to 0. Generated by `scripts/gen-migration-038.mjs` if it needs `$$`. The live count is 0 today, so it would copy nothing. | **Confirmed: recommended default** (no migration 038) |
| D2 | 2.10 `initiatives.actual_spend` | Every displayed "actual spend" for an initiative is Σ of its expenses, labelled "Actual spend (from expenses)". The Overview edit form drops the Actual spend input and shows the derived figure read-only, with a pointer to Results > Expenses. The column stays, is no longer written by the UI, and is not read for display. `planned_budget` is unchanged. | Keep the hand field, relabel it "Manual spend estimate", and show it beside the expenses figure. | **Confirmed: recommended default** |

If the user picks an alternative, only the marked sub-steps change. Each unit's shape stays the same.

### Unit A: Results tab (ship first, then wait for approval)

**New pure helper** `src/lib/results-tab-totals.ts`, with `results-tab-totals.test.ts`:
```
summariseResultsTab(results: {actualRevenue, actualSpend}[], expenses: {amount}[])
  -> { totalRevenue, totalExpenses, legacySpend, hasLegacySpend }
```
- Sums in integer cents (`Math.round(x * 100)`), then divides, so totals equal the sum of rows displayed at 2-decimal precision. Non-finite values count as 0.
- `legacySpend` = Σ `actualSpend`; `hasLegacySpend = legacySpend > 0` (D1).
- `pickMoneyFormatter(amounts)` returns `formatMoney` when every amount is whole dollars, otherwise `formatMoneyPrecise`. It is applied per section (revenue, expenses), so a total and its rows always use the same precision.

**`src/services/result.service.ts`**
1. Add `deleteResult(id)`: `delete().eq('id', id).select('id')`. Throw a descriptive error if Supabase returns one. If the response has zero rows, throw "You don't have permission to delete results" (RLS filters the row silently: the delete policy requires `can_edit_plan`, while insert only requires `can_execute`). Same error style as `createInitiativeResult`.
2. `createInitiativeResult` / `updateResult`: leave as they are. Callers simply stop sending `actualSpend`. Make `actualSpend` optional on `CreateInitiativeResultDTO` and default it to `0` in the insert, so the planner and onboarding, which still pass it, are unchanged.

**`src/components/initiatives/initiative-results.tsx`**
1. Summary grid: two cards, Total Revenue and Total Expenses, from `summariseResultsTab`. When `hasLegacySpend` (D1), a muted read-only line below them: "Legacy spend (from results): $X. Recorded before spend moved to Expenses. Not included in totals." With D1-alternative this line is omitted.
2. `ResultForm`, `ResultFormData` and the `ResultRow` edit form: remove Spend. `handleAddResult` stops passing `actualSpend`. `handleUpdateResult` sends only `actualRevenue`, `metrics` and `notes`, and replaces the row with the one `updateResult` returns, not a local merge.
3. `ResultRow` read view: remove the Spend column. When that row's legacy `actualSpend > 0` (D1), show a small read-only "Legacy spend $X" chip.
4. `handleDeleteResult`: becomes async and awaits `resultService.deleteResult`. It removes the row from state only on success. On failure it keeps the row and shows an inline error (`role="alert"`).
5. Formatting: replace the revenue and amount `<input type="number">` with `NumberInputRaw`, and format the cards and rows through the formatter from `pickMoneyFormatter`. Metric chips use `formatNumber` for values ≥ 1 and keep the existing `<1 → %` rule.
6. Remove the local `formatCurrency`/`Intl.NumberFormat` copies in this file.

### Unit A addition: site-wide thousands-separator formatting (requirements 1.12, 2.15, 3.18)

Added at D1 confirmation: the user asked for comma formatting across the whole website, not just the Results tab. It ships inside Unit A, after the Results tab fix.

**Approach: audit, then replace with the shared formatters.**
1. Codebase-wide audit of `src/` (excluding tests), listing each hit with file and line before changing anything:
   - `.toFixed(` used on money or counts for display;
   - `.toLocaleString()` called without a locale/options (inconsistent per browser locale);
   - local `Intl.NumberFormat` / `formatCurrency` copies;
   - raw money interpolation: `` `${n}` ``, `` `$${n}` ``, `"$" + n`, `{"$"}{n}` in JSX;
   - `<input type="number">` used for money or large counts.
2. Replace display sites with the helpers in `src/lib/format-money.ts`: `formatMoney` (default, whole dollars), `formatMoneyPrecise` (where cents matter: invoices, expenses with cents), `formatMoneyFromMinor` (Stripe minor units), `formatAxisMoney` (chart axes), `formatNumber` (bare counts). No new formatter is added unless the audit finds a case none of these covers, in which case it goes in `format-money.ts` with a test.
3. Replace money/count inputs with `NumberInputRaw` (`src/components/ui/number-input.tsx`). It shows separators while typing but hands the caller the raw string, so `Number(value)` and the API payload are unchanged (3.18).

**Deliberately unchanged (3.18):**
- CSV exports stay raw machine-readable numbers (no separators, no `$`), so spreadsheets parse them.
- Percentages (ROI %, progress %, the metric-chip `<1 → %` rule) keep their current formatting.
- Stored values and API payloads are untouched; this is display only.
- AI prompt text (e.g. chat account context) is not a screen and is left as is.

**Testing:** extend `format-money` tests only if a formatter is added or changed. A small audit-guard test is not added (grep-based tests are brittle); instead the audit list is re-run at V and must show no remaining display hits outside the exceptions above.

### Unit B: ROI and actual spend (only after A is approved)

**New pure helper** `src/lib/initiative-spend.ts`, with `initiative-spend.test.ts`:
```
sumExpensesByInitiative(expenses: {initiativeId, amount}[]) -> Map<id, number>   // cents-safe
buildRoiReport({ initiatives: {id,name,status,initiativeTypeId}[],
                 revenueById: Map<id, number>,
                 spendById: Map<id, number>,
                 typeNameById: Map<typeId, string>,
                 companyExpenseTotal: number })
  -> { rows, typeRows, totalRevenue, totalSpend, unattributedSpend }
```
- Per row: `spend = spendById.get(id) ?? 0`, `net = revenue − spend`, `roi = spend > 0 ? (revenue − spend)/spend × 100 : null`.
- Row sort and type sort are copied from today's code (ROI descending, nulls last) so 3.7 holds.
- `totalSpend = Σ row.spend`. `unattributedSpend = companyExpenseTotal − totalSpend`, which is 0 while every expense's initiative is in the list.

**`src/components/reports/roi-report.tsx`**
1. Load `expenseService.getAllExpenses()` once, the same call and RLS scope as the Expenses report. Build `spendById`, call `buildRoiReport`, and render from its output. Revenue loading is unchanged (3.5).
2. Total Spend card subtext: "Recorded expenses". When `unattributedSpend ≠ 0`, add a note: "$X of expenses are not linked to an initiative in this list."
3. CSV keeps the same columns. The Spend values now come from expenses.

**D2 surfaces.** Each uses `sumExpensesByInitiative` and the label "Actual spend (from expenses)", or "Spend (expenses)" where space is short:
- `initiative-revenue.tsx` (Initiative > Revenue): load `expenseService.getTotalSpendByInitiative(id)`. The budget bar, over-budget text and ROI line use it.
- `initiative-overview.tsx`: remove the Actual spend input and stop sending `actualSpend` in the update. Show a read-only derived figure. `plannedBudget` is untouched.
- `src/app/(app)/initiatives/page.tsx` + `initiative-card.tsx`: `actuals.spend` comes from expenses, with no fallback to `initiative.actualSpend`.
- `year-at-a-glance.tsx`: the summary cards and the CSV "Actual spend" column use expenses, with no fallback.
- `sumInitiatives` in `plan-totals.ts` keeps its signature. Callers pass the expenses-derived spend.

With D2-alternative, these surfaces instead show both figures, each labelled.

### Unit C: Billing after grant then revoke (only after B is approved)

The fix is **chosen after C-steps 1–5**, and the chosen fix is written into tasks.md before any code changes. Every probe is a root-level `probe-bugc-<step>.mts`, run with `node_modules/.bin/vite-node -c vitest.config.ts`. A probe loads `.env.local` the way `scripts/inspect-stripe-orphans.mjs` does. It uses only `select` and Stripe `retrieve`/`list` calls, takes the company id as an argument, and prints no emails, keys or full Stripe ids (only the last 6 characters). It is deleted straight after it runs. Duplicate company names (several "PMA") mean subjects are always addressed by id.

#### Step-by-step debugging plan

| Step | Probe | What it reads | Outcome → implication |
|---|---|---|---|
| **C1** Subject and row | `probe-bugc-row.mts <companyId>` | `subscriptions` row: `plan_id`, `tier`, `status`, `stripe_status`, `is_comped`, `comped_*`, `trial_ends_at`, `is_trial_active`, `stripe_customer_id` (present?), `stripe_subscription_id` (tail), `stripe_price_id`, `stripe_mode`, `current_period_*`, `cancel_at_period_end`, `past_due_since`, `pending_plan_id`, `is_paused`. Owner profiles: `role`, `is_admin`. Last comp/uncomp from `activity_log`. | `plan_id` = comped plan **and** stale canceled sub id → H1 shape present (already seen on Volcone Admin). Owner `is_admin` → that subject is on the admin-bypass path only (H3), so C5 is required. Owner role ≠ `owner` → H4 (`not_permitted`). `stripe_mode ≠ 'live'` → H4 (mode mismatch). |
| **C2** Stripe | `probe-bugc-stripe.mts <companyId>` | `customers.retrieve` (exists / `deleted`), `subscriptions.list({customer, status:'all'})` with status and `schedule` per sub, `subscriptionSchedules.list({customer})`. | Any `isLiveSubscription` status while the row says canceled → **H2**. Customer `deleted` or `resource_missing` → **H4** (checkout mis-maps it to `price_stale`). Only canceled/expired subs → H2 refuted for this subject. |
| **C3** Decision replay | `probe-bugc-decide.mts <companyId>`. It imports the real pure modules (`evaluateAccess`, `requiresPurchase`, `isAllowedWhileLockedOut`, `isLiveSubscription`, `classifyPlanChange`) and replays each route's logic on the C1/C2 data, without HTTP. | (a) middleware: `evaluateAccess` with `isPaused:false` + `requiresPurchase` + the `is_admin` bypass → redirect to `/choose-plan` or not; (b) `/choose-plan` page: `evaluateAccess` → render or redirect; (c) `/api/billing/me`: `hasPurchasedPlan`, `isCurrent` per plan, `hasStripeSubscription`; (d) Settings panel: Change plan vs Checkout (from `hasStripeSubscription`); (e) Checkout: DB guard, Stripe guard, `price_not_found` per plan/cycle; (f) change-plan: `is_comped`, sub id/mode, `classifyPlanChange` against stale `plan_id` → `no_change` / upgrade / downgrade, and whether the Stripe sub is live; (g) allow-list for `/settings`, `/api/billing/me`, `/api/stripe/checkout`, `/api/stripe/change-plan`. | The screen the customer actually lands on, the action it offers, and what the server answers for that action. "Offers Change plan, change-plan cannot succeed" → **H1/H3**. "Lands on /choose-plan, Checkout refuses" → **H2** or **H4**. "Locked out, but the offered action's API is not allow-listed" → **H3**. All paths succeed on paper → go to C4 for the real error (**H4**). |
| **C4** Observed failure | Manual, by the owner, in the browser with DevTools Network open, signed in as the subject's owner. Stop at the Stripe-hosted page; the Stripe key is a test key, and no payment is completed. | The URL landed on, the button text, the request (`/api/stripe/checkout` or `/api/stripe/change-plan`), the response status and body, and the matching Vercel log line (`[stripe/checkout]` / `[stripe/change-plan]`). | Confirms or refutes C3's prediction. A mismatch means the replay or the hypothesis is wrong → re-hypothesise before any fix. |
| **C5** Non-admin reproduction | The owner, via `/admin/companies`: grant, then revoke, on a **test company whose only owner is not a super admin** (C1 is used to confirm which company id qualifies, e.g. the PMA with a single non-admin owner). Then repeat C1–C4 as that owner. **No script writes.** | Same as C1–C4. | Separates "admin-owner only" from "every customer". If the non-admin path works, the defect is the Settings-panel path (H1/H3). |

Initial evidence, for C1–C2 only, on Volcone Admin: H1 shape present; owner is a super admin; Stripe has only a canceled subscription, so H2 is refuted there. C3–C5 have not been run.

#### Candidate fixes, one per hypothesis (pick after probes)

- **H1, stale state** (the leading candidate on current evidence, not confirmed):
  1. New pure `purchasePath(row)` in `src/lib/billing/purchase-path.ts`, with a test: returns `'change_plan'` only when `stripe_subscription_id` exists, `stripe_mode === STRIPE_MODE_TAG` and `isLiveSubscription(stripe_status)`; `'none'` when comped or paused; otherwise `'checkout'`.
  2. `/api/billing/me` adds `purchasePath` (and `hasStripeSubscription` keeps its current meaning, so the portal link is unchanged). `billing-panel.tsx` uses `purchasePath` for the heading ("Change plan" / "Choose a plan"), the button label and the Checkout vs change-plan call.
  3. `/api/stripe/change-plan` returns `404 no_subscription` when the Stripe sub is not live, before any `subscriptions.update`.
  4. Optional, decided after C3: on `uncomp`, when no live Stripe sub exists, set `plan_id` back to the plan of `stripe_price_id`, or leave it alone. This only affects the `/choose-plan` copy and the usage labels. It is a code change in the admin route, not a migration.
- **H2, Stripe disagrees:** on `already_subscribed`, `/choose-plan` and the panel call `/api/billing/reconcile` once and reload, with a one-shot marker like `/welcome`'s `confirmed=1`. Reconcile adopts the live sub, so the customer then has access or a valid Change plan. Align the Checkout DB guard with `isLiveSubscription` (add `unpaid`) so the two guards agree.
- **H3, screens disagree:** route every Change-vs-Checkout decision through `purchasePath`. Add `/api/stripe/change-plan` to the lockout allow-list **only if** C3/C5 show a locked-out non-admin being offered a live-subscription action (for example `past_due_expired`). It is not added by default, because change-plan for a live subscriber does not need the lockout path.
- **H4, other:** depends on what is found. `resource_missing` customer → Checkout treats the stored customer as absent, creates a new customer, and logs it. `price_*` errors keep their mapping. `not_permitted` → a copy/ownership fix in the admin flow, raised with the user before any change. Anything new → added to this section and agreed before coding.

Whatever is chosen, the fix must keep Property 6: comp guard, Checkout double-billing guards, webhook-only writes and `evaluateAccess` precedence stay unchanged.

### Out of scope (raise separately if wanted)

- The weekly planner's own Spend field and `results.actual_spend` writes (3.4 keeps them). Moving planner spend into expenses would need company-level expenses, but `expenses.initiative_id` is `NOT NULL`, which means a schema change.
- The chat account context's "spent" figures (`chat-account-context.ts`). This is an AI prompt rather than a screen. It can follow D2 later.
- `past_due_expired` customers whose Stripe sub is still live end up on `/choose-plan`, where Checkout is refused. This was spotted while reading the code. It is not part of 1.9 unless C3 shows it.

## Testing Strategy

### Validation Approach

Two phases per unit. First, write tests against the pure helpers and data-layer functions that encode the bug condition, and run them on UNFIXED behavior: today's inline logic is extracted verbatim into the helper's "original" fixture, so the tests surface counterexamples. Then implement the fix, and check (a) the bug-condition tests now pass and (b) the preservation tests give identical results for non-buggy inputs. `npm test -- --run` and `npm run build` (with `NODE_OPTIONS=--max-old-space-size=8192`) must be clean before each unit is presented. The two known pre-existing type errors are not counted.

### Exploratory Bug Condition Checking

**Goal**: surface counterexamples before fixing, and confirm or refute the root cause.

**Test Plan**:
- A: unit-test `deleteResult` against a mocked Supabase client (the existing service-test pattern), and assert the current component handler never calls the service. A table of tab states is fed through today's totals logic, expecting two spend totals.
- B: feed initiatives with expenses into a fixture copy of today's ROI computation and observe `spend = 0` / ROI `null`.
- C: probes C1–C5 above **are** the exploratory phase. No code changes until C4/C5 confirm a hypothesis.

**Test Cases**:
1. **Results delete persists**: a deleted id is still returned by `getResultsByInitiative` (fails on unfixed code).
2. **RLS zero-row delete**: Supabase returns `{ data: [], error: null }` and the UI still removes the row (fails on unfixed code).
3. **ROI ignores expenses**: an initiative with expenses $2,000, hand field 0 and revenue $5,000 → spend 0, ROI N/A (fails on unfixed code).
4. **ROI ≠ Expenses report**: totals differ for the same expense set (fails on unfixed code).
5. **Stale Change plan** (C3 replay): `hasStripeSubscription = true` with `stripe_status = 'canceled'` (expected to reproduce; to be confirmed).

**Expected Counterexamples**:
- Deleted results reappear; totals include them.
- ROI spend comes from the hand field and not from expenses.
- A Change plan action is offered for a non-live Stripe subscription.

### Fix Checking

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition_A(input) DO
  s := resultsTab_fixed(input)
  ASSERT s.cards = {Total Revenue, Total Expenses}
     AND noSpendInput(s)
     AND s.totalRevenue = Σ row.revenue AND s.totalExpenses = Σ expense.amount
     AND (deleted(row) IMPLIES NOT inDatabase(row))
     AND allMoneyHasSeparators(s)
     AND (legacySpend > 0 IMPLIES legacyLineShown(s))          // D1
END FOR

FOR ALL i WHERE isBugCondition_B(i) DO
  r := buildRoiReport_fixed(...)
  ASSERT r.row(i).spend = Σ expenses(i)
     AND r.row(i).net = revenue(i) − spend
     AND r.row(i).roi = (spend > 0 ? (revenue − spend)/spend × 100 : null)
     AND r.totalSpend = Σ r.rows.spend
     AND r.totalSpend + r.unattributedSpend = expensesReportTotal
END FOR

FOR ALL company WHERE isBugCondition_C(company) DO
  path := purchasePath_fixed(row(company))        // or the fix chosen after probes
  ASSERT path = 'checkout' AND checkoutReturnsUrl(company)
     AND NOT anyPlanMarkedCurrent(company)
END FOR
```

### Preservation Checking

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition_X(input) DO
  ASSERT F_X_original(input) = F_X_fixed(input)
END FOR
```

**Testing Approach**: property-style tests with seeded generators in plain vitest, since no `fast-check` dependency is added. Each helper test generates a few hundred random inputs from a fixed seed (amounts with and without cents, empty lists, negative and `NaN` guards, plus every subscription status × comp × pause × admin combination for C). It compares the fixed helper with a verbatim copy of the original inline logic kept in the test file as the oracle.

**Test Plan**: observe behavior on unfixed code first, then lock it in.

**Test Cases**:
1. **Revenue preservation (A, B)**: Σ revenue from `summariseResultsTab` and `buildRoiReport` equals the original reduce for all generated result sets.
2. **ROI zero-spend and ordering (B)**: for generated inputs with zero spend, ROI is `null` and the row is excluded from the ranking. The sort order equals the original comparator.
3. **Entitlement unchanged (C)**: `evaluateAccess` is not modified. Its existing `entitlement.test.ts` must pass untouched. For every generated state with a live Stripe sub, `purchasePath` returns `'change_plan'` (3.13, 3.14). For comped or paused states it returns `'none'`.
4. **Edit keeps legacy spend (A)**: `handleUpdateResult`'s payload never contains `actualSpend`.

### Unit Tests

- `results-tab-totals.test.ts`: cents-safe sums, `hasLegacySpend`, `pickMoneyFormatter` precision choice.
- `result.service` delete: success, Supabase error, zero-row RLS refusal.
- `initiative-spend.test.ts`: `sumExpensesByInitiative`, `buildRoiReport` (ROI formula, N/A, sort, `unattributedSpend`).
- `purchase-path.test.ts` (C, if H1/H3 is confirmed): every status × comp × pause × mode combination.
- Existing `plan-totals.test.ts`, `entitlement.test.ts`, `lockout.test.ts`, `plan-change.test.ts` pass unchanged.

### Property-Based Tests

- Generated result/expense sets: total = Σ rows for any mix of whole and fractional amounts (A).
- Generated initiative/expense/revenue sets: ROI identities and Total Spend = Σ rows = Expenses-report total − unattributed (B).
- Generated subscription rows: `purchasePath` never returns `'change_plan'` without a live status, and always does with one (C).

### Integration Tests

- A, manual on localhost against a dummy test account (the database is shared, so only the owner's test data is used): add a result → no Spend field; delete → reload → gone; totals match rows; separators shown; a team-member delete shows the permission error.
- B, manual: add expenses to one initiative → ROI row, Revenue-tab budget bar, initiative card, Year at a Glance card and CSV all show the same figure, and Total Spend equals Reports > Expenses.
- C: repeat C4 (admin-owner subject) and C5 (non-admin subject) after the fix. Checkout reaches the Stripe-hosted page from the screen each owner lands on. Then re-run C1 to confirm the row is unchanged by the fix itself, since only the webhook writes paid state.
