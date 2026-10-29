---
inclusion: always
---

# SAM Plan AI — Project Handover

Context for any developer (or Kiro session) picking this project up on any
machine. Last updated **27 Oct 2026**. Covers what exists, why it is built the
way it is, what is unfinished, and the traps that cost time.

Read `AGENTS.md` first. Everything below assumes it.

## 0. Start here (new machine checklist)

1. Clone `volcone-team/sam-plan-ai`. `npm install`.
2. Get `.env.local` from the owner (never from git). Variable names are in §3.
3. `git status` and `git log --oneline -5` — compare with §9 "Uncommitted
   work" to know whether the last session's changes were committed.
4. Run the migration checks in §4 before trusting any feature that needs one.
5. `npm test -- --run` and the build (§3) should both pass before you change
   anything, so you know any later failure is yours.
6. Read §8 (open items). The task-generation problem there is the client's
   current top priority.

## 1. Stack and deployment

- **Next.js 16.2 (App Router, Turbopack, React 19)** — a modified build with
  breaking changes. Read `node_modules/next/dist/docs/` before writing Next code.
  Page `params`/`searchParams` are Promises. `src/middleware.ts` still works but
  `middleware` is deprecated in favour of `proxy` (the build warns).
- **Supabase** — Postgres + Auth. **One project shared by local dev AND
  production.** There is no staging database. A script run locally writes to
  production data.
- **Anthropic** — plan generation, recommendations, enhance, chat, and
  AI-written task lists (Haiku) for initiatives with no workbook template.
- **Stripe** — still a TEST key (`app_settings.stripe_mode = 'test'`). Hosted
  Checkout + webhooks.
- **Mailgun** — 2FA codes, password reset, invites, notifications. The
  verified sending domain is `email.samplan.ai`; `samplan.ai` itself is NOT
  verified, so `MAILGUN_DOMAIN` must be `email.samplan.ai` or every email
  (including 2FA) fails.
- **GoHighLevel (GHL)** — CRM tags via an outbox (`src/lib/ghl/`, migration
  044, table `ghl_events`). Never called inline from a user request or the
  Stripe webhook. Delivered by `scheduleGhlDrain` (`after()` once the
  response is sent), because the Vercel Hobby plan allows only two DAILY
  crons — do not add a frequent cron, the deploy fails.
- **Vercel** — repo `volcone-team/sam-plan-ai`. **Pushing to `main` deploys
  production automatically.** Crons in `vercel.json`
  (`/api/cron/initiative-reminders`, `/api/cron/resume-paused`).

## 2. Ground rules

- **Never commit or push without the owner's go-ahead.** `main` is
  production. In practice the owner commits and deploys.
- **Migrations are run by hand** by the owner in the Supabase SQL editor.
  Never assume one is applied — check with `scripts/verify-0NN.mjs`. Code is
  written to fail open (treat a missing column as "feature off") so a deploy
  never depends on a migration being applied first. Keep that pattern.
- **Database access is read-only** unless the owner asks for a write. For
  investigation, write a throwaway read-only script, run it, delete it.
- **SQL containing `$$` must be generated, not hand-written.** Shells and JS
  `replace()` mangle `$`. Use the generator pattern in
  `scripts/gen-migration-0NN.mjs` (`String.fromCharCode(36)`), then read the
  file back from disk to verify.
- **Never commit** `.env.local`, `db-backup-*/`, `supabase/.temp/`, or the
  client's workbook. Anything in `public/` is publicly downloadable.
- **Verify, don't assume.** Most bugs were found because a plausible
  explanation turned out wrong against real data. Prefer a read-only script
  against the real database, Stripe or the stored workbook over reasoning.
- Existing accounts are dummy/test data. `team@volcone.com` is a super admin
  AND owner of the "Volcone Admin" company — super admins skip every gate, so
  test customer behaviour with a non-admin account.

## 3. Commands and environment

```
npm test -- --run                                   # vitest, ~3,900 tests / 171 files
npx tsc --noEmit 2>&1 | grep -v "^\.next/"          # type check (ignore .next noise)
NODE_OPTIONS=--max-old-space-size=8192 npm run build   # macOS / Linux
$env:NODE_OPTIONS="--max-old-space-size=8192"; npm run build   # Windows PowerShell
node scripts/verify-057.mjs                         # any migration check
node_modules/.bin/vite-node script.mts              # run a .mts script
```

Gotchas, any OS:
- `npx tsx` is NOT installed and hangs waiting to download. Use `vite-node`.
- Phantom type errors in `.next/dev/types/routes.d.ts`: delete `.next`, rebuild.
- After changing `.env.local`, restart the dev server.

Windows + PowerShell only (the project was first built on Windows):
- Use `;` not `&&` between commands.
- `git push` reports exit code 1 because PowerShell mangles git's stderr. It
  usually succeeded — compare `git rev-parse --short HEAD` with
  `git rev-parse --short origin/main`.
- Commit messages with braces/JSON break the shell: write the message to
  `.git/COMMIT_MSG_TMP`, then `git commit -F .git/COMMIT_MSG_TMP`.

macOS + zsh: unquoted globs such as `--include=*.ts` fail with "no matches
found". Quote them: `--include='*.ts'`.

Environment variable NAMES (values live in `.env.local` and Vercel, never here):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY_CHATBOT`,
`MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, `NOTIFICATIONS_TOKEN_SECRET`,
`CRON_SECRET`, `TWO_FACTOR_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`GHL_LOCATION_ID`, `GHL_PRIVATE_TOKEN`.
Optional: `NEXT_PUBLIC_APP_URL` (see `src/lib/app-url.ts`), `ANTHROPIC_MODEL`,
`ANTHROPIC_TASK_MODEL`.

## 4. Migrations

018–029 are described in older history (workbook tables, own 2FA,
`app_settings`, chatbot, Stripe billing, trial trigger, intake v2, pause
billing, marketing consent, `resolve_trial_plan()`). All applied.

Status checked against the live database on **27 Oct 2026**:

| # | What | Live? |
|---|---|---|
| 030–037 | Cancellation feedback, retention offers, customer pause, retention booking URLs, `initiative_settings` (034), profile phone, repeat frequency, legal consent | yes |
| 038 | SAM University (catalogue, per-plan gating) | yes |
| 039 | FAQ | yes |
| 040 | Library scores, industries, CTA, training, metrics | yes |
| 041 | Recommendation revenue weight | yes |
| 042 | `task_generation` generation event type | yes |
| 043 | Call before access (`companies.requires_call_unlock`, `portal_access_granted_at`) | yes |
| 044 | GHL outbox | yes |
| 045 | Intake v3: `initiative_library_config` + initiative columns (`conversion_path`, `format`, `attrs`…) | yes |
| **046** | Recurring instances (`initiative_instances`, `initiatives.correction_kept_at`) | **NO** |
| 047 | Intake v3 toggle | yes |
| 048 | Yearly onboarding booking link | yes |
| 049 | Require email verification switch | yes |
| 050 | Plan comparison (pricing) table | yes |
| 051 | Seven recurrence frequencies + raw workbook cells | columns yes; CHECKs confirm by hand (script prints the SQL) |
| 052 | GHL `registered` event | confirm by hand (script prints the SQL) |
| **053** | `planning_inputs.customer_industries_other` | **NO** |
| 054 | Raw workbook Start/Event date cells | yes |
| 055 | `products.recurring_interval` | yes |
| 056 | University `billing_cycle` visibility | yes |
| 057 | `account_invites` (7-day invites) | yes |

Re-run the scripts rather than trusting this table; it ages.

## 5. Live admin switches (app_settings, 27 Oct 2026)

`stripe_enabled` true, `stripe_mode` test, `trial_enabled` **false** (so the
plan-first signup flow is live), `require_call_before_access` **true**,
`ghl_enabled` true (`ghl_dry_run` false), `intake_v3_enabled` **true**,
`require_email_verification` false, `chatbot_enabled` true.

## 6. What is built, by area

### Auth, 2FA and invites
- Own 8-digit emailed 2FA code (`/auth/verify-code`, `src/lib/two-factor.ts`).
  A `sam_2fa` HMAC cookie trusts a device for 30 days. One universal gate in
  `src/lib/supabase/middleware.ts` covers app pages, admin and APIs.
- Signup confirmation lands on `/auth/confirmed` (a CLIENT page: the link can
  arrive as a hash fragment the server never sees).
- Resend confirmation link (`src/components/auth/resend-confirmation.tsx`).
  Verified against the live auth server: a new token rejects the old one; a
  resend inside ~60s gets 429 and issues nothing.
- **7-day team invites (057).** Our own token in `account_invites`
  (`src/lib/invite-token.ts`, TTL 7 days, stored hashed). The email links to
  `/auth/invite?token=`, which mints a fresh Supabase link at click time —
  Supabase's own links cap at 24h, which is why we don't use them directly.
  A resend replaces earlier unused invites. Resend buttons: owner in
  Settings (`/api/team/[memberId]/resend-invite`) and super admin in
  `/admin/users` (`/api/admin/users/[id]/resend-invite`, pending users only).
  Before 057 the code falls back to the old Supabase link.
- Customer roles on `profiles.role`: `owner`, `operator`, `team_member`,
  `viewer`. Only an owner can invite from Settings.

### Billing (Stripe)
- Single key pair from env. `stripe_mode` columns are always written as the
  constant `STRIPE_MODE_TAG = "live"` only to satisfy unique constraints —
  nothing reads it for behaviour. Do not "fix" it.
- **The webhook is the only writer of subscription state.** Checkout grants
  nothing. `/api/billing/reconcile` copies the caller's own state from Stripe
  as a safety net (called from `/welcome`, `/choose-plan`, `/settings`).
- `/api/stripe/webhook` MUST stay in `isPublicApiRoute` in the middleware.
  Its absence once caused a production outage (every webhook got 401).
- Reconcile recovers a lost customer by email only for Stripe customers
  created after the company (5-min grace).
- Deleting a company/account cancels its Stripe subscriptions FIRST
  (`src/lib/billing/cancel-on-delete.ts`).
- `evaluateAccess` (`src/lib/billing/entitlement.ts`) is the single access
  decision. Precedence: billing off > paused > comp > trial > active > grace.
  A missing plan limit means **unlimited**.
- Retention: cancellation feedback, retention offers, customer-initiated
  pause (030–033).
- Going live needs: live restricted key with the right scopes, the webhook
  endpoint re-created on the live account (current test endpoint is pinned to
  API version `2018-02-28`; `webhook-logic.ts` reads both shapes), Stripe Tax
  if wanted.

### Signup, lockout and the call gate
- Billing lockout: no entitlement → pages go to `/choose-plan`, APIs 402.
  Paused → `/account-paused`, APIs 403. Allow-list in
  `src/lib/billing/lockout.ts` (`/api/me` exact match on purpose).
- Two signup flows by the trial switch (`src/lib/billing/signup-flow.ts`).
  Trial is OFF, so live flow is: `/get-started` (pick plan) → register →
  `/checkout` → Stripe → `/welcome`.
- **Call before access (043).** After paying, a company waits on `/welcome`
  ("book your onboarding call") until a super admin clicks **Open** in
  `/admin/companies`. Logic: `src/lib/access/call-gate.ts`,
  `call-gate-settings.ts`, `portal-access.ts`.
  - The gate is per COMPANY: while the portal is closed the owner AND every
    teammate are held on `/welcome`.
  - Only the OWNER's visit can stamp an undecided company as gated; a
    teammate logging in never closes a portal. (Middleware + `/welcome`.)
  - The old 10-minute "new company" window was removed: every company shows
    Open/Close in admin. Any grant reads as open; flagged with no grant reads
    as waiting; undecided follows the global switch.
  - While waiting only `/welcome`, `/auth/*`, `/api/auth/*`, `GET /api/me` are
    reachable — so a gated owner cannot invite teammates.
- Welcome page (`src/app/welcome/`): monthly and yearly copy differ; the
  booking link is chosen by billing cycle (yearly falls back to monthly).
  Preview without paying: `/welcome/preview?plan=monthly|yearly`.

### Admin
- `/admin/companies` — single company table: grant/revoke access, pause
  billing, open/close portal.
- `/admin/subscriptions` — Stripe config, plan sync, trial settings, history.
- `/admin/initiative-config` — which library initiatives are offered and how
  each behaves in the intake v3 form (`initiative_settings` 034 +
  `initiative_library_config` 045). These live OUTSIDE the `wb_*` tables on
  purpose: every workbook upload wipes and refills `wb_*`.
- `/admin/ai-workbook` — workbook upload. `/admin/benchmarks`, `/admin/content`
  (University + FAQ), `/admin/users`, `/admin/notifications`, `/admin/analytics`.

### SAM University (038, 056)
- Resources gated per plan (`university_resource_plans`, `is_free`) and by
  billing cycle (`billing_cycle`: any / monthly / annual). Wrong cycle =
  hidden; wrong plan = shown locked. Trials and comps count as monthly.
  Filtering is server-side (`src/lib/university/access.ts`, `catalogue.ts`).
- Admin bulk delete: `/api/admin/university/resources/bulk-delete`.
- Stage to Scale sheet imported as 90 DRAFT resources by
  `scripts/import-stage-to-scale.mjs` (idempotent; data in
  `scripts/data/stage-to-scale-resources.tsv`), category
  `59a652fb-dd11-482d-8f56-83f7ddc39d80`, all annual-only. An old "TEST"
  resource sits in the same category.

### Onboarding intake (v2 screens) and plan build
- Flow: `src/lib/intake/flow.ts`. Recommendations:
  `src/app/api/intake/recommend/route.ts` (AI proposes, `isEligible`
  disposes; heuristic fallback). Sizing: `src/lib/recommend/sizing.ts`.
- Stretch goal = goal + 30% (`stretchForGoal`). Revenue spread and
  Better/Best scenarios: `revenue-spread.ts` (Best ×1.2), editable.
- Build: `src/app/api/intake/build/route.ts`. Regenerate restarts at the
  first screen when `completed_at` is set.
- The landing page is hidden (`SHOW_LANDING_PAGE=false` in
  `src/app/page.tsx`); `/` goes to login.

### In-app Add Initiative (intake v3, switched ON)
- Picker → universal form: `src/lib/intake-v3/` (`library-config.ts`,
  `category-schemas.ts`, `type-extras.ts`, `universal-form.ts`), UI
  `src/components/initiatives/intake-form.tsx`, API `POST /api/initiatives`.
- Answers are saved on the initiative (`kind`, `conversion_path`, `format`,
  `category_id`, `revenue_close_date`, `attrs`).
- Edit uses the same layout as Add (`edit-layout.ts`,
  `/api/initiatives/[id]/form-config`).
- Products carry `recurring_interval` monthly/yearly (055).

### Planning views
- Timeline, monthly, quarterly and weekly views share `period-totals.ts`
  (event month, year tabs, weekly derived). CSV export removed.
- Conversion-metrics tab lists the metric set plus `wb_benchmarks` ranges.
- Support footer in the AppShell (`support-footer.tsx`).

## 7. The workbook and task generation (read before touching tasks)

Upload: browser parses .xlsx (`src/components/admin/workbook-upload.tsx`) →
`/api/admin/workbook` stores raw sheets in `workbook_data` → `ingestWorkbook`
(`src/lib/workbook/ingest.ts`) rebuilds `wb_initiative_library` (87 rows),
`wb_benchmarks`, `wb_task_templates`, `wb_ai_context` wholesale. Parser:
`src/lib/workbook/parse.ts` (library columns found by header name —
`resolveLibraryColumns` — and all rows are sent, both now in `main`).

How an initiative gets tasks (`src/lib/workbook/tasks-for-initiatives.ts`,
`materialise.ts`): match `wb_task_templates.initiative_key` exactly (then the
row's `base_key`) → else AI-written list (Haiku) → else a 6-step starter.
Due date = anchor date − lead days, never before today.

**Known broken, reported by the client 27 Oct (top priority):**
1. **Intake answers are not used for tasks at all.** Only the library key and
   one date reach task generation. Booth, travel, deck, talk crafted,
   opt-in/sales funnel, ad platforms, format, and selling-vs-leads change
   nothing.
2. **Sections inside a sheet are flattened.** Section header rows (column A
   only, e.g. "If approved for selling on stage", "Opt-in Funnels",
   "Meta Ads") are dropped and every task below is kept.
3. **Sheets sharing a column-A name are merged.** The key comes from the most
   frequent column-A value. 5.0, 5.0B, 5.0C all say "Other People's Stages
   (OPS)" → one key with 150 tasks (49 unique names), interleaved because
   each sheet's `display_order` restarts at 0.
4. **Funnels (5.9) reaches nobody** — its key `funnels` matches no library
   row. **Paid Ads (6.8)**: all 7 ad sections land on
   `geo-targeted-radius-ads`; Meta/Podcast/Newsletter/YouTube/etc. get AI
   tasks.
5. **Dates:** "60+"-style lead cells fail `parseNumeric` → 0 → due on event
   day. Negative leads (follow-ups after the event) are made positive and
   land BEFORE the event. Cart open/close dates are never used.
6. Only 18 of 87 library rows have a template; 8 template keys match no
   library row (`funnels`, `challenge-bootcamp`, `referral`,
   `pdocast-vodcast`, `own-in-peson-event`, `trade-show-expo-booth`,
   `content-organic-social`, `seo-ai-search-ads`).
7. Add Initiative validation shows "N fields need attention" only at the TOP
   of the form; nothing near the submit button. Client wants it above the
   button.

Proposed fix (explained to the owner, not started): parse section headers as
named groups; stop merging sheets; a rules table mapping intake answers to
sections (selling/leads → OPS section; opt-in/sales funnel → Funnels
sections; format → Registration Funnel section; ad platforms → Paid Ads
sections; booth/travel/deck → drop matching tasks); dedupe by task name;
fix "60+" and negative leads; anchor sales tasks on cart dates; show the
error by the button. Client side: put the exact library initiative name in
column A of each sheet and keep section headings consistent. Estimate 2–3
days plus testing. Existing initiatives need tasks rebuilt afterwards.
Unclear client point: "for virtual events, we do have non-virtual" — ask.

## 8. Open items

- **Task generation** — §7. Client wants an answer/plan urgently.
- **Migrations 046 and 053 not applied**; confirm 051/052 CHECKs by hand.
- `scripts/repair-plan-years.mjs --apply` — waiting on 2 owner decisions.
- API failure log (`api_error_log`) — design proposed, waiting on owner.
- Auth 429s from many tabs / corrupt cookie — a `getClaims` fix (small or
  broad) was offered, no answer yet.
- Intake build does not write `projections`, so the Revenue report can show
  $0 while the dashboard shows forecast revenue.
- `generate-plan` / suggestions can recreate deactivated `initiative_types`.
- Enhance `new_initiative` / `target_change` attach to the newest annual
  plan, not the year being viewed.
- Duplicate initiative rows seen on test accounts (e.g. two identical
  "Black Friday 2027" rows 12 s apart) — suspected double submit. Unconfirmed.
- Open the portal for UK Comm and Eternal Ventures once their calls are done
  (`/admin/companies`). Volcone Admin's teammates are held on `/welcome`
  until its portal is opened.
- `src/middleware.ts` → `proxy` rename (deprecation only).
- Stripe live switch-over (§6 Billing).

## 9. Uncommitted work (as of 27 Oct 2026)

HEAD was `89f3e53 "new text edits"`. Not yet committed, all tested
(tsc clean, 3,897 tests, build clean):
- Call gate: owner-only stamping, 10-minute window removed, Open/Close for
  every company (`middleware.ts`, `welcome/page.tsx`, `src/lib/access/*`,
  admin companies + portal-access routes).
- 7-day invites + resends (`invite-token.ts`, `auth/invite/`, `team-invite.ts`,
  `mailgun.ts`, `set-password`, user-management, both resend routes,
  migration 057 + `verify-057.mjs`).
- University billing cycle + bulk delete (056, `src/lib/university/*`,
  `university-management.tsx`, `verify-056.mjs`).
- Stage to Scale import script and data (`scripts/import-stage-to-scale.mjs`,
  `scripts/data/`).
- This handover file.

Check with `git status`; if these files are clean, it was committed.

## 10. Useful scripts (read-only unless named otherwise)

- `scripts/verify-0NN.mjs` — confirm a migration is applied.
- `scripts/test-confirm-token-rotation.mjs` — live auth check; creates and
  deletes one throwaway user.
- `scripts/inspect-intake.mjs`, `inspect-reports.mjs`,
  `inspect-stripe-orphans.mjs`, `check-generation-readiness.mjs`.
- **Write:** `cancel-stripe-orphans.mjs`, `recover-payment.mjs`,
  `backfill-*.mts`, `import-stage-to-scale.mjs`, `repair-plan-years.mjs
  --apply`. Read them before running.
- `supabase/scripts/wipe-user-data.sql` — **destructive**; clears user data,
  keeps config.
- Throwaway inspection pattern: a `scripts/.tmp-*.mjs` that reads
  `.env.local`, creates a service-role client, SELECTs only, then is deleted.
