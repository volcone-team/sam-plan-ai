# Initiative Intake — build status (uncommitted)

## Built (tasks 1–13)

- **Contract and form rules:** `src/lib/intake-v3/library-config.ts`
- **Migration 045 (applied):** `initiative_library_config` + `initiatives` intake columns
- **Admin config page** `/admin/initiative-config` (seed from workbook, per-record editor)
- **Revenue maths:** `revenue.ts`, `revenue-windows.ts`
- **Two-screen picker** (categories → initiatives, search, recents): `intake-picker.tsx`
- **Universal form** mounted in the Add Initiative panel, old form kept as fallback (`add-initiative-flow.ts`)
- **Conditional blocks:** cart, VIP, affiliate, partner host/booking, promo plan, ad platforms/budget, funnels, commission
- **Twelve category schemas** from the owner's images: `category-schemas.ts` (transcription in `category-schemas.md`)
- **Type extras:** pitch day, webinar date, Affiliate Launch cart dates, Dinners guest list: `type-extras.ts`
- **Date readers** for ongoing / month-only / unscheduled initiatives, legacy rows unchanged: `src/lib/initiatives/schedule.ts`
- **Recurring runs**, "Did this run?" prompt, skip-streak correction prompt: `recurring*.ts`, `/api/initiatives/[id]/instances`, `/correction`, `recurring-prompts.tsx` (needs 046)
- **Lead handoff** with warnings: `lead-handoff.ts`, `/api/initiatives/[id]/handoff`, `lead-handoff-card.tsx`
- **Copy:** close-date labels per path, kind descriptions, no-promotion warning actions + "no promotion" marker

## Verification (14 Oct run)

- `tsc` clean; 3358 tests / 144 files pass; production build succeeds.
- ESLint: new files clean; 69 pre-existing problems on untouched lines of modified files.
- Not done: browser walkthrough; unauthenticated route smoke test (two attempts hung and were abandoned).

## Not built (spec items)

- Timing question (Upcoming / Historical)
- "Calculate from metrics" revenue mode in the new form (goal mode only)
- Scale: "Expected registrants / audience"
- Expenses: "Other expenses" repeater
- 9 · Context section: dashboard link, brief, rationale, tracking metrics, Learn this play
- Picker sub-headings (Other People's Stages — In-Person four groups, Paid Ads two). `SUBHEADINGS` is empty; needs the names per group.
- SMS compliance as a scheduling gate (questions are asked, nothing blocks dates)
- 9-month question changing the recommended date (answer is stored only)
- Booking-status task template swap (`booking_status` is stored; templates don't branch on it yet)
- Per-run actual revenue logging UI (API accepts it, UI sends outcomes only)
- Notifications for month-only dates (would fire on the 1st)
- Flat per-sale commission costing (needs product price in the form)
- An admin on/off switch for the new form. Today the new form appears for everyone as soon as one record is valid.

## Owner actions

1. Commit the work (nothing is committed).
2. Apply migration 046 (`supabase/migrations/046_recurring_instances.sql`); check with `node scripts/verify-046.mjs`. Until then recurring prompts stay off.
3. Run `node_modules/.bin/vite-node -c vitest.config.ts scripts/backfill-type-extras.mts` (dry run), then with `--apply`, to give 8 seeded records their extras.
4. In `/admin/initiative-config` set allowed kinds (86 records missing) and conversion paths (44 missing). Records stay out of the new picker until valid.
5. Switch off "OPS - In Person (Other People's Stages)" — a workbook section banner parsed as an initiative.
6. Decide whether to add the admin switch for the new form before configuring records.
7. Confirm assumptions:
   - booking values are `pending` / `confirmed`;
   - "Rooms you join" = Networking Events, Chamber & Local Business Associations, Mastermind Membership;
   - outcome prompt is due the Friday of the week after the run;
   - speaker-fee close label is "Final payment due".
