---
inclusion: always
---

# SAM Plan AI — Project Handover

Context for any developer (or Kiro session) picking this project up. Covers the
work from 24 Sep 2026 to the handover on 12 Oct 2026: what exists, why it is
built the way it is, what is unfinished, and the traps that cost time.

Read `AGENTS.md` first. Everything below assumes it.

## 1. Stack and deployment

- **Next.js 16.2 (App Router, Turbopack, React 19)** — a modified build with
  breaking changes. Read `node_modules/next/dist/docs/` before writing Next code.
  Page `params`/`searchParams` are Promises. `src/middleware.ts` still works but
  `middleware` is deprecated in favour of `proxy` (the build warns).
- **Supabase** — Postgres + Auth. One project shared by local dev AND
  production. There is no separate staging database.
- **Anthropic** — plan generation, recommendations, enhance, chat.
- **Stripe** — currently a TEST key. Hosted Checkout + webhooks.
- **Mailgun** — 2FA codes, password reset, invites, notifications.
- **Vercel** — repo `volcone-team/sam-plan-ai`. **Pushing to `main` deploys
  production automatically.** Never push without the owner's go-ahead.

## 2. Ground rules

- **Do not push without asking.** `main` is production.
- **Migrations are run by hand** in the Supabase SQL editor by the owner. Never
  assume one is applied — check (see `scripts/verify-*.mjs`).
- **SQL containing `$$` must be generated, not hand-written.** PowerShell
  expands `$$` to its PID and JS `replace()` treats `$` specially. Use the
  generator pattern in `scripts/gen-migration-028.mjs` / `029`
  (`String.fromCharCode(36)`), then read the file back from disk to verify.
- **Never commit** `.env.local`, `db-backup-*/`, `supabase/.temp/`, or the
  client's workbook. Anything in `public/` is publicly downloadable.
- **Verify, don't assume.** Most bugs in this period were found because a
  plausible explanation turned out to be wrong when checked against real data.
  Prefer a read-only script against the real database or Stripe over reasoning.
- Existing accounts are dummy/test data.

## 3. Commands and environment

```
npm test -- --run          # vitest, ~1104 tests / 41 files
npm run build              # needs the memory flag below
$env:NODE_OPTIONS="--max-old-space-size=8192"
```

Windows + PowerShell. Hard-won gotchas:

- Use `;` not `&&` between commands.
- `git push` reports exit code 1 because PowerShell mangles git's stderr. It
  usually succeeded — verify with `git rev-parse --short HEAD` vs
  `git rev-parse --short origin/main`.
- Commit messages containing braces/JSON break the shell. Write the message to
  `.git/COMMIT_MSG_TMP` and use `git commit -F .git/COMMIT_MSG_TMP`.
- `npx tsx` is NOT installed and will hang waiting to download. To run a `.mts`
  script use `node_modules/.bin/vite-node script.mts`.
- Phantom type errors in `.next/dev/types/routes.d.ts`: delete `.next`, rebuild.
- Two pre-existing test files have type errors (missing vitest imports), not
  caused by recent work: `src/services/__tests__/initiative-type.service.test.ts`
  and `src/components/initiatives/__tests__/initiatives-list.test.ts`.

Environment variable NAMES (values live in `.env.local` and Vercel, never here):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY_CHATBOT`,
`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, `NOTIFICATIONS_TOKEN_SECRET`,
`CRON_SECRET`, `TWO_FACTOR_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
Optional: `NEXT_PUBLIC_APP_URL` (see `src/lib/app-url.ts`), `ANTHROPIC_MODEL`.

## 4. Migrations

All of 018–029 were verified present in the live database at handover.

| # | What |
|---|---|
| 018 | Workbook "brain": `wb_initiative_library`, `wb_benchmarks`, `wb_task_templates`, `wb_ai_context` |
| 019 | Own 2FA codes (not Supabase OTP) |
| 020 | `app_settings` singleton (`id = 'global'`) |
| 021 | Chatbot conversations, messages, budgets |
| 022 | Stripe billing: subscriptions columns, prices, invoices, webhook events |
| 023 | Trial row created on signup (trigger) |
| 024 | Dropped the old 3-initiative trial cap |
| 025/026 | Intake v2 tables: `planning_inputs` v2, `intake_products`, `intake_initiatives` |
| 027 | Pause billing: `subscriptions.is_paused`, `pause_reason`, `pause_resumes_at` |
| 028 | `profiles.marketing_consent` (true / false / NULL = never asked) |
| 029 | `resolve_trial_plan()`; `app_settings.trial_plan_id`; dropped `tier` CHECK |

## 5. What was built, by area

### Auth and 2FA
- Own 8-digit emailed 2FA code (`/auth/verify-code`, `src/lib/two-factor.ts`).
  A `sam_2fa` HMAC cookie trusts a device for 30 days. One universal gate in
  `src/lib/supabase/middleware.ts` covers app pages, admin and APIs.
- Signup confirmation lands on `/auth/confirmed` (a CLIENT page, because the
  link can arrive as a hash fragment the server never sees). Confirming grants
  2FA trust for that device.
- **Resend confirmation link** (`src/components/auth/resend-confirmation.tsx`)
  on the signup success screen, on login (only for "email not confirmed",
  never a wrong password, so it cannot probe which emails exist), and on the
  expired-link screen.
- Facts verified against the live auth server
  (`scripts/test-confirm-token-rotation.mjs`, sends no email):
  issuing a new token REJECTS the old one; a resend inside ~60s is refused
  with 429 `over_email_send_rate_limit` and issues NOTHING, so the old link
  stays valid. `src/lib/auth/resend-result.ts` reports this honestly.

### Billing (Stripe)
- Single key pair from env; no test/live toggle. `stripe_mode` columns are
  always written as the constant `STRIPE_MODE_TAG = "live"` only to satisfy
  unique constraints — nothing reads it for behaviour. Do not "fix" it.
- **The webhook is the only writer of subscription state.** Checkout grants
  nothing. `/api/billing/reconcile` copies the caller's own state from Stripe
  as a safety net after Checkout (called from `/welcome`, `/choose-plan`,
  `/settings`).
- `/api/stripe/webhook` MUST stay in `isPublicApiRoute` in the middleware.
  Its absence was a production outage: every webhook got 401 from the
  middleware before the handler ran. The handler verifies the Stripe
  signature itself.
- Reconcile recovers a lost customer by email **only for Stripe customers
  created after the company** (5-min grace). Email is reusable; unbounded
  lookup let a recreated account adopt a deleted account's subscription.
- Deleting a company or account cancels its Stripe subscriptions FIRST
  (`src/lib/billing/cancel-on-delete.ts`), then cascades.
- `evaluateAccess` (`src/lib/billing/entitlement.ts`) is the single access
  decision, used by the middleware, the APIs and the admin table. Precedence:
  billing switched off > paused > comp > trial > active > grace.
- A missing plan limit is treated as **unlimited**. That is why 029 disables
  the trial rather than granting a plan-less one.
- "Retire Plan" (formerly deactivate) stops new sales only; existing
  subscribers keep price and limits. `/api/billing/me` resolves plan names
  against ALL plans, not just active ones.

### Lockout and signup flows
- Middleware gate: no entitlement → pages redirect to `/choose-plan`, APIs
  return 402. Paused → `/account-paused`, APIs 403. Super admins are never
  locked out. Allowed while locked out: see `src/lib/billing/lockout.ts`
  (note `/api/me` is EXACT-match on purpose — `/api/me/password` must stay
  blocked).
- Two signup flows, chosen by the admin trial toggle
  (`src/lib/billing/signup-flow.ts`):
  - Trial ON: register → trial on `resolve_trial_plan()` → dashboard.
  - Trial OFF: `/get-started` (pick plan) → register → `/checkout` →
    Stripe → `/welcome`.
  - The signup page itself enforces plan-first via
    `/api/billing/signup-flow`, so every entry point is covered.
  - The plan in the URL is untrusted; it only chooses what to offer.
- Purchases from `/choose-plan` and `/checkout` send `returnTo: "welcome"`;
  plan changes from settings return to `/settings`.

### Welcome page (`/welcome`)
- Built to the founding-member mockup. Always dark. Artwork in
  `public/welcome/*.png` (black backgrounds, blended with
  `mix-blend-screen`). Copy is the mockup's; its own placeholders
  (`[X] months`, `[day]`, `[time]`) and empty `VIDEO_URL` / `BOOKING_URL`
  are constants at the top of `src/app/welcome/welcome-client.tsx`.
- Gated on entitlement. On `?checkout=success` with no entitlement yet it
  renders `confirm-payment.tsx`, reconciles once, reloads with
  `confirmed=1` — one-shot so an unpaid visitor cannot loop.

### Admin
- `/admin/companies` is the single company table (subscription data merged
  in; 4 columns + accordion). Grant/revoke access and **pause billing** live
  there. Stripe has no paused status for normal subscribers, so `is_paused` is
  the local source of truth; Stripe is told `pause_collection: void`.
- `/admin/subscriptions`: Stripe config, plan sync, trial settings (including
  which plan the trial grants), payment history.
- Marketing consent is stored on `profiles` (a person consents, not a company).

### Intake v2 (the 10-screen questionnaire)
- Specs: `.kiro/specs/intake-v2/`. Flow model: `src/lib/intake/flow.ts`
  (screens: start, business, team, products, goal, initiatives, wins,
  customer, audience, obstacles; Path C omits `initiatives`).
- Recommendations: `src/app/api/intake/recommend/route.ts`. The AI proposes,
  the server disposes — every pick is re-checked by `isEligible`
  (`src/lib/recommend/eligibility.ts`). Falls back to a heuristic ranking if
  the AI is unavailable.
- How many to recommend: `src/lib/recommend/sizing.ts`, hardcoded by stage
  (Start ≤2, Momentum ~3, Scale ~5), capped by the plan's `max_initiatives`.
- Build: `src/app/api/intake/build/route.ts` turns the intake into a plan.
- The old 7-question questionnaire was deleted entirely.

### Planning
- Plan years can be deleted (`src/app/api/plan/year/route.ts`).
- Enhance no longer schedules work in past years.

## 6. The AI workbook — current state (read before touching initiatives)

**There are two initiative lists, and the admin toggles are on the wrong one.**

| | `initiative_types` | `wb_initiative_library` |
|---|---|---|
| Visible at | `/admin/initiatives` (has on/off toggles) | Nowhere in the UI |
| Source | Hand-made / auto-created | Workbook upload at `/admin/ai-workbook` |
| What the AI picks from | No | **Yes** |

- Intake recommendations, the intake picker, Enhance and chat read ONLY
  `wb_initiative_library` (`loadLibrary` in `src/lib/workbook/read.ts`).
  **The `/admin/initiatives` toggle has no effect on them.**
- `generate-plan` and plan suggestions send both lists to the AI, then map
  the chosen library key to an ACTIVE `initiative_types` row — and if the
  admin deactivated it, they **create a new active duplicate**. Known bug.
- Upload pipeline: browser parses the .xlsx (`workbook-upload.tsx`) → POST
  `/api/admin/workbook` stores raw sheets in `workbook_data` →
  `ingestWorkbook` (`src/lib/workbook/ingest.ts`) re-projects them into the
  `wb_*` tables, replacing them wholesale. Parser: `src/lib/workbook/parse.ts`.

**Two parser fixes made at handover, not pushed when this was written.** If
`git log -- src/lib/workbook/parse.ts` does not show a commit adding
`resolveLibraryColumns`, they never reached `main` and must be redone:
1. Library columns are located by HEADER name (`resolveLibraryColumns`), not
   position. The client's new workbook inserts a "Cost to Run" column, which
   under positional reading shifted every later field (price tier stored as
   OWN/OPS, description as "needs sales team") and silently broke eligibility.
2. The upload sends every non-blank row instead of the first 50. Longer task
   templates (Funnels ~91 tasks, OPS ~109) were being truncated.
Both verified against the client's actual new file. Re-upload the workbook
after deploying for them to take effect.

**The client's new workbook (Oct 2026)** was reviewed but NOT uploaded and is
not in git. It is an updated version of the same 23-initiative workbook (more
task templates, real benchmarks), not the 87-initiative library. Content
problems the client must fix: the "DIGITAL MARKETING" banner is in column 2 so
it parses as an initiative; a `#REF!` task number in Email Campaign; a
date-formatted duration in Referral; AI Context filled for only 1 of 17;
Dinners and Funnels templates have no matching library row.

## 7. Client's new "Initiative Intake" spec (Oct 10) — not started

A redesign of how initiatives are captured: 87 initiatives in 10 categories,
a two-screen picker (category → initiative, grouped by "Your audience" /
"Someone else's audience"), and a form assembled from universal inputs +
category schema + per-initiative extras + conditional blocks (conversion
path, kind, dates, multi-line revenue windows, partner/booking, skip-streak
prompts, lead handoff).

Impact: of the 10 intake screens only `initiatives` (and lightly `wins`)
change, but that screen grows a great deal. The real dependency is DATA: the
87-initiative library with per-record settings (`allowed_kinds`,
`allowed_paths`, `revenue_lines`, `partner_block`, extras) does not exist
anywhere yet. Open questions for the client:
1. Where is the 87-initiative "working library"?
2. Does this replace the onboarding intake, the in-app New Initiative form,
   or both? (The spec reads like the in-app form; putting all of it in
   onboarding would make the intake very long.)
3. Does the workbook upload remain the source of the library?
4. Deadline?

Suggested phases: (1) one admin-managed library table with on/off and
count controls, replacing both current lists; (2) the two-screen picker;
(3) the universal form driven by conversion path; (4) category schemas and
extras; (5) recurring placeholders, skip prompts, revenue windows, handoff.
Build the owner's requested admin controls into phase 1, not onto the old
22-row list.

## 8. Open items at handover

- The two workbook parser fixes in section 6
  (`src/lib/workbook/parse.ts`, `parse.test.ts`,
  `src/components/admin/workbook-upload.tsx`) were tested (build clean, 1104
  tests) but awaiting the owner's go-ahead to push. Check whether they landed.
- Admin control over which initiatives the AI uses, and how many — requested
  by the owner, not built. See section 6 and 7 before starting.
- `generate-plan` / suggestions recreate deactivated `initiative_types` rows.
- Intake build does not write `projections`, so the Revenue report shows $0
  while the dashboard shows forecast revenue.
- `new_initiative` / `target_change` enhance suggestions attach to the newest
  annual plan rather than the year being viewed.
- Duplicate product/initiative rows seen on one test account, suspected
  concurrent draft saves (delete-then-insert). Unconfirmed.
- Vercel's Stripe webhook endpoint is pinned to API version `2018-02-28`.
  Not proven to be a problem — `webhook-logic.ts` reads both payload shapes —
  but worth updating deliberately.
- `team+1@volcone.com` still holds a test Mastery subscription inherited
  through the (since fixed) reconcile bug. Test key, harmless.
- Welcome page still needs the real video URL, booking (GHL) URL and the
  bracketed coaching details.
- `src/middleware.ts` → `proxy` rename is outstanding (deprecation only).

## 9. Useful scripts (all read-only unless named otherwise)

- `scripts/verify-*.mjs` — confirm a migration is applied.
- `scripts/test-confirm-token-rotation.mjs` — live auth check; creates and
  deletes one throwaway user.
- `scripts/inspect-intake.mjs`, `inspect-reports.mjs`,
  `inspect-stripe-orphans.mjs` — read-only inspection.
- `scripts/cancel-stripe-orphans.mjs`, `recover-payment.mjs` — **write**;
  read them before running.
- `supabase/scripts/wipe-user-data.sql` — **destructive**; clears user data,
  keeps config.
