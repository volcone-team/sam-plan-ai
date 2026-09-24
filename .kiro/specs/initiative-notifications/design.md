# Initiative Notifications — Design

## Overview

This feature adds automatic, date-triggered initiative reminder emails to SAM Plan AI. A daily scheduled job scans initiatives and, when an initiative's trigger date (`activation_date` or `event_date`) is a configured number of days away, emails the relevant company users — for example, "Your webinar 'Q4 Flagship' goes live in 2 days."

Sending is fully automatic and driven by initiative dates. The admin panel does **not** compose or send messages on demand; it only configures the rules that govern automatic sending: whether reminders are on, the lead times (how many days ahead they fire), who receives them, and the email template used (Req 2).

The design is grounded in the existing stack:

- **Runtime/host:** Next.js 16 (App Router) on Vercel, Node runtime for API routes.
- **Data:** Supabase Postgres. Server routes use `createServerClient` (`@supabase/ssr`) for auth-context reads and a service-role `createClient` (`@supabase/supabase-js`) for privileged reads/writes. The cron endpoint has no user session, so it uses the service-role client exclusively — the same pattern already used by `src/app/api/admin/stats/route.ts`.
- **Email:** `sendEmail(options)` from `src/lib/mailgun.ts`, which returns a Mailgun message id on success and `null` on failure. This feature introduces its own DB-backed template + renderer and does **not** depend on the hardcoded `sendPlanReadyEmail`/`sendTaskReminderEmail` helpers (those are superseded for this feature).
- **URLs:** `getAppUrl()` / `absoluteUrl(path)` from `src/lib/app-url.ts` build absolute unsubscribe links that resolve correctly in local, preview, and production environments.
- **Admin auth:** `requireAdmin()` from `@/lib/require-admin` guards admin API routes (`const check = await requireAdmin(); if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })`).

Four requirement themes drive the design: correctness of detection (Req 1), DB-backed admin control (Req 2, 7), exactly-once delivery under retries/concurrency (Req 3), correct recipient resolution with legally-required opt-out (Req 4, 5), a secured scheduler (Req 6), and resilient, observable batch execution (Req 8).

## Architecture

### Moving parts

```
                    Vercel Cron (daily, 13:00 UTC)
                              │  Authorization: Bearer <CRON_SECRET>
                              ▼
        GET /api/cron/initiative-reminders   ── authorize (CRON_SECRET) ─┐
                              │                                          │ 401 if invalid
                              ▼                                          ▼ (no email sent, Req 6)
              notifications service (service-role Supabase client)
                              │
        ┌─────────────────────┼───────────────────────────────────┐
        ▼                     ▼                                     ▼
  load rules            detect eligible                     render template
  (notification_rules)  (initiatives × lead times ×          (email_templates
   defaults if none)     date fields, join initiative_types)   + built-in default)
        │                     │                                     │
        └──────────► resolve recipients (profiles by company + recipient_rule,
                        drop missing email, drop opt-outs) ◄────────┘
                              │
                              ▼
              per (initiative, date_field, lead_days, recipient):
                 1. INSERT notification_log (UNIQUE) → conflict? skip (already sent)
                 2. sendEmail(...)  →  null? mark failed (retryable)
                 3. UPDATE log row status = sent + provider_message_id
                              │
                              ▼
                  run summary { attempted, sent, skipped, failed }  (Req 8.4)


  GET /api/notifications/unsubscribe?token=...   (no login, Req 5.5)
        └─► verify HMAC token → record opt-out → confirmation page

  /admin/notifications (page)  ──►  /api/admin/notifications (GET/PUT, requireAdmin)
        └─► toggle enabled, edit lead times, recipient rule, template (DB, not localStorage — Req 2.2/2.3)
```

### Send flow and idempotency ordering (Req 3)

The single most important ordering decision is that the **log row is written before the email is sent**, and the database's UNIQUE constraint — not application logic — is what guarantees at-most-once delivery.

For each `(initiative_id, date_field, lead_days, recipient_user_id)` combination:

1. **Claim** the send by inserting a `notification_log` row with `status = 'pending'`. The UNIQUE constraint on `(initiative_id, date_field, lead_days, recipient_user_id)` means a duplicate or concurrent run trying to claim the same combination gets a unique-violation. We treat that violation as **"already handled by someone else"**:
   - If an existing row is `sent` or `pending`, skip (counts as *skipped*). This satisfies Req 3.2, 3.3, 3.4 — a second same-day invocation, a retry, or two overlapping invocations cannot double-send, because only one INSERT can win the row.
   - If an existing row is `failed`, the combination is eligible for retry (see step 4).
2. **Render** the email for this recipient (Section "Template rendering").
3. **Send** via `sendEmail(...)`.
4. **Finalize**:
   - On success (message id returned): `UPDATE ... SET status='sent', provider_message_id=<id>` (counts as *sent*).
   - On failure (`sendEmail` returns `null`, or an exception is thrown): `UPDATE ... SET status='failed', error=<message>` (counts as *failed*). A failed row is **not** a successful send, so a later run may retry it (Req 3.5, 8.3). We deliberately do not leave the row as `pending` forever: a stuck `pending` older than a threshold (e.g. 1 hour) is treated the same as `failed` and is retry-eligible, so a crash between claim and finalize cannot permanently block a reminder.

Why claim-before-send rather than send-then-log: if we sent first and only logged afterward, a crash between send and log would let the next run resend (duplicate). Claiming first makes the DB the source of truth for "this reminder is spoken for," and the UNIQUE constraint makes the claim atomic across concurrent invocations.

Retry semantics for `failed`/stale-`pending`: rather than `INSERT` (which the UNIQUE row now blocks), the retry path does a conditional `UPDATE ... SET status='pending' WHERE status IN ('failed') OR (status='pending' AND created_at < now()-interval '1 hour') RETURNING id`. Only a run whose UPDATE returns a row proceeds to send, so retries are also single-winner.

### Recipient resolution (Req 4)

For each eligible initiative the service resolves `initiatives.company_id`, then selects `profiles` with that `company_id`. The admin-configured `recipient_rule` filters the set:

- `all` → every profile in the company.
- `owners_operators` → profiles whose `role` is `owner` or `operator`.

Recipients with a null/empty `email` are dropped (Req 4.3). Recipients present in the opt-out set are dropped (Req 4.4, 5.3). If no recipients remain, the initiative is silently skipped with no email and no error (Req 4.5).

## Data Models

New migration file: `supabase/migrations/012_initiative_notifications.sql` (latest existing is `011_generation_events.sql`, so this feature starts at `012_`). All new tables follow the existing migration style: `uuid_generate_v4()` primary keys, `TIMESTAMPTZ ... DEFAULT now()`, `CHECK` constraints for enums, and RLS enabled with service-role writes and admin reads (mirroring `011_generation_events.sql` and `002_rls_policies.sql`).

### `notification_rules` — global admin config (Req 2)

Notification rules are **global** (one configuration governs sending for all companies), so this is a singleton table. To make "there is exactly one row" enforceable and the read trivial, we use a fixed-key singleton: a `id` column constrained to a single sentinel value so a second row cannot be inserted.

```sql
CREATE TABLE IF NOT EXISTS notification_rules (
  id            TEXT PRIMARY KEY DEFAULT 'global'
                  CHECK (id = 'global'),          -- singleton: only one row can exist
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,     -- global on/off (Req 2.1, 2.4)
  lead_times    INT[]   NOT NULL DEFAULT '{7,2,1}',-- days ahead; supports multiple (Req 1.4, 2.1)
  recipient_rule TEXT   NOT NULL DEFAULT 'owners_operators'
                  CHECK (recipient_rule IN ('all','owners_operators')),  -- Req 2.5, 4.2
  template_key  TEXT    NOT NULL DEFAULT 'initiative_reminder'
                  REFERENCES email_templates(key), -- selected template (Req 2.6)
  updated_by    UUID    REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Why a keyed singleton over a general key/value settings table: the rules are a small, fixed, strongly-typed set (a bool, an int array, two enums), so a typed single row gives us column-level `CHECK` validation and a one-statement read. The `CHECK (id = 'global')` plus the primary key makes "single row" a database invariant, not an application convention.

**Safe defaults (Req 2.7):** the column defaults above *are* the safe defaults (`enabled = true`, `lead_times = {7,2,1}`, `recipient_rule = 'owners_operators'`, `template_key = 'initiative_reminder'`). The service also treats a completely absent row as "use defaults" so the feature behaves predictably before any admin ever opens the page. A seed insert of the `'global'` row ships with the migration.

### `email_templates` — editable template (Req 7)

```sql
CREATE TABLE IF NOT EXISTS email_templates (
  key         TEXT PRIMARY KEY,                    -- e.g. 'initiative_reminder'
  subject     TEXT NOT NULL,                        -- may contain {{variables}}
  body_html   TEXT NOT NULL,                        -- may contain {{variables}}
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Templates store raw text with `{{variable}}` placeholders. **Interpolation happens at render time**, per-recipient, inside the notifications service — the table never stores rendered output. The migration seeds one `initiative_reminder` row so a template always exists; if the row is missing or `active = false`, the renderer falls back to the built-in default (Req 7.4, 7.5).

### `notification_log` — idempotency + audit (Req 3, 8)

This is the heart of the exactly-once guarantee.

```sql
CREATE TABLE IF NOT EXISTS notification_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  initiative_id       UUID NOT NULL REFERENCES initiatives(id) ON DELETE CASCADE,
  recipient_user_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  recipient_email     TEXT NOT NULL,                 -- snapshot of the address actually used
  date_field          TEXT NOT NULL
                        CHECK (date_field IN ('activation_date','event_date')),
  lead_days           INT  NOT NULL,                  -- the lead time this send is for
  trigger_date        DATE NOT NULL,                  -- the date being counted down to
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sent','failed')),
  provider_message_id TEXT,                            -- Mailgun id on success
  error               TEXT,                            -- failure detail (Req 8.2)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- THE idempotency mechanism (Req 3.1, 3.2, 3.3, 3.4):
  CONSTRAINT uq_notification_offset_recipient
    UNIQUE (initiative_id, date_field, lead_days, recipient_user_id)
);

CREATE INDEX IF NOT EXISTS idx_notification_log_initiative ON notification_log(initiative_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_log_status ON notification_log(status);
```

The **`UNIQUE (initiative_id, date_field, lead_days, recipient_user_id)` constraint is the idempotency mechanism.** A "reminder offset" from the requirements is exactly the `(date_field, lead_days)` pair, and the recipient is `recipient_user_id`; the combination with `initiative_id` is what must be sent at most once (Req 3.1). Because the claim step INSERTs this row before sending, two concurrent or repeated runs racing on the same combination cannot both succeed — Postgres rejects the second INSERT with a unique violation, which the service reads as "already claimed/sent" and skips (Req 3.3, 3.4). A failed send leaves `status = 'failed'` (not removed), so the audit trail is complete (Req 8.2) and the retry path can re-arm it (Req 3.5).

Note we key on `recipient_user_id` (stable identity) rather than email, and separately snapshot `recipient_email` for audit; this means a user changing their email later cannot cause a resend of an already-sent offset.

### `notification_opt_outs` — unsubscribe state (Req 5)

We use a dedicated table rather than a column on `profiles`, for three reasons: (1) opt-out is conceptually a notifications concern, not a core profile attribute; (2) a table lets us record `created_at` (when they unsubscribed) and later extend to per-category opt-outs without a schema change; (3) it keeps the migration additive and avoids touching the heavily-RLS'd `profiles` table. Requirement 5.4 explicitly requires being able to record opt-out for a user with no pre-existing preferences record — a table with "row present = opted out" satisfies that directly.

```sql
CREATE TABLE IF NOT EXISTS notification_opt_outs (
  user_id     UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  category    TEXT NOT NULL DEFAULT 'initiative_reminder',  -- room for future categories
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Presence of a row means opted out (Req 5.2, 5.3). The unsubscribe endpoint upserts this row; the recipient resolver left-excludes it.

### RLS considerations

Consistent with `011_generation_events.sql` and the existing conventions: enable RLS on all four tables. **All writes go through the service-role client** (cron endpoint, unsubscribe endpoint, admin API) which bypasses RLS, so no write policies for end users are needed.

- `notification_rules`, `email_templates`: enable RLS; admins read via the service-role client in the admin API (like `admin/stats`). Optionally add an authenticated `SELECT` policy gated on `is_admin()` (the existing helper) if these are ever read from a browser session; the admin page here reads through the service-role API route, so no browser-side policy is strictly required.
- `notification_log`: enable RLS. Optional read policy mirroring `generation_events` ("members can view own company's log" via `initiative_id -> initiatives.company_id -> profiles`) if the log is ever surfaced in-app; not required for the cron path, which uses the service role.
- `notification_opt_outs`: enable RLS. The unsubscribe flow writes with the service role (the user is not logged in — Req 5.5), so no user write policy is granted; an optional `SELECT`/`DELETE` policy `USING (user_id = auth.uid())` lets a logged-in user manage their own opt-out from settings later.

## Components and Interfaces

### 1. Cron route — `GET /api/cron/initiative-reminders` (Req 1, 6)

Node-runtime App Router route handler. Responsibilities: authorize, then delegate the whole batch to the notifications service and return the run summary.

```ts
// src/app/api/cron/initiative-reminders/route.ts
export const runtime = "nodejs";           // needs service-role key + Buffer/crypto
export const dynamic = "force-dynamic";     // never cached

export async function GET(req: Request) {
  // Authorization (Req 6): Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    // Non-2xx, no body detail — do not disclose whether initiatives exist (Req 6.3).
    return new Response("Unauthorized", { status: 401 });
  }
  const summary = await runInitiativeReminders(); // notifications service
  console.log("[cron/initiative-reminders]", JSON.stringify(summary));
  return Response.json(summary); // { attempted, sent, skipped, failed, ... } (Req 8.4)
}
```

- The secret comes from `process.env.CRON_SECRET` — never hardcoded (Req 6.4).
- Invalid/missing auth → 401, no email sent, no disclosure (Req 6.1, 6.3).
- Valid auth → detection + sending proceeds (Req 6.2).

**Scheduling (`vercel.json`, new file at repo root — none exists today):**

```json
{
  "crons": [
    { "path": "/api/cron/initiative-reminders", "schedule": "0 13 * * *" }
  ]
}
```

Daily at 13:00 UTC. On Vercel, cron invocations automatically carry the `Authorization: Bearer <CRON_SECRET>` header when `CRON_SECRET` is set as a project env var, which is exactly what the route checks. (Vercel Cron issues an HTTP GET to the path; the schedule uses standard cron syntax.)

**Local / manual invocation for testing:** because auth is a plain bearer check, the endpoint can be invoked over HTTP with the secret, no Vercel needed:

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/initiative-reminders
```

An unauthorized probe (omit the header) must return 401 and send nothing.

### 2. Notifications service — `src/services/notifications.service.ts`

The batch orchestrator, callable by the cron route (and directly in tests). Uses the service-role Supabase client (no user session in cron context). Pure-ish core so detection/rendering can be unit-tested without a live DB.

```ts
interface RunSummary {
  ranAt: string;
  enabled: boolean;
  attempted: number;   // recipient-offsets we tried to claim
  sent: number;        // successful sends
  skipped: number;     // already-claimed/sent (idempotency) or no recipients
  failed: number;      // sendEmail null or thrown
  errors: { initiativeId: string; recipient: string; message: string }[];
}

export async function runInitiativeReminders(today?: Date): Promise<RunSummary>;
```

Internal helpers (each independently testable):

- `loadRules()` → reads `notification_rules` (the `'global'` row) or returns coded safe defaults when absent (Req 2.7). If `enabled === false`, the service returns early with `sent: 0` and sends nothing (Req 2.4).
- `detectEligible(rules, today)` → the detection algorithm below (Req 1).
- `resolveRecipients(companyId, rule)` → profiles filtered by recipient rule, valid email, and opt-out (Req 4).
- `renderTemplate(template, vars)` → safe interpolation with fallback (Req 7).
- `claimAndSend(offset, recipient, rendered)` → the idempotent claim → send → finalize sequence (Req 3, 8).

**Detection algorithm (Req 1):**

```
today := (today ?? now) as a DATE in the app's reference timezone
rules := loadRules()
if not rules.enabled: return summary(enabled=false, all zero)   // Req 2.4

eligibleStatuses := ('planned','in_progress','launched')        // Req 1.3
for each L in rules.lead_times (deduped, positive ints):        // Req 1.4
  targetDate := today + L days
  for each dateField in ('activation_date','event_date'):       // Req 1.2
     rows := SELECT i.*, it.channel
             FROM initiatives i
             JOIN initiative_types it ON it.id = i.initiative_type_id
             WHERE i.status IN eligibleStatuses
               AND i.<dateField> = targetDate                   // exactly L days out (Req 1.1)
               AND i.<dateField> IS NOT NULL                    // skips null event_date (Req 1.2)
     for each initiative in rows:
        recipients := resolveRecipients(initiative.company_id, rules.recipient_rule)
        if recipients is empty: continue (skip, no error)        // Req 4.5
        rendered := render per recipient
        for each recipient: claimAndSend((initiative, dateField, L), recipient, rendered)
```

- `activation_date` is `NOT NULL`, so it always participates; `event_date` is nullable and the `IS NOT NULL` predicate skips its reminder while `activation_date` is still evaluated for the same initiative (Req 1.2).
- Statuses `completed`, `paused`, `retired` (and any archived) are excluded by the `IN` list (Req 1.3).
- If nothing matches any lead time, every loop body is empty and the run completes with zero sends and no error (Req 1.5).
- Comparing a `DATE` column to `today + L days` means "exactly L days in the future" regardless of time-of-day; anchoring `today` to a single reference timezone (documented; UTC by default to match the 13:00 UTC cron) keeps "days until" stable across a run.

### 3. Template renderer (Req 7)

A pure function in the service (or `src/lib/notifications/render.ts`):

```ts
interface TemplateVars {
  firstName?: string | null;
  initiativeName?: string | null;
  channel?: string | null;
  daysUntil?: number | null;
  activationDate?: string | null; // preformatted date string or ISO
}

function renderTemplate(
  tpl: { subject: string; body_html: string } | null,
  vars: TemplateVars
): { subject: string; html: string };
```

Behavior:

- Supported variables: `{{firstName}}`, `{{initiativeName}}`, `{{channel}}`, `{{daysUntil}}`, `{{activationDate}}` (Req 7.2). `{{channel}}` is populated from `initiative_types.channel` via the join (Req 7.6).
- **Safe fallbacks (Req 7.3):** missing/null values resolve to sensible defaults — `firstName → "there"`, `initiativeName → "your initiative"`, `channel → "initiative"`, `daysUntil → the computed integer` (always present from the lead time), `activationDate → formatted trigger date or "soon"`. No unresolved `{{placeholder}}` is ever emitted and a missing value never fails the send.
- **HTML-escaping (injection safety):** every interpolated value is HTML-escaped (`& < > " '`) before substitution, so an admin-authored template cannot inject markup/script through a value (e.g. an initiative name containing `<script>`). The template body itself is admin-authored HTML and is trusted as layout; only the *interpolated values* are escaped.
- **Unknown placeholders:** any `{{foo}}` not in the supported set is replaced with an empty string (never left raw).
- **Built-in default fallback (Req 7.4, 7.5):** if no active template row exists, or if rendering throws for any reason (malformed template, etc.), the renderer falls back to a hardcoded default subject/body baked into the module so a reminder still goes out with correct content rather than broken content or a skipped batch.

### 4. Unsubscribe route — `GET /api/notifications/unsubscribe?token=...` (Req 5)

No login required (Req 5.5). The link carries a signed, opaque token rather than a raw user id so it cannot be forged or enumerated.

**Token generation/verification (HMAC):**

```ts
// payload = `${userId}:${category}`  (category e.g. "initiative_reminder")
// sig = base64url(HMAC_SHA256(payload, process.env.NOTIFICATIONS_TOKEN_SECRET))
// token = base64url(payload) + "." + sig
```

- Generated when building each email's unsubscribe link, using `absoluteUrl("/api/notifications/unsubscribe?token=" + token)` (Req 5.1).
- Verification recomputes the HMAC over the decoded payload and compares with a constant-time equality check. A tampered id yields a different signature and is rejected — links can't be forged and user ids can't be enumerated because the raw id alone is useless without the secret. The secret lives in an env var, never in source.
- On valid token: upsert `notification_opt_outs (user_id, category)` via the service-role client (works with no session — Req 5.4, 5.5), then render a simple confirmation page ("You've been unsubscribed from initiative reminders"). Idempotent: clicking twice is fine.
- On invalid/expired token: render a neutral page and record nothing.

### 5. Admin API — `GET`/`PUT /api/admin/notifications` (Req 2)

Guarded by `requireAdmin()` exactly like `admin/stats`:

```ts
const check = await requireAdmin();
if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
```

- `GET` → returns the current `notification_rules` (or coded defaults if the row is absent) plus the selected `email_templates` row, read via the service-role client.
- `PUT` → validates and persists `enabled`, `lead_times` (array of positive ints), `recipient_rule` (enum), and the template `subject`/`body_html`; stamps `updated_by = check.userId` and `updated_at`. Writes go to the **database** (Req 2.2). Nothing is stored in `localStorage` or any per-browser storage (Req 2.3).

### 6. Admin page — `src/app/(admin)/admin/notifications/page.tsx` (Req 2)

New page under the existing `src/app/(admin)/admin/` group, matching the layout of the other admin pages (settings, content, questionnaire). Controls:

- Global **enabled** toggle (Req 2.1, 2.4).
- **Lead times** editor (add/remove day values, e.g. 7, 2, 1) (Req 1.4, 2.1).
- **Recipient rule** picker: "All company users" vs "Owners & operators only" (Req 2.5).
- **Template editor:** subject + HTML body fields, a **variable palette** listing the supported `{{...}}` variables for one-click insertion, and a **live preview** that renders the template with sample values using the same `renderTemplate` function the sender uses (Req 2.6, 7).
- **Save** calls `PUT /api/admin/notifications`. All state loads from and saves to the DB through the API — explicitly **not** localStorage (Req 2.3).

## Error Handling

Resilience is per-recipient, so one bad address never stops the batch (Req 8.1).

- **Per-recipient try/catch:** `claimAndSend` wraps rendering + send + finalize in a try/catch. Any thrown error is caught, recorded on the log row as `status='failed'` with the message in `error`, counted in the summary's `failed`, and the loop continues to the next recipient/initiative (Req 8.1, 8.2, 8.3).
- **Transport failure is a failure, not a success:** `sendEmail` returning `null` is treated exactly like a thrown error — the log row is marked `failed` (never `sent`), so the offset stays retryable on a future run (Req 8.5, 3.5).
- **Claim conflict is not an error:** a unique-violation on the claim INSERT is expected under retries/concurrency; it is caught and counted as `skipped`, not `failed` (Req 3.2–3.4).
- **Rendering errors** fall back to the built-in default template rather than aborting (Req 7.5); only if even the default render throws is the recipient counted `failed`.
- **Rules disabled / no matches / no recipients:** all complete cleanly with zero sends and no thrown error (Req 1.5, 2.4, 4.5).
- **Missing config** (`MAILGUN_*` unset): `sendEmail` already returns `null` and logs; the batch records failures and continues rather than crashing.
- **Run summary** `{ attempted, sent, skipped, failed, errors[] }` is returned from the endpoint and `console.log`-ged for monitoring (Req 8.4). Because Vercel captures function logs, this is the observability surface without new infrastructure.

## Testing Strategy

There is no CI/test framework wired up for this app yet, so verification is primarily **empirical** — real HTTP probes against the running app plus SQL assertions against Supabase — supplemented by unit tests for the pure functions. Each test references the requirement it validates.

### Unit tests (pure functions, no DB)

- **Detection date math** (Req 1.1, 1.2, 1.4): given a fixed `today`, an initiative with `activation_date = today + 2` matches lead time 2 but not 7; an initiative with `event_date = null` produces no `event_date` offset but still yields its `activation_date` offset; multiple lead times each produce their own offset.
- **Status filter** (Req 1.3): initiatives with `completed`/`paused`/`retired` are excluded; `planned`/`in_progress`/`launched` are included.
- **Template renderer** (Req 7.2, 7.3): all five variables interpolate; null/missing values produce fallbacks with no leftover `{{...}}`; a value containing `<script>` comes out HTML-escaped (injection prevented); a null/invalid template falls back to the built-in default.
- **Recipient rule** (Req 4.2, 4.3): `owners_operators` excludes `team_member`/`viewer`; profiles with empty email are dropped.
- **Token round-trip** (Req 5): a generated token verifies for the right user; a token with a mutated id fails verification.

### Empirical / integration tests (HTTP + SQL)

Seed a company with one profile (valid email) and one eligible initiative dated `today + 2` whose `initiative_type` has a channel (e.g. webinar). Configure `notification_rules` with `lead_times` including 2 and `enabled = true`.

1. **Happy path — one attempt logged** (Req 1, 3.1, 8):
   `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/initiative-reminders`.
   Assert: response summary shows `sent = 1`; exactly one `notification_log` row exists for `(initiative, 'activation_date', 2, recipient)` with `status='sent'` and a `provider_message_id`.
2. **Idempotency — invoke twice, no duplicate** (Req 3.2, 3.3, 3.4):
   Invoke the endpoint a second time. Assert: still exactly one `notification_log` row for that combination (second run reports it as `skipped`, `sent = 0`).
3. **Opt-out excluded** (Req 5.2, 5.3): insert a `notification_opt_outs` row for the recipient (or hit the unsubscribe URL with a valid token), reset the log, invoke. Assert: no send, recipient excluded, run completes without error.
4. **Unsubscribe without login** (Req 5.5): `GET /api/notifications/unsubscribe?token=<valid>` with no session returns the confirmation page and creates the opt-out row; a tampered token records nothing.
5. **Unauthorized cron rejected** (Req 6.1, 6.3): invoke the endpoint with no/incorrect `Authorization` header. Assert: HTTP 401, response body reveals nothing about initiatives, and no new `notification_log` rows were created.
6. **Disabled globally** (Req 2.4): set `notification_rules.enabled = false`, invoke. Assert: `sent = 0`, no rows written, no error.
7. **Failed send is retryable** (Req 3.5, 8.5): force `sendEmail` to fail (e.g. unset `MAILGUN_*` in a local run). Assert: the log row is `status='failed'` (not `sent`); a subsequent successful run flips it to `sent` — proving no duplicate and that failures retry.
8. **Batch resilience** (Req 8.1): seed two recipients where one address is invalid. Assert: the run continues, `failed = 1` and `sent = 1`, and the failure detail is recorded on its log row.

After any code lands, run `npx next build` and confirm the new routes compile with no new TypeScript errors. Clean up seeded rows after verification.

## Environment Variables

Set these in Vercel project settings (and `.env.local` for local runs). Existing vars are reused; only the notifications-specific ones are new.

- `CRON_SECRET` — **new.** Bearer secret the cron route checks; Vercel Cron sends it automatically as `Authorization: Bearer <CRON_SECRET>` (Req 6).
- `NOTIFICATIONS_TOKEN_SECRET` — **new.** HMAC secret for signing/verifying unsubscribe tokens (Req 5). Keep distinct from `CRON_SECRET`.
- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`, `MAILGUN_API_URL` — existing; used by `sendEmail` (`src/lib/mailgun.ts`).
- `NEXT_PUBLIC_APP_URL` / `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` — existing; consumed by `getAppUrl()`/`absoluteUrl()` to build correct absolute unsubscribe links per environment.
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — existing; the cron and unsubscribe routes use the service-role client (no user session), matching `admin/stats`.

## Requirements Traceability

| Requirement | Where addressed |
|---|---|
| 1 (scheduled detection) | Cron route + detection algorithm; `vercel.json` daily schedule |
| 2 (admin rules in DB) | `notification_rules`, admin API `PUT`, admin page; no localStorage |
| 3 (idempotent sending) | `notification_log` UNIQUE constraint + claim-before-send ordering |
| 4 (recipient resolution) | `resolveRecipients` (company scope, recipient rule, email, opt-out) |
| 5 (opt-out / unsubscribe) | `notification_opt_outs`, HMAC-token unsubscribe route (no login) |
| 6 (secured endpoint) | `CRON_SECRET` bearer check → 401, no disclosure |
| 7 (editable template) | `email_templates`, `renderTemplate` with escaping + default fallback |
| 8 (observability/resilience) | Per-recipient try/catch, `null`-as-failure, run summary counts |
