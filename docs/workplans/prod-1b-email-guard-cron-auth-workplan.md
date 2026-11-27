# Workplan: PROD-1b, Non-Production Email Guard and Fail-Closed Cron Auth (A7 + A5)

> **Last Updated**: 2026-11-26

**Developer:** Dev
**Requirement:** Production build-out, Workstream A, items A7 and A5 (the private environments strategy doc, untracked; the approved scope is quoted in section 1)
**Branch:** `fix/prod-1b-email-guard-cron-auth` (created by RM from `origin/main` at `201ff9f3`; confirmed by Dev with `git branch --show-current` before the first edit)
**Baseline read:** `origin/main` at `201ff9f3` (every file:line below is from that commit, read with `git show` / `git grep`, never from a local checkout)
**Date:** 2026-11-25
**Status:** SA code review conditions applied (CR-1 and items 2 to 4); awaiting SA's CR-1 diff re-check, then QA. Not committed

## Overview

Two things in the codebase assume there is only one environment, and both fail open.

**A7 (email).** No outbound email path checks where it is running. The shared transport `lib/notifications/emailTransport.ts` sends to any recipient through whichever provider is configured; the only production check in it (lines 342-345, used at 903-908) refuses a *keyed* send when Resend is missing, and is not a recipient guard. Four more paths send mail outside that transport: the contact form route, the Gmail and Outlook plugin executors (the user's own connected mailbox), and a legacy Gmail helper. A fifth, Google Calendar, makes Google email invitations to attendees. Once the existing environment becomes staging (it keeps today's data, contacts and plugin connections), any of these can reach a real person. That cannot be undone.

**A5 (cron auth).** There is no shared cron auth helper. 22 routes carry their own copy of a fail-closed `verifyCronSecret`, 2 use a different scheme that is already closed, and **5 run open** when `CRON_SECRET` is unset (two of them are scheduled every 5 minutes and hourly). A fresh production environment starts with the secret unset.

This slice adds one recipient check (`checkOutboundRecipients`) that every send path calls, and one cron auth helper (`isAuthorizedCronRequest`) that every cron entry point calls. Per SA's ruling (section 1.1), the recipient guard is **on** whenever the deployment is not production **or** the allow-list variable is set, including on Vercel's Production target: today that target still serves the staging world with live crons, so setting the list there protects it now, and the list is removed from Production at the real production cutover. While the guard is on, an unset or empty list sends to nobody. With the guard off (production, list unset) behaviour is exactly today's. Source guards in the existing environment-hardening suite stop a new send path or a new cron route from skipping either check. No migration, no schema claim, no LLM call, no entitlements import, no new API route.

---

## Table of Contents

1. [Approved scope (verbatim)](#1-approved-scope-verbatim)
2. [Analysis summary](#2-analysis-summary)
3. [Every outbound email path](#3-every-outbound-email-path)
4. [The recipient guard (A7 design)](#4-the-recipient-guard-a7-design)
5. [Every cron entry point](#5-every-cron-entry-point)
6. [The cron auth helper (A5 design)](#6-the-cron-auth-helper-a5-design)
7. [The guards so this does not come back](#7-the-guards-so-this-does-not-come-back)
8. [Decisions needed from SA](#8-decisions-needed-from-sa)
9. [Files to create / modify](#9-files-to-create--modify)
10. [Task list](#10-task-list)
11. [Test plan](#11-test-plan)
12. [Environment changes (handed to DevOps)](#12-environment-changes-handed-to-devops)
13. [Risks](#13-risks)
14. [Rollback](#14-rollback)
15. [Observed, out of scope](#15-observed-out-of-scope)
16. [SA Review Notes](#16-sa-review-notes)
17. [QA Testing Report](#17-qa-testing-report)
18. [Commit Info](#18-commit-info)
19. [Change History](#change-history)

---

## 1. Approved scope (verbatim)

From the strategy doc's Workstream A table:

> **A5** — Cron auth fails **open** when `CRON_SECRET` is unset, in several of the 21 routes | re-audit all 21 | `CRON_SECRET` is set in production now, so this is latent there — but it is unset in a fresh environment, which is precisely what production will be on day one. Standardise on the fail-closed helper.
>
> **A7** — No non-production email guard | `lib/notifications/emailTransport.ts` | Staging shares the code and the crons. A reminder or briefing drain on staging emails real people. **The only item here that cannot be undone after the fact.**

From the target topology table (Production / Dev-Staging / Local):

> | Email | Resend, verified domain | Resend + recipient allow-list | console transport |
> | Crons | all 21 enabled | manual trigger only | manual |

Measured on 2026-11-23 (PROD-1 measurement table):

> | A5 | 27 cron routes; 21 use the shared helper, 6 do not and need review |
> | A7 | partly present in `lib/notifications/emailTransport.ts` — verify, do not rebuild |

Brief constraints carried into this plan: find **every** outbound email path and decide how each is guarded; production behaviour must not change (refined by SA-E1 below); fail closed (an unset allow-list outside production sends to nobody); every cron route answers 401 when `CRON_SECRET` is unset or wrong; check any non-`/api/cron` route that `vercel.json` schedules; a source-level, line-ending-proof Jest guard so a new cron route or a new email path cannot skip the check; happy path plus a failure path per change; env var names only, no values and no project refs in this tracked file.

### 1.1 SA rulings on the email side (approved requirements, from the PROD-3 Vercel plan review, 2026-11-25)

| # | Ruling | Where it lands |
|---|---|---|
| SA-E1 | There is **no** recipient guard on `origin/main` today. The guard is on whenever the environment is not production, **and also whenever the allow-list variable is set, even on production**, because today's Vercel Production target is still the staging world with live crons, and setting the list there must protect it now. At the real production cutover the list is removed from Production | 4.1, 4.5, 12 steps 1a, 1b and 3 |
| SA-E2 | An empty or unset list while the guard is on = send to nobody. The refusal is logged (structured, no recipient address in clear) and is **not retried** | 4.2, 4.4 |
| SA-E3 | Every transport is covered (Resend, SMTP/nodemailer, the Gmail system sender), and `/api/contact`, which sends through Gmail directly | E-1, E-2 (3.1) |
| SA-E4 | Ordering: PROD-1b merges **before** the Vercel step that copies email credentials to Preview (scoped to branch `main`), and **before** the Production Branch switch | 12, steps 2a and 5 |

SA-E1 supersedes the brief's "production behaviour must not change" for the one case where the list is set on Production: that is the intended change. With the list unset on Production, behaviour is unchanged.

**Corrections to the measurement, found here.** (a) There is no shared cron auth helper: the 21 (in fact 22, counting `/api/run-scheduled-agents`) are inline copies of one function. (b) Of the 6 candidates, `check-free-tier-expiration` is already fail-closed and `process-queue` uses a different scheme (QStash signatures) that is closed on Vercel; `memory-consolidation` was missed and runs open; one route outside `app/api/cron/` also runs open. Section 5 has the real list. (c) "Partly present" for A7 means the production discriminator (`VERCEL_ENV === 'production'`, `emailTransport.ts:343-345`) and the "preview only" fallback (`:1126-1131`) exist. There is no allow-list and no recipient check of any kind.

---

## 2. Analysis summary

| Area | What this slice touches | Facts measured on `origin/main` |
|---|---|---|
| Shared email transport | `lib/notifications/emailTransport.ts` | `sendEmail` (`:875`) tries Resend (`:1034`, fetch at `:610`), then SMTP (`:1077`, `sendMail` at `:719`), then Gmail OAuth (`:1114`, `sendMail` at `:767`), then logs "preview only" (`:1127`). Only pre-transport refusals: `.invalid` recipients (`:879-883`), bad key/timeout (`:889-902`), keyed send without Resend **in production only** (`:905-908`), marketing consent (`:921-1002`). About 34 non-test files import it |
| Email outside the transport | contact route; Gmail, Outlook and Google Calendar executors; a legacy Gmail helper | Section 3 |
| Environment signal | `VERCEL_ENV` | Set by Vercel at runtime: `production` only on the Production Branch's deployments, `preview` on every other deployment (including custom environments), unset locally and in Jest. Per the strategy doc, `main` becomes a Preview-target branch at C3 and production builds from its own branch, so `VERCEL_ENV === 'production'` is exactly "production" in the target topology. Today `main` is still the Production Branch, so on today's live environment the guard is on only once the allow-list variable is set on the Production target (SA-E1); it is on for PR previews and local from the merge |
| Cron routes | 27 under `app/api/cron/`, plus 2 outside | Section 5. `vercel.json` schedules 24 paths: 23 under `/api/cron/` plus `/api/run-scheduled-agents` |
| Run recorder | `lib/cron/cronRunRecorder.ts:86-96` | Records a run only for `NODE_ENV` and `VERCEL_ENV` both `production`, a non-empty secret and a constant-time match. Stronger than every route's check; untouched here |
| Env catalogue | `lib/admin/environment/catalogue.ts:319-335`, `classifyEnvironment.ts:254-269` | Email rows exist for Resend, SMTP and Gmail; `CRON_SECRET` is `exp('R','O','O')`. `catalogueDrift.guard.test.ts` fails if code reads a variable the catalogue does not describe, so the new allow-list variable needs a row |
| Existing guard suite | `lib/__tests__/envConfigHardening.guard.test.ts` | One-pass, line-ending-proof scan with G-1 to G-5 (PROD-1a). Not in the quarantine list. Section 7 adds G-6 and G-7 to it |

Skills checked: `tenant-isolation-guard` (not engaged: no caller-supplied id, no write logic changes); `business-os-schema-check` (no column or table claim); `business-os-entitlements` (no import from that module); `bos-llm-call-standards` (no AI call); `durable-queue-drain` (the drains are not changed; a refused send returns the existing `blocked` result that drains already close as skipped, `emailTransport.ts:273-280`); `new-api-route` (no route's structure changes: each route keeps its handler, response shapes and logger; only the auth function body is replaced, and the contact route gains one check around each send); `env-change-protocol` (section 12). The plugin executors are V2 plugin code, not the V6 pipeline: no IntentContract, CapabilityBinderV2, IntentToIRConverter or ExecutionGraphCompiler change, and no plugin name appears in any shared code (the check is called from inside each executor's own send method).

---

## 3. Every outbound email path

Found with `git grep` on `origin/main` over `app/`, `lib/`, `components/`, `hooks/`, `middleware.ts`, `scripts/`, `supabase/functions/` for: the `nodemailer` import, `createTransport(`, `.sendMail(`, `api.resend.com`, any `resend`, SendGrid, Postmark, Mailgun or AWS SES package, the Gmail `messages/send` and `drafts/send` endpoints, the Graph `/sendMail` path, `sendUpdates` / `sendNotifications`, and the Supabase Auth email triggers. Test files excluded.

### 3.1 Paths this slice guards

"Guard on" means section 4.1: not production, or the allow-list variable set. With the guard off every path behaves exactly as today.

| # | Path | File:line (send) | Who sends, to whom | Today (anywhere) | Target when the guard is on |
|---|---|---|---|---|---|
| E-1 | Shared transport, all three providers (SA-E3) | `lib/notifications/emailTransport.ts:875` (`sendEmail`); dispatch at `:610` (Resend), `:719` (SMTP), `:767` (Gmail system sender) | The platform, for every booking, reminder, invoice, briefing, invite, export and admin mail | Sends to anyone through the first configured provider | One check after `:908`, before the marketing gate, the sender lookup and **all three** providers. Every recipient allowed: unchanged. Otherwise `{ sent: false, provider: 'none', blocked: 'recipient_not_allowlisted' }`, no provider called, no database read, one structured log line with counts only (the "console transport") |
| E-2 | Contact form (SA-E3) | `app/api/contact/route.ts:56` (own Gmail OAuth transport), sends at `:68` (confirmation to the visitor) and `:173` (notification to the team inbox) | The platform, from the configured Gmail account | Sends both | Each send checked separately and skipped when refused; the message is still saved; `emailSent` is true only if both sends happened (today's meaning). With the guard off nothing changes (still this route's own transport, not E-1, so the sender and provider do not change) |
| E-3 | Gmail plugin `send_email` | `lib/server/gmail-plugin-executor.ts:135`, fetch at `:171` | The user's own Gmail account; recipients from the step (to, cc, bcc) | Sends | Check `to`, `cc`, `bcc` **after** the calibration redirect (`:164`), so a redirected test send is judged on the owner's address. Refused: no fetch, a success-shaped suppressed result (D-5) |
| E-4 | Gmail plugin `reply_to_email` | `:984`, fetch at `:1012` | Same; recipients computed by `threadedReplyParts` (`:1008`), which `reply_all` widens | Sends | Check the **final** recipients returned by `threadedReplyParts`, then as E-3 |
| E-5 | Gmail plugin `send_draft` | `:1087`, fetch at `:1095` | Same; recipients live in the draft, not in the step | Sends | **Refused whenever the guard is on**, with no Gmail call at all (SA condition 2, D-6 as changed): the suppressed result. No draft read |
| E-6 | Outlook plugin `send_email` | `lib/server/outlook-plugin-executor.ts:55`, Graph `/me/sendMail` at `:82` | The user's own Outlook account; `to`, `cc`, `bcc` | Sends | As E-3 |
| E-7 | Legacy Gmail helper | `lib/plugins/google-mail/sendEmailDraft.ts:40`, fetch at `:78`; caller `lib/intelligence/utils/EmailHandler.ts:35` (from `lib/utils/runAgentWithContext.ts:32`) | The user's own Gmail account | Sends | Check `to`; refused: throw before the fetch. The only caller already catches and reports `emailSent: false` |
| E-8 | Google Calendar invitations | `lib/server/google-calendar-plugin-executor.ts:253-254` (create), `:363-364` (update), `:415-416` (delete); caller with notifications on: `lib/services/CalendarSyncService.ts:127-134` (`send_notifications: true`, the booking client as attendee) | Google, on the user's behalf, emails each attendee | Invitations, updates and cancellations sent | The event is still written. While the guard is on and any attendee is refused (create; update, judged on the merged attendees, existing ones included), and on **every** delete, `sendUpdates=none` is set **explicitly** (SA condition 3), overriding any `all`; the API wording is in 10.1 |

### 3.2 Path proposed for a follow-up (D-4)

| # | Path | File:line | Why not here |
|---|---|---|---|
| E-9 | Outlook calendar meeting requests | `lib/server/outlook-plugin-executor.ts:667` (create), `:721` (update), `:754` (delete) | Graph sends meeting requests and cancellations whenever an event has attendees; there is no flag to suppress them. Guarding it means stripping attendees on create/update and reading the event before a delete, which is its own design. **PROD-1b.2** (SA D-4). **Until it lands, the allow-list does not stop Outlook calendar meeting requests, updates or cancellations, including booking sync for an Outlook-connected business** (`CalendarSyncService` maps `outlook` to these actions with the booking client as attendee; SA condition 8). Gate: before A-6, latest C3 (section 12, step 5). **Note (2026-11-26, PROD-1b.2 O-1): the booking-sync part is latent, not live.** `CalendarSyncService` sends Google's parameter names (`summary`, `start_time`, `end_time`), so Outlook `create_event` fails parameter validation before any Graph call, and no Outlook event id is ever stored for the update and delete to act on. The live exposure is agent workflows calling the Outlook calendar actions. The parameter bug is tracked as "O-1 Outlook booking sync parameter bug (ClickUp, under PROD-1)": it must not merge before PROD-1b.2 is deployed, and must fix create, update, delete and the event-id field in one change. Design and status: [PROD-1b.2 workplan](/docs/workplans/prod-1b2-outlook-calendar-guard-workplan.md) |
| E-10 | Google Drive share notifications | `lib/server/google-drive-plugin-executor.ts:844` (`shareFile`), `:889` (the `user` / `group` branch) | Found by PROD-1b.2's inventory (2026-11-26), missed here: `permissions.create` is called once per address with no `sendNotificationEmail`, which Google defaults to true for users and groups, so Google emails each address. The `anyone` / `domain` branch (`:930`) cannot take the parameter and notifies nobody. No G-7 pattern matches it. **PROD-1b.3** (PROD-1b.2 SA D-12), a separate slice. **Until it lands, the allow-list does not stop Drive share notifications.** Gate: before A-6, latest C3 (section 12, step 5) |

### 3.3 Paths that need no code change

| # | Path | Why no change | Owner |
|---|---|---|---|
| N-1 | Supabase Auth emails (password reset from `app/reset-password/page.tsx`, sign-in links) | Sent by Supabase Auth with the project's own mail settings, and only to the address of the person who asked. `app/api/auth/handoff/redeem/route.ts:81` calls `generateLink`, which returns a link and sends nothing | DevOps, as project configuration (B2d) |
| N-2 | Stripe receipt email (`app/api/website/payment-intent/route.ts:547`, `receipt_email`) | Stripe sends receipts in live mode; the non-production environment runs test-mode keys (Workstream E). Not our transport | DevOps confirms Preview holds test-mode Stripe keys |
| N-3 | `scripts/validate-resend.mjs:140` | Operator script run by hand with an address the operator gives; not deployed | None |
| N-4 | Non-email outbound messages (Slack, Discord, WhatsApp, LinkedIn executors) | Not email, so outside A7 as approved. Listed in section 15 for TL | TL |

**Count check:** 8 guarded (E-1 to E-8), 2 follow-ups (E-9, and E-10, added 2026-11-26 from PROD-1b.2's inventory), 4 no change (N-1 to N-4). Every grep hit in deployed code maps to a row; `components/crm/contact-drawer/BookingsTab.tsx:4012` (`onResendMail(`) is a UI callback that calls an API route which uses E-1, not a send of its own.

---

## 4. The recipient guard (A7 design)

### 4.1 When the guard is on (SA-E1)

| Deployment | `EMAIL_RECIPIENT_ALLOWLIST` | Guard | Effect |
|---|---|---|---|
| Production (`VERCEL_ENV === 'production'`) | not set (the variable is absent) | **off** | Exactly today's behaviour; the check returns at once and reads nothing else |
| Production | set, to anything (including empty or whitespace) | **on** | Only allow-listed recipients; an empty or invalid-only list sends to nobody. This is today's Production target, which still serves the staging world with live crons, until the real cutover removes the variable (12, step 3) |
| Preview (any branch, any custom environment), Vercel Development, local, Jest | set or not | **on** | Only allow-listed recipients; unset sends to nobody |

"Set" means the variable is present in the environment. A present-but-empty value turns the guard on and allows nobody: a value someone put there on purpose is never read as "no guard" (D-13).

**Production signal.** `isProductionDeployment()` moves out of `emailTransport.ts:343-345` (private today) into a new edge-safe module `lib/utils/deploymentEnvironment.ts`, unchanged in meaning: `process.env.VERCEL_ENV === 'production'`, exact comparison, read per call. The transport's existing keyed-send check (`:905`) imports it, so there is one definition. A6 (test-surface gating, a later PROD-1 slice) is expected to reuse it. D-3.

Strict equality is deliberate: an unexpected value (`Production`, padded, a custom environment's `preview`) reads as non-production, which turns the guard on and fails closed (mail refused, logged) rather than open.

### 4.2 The allow-list

**Variable:** `EMAIL_RECIPIENT_ALLOWLIST` (D-1). Server-only, read per call, never inlined into the browser.

| Rule | Detail |
|---|---|
| Separators | Commas, semicolons and whitespace |
| Entry kinds | An exact address (`name@team.example`), or a whole domain written `@team.example` |
| Matching | Case-insensitive. A domain entry matches that domain exactly: not its subdomains, not a longer domain ending in the same text. An address entry matches only that address (no plus-address folding) |
| Not supported, on purpose | Wildcards (`*`, `@*`, `*@x`), a bare domain without `@`, anything not address-shaped. These entries are ignored and counted as invalid, so there is no way to write "everyone" |
| Unset, empty, or no valid entry, while the guard is on | Nobody is allowed (fail closed, SA-E2) |

**Module:** `lib/email/recipientAllowList.ts`, pure and edge-safe (no logger, no Node-only import):

```typescript
export function parseRecipientAllowList(raw: string | undefined): {
  addresses: ReadonlySet<string>;
  domains: ReadonlySet<string>;
  invalidEntries: number;
};

export type OutboundRecipientVerdict =
  | { allowed: true; basis: 'production' | 'allowlist' }
  | {
      allowed: false;
      reason: 'allowlist_unset' | 'recipient_not_allowed' | 'unparseable_recipient';
      recipientCount: number;
      refusedCount: number;
    };

export function checkOutboundRecipients(
  recipients: readonly string[],
  env?: Readonly<Record<string, string | undefined>>
): OutboundRecipientVerdict;
```

`checkOutboundRecipients` returns `basis: 'production'` at once when the guard is off (production with the variable absent), so production does no new work. When the guard is on, each element of `recipients` is split on commas and semicolons (an element like `"a@x, b@y"` is two recipients to SMTP, `emailTransport.ts:694`), a display-name form `Name <addr>` is read for the address in brackets, and every resulting address must be allowed. Any piece that does not parse refuses the whole send. An empty recipient list refuses. The verdict carries counts only, never addresses, so no caller can log an address by passing the verdict on.

The same parser feeds the admin Environment page (section 4.5), so the page and the guard cannot disagree about how many entries are valid (the `parseAdminEmails` precedent, `classifyEnvironment.ts:259-261`).

### 4.3 Mixed recipient lists

A list where some recipients are allowed and some are not is **refused whole** (D-2), as the `.invalid` check already does (`emailTransport.ts:877-883`). Sending to the allowed subset would change the message's meaning (a reply-all, a cc'd owner) and the caller's record of who was sent what.

### 4.4 What each path does on a refusal

| Path | On refusal | Log line (Pino, module's own logger) |
|---|---|---|
| E-1 transport | Returns `{ sent: false, provider: 'none', blocked: 'recipient_not_allowlisted' }`. `blocked` already means "a final decision, close the row as skipped, never retry" (`:273-280`), so drains and callers need no change and nothing is retried (SA-E2). The union type at `:280` gains the value | `info`: `Email not sent: recipient not on the allow-list` with `reason`, `isProduction`, `recipientCount`, `refusedCount` and the message `kind`. **No recipient address, masked or not** (SA-E2), and **no subject** (subjects carry client names; SA condition 11). This is the local "console transport" |
| E-2 contact | That one send is skipped; never retried | `info`, same wording, counts only |
| E-3 to E-6 executors | No send. A success-shaped result, as the calibration suppress path does today (`gmail-plugin-executor.ts:149-161`): `message_id: null`, `recipient_count: 0`, `allowlist_suppressed: true`, and a plain note. Success-shaped because a thrown error fails an agent run and a failed scheduled run is re-run, repeating earlier steps only to hit the same refusal (SA's reason for D-5). A first-party caller that acts on a send must check the flag: the dashboard reply route now does (SA condition 1, section 9) | `warn` with action name and counts, no address |
| E-7 legacy helper | Throws `Email not sent: recipient not on the allow-list` before the fetch; the caller does not retry | the caller's existing catch |
| E-8 calendar | The event is written with `sendUpdates=none` | `info` (`Calendar notifications suppressed: attendee not on the email allow-list`) with action name and attendee counts, no address |

Order inside `sendEmail`: the `.invalid` refusal and the key/timeout validation stay first (they are caller bugs that must surface in every environment), then the production-only keyed check (`:905-908`), then **the new check**, then the marketing gate and everything after it, including all three providers (SA-E3). So a refused send makes no database read, resolves no sender and touches no provider.

### 4.5 Admin Environment page

New catalogue row in the `email` group (D-11):

| Field | Value |
|---|---|
| Builder | `personal(…)` (it holds addresses) with a new personal kind `list-email-allowlist` |
| Role text | "The only addresses email may be sent to (addresses or @domain entries). Outside production it always applies and unset sends nothing; in production it applies only while it is set, and it is removed at the production cutover." |
| Expected in | **Now:** `exp('O', 'O', 'O')`, because SA-E1 puts it on the Production target temporarily and PR previews legitimately run without it (no email credentials there, and the guard is on anyway). **At the production cutover (PROD-3, same PR as the removal in 12 step 3):** `exp('X', 'O', 'O')`, so the page shows `should-not-be-set` if it reappears on real production. The PROD-1a D-5 two-step pattern |
| Display | `classifyEnvironment.ts` `personalDisplay` gains a `list-email-allowlist` case: a count of valid entries from `parseRecipientAllowList`, never the values |

---

## 5. Every cron entry point

Found by listing `app/api/cron/*/route.ts` on `origin/main` (27) and every `crons[].path` in `vercel.json` (24; 23 of them under `/api/cron/`, plus `/api/run-scheduled-agents`), then every non-test file in `app/` and `lib/` that reads `CRON_SECRET` (which adds `/api/run-scheduled-agents-direct`). "Unset" = `CRON_SECRET` not configured; "wrong" = a configured secret and a wrong or missing header. All run with `NODE_ENV=production` on Vercel.

| # | Route | Scheduled | Auth today (file:line) | Unset | Wrong | Target |
|---|---|---|---|---|---|---|
| 1 | `cron/abandoned-bookings` | yes | inline `verifyCronSecret` `:43-60`, called `:66` | 401 | 401 | helper |
| 2 | `cron/abandoned-proposal-invoices` | yes | `:37-49`, `:55` | 401 | 401 | helper |
| 3 | `cron/booking-money-reconcile` | yes | `:45-57`, `:63`; POST `:105` runs the same job | 401 | 401 | helper |
| 4 | `cron/bos-billing-reconcile` | yes | `:44-63`, `:69` | 401 | 401 | helper |
| 5 | `cron/bos-plan-cancel-reminders` | yes | `:44-63`, `:69` | 401 | 401 | helper |
| 6 | **`cron/calendar-sync`** | yes, every 5 min | module-scope read `:26`; check `:36` is `if (CRON_SECRET && header !== …)`, and refuses only when `NODE_ENV === 'production'` (`:38`) | **runs** | 401 on Vercel; runs where `NODE_ENV` is not production | **helper (fix)** |
| 7 | **`cron/channel-metrics-sync`** | yes, hourly | `:26`, `:37-38`, same shape as #6 | **runs** | as #6 | **helper (fix)** |
| 8 | `cron/check-free-tier-expiration` | no (permanently unscheduled, `lib/cron/bosCronJobs.ts` `PERMANENTLY_UNSCHEDULED_CRONS`) | own `hasCronSecret` `:30-35`: no development bypass, constant-time compare; 401, else 410 | 401 | 401 | **exempt, unchanged** (stricter than the helper; pinned by its route test) |
| 9 | `cron/client-standing` | yes | `:46-58`, `:71` | 401 | 401 | helper |
| 10 | `cron/credit-leak-check` | yes | `:42-61`, `:67` | 401 | 401 | helper |
| 11 | `cron/daily-briefing` | yes | `:37-51`, `:57` | 401 | 401 | helper |
| 12 | `cron/data-export-modules` | yes | `:44-61`, `:67` | 401 | 401 | helper |
| 13 | `cron/finance-snapshot` | yes | `:45-62`, `:68` | 401 | 401 | helper |
| 14 | `cron/insight-actions` | yes | `:37-51`, `:57` | 401 | 401 | helper |
| 15 | `cron/insight-automations` | yes | `:25-53`, `:69`; POST `:156` development only | 401 | 401 | helper |
| 16 | `cron/insight-detect` | yes | `:171-199`, `:219`; POST `:554` development only | 401 | 401 | helper |
| 17 | `cron/insight-hypotheses` | yes | `:66-79`, `:108`; POST `:227` runs the job | 401 | 401 | helper |
| 18 | `cron/insight-measure` | yes | `:49-59`, `:65`; POST `:118` development only | 401 | 401 | helper |
| 19 | `cron/insight-metrics` | yes | `:30-58`, `:72`; POST `:199` development only | 401 | 401 | helper |
| 20 | `cron/intake-reminders` | yes | `:29-46`, `:52` | 401 | 401 | helper |
| 21 | `cron/lead-response` | yes | `:33-47`, `:53` | 401 | 401 | helper |
| 22 | **`cron/memory-consolidation`** | no (sunset, `lib/cron/__tests__/vercelCrons.test.ts`) | `verifyCronRequest` `:38-55`: allows everything when `NODE_ENV !== 'production'` (`:40`), allows when the secret is unset (`:54`); called `:62`; POST `:108` calls GET | **runs** | 401 on Vercel | **helper (fix)** |
| 23 | `cron/payment-reminders` | yes | `:33-52`, `:59`; POST `:187` development only | 401 | 401 | helper |
| 24 | `cron/payment-retry` | yes | `:30-49`, `:56`; POST `:113` development only | 401 | 401 | helper |
| 25 | `cron/process-queue` | no (called by QStash, not Vercel Cron) | `POST` is `verifySignatureAppRouter(handler)` when `NODE_ENV === 'production'` (`:429-431`). The library throws at module load when either signing key is unset, so every request then fails 500; a request without a valid signature gets 403 | 500 (closed) | 403 | **exempt, unchanged** (a different credential; D-9) |
| 26 | `cron/stripe-settlement-gap` | yes | `:61-80`, `:86` | 401 | 401 | helper |
| 27 | **`cron/update-template-scores`** | no (sunset) | `:17-18` compares the header with the template `Bearer ${process.env.CRON_SECRET}` and never checks the secret exists, so when it is unset the expected header is the fixed text "Bearer undefined" | **runs for that header** | 401 | **helper (fix)** |
| 28 | `run-scheduled-agents` (outside `cron/`) | yes, every 5 min | `app/api/run-scheduled-agents/route.ts:90-103`, called `:109` | 401 | 401 | helper |
| 29 | **`run-scheduled-agents-direct`** (outside `cron/`) | no | `app/api/run-scheduled-agents-direct/route.ts:52-57`, same shape as #27 | **runs for that header** | 401 | **helper (fix)** (D-10) |

**Totals:** 22 inline fail-closed copies (#1-5, 9-21, 23, 24, 26, 28); **5 fail open** (#6, 7, 22, 27, 29); 2 closed by other means (#8, 25). Every scheduled path in `vercel.json` resolves to a file in this table. Strategy-doc item F6 ("3 insight crons fail open") is already closed on `main` (#15 `:47-50`, #16 `:193-196`, #19 `:52-55`); TL to update the master doc.

---

## 6. The cron auth helper (A5 design)

### 6.1 The helper

**File:** `lib/cron/cronAuth.ts`

```typescript
import type { Logger } from '@/lib/logger';

/** True only for a request carrying `Authorization: Bearer <CRON_SECRET>`. Never logs the header. */
export function isAuthorizedCronRequest(request: Request, logger: Logger): boolean;
```

| Step | Behaviour | Versus the 22 inline copies |
|---|---|---|
| 1 | Local development bypass: `true` only when `NODE_ENV === 'development'` **and** `VERCEL_ENV` is unset or empty | Tighter: a Vercel deployment can never take the bypass, even if `NODE_ENV` were misconfigured there. `vercel dev` (which sets `VERCEL_ENV=development`) now needs the secret (D-8) |
| 2 | `CRON_SECRET` read per call; unset, empty or whitespace-only: `logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)')`, return `false` | Same message text, so any existing log search still matches; whitespace-only is newly treated as unset |
| 3 | Compare `authorization` with `Bearer <secret>` in constant time, hashing both sides first so a length mismatch cannot throw (the shape `cronRunRecorder.ts:91-93` and the free-tier route already use) | Same outcomes as `===`; no timing signal |
| 4 | Any exception inside: return `false` | New: an auth check that throws must not become a 500 that skips auth |

The caller's own logger is passed in so the error line keeps the route's module name. Each route keeps its own `requestLogger.warn('Unauthorized cron request')` and its own 401 body, so responses are byte-identical to today for every case that was already closed.

### 6.2 Adoption (D-7)

**Recommended (C2a):** all 27 helper rows in section 5 call it. In each of the 22 compliant routes the local `verifyCronSecret` is deleted and its call site becomes `isAuthorizedCronRequest(request, requestLogger)` (or the module logger, where that is what the route used). The 5 fail-open routes get the same call in place of their check; #6 and #7 also lose the module-scope `const CRON_SECRET` read. The behaviour net for the 22 mechanical edits already exists: `app/api/cron/__tests__/runRecord.adoption.test.ts` asserts, for every Business OS job, that an authorised run answers 200 and an unauthorised one 401 (`:73-101`).

**Alternative (C2b):** the helper for the 5 fail-open routes only; the 22 inline copies are pinned in G-6 as a shrink-only legacy list and migrated in a later slice. Smaller diff now, two shapes to keep honest until then.

### 6.3 Behaviour change per fixed route

| Route | Was | Becomes |
|---|---|---|
| #6 calendar-sync, #7 channel-metrics-sync | Unset secret: runs for anyone. Where `NODE_ENV` is not `production` (Jest, a misconfigured host): runs with a wrong header | 401 in both cases |
| #22 memory-consolidation | Unset: runs. Any `NODE_ENV` other than `production`, including `test`: runs | 401 unless local development (6.1 step 1) |
| #27 update-template-scores, #29 run-scheduled-agents-direct | Unset: runs for the header "Bearer undefined" | 401. Gains the local-development bypass the other routes have (a loosening, local only) |

Production today has `CRON_SECRET` set (strategy doc; verified again by DevOps in section 12, step 0), so on today's live environment the only observable change is for callers presenting no or a wrong secret, which were already refused by #6 and #7 there.

---

## 7. The guards so this does not come back

### 7.1 Placement: the existing `lib/__tests__/envConfigHardening.guard.test.ts`

Both new rules join the existing one-pass scan (PROD-1a C-9): each file is read once as bytes, decoded only if it contains a needle, and every rule runs in that pass. No new suite, so no extra Jest worker start-up and no new CI job. Budget: at most +1 s for this suite measured on CI; Dev records local before/after in 10.2 (SA condition 13: over +1 s on CI goes back to SA before merge). Names and patterns are built from parts so the guard does not match itself. No backslash-escaped text appears in this doc (Tailwind scans `docs/`).

### 7.2 G-6: every cron entry point uses the helper

| Item | Rule |
|---|---|
| Entry points | Every `app/api/cron/<name>/route.ts`, plus `app<path>/route.ts` for every `crons[].path` in `vercel.json`, plus the explicit, self-tested `EXTRA_CRON_ENTRY_POINTS` list, which names `app/api/run-scheduled-agents-direct/route.ts` (SA condition 4: once fixed it no longer reads the secret, so neither the walk, `vercel.json` nor R2 would notice its check being removed). A path with no route file fails |
| R1 | Each entry point imports `isAuthorizedCronRequest` from `@/lib/cron/cronAuth` and refuses on the **negated** form `!isAuthorizedCronRequest(` (SA condition 10: a call whose result is ignored fails), unless it is in `CRON_AUTH_EXEMPT` |
| `CRON_AUTH_EXEMPT` (2, reasons in the test) | `app/api/cron/process-queue/route.ts` (QStash signature); `app/api/cron/check-free-tier-expiration/route.ts` (its own stricter check). Self-test: each exempt file still contains its alternative (`verifySignatureAppRouter(`; `timingSafeEqual(` and the unset-secret refusal), so an exemption cannot outlive the reason for it |
| R2 | No non-test file in `app/`, `lib/`, `components/`, `hooks/` or `middleware.ts` **reads** `CRON_SECRET` (the `process.env` dot, optional-chain, bracket and destructuring forms from G-4's matcher; not the quoted-literal or key forms, because route comments quote the name in backticks and the catalogue names it as data), except `lib/cron/cronAuth.ts`, `lib/cron/cronRunRecorder.ts` and the free-tier route. This also catches a scheduler route outside `app/api/cron/`, as #29 was |
| Floors | At least 25 entry points and at least 20 scheduled paths, so a broken walk cannot pass |
| Failure message | File, and "call isAuthorizedCronRequest from lib/cron/cronAuth before any work" |

SA chose C2a, so there is no legacy list.

### 7.3 G-7: every email send site calls the recipient check

| Item | Rule |
|---|---|
| Scope | Non-test files in `app/`, `lib/`, `components/`, `hooks/`, `middleware.ts`. `scripts/` is out (operator tools, not deployed; N-3) |
| Provider patterns (presence) | An import or `require` of `nodemailer`, `resend`, `@sendgrid/…`, `postmark`, `mailgun.js` / `mailgun-js`, `@aws-sdk/client-ses`, `@aws-sdk/client-sesv2`; and the hosts `api.sendgrid.com`, `api.mailgun.net`, `api.postmarkapp.com`, `api.brevo.com` (SA condition 9). A file with one must be in the registry |
| Dispatch patterns (counted) | `.sendMail(`; `api.resend.com/emails`; the Gmail paths `/messages/send` and `/drafts/send` and the client-library forms `messages.send(` and `drafts.send(`; the Graph path `/sendMail`, and `/replyAll` and `/forward` when followed by a quote, backtick or `?` (so prose like "back/forward cache" does not match); `sendUpdates` and the deprecated `sendNotifications` (SA condition 9) |
| Supabase Auth senders (counted) | `inviteUserByEmail(`, `resetPasswordForEmail(`, `signInWithOtp(`: registered with **zero** required checks and the N-1 reason, so a new one is reviewed rather than unseen (SA condition 9). Today: one, `lib/client/auth-actions.ts` |
| Prefilter | One regex over a latin1 view of each deployed file's bytes. Measured locally: 19 separate `Buffer.includes` calls cost about 0.9 s over the ~3,100 deployed files; the single regex about 0.45 s (10.2) |
| Registry `EMAIL_SEND_SITES` | One entry per file: a reason, the pinned **dispatch count** and the pinned **count of check calls** (`checkOutboundRecipients(` or, where the recipients are unknown, `isRecipientGuardOn(`). Measured and pinned: transport 3 / 1; contact route 2 / 2 (the check is called inline at each send, so removing one fails G-7; SA code review item 2); Gmail executor 3 / 3 (`send_draft`'s check is the guard-on test, SA condition 2); Outlook executor 2 / 1 (the second dispatch hit is the comment at `:62`); legacy helper 1 / 1; Google Calendar executor 4 / 3 (three original `sendUpdates` lines plus the explicit `none`); `lib/client/auth-actions.ts` 0 / 0 with 1 Auth sender |
| Assertions | (a) the set of files with any hit equals the registry, both ways (a new send file fails; a stale entry fails); (b) each file's dispatch count and check count equal the pinned numbers, so adding a send inside an already-registered file fails until the registry is updated, and the failure message says to call `checkOutboundRecipients` for the new site |
| Pending (D-4) | `lib/server/outlook-plugin-executor.ts` calendar actions are not matched by any pattern above (Graph sends invitations without a flag). The Outlook registry entry's reason names PROD-1b.2 as pending; no pattern is weakened for them. **Flipped by PROD-1b.2 (2026-11-26):** a Graph calendar-path pattern and a Graph message send/reply pattern were added, the Outlook pin re-measured, and a self-test now fails if any reason says PENDING |
| No comment stripping | As G-4 (PROD-1a C-8 a): a pattern inside a comment counts, and is simply part of the pinned number |

### 7.4 Line-ending proof

Carried over from PROD-1a section 6.4: no pattern contains a newline, an anchor or the multiline flag; boundaries are character lookarounds; content is normalised once (CR LF and lone CR to LF) so line numbers and counts agree across platforms; relative paths are normalised to `/` before any comparison. Self-tests run every new matcher over an LF and a CRLF form of the same sample and assert identical hits and counts; each forbidden form is shown caught and each allowed lookalike (`onResendMail(`, `sendMailCount`, "back/forward cache", `send_notifications`, `recheckOutboundRecipients(`, a `./resend-link` import, `NEXT_CRON_SECRET_HINT`, a backticked name in a comment for R2, the helper imported but never used as a guard, or imported from elsewhere, or a lookalike helper name for R1) is shown handled correctly, so neither rule can pass vacuously.

---

## 8. Decisions needed from SA

| # | Decision | Recommendation |
|---|---|---|
| (ruled) | **Already ruled by SA (section 1.1):** guard on when not production or the variable is set (SA-E1); empty or unset while on = nobody, logged without addresses, not retried (SA-E2); all three transports and `/api/contact` covered (SA-E3); merge before the Preview email-credential copy and the Production Branch switch (SA-E4) | Folded in; not re-opened |
| D-1 | Allow-list variable name and grammar | `EMAIL_RECIPIENT_ALLOWLIST` (the name section 12 hands to DevOps); exact addresses and `@domain` entries only; no wildcards; unset or no valid entry = nobody (4.2) |
| D-2 | A list mixing allowed and refused recipients | Refuse the whole send (4.3). Alternatives: send to the allowed subset; redirect everything to one sink address |
| D-3 | Production signal and where it lives | `VERCEL_ENV === 'production'`, exact, read per call, in a new shared module `lib/utils/deploymentEnvironment.ts` (rule 7: a new module, not a new pattern; it moves an existing private function) |
| D-4 | Scope beyond SA-E3, and the split | SA-E3 makes E-1 and E-2 mandatory. Recommended: also E-3 to E-8 (the user-mailbox sends and Google invitations) in this slice, **on the same switch** as the transport, so that setting the list on today's Production target also stops a staging-world agent or the inbox "needs you" reply from mailing a real person. Consequence to accept: while the list is on Production, a live user's own Gmail or Outlook sends through the platform are limited to the list too. **PROD-1b.2**: E-9 Outlook calendar, gated before the Production Branch switch (12, step 5). Alternative: E-3 to E-8 guarded only when not production (ignoring the list on Production) |
| D-5 | Plugin executor refusal shape (E-3 to E-6) | Success-shaped suppressed result, as the calibration suppress path at `gmail-plugin-executor.ts:149-161` already does, so a staging workflow completes and shows why nothing was sent. Alternative: throw, so the step fails |
| D-6 | Gmail `send_draft` while the guard is on | **SA changed:** refuse every `send_draft` while the guard is on, with no Gmail call (condition 2). Implemented that way |
| D-7 | Cron helper adoption | C2a: all 27 call the helper now (6.2). Alternative C2b: the 5 fail-open routes now, the 22 inline copies pinned as legacy |
| D-8 | Local development bypass in the helper | Keep it for local only (`NODE_ENV === 'development'` and no `VERCEL_ENV`). Alternative: remove it; developers set `CRON_SECRET` locally |
| D-9 | `process-queue` and `check-free-tier-expiration` | Leave both unchanged, exempt in G-6 with reasons and "still has its check" self-tests |
| D-10 | `run-scheduled-agents-direct` (unscheduled, runs open) | Fix its auth with the helper here. Deleting the route is an owner decision and a separate change |
| D-11 | Catalogue row | New personal kind `list-email-allowlist`, counted by the guard's own parser; `exp('O','O','O')` now, `exp('X','O','O')` in the PROD-3 cutover change (4.5). Alternative: kind `single` (set / not set only) |
| D-12 | `console.*` in touched files (9.1) | Apply the user's PROD-1a D-4 precedent: convert the two small touched files in this slice (15 calls); nothing else touched has any |
| D-13 | Variable present but empty on Production | Guard on, nobody allowed (4.1): presence is the switch, so a deliberately set value can never mean "no guard". Alternative: treat empty as absent (guard off). Vercel rarely stores an empty value, but a whitespace value is possible |

---

## 9. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/utils/deploymentEnvironment.ts` | create | `isProductionDeployment()` (D-3) |
| `lib/email/recipientAllowList.ts` | create | `parseRecipientAllowList`, `checkOutboundRecipients` (4.2) |
| `lib/email/__tests__/recipientAllowList.test.ts` | create | 11.1 |
| `lib/notifications/emailTransport.ts` | modify | Import the shared production check; the new check after `:908`; `blocked` union gains `recipient_not_allowlisted`; header comment states the guard rule (4.1) |
| `lib/notifications/__tests__/emailTransport.allowList.test.ts` | create | 11.2 |
| 7 suites in `lib/notifications/__tests__/` that call the real `sendEmail` (`emailTransport`, `.idempotency`, `.invalidRecipient`, `.redactRecipient`, `repliesReachTheBusiness`, `unsubscribeHeader`, `urgentHeaders`) | modify | Set `VERCEL_ENV` or the allow-list explicitly per suite and restore it after; no global test bypass (R-7) |
| `app/api/contact/route.ts` | modify | Check before each of the two sends (E-2) |
| `app/api/contact/__tests__/route.allowList.test.ts` | create | 11.3 |
| `lib/server/gmail-plugin-executor.ts` | modify | E-3, E-4, E-5 |
| `lib/server/outlook-plugin-executor.ts` | modify | E-6 (`send_email` only) |
| `lib/plugins/google-mail/sendEmailDraft.ts` | modify | E-7 |
| `lib/server/google-calendar-plugin-executor.ts` | modify | E-8 |
| `tests/plugins/unit-tests/google-mail.test.ts`, `outlook.test.ts`, `google-calendar.test.ts`; `lib/plugins/google-mail/__tests__/sendEmailDraft.test.ts` | modify | Explicit environment per suite, plus the new refusal cases (11.4) |
| `lib/cron/cronAuth.ts` | create | `isAuthorizedCronRequest` (6.1) |
| `lib/cron/__tests__/cronAuth.test.ts` | create | 11.5 |
| 25 route files: section 5 rows #1-7, 9-24, 26, 27 under `app/api/cron/`, plus `app/api/run-scheduled-agents/route.ts` and `app/api/run-scheduled-agents-direct/route.ts` (27 in total; C2a) | modify | Call the helper; drop the local check |
| `app/api/cron/__tests__/cronAuth.failClosed.test.ts` | create | 11.6 |
| `lib/admin/environment/catalogue.ts`, `classifyEnvironment.ts` | modify | Allow-list row and display kind (D-11) |
| `lib/admin/environment/__tests__/` (catalogue, classify, serialisation suites as needed) | modify | Only expectations that name the new row or kind, each with a reason |
| `lib/__tests__/envConfigHardening.guard.test.ts` | modify | G-6, G-7, self-tests (section 7) |
| `docs/VERCEL_DEPLOYMENT_SETUP.md` | modify | Name the allow-list variable and where it is set (names only); Change History row |
| `docs/feature_flags.md` | none | Not a flag |
| `app/api/business-os/gaps/reply/route.ts` | modify | (SA condition 1) A reply that did not go (`!sent.success`, or `sent.data.allowlist_suppressed`) deletes no draft, writes no `reply_sent`, and answers 409 (`recipient_not_allowlisted`) or 502 (`reply_not_sent`) with a plain message; the id is read from `sent.data.message_id`. No other change |
| `app/api/business-os/gaps/reply/__tests__/route.test.ts` | modify | Mocks return the real `ExecutionResult` shape; three new cases: suppressed, failed, sent |
| `app/api/admin/jobs-queues/drain/__tests__/drain.source.guard.test.ts` | modify | S-8 now expects the helper call in the five drained cron routes; the drain route may not name the helper either |
| `app/api/cron/bos-billing-reconcile/__tests__/route.test.ts`, `app/api/cron/bos-plan-cancel-reminders/__tests__/route.qa.test.ts` | modify | Their "local development runs without a secret" case also unsets `VERCEL_ENV` (D-8) |
| `lib/business-os/data-export/__tests__/moduleExportWorker.test.ts` | modify | T-W23 runs the real transport outside production; it lists its one recipient |
| `lib/admin/environment/__tests__/catalogue.test.ts`, `classifyEnvironment.test.ts` | modify | K-4 accepts the new personal kind; one new classify case for the row |

### 9.1 `console.*` in files this slice touches (CLAUDE.md § Logging: flagged, conversion proposed)

| File | `console.*` calls | Lines | Proposal |
|---|---|---|---|
| `app/api/cron/update-template-scores/route.ts` | 4 | 182 | Convert in this slice (D-12) |
| `app/api/run-scheduled-agents-direct/route.ts` | 11 | 204 | Convert in this slice (D-12) |
| **Total** | **15 in 2 files** | | |

Every other touched app/lib file has none (measured: `emailTransport.ts`, `contact/route.ts`, the Gmail, Outlook and Google Calendar executors, `sendEmailDraft.ts`, `catalogue.ts`, `classifyEnvironment.ts`, `run-scheduled-agents/route.ts`, and the other 24 cron routes). `app/api/cron/process-queue/route.ts` (16 calls) and `lib/intelligence/utils/EmailHandler.ts` are **not** touched (D-9; E-7 changes the helper, not its caller), so they are flagged here for the follow-up list and not converted.

### 9.3 Two commits (SA condition 6)

So a cron-only problem can be reverted without removing the email guard from the staging world (R-13). The two groups share **one** file, the guard suite; RM stages its A5 half without touching the working tree: `git apply --cached` with a patch Dev prepared (`prod-1b-a5-guard.patch`, which turns the `origin/main` guard file into the G-6-only version; its 41 tests pass on this tree; regenerate it with the script beside it if lost), commits A5, then `git add` the full file in the A7 commit.

| Commit | Files |
|---|---|
| **1. `fix(cron): fail-closed auth for every cron route (PROD-1b A5)`** | `lib/cron/cronAuth.ts`; `lib/cron/__tests__/cronAuth.test.ts`; `app/api/cron/__tests__/cronAuth.failClosed.test.ts`; the 25 route files under `app/api/cron/` (rows #1-7, 9-24, 26, 27); `app/api/run-scheduled-agents/route.ts`; `app/api/run-scheduled-agents-direct/route.ts`; `app/api/admin/jobs-queues/drain/__tests__/drain.source.guard.test.ts`; `app/api/cron/bos-billing-reconcile/__tests__/route.test.ts`; `app/api/cron/bos-plan-cancel-reminders/__tests__/route.qa.test.ts`; the G-6 half of `lib/__tests__/envConfigHardening.guard.test.ts` (via the patch) |
| **2. `fix(email): recipient allow-list on every send path (PROD-1b A7)`** | `lib/utils/deploymentEnvironment.ts`; `lib/email/recipientAllowList.ts`; `lib/email/__tests__/recipientAllowList.test.ts`; `lib/notifications/emailTransport.ts`; `lib/notifications/__tests__/emailTransport.allowList.test.ts` and the 7 notification suites; `app/api/contact/route.ts`; `app/api/contact/__tests__/route.allowList.test.ts`; `lib/server/gmail-plugin-executor.ts`; `lib/server/outlook-plugin-executor.ts`; `lib/server/google-calendar-plugin-executor.ts`; `lib/plugins/google-mail/sendEmailDraft.ts`; `tests/plugins/unit-tests/google-mail.test.ts`, `outlook.test.ts`, `google-calendar.test.ts`; `lib/plugins/google-mail/__tests__/sendEmailDraft.test.ts`; `app/api/business-os/gaps/reply/route.ts` and its test; `lib/admin/environment/catalogue.ts`, `classifyEnvironment.ts` and their two tests; `lib/business-os/data-export/__tests__/moduleExportWorker.test.ts`; the rest of `lib/__tests__/envConfigHardening.guard.test.ts` (G-7) |
| Docs (with commit 2, or a third `docs:` commit) | this workplan; `docs/VERCEL_DEPLOYMENT_SETUP.md` |

Each commit is self-consistent: commit 1 touches no email file and passes its own suites; the A5 guard half does not reference any A7 symbol.

### 9.2 Debt noticed, not extended

`update-template-scores`, `run-scheduled-agents-direct`, `memory-consolidation`, `process-queue` and the contact route build their own service-role clients instead of going through `lib/repositories/` (CLAUDE.md rule 1), and the contact route parses its body without Zod (rule 2). This slice changes only their auth or adds the recipient check; it does not restructure them. Listed in section 15.

---

## 10. Task list

- 🟡 0. (branch ✅ confirmed; DevOps steps 0, 1a, 1b still owed before merge) RM creates `fix/prod-1b-email-guard-cron-auth` from `origin/main` (done, `201ff9f3`); Dev confirms with `git branch --show-current` before the first edit. DevOps runs section 12 steps 0 and 1 before merge.
- ✅ 1. `lib/utils/deploymentEnvironment.ts`; `lib/email/recipientAllowList.ts`; 11.1 tests.
- ✅ 2. Transport check (E-1); 11.2; update the 7 notification suites; record which suites needed it.
- ✅ 3. Contact route (E-2); 11.3.
- ✅ 4. Gmail executor (E-3, E-4, E-5), Outlook `send_email` (E-6), legacy helper (E-7), Google Calendar (E-8, after confirming the API default); 11.4.
- ✅ 5. `lib/cron/cronAuth.ts`; 11.5.
- ✅ 6. Adopt the helper in the 27 route files (C2a); convert the 15 `console.*` calls (D-12); 11.6; run the existing cron suites (11.7).
- ✅ 7. Catalogue row and display kind; Environment page suites.
- ✅ 8. G-6 and G-7 with self-tests; record the suite's wall time before and after.
- ✅ 9. Docs: `VERCEL_DEPLOYMENT_SETUP.md`.
- 🟡 10. (typecheck filtered to touched files, `lint:hooks` and every touched or affected suite done, see 10.2; `npm run build` and the full `npm run test:gate` not run by Dev) Ship drill step 1: `npm run build`; typecheck filtered to touched files (and checked for an OOM crash); `npm run lint:hooks`; the touched suites, then `npm run test:gate`, with the failure list diffed against `201ff9f3` (deduplicated).
- ✅ 11. Final `git grep` on the branch: every send hit is in `EMAIL_SEND_SITES`; no reader of `CRON_SECRET` outside the three allowed files.
- ✅ 12. (SA condition 1) `gaps/reply` checks `sent.success` and `allowlist_suppressed`, reads `data.message_id`; route test.
- ✅ 13. (SA condition 6) Files grouped into two commits (9.3); the A5 guard patch prepared and checked with `git apply --check --cached`.
- ✅ 14. (SA conditions 7, 8) Section 12 and the user notice updated.

### 10.1 Implementation notes (Dev, 2026-11-25)

| Item | What was done |
|---|---|
| E-8 API wording (condition 3) | Google's `events.insert` reference describes `sendUpdates` as "whether to send notifications about the creation of the new event. Note that some emails might still be sent. The default is false", with `none` meaning no notifications are sent. Because the stated default is a boolean for a string parameter, and because "some emails might still be sent", the code sets `none` explicitly rather than relying on omission. Google's .NET client docs add that `none` can stop the event syncing to attendees' external calendars; on a guarded environment that is the intent. Sources: the `events.insert` and `events.update` reference pages and the .NET `SendUpdatesEnum` page |
| Executor refusal shape | Gmail and Outlook return `{ message_id: null, sent_at: null, recipient_count: 0 (Gmail), allowlist_suppressed: true, note }`; Outlook also `status: 'not_sent'`. `sent_at` is null, not a timestamp, because nothing was sent |
| Unknown recipient shapes | `recipientsOf` keeps an object or number as an empty string, which the check refuses; Gmail's own builder drops such values silently, so the guard is the stricter of the two |
| Contact route | `checkOutboundRecipients` is called inline at each of the two sends and its verdict handed to a small `mayEmail` logger (SA code review item 2), so G-7 pins 2 checks for 2 sends. `emailSent` is true only when both sends happened, as before |
| Calendar update (SA CR-1) | `update_event` now checks the event's **existing attendees together with the new ones**. An update that removes attendees (`attendees: []`) used to leave the merged list empty and skip the check, while Google could still email the removed guests; now any refused existing or new attendee sets `sendUpdates=none` |
| `@` outside the brackets (SA code review item 3) | A recipient piece such as `x@other.example <listed@team.example>` is refused as unparseable: a provider might read either address |
| `gaps/reply` | 409 for a guard refusal, 502 for a failed send; neither deletes the draft or writes `reply_sent` |
| Cron migration | A script replaced each of the 22 inline `verifyCronSecret` functions, and the comment attached directly above it, with one line pointing at `lib/cron/cronAuth.ts`, and its call with `isAuthorizedCronRequest(request, logger)` (the module logger, as the old function used). Each route keeps its own `Unauthorized` warning and 401 body. The five fail-open routes were edited by hand; `run-scheduled-agents-direct` now checks auth before it builds its database client |
| `console.*` (D-12) | `update-template-scores` 4 and `run-scheduled-agents-direct` 11 converted to Pino with structured context (ids, counts); the direct route no longer logs agent names |
| Suites that needed an explicit environment | the 7 notification suites; `tests/plugins/unit-tests/google-mail.test.ts`, `outlook.test.ts`, `google-calendar.test.ts`; `lib/plugins/google-mail/__tests__/sendEmailDraft.test.ts`; `lib/business-os/data-export/__tests__/moduleExportWorker.test.ts` (T-W23). The `.invalid` suite runs as production with the list absent, because its rule does not depend on the environment |
| Display nuance for SA | The Environment page treats a whitespace-only value as "Not set" (`isSetValue`), while the guard treats a present-but-blank value as "on, nobody" (D-13). The page therefore under-reports that one case on Production; the guard is the safer of the two. Not changed here |

### 10.2 Verification output (Dev, local Windows)

**Touched and affected suites.** One combined run (`npx jest --json` over every group below plus every suite that reads the source of a touched file): **157 suites, 5,949 tests; 5,948 pass, 1 fails (pre-existing, below)**. By group (groups overlap the combined total):

| Group | Suites | Tests |
|---|---|---|
| A7 new: `recipientAllowList`, `emailTransport.allowList`, contact `route.allowList` | 3 | 58 |
| `lib/notifications/__tests__` (the 7 updated suites, `recordEmailSend`, and the new `allowList` suite) | 9 | 126 |
| A7 plugin suites: Gmail, Outlook, Google Calendar unit tests, `sendEmailDraft` | 4 | 126 |
| A7 `gaps/reply` route | 1 | 16 |
| A7 Environment page: `lib/admin/environment`, `app/admin/environment` | 7 | 207 |
| `lib/business-os/data-export` (T-W23 runs the real transport) | 18 | 624 |
| A5 new: `cronAuth`, `cronAuth.failClosed` | 2 | 63 |
| A5 cron, jobs and recorder suites (`app/api/cron`, `lib/cron`, `app/api/run-scheduled-agents`, `app/api/admin/jobs-queues`, `lib/admin/jobs`, the jobs-queues pages) | 50 | 1,867 |
| Guard suite `envConfigHardening.guard` (G-1 to G-7 and self-tests) | 1 | 70 |

One pre-existing failure seen and left alone: `lib/utils/__tests__/oneAddressPolicy.guard.test.ts` ("only the resolver and the documented exceptions read the variable") lists five files by Windows absolute path, four of which this slice does not touch; it compares Windows paths against POSIX exemptions, the same class as PROD-1a's throttled-guard note. Expected green on CI (Linux); QA to confirm.

**Negative checks (each mutation restored byte-exact, verified):** (a) a new `app/api/cron/x/route.ts` without the helper fails G-6 R1; (b) a route that reads `process.env.CRON_SECRET` in place of the helper fails R1 and R2; (c) a new lib file importing `nodemailer` fails G-7; (d) removing one `checkOutboundRecipients(` call from the Gmail executor fails G-7; (e) removing the check from `run-scheduled-agents-direct` fails R1 (condition 4).

**Guard suite time (condition 13).** Local Windows, each suite alone, three alternating runs: `origin/main` version 5.24 / 5.13 / 4.95 s; this branch, with a 19-needle `Buffer.includes` prefilter, 6.47 / 6.27 / 6.49 s (+1.3 s); after switching to one latin1 regex prefilter, 6.36 / 5.81 / 5.81 s (about **+0.6 to +1.1 s locally**). The CI number is owed on the PR; if CI shows more than +1 s, back to SA before merge.

**Typecheck.** `tsc --noEmit -p tsconfig.json` with an 8 GB heap: completed in 8 m 44 s, no out-of-memory crash (exit 2 with diagnostics, as on `main`; 1,856 diagnostics in the whole repo). Filtered to the 65 touched or new files: **8 diagnostics, all pre-existing**: 2 in `app/api/run-scheduled-agents-direct/route.ts` (the `onProgress` property on `RunAgentInput`, present on `origin/main` at line 140, untouched), and 3 each in `repliesReachTheBusiness.test.ts` and `unsubscribeHeader.test.ts` ("cannot redeclare block-scoped variable": both are script-mode files with top-level `let sendEmail` / `const sent` / `const base`, as on `origin/main`). **None in any new file.**

**lint:hooks.** `npm run lint:hooks`: clean (no warnings, no errors).

**After SA code review (CR-1, items 2 to 4).** Affected suites re-run (`lib/email`, `lib/notifications`, contact route, the Gmail, Outlook and Google Calendar unit tests, `lib/plugins/google-mail`, the guard suite, `gaps/reply`, `lib/admin/environment`, `moduleExportWorker`): **55 suites, 1,125 tests, all pass**. Both new tests were shown to fail without their fix (each file restored byte-exact afterwards): the calendar removal case fails when the existing attendees are left out of the check; the outside-`@` case fails when the new refusal is disabled. The guard file's change is in G-7 only: the A5-only version regenerated from it is byte-identical to before, and `prod-1b-a5-guard.patch` still passes `git apply --check --cached`. Typecheck re-run in full (8 GB heap, no out-of-memory crash, 1,856 diagnostics repo-wide as before): the same 8 pre-existing diagnostics in the 65 touched or new files, none new.

**Not run by Dev:** `npm run build` and the full `npm run test:gate` (owed by QA, with the gate failure list diffed against `201ff9f3`).

---

## 11. Test plan

### 11.1 `lib/email/__tests__/recipientAllowList.test.ts` (pure)

| Case | Expectation |
|---|---|
| `VERCEL_ENV=production`, variable absent | allowed, `basis: 'production'` (guard off; production does nothing new) |
| `VERCEL_ENV=production`, variable set, recipient not on it | refused, `recipient_not_allowed` (SA-E1: the guard is on) |
| `VERCEL_ENV=production`, variable set to empty or whitespace | refused, `allowlist_unset` (SA-E2, D-13) |
| `VERCEL_ENV=production`, variable set, recipient on it | allowed, `basis: 'allowlist'` |
| `VERCEL_ENV` `preview`, unset, `development`, `Production`, padded | treated as non-production |
| Non-production, list unset / empty / whitespace / only invalid entries | refused, `allowlist_unset` (**failure path: fail closed**) |
| Exact address, different case; display-name form `Name <addr>` | allowed |
| Domain entry: same domain; then a subdomain, a longer domain ending in the same text, the domain followed by more labels | allowed; then refused |
| `*`, `@*`, `*@x`, bare `team.example` | ignored and counted invalid; never allow anything |
| One element holding two comma-separated addresses, one refused | refused |
| One refused among several allowed | refused whole, `refusedCount` 1 |
| Unparseable recipient; empty recipient list | refused, `unparseable_recipient` |
| Verdict and errors | contain no address, only counts |

### 11.2 `lib/notifications/__tests__/emailTransport.allowList.test.ts`

`fetch`, `nodemailer` and `@/lib/supabaseServer` are mocked (no network, per `tests/jest-no-network.ts`).

| Case | Expectation |
|---|---|
| Non-production, recipient allowed, Resend configured | sent through the mocked Resend call (happy path) |
| Non-production, recipient refused, all three providers configured | `blocked: 'recipient_not_allowlisted'`; no fetch, no `sendMail` (neither SMTP nor the Gmail system sender), no `supabaseServer` call, no marketing gate call; one `info` line with counts only, and the logger spy shows no recipient address in any form, masked or not (**failure path**, SA-E2) |
| **Production, list set**, recipient refused (SA-E1) | refused exactly as above |
| **Production, list set but empty or whitespace** | refused, `allowlist_unset` (SA-E2, D-13) |
| Production, list set, recipient allowed | sent |
| A refused send, called twice by a drain-style caller | each call refused the same way; the transport itself never retries (SA-E2) |
| Non-production, list unset | refused as above |
| Production, list unset, recipient anywhere | sent, exactly as today (guard off) |
| Keyed send, non-production, refused | refused by the new check, before the "key cannot be honoured" warn |
| `.invalid` recipient, non-production | still `invalid_recipient` (order kept) |
| Marketing send, non-production, refused | refused before the consent gate runs |

### 11.3 `app/api/contact/__tests__/route.allowList.test.ts`

| Case | Expectation |
|---|---|
| Production, variable absent | both `sendMail` calls made; `emailSent: true` (unchanged) |
| Production, variable set, visitor not listed (SA-E1, SA-E3) | confirmation skipped; notification sent only if the team inbox is listed |
| Non-production, list unset | message saved; no `sendMail`; `200`, `emailSent: false`; the log line has no address (**failure path**) |
| Non-production, only the team inbox allowed | notification sent, confirmation skipped, `emailSent: false` |
| Non-production, both allowed | both sent, `emailSent: true` |

### 11.4 Plugin executors and the legacy helper

| Case | Expectation |
|---|---|
| Gmail `send_email`, non-production, a refused `bcc` | no send fetch; suppressed result (D-5) |
| Gmail `send_email`, calibration redirect to an allowed owner | sent to the owner (check runs after the redirect) |
| Gmail `reply_to_email` with `reply_all` widening to a refused address | no send fetch |
| Gmail `send_draft`, guard on | suppressed, no Gmail call at all (D-6 as changed by SA, condition 2) |
| Outlook `send_email`, refused `cc` | no Graph call |
| `sendEmailDraft`, refused | throws before the fetch |
| Google Calendar create/update, non-production: a refused attendee; then all attendees allowed | event written with `sendUpdates=none`; then `sendUpdates=all` |
| Google Calendar delete with `send_notifications: true`, non-production | `sendUpdates=none` |
| Each of the above in production with the variable absent | unchanged from today |
| Each refusal case in production with the variable set | refused the same way (same switch, D-4) |

### 11.5 `lib/cron/__tests__/cronAuth.test.ts`

| Case | Expectation |
|---|---|
| Production env, right secret | `true` (happy path) |
| Secret unset, empty, whitespace | `false`, one error line with the existing message (**failure path**) |
| Unset secret and header "Bearer undefined"; empty secret and header "Bearer " | `false` |
| Wrong secret same length, different length, with a suffix, lower-case `bearer`, no header | `false` |
| `NODE_ENV=development`, no `VERCEL_ENV`, no secret | `true` (local) |
| `NODE_ENV=development`, `VERCEL_ENV=preview` or `development`, no secret | `false` |
| `NODE_ENV=test`, no secret | `false` |
| Any case | the header and the secret never appear in a log call |

### 11.6 `app/api/cron/__tests__/cronAuth.failClosed.test.ts`

For the 5 fixed routes (#6, 7, 22, 27, 29), plus #28 `run-scheduled-agents` and every POST that runs a job (#3 `booking-money-reconcile`, #17 `insight-hypotheses`, #22 `memory-consolidation`) (SA condition 5), dependencies mocked to "nothing to do": secret unset with no header, secret unset with "Bearer undefined", secret set with a wrong header, and secret set with no header all get **401** and the work function is never called (**failure path**); the right secret reaches the work (**positive control**). 9 entry points, 45 cases.

### 11.7 Existing suites that must stay green

`app/api/cron/__tests__/runRecord.adoption.test.ts` (200 and 401 for every Business OS job: the net for the 22 mechanical edits), `qa-slice5-pr2.baseCompare.test.ts` (asserts recording only; the status for #6 and #7 in its unset-secret scenarios changes to 401, which it writes out and does not assert), `check-free-tier-expiration/__tests__/route.test.ts`, `freeTierExpiration.rd9.guard.test.ts`, `lib/cron/__tests__/*`, `lib/admin/environment/__tests__/*` (including `catalogueDrift.guard.test.ts`), `app/admin/environment/__tests__/*`.

### 11.8 Guards

| Check | Expectation |
|---|---|
| G-6, G-7 on the branch | pass; self-tests show every forbidden form caught in LF and CRLF |
| Negative checks (QA, recorded in 17, every file restored byte-exact) | (a) a new `app/api/cron/x/route.ts` without the helper fails G-6 R1; (b) a `process.env.CRON_SECRET` read in any route fails R2; (c) a new lib file importing `nodemailer` fails G-7 (a); (d) deleting one `checkOutboundRecipients(` call in the Gmail executor fails G-7 (b) |

---

## 12. Environment changes (handed to DevOps)

Done by DevOps, or by the user where the tier says so, following `env-change-protocol`. Names and roles only. The concrete record goes in the untracked private docs, with a by-role summary here.

### Step 0: confirm `CRON_SECRET` is live in Production (before merge)

| Field | Value |
|---|---|
| What | Positive evidence that Production's Vercel Cron calls carry a configured, matching secret today |
| Where (by role) | The web project's Production deployment |
| Tier | Read |
| When | On the day of the merge. Merge blocker |
| Why | After the merge, #6 and #7 refuse when the secret is missing, where today they run. If it were missing, calendar sync would stop |
| Probe | The admin Jobs page (or `bos_cron_runs`) shows a **recorded** Vercel cron run of `calendar-sync` within its interval plus grace. The recorder only writes a row when the secret is configured and matched (`cronRunRecorder.ts:86-93`), so a recent row cannot exist without it. The variable merely being listed is not enough |
| Executed by | DO |

### Step 1a: set the allow-list on Preview scoped to `main` (before merge; SA-E1)

| Field | Value |
|---|---|
| What | Add `EMAIL_RECIPIENT_ALLOWLIST` to the **Preview** target, **scoped to git branch `main`** (the staging host) |
| Tier | Reversible write, non-production. DevOps executes **only with the user's approval quoted verbatim** in the evidence (SA condition 7 a) |
| Before-state (names only) | `EMAIL_RECIPIENT_ALLOWLIST` absent on every target and every branch scope; which targets and branch scopes hold `RESEND_*`, `SMTP_*` and `GMAIL_*` names today (names, targets and branch scopes only, never values) |
| When | Before merge. Inert until the code reads it |
| Value rule | Team-owned addresses, or `@` entries for a team-owned domain only. Never a consumer mail domain; never a customer address |
| Not set on | The generic Preview scope (PR previews: the guard is on there and an unset list sends to nobody) and Development (local is the console transport; a developer who wants local delivery adds it to their own local env file) |
| How to undo | Remove it: on Preview that means "send to nobody", which is safe |
| Probe | Step 2 (d) |
| Executed by | DO, with the user's quoted approval |

### Step 1b: set the allow-list on Production, temporarily (before merge; SA-E1)

| Field | Value |
|---|---|
| What | Add `EMAIL_RECIPIENT_ALLOWLIST` to the **Production** target: today's Production target still serves the staging world with live crons, so the guard must be on there now. It comes off Production at the real cutover (step 3) |
| Tier | **Production: the user executes**, after SA has reviewed this plan |
| Before-state (names only) | As 1a, for the Production target |
| When | Before merge. The merge's own deployment picks it up, so the guard is live on Production from the first deployment of this code, with no unguarded gap |
| What the user is told first (TL; SA condition 8) | From that deployment on, mail from today's live environment (booking confirmations, reminders, invoices, briefings, invites, the contact form, a user's own Gmail or Outlook sends through the platform, and Google calendar invitations) reaches **only** listed addresses. Everyone else gets nothing, and nothing is re-sent later (SA-E2). **What it does NOT stop until PROD-1b.2:** Outlook calendar meeting requests, updates and cancellations, including booking sync for an Outlook-connected business. **Added 2026-11-26 (PROD-1b.2 SA condition 4; TL tells the user now):** nor, until PROD-1b.3, Google Drive share notifications (E-10) |
| Value rule | As 1a; the same value on both targets unless TL decides otherwise |
| How to undo | Removing it turns the guard **off** on Production at the next deployment (4.1); only at the cutover, or deliberately as a rollback (section 14). Production-tier: the user executes |
| Probe | Step 2 (c) |
| Executed by | User |

### Step 2: probe after deploy

| Field | Value |
|---|---|
| Tier | Read, plus two operator-triggered test sends to team-controlled addresses |
| Exact action | (0) The Production deployment's commit SHA equals the merge commit. (a) **Regression smoke, not the A5 proof** (SA condition 7 c): an unauthenticated `GET` of a cron route (for example `/api/cron/calendar-sync`) with no header, and again with "Bearer undefined", both **401**; on Production the secret is set and #6/#7 already refused a wrong header, so this cannot fail for A5 there. The A5 proof is 11.6 plus QA's negative checks. (b) The next scheduled `calendar-sync` run is recorded as succeeded, proving Vercel's own secret is still accepted. (c) **On Production** (SA condition 7 d), the surface is the admin **Invites** page, "create invite" (`POST /api/admin/business-os/invites`), which sends the invitation through the shared transport (E-1): one invite to a listed team address arrives; one to a team-controlled address deliberately **not** on the list logs `Email not sent: recipient not on the allow-list` with `isProduction: true` and does not arrive. **Records it creates:** one invite row per probe and its audit entries; revoke both probe invites afterwards (`/api/admin/business-os/invites/[inviteId]/revoke`), and note the two invite ids in the private evidence. The admin Environment page shows the row set with a non-zero valid-entry count. (d) The same pair on the `main` Preview deployment, once step 2a has given it email credentials |
| Probe can fail because | (0) fails on a stale deployment; (b) fails if Vercel's secret no longer matched; (c) fails if the guard were off on Production (the SA-E1 case) or if the variable did not reach the deployment; (d) fails if the Preview-scoped value is missing |
| Executed by | DO |

### Step 2a: copy email credentials to Preview scoped to `main` (SA-E4)

Owned by the PROD-3 Vercel plan, not by this slice. **Ordering gate:** it runs only after this PR is merged and deployed, steps 1a and 1b are done, and step 2 (c) has passed, so the staging host never holds working email credentials without the guard. Step 2 (d) is then run on that host.

### Step 3: at the real production cutover (PROD-3; gate recorded in the PROD-1 master doc)

| Field | Value |
|---|---|
| What | Remove `EMAIL_RECIPIENT_ALLOWLIST` from the **Production** target, in the same change window as the switch that makes Production serve the new production project |
| Tier | Production: the user executes |
| Also in the cutover change | The catalogue row flips to `exp('X','O','O')` (4.5), so the Environment page shows `should-not-be-set` if it ever reappears on real production. Preview scoped to `main` keeps the list |
| Other cutover checks | `CRON_SECRET` set on the new Production before its first cron fires (otherwise every cron refuses and logs: closed, but the jobs stop); the QStash signing keys set if `process-queue` is in use (otherwise it answers 500) |
| Probe | On real production after the cutover: the Environment page shows the row unset; a routine send to a customer address is delivered (`Email sent`), and zero `Email not sent: recipient not on the allow-list` lines appear with `isProduction: true`. Can fail if the variable was left on |
| Undo | Re-add the variable to Production (mail limited to the list again, fail closed) |

### Step 4: no change for Vercel Cron on staging

Vercel runs crons on Production only (strategy doc C6). Triggering a staging cron by hand or from a scheduled GitHub Action needs the staging `CRON_SECRET` on Preview; that is C6's work, not this slice's.

### Step 5: ordering gates (TL/BA to record in the PROD-1 master doc)

| Gate | Must be true first |
|---|---|
| Before step 2a (email credentials to Preview scoped to `main`) | This PR merged and deployed; steps 1a and 1b done; step 2 (c) passed (SA-E4) |
| Before A-4 (PROD-3 R2) | PROD-1b deployed and step 2 (c) passed (SA condition 7 e) |
| Before A-6 (testers on the staging host), latest C3 | PROD-1b.2 deployed (Outlook calendar meeting mail; SA condition 7 e) **and** PROD-1b.3 deployed (Google Drive share notifications, E-10; PROD-1b.2 SA condition 4) |
| Before the Production Branch switch (C3) | Everything above (SA-E4) |
| Before or with step 3 (list removed from Production) | The Production target is serving the new production project, not the staging world |

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | Testers on previews or locally see mail silently not arrive | One `info` line per refusal naming the reason; the Environment page shows the valid-entry count; callers already record `blocked` sends as skipped |
| R-2 | A refused send's queue row is closed as skipped and is not re-sent after the list is fixed | Intended: `blocked` is final by contract (`emailTransport.ts:273-280`) and SA-E2 rules out retries |
| R-3 | Production misdetected as non-production (`VERCEL_ENV` not exactly `production`) | Turns the guard on: fails closed and loudly. A preview build promoted to production is already forbidden (strategy doc C8) |
| R-4 | A consumer mail domain on the list makes it close to open | Step 1 value rule; the page shows the entry count; D-1 forbids wildcards. Optional SA call: refuse known consumer domains in the parser (not recommended: a list to maintain) |
| R-5 | A user-mailbox send or a Google invitation reaches a real person if those paths are left out | D-4 recommends them in this slice on the same switch; E-9 is PROD-1b.2, gated before the Production Branch switch |
| R-6 | One of the 22 mechanical cron edits passes the wrong logger or drops the check | G-6 R1, and the adoption suite's 200/401 per Business OS job; #28 gets the 11.6 assertions too |
| R-7 | Tests that set `VERCEL_ENV=production` or the list leak into other tests | Per-suite setup with restore in `afterEach`; Jest isolates modules per file; no global setup sets either variable, so a suite that forgets fails loudly instead of sending |
| R-8 | `vercel dev` users lose the cron bypass | D-8; documented in the helper's comment |
| R-9 | Guard false positives on a future legitimate send file | The registry is the intended friction: adding the file with its counts and a check is the fix, and the failure message says so |
| R-10 | Guard suite time grows | One pass, needles prefiltered; +1 s CI budget (PROD-1a C-9) |
| R-11 | (SA-E1) With the list on today's Production target, clients of businesses on the live environment stop receiving booking, reminder and invoice mail | Intended by SA-E1. TL tells the user before step 1b, with the list of what stops and what does not (Outlook meeting mail, until PROD-1b.2; SA condition 8) |
| R-14 | `sendUpdates=none` on a guarded Google event means its external attendees never get the event in their own calendars | Intended on a guarded environment; Google's own client docs warn of exactly this (10.1) |
| R-12 | The list is left on Production after the cutover, so real customers get no mail | Fails closed and loudly (a refusal line per send with `isProduction: true`); step 3 is in the cutover change, with its probe; the catalogue flip makes the page flag it. **Display gap (SA code review item 4):** a whitespace-only value shows as "Not set" on the Environment page (`isSetValue`), while the guard treats it as on and allows nobody (D-13), so the page would not flag exactly that case. Fix it in the same cutover change as the catalogue flip (show a present-but-blank allow-list as set, with 0 entries) |
| R-13 | Reverting this PR while the list is on Production removes the guard from the staging world on that target | Section 14: prefer a forward fix; a revert is taken knowingly, with TL deciding whether to pause the email-sending crons first |

---

## 14. Rollback

| Situation | Steps |
|---|---|
| Cron auth misbehaves | **Revert the A5 commit** only (SA condition 6). The email guard stays. `CRON_SECRET` was already required; no data change, no migration. The 5 fail-open routes are open again afterwards; tell DevOps so step 3's `CRON_SECRET` check for PROD-3 is not skipped |
| The email guard refuses mail it should send, on Production, before the cutover | Env-only: widen the Production value, or (to turn the guard off there) remove the variable from Production and redeploy. No code change. Turning it off re-exposes the staging world (R-13), so TL decides |
| The email guard misbehaves on Preview or locally | Widen the Preview value; or a forward fix. Reverting re-opens Preview to everyone, which is worse than a missing mail |
| Anything else, by revert | Revert the PR, knowing R-13: while the list is on Production, a revert removes the guard there. The variable itself is inert without the code and can stay set |
| Fast path | Vercel Instant Rollback to the pre-merge Production deployment has the same effect as a revert (R-13). Never across the production cutover (PROD-1a corollary) |

---

## 15. Observed, out of scope

| Observation | Where | Note |
|---|---|---|
| Strategy item F6 already closed | `insight-automations`, `insight-detect`, `insight-metrics` | Section 5; TL to update the master doc |
| Service-role clients built in routes (rule 1), body parsed without Zod (rule 2) | the contact route; `update-template-scores`, `run-scheduled-agents-direct`, `memory-consolidation`, `process-queue` | 9.2; candidates for a later repository slice |
| `console.*` in untouched files | `app/api/cron/process-queue/route.ts` (16), `lib/intelligence/utils/EmailHandler.ts` | Follow-up list (9.1) |
| Outlook calendar meeting requests | E-9 | PROD-1b.2 (D-4) |
| Google Drive share notifications (found 2026-11-26) | E-10 | PROD-1b.3 (PROD-1b.2 SA D-12) |
| Non-email outbound messages to third parties | Slack, Discord, WhatsApp, LinkedIn executors | Not A7 as approved; TL to decide whether staging needs the same treatment for them |
| `process-queue` has no verification where `NODE_ENV` is not `production` | `app/api/cron/process-queue/route.ts:429-431` | Local only; every Vercel deployment runs with `NODE_ENV=production`. Unchanged (D-9) |
| Callers that log `to` in clear on a not-sent result (SA condition 12) | for example `PaymentReminderService`'s "Payment reminder not sent" line | On a guarded environment they log one address per refused send. Follow-up, not this slice |
| Pre-existing Windows-only guard failure | `lib/utils/__tests__/oneAddressPolicy.guard.test.ts` | Compares Windows absolute paths against POSIX exemptions; 4 of the 5 files it names are untouched here (10.2) |
| Two sunset routes still deployed | `memory-consolidation`, `update-template-scores`; and the unscheduled `run-scheduled-agents-direct` | Auth fixed here; whether to delete them is an owner decision |

---

## 16. SA Review Notes

**Reviewed by SA — 2026-11-25 (workplan review)**
**Status:** Approved with conditions (8 blocking, 6 non-blocking, below). Implementation may start; the blocking conditions are checked at code review.

### What was verified at `origin/main` `201ff9f3`

| Claim | Result |
|---|---|
| 27 `app/api/cron/*/route.ts`; 24 `vercel.json` paths (23 cron + `/api/run-scheduled-agents`) | Confirmed |
| 22 inline fail-closed copies (#1-5, 9-21, 23, 24, 26, 28) | Confirmed: each carries the `refusing cron request (fail-closed)` refusal and the `NODE_ENV === 'development'` bypass |
| 5 fail open: #6, #7 (`if (CRON_SECRET && …)` plus `NODE_ENV === 'production'`), #22 (`NODE_ENV !== 'production'` allows all; unset secret allows), #27, #29 (template compare, "Bearer undefined") | Confirmed, line shapes as stated |
| 2 exemptions: #8 (`hasCronSecret`, sha256 + `timingSafeEqual`, no dev bypass), #25 (`verifySignatureAppRouter` when `NODE_ENV === 'production'`) | Confirmed |
| Non-test readers of `CRON_SECRET` | The 29 routes, `cronRunRecorder.ts`, the catalogue row (data), and four files that only name it in comments (`admin/business-os/credits/boost/reconcile`, `admin/jobs-queues/drain`, `invites/inviteState.ts`, `BusinessOsCreditLotRepository.ts`). R2's "`process.env` forms only" correctly ignores the comments. No server-side caller of any `/api/cron/*` URL exists |
| `runRecord.adoption.test.ts` as the net for the mechanical edits | Confirmed: it iterates `BOS_CRON_JOBS` (all 23 scheduled cron routes, #6 and #7 included) with a 200 and a 401 case each. It does **not** cover #28, the job-running POSTs, or #22/#27/#29 (condition 5) |
| Email send sites E-1 to E-8, E-9, N-1 to N-4 | Confirmed by grep (nodemailer, `createTransport(`, `.sendMail(`, `api.resend.com`, resend/SendGrid/Postmark/Mailgun/SES, Gmail `messages/send` and `drafts/send`, Graph `/sendMail`, `sendUpdates`, `send_notifications`, `inviteUserByEmail`/`resetPasswordForEmail`/`signInWithOtp`/`generateLink`, mail-like `fetch`). No deployed send path is missed. `lib/pilot/NotificationService.ts` and every other mailer go through E-1; `CapabilityEngine.sendEmail` only logs; `createReply` in the Outlook executor makes a draft only; `scripts/validate-gmail.mjs` is an operator script like N-3 |
| `SendEmailParams` recipients | `to` only (no cc/bcc), so checking `p.to` covers E-1 |
| Drains treat `blocked` as final | Confirmed for `InsightActionDispatchService.outcomeFromSend`, `moduleExportSending`, `bizql/mutate/emailSend`; `DailyBriefingDispatchService` and `PaymentReminderService` treat any `!sent` as skipped / not sent, never as sent. `recordEmailSend` writes `status: 'failed'`, `sent_at: null`. Nothing marks a refused transport send as sent |
| Executor retry (`base-plugin-executor.ts`) | Retries **only** on an HTTP 401 (`httpStatusOf(firstError) === 401`). So D-5's stated reason ("success-shaped so the retry path never re-runs it") is not the real one: a plain thrown guard error would not be retried by the executor either. The real reason is below |
| SA-E1 to SA-E4 | E-1, E-2, E-3 honoured. E-4 is honoured for step 2a and C3, but the "before A-4" gate from the PROD-3 ruling is missing (condition 7). The SA-E3 row in 1.1 omits the clause of the PROD-3 ruling that put user-mailbox sends out of scope; D-4 below supersedes that clause deliberately, so the omission is now correct, and is recorded here |

### Rulings on section 8

| # | Ruling | Reason |
|---|---|---|
| D-1 | **Approve** `EMAIL_RECIPIENT_ALLOWLIST`, exact addresses and `@domain`, no wildcards, nothing valid = nobody | Matches PROD-3 R2.2; no consumer-domain blocklist (R-4 value rule is enough) |
| D-2 | **Approve** refuse whole | Same as `.invalid`; PROD-3 R2.2 forbids a sink rewrite, and a subset changes the message |
| D-3 | **Approve**, server-only `VERCEL_ENV` reader in `lib/utils/deploymentEnvironment.ts` | It moves the one existing private definition. Its comment must say it reads the runtime `VERCEL_ENV` only, unlike `origins.ts`'s build-inlined `NEXT_PUBLIC_VERCEL_ENV`-first reader, and is not a second origin resolver (non-blocking condition 14) |
| D-4 | **Approve** E-3 to E-8 in this slice on the same switch; **approve** E-9 as PROD-1b.2 with a tighter gate | Today's Production *is* the staging world with scheduled agents (`run-scheduled-agents` every 5 minutes); an agent mailing a real contact there is the exact A7 hazard. With zero real customers, limiting a live user's own sends while the list sits on Production is acceptable. This supersedes my PROD-3 R2.3 "user-mailbox sends out of scope". E-9 is reachable from a first-party flow (`CalendarSyncService` maps `outlook` → the Outlook executor's `create_event`/`update_event`/`delete_event` with the booking client as attendee), so the list does **not** stop Outlook meeting mail until PROD-1b.2: conditions 7 and 8 |
| D-5 | **Approve** success-shaped suppressed result, **with condition 1** | Correct for agent runs: a thrown error fails the run, and a failed scheduled run is re-run up to the dead-letter cap (each re-run repeats the earlier steps' LLM work), all hitting the same refusal. Not safe as-is for the one first-party caller: `app/api/business-os/gaps/reply/route.ts` never checks the result, so it would delete the agent's draft and write a `reply_sent` activity for a reply that never went |
| D-6 | **Change** to the alternative: refuse every `send_draft` while the guard is on (suppressed shape), no draft read | Smaller and certainly fail-closed: no header parsing, no question of whether the metadata read returns `Bcc`, no new Gmail call. No first-party caller uses `send_draft`. Revisit only if a tester needs it (condition 2) |
| D-7 | **Approve C2a** (all 27 now) | The net already covers all 23 scheduled cron routes; one shape means G-6 needs no legacy list; the edits are mechanical deletions. Conditions 5 and 6 make it reviewable and separately revertible |
| D-8 | **Approve** local-only bypass (`NODE_ENV === 'development'` and `VERCEL_ENV` unset or empty) | Tighter than today; `vercel dev` needing the secret is acceptable (R-8) |
| D-9 | **Approve** both exempt, with "still has its check" self-tests | Different credential (#25) and a stricter check (#8) |
| D-10 | **Approve** fix with the helper; deletion stays an owner decision | No caller found; fixing the auth is in scope, deleting is not |
| D-11 | **Approve** personal kind `list-email-allowlist`, counted by the guard's own parser, `exp('O','O','O')` now, `exp('X','O','O')` at cutover | The `parseAdminEmails` precedent; page and guard cannot disagree |
| D-12 | **Approve** converting the 15 `console.*` calls in the two route files | PROD-1a D-4 precedent; counts re-measured (4 and 11); every other touched file has none |
| D-13 | **Approve** presence is the switch: present-but-empty or whitespace = guard on, nobody | A value someone set on purpose must never read as "no guard"; R-12 and the step 3 probe catch it being left |

### Conditions

1. **(blocking) D-5 caller.** In `app/api/business-os/gaps/reply/route.ts`, treat `!sent.success` or `sent.data?.allowlist_suppressed === true` as not sent: no `delete_draft`, no `reply_sent` activity, and a plain error the owner sees (not sent; this environment only sends to listed addresses). In the same lines, read the id from `sent.data?.message_id` (today it reads `message_id` off the `ExecutionResult`, which is always undefined). No other change to the route. One route test with the executer mocked: suppressed, failed, sent. Reason: with D-4 on today's Production the guard turns this route's existing blind spot into a certain false "reply sent" plus a lost draft.
2. **(blocking) D-6 as changed.** `send_draft` while the guard is on returns the suppressed result without any Gmail call. G-7's Gmail pin stays 3 dispatch / 3 check (the check call is the guard-on test).
3. **(blocking) E-8.** When the guard is on and not every attendee is allowed (create, update), and on every delete while the guard is on, set `sendUpdates=none` **explicitly** instead of omitting the parameter. Dev records the API reference wording in 10.1. Omission leaves it to Google's default; an explicit `none` cannot.
4. **(blocking) G-6 covers #29.** Add `app/api/run-scheduled-agents-direct/route.ts` to the R1 entry points through an explicit, self-tested `EXTRA_CRON_ENTRY_POINTS` list (each file must exist). After the fix it no longer reads `CRON_SECRET`, so neither the directory walk, `vercel.json` nor R2 would notice its check being removed, which is how it was open in the first place.
5. **(blocking) 11.6 extended.** Add #28 `run-scheduled-agents` (R-6 promises it; 11.6 omits it) and every POST that runs the job (#3 `booking-money-reconcile`, #17 `insight-hypotheses`, #22 `memory-consolidation`): unset secret and wrong secret both 401, work function not called.
6. **(blocking) Two commits.** A5 (helper, 27 routes, 2 `console.*` conversions, G-6, 11.5 to 11.7) and A7 (email guard, executors, contact route, gaps/reply fix, catalogue, G-7, 11.1 to 11.4) as separate Conventional Commits, so a cron-only problem can be reverted without removing the email guard from the staging world (R-13). Update section 14's first row to "revert the A5 commit".
7. **(blocking) Section 12 to env-change-protocol.** (a) Split step 1 into **1a** (Preview scoped to `main`: reversible write, DO only with the user's approval quoted verbatim) and **1b** (Production: the user executes), one change each. (b) Give each a before-state, names only: the variable absent on every target; which targets and branch scopes hold `RESEND_*`, `SMTP_*`, `GMAIL_*` names today. (c) Step 2 (a) cannot fail for A5 on Production: the secret is set there and #6/#7 already refused a wrong header on Vercel. Relabel it a regression smoke; the A5 proof is 11.6 plus QA's negative checks, and the Production probes are (0) and (b). (d) Step 2 (c) names the exact surface used for the operator-triggered send and any record it creates. (e) Step 5 gains: "PROD-1b deployed and step 2 (c) passed before A-4" (PROD-3 R2), and moves the PROD-1b.2 gate to "before A-6 (testers on the staging host), latest C3".
8. **(blocking) User notice before step 1b.** TL's notice must state what the list does **not** stop until PROD-1b.2: Outlook calendar meeting requests, updates and cancellations, including booking sync for an Outlook-connected business. Without it the user is told everything outside the list stops, which is not true.
9. (non-blocking) G-7 patterns: add the client-library dot forms `messages.send(` and `drafts.send(`, Calendar's deprecated `sendNotifications`, Graph `/replyAll` and `/forward` (lookaround-bounded), and the hosts `api.sendgrid.com`, `api.mailgun.net`, `api.postmarkapp.com`, `api.brevo.com` to the presence list. Register the Supabase Auth senders (`inviteUserByEmail(`, `resetPasswordForEmail(`, `signInWithOtp(`) with zero required checks and the N-1 reason, so a new one is reviewed rather than unseen. Each addition gets its LF/CRLF self-test.
10. (non-blocking) G-6 R1 matches the negated form `!isAuthorizedCronRequest(`, so a call whose result is ignored fails the rule.
11. (non-blocking) The E-1 refusal line drops the subject excerpt (subjects carry client names); log `kind` instead.
12. (non-blocking) Section 15 gains: callers that log `to` in clear on a not-sent result (for example `PaymentReminderService` "Payment reminder not sent") will log one address per refused send on staging. Follow-up, not this slice.
13. (non-blocking) Suite time: G-6 and G-7 join the existing one-pass guard suite, so no new job or worker (meets the no-added-CI-time rule). If CI shows more than +1 s on that suite, return to SA before merge.
14. (non-blocking) D-3 comment as stated in the D-3 ruling.

### Guard design check (G-6, G-7)

- **Can fail:** yes. G-6 fails on an unregistered route, a `vercel.json` path with no file, a `CRON_SECRET` read outside the three files, an exemption whose alternative check is gone, and a walk below its floors. G-7 fails both ways on the file set and on any change to a file's pinned dispatch or check count. The QA negative checks in 11.8 exercise one failure per rule. Residual gap: a check moved away from its send but kept at the same count passes. That is accepted, because the unit tests in 11.2 and 11.4 cover behaviour.
- **Line-ending proof:** yes, as PROD-1a 6.4: no newline, anchor or multiline flag in any pattern, CR LF normalised once, paths normalised to `/`, and LF/CRLF twin self-tests.
- **CI time:** it fits the existing gate (condition 13).

### Rollback (R-13)

Sound once condition 6 holds. An env-only response (widen the list, or remove it from Production deliberately) is correctly preferred to a revert. Instant Rollback carries the same R-13 cost and is never taken across the cutover. Removing the variable from Production is a Production-tier step: the user executes it, and it takes effect at the next deployment.

### Approval

- [x] Workplan approved. Proceed to implementation under conditions 1 to 8 (blocking, verified at code review) and 9 to 14 (non-blocking).
- [ ] Section 12 steps 1b and 3 (Production) are cleared for the user to run at their stated points once condition 7 is reflected in the plan.

### SA code review: PROD-1b

**Code Review by SA — 2026-11-25**
**Status:** Approved with conditions. There is one blocking condition (CR-1). It is a small fix that SA re-checks from the diff alone, with no new full review. After CR-1, the code is approved for QA.

**How it was reviewed.** I read the uncommitted working tree on `fix/prod-1b-email-guard-cron-auth` against `201ff9f3`, file by file for every send site and every hand-edited cron route, and by tally for the 22 scripted ones. On the full branch tree I ran the A7 suites and the guard suite: 54 suites and 1,079 tests, all passing. To check the commit split, I built a throwaway detached worktree at `201ff9f3` and copied in only the 33 commit-1 files from 9.3. Then I applied Dev's `prod-1b-a5-guard.patch` with `git apply`. The result: no commit-1 file names any A7 symbol. The A5 suites, the cron and jobs suites and the guard suite passed (27 suites, 1,091 tests). A typecheck of the commit-1 files completed without running out of memory, with only the two errors already on `main` (`onProgress` in `run-scheduled-agents-direct`). **Commit 1 stands alone.** The throwaway worktree is removed. Its `node_modules` junction was deleted first, so the shared `node_modules` was untouched.

**Blocking conditions 1 to 8, verified in the code:**

| # | Verified |
|---|---|
| 1 | `gaps/reply/route.ts`: `!sent?.success` or `data.allowlist_suppressed === true` returns 409 (suppressed) or 502 (failed) before `delete_draft` and `reply_sent`. The id is read from `sent.data.message_id`. The three route tests cover suppressed, failed and sent |
| 2 | `sendDraft`: `if (isRecipientGuardOn())` returns the suppressed result before any fetch |
| 3 | Google Calendar: `suppressInvitations` sets `sendUpdates=none` on a refused create or update and on every guarded delete. **One gap: CR-1** |
| 4 | `EXTRA_CRON_ENTRY_POINTS` holds `run-scheduled-agents-direct`. A self-test checks that it exists, and Dev's negative check (e) fails R1 |
| 5 | `cronAuth.failClosed.test.ts` runs in the commit-1 tree. The POSTs on #3 and #17 call `runJob`, and #22's POST calls `GET`, so each sits behind the helper |
| 6 | The split is sound (see above). The guard file is the only shared file, and the patch keeps the A5 half free of A7 |
| 7 | §12: steps 1a and 1b each have a names-only before-state. 2(a) is relabelled as a regression smoke. 2(c) names the admin Invites surface and the records it creates, and revokes them. Step 5 has the A-4 and A-6 gates |
| 8 | The step 1b notice says what the list does NOT stop until PROD-1b.2 |

**Also verified.**
- `cronAuth.ts` fails closed: it compares sha256 digests with `timingSafeEqual`, treats a whitespace secret as unset, and returns false on any exception. The development bypass applies only when `VERCEL_ENV` is empty.
- Every one of the 27 helper routes has exactly one `!isAuthorizedCronRequest(` call and no leftover `verifyCronSecret`, `verifyCronRequest` or `process.env.CRON_SECRET`. The dev-only POSTs still answer 405.
- The transport check runs after the caller-bug and keyed checks and before the consent gate. It logs counts and `kind`, never the subject.
- The parser rejects CR LF and a second `@`, and nothing matches a wildcard. A mixed list is refused whole.
- G-6 and G-7 can fail, and both are safe across line endings. The prefilter covers every pattern. No `console.*` is left in the two converted files.

**Code review comments**

1. **CR-1 (High, blocking)** `lib/server/google-calendar-plugin-executor.ts`, `updateEvent`. The guard checks only the merged `eventBody.attendees`. An update that **removes** attendees (`attendees: []` on an event that already has them) skips the check, so `sendUpdates` is omitted rather than set to `none`. Google may then email the removed guests, the gap condition 3 was there to close. Fix: while the guard is on, check `existingEvent.attendees` and the new list together, and set `none` unless every address in both is allowed. Add one unit test for this case.
2. (Medium, non-blocking) `app/api/contact/route.ts` pins 2 dispatches to 1 check because `mayEmail` holds the only `checkOutboundRecipients(` call. Removing one `mayEmail(…)` call therefore leaves G-7 green. Only `route.allowList.test.ts` would catch it. Give that registry entry a site-specific check pattern (`mayEmail(`, pinned at 2), or call the check inline at each send. Either can follow later.
3. (Low, non-blocking) `checkOutboundRecipients` accepts `victim@x.com <listed@team.example>` on the bracketed address. Nodemailer and Resend deliver to the bracketed address, so this is not a leak there, but Gmail's own header parsing of an unquoted `@` in a display name is unverified. Cheap hardening: refuse a piece whose text outside the brackets contains `@`.
4. (Low, non-blocking; Dev point b) On the Environment page, a whitespace-only value shows "Not set" while the guard treats it as on, allowing nobody. Step 3's probe catches this at cutover, because a refusal line with `isProduction: true` fails it. Accepted for now. Add it to R-12, and fix the display for this kind when the catalogue flips to `exp('X','O','O')`.

**Dev's flagged points:**
- (a) Condition 13: accepted as written. The local cost is +0.6 to 1.1 s. The CI time of the guard suite, on the PR run against a recent `main` run, is owed by QA or RM before merge; if it is more than +1 s, back to SA.
- (c) Events kept out of external attendees' calendars under `none`: intended on a guarded environment, and covered by the step 1b notice ("Google calendar invitations").
- (d) Suppressed sends report `sent_at: null`: correct, since nothing was sent.
- (e) Refusing object or number recipients: correct, because it fails closed.
- (f) See comment 2.
- (g) Authenticating before the DB client is built, and dropping agent names from the logs: approved.
- (h) The 22 deleted comments: approved. The reasoning now lives in the helper's header, and the history stays in git.

**Code approved for QA:** Yes, once CR-1 is fixed (SA re-checks the diff). QA still owes `npm run build`, the full `test:gate` diffed against `201ff9f3`, the CI guard-suite time, and the 11.8 negative checks. RM commits in the two-commit order of 9.3.

**SA re-check of CR-1 and items 2 to 4 — 2026-11-25. Status: Code Approved for QA.**

| Item | Verified |
|---|---|
| CR-1 | In `updateEvent`, the check now runs over the existing attendees and the new ones together. A refused attendee, or an attendee with no address, sets `sendUpdates=none`. With the guard off, `checkOutboundRecipients` returns allowed at once, so production is unchanged. Two new tests cover a refused existing attendee and a removal (`attendees: []`). G-7 still pins this file at 4 sends and 3 checks |
| 2 | `contact/route.ts` calls `checkOutboundRecipients` inline at each of the two sends. The G-7 pin is now 2 sends and 2 checks, in the email half of the guard file, so the cron-only patch is unaffected |
| 3 | The allow-list check refuses a recipient that has an `@` outside the angle brackets, so only a single unambiguous address is allowed |
| 4 | R-12 now records the Environment-page display gap |

Suites run: Google Calendar, contact, `lib/email` and the guard suite, 37 suites and 713 tests, all passing. `git apply --check --cached` with the A5 patch still passes. Every condition from the code review is now closed. QA and RM proceed as stated above.

---

## 17. QA Testing Report

**QA — 2026-11-25**
**Test mode:** full
**Strategy used:** A (unit: the helper, the parser, the transport), B (route suites with mocked Supabase and executers), C (a script that breaks the guard, then restores the tree), and the full `test:gate` diffed against a baseline. No browser check was needed, because no UI flow changed.
**Focus:** api, security, schema (guards), performance (guard-suite time)
**Skipped:** none. The CI guard-suite time can only be read on the PR run (SA condition 13), so the local figure is below.
**Input source:** the TL prompt (the 7 owed items), §10, §11.6, §11.8, §16

Tested on the uncommitted tree of `fix/prod-1b-email-guard-cron-auth`, after CR-1 and SA's re-check.

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| `npm run build` succeeds | ✅ | Pass | Run with the placeholder env from `build.yml` (`https://ci.invalid`, `ci-not-a-real-key`; no real secrets), `NODE_OPTIONS=--max-old-space-size=6144`: **exit 0**, 333 pages, no V8/OOM trace. The `DYNAMIC_SERVER_USAGE` lines are normal page-collection noise. A first attempt with no env at all failed in "Collecting page data" (`supabaseUrl is required`), because this worktree has no `.env.local`. That is an environment gap, not caused by this slice: CI sets exactly these placeholders |
| Full `test:gate`, diffed against `201ff9f3` | ✅ | Pass | The baseline is `git archive 201ff9f3`, extracted into a scratch dir, with a temporary `node_modules` junction (removed as a link only afterwards; the shared `node_modules` was unchanged, with 842 entries before and after). Branch: 2,112 suites, 20 failed (30 tests). Base: 2,107 suites, 24 failed (34 tests). Failures were compared by suite path and test name (from `--json`, so each counts once). **New failures on the branch: 0 suites, 0 tests.** 20 suites fail on both. Four fail only on the baseline: `tailwind-css-escape.guard`, `BusinessDataExportRepository` C-5, `security-definer-surface.guard` O-1, and `jest-gate-check.g8`. These are artifacts of a non-git scratch extraction, not real differences. The +5 suites are the five new ones |
| `oneAddressPolicy.guard` (Windows-only) is pre-existing | ✅ | Pass (pre-existing) | It fails the same way on the baseline extraction ("only the resolver and the documented exceptions read the variable"), and it is in the common list above |
| §11.8 negative checks: each break turns the guard red | ✅ | Pass | 7 mutations, below. Before them, the guard was 70/70 green; after them it was 70/70 again |
| Cron happy path and failure path | ✅ | Pass | `cronAuth.test.ts`: the right secret passes; unset, empty, whitespace or wrong secrets, `Bearer undefined`, `Bearer `, lower-case `bearer`, a missing header, and preview/development/test without a secret are all refused. The header and the secret are never logged. `cronAuth.failClosed.test.ts`: 9 entry points (#3 POST, #6, #7, #17 POST, #22, #27, #28, #29) × 4 refusal cases return **401 and do no work**. The right secret reaches the work (positive control) |
| Email happy path and failure path | ✅ | Pass | `emailTransport.allowList`: with the guard off (production, no list), a send goes out. With a list set (preview or production), a listed address is sent and an unlisted one is refused before any provider, database or consent gate. A mixed `to` is refused whole (`recipientCount: 2, refusedCount: 1`). A refused send asked twice is refused twice (the transport has no retry). The refusal line holds only `{reason, isProduction, recipientCount, refusedCount, kind}`, with no address, domain or subject. An empty or whitespace list on production, or no list off production, sends to nobody |
| `gaps/reply` leaves the draft on a not-sent reply | ✅ | Pass | A suppressed reply returns 409 and a failed one 502. Neither calls `delete_draft` or writes `reply_sent`. A sent reply reads `data.message_id`, deletes the draft and writes `reply_sent` |
| Calendar removal (CR-1) | ✅ | Pass | `update_event` with `attendees: []` on an event that has a refused attendee gives `sendUpdates=none`. A guarded delete gives `none`; production with no list keeps `all` |
| Contact route | ✅ | Pass | 4 cases from §11.3, including "nothing sent, no address logged" |
| Commit split (§9.3) | ✅ | Pass | `git apply --check --cached prod-1b-a5-guard.patch` succeeds. The patch names no A7 symbol. The 33 commit-1 files (3 new, 25 cron routes, 2 scheduler routes, the drain guard test, 2 cron route tests) contain none of `checkOutboundRecipients`, `recipientAllowList`, `EMAIL_RECIPIENT_ALLOWLIST`, `isRecipientGuardOn`, `deploymentEnvironment`, `isProductionDeployment` or `allowlist_suppressed`, and import no A7 file |
| Guard-suite time (SA condition 13) | ✅ | Pass (local) | Local Windows, the suite alone, alternating runs, the first pair discarded as warm-up. Base: 5.13 / 6.90 / 4.14 s, 31 tests. Branch: 5.90 / 5.10 / 5.02 s, 70 tests. Means 5.39 s vs 5.34 s, and the spread is wider than the difference. That is **well under +1 s** locally. The CI time is still owed on the PR (RM) |
| Privacy of the diff | ✅ | Pass | Scanned the whole diff, including new files. There are no personal or user paths, no Supabase project refs or `supabase.co` URLs, no Vercel project or team ids, and no key-shaped secrets (the only `sk_`/key-like strings are test placeholders). Every email address is a reserved test domain (`*.example`, `.invalid`), except `hello@agentpilot.ai`, which is the existing public team inbox, already on `main`. The workplan's fail-open description (§6.3) is a design-level behaviour table that depends on an unset secret, not an attack narrative. The one "victim@" string is a parser test case in SA comment 3 |

### Negative checks (§11.8, plus TL items)

Script: `qa1b-negchecks.js` in the QA scratchpad. Every modified file was restored from its original bytes, and its sha256 was checked before and after. New files and directories were deleted. A hash of `git status` plus the diff plus the untracked-file hashes was **identical** before and after the run.

| # | Mutation | Guard result |
|---|---|---|
| a | New `app/api/cron/qa-neg-a/route.ts` without the helper | Red: G-6 R1 |
| b1 | New cron route that calls the helper **and** reads `process.env.CRON_SECRET` | Red: G-6 R2 |
| b2 | `calendar-sync` compares against `process.env.CRON_SECRET` instead of calling the helper | Red: G-6 R1 + R2 (sha `2e2748c5…` restored) |
| c | New `lib/qa-neg-c-mailer.ts` importing `nodemailer` | Red: G-7 |
| d | Gmail executor: the `reply_to_email` `checkOutboundRecipients(` call removed | Red: G-7 (sha `55bcd471…` restored) |
| e | `run-scheduled-agents-direct`: the `!isAuthorizedCronRequest(` check replaced with `if (false)` | Red: G-6 R1 (sha `74deb43a…` restored) |
| f | Contact route: the notification send's inline check removed (1 of 2) | Red: G-7 (sha `46e8a5be…` restored) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The CI guard-suite time still has to be read on the PR (condition 13).

#### Edge Cases (nice to fix)
1. **Local build needs the CI placeholder env** (not caused by this slice). In a worktree without `.env.local`, `npm run build` fails at page-data collection. Exporting the placeholder block from `build.yml` makes it pass. Low.

### Test Outputs / Logs

```text
Behaviour suites (lib/cron, app/api/cron/__tests__, lib/email, lib/notifications, contact, gaps/reply,
Gmail/Outlook/Google Calendar unit, lib/plugins/google-mail, guard, run-scheduled-agents, admin/jobs-queues):
Test Suites: 69 passed, 69 total   Tests: 1928 passed, 1928 total

test:gate branch : Test Suites: 20 failed, 2092 passed, 2112 total   Tests: 30 failed, 29 skipped, 51900 passed
test:gate base   : Test Suites: 24 failed, 2083 passed, 2107 total   Tests: 34 failed, 29 skipped, 51713 passed
NEW failing suites on branch: (none)    NEW failing tests on branch: (none)

npm run build (CI placeholder env): EXIT 0
```

### Final Status
- [x] All acceptance criteria pass: ready for commit (RM: two commits per §9.3, A5 first via the patch)
- [ ] Issues found: Dev must address before commit

Still owed outside QA: the CI guard-suite time on the PR (condition 13, >+1 s goes back to SA), and the DevOps steps 0, 1a and 1b before merge (§12).

---

## 18. Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-11-25 | Workplan created | Dev: email path inventory (8 guarded, 1 follow-up, 4 no change) and cron entry point inventory (29: 22 inline fail-closed, 5 fail open, 2 closed by other means) from `origin/main` `201ff9f3`; recipient guard and cron helper design; G-6 and G-7; DevOps handoff; decisions D-1 to D-12 for SA |
| 2026-11-25 | SA email rulings folded in | SA-E1 to SA-E4 (from the PROD-3 Vercel plan review) recorded in 1.1: guard also on in production while the variable is set; empty or unset while on = nobody, logged without addresses, never retried; all three transports and `/api/contact`; merge before the Preview email-credential copy and the Production Branch switch. Updated 3.1, 4.1, 4.4, 4.5, 8 (D-4, D-11, new D-13), 11, 12 (targets: Preview scoped to `main`, Production temporarily; step 2a; gates), 13 (R-11 to R-13), 14 |
| 2026-11-25 | SA workplan review | Approved with conditions: 8 blocking (gaps/reply suppressed-send handling, `send_draft` refused while guarded, explicit `sendUpdates=none`, #29 in G-6, 11.6 extended, two commits, section 12 split/before-state/probe/gates, E-9 user notice), 6 non-blocking; D-6 changed to the refuse-all alternative, all other decisions approved |
| 2026-11-25 | Implemented; SA conditions folded in | Dev: conditions 1 to 12 and 14 implemented (condition 13 measured locally, CI owed): `gaps/reply` honours a not-sent reply; `send_draft` refused whenever the guard is on; Google `sendUpdates=none` explicit; G-6 explicit extra entry point and negated-call rule; 11.6 extended to #28 and the job-running POSTs; two commit groups with an A5 guard patch (9.3); section 12 split into 1a/1b with names-only before-states, 2(a) relabelled, the 2(c) surface named, gates before A-4 and A-6; the Outlook calendar gap stated in the user notice; extra G-7 patterns; no subject in the refusal line. Verification in 10.2 |
| 2026-11-25 | SA code review | Approved with conditions: one blocking (CR-1, a Google Calendar update that removes attendees must set `sendUpdates=none`), three non-blocking; commit 1 verified standalone in a throwaway worktree (suites green, no new type errors) |
| 2026-11-25 | SA code review conditions applied | Dev: CR-1 (calendar `update_event` checks existing and new attendees together; removal test); item 2 (contact route checks inline at each send, G-7 pin 2 / 2); item 3 (`@` outside the angle brackets refused; test); item 4 (whitespace display gap recorded on R-12, fix at the catalogue flip). 55 suites / 1,125 tests pass; A5 guard patch still valid |
| 2026-11-25 | SA re-check | CR-1 and items 2 to 4 verified; Code Approved for QA |
| 2026-11-25 | QA report | PASS: build exit 0 (CI placeholder env); `test:gate` 0 new failures vs `201ff9f3`; 7 negative checks red, tree restored byte-exact; A5 patch applies, no A7 refs; guard suite within +1 s locally; privacy scan clean (§17) |
| 2026-11-26 | PROD-1b.2 follow-up recorded (its SA condition 4) | E-9 row: the booking-sync exposure is latent (O-1, tracked as "O-1 Outlook booking sync parameter bug (ClickUp, under PROD-1)"). New E-10 row: Google Drive share notifications, PROD-1b.3, gate before A-6. Section 12 step 1b notice and step 5 A-6 gate now name both PROD-1b.2 and PROD-1b.3. The G-7 "Pending (D-4)" row marked flipped by PROD-1b.2 |
