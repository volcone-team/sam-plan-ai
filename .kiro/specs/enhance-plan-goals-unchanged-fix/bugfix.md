# Bugfix Requirements Document

## Introduction

A customer's revenue goals (baseline and stretch) are meant to be fixed for the year once the plan is built. They are the target the customer is shooting for. Adding or enhancing initiatives should let the planned total rise above the goal, because customers need more initiatives than strictly required to hit it.

Today, Enhance Plan → Get Recommendations can produce "Target Change" suggestions that propose new baseline and stretch values. Accepting one, or using Accept All, overwrites the goals on the company's newest annual plan and on the company record. The client reported her goals dropping from $175,000 / $227,500 after Accept All, and a test account ("Pete's") dropping from roughly $5–6.5 million to a few hundred thousand.

This fix stops Enhance Plan from ever changing the baseline or stretch goal, including through Target Change suggestions that were generated before the fix and are still pending.

Data repair is handled separately. Companies whose goals were already lowered can be identified read-only from accepted Target Change suggestions, which store the goal values that were in place before the change. Restoring those values is a separate step that needs the owner's approval. It is not part of this fix.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user clicks Get Recommendations on Enhance Plan THEN the system asks the AI for Target Change suggestions and stores any it returns as pending suggestions that propose new baseline and/or stretch goals

1.2 WHEN a user accepts a single Target Change suggestion THEN the system overwrites `baseline_revenue` and/or `stretch_revenue` on the company's newest annual plan and on the company record with the proposed values

1.3 WHEN a user clicks Accept All on a batch that contains a Target Change suggestion THEN the system overwrites the baseline and/or stretch goals along with applying the other suggestions

1.4 WHEN a user accepts a Target Change suggestion while viewing a plan year that is not the newest THEN the system changes the goals of the newest annual plan instead of the year being viewed

1.5 WHEN a Target Change suggestion generated before the fix is still pending and the user accepts it (individually or via Accept All) THEN the system applies it and changes the goals

1.6 WHEN the AI proposes lower goals to fit the current initiatives THEN the system lowers the goals so they match the plan, instead of letting the plan exceed the goal

### Expected Behavior (Correct)

2.1 WHEN a user clicks Get Recommendations on Enhance Plan THEN the system SHALL NOT ask for, store or display any suggestion that proposes a change to the baseline or stretch goal, and SHALL discard any such suggestion the AI returns anyway

2.2 WHEN a user accepts a single suggestion of any kind on Enhance Plan THEN the system SHALL leave `baseline_revenue` and `stretch_revenue` unchanged on every annual plan and on the company record

2.3 WHEN a user clicks Accept All on any batch THEN the system SHALL leave `baseline_revenue` and `stretch_revenue` unchanged on every annual plan and on the company record, and SHALL still apply the other suggestions in the batch

2.4 WHEN a user accepts a suggestion while viewing any plan year THEN the system SHALL leave the goals of every plan year unchanged

2.5 WHEN a Target Change suggestion stored before the fix is still pending THEN the system SHALL NOT show it as acceptable, SHALL NOT apply it if an accept request for it arrives (individually or as part of Accept All), and SHALL NOT let it block the other suggestions in the same batch from being applied

2.6 WHEN accepted suggestions add initiatives or raise forecast revenue so the planned total exceeds the baseline or stretch goal THEN the system SHALL keep the goals unchanged and SHALL NOT cap, rescale or otherwise adjust the goals to match the plan

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user accepts a New Initiative suggestion THEN the system SHALL CONTINUE TO create the initiative as it does today

3.2 WHEN a user accepts a Budget Change suggestion THEN the system SHALL CONTINUE TO update that initiative's planned budget as it does today

3.3 WHEN a user accepts a Date Change suggestion THEN the system SHALL CONTINUE TO update that initiative's activation date as it does today

3.4 WHEN a user accepts a Product Update suggestion THEN the system SHALL CONTINUE TO update that product's price as it does today

3.5 WHEN a user rejects any suggestion, including a stored Target Change suggestion THEN the system SHALL CONTINUE TO mark it rejected without changing plan data

3.6 WHEN a user builds a plan through the intake THEN the system SHALL CONTINUE TO set the baseline and stretch goals from the intake answers

3.7 WHEN a user resets a plan THEN the system SHALL CONTINUE TO set the goals to zero as it does today

3.8 WHEN a user restores a plan from Plan History THEN the system SHALL CONTINUE TO restore the goals stored in the snapshot

3.9 WHEN Get Recommendations runs THEN the system SHALL CONTINUE TO include the current baseline and stretch goals as context for the AI, so its other suggestions can aim at or above the goal

3.10 WHEN Target Change suggestions were accepted in the past THEN the system SHALL CONTINUE TO keep those suggestion records, including their stored "current" goal values, so affected companies can be identified later for an owner-approved repair
