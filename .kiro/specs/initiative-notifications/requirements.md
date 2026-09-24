# Requirements Document

## Introduction

This feature adds **automatic, date-triggered initiative reminder emails** to the SAM Plan AI app. The system periodically scans initiatives and, when an initiative's trigger date is a configured number of days away, sends a reminder email to the relevant company users — for example, "Your webinar 'Q4 Flagship' goes live in 2 days."

Sending is fully automatic and driven by initiative dates. The admin panel does **not** compose or manually send messages; it only configures the rules that govern automatic sending: whether notifications are on, how many days ahead they fire, who receives them, and which email template is used.

The app runs on **Next.js 16 deployed to Vercel**, with **Supabase** (PostgreSQL) as the data store and **Mailgun** as the email transport (via `src/lib/mailgun.ts`, which exposes `sendEmail(options)`). The scheduler will be a time-based trigger (recommended: Vercel Cron) that invokes a secured daily endpoint; no scheduler currently exists.

This document defines requirements only. It does not prescribe schema, endpoints, or code. Several implementation choices are deliberately deferred to the design phase (see "Open Decisions for Design").

### Key definitions
- **Trigger date**: an initiative's `activation_date` (required) and/or `event_date` (optional) — the dates that a reminder counts down to.
- **Lead time (N days)**: the number of days before a trigger date that a reminder is sent. Multiple lead times may be active (for example 7, 2, and 1 day).
- **Reminder offset**: a specific (trigger-date-field, lead-time) pairing for an initiative, e.g. "event_date, 2 days ahead."
- **Eligible initiative**: an initiative in a status considered active/upcoming (e.g. planned, in_progress, launched) — explicitly **not** completed, paused, retired, or archived.
- **Channel**: the initiative's type name (webinar, email, referral, etc.), sourced from `initiative_types.channel` via `initiative_type_id`.

### Open Decisions for Design (do not resolve in requirements)
- Scheduler mechanism: **Vercel Cron** (recommended, given the Vercel deploy target) versus Supabase `pg_cron`.
- Exact database schema for notification rules, email template storage, and the send/history log.
- Whether unsubscribe / opt-out is per-notification-type or global.

---

## Requirements

### Requirement 1: Scheduled detection of upcoming initiatives

**User Story:** As a customer, I want the system to automatically notice when one of my initiatives is coming up soon, so that I receive a timely reminder without anyone having to send it manually.

#### Acceptance Criteria

1. WHEN the scheduled job runs THEN the system SHALL evaluate initiatives against the current date and the configured lead time(s) to find any whose trigger date is exactly a configured number of days in the future.
2. The system SHALL evaluate both `activation_date` and `event_date` as trigger dates, and WHEN `event_date` is null THEN the system SHALL skip the `event_date` reminder for that initiative and still evaluate its `activation_date`.
3. The system SHALL only consider eligible initiatives (active/upcoming statuses such as planned, in_progress, launched) and SHALL exclude initiatives whose status is completed, paused, retired, or archived.
4. The number of days ahead (lead time) SHALL be admin-configurable, and the system SHALL support more than one active lead time at once (for example 7, 2, and 1 day before the trigger date).
5. WHEN no eligible initiative matches any active lead time on a given run THEN the system SHALL complete the run without sending any email and without error.
6. The system SHALL run the detection on a recurring daily schedule.

---

### Requirement 2: Admin-tunable notification rules (stored in the database)

**User Story:** As an admin, I want to configure how and when reminders are sent from the admin panel, so that I can control notification behavior for all companies without touching code.

#### Acceptance Criteria

1. The system SHALL provide an admin configuration for notification rules that includes at minimum: a global on/off switch, the lead time(s), the recipient rule, and the selected email template.
2. WHEN an admin saves notification rules THEN the system SHALL persist them in the database so the configuration is shared across all sessions and browsers.
3. The system SHALL NOT store notification rules in `localStorage` or any per-browser client storage.
4. WHEN notifications are globally disabled THEN the scheduled job SHALL send no reminder emails, even if eligible initiatives match a lead time.
5. The system SHALL let the admin choose the recipient rule for reminders (for example: all users in the initiative's company, versus only owners/operators).
6. The system SHALL let the admin select and edit the email template used for reminders (see Requirement 7).
7. WHEN the admin has never configured rules THEN the system SHALL apply safe defaults (a defined default lead-time set, a default recipient rule, and the default template) so the feature behaves predictably before any explicit configuration.

---

### Requirement 3: Idempotent sending (no duplicate emails)

**User Story:** As a customer, I want to receive each reminder only once, so that a re-run or duplicate execution of the scheduled job never floods me with repeated emails.

#### Acceptance Criteria

1. The system SHALL maintain a persistent send-history/log record for every reminder it sends, keyed by the combination of initiative, reminder offset (trigger-date field + lead time), and recipient.
2. WHEN the scheduled job would send a reminder for an (initiative, reminder offset, recipient) combination that already has a successful send record THEN the system SHALL NOT send that email again.
3. WHEN the scheduled endpoint is invoked more than once on the same day (retry, manual re-trigger, or overlapping invocations) THEN the system SHALL send each eligible (initiative, reminder offset, recipient) reminder at most once.
4. The system SHALL record the send-history entry in a way that prevents a concurrent or repeated run from creating a duplicate send for the same (initiative, reminder offset, recipient) combination.
5. WHEN a reminder send fails THEN the system SHALL NOT record it as a successful send, so that a later run may retry it (subject to the failure handling in Requirement 8).

---

### Requirement 4: Recipient resolution by company

**User Story:** As a customer, I want reminders about my company's initiatives to go to the right people at my company, so that the relevant users are informed and unrelated users are not.

#### Acceptance Criteria

1. WHEN the system prepares to send a reminder for an initiative THEN the system SHALL resolve the initiative's company (`company_id`) and select recipients from that company's users (`profiles` with matching `company_id`).
2. The system SHALL apply the admin-configured recipient rule (see Requirement 2.5) when selecting which company users receive the reminder (for example all users versus owners/operators only).
3. The system SHALL only send to recipients who have a valid email address.
4. The system SHALL exclude any recipient who has opted out (see Requirement 5).
5. WHEN no recipients remain after applying the recipient rule and opt-out filtering THEN the system SHALL send no email for that initiative and SHALL complete without error.

---

### Requirement 5: Opt-out / unsubscribe (legal requirement)

**User Story:** As a recipient, I want to unsubscribe from initiative reminders, so that I can stop receiving them, and the app stays compliant with anti-spam and privacy law (CAN-SPAM / GDPR).

#### Acceptance Criteria

1. Every initiative reminder email the system sends SHALL include a working unsubscribe mechanism (for example an unsubscribe link).
2. WHEN a recipient uses the unsubscribe mechanism THEN the system SHALL persist that recipient's opt-out state so it survives future scheduled runs.
3. WHEN the scheduled job resolves recipients THEN the system SHALL exclude every recipient who is currently opted out, and SHALL never send them a reminder.
4. The system SHALL be able to record and honor opt-out state for a user even if that user has no pre-existing notification-preferences record (there is currently no such column or mechanism).
5. The unsubscribe action SHALL NOT require the recipient to be logged in to the app.

---

### Requirement 6: Secured scheduled endpoint

**User Story:** As an operator of the system, I want the scheduled endpoint to reject unauthenticated calls, so that the public cannot trigger initiative emails on demand.

#### Acceptance Criteria

1. WHEN the scheduled endpoint is invoked without valid authorization (for example a missing or incorrect `CRON_SECRET`, or the absence of the expected Vercel cron header) THEN the system SHALL reject the request and SHALL NOT send any email.
2. WHEN the scheduled endpoint is invoked with valid authorization THEN the system SHALL proceed with detection and sending.
3. The system SHALL reject unauthorized requests with an appropriate non-2xx HTTP status and SHALL NOT disclose whether eligible initiatives exist.
4. The authorization secret SHALL be supplied via configuration/environment and SHALL NOT be hardcoded in source.

---

### Requirement 7: Admin-editable email template with safe interpolation

**User Story:** As an admin, I want to edit the reminder email's subject and body with dynamic variables, so that I can tailor the message without a code change and without risk of a broken send.

#### Acceptance Criteria

1. The system SHALL store an editable email template (subject and HTML body) in the database.
2. The system SHALL support variable interpolation in the template, including at minimum: `{{firstName}}`, `{{initiativeName}}`, `{{channel}}`, `{{daysUntil}}`, and `{{activationDate}}`.
3. WHEN the template references a variable that has no value for a given send (for example a missing first name or a null date) THEN the system SHALL substitute a safe fallback and SHALL NOT emit an unresolved placeholder or fail the send.
4. WHEN no template is configured THEN the system SHALL fall back to a built-in default template so that reminders can still be sent.
5. WHEN a configured template is invalid or cannot be rendered THEN the system SHALL fall back to the built-in default template rather than sending broken content or aborting the batch.
6. The `{{channel}}` variable SHALL be populated from the initiative's type (`initiative_types.channel`) so the email can name the initiative type dynamically.

---

### Requirement 8: Observability and resilient failure handling

**User Story:** As an operator, I want a failure sending to one recipient not to stop the whole batch, and I want failures recorded, so that reminders keep flowing and problems can be diagnosed.

#### Acceptance Criteria

1. WHEN sending a reminder to one recipient fails THEN the system SHALL continue processing the remaining recipients and initiatives in the batch.
2. The system SHALL record each send attempt's outcome (success or failure) in the send-history/log, including enough detail to identify the affected initiative, reminder offset, and recipient.
3. WHEN a send fails THEN the system SHALL record the failure and SHALL NOT mark that (initiative, reminder offset, recipient) combination as successfully sent (consistent with Requirement 3.5).
4. WHEN the scheduled run completes THEN the system SHALL produce a summary of the run (for example counts of attempted, sent, skipped-as-already-sent, and failed) suitable for logging or monitoring.
5. The system SHALL treat a transport-layer send failure (for example `sendEmail` returning a null/failed result) as a failed send rather than a success.
