# Bugfix Requirements Document

## Introduction

Three defects reported together. Bugs A and B share a root: spending is recorded in three different places, and each screen reads a different one.

- **Results "Spend"**: typed per weekly result on the Initiative > Results tab and in the weekly planner.
- **Expenses**: itemised entries added under Expenses on the same Results tab. The Reports > Expenses tab reads these.
- **Initiative "Actual spend"**: a single number typed by hand on the Initiative > Overview edit form. Reports > ROI reads only this one.

**Bug A: Initiative > Results tab.** The tab shows "Total Spend (Results)" and "Total Expenses" side by side. To the user these are the same thing. The user wants Spend removed and Expenses kept as the only place spending is recorded. Totals must also agree with their line items, and amounts must show thousands separators (e.g. 12,500). One tally defect is confirmed in code: deleting a result removes it from the screen without deleting it from the database, so it comes back on reload and the totals stop matching.

**Bug B: Reports > ROI tab.** The spend figure on the ROI tab (cards, per-initiative table, by-type table, CSV) is the hand-typed initiative "Actual spend". It ignores recorded expenses and results spend. So ROI disagrees with the Expenses report and with the Results tab. It shows $0 spend and "N/A" ROI for any initiative whose spending was only entered as expenses.

**Bug C: Billing after admin grant then revoke.** An admin grants complimentary access on /admin/companies and later revokes it. After that, the customer cannot buy or upgrade a plan. The root cause is **not yet confirmed**. Each hypothesis below must be checked against real data with a read-only probe before any fix:
- **H1 (stale state).** Revoke clears only the comp fields. It leaves the plan the comp assigned, plus the earlier status, trial and Stripe columns. Some purchase path may read these as "already has a plan".
- **H2 (Stripe disagrees).** The stored Stripe customer has a live subscription in Stripe. Checkout then refuses with "You already have a subscription — use Change plan instead". But Change plan has no subscription recorded locally to change.
- **H3 (screens disagree).** The middleware gate, the /choose-plan page and the Settings billing panel reach different conclusions about the account. The customer bounces between screens or lands on one with no working purchase button. For example, change-plan is not on the lockout allow-list.
- **H4 (other).** Something not listed, found during step-by-step debugging.

The fix order is A, then B, then C. Each is a separate task and needs the user's approval before the next one starts.

## Bug Analysis

### Current Behavior (Defect)

**Bug A: Initiative > Results tab**

1.1 WHEN a user opens an initiative's Results tab THEN the system shows both a "Total Spend (Results)" card and a "Total Expenses" card, two separate spend totals for the same initiative.

1.2 WHEN a user adds or edits a weekly result on the Results tab THEN the system asks for a "Spend" amount alongside Revenue. This creates a second place to record spending, separate from Expenses.

1.3 WHEN a user deletes a weekly result on the Results tab THEN the system removes it from the screen only. The result is never deleted from the database, so after a reload it reappears and Total Revenue includes it again.

1.4 WHEN the Results tab shows amounts THEN the system formats them inconsistently. Some show as currency with separators. Others are raw numbers in inputs or metric chips (e.g. 12500 instead of 12,500).

1.5 WHEN existing results rows already hold a non-zero spend amount THEN the system has no defined treatment for that value once Spend is no longer shown. If it is simply hidden, the spending silently disappears from the user's view.

**Bug B: Reports > ROI tab**

1.6 WHEN the ROI tab computes spend for an initiative THEN the system uses only the hand-entered initiative "Actual spend" field. It ignores that initiative's recorded expenses.

1.7 WHEN an initiative's spending was recorded only as expenses THEN the system shows $0 spend, a net equal to revenue, and "N/A" ROI on the ROI tab. Meanwhile the Expenses report shows that same spending.

1.8 WHEN the ROI tab, the Expenses report, the Results tab and the Overview budget bar show "spend" for the same initiative THEN the system can show up to three different figures. Each comes from a different source.

**Bug C: Billing after grant then revoke**

1.9 WHEN an admin grants complimentary access to a company and later revokes it THEN the customer cannot complete a purchase or upgrade of a plan. (The exact failure the customer sees is to be captured during debugging.)

1.10 WHEN access is revoked THEN the system clears only the comp fields. It leaves the subscription row with the plan the comp assigned and the earlier status, trial and Stripe fields. *(Confirmed in code. Whether this causes 1.9 is hypothesis H1, to be verified.)*

1.11 WHEN a revoked customer tries to buy a plan THEN the system may refuse with "You already have a subscription — use Change plan instead". Or it may offer Change plan when there is no local subscription to change, or send the customer between screens with no working purchase action. *(Hypotheses H2 and H3, to be verified.)*

**Site-wide number formatting (added with D1, part of Unit A)**

1.12 WHEN any screen in the app (not only the Results tab) shows a monetary amount or a count THEN the system can show it without thousands separators (e.g. `$12500`, `12500.00`, raw `<input type="number">` values), because screens format numbers ad hoc instead of through the shared formatters.

### Expected Behavior (Correct)

**Bug A: Initiative > Results tab**

2.1 WHEN a user opens an initiative's Results tab THEN the system SHALL show one spend total, Total Expenses, plus Total Revenue. It SHALL NOT show a separate "Spend" total.

2.2 WHEN a user adds or edits a weekly result on the Results tab THEN the system SHALL ask for Revenue, metrics and notes only, with no Spend field. Spending SHALL be recorded only through Expenses.

2.3 WHEN a user deletes a weekly result THEN the system SHALL delete it from the database. After a reload it SHALL NOT reappear, and Total Revenue SHALL no longer include it.

2.4 WHEN the Results tab shows totals THEN the system SHALL make each total exactly equal the sum of the line items listed beneath it: Total Revenue = sum of the results' revenue, Total Expenses = sum of the expense amounts.

2.5 WHEN the Results tab shows any monetary amount THEN the system SHALL format it with thousands separators (e.g. $12,500) consistently in cards, rows and read-only displays.

2.6 WHEN existing results rows hold a non-zero spend amount THEN the system SHALL NOT silently lose that spending. How it is handled (e.g. moved into Expenses, or kept and shown as legacy) SHALL be decided with the user before Bug A is closed. Any data change SHALL be a migration the owner applies by hand, never an automatic write to the shared database.

**Bug B: Reports > ROI tab**

2.7 WHEN the ROI tab computes spend for an initiative THEN the system SHALL use that initiative's recorded expenses as the source of actual spend. This is the same source as the Expenses report and the Results tab.

2.8 WHEN an initiative's spending was recorded as expenses THEN the system SHALL show that amount as its spend on the ROI tab. Net SHALL be revenue minus that spend, and ROI SHALL be (revenue − spend) / spend × 100.

2.9 WHEN the ROI tab shows totals THEN the system SHALL make Total Spend equal the sum of the per-initiative spend figures. It SHALL equal the Expenses report total for the same set of initiatives. Any difference in scope, such as company-level expenses not tied to an initiative, SHALL be stated on screen.

2.10 WHEN the hand-entered initiative "Actual spend" field remains in use elsewhere (Overview, plan totals) THEN the system SHALL either derive it from expenses or clearly label it, so no screen presents a different "actual spend" without saying why. The choice SHALL be agreed with the user.

**Bug C: Billing after grant then revoke**

2.11 WHEN the root cause of 1.9 is investigated THEN it SHALL be confirmed by read-only probes against real subscription and Stripe state, one step at a time, before code is changed. Each probe SHALL be deleted afterwards.

2.12 WHEN an admin revokes complimentary access from a company that has no live paid Stripe subscription THEN the customer SHALL be able to start a new plan purchase through Checkout from /choose-plan or the Settings billing panel, and complete it.

2.13 WHEN a revoked customer views plans THEN the system SHALL NOT mark the previously comped plan as their current plan. It SHALL NOT offer Change plan unless a live Stripe subscription exists.

2.14 WHEN a revoked customer's stored Stripe customer actually has a live subscription in Stripe THEN the system SHALL resolve or explain that state, for example by reconciling it, rather than refusing Checkout and also refusing Change plan.

**Site-wide number formatting**

2.15 WHEN any screen in the app shows a monetary amount or a count THEN the system SHALL format it with thousands separators (e.g. $12,500, 1,250) through the shared formatters in `src/lib/format-money.ts` (`formatMoney`, `formatMoneyPrecise`, `formatMoneyFromMinor`, `formatAxisMoney`, `formatNumber`), and money inputs SHALL use `NumberInputRaw` so typed values show separators.

### Unchanged Behavior (Regression Prevention)

**Bug A: Initiative > Results tab**

3.1 WHEN a user adds, edits or views a weekly result THEN the system SHALL CONTINUE TO record and display revenue, week dates, metrics and notes.

3.2 WHEN a user adds or deletes an expense on the Results tab THEN the system SHALL CONTINUE TO save it with its category, description, amount and date, and show it in the Expenses list and the Expenses report.

3.3 WHEN results revenue feeds other screens (Initiatives list actuals, Year at a Glance, weekly planner, top-performer ranking, chat account context) THEN the system SHALL CONTINUE TO show the same revenue figures.

3.4 WHEN the weekly planner records a company-level result (no initiative) THEN the system SHALL CONTINUE TO save it with no initiative attached, as recently changed.

**Bug B: Reports > ROI tab**

3.5 WHEN the ROI tab computes revenue for an initiative THEN the system SHALL CONTINUE TO use the sum of that initiative's results revenue.

3.6 WHEN an initiative has zero spend THEN the system SHALL CONTINUE TO show ROI as "N/A" instead of dividing by zero, and to leave it out of the ROI ranking.

3.7 WHEN the user exports the ROI CSV, or views the ranking and by-type tables THEN the system SHALL CONTINUE TO offer the same columns and sorting, with spend from the corrected source.

3.8 WHEN the Revenue, Products and Expenses report tabs are viewed THEN the system SHALL CONTINUE TO show the figures they show today.

3.9 WHEN an initiative has a planned budget THEN the system SHALL CONTINUE TO show and store it as the plan figure, separate from actual spend.

**Bug C: Billing**

3.10 WHEN an admin grants complimentary access THEN the system SHALL CONTINUE TO give the company access on the chosen plan, with that plan's limits, until the comp is revoked or its end date passes.

3.11 WHEN an admin revokes complimentary access from a company with no other entitlement THEN the system SHALL CONTINUE TO remove access, so the customer is sent to the purchase screen.

3.12 WHEN an admin tries to grant complimentary access to a company with a live paid subscription THEN the system SHALL CONTINUE TO refuse.

3.13 WHEN a paying customer with a live Stripe subscription upgrades, downgrades or changes billing cycle THEN the system SHALL CONTINUE TO use Change plan: upgrades immediate and prorated, downgrades at period end.

3.14 WHEN a customer with a live Stripe subscription tries to start a second Checkout THEN the system SHALL CONTINUE TO refuse it, so they are never billed twice.

3.15 WHEN subscription state changes THEN the system SHALL CONTINUE TO treat the Stripe webhook as the only writer of paid subscription state. Checkout itself SHALL CONTINUE TO grant nothing.

3.16 WHEN access is decided anywhere (middleware, APIs, /choose-plan, admin table) THEN the system SHALL CONTINUE TO use the single shared access decision. Its precedence stays: billing off > paused > comp > trial > active > grace.

3.17 WHEN a company is paused, or a super admin signs in THEN the system SHALL CONTINUE TO send paused accounts to /account-paused, and never lock out super admins.

**Site-wide number formatting**

3.18 WHEN numbers are formatted for display THEN the system SHALL CONTINUE TO store the same values, send the same raw numeric values to the API from inputs, write CSV exports as machine-readable raw numbers (no separators), and show percentages as they are shown today.
