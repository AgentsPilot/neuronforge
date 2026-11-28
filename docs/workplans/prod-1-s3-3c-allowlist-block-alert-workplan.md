# Workplan — PROD-1 S3.3c: admin alert when the allow-list blocks an email

> **Last Updated**: 2026-11-28
> **Requirement**: [PROD_1_S3_3C_ALLOWLIST_BLOCK_ALERT_REQUIREMENT.md](/docs/requirements/PROD_1_S3_3C_ALLOWLIST_BLOCK_ALERT_REQUIREMENT.md)
> **Branch**: `feature/prod-1-s3-3c-allowlist-block-alert`

## Overview

One server-side helper, `lib/email/blockedEmailAlert.ts`, called with one line at
each existing refusal point. No table, migration, cron, audit entity or env var.

---

## Changes

| File | Change |
|---|---|
| `lib/email/blockedEmailAlert.ts` | **New.** `alertBlockedEmail({ source, action, recipients })`: gate (`VERCEL=1` and guard on), per-source 10-minute in-memory throttle, admins from `listAdminEmails()` filtered by the allow-list, masked recipients, one plain email per admin via `sendEmail` (`redactRecipientInLogs`). `AdminAccessService` and the transport are imported lazily (the transport imports this module). Never throws. |
| `lib/notifications/emailTransport.ts` | Refusal: `await alertBlockedEmail(...)` after the existing log line (source `email_transport`, action = consent kind). |
| `lib/server/gmail-plugin-executor.ts` | `allowlistSuppressed` takes the recipients and fires the alert; `send_email` and `reply_to_email` pass them, `send_draft` passes none (unchecked). |
| `lib/server/outlook-plugin-executor.ts` | `send_email`, create/update invitation suppression, and `changeRefused` (update/delete) fire the alert. |
| `lib/server/google-calendar-plugin-executor.ts` | `suppressInvitations` takes the recipients; alerts only when `sendUpdates` was `all`. |
| `lib/plugins/google-mail/sendEmailDraft.ts` | Awaits the alert before its existing throw. |
| `app/api/contact/route.ts` | `mayEmail` takes the recipient and fires the alert. |
| `lib/notifications/recordEmailSend.ts` | `error_message: result.error \|\| result.blocked \|\| null`. |
| Tests | `lib/email/__tests__/blockedEmailAlert.test.ts` (new, helper); `blockedEmailAlert.wiring.test.ts` (new, added by QA: real transport refusal → one masked alert through the provider); `recordEmailSend.test.ts` (+5 cases); G-7 pin for the Google executor 4 → 5 (the `sendUpdates` read, no new send). |

**Why existing suites need no mocks:** the alert is off unless `VERCEL=1`, which
no refusal-driving suite sets, so they reach neither the admin repository nor a
provider.

**console.\*:** none in the touched files.

---

## SA Review Notes

**2026-11-27 — APPROVED WITH CHANGES.** Gate, throttle, admin filter (`listAdminEmails`, never `profiles.role`), lazy-import cycle safety and masking confirmed; recursion is impossible (admins are pre-filtered by the same check the transport runs). Every refusing path is wired; `CalendarSyncService` and `gaps/reply` only consume results that already alerted. `void` fire-and-forget accepted as best-effort; no `waitUntil` (a new pattern for a testing aid). `VERCEL` is already in the Environment catalogue.

| # | Severity | Finding | Outcome |
|---|---|---|---|
| 1 | should-fix | Contact form: both sends shared the `contact_form` throttle key, so a refused team inbox was hidden by a refused confirmation | ✅ Fixed: source is `contact_form_${send}` |
| 2 | nit | No test that the transport calls the alert | ✅ Covered by QA's `blockedEmailAlert.wiring.test.ts` (real transport) |
| 3 | nit | Paths with unchecked recipients (Gmail `send_draft`, Google delete) said "recipient is not on the list … (none listed)" | ✅ Fixed: "Recipients: not checked (…)" and neutral first line |

## QA Testing Report

**2026-11-27 — PASS WITH NOTES.** AC-1..AC-7 all ✅ (R-7 verified by reading the code). No bugs.

| Check | Result |
|---|---|
| Jest: helper, notifications, G-7, plugin executors, contact, sendEmailDraft, CalendarSyncService, gaps/reply, Environment | 22 suites, 580 tests, 0 failed; new wiring suite 4/4 |
| `npm run test:leaks`, per suite (11 suites) | No refused connections |
| `npm run build` (CI placeholder env) | Exit 0, 331/331 pages, no OOM |
| Typecheck of touched files (main session, scoped) | No errors in touched files |

Low notes, accepted: the throttle starts before the send, so a failed admin read silences that source for 10 minutes; `void` alerts can be lost if an instance freezes; the transport awaits the first alert in each window.

**Owed after deploy (needs S3.3b):** set the list on Production with one admin → block a mail to an unlisted address → the admin gets exactly one masked alert; a second block from the same source within 10 minutes sends nothing; the logs carry no full address; a CRM send-log row reads `recipient_not_allowlisted`.

## Commit Info

| Item | Value |
|---|---|
| Feature commit | `55fda814` |
| Merge of `origin/main` | `df671f2b` (clean, no conflicts) |
| PR | [#705](https://github.com/AgentsPilot/neuronforge/pull/705) |

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-27 | Created | Lean rebuild after Barak judged the digest design overkill; the earlier build is kept outside the repo |
| 2026-11-27 | SA + QA | SA approved with changes (1 should-fix, 2 nits, all closed); QA pass with notes |
| 2026-11-28 | RM | Committed, merged `origin/main`, PR #705 opened |
