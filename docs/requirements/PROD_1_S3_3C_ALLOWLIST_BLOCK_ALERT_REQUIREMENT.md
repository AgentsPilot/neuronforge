# PROD-1 S3.3c — Admin alert when the allow-list blocks an email

> **Last Updated**: 2026-11-27
> **Status**: Approved by Barak (lean shape, 2026-11-27)
> **ClickUp**: S3.3c, parent PROD-1. Next: S3.3b (set the allow-list).

## Overview

While the outbound recipient guard is on (`lib/email/recipientAllowList.ts`: any
deployment that is not Vercel production, or production once
`EMAIL_RECIPIENT_ALLOWLIST` is set), a mail to an address that is not on the list
is refused with only a log line. Nobody reads the logs while testing, so "the
email never arrived" is slow to diagnose.

This slice sends the admins a short email when a mail is blocked. It is a
**best-effort testing aid**, not a record or a report.

**Scope decision (Barak, 2026-11-27).** A first build followed the task's original
shape: an audit record per refusal plus an hourly digest cron with a claim table
and migration. Barak judged it overkill for a testing aid and chose this lean
shape instead. It knowingly drops two points from the task description: there is
no audit record, and the alert is sent per block (throttled) rather than as a
periodic digest.

---

## Requirements

| # | Requirement |
|---|---|
| R-1 | When any refusing path blocks a mail, the admins get an email naming the environment, the source (`email_transport`, `gmail`, `outlook`, `google_calendar`, `contact_form_confirmation`, `contact_form_notification`), the action, the refused recipients **masked**, and what to do (add the address or its domain to `EMAIL_RECIPIENT_ALLOWLIST`, or nothing if the block was intended). |
| R-2 | **Only on a Vercel deployment (`VERCEL=1`) while the guard is on.** Real production (guard off) never sends it. Local development has the terminal log and sends nothing; Jest never sets `VERCEL`. |
| R-3 | **Throttled:** at most one alert per source every 10 minutes, per server instance. The email says so. A busy run or the public contact form cannot flood the admins. |
| R-4 | **Masked recipients:** first letter or digit of the local part (only when it is 3+ characters), then `***@domain`. Never a bidi or zero-width character, never the full address, never a hash. At most 10 listed, then "and N more". Allowed recipients in the same send are not listed. |
| R-5 | **Recipients are the admins** (`AdminAccessService.listAdminEmails()`, i.e. `admin_users` plus the bootstrap list, never `profiles.role`), de-duplicated, and **only those on the allow-list**, each checked on its own. If none is on it, nothing is sent and one warn line is logged. This also means the alert can never be refused and cannot alert about itself. |
| R-6 | **Never changes the refusal and never fails the caller.** The helper never throws; failures log a warn line with no address. |
| R-7 | Google Calendar alerts only when Google would actually have emailed someone (`sendUpdates` was `all` before the guard set `none`). |
| R-8 | **Send log keeps the reason:** `recordEmailSend` stores a blocked send's code (e.g. `recipient_not_allowlisted`) in `error_message`; a real error still wins. |

## Acceptance criteria

| # | Criterion |
|---|---|
| AC-1 | Off without `VERCEL=1`, and off on production with the list unset: no admin read, no send. |
| AC-2 | On preview, one blocked send emails each allowed admin once, masked, with environment and source in the subject. |
| AC-3 | Admins not on the allow-list get nothing; with none allowed, nothing is sent and one warn line is logged. |
| AC-4 | A second block from the same source within 10 minutes sends nothing; another source still alerts. |
| AC-5 | An admin-list or send failure never throws. |
| AC-6 | No full recipient address in the alert, the logs or the helper's log lines. |
| AC-7 | A blocked send is stored with its block code in `error_message`. |

## Out of scope

- Any stored record, count, history, digest, cron, table or migration.
- A global (cross-instance) throttle. Several instances may each send one alert.
- Setting the allow-list (S3.3b). S3.3b must include at least one admin address, or the alert is not sent (R-5).
- The existing raw `toEmail`/`subject` log lines in `recordEmailSend.ts` (follow-up).

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-27 | Created | Lean shape chosen by Barak, replacing the audit-record + hourly-digest design |
| 2026-11-27 | SA finding 1 | Contact form uses one source per send, so a refused team inbox is never hidden by a refused confirmation |
