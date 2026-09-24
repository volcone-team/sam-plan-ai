# Implementation Plan

## Overview

Implementation plan for automatic, date-triggered initiative reminder emails with admin-tunable rules. Tasks follow the design's dependency chain: database schema first, then pure/unit-testable helpers (template renderer, unsubscribe token), then the notifications service (detection → idempotent send), then the cron and unsubscribe HTTP routes, then the admin API and UI, and finally end-to-end verification.

## Task Dependency Graph

```
1. Migration (schema + seeds)
        │
        ├────────────► 2. Template renderer (pure) ─┐
        │                                            │
        ├────────────► 3. Unsubscribe token (pure) ─┤
        │                                            │
        └────────────► 4. Service: detection/recipients/rules
                                   │
                                   ▼
                          5. Service: claim-before-send idempotency
                                   │
                                   ▼
                          6. Unsubscribe link in send path  (needs 3)
                                   │
                                   ▼
                          7. Cron route  ──► 8. vercel.json
                                   │
                                   ▼
                          9. Unsubscribe route  (needs 3)
                                   │
                                   ▼
                          10. Admin API
                                   │
                                   ▼
                          11. Admin page  (needs 2 for preview)
                                   │
                                   ▼
                          12. Env var docs
                                   │
                                   ▼
                          13. End-to-end verification (needs all)
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3"] },
    { "wave": 3, "tasks": ["4"] },
    { "wave": 4, "tasks": ["5"] },
    { "wave": 5, "tasks": ["6"] },
    { "wave": 6, "tasks": ["7"] },
    { "wave": 7, "tasks": ["8", "9"] },
    { "wave": 8, "tasks": ["10"] },
    { "wave": 9, "tasks": ["11"] },
    { "wave": 10, "tasks": ["12"] },
    { "wave": 11, "tasks": ["13"] }
  ]
}
```

- Tasks **2** and **3** are pure helpers and can be done in parallel once the migration exists (2 informs the renderer used by 5/6/11; 3 is used by 6 and 9).
- Task **5** depends on **4** (same service module); **6** depends on **3** and **5**.
- Everything converges on **13**, the verification task.

## Tasks

- [x] 1. Create the notifications schema migration
  - Add `supabase/migrations/012_initiative_notifications.sql` following the existing migration style (`uuid_generate_v4()` PKs, `TIMESTAMPTZ ... DEFAULT now()`, `CHECK` enums).
  - Create `notification_rules` as a keyed singleton: `id TEXT PRIMARY KEY DEFAULT 'global' CHECK (id = 'global')`, `enabled BOOLEAN NOT NULL DEFAULT TRUE`, `lead_times INT[] NOT NULL DEFAULT '{7,2,1}'`, `recipient_rule TEXT NOT NULL DEFAULT 'owners_operators' CHECK (recipient_rule IN ('all','owners_operators'))`, `template_key TEXT NOT NULL DEFAULT 'initiative_reminder' REFERENCES email_templates(key)`, plus `updated_by`, `created_at`, `updated_at`.
  - Create `email_templates` (`key` PK, `subject`, `body_html`, `active BOOLEAN NOT NULL DEFAULT TRUE`, `updated_by`, timestamps).
  - Create `notification_log` with `initiative_id`/`recipient_user_id`/`recipient_email`, `date_field CHECK (date_field IN ('activation_date','event_date'))`, `lead_days`, `trigger_date`, `status CHECK (status IN ('pending','sent','failed'))`, `provider_message_id`, `error`, the `CONSTRAINT uq_notification_offset_recipient UNIQUE (initiative_id, date_field, lead_days, recipient_user_id)`, and indexes on `initiative_id`, `created_at DESC`, and `status`.
  - Create `notification_opt_outs` (`user_id` PK referencing `profiles(id)`, `category TEXT NOT NULL DEFAULT 'initiative_reminder'`, `created_at`). Enable RLS on all four tables (service-role writes) and seed the `'global'` rules row and the default `initiative_reminder` template row.
  - _Requirements: 2.1, 2.7, 3.1, 5.4, 7.1, 7.4_

- [x] 2. Implement the pure template renderer
  - Add `src/lib/notifications/render.ts` exporting `renderTemplate(tpl, vars)` returning `{ subject, html }`, supporting `{{firstName}}`, `{{initiativeName}}`, `{{channel}}`, `{{daysUntil}}`, `{{activationDate}}`.
  - Apply safe fallbacks for null/missing values (`firstName → "there"`, `initiativeName → "your initiative"`, `channel → "initiative"`, `activationDate → "soon"`), HTML-escape every interpolated value (`& < > " '`) for injection safety, and replace any unknown `{{...}}` placeholder with an empty string.
  - Define a built-in default subject/body constant and fall back to it when `tpl` is null or rendering throws.
  - Write unit tests covering all five variables, fallbacks with no leftover placeholders, `<script>` escaping, and default fallback on null/invalid template.
  - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 3. Implement the unsubscribe token helper
  - Add HMAC-SHA256 `generate`/`verify` helpers over payload `${userId}:${category}` using `NOTIFICATIONS_TOKEN_SECRET`, token format `base64url(payload) + "." + base64url(sig)`.
  - Use a constant-time comparison on verify; reject tokens whose recomputed signature does not match (tampered id fails).
  - Write unit tests for a round-trip verify success and a mutated-id verify failure.
  - _Requirements: 5.1_

- [x] 4. Build the notifications service core (detection + recipients + rules)
  - Add `src/services/notifications.service.ts` using the service-role Supabase client, with the `RunSummary` interface and exported `runInitiativeReminders(today?)`.
  - Implement `loadRules()` (read the `'global'` `notification_rules` row or return coded safe defaults; early-return an all-zero summary with `enabled: false` when disabled).
  - Implement `detectEligible(rules, today)`: for each deduped positive lead time `L` and each `date_field` in (`activation_date`,`event_date`), select initiatives with `status IN ('planned','in_progress','launched')`, `<date_field> = today + L days`, `<date_field> IS NOT NULL`, joining `initiative_types` for `channel`.
  - Implement `resolveRecipients(companyId, rule)`: select `profiles` by `company_id`, apply the recipient rule (`all` vs `owners_operators` role filter), drop null/empty emails, and exclude `notification_opt_outs`.
  - Write unit tests for detection date math (Req 1.1/1.2/1.4), status filter (Req 1.3), and recipient rule + email filtering (Req 4.2/4.3).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.4, 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5. Implement the claim-before-send idempotency path in the service
  - Add `claimAndSend(offset, recipient, rendered)`: INSERT a `notification_log` row with `status='pending'`; treat a unique-violation as *skipped* (already `sent`/`pending`) rather than an error.
  - Render per recipient, call `sendEmail(...)`, then UPDATE the row to `status='sent'` with `provider_message_id` on success, or `status='failed'` with `error` when `sendEmail` returns `null` or a send throws.
  - Add the retry path for `failed` and stale-`pending` (older than ~1 hour) rows via a conditional `UPDATE ... SET status='pending' ... RETURNING id` so only the single winner proceeds to send.
  - Wire `runInitiativeReminders` to iterate detected offsets × recipients with per-recipient try/catch, accumulate `{ attempted, sent, skipped, failed, errors[] }`, and return the summary.
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 8.1, 8.2, 8.3, 8.5_

- [x] 6. Build the unsubscribe link into the send path
  - When rendering each recipient's email, generate the token (task 3) and build an absolute unsubscribe URL via `absoluteUrl("/api/notifications/unsubscribe?token=" + token)`.
  - Ensure the rendered email body includes the unsubscribe link for every send.
  - _Requirements: 5.1_

- [x] 7. Add the secured cron route
  - Add `src/app/api/cron/initiative-reminders/route.ts` with `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.
  - Check `Authorization: Bearer ${process.env.CRON_SECRET}`; on missing/invalid secret return HTTP 401 with no body detail (no disclosure of whether initiatives exist).
  - On valid auth, call `runInitiativeReminders()`, `console.log` the summary, and return it as JSON.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 8.4_

- [x] 8. Add the Vercel cron schedule
  - Create `vercel.json` at the repo root with a `crons` entry `{ "path": "/api/cron/initiative-reminders", "schedule": "0 13 * * *" }`.
  - _Requirements: 1.6_

- [x] 9. Add the unsubscribe route
  - Add `src/app/api/notifications/unsubscribe/route.ts` (`GET`, no login required) that reads `token`, verifies it with the token helper (task 3).
  - On a valid token, upsert `notification_opt_outs (user_id, category)` via the service-role client and render a simple confirmation page (idempotent on repeat clicks).
  - On an invalid/tampered token, render a neutral page and write nothing.
  - _Requirements: 5.2, 5.3, 5.5_

- [x] 10. Add the admin notifications API
  - Add `src/app/api/admin/notifications/route.ts` guarded by `requireAdmin()` (`if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })`).
  - `GET`: return the current `notification_rules` (or coded defaults if absent) plus the selected `email_templates` row via the service-role client.
  - `PUT`: validate `enabled` (bool), `lead_times` (array of positive ints), `recipient_rule` (enum), and template `subject`/`body_html`; persist to the database and stamp `updated_by = check.userId` and `updated_at`.
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_

- [x] 11. Build the admin notifications page
  - Add `src/app/(admin)/admin/notifications/page.tsx` matching the existing admin page layout, loading all state from `GET /api/admin/notifications`.
  - Provide a global enabled toggle, a lead-times editor (add/remove day values), a recipient-rule picker ("All company users" vs "Owners & operators only"), and a template editor (subject + HTML body) with a variable palette and a live preview using the same `renderTemplate` function.
  - Save via `PUT /api/admin/notifications`; never read or write `localStorage`.
  - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 7.1, 7.2_

- [x] 12. Document the new environment variables
  - Add `CRON_SECRET` and `NOTIFICATIONS_TOKEN_SECRET` to `.env.local.example` with brief comments, and note them in the relevant setup docs.
  - _Requirements: 6.4_

- [x] 13. End-to-end verification and QA
  - Seed a company + profile (valid email) + one eligible initiative dated `today + 2` whose `initiative_type` has a channel, with `notification_rules.enabled = true` and `lead_times` including 2.
  - Invoke the cron over HTTP with the secret and assert one `notification_log` `sent` row for `(initiative,'activation_date',2,recipient)` with a `provider_message_id` and summary `sent = 1`; invoke again and assert no duplicate (`skipped`, `sent = 0`).
  - Add an opt-out (row or a valid unsubscribe URL hit with no session) and assert the recipient is excluded and an opt-out row exists; call cron with a bad/missing secret and assert HTTP 401 with no new `notification_log` rows.
  - Clean up all seeded data, then run `npx next build`, confirm clean TypeScript, and confirm no increase in the existing ESLint error count.
  - _Requirements: 1.1, 1.5, 3.2, 3.3, 3.4, 5.2, 5.3, 5.5, 6.1, 6.3, 8.4_

## Notes

- Two new environment variables must be set before this works in production: `CRON_SECRET` (secures the cron endpoint) and `NOTIFICATIONS_TOKEN_SECRET` (signs unsubscribe tokens). Existing `MAILGUN_*` and app-URL vars are reused.
- No test framework is wired up; verification (task 13) is empirical — real HTTP calls to the cron/unsubscribe endpoints plus SQL assertions against Supabase, on seeded throwaway data that is cleaned up afterward.
- Destructive or email-sending steps run only against seeded test data; the cron endpoint is bearer-secured so it cannot be triggered publicly.
- "Days until" is anchored to UTC to match the 13:00 UTC cron schedule; revisit if per-timezone accuracy is later required.
