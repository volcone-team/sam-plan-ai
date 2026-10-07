# Intake v2 — Design

Implements `requirements.md`. Source of truth remains the client's
**SAM Plan Intake Spec v2**.

## Guiding constraints

Three properties shape every decision below.

**The forecast must be verifiable.** These numbers become a customer's revenue
plan and then drive what the AI recommends. A wrong figure still looks like a
plan, so all arithmetic lives in pure, tested functions — never inside a
component. `lib/intake-forecast.ts` is already built this way and pinned to the
mockup's own figures.

**An absent answer is not a zero.** "Not sure" and a skipped funnel stage must
reach the generator as null so it uses benchmarks. A 0 would have it plan
against a business with no audience. This is why `forecastPerRun` returns null
rather than 0, and why every audience field has a paired `_unknown` flag.

**The path is structural.** Path C genuinely has 9 screens, not 10 with one
hidden. Progress, navigation and the output variant all read from one value, so
there is a single source of truth for "where am I and what comes next".

## Architecture

```
src/
  lib/intake/
    schema.ts          Field definitions, options, required-ness, per screen
    flow.ts            Path -> screen sequence, progress, next/prev
    validation.ts      Per-screen validation, pure
    funnel.ts          The one generic funnel shape (D1)
    draft.ts           Save-and-resume: serialise/restore
    events.ts          Analytics event names + payload builders
  lib/intake-forecast.ts   ALREADY BUILT - product goals, stretch, funnel maths, gap
  lib/recommend/
    eligibility.ts     The six generator rules, pure
    sizing.ts          Stage -> recommendation count
    swap.ts            Next-best selection (D3)

  components/intake/
    intake-shell.tsx       Progress, nav, autosave, event firing
    screens/screen-0..9    One component per screen
    fields/                InitiativePicker, FunnelFields, ProductCard,
                           NotSureNumber, PillMultiSelect
    recommendations/       Output screen, gap bar, initiative cards

  app/(app)/intake/[screen]/page.tsx    Routed by screen slug
  app/api/intake/draft/route.ts         Save + resume
  app/api/intake/submit/route.ts        Intake -> planning_inputs + child rows
  app/api/intake/recommend/route.ts     Forecast + AI recommendations
  app/api/intake/build/route.ts         "Build my plan" -> real initiatives
  app/api/intake/events/route.ts        Analytics sink
```

### Why a route per screen rather than one stateful page

Save-and-resume (REQ-2.4) needs a URL to return to. A single page holding an
index in state cannot be linked to, and a browser refresh would lose the
position. One route per screen makes resume a redirect, Back a real browser
Back, and the analytics `screen` property unambiguous.

## Flow model

One declarative sequence per path. Everything else derives from it.

```ts
// lib/intake/flow.ts
export type PlanPath = 'know_most' | 'know_some' | 'recommend_all';

export type ScreenId =
  | 'start' | 'business' | 'team' | 'products' | 'goal'
  | 'initiatives' | 'wins' | 'customer' | 'audience' | 'obstacles';

const SHARED_AFTER_GOAL: ScreenId[] = [
  'wins', 'customer', 'audience', 'obstacles',
];

export function screensFor(path: PlanPath | null): ScreenId[] {
  const head: ScreenId[] = ['start', 'business', 'team', 'products', 'goal'];
  // Path C omits 'initiatives' ENTIRELY - 9 screens, not 10 with one hidden.
  return path === 'recommend_all'
    ? [...head, ...SHARED_AFTER_GOAL]
    : [...head, 'initiatives', ...SHARED_AFTER_GOAL];
}
```

`progressFor(path, screen)` returns `{ step, total }` off the same array, so
Path C can never report "Step 6 of 10" (REQ-1.2).

The final button label is a lookup on path, not a conditional in JSX:

| Path | Label |
|---|---|
| `know_most` | Check my plan |
| `know_some` | Fill in my plan |
| `recommend_all` | Recommend my initiatives |

## The funnel (D1)

One shape, every initiative:

```ts
// lib/intake/funnel.ts
export const FUNNEL_STAGES = [
  { key: 'signed_up',  defaultLabel: '% who signed up' },
  { key: 'showed',     defaultLabel: '% who showed up or booked' },
  { key: 'bought',     defaultLabel: '% who bought' },
] as const;

/**
 * Per-initiative label overrides. PRESENTATION ONLY - the arithmetic and the
 * stored shape are identical for all 22 initiatives, so there is one tested
 * code path rather than a variant per category.
 */
const LABEL_OVERRIDES: Record<string, Partial<Record<StageKey, string>>> = {
  live_webinar_own:   { signed_up: '% who registered', showed: '% who showed up' },
  podcast_guest_ops:  { signed_up: '% who opted in',   showed: '% who booked a call' },
};
```

Audience reached and average price bracket the percentage chain, matching
`InitiativeFunnel` in the already-built forecast module. No new maths.

## Recommendation engine

The six rules in REQ-13.8 to REQ-13.12 are pure predicates over one context
object, so each is independently testable and the AI cannot quietly bypass one.

```ts
// lib/recommend/eligibility.ts
export interface EligibilityContext {
  industry: string;
  didntWork: string[];          // library keys
  monthlyBudget: number;
  hoursPerWeek: number | null;
  whoCloses: 'me' | 'salesperson' | 'no_sales_calls' | 'mix' | null;
  stage: 'start' | 'momentum' | 'scale';
}

export function isEligible(
  entry: LibraryEntry,
  ctx: EligibilityContext
): { eligible: boolean; reason: string | null }
```

**The AI proposes; this filters.** The model is asked for ranked candidates,
then every candidate passes through `isEligible` server-side before reaching
the screen. Prompt instructions alone are not enforcement — the model can
ignore them, and a sales-call initiative recommended to someone who does not
take sales calls is the kind of error that destroys trust in the whole plan.

Sizing by stage (REQ-13.13):

| Stage | Recommendations |
|---|---|
| Start | 1–2 |
| Momentum | 2–4 |
| Scale | 4+ |

Swap (D3) calls `nextBestAlternative(current, alreadyShown, ctx)`, which walks
the ranked eligible list, skipping anything already displayed or dismissed, and
returns null when exhausted so the control can disable itself.

## Data flow

```
Screens 0-9 ──autosave──> /api/intake/draft ──> planning_inputs (partial)
                                                 intake_products
                                                 intake_initiatives

Final button ──> /api/intake/recommend
                   ├─ forecast user initiatives   (intake-forecast.ts)
                   ├─ ask AI for candidates       (workbook-grounded)
                   ├─ filter through isEligible   (the six rules)
                   └─ size to stage
                 ──> recommendations screen

"Build my plan" ──> /api/intake/build
                   ├─ check max_initiatives       (REQ-13.15)
                   ├─ intake_products   -> products
                   ├─ accepted          -> initiatives (+ tasks from workbook)
                   ├─ sequence dates     (plan-schedule.ts, already built)
                   └─ onboarding_status = intake_complete
```

Autosave writes a PARTIAL `planning_inputs` row from screen 1 onward, so a user
who abandons at screen 6 still leaves usable data and `intake_abandoned` has
something to attribute.

## Migration 026 — remaining fields

Section 15 of the requirements. Additive and guarded, same pattern as 025.

```sql
ALTER TABLE planning_inputs
  ADD COLUMN IF NOT EXISTS industry_other TEXT,
  -- Resume position. A SCREEN SLUG, not an index: indexes shift when the path
  -- changes, so a stored 5 could resume a Path C user on the wrong screen.
  ADD COLUMN IF NOT EXISTS resume_screen TEXT,
  ADD COLUMN IF NOT EXISTS onboarding_status TEXT
    CHECK (onboarding_status IN ('signed_up','intake_started','intake_complete',
                                 'plan_viewed','first_actuals_entered')),
  ADD COLUMN IF NOT EXISTS signed_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_complete_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_viewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS first_actuals_at TIMESTAMPTZ;

ALTER TABLE intake_products
  -- Only meaningful when pricing_model = 'recurring' (REQ-6.6).
  ADD COLUMN IF NOT EXISTS recurring_interval TEXT
    CHECK (recurring_interval IN ('month','year'));

ALTER TABLE intake_initiatives
  -- The "Something else" free text, flagged for review (REQ-8.1).
  ADD COLUMN IF NOT EXISTS custom_label TEXT,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;
```

`resume_screen` stores a slug rather than an index deliberately: an index means
different screens on different paths, so a Path A user who switches to Path C
would resume somewhere unintended.

## Analytics (D5)

```sql
CREATE TABLE IF NOT EXISTS intake_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id  UUID REFERENCES companies(id) ON DELETE CASCADE,
  user_id     UUID,
  event       TEXT NOT NULL,
  screen      TEXT,
  plan_path   TEXT,
  -- Event-specific extras (field, seconds_on_screen, initiative_type,
  -- gap_amount, ...). JSONB because the 11 events carry different shapes and
  -- a column per property would be mostly null.
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Writes go through `/api/intake/events`, which stamps `company_id` and `user_id`
**from the session** — never from the request body, same rule as the chat
account context. A client-supplied company id would let anyone pollute another
account's funnel data.

`intake_abandoned` cannot be fired by a client that has already closed the tab.
It is derived: a scheduled check marks any draft with no event for 30 minutes
and no `intake_complete_at`. Firing it on `beforeunload` would count every
normal navigation as an abandonment.

## Reuse

Already built and tested — no new work:

| Need | Existing |
|---|---|
| Comma-as-you-type numbers | `NumberInput` / `NumberInputRaw` |
| MM/DD/YYYY dates | `DateInput` |
| Mic on long text | `DictationTextarea` + `useDictation` |
| Currency display | `formatMoney` |
| Product goals, stretch, growth, funnel, gap | `lib/intake-forecast.ts` (39 tests) |
| Workbook library + task templates | `lib/workbook/read.ts` |
| Date sequencing for generated initiatives | `lib/plan-schedule.ts` |
| AI failure handling | `lib/ai-errors.ts` |

## Testing

Pure modules get unit tests; the screens get manual verification against the
mockups.

- `flow.ts` — Path C is 9 screens and excludes `initiatives`; progress never
  exceeds total; next/prev from every screen on every path.
- `validation.ts` — each required field blocks; every optional field does not;
  obstacles cap at 3; "Not sure" yields null, never 0.
- `funnel.ts` — label overrides never change arithmetic; a blank stage yields
  no forecast rather than zero.
- `eligibility.ts` — one test per rule, plus `didnt_work` exclusion and
  "Broad fit" eligibility for Other.
- `sizing.ts` — stage-to-count bounds.
- `swap.ts` — never returns an ineligible or already-shown initiative; returns
  null when exhausted.
- `intake-forecast.ts` — done, pinned to the mockup's figures.

Proration (REQ-7.2) deserves particular attention: on a 6-month plan,
$450,000 of last-12 revenue must show as $225,000 with a $292,500 stretch.
Showing the annual figure would invite a goal double what the user intends.
