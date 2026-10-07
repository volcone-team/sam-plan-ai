# Intake v2 — Requirements

Source of truth: **SAM Plan Intake Spec v2** (Oct 2, 2026). Where this document
and that spec disagree, the spec wins. Where the spec and the Figma mockups
disagree, the spec wins (its own instruction).

Replaces the current intake **in full**. There is no Quickstart any more — every
user takes this flow. Existing accounts are all test data, so no answer
migration is required.

## Deadline

Tracking must be live before the **October 15 webinar** so the first 100 users
produce data. That makes the analytics layer (section 14) a shipping
requirement, not a follow-up.

## Decisions already made (do not re-litigate)

- No stage thresholds. The user picks their own stage; revenue bands differ too
  much by industry for dollar cut-offs to be meaningful.
- Industry list is the 13 industries from the Initiative Library, plus Other.
- No Quickstart. Every user takes the full intake.
- Screens 5 and 6 use the **full** Initiative Library, not a shortlist.
- Tracking tool is the dev team's choice.

## Decisions resolved (Oct 3)

**D1 — Funnel fields: one generic funnel for every initiative.**
The spec points at "the initiative type's input list in the library", but
`wb_initiative_library` has no such column, so the spec's own generic fallback
becomes the shape for all 22 initiatives: audience reached → % who signed up →
% who showed up or booked → % who bought → average price. No workbook authoring
pass, and one tested funnel path instead of per-category variants. Stage labels
still vary per initiative in the mockups (a webinar "showed up", a podcast
"booked a call"), so the LABELS are presentational while the arithmetic is
shared — which is exactly what `intake_initiatives.funnel_stages` already
stores as an ordered `{key,label,percent}` array.

**D2 — Review screen: removed.** The recommendations screen replaces it and is
the single commit point, matching the mockup. Two confirmations back to back
was one too many, and the recommendations screen already shows more than the
old review page did.

**D3 — Swap: auto-replace.** Swapping substitutes the next-best eligible
initiative from the library, honouring every rule in REQ-13.8 to REQ-13.12. No
picker. The user can swap repeatedly to walk through alternatives, and dismiss
if nothing fits.

**D4 — Plan-limit collision: warn and ask the user to choose.** If accepted
initiatives exceed the plan's `max_initiatives`, the recommendations screen
warns and asks the user to deselect down to their limit. "Build my plan" stays
disabled until they are within it. Not in the client spec; added because
billing enforces the cap server-side regardless, so letting them past here
would only fail later with a worse message.

**D5 — Analytics: internal event table.** No third-party tool. A single
`intake_events` table written through an API route, following the existing
`generation_events` pattern. No new secret to manage, no vendor dependency, and
the admin report in REQ-14.4 can query it directly.

## 1. Flow and branching

Screen 0 decides two things: whether screen 5 appears, and which variant of the
output screen the user sees. Everything else is shared.

| Path | Screen 0 answer | Screens | Screen 5 | Final button |
|---|---|---|---|---|
| A | Yes, I know most of them | 10 | shown | Check my plan |
| B | I have a few. Suggest the rest. | 10 | shown | Fill in my plan |
| C | No. Recommend them for me. | 9 | **skipped** | Recommend my initiatives |

**REQ-1.1** Path C skips screen 5 entirely. This is structural, not a copy
change: the path has 9 screens where A and B have 10.

**REQ-1.2** The progress bar counts only the screens on the user's path, so
Path C reads "Step n of 9" and Paths A and B read "Step n of 10".

**REQ-1.3** Screen 0 additionally controls: screen 6's filtering (REQ-7.2),
the final button label (table above), and the output screen variant (section 12).

**REQ-1.4** Screen 7's `customer_industry` field appears only when
`customer_type` includes Businesses.

**REQ-1.5** Last-results fields appear only when `run_before` is Yes (screen 5)
or when a chip is selected (screen 6).

## 2. Global rules

**REQ-2.1 Numbers.** Whole numbers, commas inserted as the user types
(`$750,000` — never `750K`, never `750.000`). US dollars throughout. Percent
fields accept 0–100.

**REQ-2.2 Dates.** MM/DD/YYYY everywhere, including admin. The existing
`DateInput` component already enforces this regardless of OS locale.

**REQ-2.3 Voice input.** The speech-to-text mic appears on **every** long-text
field. Fields affected: `business_description`, `ideal_customer`,
`problem_solved`, `worked_notes`, `obstacle_notes`.

**REQ-2.4 Save and resume.** Answers save after every screen. A returning user
resumes at the screen they left with answers intact. Back never clears answers.

**REQ-2.5 Required fields.** Only fields marked required may block progress.
Every other field can be skipped.

**REQ-2.6 "Not sure" is null, never 0.** A null means "use benchmarks"; a 0
means "this number really is zero". Conflating them makes the generator plan
against a business with no audience.

**REQ-2.7 Editing later.** Every answer is editable in Settings → Business
profile after the plan is built. A change prompts "Update my plan?".

**REQ-2.8 Structured storage.** Every answer is its own field on the business
profile — not a JSON blob — so the chatbot can read it. The chat account-context
module already reads structured columns this way.

**REQ-2.9 Helper line.** Every screen EXCEPT 0, 5 and 9 shows
"Rough numbers are fine. You can change any of this later." with a lightbulb
icon, directly under the subtitle.

## 3. Screen 0 — Your starting point (all paths)

Title: **Let's build your plan**

Subtitle: "Some people already know what sales and marketing initiatives
they're running this year. We recommend having at least 3-5 initiatives. Others
want us to recommend their plan. Either or a mix of both work."

No helper line on this screen (REQ-2.9).

**REQ-3.1** `plan_path` — "Do you already have sales and marketing initiatives
planned?" Single select, 3 cards, **required**.

| Card | Label | Sub-label |
|---|---|---|
| A | Yes, I know most of them | I'll enter them and you'll check the math. |
| B | I have a few. Suggest the rest. | I'll add what I know and you fill the gaps. |
| C | No. Recommend them for me. | Tell us about your business and we'll build a starting plan. |

**REQ-3.2** The word "initiative" carries a tooltip: "A specific sales or
marketing push, like a webinar, a launch, a challenge, or speaking on stages."

## 4. Screen 1 — Your business (all paths)

Title: **Your business**
Subtitle: "This tells us which strategies will get you the best results."

**REQ-4.1** `business_industry` — "What industry is your business in?"
Dropdown, **required**. "Other" reveals a short text field.

The list is fixed and must match the Initiative Library's "Ideal Industries"
column **exactly**, or the generator cannot filter on it:

Coaching & Consulting · Course Creators · Speakers & Authors ·
Health & Wellness · Financial Services · Real Estate & Investing ·
Network Marketing · B2B Services & Agencies · B2B SaaS & Tech · E-commerce ·
Local & Home Services · Faith-Based & Ministry · Nonprofit & Association · Other

**REQ-4.2** Initiatives tagged "Broad fit" remain eligible for every industry,
including Other.

**REQ-4.3** `business_description` — "In a sentence or two, what does your
business do?" Long text with mic, optional. Placeholder: "We help real estate
agents get more listings through coaching and done-for-you marketing."

**REQ-4.4** `sales_model` — "How do your customers mostly buy from you?"
Single select: Online, without talking to anyone / On a sales call or in a
conversation / In person, at a location or event / A mix.

**REQ-4.5** `revenue_last_12` — "What was your revenue over the last 12
months?" Currency, **required**. Feeds the suggested goal on screen 4.

**REQ-4.6** `business_stage` — "Which best describes where you are?" Single
select, 3 cards, **required**. Nothing pre-selected, and no dollar thresholds
shown.

| Stage | Description |
|---|---|
| Start | Launching or early. Getting first clients, proof, and testimonials. |
| Momentum | Selling consistently and ready for more traction. |
| Scale | Established, with a team, and ready to run several initiatives at once. |

Stage sets how many initiatives the generator recommends (REQ-12.4).

## 5. Screen 2 — Team and capacity (all paths)

Title: **Your team and time**
Subtitle: "We'll only recommend what you can actually run."

**REQ-5.1** `team_size` — "How many people work in the business, including
you?" Integer, **required**, minimum 1.

**REQ-5.2** `who_closes` — "Who handles sales conversations?" Single select:
I do / A salesperson or sales team / We don't do sales calls / Mix. Matches the
library's sales-team requirement and gates recommendations (REQ-12.5).

**REQ-5.3** `plan_owner` — "Who will run this plan day to day?" Single select:
Me / Someone on my team / Both of us. Stored for v1.5 team invites; not used yet.

**REQ-5.4** `hours_per_week` — "How many hours a week can you or your team put
into sales and marketing?" Integer. Helper: "Growing businesses usually spend
about half their time here."

**REQ-5.5** `monthly_budget` — "What's your monthly marketing budget?"
Currency, **required**. $0 is allowed. Helper: "Ads, tools, and contractors.
Not salaries."

## 6. Screen 3 — Products (all paths)

Title: **What you sell**
Subtitle: "List what you'll focus on selling in this plan. Every initiative
will be tied to a product."

### Period selectors, above the product cards

**REQ-6.1** `planning_period` — "How far ahead are we planning?" Single select
3 / 6 / 12 / 18 months, default 12. **Not 24** — the spec lists four options.

**REQ-6.2** `start_month` — "When does this plan start?" Month picker, default
next month. The past is not selectable.

### Product cards

One card shows by default. "+ Add another product" adds more.

**REQ-6.3** `product_name` — "Product or service name". Text, **required**.

**REQ-6.4** `product_type` — "Type". Dropdown: Coaching or service / Course or
digital product / Event / Membership or subscription / Physical product / Other.

**REQ-6.5** `price_tier` — "Price level". Single select: Low ticket / Mid
ticket / High ticket / One-on-one. Tooltip gives example ranges.

**REQ-6.6** `pricing_model` — "How is it paid?" Single select: One-time /
Recurring (reveals "per month" or "per year") / Payment plan.

**REQ-6.7** `delivery` — "How is it delivered?" Single select: Online / In
person / Shipped / Hybrid. Drives initiative matching: In person surfaces Local
Presence and in-person event initiatives; Shipped surfaces e-commerce
initiatives and shipping lead times; Online and Hybrid events use the virtual
and hybrid ticket strategies.

**REQ-6.8** `avg_price` — "What do customers actually pay on average?"
Currency, **required**. Helper: "The real average after discounts, not the list
price."

**REQ-6.9** `units_goal` — "How many do you want to sell in this plan period?"
Integer, **required**. The label reads "in the next [planning period]", taking
the period from REQ-6.1 — so a 6-month plan says "in the next 6 months".
Recurring products instead ask "How many active subscribers by the end?"

**REQ-6.10** `product_goal` — calculated, read-only: `avg_price × units_goal`,
shown on the card.

**REQ-6.11** A running total shows at the bottom of the screen. It is a
**reference only** — it never caps and never sets the revenue goal.

**REQ-6.12** Coaching line under the total: "A strong lineup usually has a low,
mid, and high-ticket offer." Shown only when all products share one tier.

## 7. Screen 4 — Revenue goal (all paths)

Title: **Your revenue goal**
Subtitle: "Set the number you want to plan toward."

**REQ-7.1** `revenue_goal` — "What's your revenue goal for this period?"
Currency, **required**. Not pre-filled, and not limited by the products total.

**REQ-7.2** Two reference figures sit above the field:
- last 12 months, **prorated to the planning period**
- suggested stretch: prorated last-12 × **1.3**

Proration matters: on a 6-month plan, $450,000 of last-12 revenue shows as
$225,000, and the stretch as $292,500. Showing the unprorated annual figure
would invite a goal double what the user means.

**REQ-7.3** When `revenue_goal` exceeds **1.5×** the prorated last-12 figure,
show: "That's a [X]% jump from last year. Most businesses plan about 30%
growth. You can keep your number; your plan will show what it takes to get
there."

**REQ-7.4** The message never blocks and never rewrites the number. A
deliberate stretch target is a legitimate choice.

## 8. Screen 5 — Your planned initiatives (Paths A and B only)

Title: **What you're already planning**

Subtitle, Path A: "Add the initiatives you know you're running. We'll forecast
each one and show whether they reach your goal."
Subtitle, Path B: "Add what you know. We'll suggest the rest."

No helper line on this screen (REQ-2.9).

Repeater card, one per initiative, minimum 1. Button: "+ Add another
initiative."

**REQ-8.1** `initiative_type` — "What is it?" Searchable dropdown,
**required**. The full Initiative Library, grouped by Parent Category
(In-Person Events, Virtual Events, Content & Media, …), plus "Something else"
which reveals a text field and is flagged for review.

**REQ-8.2** Exclude **Maximizers** from the picker — they attach to an
initiative later, not here.

**REQ-8.3** Show **Ticket Map** items only for initiatives selling an Event
product.

**REQ-8.4** Where a name exists as both OPS and OWN (Live Webinar,
Podcast/Vodcast, Challenge), label the two variants "on your own platform" and
"on someone else's platform".

**REQ-8.5** `linked_products` — "What does it sell?" Multi-select from the
screen 3 products, **required**. One initiative may sell more than one product.

**REQ-8.6** `kind` — "How often does it run?" Single select: Once (a launch or
event) / On repeat (reveals frequency: weekly, monthly, quarterly) / Always on
(evergreen).

**REQ-8.7** `start_date` — "When does it start?" (optional). For "Once":
"When is it?" (optional). Month / Exact date toggle. Helper in italics:
"Optional. You can set dates on the calendar later."

**REQ-8.8** Undated initiatives are placed by the generator and confirmed on
the calendar. For "Once", the promo start is calculated from library lead times.

**REQ-8.9** `run_before` — "Have you run this before?" Yes / No. Yes reveals
the results fields.

**REQ-8.10** `last_results` — "What happened last time?" Number and percent
fields, **all optional**. Per D1 every initiative uses one funnel shape:

| Field | Type |
|---|---|
| Audience reached | integer |
| % who signed up | percent 0–100 |
| % who showed up or booked | percent 0–100 |
| % who bought | percent 0–100 |
| Average price | currency |

Helper: "Your best guess helps. We'll use our benchmarks for anything you skip."

**REQ-8.11** Stage LABELS may be tailored per initiative for readability (a
webinar "showed up", a podcast guest spot "booked a call"), but the arithmetic
is identical and the stored shape is the same ordered
`{key, label, percent}` array. Labels are presentation; the funnel is one
tested code path.

**REQ-8.12** A funnel with ANY stage left blank produces **no forecast** for
that initiative — not a forecast of zero. The card then falls back to
benchmarks and says so (REQ-13.6). Already implemented: `forecastPerRun`
returns null rather than 0 for exactly this reason.

## 9. Screen 6 — What's worked and what hasn't (all paths)

Title: **Your wins and your struggles**
Subtitle: "What's driven sales in the last 12 months, and what flopped? This
keeps us from recommending things that don't fit you."

**REQ-9.1** `worked_initiatives` — "What has driven real sales for you?"
Searchable multi-select, the same grouped list as screen 5.

**REQ-9.2** On Paths A and B, **hide initiatives already entered with results
on screen 5** — the user has already given those numbers and must not be asked
twice.

**REQ-9.3** Each selected chip reveals its own optional results fields, same
shape as screen 5. **Every** selected chip gets fields, not one at a time: if a
user picks Podcast/Vodcast Guest and Email Campaign, both expand.

**REQ-9.4** `worked_notes` — "What worked best, and why?" Long text with mic,
optional.

**REQ-9.5** `didnt_work` — "What have you tried that didn't work?" Searchable
multi-select, same grouped list.

**REQ-9.6** Each `didnt_work` chip reveals an optional one-line "Why?" field.
This tells the generator what **not** to recommend (REQ-12.5).

## 10. Screen 7 — Your ideal customer (all paths)

Title: **Who you sell to**
Subtitle: "Tell us who you serve and the problem you solve for them."

**REQ-10.1** `customer_type` — "Do you sell to businesses, consumers, or
both?" Single select: Businesses / Consumers / Both. Replaces the old free-text
"Business Type" field.

**REQ-10.2** `customer_industry` — "What industries are your customers in?"
Multi-select dropdown. Shown **only** when `customer_type` includes Businesses.
Same list as screen 1, plus "Any industry".

**REQ-10.3** `ideal_customer` — "Who do you serve?" Long text with mic,
**required**. Placeholder: "Coaches and consultants doing $300,000 to $3
million who want more clients without more ad spend."

**REQ-10.4** `problem_solved` — "What problem do you solve for them?" Long text
with mic, **required**.

## 11. Screen 8 — Your audience today (all paths)

Title: **What you already have**
Subtitle: "Your existing audience sets how fast each initiative can pay off."

**REQ-11.1** Five integer fields, each with its own "Not sure" checkbox that
stores **null** (REQ-2.6):

| Field | Label | Helper |
|---|---|---|
| `email_list` | Email list size | — |
| `social_following` | Social following (all platforms combined) | — |
| `website_visitors` | Website visitors per month | — |
| `past_customers` | Past and current customers | italic, under the label: "People who have bought from you before." |
| `monthly_leads` | New leads per month | — |

**REQ-11.2** `other_audiences` — "Do you want to leverage other people's
audiences?" Multi-select: Partners who promote me / Speaking stages / Podcast
guest spots / Affiliates / None yet. Feeds OPS initiative recommendations.

## 12. Screen 9 — What's in the way (all paths)

Title: **What's held you back?**
Subtitle: "Pick your biggest challenges. We'll plan around them."

No helper line on this screen (REQ-2.9).

**REQ-12.1** `obstacles` — "Select your biggest challenges." Multi-select
chips, **max 3**. Helper in italics directly under the question: "Pick up to 3."

Options: Need more leads / Low conversion rate / Weak sales process / No
audience yet / Limited budget / Limited time / Team capacity / Unclear
marketing strategy / Product positioning / Other.

**REQ-12.2** `obstacle_notes` — "Tell us more about your biggest challenge."
Long text with mic, optional.

**REQ-12.3** The primary button is path-dependent: Path A "Check my plan",
Path B "Fill in my plan", Path C "Recommend my initiatives".

## 13. Output — the recommendations screen

A new screen between the intake and the plan view. It shows the forecast
against the goal, then lets the user accept or dismiss each initiative before
the plan is built.

**REQ-13.1 Nothing reaches the calendar until "Build my plan" is clicked.**
This is the single commit point.

**REQ-13.2 Gap bar**, every path, at the top: the revenue goal, the user's own
initiatives, and recommendations, with "Gap to goal: $[X]" at top right. Helper
in italics beneath: "Revenue your plan still needs to reach your goal. It
updates as you accept or dismiss recommendations."

**REQ-13.3** The gap recalculates **live** on every accept and dismiss. Already
implemented and tested in `lib/intake-forecast.ts` (`goalGap`), which returns
the two bar segments separately for exactly this reason.

**REQ-13.4** Each initiative card shows: name, the product(s) it sells, start
month, forecast revenue, an effort indicator, and one line on why it fits.

**REQ-13.5** Three variants, selected by `plan_path`:

| Path | Headline | Shows | Actions |
|---|---|---|---|
| A | Here's what your plan adds up to | The user's initiatives with forecasts. If there is a gap, up to 3 additions labelled "Suggested". | Edit any forecast input. Add or dismiss suggestions. |
| B | Your initiatives, plus what we'd add | The user's initiatives, then additions labelled "Recommended", sized to stage capacity. | Accept or dismiss each. Swap one for an alternative. |
| C | Here's where we'd start | A shortlist sized to stage. Every product has at least one initiative. | Accept, dismiss, or swap each. |

**REQ-13.6** Benchmark-derived forecasts must say so on the card: "Based on
industry averages. Add your real numbers to sharpen this." A forecast built
from the user's own figures must not carry this line.

**REQ-13.7 Dismissed recommendations** are held locally and can be restored
while the user is on this screen. Once "Build my plan" is clicked they are
gone.

**REQ-13.14 Swap auto-replaces** (D3). The card is substituted with the
next-best eligible initiative from the library, honouring REQ-13.8 to
REQ-13.12. Repeated swaps walk further down the eligible list. When nothing
eligible remains, the swap control disables rather than silently doing nothing.

**REQ-13.15 Plan-limit warning** (D4). When accepted initiatives exceed the
plan's `max_initiatives`, show a warning naming the limit and asking the user
to deselect down to it. "Build my plan" stays disabled until they are within
the limit. Billing enforces this cap server-side anyway, so passing it here
would only fail later with a worse message.

**REQ-13.16** The old review screen is removed (D2). This screen is the only
confirmation step.

### Generator rules — all six are mandatory

**REQ-13.8** No initiative that appears in `didnt_work`.

**REQ-13.9** Nothing above the user's `monthly_budget` or `hours_per_week`.

**REQ-13.10** No sales-call initiatives when `who_closes` is "We don't do sales
calls".

**REQ-13.11** At least two initiatives behind any product carrying more than
half the goal.

**REQ-13.12** Industry eligibility from the library, honouring "Broad fit"
(REQ-4.2).

**REQ-13.13** Recommendation count sized to `business_stage`: Start 1–2,
Momentum 2–4, Scale 4 or more.

## 14. Analytics — required before October 15

**REQ-14.1** Eleven events, with the properties listed:

| Event | Fires when | Properties |
|---|---|---|
| `intake_path_selected` | Screen 0 answered | `plan_path` |
| `intake_screen_viewed` | Any screen loads | `screen`, `plan_path` |
| `intake_screen_completed` | Next clicked | `screen`, `plan_path`, `seconds_on_screen` |
| `intake_field_skipped` | Optional field left empty or Not sure | `screen`, `field` |
| `intake_abandoned` | No activity for 30 minutes mid-intake | `last_screen`, `plan_path` |
| `intake_voice_used` | Mic used | `screen`, `field` |
| `recommendation_shown` | Output screen loads | `initiative_type`, `source` (user / suggested / recommended) |
| `recommendation_accepted` | Accept clicked | `initiative_type` |
| `recommendation_dismissed` | Dismiss or swap clicked | `initiative_type`, `action` |
| `plan_built` | Build my plan clicked | `plan_path`, `initiative_count`, `gap_amount` |

**REQ-14.2** Event funnels, not heat maps alone — a heat map cannot show which
screen people quit on.

**REQ-14.3** `onboarding_status` field with a timestamp per state:
`signed_up`, `intake_started`, `intake_complete`, `plan_viewed`,
`first_actuals_entered`.

**REQ-14.4** Admin report: share of users on each path, completion rate per
screen by path, and acceptance rate per recommended initiative.

## 15. Schema gaps in migration 025

Migration 025 is applied but covers roughly 70% of the fields above. A
follow-up migration needs:

- `recurring_interval` — per month vs per year (REQ-6.6)
- `industry_other` — the text revealed by "Other" (REQ-4.1)
- `customer_industry` must allow "Any industry" (REQ-10.2)
- `resume_screen` — the save-and-resume position (REQ-2.4)
- `onboarding_status` + five timestamps (REQ-14.3)
- `initiative_label_other` — the "Something else" text, flagged for review (REQ-8.1)
- `didnt_work` reasons are already covered by `intake_initiatives.failure_reason`

`scripts/verify-intake-schema.mjs` checks the applied columns and will need
extending alongside that migration.

## 16. Explicitly out of scope

From the spec's own "Later, and open decisions":

- Product SKU upload and product categories
- Foundation path for users who don't know what they sell (Q3 2027)
- SWOT and cash-flow check
- Assessment/quiz front door
- Team invites from `plan_owner` (v1.5)
- OPS vs OWN on planned initiatives — schema only; `other_audiences` carries
  the signal for now

## 17. Already built and reusable

- `lib/intake-forecast.ts` — product goals, suggested stretch, implied growth,
  funnel maths, cadence runs, gap-to-goal. 39 tests, pinned to the mockup's own
  figures.
- `lib/format-money.ts` — comma-separated currency (REQ-2.1).
- `components/ui/date-input.tsx` — MM/DD/YYYY regardless of OS locale (REQ-2.2).
- `components/ui/number-input.tsx` — comma-as-you-type numeric input (REQ-2.1).
- `components/ui/dictation-textarea.tsx` + `hooks/use-dictation.ts` — the mic
  (REQ-2.3).
- `supabase/migrations/025_intake_v2.sql` — applied; see section 15 for gaps.
