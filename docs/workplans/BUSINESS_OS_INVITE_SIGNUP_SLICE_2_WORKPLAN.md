# Workplan: Business OS Invite-Only Signup, Slice 2 (The invitation email)

> **Last Updated**: 2026-09-29

**Developer:** Dev
**Requirement:** [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md) (§4.1–4.2, §7.4 FR-14 to FR-17, §8.1, §10 Slice 2, AC-10, T-8, T-11, T-12, §16.3–16.5 incl. C-8 as amended and L-9)
**Previous slices:** [Slice 0](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_0_WORKPLAN.md) (merged #128), [Slice 1](/docs/workplans/BUSINESS_OS_INVITE_SIGNUP_SLICE_1_WORKPLAN.md) (1a merged #133, 1b merged #139; 1c in progress in `neuronforge-invite-s0`)
**Date:** 2026-09-29
**Branch:** planning on `feature/bos-invite-signup-slice-2`, cut from `origin/main` at 8cdff1cb (the #138 merge, which is after #139). **2a is built on `feature/bos-invite-signup-slice-2a`, cut from `origin/main` at cd8dcb43 (the #142 merge: Slice 1c) on 2026-09-29**, in the `neuronforge-invite-s1` worktree (upstream tracking unset, so nothing can be pushed to `main` by accident). The file references in §1 to §8 were checked against 8cdff1cb; the 2a code was written against cd8dcb43.
**Status:** SA workplan review **approved with conditions** (2026-09-29), **R-1 to R-14 folded in**. **2a: Code Complete, uncommitted** (2026-09-29; §9.1). Waiting for SA code review, the user's look at the diff, and QA. **2a does not merge until O-1 and O-2 are recorded in §7.1 (R-3) and `20261020` is applied with its checker at PASS (O-4).**

## Overview

Today an admin creates an invite, copies the link once and sends it by hand. Slice 2 emails it: a welcoming, branded invitation in the invite's language (en/he/es, RTL for Hebrew) that shows "<Inviter> via AgentPilot", replies to the inviter, carries the personal note and a button with the link. The invite form's language now defaults to the inviter's saved preference. An admin can resend, which issues a new link and kills the old one, optionally extending the expiry within 15/30/60 days, with a reason. The invite row records the provider's message id, and (optionally) the admin list shows whether the email was delivered, bounced or failed, fed by the existing Resend webhook. A failed send never loses the invite. **After SA's re-cut (R-4) Slice 2 ships as three sub-slices, each with one small additive migration: 2a (send on create, `20261020`), 2b (resend a fresh link with a per-invite cap, `20261021`) and 2c (webhook delivery status, FR-17, optional, `20261022`).**

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Split (SA re-cut, R-4)](#2-split-sa-re-cut-r-4)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Migration SQL](#5-migration-sql)
6. [Read-only verification scripts](#6-read-only-verification-scripts)
7. [Runbooks (ops gates, pre-check, apply, merge order)](#7-runbooks-ops-gates-pre-check-apply-merge-order)
8. [API contracts](#8-api-contracts)
9. [Task List](#9-task-list)
10. [Traceability](#10-traceability)
11. [Test plan](#11-test-plan)
12. [Production manual check (tester's own email)](#12-production-manual-check-testers-own-email)
13. [Rollback](#13-rollback)
14. [Findings for SA, with rulings](#14-findings-for-sa-with-rulings)
15. [Logging-standard check (console.*)](#15-logging-standard-check-console)
16. [Open issues and follow-ups](#16-open-issues-and-follow-ups)
17. [SA Review Notes](#sa-review-notes)
18. [QA Testing Report](#qa-testing-report)
19. [Commit Info](#commit-info)

---

## 1. Analysis Summary

| Area | What Slice 2 touches | Verified against `origin/main` 8cdff1cb |
|---|---|---|
| Transport | `sendEmail` (`lib/notifications/emailTransport.ts`) already takes `kind`, explicit `from`/`replyTo`, and 1b's opt-in `redactRecipientInLogs` (masks `to`, strips email-shaped text from provider errors through `errorTextForLog`). It returns `providerMessageId` for Resend only. With no `ownerUserId`, `resolveSender` returns the caller's `from` untouched (T-11 holds as built). The default sender is `process.env.RESEND_FROM_EMAIL \|\| 'NeuronForge <notifications@neuronforge.app>'`; **invites never use that hard-coded default (R-2).** | `emailTransport.ts:25, 232-240, 441-472, 534-538` |
| Transport fallbacks (L-9, R-13) | **Gmail** forces the envelope sender to `GMAIL_USER`; the display name and Reply-To survive. **SMTP** sends our `from` as given, so DMARC depends on the SMTP host being authorised for our domain. Neither returns a message id, so a fallback send shows "Sent (not tracked)" and never gets a delivery status. The transport logs `to` at info unless `redactRecipientInLogs` is set. It logs the first 50 characters of the subject on the attempt line, and **the full subject on the final "No email transport delivered the message" warn** (`emailTransport.ts:578`, R-13). Both are harmless because the subject never carries the link (pinned by the template test). It never logs the body. Which fallbacks production actually has is recorded by O-3. | `emailTransport.ts:305-400, 514-586` |
| Templates | `base-template.ts` (`wrapInBrandedTemplate`, `emailButton`, `formatEmailDate`) and 1b's `invite-signup-code.ts` (platform branding, own `COPY` per locale, RTL, text part). Every template that renders user text has a private `escapeHtml`; there is no shared one. | `lib/email/templates/` |
| Webhook | `app/api/webhooks/resend/route.ts`: Svix-verified, fail-closed without `RESEND_WEBHOOK_SECRET`, maps `delivered/opened/clicked/bounced/complained` onto `email_sends` by message id, answers 200 `unknown message id` when unmatched. Types `toDeliveryEvent` does not map (`email.failed`, `email.suppressed`) **return before any lookup** (`if (!delivery)`), so 2c restructures that branch (R-6). | Route and `EmailAutomationRepository.ts:506-566`; test at `app/api/webhooks/resend/__tests__/route.test.ts` |
| `email_sends` | Not used (T-8): it needs a business `user_id` and a CRM `contact_id` and stores `body_html`, which would store the link. | SA §16.1 |
| Language | `user_preferences.preferred_language` has no repository and **no migration in the repo defines it** (dashboard-created table). Existing readers query it directly (`BookingEmailService.ts:203`, `DailyBriefingDispatchService.ts:199`, `InvoiceDeliveryService.ts:438`, `InsightRepository.ts:768`). `lib/business-os/userLanguage.ts` has `normalizeLanguage` and warns the column is left on an `en` default by timezone saves (F-3). **Live schema check owed at 2a-2 (R-11), result recorded in §10.3.** | grep |
| Invite row | `business_os_invites` has 23 CHECKs after `20261014`. The admin, public and redemption selects are named column lists; none selects `token_hash`. `inviter_display_name` is snapshotted at creation (C-9). `requireAdmin` returns `{ id, email? }` (`requireAdminRoute.ts:89`); `email` is optional, so `inviter_reply_to` may be NULL (handled: no Reply-To, `warn`). | `BusinessOsInviteRepository.ts:62-91` |
| Migrations (R-1) | Last on `origin/main`: `20261014_business_os_invite_signup.sql`. **`20261015` is pushed on `origin/feature/business-os-credit-deduction-slice-3b-i` (open PR #140)** and the credit-deduction work has more slices to come. **`20261016`–`20261019` are left to credit deduction; Slice 2 uses `20261020` (2a), `20261021` (2b), `20261022` (2c).** TL tells the credit-deduction session about the reservation. Re-checked at 2a-1 and again right before each PR opens (§9). | `git ls-tree` of every `origin/*` branch, every worktree, SA check |
| Parallel work | **Slice 1c** is being built in `neuronforge-invite-s0` and edits `adminInviteOps.ts`, the GET route, `InviteList.tsx`, `page.tsx`, `types.ts`, `inviteSchemas.ts` and the invite repository. Slice 2 edits the same files, so 2a starts after 1c merges. 1c adds no migration. | `git worktree list`, SA F-14 |
| Guards | `enforcementPoints.test.ts` (`KNOWN_NON_GATE_IMPORTERS`: every new importer of `lib/business-os/entitlements/**` must be registered; R-12 avoids a new one), `tierLiteral.forbidden`, `admin-authz-surface.guard` (2b adds one gated handler; CAPS count exemptions, no cap change expected), `authAccountRepository.callers.guard` (Slice 2 does **not** import `AuthAccountRepository`). | Test sources |

**Out of scope for Slice 2:** open and click tracking (F-9: not built, and click tracking must be **off at the provider**, O-2); a per-admin email cap (F-8); a kill switch (F-10); the default note template (BQ-12, future); paid-invite email copy beyond a "payment required" line (paid invites stay disabled until Slice 5); erasure of `inviter_reply_to` (folded into OI-2 / L-12); changing an invite's language after creation.

---

## 2. Split (SA re-cut, R-4)

**Three sub-slices, built and merged in order. One migration each (F-1 ruling).** 2c is optional (FR-17) and may be parked without loss.

| Sub-slice | Scope | Migration | Ops gates before merge | Demo | Size |
|---|---|---|---|---|---|
| **2a — "The invite arrives by email"** | Invitation template (en/he/es, RTL, note, button, plain link, expiry, "not expecting this?"); sender "<Name> via AgentPilot" on the address in `RESEND_FROM_EMAIL`, **failing closed when it is not configured** (R-2); Reply-To = the inviter's email snapshot; "Send the invitation email" on the create form (default on); the message id stored; a failed send recorded as "Not sent" with the link still shown once; language default from `user_preferences.preferred_language` through a new repository; the list shows Not emailed / Sent / Sent (not tracked) / Not sent / Unknown. | `20261020`: 7 nullable columns, 4 CHECKs, 1 partial unique index | **O-1** (sender is a Verified AgentPilot domain), **O-2** (click tracking OFF), O-3 (record fallbacks, information), O-4 (migration applied, checker PASS) | §12.1 E1–E10 | about 12 new, 21 modified |
| **2b — "Resend a fresh link"** | The resend route (reason required, R-7), `ReissueDialog.tsx`, the reissue CAS (new link, old one dead, optional new expiry, refused for claimed, used or revoked invites), the per-invite cap of 3 emails per 24 h opened by the create send (R-5), `BOS_INVITE_LINK_REISSUED`. **No webhook change, no ops prerequisite beyond O-4.** | `20261021`: `email_window_started_at`, `email_window_send_count`, CHECK `business_os_invites_email_window_shape` | O-4 | §12.2 R2–R5, R8–R10 | about 5 new, 12 modified |
| **2c — "Delivery status" (FR-17, optional)** | Webhook fallback to an invite lookup, with a conditional write (R-6); `toInviteDeliveryEvent`; `recordDeliveryEventForWebhook`; Delivered / Bounced / Marked as spam / Failed / Blocked badges. | `20261022`: `email_delivered_at`, CHECK `business_os_invites_email_delivered_shape` | O-4, **O-5** (`RESEND_WEBHOOK_SECRET` + redeploy), **O-6** (webhook subscriptions) | §12.3 R1, R6, R7 | about 4 new, 8 modified |

**Why this cut (SA).** 2a is the user-visible value and changes nothing existing except adding an email after a create that already works. 2b is required (FR-14) and needs nobody outside the team. 2c depends on the same Vercel-admin work that has kept other webhooks and crons dormant, so resend is never held behind it. Without 2b, an admin who dismisses the panel after a failed send cannot get the link again, which is exactly today's Slice 0 limit, so 2a loses nothing.

**Ordering:** 2a code starts after 1c merges and is rebased onto `origin/main`; migration numbers are re-verified then (R-1, R-14). The two slices edit the same six files.

---

## 3. Implementation Approach

### 3.1 Module layout

| File | Responsibility | Sub-slice |
|---|---|---|
| `lib/email/templates/invite-invitation.ts` (new) | `generateInviteInvitationEmail({ inviterDisplayName, personalNote, planName, isFree, access, linkUrl, linkExpiresAt, locale })` → `{ subject, html, text }`. Own `COPY` for en/he/es (the `invite-signup-code.ts` pattern), platform branding (not business branding), `dir="rtl"` for Hebrew, the link `dir="ltr"`, the note HTML-escaped with line breaks preserved, button plus plain-text copy of the link, expiry date, "not expecting this? ignore it". **The subject never contains the link** (the transport logs subject text, R-13). | 2a |
| `lib/business-os/invites/inviteSender.ts` (new) | Pure: `buildInviteFromHeader(displayName, platformAddress)` → `"<Name> via AgentPilot" <address>`, or `AgentPilot <address>` for the fallback name; strips `"`, `\`, `<`, `>`, CR and LF from the name and caps it at 64 code points (header safety). | 2a |
| `lib/business-os/invites/inviteEmail.ts` (new) | `sendInvitationEmail({ row, token, planName, replyTo, deps })`: **fails closed when `platformSenderAddress()` returns nothing** (R-2); builds the link only with `buildInviteLink(token)` (R-9); composes; sends through `sendEmail` with `kind: 'transactional'`, explicit `from`/`replyTo`, **no `ownerUserId`**, `redactRecipientInLogs: true` and `redactInLogs: [token, link]` (R-9); records the outcome through one CAS keyed on `(id, token_hash)`. `deriveInviteEmailStatus(row)` (one derivation). **Imports nothing from `lib/business-os/entitlements/**`:** `planName` is passed in by `adminInviteOps.ts` (R-12). 2b adds `decideEmailWindow(row, now)`; 2c adds `toInviteDeliveryEvent(type)`. | 2a, 2b, 2c |
| `lib/business-os/invites/inviteEmailPolicy.ts` (new) | `maxEmailsPerWindow: 3`, `windowHours: 24` (FR-14) with the **fixed-window semantics** in the file comment (R-5), `problemDetailMax: 300`, the problem vocabulary `not_sent \| bounced \| complained \| failed \| suppressed` and the `sender_not_configured` detail (TypeScript constants; SQL checks length only). | 2a (vocabulary), 2b (window) |
| `lib/business-os/invites/adminInviteOps.ts` (modify) | `createInviteForAdmin` gains `sendEmail` and passes the already-computed `planName`; `buildInviteFormOptions` takes the resolved default language; `toInviteListView` gains `emailStatus`, `emailStatusAt`. 2b: `reissueInviteLinkForAdmin`; the create path opens the send window (R-5). | 2a, 2b |
| `lib/repositories/UserPreferencesRepository.ts` (new) | `findPreferredLanguage(userId)`: `select('preferred_language').eq('user_id', userId).maybeSingle()`, normalised with `normalizeLanguage`; `null` when absent or unrecognised. **C-8 as amended.** Written only after the R-11 schema check. Follows the `new-repository` skill. | 2a |
| `lib/notifications/emailTransport.ts` (modify) | `platformSenderAddress()`: returns an address **only** from `RESEND_FROM_EMAIL` (parses `Name <addr>` and a bare address, validates the shape), **never** `RESEND_DEFAULT_FROM` (R-2). Opt-in `redactInLogs?: string[]`, applied **inside `errorTextForLog`**, so one change covers every provider-error log line and the returned `error` (F-4 ruling). Other senders unchanged. | 2a |
| `lib/repositories/BusinessOsInviteRepository.ts` (modify) | 2a: `createForAdmin` writes `inviter_reply_to` and `email_attempted_at`; `recordInviteEmailOutcome` (CAS on `id` + `token_hash`); admin select gains the email columns, **not** `inviter_reply_to`. 2b: `findForEmailSendForAdmin`, `reissueLinkForAdmin` (CAS); `createForAdmin` sets the window. 2c: `recordDeliveryEventForWebhook` (by message id, R-6). | 2a, 2b, 2c |
| `app/api/admin/business-os/invites/[inviteId]/resend/route.ts` (new) | POST, `requireAdmin` first, `.strict()` body `{ reason, sendEmail, linkExpiryDays? }` (R-7). Expiry options come through `inviteSchemas.ts`, not from config directly (R-12). | 2b |
| `app/api/webhooks/resend/route.ts` (modify) | Restructured per R-6. | 2c |

### 3.2 Key decisions

| # | Decision | Why |
|---|---|---|
| D-1 | **Sender address** = the address part of `RESEND_FROM_EMAIL`, with the display name `"<Name> via AgentPilot"`, via `platformSenderAddress()`. No new `invites@` local part. | T-11 and the F-2 ruling. O-1 confirms before merge that the address is on a Resend-Verified **AgentPilot** domain; if it is NeuronForge or unset, 2a does not merge and TL raises U-1. |
| D-1a | **Fail closed on the sender (R-2).** When `platformSenderAddress()` returns nothing (env unset or unparseable), `sendInvitationEmail` does **not** call `sendEmail`; it records `email_problem = 'not_sent'` with detail `sender_not_configured` and logs `warn`. Invites never go out from the hard-coded `neuronforge.app` default. | A first email from a brand the invitee has never heard of is what the requirement rules out. The admin still has the link from the panel. |
| D-2 | **Reply-To is a snapshot**: `inviter_reply_to`, the issuing admin's auth email from `requireAdmin` (`gate.user.email`), lower-cased and stored at creation. Never a form field. NULL when the gate has no email: the send goes out with no Reply-To and a `warn`. | §8.1 "Reply-To spoofing"; F-6 ruling. Never selected by the list, public or redemption selects. |
| D-3 | **Fallback name.** `inviter_display_name = 'AgentPilot'` renders as `AgentPilot <address>`, never "AgentPilot via AgentPilot". | BQ-9. |
| D-4 | **The link is never logged or stored.** The raw token exists in the create or reissue local, the template output, the provider request and the admin 201/200 body. The link is built **only** by `buildInviteLink(token)` so the emailed link equals the panel link byte for byte, with no second env read (R-9). `redactInLogs` carries the **raw token** and the link: an escaped or URL-encoded copy of the link still contains the base64url token verbatim (R-9). `email_problem_detail` is scrubbed a second time (token, link, email-shaped text) and cut to 300 code points. No body is stored anywhere in our systems. | The user's rule, T-7, AC-9, F-4 ruling. The §11 leak test is a **required** 2a test. |
| D-5 | **Send inline, after the row exists.** Create inserts the row (with `email_attempted_at` set when an email is requested), then sends, then records the outcome. The response returns `{ invite, link, email: { status } }`, and the **link is always shown once**, sent or not. The route exports `maxDuration = 30`. | FR-16. A function killed mid-send leaves `email_attempted_at` with no outcome, shown as "Unknown: resend or copy the link". |
| D-6 | **Outcome recording is a CAS on `(id, token_hash)`.** | A slow outcome for an old link matches 0 rows and becomes a `warn` (SA ✅). |
| D-7 | **Email status is derived in one TypeScript function**: `not_emailed` → `not_sent` → `bounced` / `complained` / `failed` / `suppressed` (2c) → `delivered` (2c) → `sent` → `sent_untracked` → `unknown`. | C-11 one-derivation rule. |
| D-8 | **Language default** (C-8 as amended, T-12, F-3 ruling): GET pre-selects `findPreferredLanguage(adminId)` if supported, otherwise `en`; a read error logs `warn` and falls back to `en`. The submitted value is Zod-validated and persisted; the email reads only `row.language`. No `LanguageContext`. | SA C-8, T-12. |
| D-9 | **Resend = reissue** (2b): one CAS replaces `token_hash`, optionally stamps a new `link_expiry_days` / `link_expires_at = now + days`, clears the per-link email facts, clears any unused signup code (`signup_code_hash`, `signup_code_expires_at`, `signup_code_attempts = 0`) and, when an email is requested, advances the send window. Condition: `redeemed_at IS NULL AND revoked_at IS NULL AND claimed_at IS NULL AND (link_expires_at > now OR a new expiry is given)` plus the observed window values (null-safe `is`/`eq`, the MF-2 lesson). `sendEmail: false` is how an admin gets a copyable link again. **A reason is required** (R-7). | L-9. `claimed_at IS NULL` refuses a live claim and a halfway one (the latter needs Slice 1's §6.2 recovery). |
| D-10 | **Cap: 3 emails per invite per 24 h** (FR-14), counting the create send and every resend **attempt** (F-12). **Once 2b's columns exist, the create send opens the window** (`email_window_started_at = now`, `email_window_send_count = 1`, R-5). **Fixed window:** it starts at the first send and resets 24 h later, so up to 3 more are possible right after a reset. Acceptable for an admin-only, per-invite cap; documented in `inviteEmailPolicy.ts` and §3.6. A reissue without email is not capped. | FR-14, R-5. |
| D-11 | **Webhook** (2c, T-8, R-6): (a) `email.failed` and `email.suppressed` reach the invite lookup instead of the early `!delivery` return; (b) an `email_sends` outcome of `recorded` or `duplicate` never falls through; only `unmatched`, or a type `email_sends` does not map, goes to the invite; (c) `opened`, `clicked` and `delivery_delayed` never touch an invite. The invite `UPDATE` filters `.eq('email_provider_message_id', messageId)` plus the never-regress conditions, **never `id` alone**, so a reissue landing between read and write matches 0 rows and gets 200. A problem outranks delivered. **Accepted race:** a `delivered` event arriving before the create route's outcome write matches nothing (200) and the row stays "Sent"; milliseconds against seconds of provider latency; no retry is built. | T-8, R-6. |
| D-12 | **No per-admin email cap** (F-8 ruling). | FR-14 asks only per invite. |
| D-13 | **Audit actor (R-8):** `BOS_INVITE_EMAIL_SENT` / `BOS_INVITE_EMAIL_NOT_SENT` and 2b's reissue email event carry `userId` and `actorId` = the admin, as `BOS_INVITE_CREATED` does. | FR-7. |

### 3.3 Request flows

**Create (2a, `POST /api/admin/business-os/invites`).** `requireAdmin` (first) → Zod (`sendEmail: boolean` required) → issuance policy (C-6) → insert (`inviter_reply_to = lower(gate.user.email)` or NULL; `email_attempted_at = now` if `sendEmail`; from 2b also the window, R-5) → if `sendEmail`: `sendInvitationEmail` (sender check first, R-2) → `recordInviteEmailOutcome` → audit `BOS_INVITE_CREATED`, then `BOS_INVITE_EMAIL_SENT` or `BOS_INVITE_EMAIL_NOT_SENT` (actor = the admin, R-8; entity = invite id; details `{ correlationId, provider, providerMessageId? }` or `{ correlationId, reason: 'sender_not_configured' | 'transport_failed' }`; never the email, link, token or hash) → flush → 201 `{ invite, link, email: { requested, status } }`, `no-store`. A failed outcome write is a `warn`; the list then shows `unknown`.

**List (2a, GET).** As today, plus `formOptions.defaultLanguage` (D-8) and each row's `emailStatus` / `emailStatusAt`.

**Reissue (2b, `POST /api/admin/business-os/invites/[inviteId]/resend`).** `requireAdmin` → Zod (uuid path; body `{ reason, sendEmail, linkExpiryDays? }` `.strict()`, R-7) → `findForEmailSendForAdmin(id)` → decide: redeemed 409 `used`; revoked 409 `revoked`; claimed 409 `signup_in_progress` (live) or `signup_stopped_halfway` (stale); expired without new expiry 409 `expired_needs_new_expiry`; `sendEmail` and window full 429 `email_limit_reached` with `retryAfterSeconds` → new token → `reissueLinkForAdmin` CAS (lost → 409 `try_again`) → if `sendEmail`: send and record as in create → audit `BOS_INVITE_LINK_REISSUED` (`{ correlationId, reason, emailRequested, expiryChangedFromDays?, expiryChangedToDays? }`, actor = admin) plus the email event → flush → 200 `{ invite, link, email }`, `no-store`.

**Webhook (2c).** Verification unchanged → parse → map for `email_sends`; if the type maps, run `recordDeliveryEvent`; `recorded` / `duplicate` → 200 and stop. If `unmatched`, or the type is `email.failed` / `email.suppressed`: `toInviteDeliveryEvent(type)` (delivered, bounced, complained, failed, suppressed; `opened`, `clicked`, `delivery_delayed` → none) → `recordDeliveryEventForWebhook` (conditional on the message id) → `matched` / `unmatched` / `duplicate` → 200; a write error → 500.

### 3.4 Tenant isolation (`tenant-isolation-guard` skill)

| Step | How Slice 2 meets it |
|---|---|
| Applies? | Yes: service-role writes, a caller-supplied invite id (reissue) and a caller-supplied message id (webhook). |
| Ownership | Invites are platform records reached unscoped by admins behind `requireAdmin` (global-catalog case, C-13), through `ForAdmin` methods. The webhook reaches one row only through a Svix-verified message id, and its update is conditioned on that id (R-6). |
| Allow-list | `.strict()` bodies; reissue's update and the outcome record are built field by field; `inviter_reply_to` from the gate, never the body; the webhook patch holds only `email_delivered_at` or the problem trio. |
| Scope-defeating three | No trigger, no upsert, no spread. |

### 3.5 Email content (FR-15a)

| Part | en (he and es in the same shape) |
|---|---|
| Subject | "{name} invited you to AgentPilot" (fallback name: "You're invited to AgentPilot") |
| Heading | "{name} invited you to join AgentPilot" |
| Note | "A note from {name}:" then the note, escaped, line breaks kept (omitted when empty) |
| Offer | "{planName}", then "Free" and "No end date" / "{n} months" (champion), or "Payment required" (paid, Slice 5) |
| Button | "Accept your invitation" → `buildInviteLink(token)` |
| Plain link | "Or paste this link into your browser:" and the same link, `dir="ltr"` |
| Expiry | "This invitation is valid until {date}." (date only, UTC, in the invite's locale; F-7 ruling) |
| Safety | "Not expecting this? You can ignore this email; nothing happens unless you sign up." |

Plan names stay English in all three locales (Slice 0 F-4).

### 3.6 Rate and abuse

| Control | Decision |
|---|---|
| Per invite | 3 emails per 24 h (FR-14), 2b, database CAS. **Fixed window opened by the first send (the create send once 2b ships); resets 24 h later, so up to 3 more are possible right after a reset** (R-5). Failed attempts count (F-12); reissue without email is uncapped. |
| Per admin | Not built (F-8 ruling). A follow-up only if invite volume ever becomes an abuse path. |
| Leaked link | A link alone cannot create an account: T-5 requires the one-time code sent to the invited mailbox. This is also why Resend's retained copy is not a credential (F-5); after a resend, those copies carry dead links. |
| Third-party redirect | Click tracking must be OFF at the provider (O-2, a 2a merge gate). |
| Webhook | Svix signature, 5-minute replay window, fail-closed without the secret (existing); writes idempotent and never regress, so an in-window replay is harmless. |

---

## 4. Files to Create / Modify

Verified against `origin/main` 8cdff1cb. Numbers are recounted at implementation (1c will have landed).

### 4.1 Slice 2a

| # | File | Action | Reason |
|---|---|---|---|
| a1 | `supabase/migrations/20261020_business_os_invite_email.sql` | create | §5.1 |
| a2 | `supabase/SQL Scripts/20261020_business_os_invite_email_rollback.sql` | create | §13 |
| a3 | `scripts/check-bos-invite-email-migration.sql` | create | §6.1 |
| a4 | `supabase/migrations/__tests__/business-os-invite-email.migration.test.ts` | create | Editor-safe text, no privilege statements, no new object, checker names match, R-10 rows pinned |
| a5 | `lib/email/templates/invite-invitation.ts` | create | FR-15a |
| a6 | `lib/email/templates/__tests__/invite-invitation.test.ts` | create | Three locales, RTL, escaping, link only in body, subject has no link |
| a7 | `lib/business-os/invites/inviteSender.ts` | create | D-1, D-3 |
| a8 | `lib/business-os/invites/inviteEmail.ts` | create | Send, record, derive (D-1a, D-4 to D-7) |
| a9 | `lib/business-os/invites/inviteEmailPolicy.ts` | create | Problem vocabulary, detail cap |
| a10 | `lib/business-os/invites/__tests__/inviteSender.test.ts` | create | Header injection, fallback, cap |
| a11 | `lib/business-os/invites/__tests__/inviteEmail.test.ts` | create | Send paths, fail-closed sender, CAS, scrub, status derivation, **required leak test** |
| a12 | `lib/repositories/UserPreferencesRepository.ts` | create | C-8 (after R-11) |
| a13 | `lib/repositories/__tests__/UserPreferencesRepository.test.ts` | create | One test per method |
| a14 | `lib/notifications/emailTransport.ts` | modify | `platformSenderAddress()` (R-2); `redactInLogs` inside `errorTextForLog` |
| a15 | `lib/notifications/__tests__/emailTransport.redactRecipient.test.ts` | modify | `redactInLogs` both ways; `platformSenderAddress()` cases; other senders unchanged |
| a16 | `lib/repositories/BusinessOsInviteRepository.ts` | modify | Insert fields; `recordInviteEmailOutcome`; admin select gains email columns |
| a17 | `lib/repositories/__tests__/BusinessOsInviteRepository.test.ts` | modify | New method, CAS filter, M-1 scrub |
| a18 | `lib/repositories/types.ts`, `lib/repositories/index.ts` | modify | Row and input types; export the preferences repository |
| a19 | `lib/business-os/invites/adminInviteOps.ts` (+ test) | modify | `sendEmail`, `planName` passed to the sender, language default, list keys |
| a20 | `lib/business-os/invites/inviteSchemas.ts` (+ test) | modify | `sendEmail` required boolean |
| a21 | `app/api/admin/business-os/invites/route.ts` (+ `__tests__/route.test.ts`) | modify | Send on create, `maxDuration`, language default, two audit events with admin actor |
| a22 | `app/admin/business-os-invites/components/CreateInviteForm.tsx` | modify | "Send the invitation email" checkbox (default on) |
| a23 | `app/admin/business-os-invites/components/CreatedLinkPanel.tsx` | modify | "Emailed to …" or "Not sent: copy the link"; header comment updated |
| a24 | `app/admin/business-os-invites/components/InviteList.tsx` | modify | Email status badge |
| a25 | `app/admin/business-os-invites/types.ts`, `page.tsx`, `__tests__/page.render.test.tsx` | modify | Payload types, render tests |
| a26 | `lib/audit/events.ts`, `lib/audit/eventAudience.ts` (+ test) | modify | `BOS_INVITE_EMAIL_SENT`, `BOS_INVITE_EMAIL_NOT_SENT`; pinned counts recomputed |
| a27 | `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | **modify only if needed** (R-12) | Preferred: none, because `inviteEmail.ts` receives `planName` and imports nothing from entitlements. If `adminInviteOps.ts` or `inviteSchemas.ts` gains an entitlements symbol, update its `symbols` list. |

Not touched: `middleware.ts`, `publicInviteView.ts`, `AuthAccountRepository`, purge descriptors (no new table), the webhook (2c).

### 4.2 Slice 2b

| # | File | Action | Reason |
|---|---|---|---|
| b1 | `supabase/migrations/20261021_business_os_invite_email_window.sql` | create | §5.2 |
| b2 | `supabase/SQL Scripts/20261021_business_os_invite_email_window_rollback.sql` | create | §13 |
| b3 | `scripts/check-bos-invite-email-window-migration.sql` | create | §6.2 |
| b4 | `supabase/migrations/__tests__/business-os-invite-email-window.migration.test.ts` | create | As a4 |
| b5 | `app/api/admin/business-os/invites/[inviteId]/resend/route.ts` | create | FR-14, R-7 |
| b6 | `app/api/admin/business-os/invites/__tests__/resend.route.test.ts` | create | 401, 403, 400 (incl. missing and short reason), 404, each 409, 429, happy paths |
| b7 | `app/admin/business-os-invites/components/ReissueDialog.tsx` | create | Reason, expiry choice (from `formOptions`, R-12), email checkbox, "the old link stops working" |
| b8 | `lib/repositories/BusinessOsInviteRepository.ts` (+ test) | modify | `findForEmailSendForAdmin`, `reissueLinkForAdmin`; `createForAdmin` opens the window (R-5) |
| b9 | `lib/business-os/invites/adminInviteOps.ts`, `inviteEmail.ts`, `inviteEmailPolicy.ts`, `inviteSchemas.ts` (+ tests) | modify | Reissue op, window decision, resend body schema |
| b10 | `app/admin/business-os-invites/components/InviteList.tsx`, `page.tsx`, `types.ts` (+ render test) | modify | "Resend" action |
| b11 | `lib/audit/events.ts`, `eventAudience.ts` (+ test) | modify | `BOS_INVITE_LINK_REISSUED` |
| b12 | `lib/repositories/__tests__/adminReadMethods.guard.test.ts` | check only | New method names end in `ForAdmin`; no `listForAdmin` |

### 4.3 Slice 2c (optional, FR-17)

| # | File | Action | Reason |
|---|---|---|---|
| c1 | `supabase/migrations/20261022_business_os_invite_email_delivery.sql` | create | §5.3 |
| c2 | `supabase/SQL Scripts/20261022_business_os_invite_email_delivery_rollback.sql` | create | §13 |
| c3 | `scripts/check-bos-invite-email-delivery-migration.sql` | create | §6.3 |
| c4 | `supabase/migrations/__tests__/business-os-invite-email-delivery.migration.test.ts` | create | As a4 |
| c5 | `app/api/webhooks/resend/route.ts` (+ `__tests__/route.test.ts`) | modify | R-6 restructure |
| c6 | `lib/repositories/BusinessOsInviteRepository.ts` (+ test) | modify | `recordDeliveryEventForWebhook` |
| c7 | `lib/business-os/invites/inviteEmail.ts` (+ test) | modify | `toInviteDeliveryEvent`; delivered and problem statuses |
| c8 | `app/admin/business-os-invites/components/InviteList.tsx`, `types.ts` (+ render test) | modify | Delivery badges |

---

## 5. Migration SQL

Editor rules, as in Slices 0 and 1: one `BEGIN`/`COMMIT`; no `--` or block comments; **no string literals at all** in these three files; one statement per change; no aliases. **Privileges:** none of the three migrations creates a table or a function, so there is no `REVOKE`/`GRANT` statement to write (SA ruling: table-level `relacl` covers every column including later ones; `ADD COLUMN`, `ADD CONSTRAINT` and `CREATE INDEX` change neither `relacl` nor `relrowsecurity`; nothing issues a column-level grant). Each checker re-asserts the table's privilege end state **and** that no column-level privilege exists (R-10). Explanations are in §7.

### 5.1 `20261020` (2a)

**File:** `supabase/migrations/20261020_business_os_invite_email.sql`

```sql
BEGIN;

ALTER TABLE public.business_os_invites ADD COLUMN inviter_reply_to text;

ALTER TABLE public.business_os_invites ADD COLUMN email_attempted_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN email_sent_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN email_provider_message_id text;

ALTER TABLE public.business_os_invites ADD COLUMN email_problem text;

ALTER TABLE public.business_os_invites ADD COLUMN email_problem_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN email_problem_detail text;

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_inviter_reply_to_normalised CHECK (inviter_reply_to IS NULL OR (inviter_reply_to = lower(btrim(inviter_reply_to)) AND char_length(inviter_reply_to) BETWEEN 3 AND 320));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_email_problem_paired CHECK ((email_problem IS NULL AND email_problem_at IS NULL AND email_problem_detail IS NULL) OR (email_problem IS NOT NULL AND email_problem_at IS NOT NULL));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_email_lengths CHECK ((email_problem IS NULL OR char_length(email_problem) <= 32) AND (email_problem_detail IS NULL OR char_length(email_problem_detail) <= 300) AND (email_provider_message_id IS NULL OR char_length(email_provider_message_id) <= 255));

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_email_sent_shape CHECK ((email_sent_at IS NULL OR email_attempted_at IS NOT NULL) AND (email_provider_message_id IS NULL OR email_sent_at IS NOT NULL));

CREATE UNIQUE INDEX business_os_invites_email_message_id_key ON public.business_os_invites (email_provider_message_id) WHERE email_provider_message_id IS NOT NULL;

COMMIT;
```

Totals: 7 nullable columns, 4 CHECKs (23 → 27), 1 partial unique index. Every CHECK is `IS NULL OR …` or a both-or-neither written out with `IS [NOT] NULL`, so none can evaluate to NULL (M-2 lesson). Existing rows satisfy all four. No value list in SQL.

### 5.2 `20261021` (2b)

**File:** `supabase/migrations/20261021_business_os_invite_email_window.sql`

```sql
BEGIN;

ALTER TABLE public.business_os_invites ADD COLUMN email_window_started_at timestamptz;

ALTER TABLE public.business_os_invites ADD COLUMN email_window_send_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_email_window_shape CHECK (email_window_send_count >= 0 AND (email_window_started_at IS NULL) = (email_window_send_count = 0));

COMMIT;
```

Totals: 2 columns (one `NOT NULL DEFAULT 0`, metadata-only), 1 CHECK (27 → 28). Existing rows get count 0 and a NULL start, which satisfies the CHECK. Invites created under 2a (sent before the window existed) open their window at their first resend.

### 5.3 `20261022` (2c)

**File:** `supabase/migrations/20261022_business_os_invite_email_delivery.sql`

```sql
BEGIN;

ALTER TABLE public.business_os_invites ADD COLUMN email_delivered_at timestamptz;

ALTER TABLE public.business_os_invites ADD CONSTRAINT business_os_invites_email_delivered_shape CHECK (email_delivered_at IS NULL OR email_provider_message_id IS NOT NULL);

COMMIT;
```

Totals: 1 column, 1 CHECK (28 → 29). The CHECK names a 2a column, so the rollback order is 2c → 2b → 2a.

---

## 6. Read-only verification scripts

All three follow the Slice 0/1 checker shape: `SET default_transaction_read_only = on`, one final `SELECT` with a `VERDICT` row, `PASS`/`FAIL`/`INFO` rows, `aclexplode` over `COALESCE(relacl, acldefault(…))`, constraint names in an explicit `IN (…)` list (no `%`, no `LIKE`), and the migration text test extracting both lists so they cannot drift. **R-10:** each has a row proving **no column-level privileges** on `business_os_invites` (every non-dropped column has `attacl IS NULL`), and the **total CHECK count is an `INFO` row, not part of the VERDICT**, so the next migration does not create another fail-by-design checker. Both are pinned in the text tests.

### 6.1 `scripts/check-bos-invite-email-migration.sql` (2a)

| Row | Check | Expected | In VERDICT |
|---|---|---|---|
| M01 | The 7 new columns exist and are nullable | 7 | yes |
| M02 | The 4 named CHECKs exist | 4 | yes |
| M03 | Total invite CHECKs | 27 at apply time | **no (INFO)** |
| M04 | `business_os_invites_email_message_id_key` exists, is unique and partial | 1 | yes |
| M05 | `PUBLIC`/`anon`/`authenticated` hold no privilege on the table | none | yes |
| M06 | `service_role` holds exactly `SELECT INSERT UPDATE` | 3, nothing else | yes |
| M07 | No column on the table has a column-level ACL (`attacl IS NULL`) | 0 | yes |
| M08 | No policies; RLS still on | 0; on | yes |
| M09 | No triggers on the table | 0 | yes |

### 6.2 `scripts/check-bos-invite-email-window-migration.sql` (2b)

| Row | Check | Expected | In VERDICT |
|---|---|---|---|
| W01 | `email_window_started_at` nullable; `email_window_send_count` `NOT NULL` default 0 | 2 | yes |
| W02 | `business_os_invites_email_window_shape` exists | 1 | yes |
| W03 | Total invite CHECKs | 28 at apply time | no (INFO) |
| W04–W08 | As M05–M09 | as above | yes |

### 6.3 `scripts/check-bos-invite-email-delivery-migration.sql` (2c)

| Row | Check | Expected | In VERDICT |
|---|---|---|---|
| D01 | `email_delivered_at` exists, nullable | 1 | yes |
| D02 | `business_os_invites_email_delivered_shape` exists | 1 | yes |
| D03 | Total invite CHECKs | 29 at apply time | no (INFO) |
| D04–D08 | As M05–M09 | as above | yes |

**Earlier checkers (expected, not drift):** the 1a checker's E02 already FAILs by design (Slice 1 N-2). The **1b checker's S02 ("23 in total") FAILs by design from `20261020` on**; every other 1b row must still PASS. The Slice 0 checker's I07 counts its 16 names only and keeps passing. The new checkers never fail on a later count (R-10).

---

## 7. Runbooks (ops gates, pre-check, apply, merge order)

### 7.1 Ops setup (SA): what a Vercel or Resend admin configures, and when

Vercel env changes take effect **only after a redeploy**. The user does not have Vercel admin, so Vercel items go to Offir; Resend items go to whoever holds the Resend dashboard. Access to the Resend dashboard should be limited to people who already hold Vercel admin (F-5 ruling).

| # | When | Where | What exactly | Recorded where | Result |
|---|---|---|---|---|---|
| **O-1** | **Before the 2a PR merges (gate)** | Vercel → Project → Settings → Environment Variables (Production), and Resend → Domains | `RESEND_FROM_EMAIL` **is set** on Production; read its address. In Resend → Domains that address's domain shows **Verified** (SPF and DKIM) and is an **AgentPilot** domain, not `neuronforge.app`. The display name in the variable does not matter to invites. Unset or NeuronForge → stop; TL raises U-1. | Here, and the E3 line (also answers Slice 1's open B3/C9) | ⬜ not yet recorded |
| **O-2** | **Before the 2a PR merges (gate)** | Resend → Domains → the O-1 domain → Configuration/Tracking | **Click tracking OFF.** Record the open-tracking state (not a gate). If click tracking is ON and nothing uses click counts, turn it off; if something does, TL raises U-2. | Here; E5 proves it after merge | ⬜ not yet recorded |
| **O-3** | Before 2a merges (information only) | Vercel Production env | Record which fallbacks are configured: `SMTP_HOST`/`SMTP_USER` present? `GMAIL_USER` present, and its address? With Gmail fallback, an invite sent while Resend is down arrives **from `GMAIL_USER`** (name and Reply-To survive; L-9). | Here, §1 fallback row | ⬜ |
| **O-4** | Before each PR merges | Supabase SQL editor (the user) | Apply `20261020` (later `20261021`, `20261022`) and get its checker to `VERDICT PASS` before merging (the CR-1 rule). | §7.2–7.4 | ⬜ per sub-slice |
| **O-5** | **Before the 2c PR merges** (not needed for 2a or 2b) | Vercel Production env, then redeploy | Set `RESEND_WEBHOOK_SECRET` to the signing secret (`whsec_…`) of the webhook in O-6. Without it the webhook refuses every event and statuses stay "Sent". | 2c R1 | ⬜ |
| **O-6** | **Before the 2c PR merges** | Resend → Webhooks | Endpoint `https://<production host>/api/webhooks/resend` exists and subscribes to `email.delivered`, `email.bounced`, `email.complained`, `email.failed`, `email.suppressed`. **Add; do not remove** existing `email.opened`/`email.clicked` subscriptions (used by `email_sends`). | 2c R1, R6, R7 | ⬜ |

**Conditional user decisions (TL raises only if an ops check triggers them):** U-1 (O-1 finds NeuronForge or no sender: verify the AgentPilot domain and switch the platform-wide address; until then invitations cannot be emailed and admins copy the link) and U-2 (O-2 finds click tracking ON and something relies on click counts: recommended turn it off). Wording in the SA section.

### 7.2 Applying `20261020` (2a)

| Step | What | Expected | If not |
|---|---|---|---|
| **0** | **Gates (R-3): O-1 and O-2 confirmed and their results written into §7.1 of this workplan.** O-3 recorded. | Both ✅ | **Do not merge 2a.** O-1 fails → U-1. O-2 fails → turn click tracking off, or U-2. |
| 1 | **Pre-check** (read-only): `SELECT count(*) AS invite_email_columns FROM pg_attribute JOIN pg_class ON pg_class.oid = pg_attribute.attrelid JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'business_os_invites' AND pg_attribute.attname = 'email_attempted_at' AND NOT pg_attribute.attisdropped;` | `0` | `1`: already applied; go to step 3. |
| 2 | Paste the whole of `20261020_business_os_invite_email.sql`. | "Success. No rows returned." | One transaction; any error rolls everything back. Send the text to Dev. |
| 3 | Paste `scripts/check-bos-invite-email-migration.sql`. | `VERDICT PASS` (8 rows in the verdict; M03 is INFO) | M05–M07 FAIL: privileges drifted; re-run Slice 0's five `REVOKE`/`GRANT` statements, then step 3. Any other FAIL: rollback (§13), do not merge. |
| 4 | Paste the Slice 0 checker `scripts/check-bos-invites-migration.sql`. | `VERDICT PASS`, 11 pass | Something unexpected changed; stop. |
| 5 | **Only now merge the 2a PR. The merge is the deploy** (CR-1). | An emailed invite arrives (§12.1). | The admin select names the new columns, so code without the migration breaks the admin page. Apply the migration at once, or revert the code. |

**Why it looks this way.** Every column is nullable and no existing reader selects it, so the migration is safe before the code. No string literals. The unique index backs the 2c webhook lookup and guarantees one message id maps to at most one invite. `inviter_reply_to` holds an admin's own email: never in the public or redemption selects; its erasure is folded into OI-2 (L-12).

### 7.3 Applying `20261021` (2b)

Pre-check on `email_window_send_count` (`0` expected), paste, checker `VERDICT PASS`, Slice 0 checker PASS, then merge the 2b PR. No ops gate beyond O-4.

### 7.4 Applying `20261022` (2c)

**Step 0: O-5 (secret set and redeployed) and O-6 (subscriptions) recorded in §7.1.** Then pre-check on `email_delivered_at` (`0` expected), paste, checker `VERDICT PASS`, Slice 0 checker PASS, then merge the 2c PR. If O-5/O-6 cannot be done, 2c is parked; 2a and 2b lose nothing.

---

## 8. API contracts

### 8.1 `POST /api/admin/business-os/invites` (2a change)

Body: Slice 0's discriminated union plus **`sendEmail: boolean` (required)**; `.strict()` unchanged. `maxDuration = 30`.

201 `{ success: true, data: { invite, link, email: { requested: boolean, status: 'not_emailed' | 'sent' | 'sent_untracked' | 'not_sent' | 'unknown' } } }`, `Cache-Control: no-store`. The email fields never carry the address, the message id, the error text or the link. `sender_not_configured` surfaces as `not_sent` (the admin copies the link). Every other status is unchanged.

### 8.2 `GET /api/admin/business-os/invites` (2a change)

`formOptions.defaultLanguage` is the inviter's preference (D-8). Each row adds `emailStatus` and `emailStatusAt`. Rows never carry `inviter_reply_to`, `email_provider_message_id` or `email_problem_detail`.

### 8.3 `POST /api/admin/business-os/invites/[inviteId]/resend` (2b)

Body `.strict()`: `{ reason: string (3..500, reasonSchema), sendEmail: boolean, linkExpiryDays?: 15 | 30 | 60 }` (R-7; options from `INVITE_LINK_EXPIRY` through `inviteSchemas.ts`). `maxDuration = 30`.

| Status | Body |
|---|---|
| 200 | `{ invite, link, email: { requested, status } }`, `no-store` |
| 400 | `invalid_input` (incl. missing or short reason) |
| 401 / 403 | from the gate, nothing read before it |
| 404 | `invite_not_found` |
| 409 | `used`, `revoked`, `signup_in_progress`, `signup_stopped_halfway`, `expired_needs_new_expiry`, `try_again` |
| 429 | `email_limit_reached`, `retryAfterSeconds` |
| 500 | `could_not_reissue_invite` |

### 8.4 `POST /api/webhooks/resend` (2c change)

Unchanged for `email_sends`. `ignored: 'unknown message id'` only after both lookups miss. Response bodies never name an invite.

---

## 9. Task List

### Setup

- ✅ **Step 0** — Branch `feature/bos-invite-signup-slice-2` from `origin/main` (8cdff1cb) in `neuronforge-invite-s1`; `git branch --show-current` confirmed.
- ✅ **Step W** — Workplan written.
- ✅ **Step R** — SA workplan review (approved with conditions); R-1 to R-14 folded in (2026-09-29).
- ⬜ **Step T** — TL tells the credit-deduction session that `20261016`–`20261019` are theirs and `20261020`–`20261022` are Slice 2's (R-1).

### Slice 2a (starts only after 1c merges)

- ✅ **2a-1** — Not a rebase: a fresh branch `feature/bos-invite-signup-slice-2a` cut from `origin/main` cd8dcb43 **after 1c merged (#142)**, carrying this untracked workplan (hash checked before and after the switch). **Migration numbers re-verified (R-1, R-14) twice, at the start and after a fresh fetch at the end:** no `20261016`+ on any `origin/*` branch, local branch or worktree other than this one; `gh pr list --state open` is empty; `20261015` is now on `origin/main` (#140 merged). Migration `20261020`, rollback, checker (M01–M09, M07 = the column-ACL row, M03 = INFO) and text test (a1–a4): 22 tests pass.
- ✅ **2a-2** — `business-os-schema-check` run **statically only** (Rules 3, 4, 6; see §10.3 and deviation D-dev-2a-3: the live replay needs `.env.local`, which this worktree does not have, and this task was "no DB"). **The live check is still owed.** `UserPreferencesRepository.findPreferredLanguage` and test (a12, a13, a18): 10 tests pass.
- ✅ **2a-3** — Transport: `platformSenderAddress()` (reads `RESEND_FROM_EMAIL` only, never `RESEND_DEFAULT_FROM`, R-2) and `redactInLogs` applied inside `errorTextForLog` (longest string first, then the email mask), with tests (a14, a15): 34 notification tests pass.
- ✅ **2a-4** — Template `invite-invitation.ts` and its test (a5, a6): 16 tests pass.
- ✅ **2a-5** — `inviteSender`, `inviteEmailPolicy`, `inviteEmail` (fail-closed sender, `buildInviteLink` only, raw token + link in `redactInLogs`, never throws, no entitlements import) and tests including the **required leak test** (a7–a11): 46 tests pass.
- ✅ **2a-6** — Repository: `inviter_reply_to` and `email_attempted_at` on insert, `recordInviteEmailOutcome` (CAS on `id` + `token_hash`, `{ count: 'exact' }`, no `.select()`), admin select gains five email columns (not `inviter_reply_to`, not `email_problem_detail`); tests (a16, a17): 71 pass.
- ✅ **2a-7** — `adminInviteOps` (computes `planName` with `planLabel` and passes it in; `resolveInviteFormLanguage`; list keys), `sendEmail` required in the schema, create and list routes (`maxDuration = 30`), `BOS_INVITE_EMAIL_SENT` / `_NOT_SENT` with the admin as `userId` and `actorId` (R-8). **`enforcementPoints` untouched (R-12):** no new importer, no new symbol. Tests (a19–a21, a26).
- ✅ **2a-8** — Admin UI: "Send the invitation email" (ticked by default), the panel's email line, the Email column; render tests (a22–a25): 108 pass (page render + source guard).
- ✅ **2a-9** — Local verification, all green (§9.1). **O-1 and O-2 are NOT recorded: they are ops checks outside Dev's reach and stay ⬜ in §7.1. 2a does not merge until they are (R-3).**
- ⬜ **2a-10** — Migration numbers re-verified right before the PR opens (R-1). SA code review of the uncommitted diff; the user sees the diff; QA. **No commit** until approved.

### 9.1 Slice 2a implementation record (Dev, 2026-09-29)

**Branch:** `feature/bos-invite-signup-slice-2a` from `origin/main` cd8dcb43. **Uncommitted.** 12 new files, 21 modified (plus this workplan). `git diff --stat` against `origin/main`: 21 modified files, +1,174 / −34 before the workplan update; no file shrank beyond the lines it replaced.

**Verification (all run on the final tree):**

| Check | Result |
|---|---|
| 2a and neighbouring suites (invites lib, admin + public invite routes, admin screen, `/invite` page, both invite repositories, notifications, templates, audit, the four invite migration tests) | **37 suites, 865 tests, all pass** |
| Every `*guard*` / `*forbidden*` / `*invariant*` suite (38 files) | **38 suites, 1,025 tests, all pass** |
| `npm run test:authz-guard` | **119 pass** (CAPS unchanged; no handler added) |
| `npm run test:bos-entitlements` (R-12, reported) | **87 suites, 1,818 tests, all pass** |
| `npm run lint:hooks` | exit 0 |
| `eslint` on the 31 touched `.ts`/`.tsx` files | **0 errors**; 5 warnings, all pre-existing (`events.ts:1089` unused `_`, three `catch (err: any)` in the transport, `types.ts:393`) |
| `tsc --noEmit` (8 GB heap, exit code checked, no FATAL) filtered to the touched files | **0 errors in touched files**; repo total 2,088, the same as before the change (four errors in test fixtures were introduced and fixed) |
| `next build` with the CI placeholder env from `build.yml` | **exit 0** |

**Deviations from the workplan (for SA):**

| # | What | Why |
|---|---|---|
| D-dev-2a-1 | The admin select **includes `email_provider_message_id`** (§11's a17 row said it is excluded). It is never put in a view, a response or a log line (tests pin that). | D-7 needs it: "Sent" vs "Sent (not tracked)" is exactly whether a message id exists. `email_problem_detail` and `inviter_reply_to` stay out of every select. |
| D-dev-2a-2 | `recordInviteEmailOutcome` uses `.update(patch, { count: 'exact' })` with **no `.select()`**, and `data` is `count === 1`. | Coordinator finding (proven on production for 1b): a PostgREST UPDATE combining `.or()` with `.select()` fails with a misleading 42703. This write has no `.or()`, but the count form keeps it off that shape and matches the hotfix's coming `mutationOrSelect.guard`. The test asserts neither `.select` nor `.or` is called. |
| D-dev-2a-3 | **R-11 was done statically, not against the live database.** | This worktree has no `.env.local`, and the task said "no DB"; borrowing production credentials from the main checkout was not an option. §10.3 records the static evidence and the one read-only query that closes it. |
| D-dev-2a-4 | `deriveInviteEmailStatus` maps a problem other than `not_sent` (the 2c words) to `unknown`. | 2a cannot vouch for a delivery status it does not build; 2c replaces this branch with its own statuses. |
| D-dev-2a-5 | The "Unknown" badge says "An email was attempted but no result was recorded", not "resend or copy the link". | Resend arrives in 2b, and after the panel closes the link cannot be copied again. The panel's own "unknown" line does point at the link, which is on screen then. |
| D-dev-2a-6 | `sendInvitationEmail` also catches a transport or template that **throws** and records `not_sent` / `transport_failed`. | The transport promises not to throw, but the row already exists when the send runs; a throw would make the route answer 500 and the admin would lose the link (FR-16). |
| D-dev-2a-7 | The 201's `email.status` is what the **send** did; the `invite` in the same response shows `unknown` when the outcome could not be written. | The panel must not say "not sent" for a mail that went out, and the row must say what the list will say on reload. |
| D-dev-2a-8 | `BOS_INVITE_CREATED` details gain `emailRequested`. | So the investigation trail shows an email was asked for even if the second audit entry is lost. |
| D-dev-2a-9 | Stored `email_problem_detail` is `sender_not_configured`, or `transport_failed: <provider error>` scrubbed (token, link, hash, email-shaped text) and capped at 300 code points. The audit reason is the class only. | D-4. |
| D-dev-2a-10 | `inviter_reply_to` is validated as an address, not only lower-cased: a gate email that is not one is stored as NULL with a `warn`. | The CHECK (3..320, normalised) must never fail an insert; a bad Reply-To must not fail an invite. |
| D-dev-2a-11 | `UserPreferencesRepository` reuses the invite repository's exported `safeDbError` for the M-1 scrub. | One scrub, not a second copy (reuse infra). SA may prefer it moved to a shared module. |
| D-dev-2a-12 | Hebrew copy uses neutral phrasing ("הזמנה מ־{name} להצטרף ל־AgentPilot") to avoid a gendered verb. | Copy for `he` and `es` should get a native speaker's read before the production check. |
| D-dev-2a-13 | **R-13:** §1's transport row was already corrected when R-1..R-14 were folded in. The same stale claim ("`sendEmail` logs the first 50 characters of the subject") is still in the header comment of 1b's `lib/email/templates/invite-signup-code.ts`. **Left untouched** on instruction (no change to 1b's code path during the live 1b investigation). | Comment-only follow-up, to go with the 1b hotfix or later. |
| D-dev-2a-14 | The screen types mark `emailStatus` optional, so a row from an older server shows "—" instead of a badge. | Deploy-order tolerance only; the server always sends it. |
| D-dev-2a-15 | **QA2a-1 (fixed after QA):** `sendInvitationEmail` races the send against `INVITE_EMAIL_POLICY.sendTimeoutMs` (20 s). On timeout it returns `unknown` / `send_timeout`, writes nothing (the row keeps its attempt stamp, which the list shows as "Unknown"), ignores a late answer, and the route still answers 201 with the link; the audit is `BOS_INVITE_EMAIL_NOT_SENT` with reason `send_timeout` (its description now says "or not confirmed in time"). A test pins the limit at least 5 s below `maxDuration` (30); tests cover a never-resolving transport in `inviteEmail.test` and in the route test. `emailTransport.ts` is unchanged for every sender. | A hanging provider could outlive `maxDuration`, so the admin would never see the link and the row would stay "Unknown". `unknown` rather than `not_sent`: the mail may still go out. |
| D-dev-2a-16 | **QA2a-2 (fixed after QA):** the first `tokenPrefixRedactLength` (12) characters of the token are also passed in `redactInLogs` and scrubbed from the stored problem detail. | A provider error that echoes a truncated link would otherwise carry the token's start. |

**Not changed:** 1b's signup-code path (`inviteRedemption.ts`, `redemptionDeps.ts`, the signup routes and 1b's repository methods), `middleware.ts`, `publicInviteView.ts`, `AuthAccountRepository`, the webhook, purge descriptors, `enforcementPoints`.

### Slice 2b (after 2a merges)

- ⬜ **2b-1** — Numbers re-verified (R-1); migration `20261021`, rollback, checker, text test (b1–b4).
- ⬜ **2b-2** — Repository: `findForEmailSendForAdmin`, `reissueLinkForAdmin`, window on create (R-5); tests (b8).
- ⬜ **2b-3** — Window decision, reissue op, resend body schema with reason (R-7); tests (b9).
- ⬜ **2b-4** — Resend route and tests (b5, b6); `BOS_INVITE_LINK_REISSUED` with reason and admin actor (b11).
- ⬜ **2b-5** — UI: Resend action and `ReissueDialog` (options from `formOptions`); tests (b7, b10).
- ⬜ **2b-6** — Local verification as 2a-9 (incl. `test:bos-entitlements`, reported); numbers re-verified before the PR; SA code review; user diff; QA. **No commit** until approved.

### Slice 2c (optional; after 2b merges; merge only after O-5 and O-6)

- ⬜ **2c-1** — Numbers re-verified (R-1); migration `20261022`, rollback, checker, text test (c1–c4).
- ⬜ **2c-2** — `recordDeliveryEventForWebhook` conditional on the message id; `toInviteDeliveryEvent`; tests (c6, c7).
- ⬜ **2c-3** — Webhook restructure per R-6 (a/b/c), tests for each plus the reissue race; document the early-event race (c5).
- ⬜ **2c-4** — Delivery badges; tests (c8).
- ⬜ **2c-5** — Local verification; SA code review; user diff; QA. O-5 and O-6 recorded before merge.

---

## 10. Traceability

### 10.1 L-items, SA conditions and R-items

| Item | Requires | Satisfied by | Proven by |
|---|---|---|---|
| **L-9** sender | Sender per T-11 | D-1, D-1a, D-2, D-3; `inviteSender.ts`; no `ownerUserId` | `inviteEmail.test`: `sendEmail` receives `kind: 'transactional'`, `from` = `"Dana via AgentPilot" <addr>`, `replyTo` = the snapshot, no `ownerUserId` key; fallback name → `AgentPilot <addr>`; §12 E3 |
| **L-9** message id | Record `provider_message_id` per T-8 | `recordInviteEmailOutcome`; unique partial index | Repository test; CAS on `(id, token_hash)`; §12 E8 |
| **L-9** Gmail fallback | State what it does to From | §1 row; O-3 records production | `inviteEmail.test` for `provider: 'gmail'` with no id |
| **L-9** recipient at info | State that the transport logs it | `redactRecipientInLogs: true` on every invite send | Logger spy: masked only; §12 E9 |
| **L-9** resend | Replace `token_hash` on the same row; old link dies | D-9 | Resend route test: old token → identical `not_recognised`; §12 R3 |
| **C-8 (amended)** | Default from `user_preferences.preferred_language` via a new repository; `en` fallback; no `LanguageContext` | D-8, a12, R-11 | Repository and route tests; source test |
| **L-12 / OI-2** | Erasure | Not built; `inviter_reply_to` added to the design | §16 |
| **T-5 / T-7 / T-8 / T-11 / T-12** | As decided | Unchanged code path (T-5); D-4 (T-7); D-11 (T-8); D-1/D-2 (T-11); D-8 (T-12) | §11 |
| **C-5 / FR-7** | Gate first, `.strict()`, repository only, audit with actor and reason, then flush | Resend route mirrors revoke; reason required (R-7); admin actor (R-8) | Gate-first tests spy every body reader, no repository call on 401/403 |
| **R-1** | Renumber `20261020`/`21`/`22`; re-verify at 2a-1 and before each PR | §1, §4, §5, §6, §7, §9, §13, Commit Info | 2a-1, 2a-10, 2b-1, 2c-1 |
| **R-2** | Fail closed on the sender | D-1a, a14 | Tests: unset env, unparseable env, `"X" <a@b>`, bare `a@b`; no `sendEmail` call when unset |
| **R-3** | O-1/O-2 pre-merge gates; RM line | §7.1, §7.2 step 0, Commit Info | 2a-9 |
| **R-4** | 2b/2c re-cut | §2, §4.2, §4.3, §5.2, §5.3, §7, §9, §12, §13 | — |
| **R-5** | Create opens the window; fixed-window semantics documented | D-10, §3.6, `inviteEmailPolicy.ts` | Create → 2 resends allowed → third 429 |
| **R-6** | Conditional webhook write; restructure a/b/c | D-11, §3.3 | Tests for each case and the reissue race |
| **R-7** | Resend body with reason | §8.3 | 400 on missing and short reason; reason in audit details |
| **R-8** | Email events carry admin as actor | D-13 | Route tests assert `userId`/`actorId` |
| **R-9** | `buildInviteLink` only; raw token in `redactInLogs` | D-4 | Leak test on token and link |
| **R-10** | Column-ACL row; totals INFO | §6 | Text tests pin both |
| **R-11** | Schema check before the repository | 2a-2, §10.3 | Recorded result |
| **R-12** | No new entitlements importer; report `test:bos-entitlements` | a27, `planName` passed in | 2a-9, 2b-6 |
| **R-13** | Full subject in final warn | §1 transport row | Template test: no link in subject |
| **R-14** | Task-list additions | §9 2a-1, 2a-9 | — |

### 10.2 Functional requirements and acceptance

| Item | Sub-slice | Satisfied by |
|---|---|---|
| FR-14 send on create, untick to copy | 2a | `sendEmail`; checkbox default on |
| FR-14 resend, fresh link, new expiry, 3 per 24 h | 2b | D-9, D-10 |
| FR-15 sender, Reply-To, fallback, transactional | 2a | D-1 to D-3 |
| FR-15a content and language | 2a | §3.5 |
| FR-16 failed send recorded, invite kept, link copyable | 2a (panel), 2b (reissue without email) | D-1a, D-5, D-7 |
| FR-17 delivery facts (optional) | 2c | D-11 (no opens, F-9) |
| AC-10 | 2a + 2b (+ 2c for statuses) | §12 |
| BQ-4 / BQ-9 | 2a | D-1 to D-3, D-8 |
| BQ-12 default note template | — | Future |

### 10.3 R-11 schema check result (filled at 2a-2)

| Column | Exists | Type | Default | Nullable | Checked on |
|---|---|---|---|---|---|
| `user_preferences.preferred_language` | ✅ by static evidence (below) | text-like; documented `VARCHAR(10)` | documented `'en'` (matches F-3: a timezone save leaves it `en`) | ⬜ not provable statically; the code treats NULL as "no preference" | `feature/bos-invite-signup-slice-2a` @ cd8dcb43, **statically** (2026-09-29) |
| `user_preferences.preferred_language` | ✅ **live, on production** | not re-read (the repository only compares the value to the supported list) | not re-read | NULL-tolerant in code either way | **TL, read-only, 2026-09-29**: the column exists on production; 12 rows; values `en` 10, `he` 2 (both supported; no unrecognised value) |

**R-11: DONE (recorded by SA, 2026-09-29).** TL's live read-only check today closes what 2a-2 left owed: the column exists on production, and every value present (`en`, `he`) is one `normalizeLanguage` accepts. Type, default and nullability were not re-read and need not be: `findPreferredLanguage` normalises whatever it reads and returns `null` for anything unusable, and the GET falls back to `en` on any error. The paragraph below is the original static record, kept for history.

**How it was checked (skill Rules 3, 4, 6), and what is still owed.** No migration in the repo defines the table (it was created in the dashboard; `20260913_lead_alerts.sql` says so). Evidence it exists, on that table, under that name: six live production readers select exactly `preferred_language` from `user_preferences` with `.eq('user_id', …)` (`BookingEmailService`, `DailyBriefingDispatchService`, `InvoiceDeliveryService`, `LeadAlertService`, `InsightRepository`, `app/api/business-os/my-day/route.ts`), and `LanguageContext` writes it with `upsert(…, { onConflict: 'user_id' })`, which needs a unique key on `user_id` (one row per user, so `.maybeSingle()` is right). `docs/MULTI_CURRENCY_SYSTEM.md` documents `preferred_language (VARCHAR(10), DEFAULT 'en')`: documentation, not measurement. **The live replay was not run** (no `.env.local` here, and this task was "no DB"). To close it, either run `npm run schema:check` from a checkout with `.env.local`, or paste this read-only query in the SQL editor: `SELECT column_name, data_type, character_maximum_length, column_default, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'user_preferences' AND column_name = 'preferred_language';` (expected: one row). If the column were missing, the only effect is that the GET logs a `warn` and pre-selects English (the repository error is caught), so the form never breaks.

---

## 11. Test plan

| Suite | Cases |
|---|---|
| Migration text (a4, b4, c4) | No `--`/`/*`; **no string literal at all**; no alias; exactly the listed `ADD COLUMN`s; every CHECK name matches the checker's `IN` list; each CHECK contains its `IS NULL`/`IS NOT NULL` terms; no `REVOKE`, `GRANT`, `CREATE TABLE`, `FUNCTION`, `TRIGGER` or `POLICY`; the checker's pass conditions pinned (QA-1b-1 lesson), **including the column-ACL row, and the total-count row excluded from the VERDICT (R-10)**; rollback drops exactly what the migration adds |
| Template (a6) | en/he/es subject and heading; `dir="rtl"` for `he`; link `dir="ltr"`; note escaped (`<script>` as text) with line breaks; empty note omits the block; fallback name wording; the link in `html` and `text` and **not** in `subject`; expiry date per locale in UTC |
| Sender (a10) | `"Dana via AgentPilot" <addr>`; quotes, backslash, angle brackets, CR and LF stripped; 64-code-point cap; fallback name; surrogate pair at the cap |
| Invite email (a11) | **Sender fails closed (R-2):** env unset or unparseable → no `sendEmail` call, `not_sent` + `sender_not_configured`, `warn`. Sent via Resend → `sent` with id; SMTP/Gmail → `sent_untracked`; transport failure → `not_sent`, detail scrubbed of token, link and email, ≤300 code points; `sendEmail` params exact (`kind`, `from`, `replyTo`, `redactRecipientInLogs: true`, `redactInLogs` holding the **raw token** and the link, **no `ownerUserId`**); the link equals `buildInviteLink(token)`; outcome CAS on `id` + `token_hash`, a lost CAS is a `warn`; `deriveInviteEmailStatus` table; **required leak test: serialised logger and audit calls contain neither the token, the link, the hash nor the invitee email**; source test: no import from `lib/business-os/entitlements/**` (R-12) |
| Transport (a15) | `platformSenderAddress()`: unset → undefined; unparseable → undefined; `"X" <a@b>` → `a@b`; bare `a@b` → `a@b`; never the `neuronforge.app` constant. `redactInLogs` strings replaced in every logged and returned provider error; without it, unchanged; combined with `redactRecipientInLogs` |
| Preferences repository (a13) | Filter `user_id`; `he` → `he`; `EN ` → `en`; `fr`, `''`, null, no row → `null`; error → `{ error }` scrubbed |
| Invite repository (a17, b8, c6) | `recordInviteEmailOutcome` field by field, filters `id` and `token_hash`; `reissueLinkForAdmin` filters `redeemed_at`/`revoked_at`/`claimed_at` null, expiry, observed window (null-safe), clears the code and per-link facts; `createForAdmin` opens the window when emailing (2b); `recordDeliveryEventForWebhook` updates **only** with `.eq('email_provider_message_id', …)` plus never-regress conditions, never by `id` alone; admin select excludes `inviter_reply_to`, `email_provider_message_id`, `email_problem_detail`; M-1 scrub on every new method |
| Create route (a21) | 201 with `sendEmail: true` sent / not sent / sender not configured / unknown; `sendEmail: false` sends nothing; missing `sendEmail` → 400; injected `replyTo`, `from`, `inviterReplyTo` → 400; `maxDuration = 30`; link once, `no-store`; audit order `CREATED` then the email event, **both with the admin as `userId`/`actorId` (R-8)**, then flush; rejected flush still 201 |
| List route (a21) | `defaultLanguage` from the preference, `en` on error or unknown; row key set pinned |
| Resend route (b6) | Gate first; 400 bad uuid, bad expiry (45), extra key, **missing reason, 2-character reason (R-7)**; 404; 409 used / revoked / live claim / stale claim / expired without new expiry; **create then two resends allowed, third resend 429 with `retryAfterSeconds` (R-5)**; reissue without email uncapped; 200 with a new link; old token → `not_recognised`; 15 → 60 days stamps `now + 60d`; concurrent reissues: one wins, the other `try_again`; a claim taken between read and write wins; audit details carry the reason and admin actor |
| Webhook (c5) | **(a)** `email.failed` and `email.suppressed` reach the invite lookup; **(b)** `email_sends` `recorded` or `duplicate` never calls the invite lookup; `unmatched` does; **(c)** `opened`, `clicked`, `delivery_delayed` never touch an invite; **reissue race:** a reissue between read and write → 0 rows, 200; old message id → unmatched 200; repeat → duplicate 200; problem outranks delivered; write error → 500; no email in any log line |
| Admin UI (a25, b10, c8) | Checkbox default on and sent; panel "Emailed to …" / "Not sent: copy the link below"; status badges; `ReissueDialog` requires a reason, offers only `formOptions.expiryDays`, is hidden for accepted, revoked and claimed rows, warns the old link dies, shows the new link once; source guard: dialog imports nothing from config |
| Guards | `test:authz-guard` (CAPS unchanged), `tierLiteral.forbidden`, `enforcementPoints`, `test:bos-entitlements` (reported), `adminReadMethods.guard`, `authAccountRepository.callers.guard` (unchanged), `no-deletion-paths.guard`, `next build` |

Mutation targets for QA: drop `token_hash` from the outcome CAS; fall back to `RESEND_DEFAULT_FROM`; drop the raw token from `redactInLogs`; drop the window predicate; drop `claimed_at IS NULL`; update the webhook row by `id` only; let `recorded` fall through to the invite lookup; log the link; pass `ownerUserId`; remove the escape on the note.

---

## 12. Production manual check (tester's own email)

`<you+s2>` / `<you+s2b>` are plus-addresses of the tester's own mailbox that have **never** had an AgentPilot account. `bounced@resend.dev` and `complained@resend.dev` are Resend's test addresses. Never a real invitee's address.

### 12.1 After 2a (O-1 and O-2 recorded, migration applied with checker PASS, then merged)

| # | Do | Expect | Pass? |
|---|---|---|---|
| E1 | Admin → Signup Invites → New invite. | Language pre-selected to **your** saved language (English if never chosen). "Send the invitation email" ticked. | ⬜ |
| E2 | Champion, 1 month, 30 days, language **Hebrew**, a two-line note, reason "QA slice 2a". Create. | The panel says it was emailed to `<you+s2>` **and** still shows the link once. Row Pending, email **Sent**. | ⬜ |
| E3 | Open the email in `<you+s2>`. | From **"<your name> via AgentPilot"** at the O-1 address (**record it**). Hebrew, right to left, your note with its line break, Founding Partner, the button, the plain link, the expiry date, the "not expecting this" line. | ⬜ |
| E4 | Hit **Reply**. | Addressed to **your own admin email**. Discard. | ⬜ |
| E5 | Inspect the button's link. | `https://<platform>/invite#t=…`, **not** a Resend tracking address (post-merge proof of O-2). | ⬜ |
| E6 | Click the button in a private window. | The valid invite page in Hebrew, masked address. | ⬜ |
| E7 | Create a second invite with the checkbox unticked. | Link shown once; email **Not emailed**; nothing arrives. | ⬜ |
| E8 | Read-only SQL: `SELECT invite_row.email_attempted_at, invite_row.email_sent_at, invite_row.email_provider_message_id, invite_row.email_problem, invite_row.inviter_reply_to FROM public.business_os_invites AS invite_row WHERE invite_row.id = '<E2 invite id>';` | Attempt and sent set, a message id, no problem, your admin email. | ⬜ |
| E9 | **Leak check.** Vercel logs, last hour: `<you+s2>`, its local part, the first 10 characters of the token. Then `audit_trail` rows for the invite id. | No hits. "Email sent" shows `to` masked. `BOS_INVITE_CREATED` and `BOS_INVITE_EMAIL_SENT` carry the admin as actor and no email, link, token or hash. | ⬜ |
| E10 | Clean-up: revoke both invites. | Revoked. | ⬜ |

### 12.2 After 2b (migration applied, merged)

| # | Do | Expect | Pass? |
|---|---|---|---|
| R2 | New champion invite for `<you+s2b>`, emailed. Keep the email. **Resend** with reason "QA resend", keep the expiry, email ticked. | A new email arrives; the panel shows the new link once. | ⬜ |
| R3 | Open the **first** email's button in a private window. | "We don't recognise this invitation". The second email's button opens the valid page. | ⬜ |
| R4 | Resend once more with email (third email in 24 h), then again. | The third email goes; the next is refused: "limit reached, try again in …". Resend **without** email still works and shows a link. | ⬜ |
| R5 | On a 15-day invite, Resend with 60 days. | New expiry about 60 days out. | ⬜ |
| R8 | On an accepted invite (Slice 1 testing) and a revoked one. | No Resend action; a direct API call gets 409 `used` / `revoked`. | ⬜ |
| R9 | Leak check as E9 for the resend. | No hits; `BOS_INVITE_LINK_REISSUED` carries the reason and admin actor and no link. | ⬜ |
| R10 | Clean-up: revoke every test invite. | Revoked. | ⬜ |

### 12.3 After 2c (O-5 and O-6 recorded, migration applied, merged)

| # | Do | Expect | Pass? |
|---|---|---|---|
| R1 | New invite for `<you+s2c>`, emailed. Wait a minute, reload. | Email **Delivered**. (Stays Sent → check O-5/O-6.) | ⬜ |
| R6 | Invite `bounced@resend.dev`, emailed. Wait, reload. | Email **Bounced**. | ⬜ |
| R7 | Invite `complained@resend.dev`, emailed. | Email **Marked as spam**. Revoke all three afterwards. | ⬜ |

---

## 13. Rollback

**File:** `supabase/SQL Scripts/20261020_business_os_invite_email_rollback.sql`

```sql
BEGIN;

DROP INDEX public.business_os_invites_email_message_id_key;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_email_sent_shape;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_email_lengths;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_email_problem_paired;

ALTER TABLE public.business_os_invites DROP CONSTRAINT business_os_invites_inviter_reply_to_normalised;

ALTER TABLE public.business_os_invites DROP COLUMN email_problem_detail;

ALTER TABLE public.business_os_invites DROP COLUMN email_problem_at;

ALTER TABLE public.business_os_invites DROP COLUMN email_problem;

ALTER TABLE public.business_os_invites DROP COLUMN email_provider_message_id;

ALTER TABLE public.business_os_invites DROP COLUMN email_sent_at;

ALTER TABLE public.business_os_invites DROP COLUMN email_attempted_at;

ALTER TABLE public.business_os_invites DROP COLUMN inviter_reply_to;

COMMIT;
```

**File:** `supabase/SQL Scripts/20261021_business_os_invite_email_window_rollback.sql`: drops `business_os_invites_email_window_shape`, then `email_window_send_count`, `email_window_started_at`, in one transaction.

**File:** `supabase/SQL Scripts/20261022_business_os_invite_email_delivery_rollback.sql`: drops `business_os_invites_email_delivered_shape`, then `email_delivered_at`, in one transaction.

**Order: 2c → 2b → 2a** (the delivered CHECK names a 2a column).

| Scenario | Action | Consequence |
|---|---|---|
| 2a code problem | RM reverts the 2a merge; the migration can stay (nothing older selects the columns). | Invites are created as in Slice 1 (copy the link). Emails already sent keep working. |
| 2a migration problem | Revert or hold the code first, then the rollback, then the pre-check reads `0`. | Delivery facts and Reply-To snapshots lost; invites and links untouched. |
| 2b code problem | Revert the 2b merge. | No resend; links issued by resend keep working. |
| 2b migration problem | Revert or hold 2b code, then its rollback. | Window counts lost. |
| 2c code problem | Revert the 2c merge. | Statuses stop at Sent; the `email_sends` webhook path returns to today's behaviour. |
| 2c migration problem | Revert or hold 2c code, then its rollback. | Delivery timestamps lost. |
| Privilege drift | Re-run Slice 0's five `REVOKE`/`GRANT` statements, then the checker. | None. |
| Wrong emails going out | Untick per invite; to stop all sends, revert 2a (no kill switch, F-10). Unsetting `RESEND_FROM_EMAIL` also stops invite emails (fail-closed, R-2) but stops platform system mail too. | — |

---

## 14. Findings for SA, with rulings

| # | Topic | Choice in this workplan | SA ruling (2026-09-29) |
|---|---|---|---|
| **F-1** | Migrations per sub-slice | One per sub-slice | Confirmed; three with R-4 |
| **F-2** | Sender domain | Reuse the configured address, "<Name> via AgentPilot" | Approved with condition: never the `neuronforge.app` default (R-2); O-1 gate |
| **F-3** | Language source | `user_preferences` only | Confirmed |
| **F-4** | `redactInLogs` | Opt-in in the transport | Confirmed, inside `errorTextForLog`, raw token included (R-9) |
| **F-5** | Link at the provider | Accept | Accepted; limit Resend dashboard access to Vercel admins |
| **F-6** | Reply-To snapshot | Snapshot | Confirmed |
| **F-7** | Expiry date | Date only, UTC | Confirmed |
| **F-8** | Per-admin cap | None | Confirmed |
| **F-9** | Opens and clicks | Not built | Confirmed; click tracking off at the provider (O-2) |
| **F-10** | Kill switch | None | Confirmed |
| **F-11** | Reason on resend | None proposed | **Ruled: required** (R-7) |
| **F-12** | Failed sends count | Counted | Confirmed |
| **F-13** | 1b checker S02 | Documented | Noted; R-10 prevents repeats |
| **F-14** | 1c overlap | 2a after 1c | Confirmed; 1c adds no migration |

---

## 15. Logging-standard check (console.*)

Every existing file Slice 2 modifies or calls was checked on `origin/main` 8cdff1cb.

| File | `console.*` calls |
|---|---|
| `lib/notifications/emailTransport.ts` | 0 |
| `app/api/webhooks/resend/route.ts` | 0 |
| `lib/repositories/BusinessOsInviteRepository.ts`, `types.ts`, `index.ts` | 0 |
| `lib/repositories/EmailAutomationRepository.ts` (called) | 0 |
| `lib/business-os/invites/adminInviteOps.ts`, `inviteSchemas.ts`, `inviteToken.ts` | 0 |
| `app/api/admin/business-os/invites/route.ts` | 0 |
| `app/admin/business-os-invites/page.tsx`, `types.ts`, `components/*.tsx` (5 files) | 0 |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts` | 0 |
| `lib/email/templates/base-template.ts`, `lib/business-os/userLanguage.ts`, `lib/i18n/config.ts` | 0 |
| `lib/business-os/entitlements/config/invites.ts`, `__tests__/enforcementPoints.test.ts` | 0 |
| `middleware.ts`, `lib/admin/requireAdminRoute.ts` (not modified) | 0 |

**No file needs converting.** New server files use `createLogger`; new client components log nothing. The four direct `user_preferences` readers in §1 are not touched; their non-compliance is noted, not fixed here.

---

## 16. Open issues and follow-ups

| # | Item | Owner | Status |
|---|---|---|---|
| OI-1 | Vercel Firewall rule on `/api/public/invites/` (Slice 1). Unchanged by Slice 2. | Offir | Open |
| OI-2 | Erasure and 12-month anonymisation (L-12). **Slice 2 adds `inviter_reply_to` and `email_problem_detail` to what the future erasure must clear.** | TL | Open, first qualifying date 2027-09-28 |
| OI-3 | Ops O-1 to O-6 (§7.1): O-1/O-2 gate 2a; O-5/O-6 gate 2c. | Offir / Resend dashboard holder | Open |
| OI-4 | Migration reservation: `20261016`–`20261019` for credit deduction, `20261020`–`20261022` for Slice 2 (R-1, Step T). | TL | Open |
| OI-5 | Default note template (BQ-12). | Future | Not built |
| OI-6 | Per-admin invite email cap, only if invite volume ever becomes an abuse path (F-8). | Future | Not built |

---

## SA Review Notes

### SA Workplan Review — 2026-09-29

**Reviewed by SA — 2026-09-29**
**Status:** ✅ **Approved with conditions.** Nothing is blocking and the approach fits the codebase. Dev folds R-1 to R-14 into this workplan before 2a-1. **No second full SA pass is needed.** SA checks the R-items at the 2a code review, and glances at the re-cut table from R-4 when Dev updates §2.

**What was verified against `origin/main` 8cdff1cb and the other branches (2026-09-29):**

| Claim | Result |
|---|---|
| Transport: `from`/`replyTo` explicit, no `ownerUserId` → `resolveSender` returns `from` untouched | ✅ `emailTransport.ts:481-483, 534-538` |
| Default sender is `NeuronForge <notifications@neuronforge.app>` when `RESEND_FROM_EMAIL` is unset | ✅ `emailTransport.ts:25, 240, 537`. **Nobody has recorded what production actually sends from.** Slice 1's B3/C9 ("record the From") are still ⬜. See R-2 and O-1. |
| Provider error text is scrubbed only by `errorTextForLog` (Resend `:282-283`, and the three `catch` blocks) | ✅ So `redactInLogs` belongs inside `errorTextForLog`, and one change there covers every log line and the returned `error`. |
| "The transport logs 50 subject characters" | ⚠️ Partly. The final "No email transport delivered" warn (`:578`) logs the **full** subject. It is harmless because the subject never carries the link. Doc fix, R-13. |
| Webhook: Svix HMAC, 5-minute window, timing-safe compare, fail-closed without the secret, unmatched → 200 | ✅ `app/api/webhooks/resend/route.ts`. One thing to note: types that `toDeliveryEvent` does not map return **before** any lookup (`if (!delivery)`), so `email.failed` and `email.suppressed` need a restructure. See R-6. |
| `requireAdmin` returns `{ id, email? }` | ✅ `requireAdminRoute.ts:89`. `email` is optional, so a NULL `inviter_reply_to` must be handled. It is: the CHECK allows NULL, and the send goes out with no Reply-To and a `warn`. |
| Link builder | ✅ `buildInviteLink(token)` in `inviteToken.ts:48`. Reuse it (R-9). |
| `user_preferences.preferred_language` | ⚠️ No migration in the repo defines it (the table was created in the dashboard). Existing readers query it directly, and no repository reads it, so the new repository is justified. The column still needs a live check (R-11). |
| Entitlements importers | ✅ `adminInviteOps.ts` already imports `planLabel` and is registered. `inviteEmail.ts` would be a new importer (R-12). |
| Migration numbers | `20261015_business_os_credit_charges.sql` is **pushed** on `origin/feature/business-os-credit-deduction-slice-3b-i` (open **PR #140**), and not only local. There is no `20261016`+ on any `origin/*` branch, on any open PR or in any worktree. The credit-deduction work has more slices to come (3b-ii onwards), and its next file will naturally be `20261016`, the same number this workplan picked. Two different features have already both used `20261014` (`business_os_ai_charges` and `business_os_invite_signup`). See R-1. |

#### Rulings on F-1 to F-14

| # | Ruling |
|---|---|
| **F-1** | **Confirmed: one migration per sub-slice** (R-11 precedent; nothing uncalled ships). With R-4 that becomes three: 2a, 2b and 2c. |
| **F-2** | **D-1 approved in principle, with a condition.** Reuse the platform's configured sending address (no new `invites@` local part), with the display name `"<Name> via AgentPilot"`. **Invites must never fall back to the hard-coded `neuronforge.app` default** (R-2). **Before 2a merges**, an admin confirms that `RESEND_FROM_EMAIL` on Vercel Production is an address on a domain Resend shows as Verified, and that it is an AgentPilot domain (O-1). If it is still NeuronForge, 2a does not merge and TL raises U-1. Sending "Dana via AgentPilot" from `@neuronforge.app` shows a brand the invitee has never heard of on the very first email they get, which is what the requirement ("from our verified domain", AgentPilot branding) rules out. |
| **F-3** | **Confirmed.** C-8 as approved: `user_preferences.preferred_language` is a pre-select only. A false `en` default costs the admin one click. |
| **F-4** | **Confirmed: keep `redactInLogs`**, opt-in, MF-1 style, applied inside `errorTextForLog`. It must include the **raw token** itself, not only the full link (R-9). |
| **F-5** | **Accepted.** Resend keeping the sent content (dashboard and retention) is inherent to emailing a link, and 1b's code email already has the same property. It is not a credential: T-5 needs the one-time code from the invitee's mailbox. On a resend, the copies Resend holds of earlier emails carry **dead** links, because rotation kills them, so resending lowers the exposure. We store no body anywhere, since `email_sends` is not used. One ops note: access to the Resend dashboard should be limited to the people who already hold Vercel admin. |
| **F-6** | **Confirmed: snapshot `inviter_reply_to`.** Invites created before 2a exist only as test invites. A resend of one of them by another admin going out with no Reply-To is acceptable. |
| **F-7** | **Confirmed: date only, in UTC, in the invite's locale.** Being a few hours early east of UTC is acceptable. |
| **F-8** | **Confirmed: no per-admin cap.** FR-14 asks only for the per-invite cap. Admins are gated, audited and few. If invite volume ever becomes an abuse path, it goes into the follow-ups, not into this slice. |
| **F-9** | **Confirmed: open and click tracking are not built.** They must also be **off at the provider** for the link's sake. See F-5, R-3 and O-2. |
| **F-10** | **Confirmed: no kill switch.** Every send is one admin action at a time. The per-invite checkbox and a revert are enough. A flag would be a new moving part for a risk that does not exist at this volume. |
| **F-11** | **Ruled: a reason is required on resend.** No user decision is needed: FR-7 (approved) says every admin route audits "with actor and reason", and revoke already takes one. A resend changes the credential and can extend the expiry, which is a material change. Reuse `reasonSchema` (3 to 500 characters). It is audited in `BOS_INVITE_LINK_REISSUED` details the way revoke audits its reason. One text field in the dialog is proportionate. (R-7) |
| **F-12** | **Confirmed: count failed attempts.** Reissue without email is uncapped, so no admin is ever stuck. |
| **F-13** | Noted. R-10 stops the new checkers from repeating the pattern. |
| **F-14** | **Confirmed.** 2a implementation starts after 1c merges, rebased onto `origin/main`. 1c adds no migration (none found in `neuronforge-invite-s0`). |

#### Other rulings

| Topic | Ruling |
|---|---|
| **Link never in logs, DB or email records** | ✅ The design holds. The raw token lives only in the local variable, the template output, the 201/200 body and the provider request. `redactRecipientInLogs` plus `redactInLogs` cover the transport. `email_problem_detail` is scrubbed a second time and capped at 300. The subject never carries the link. `email_sends` is not used. Audit rows hold no link, token, hash or email. The §11 leak test (serialised logger and audit calls) is the right proof. Keep it as a required 2a test. |
| **Compare-and-swap write-back** | ✅ `recordInviteEmailOutcome` filtered on `(id, token_hash)` is correct. A slow outcome for an old link matches 0 rows and becomes a `warn`. The webhook write needs the same treatment (R-6). |
| **Migrations: no GRANT change** | ✅ **Sufficient, and here is why.** Postgres table-level privileges (`relacl`) apply to every column of the table, including columns added later. `ADD COLUMN`, `ADD CONSTRAINT` and `CREATE INDEX` change neither `relacl` nor `relrowsecurity`. `ALTER DEFAULT PRIVILEGES` applies only to new tables, functions and sequences, never to columns. Indexes and constraints carry no ACL. So Slice 0's `REVOKE ALL` from `PUBLIC`/`anon`/`authenticated` plus `GRANT SELECT, INSERT, UPDATE TO service_role` still governs every new column, and RLS on with zero policies still refuses every non-service-role read. The only way a new column could be exposed is an explicit **column-level** grant (`attacl`), which nothing issues. R-10 adds a checker row that proves this. |
| **Editor safety** | ✅ One `BEGIN`/`COMMIT`, no comments, no string literals, no aliases. Every CHECK is NULL-safe (M-2 lesson). The rollback order is right (2c before 2b before 2a, because the delivered CHECK names a 2a column). `ADD COLUMN … NOT NULL DEFAULT 0` is metadata-only. The pre-check queries contain literals, which is the accepted Slice 1 precedent because they are separate read-only pastes. |
| **Webhook signature** | ✅ Unchanged and sound: HMAC-SHA256 over `id.timestamp.body` with the base64 `whsec_` key, multi-signature for rotation, `timingSafeEqual` after a length check, ±300 s window, fail-closed 401 without the secret. A replay inside the window is harmless because the writes are idempotent and never regress. |
| **Fallback lookup without `email_sends`** | ✅ T-8 as decided. The message id is Resend-generated, unguessable and unique (backed by the partial unique index), so matching on it cannot reach the wrong row. Precondition: R-6. **Accepted race:** a `delivered` event that arrives before the create route's outcome write matches nothing and gets 200, so the row stays "Sent". That window is milliseconds against seconds of provider latency, and the cost is one missing badge. Document it; do not build a retry. |
| **Click tracking OFF: a launch gate for 2a?** | **Yes, a pre-merge gate for 2a (O-2), not a post-merge check.** 2a is the first slice that emails a link. The token's whole design (fragment only, never logged, never on our servers) assumes no third-party redirect sits in front of it. With click tracking on, every button and plain link is rewritten to a Resend tracking URL: the token is stored in a second Resend system and appears in click logs, the invite shows a tracker hostname (which looks like phishing), and correct behaviour depends on the tracker keeping the `#t=` fragment across a redirect. The gate costs one dashboard look. E5 stays as the post-merge proof. |
| **Sequencing** | ✅ After 1c merges: rebase, then re-verify the migration numbers (R-1), then start 2a-1. |
| **Scope and split honesty** | 2a is coherent and demoable. Its roughly 34 files are mostly tests, and the size is honest. **2b as written bundles two independent things**: resend with a cap (required by FR-14), and webhook delivery status (FR-17, which the requirement marks *optional*, and which only works once O-5 and O-6 are done, the same ops dependency that has kept the payment crons dormant). Split them (R-4) so resend is never held behind ops, and so delivery status can be parked without loss. |
| **Tenant isolation** (`tenant-isolation-guard`) | ✅ §3.4 is correct: global-catalog admin records behind `requireAdmin`, field-by-field patches, `inviter_reply_to` taken from the gate and never from the body, and no trigger, upsert or spread. The webhook reaches a row only through a verified message id, and after R-6 its update is also conditioned on that id. |
| **Entitlements** (`business-os-entitlements`) | See R-12. The Slice 0 file list is already registered. The new points are `inviteEmail.ts`, the resend route and `ReissueDialog.tsx`. |
| **Logging** | ✅ §15: no `console.*` in any touched file. New server files use `createLogger`. |

#### R-items (required before or during implementation)

| # | Where | Required change | Priority |
|---|---|---|---|
| **R-1** | §1, §4, §5, §6, §7, §9, §13, Commit Info | **Renumber: 2a = `20261020`, 2b = `20261021`, 2c = `20261022`.** That leaves `20261016`–`20261019` for the credit-deduction slices (PR #140 already holds `20261015`). TL tells the credit-deduction session about the reservation. Re-check at 2a-1 **and again right before each PR opens**, against `git ls-remote`/`git ls-tree` of every `origin/*` branch, `gh pr list --state open`, and every worktree's `supabase/migrations/`. A late clash is renamed in exactly four files: migration, rollback, checker and text test. | High |
| **R-2** | D-1, `emailTransport.ts`, `inviteEmail.ts` | **Invites fail closed on the sender.** `platformSenderAddress()` returns an address **only** from `RESEND_FROM_EMAIL`, parsing both `Name <addr>` and a bare address and validating the address shape. It never returns the `RESEND_DEFAULT_FROM` constant. When it returns nothing, `sendInvitationEmail` does not call `sendEmail`, records `not_sent` with detail `sender_not_configured`, and logs `warn`. Tests: unset env, unparseable env, `"X" <a@b>`, bare `a@b`. Other senders are unchanged. | High |
| **R-3** | §7.1, §7.3, Commit Info | **Click tracking OFF becomes a pre-merge gate for 2a**, together with O-1 (the sender check). Add both as "step 0" of the §7.1 runbook and as a line in Commit Info for RM: *"Do not merge 2a until O-1 and O-2 are confirmed and recorded in this workplan."* E5 stays as the post-merge proof. | High |
| **R-4** | §2, §4.2, §5.2, §7, §9, §12.2, §13 | **Re-cut 2b into 2b and 2c.** **2b, "Resend a fresh link":** the resend route, dialog, CAS, cap and the audit event. Migration `20261021` carries `email_window_started_at`, `email_window_send_count` and `business_os_invites_email_window_shape`. No webhook change and no ops prerequisite. **2c, "Delivery status" (FR-17, optional):** the webhook fallback, `toInviteDeliveryEvent`, `recordDeliveryEventForWebhook` and the Delivered/Bounced/Spam/Failed/Blocked badges. Migration `20261022` carries `email_delivered_at` and `business_os_invites_email_delivered_shape`. Merge only after O-5 and O-6. 2c may be parked without loss. Split the §12.2 checks: R2–R5 and R8–R10 go with 2b; R1, R6 and R7 with 2c. | Medium |
| **R-5** | D-10, §3.6, `inviteEmailPolicy.ts`, 2b | **The create send opens the window.** Once 2b's columns exist, `createForAdmin` with `sendEmail: true` also sets `email_window_started_at = now` and `email_window_send_count = 1`. Test: create, then resend twice (both allowed), then a third resend is refused with 429. **Document the fixed-window semantics:** the window starts at the first send and resets 24 h later, so up to 3 more are possible right after the reset. Put this in the policy file comment and §3.6. It is acceptable for an admin-only, per-invite cap. | Medium |
| **R-6** | D-11, `route.ts` (webhook), repository (2c) | **The webhook's invite write is conditional.** The `UPDATE` filters `.eq('email_provider_message_id', messageId)` (plus the never-regress conditions) and **never on `id` alone**, so a reissue that lands between the read and the write matches 0 rows and gets 200. Restructure the route so that (a) `email.failed` and `email.suppressed` reach the invite lookup instead of the early `!delivery` return; (b) an `email_sends` result of `recorded` or `duplicate` never falls through; (c) `opened`, `clicked` and `delivery_delayed` never touch an invite. Tests for each, plus the reissue race. Document the accepted early-event race (see "Other rulings"). | Medium |
| **R-7** | §3.3, §8.3, `inviteSchemas.ts`, `ReissueDialog.tsx`, 2b | **Resend body:** `{ reason, sendEmail, linkExpiryDays? }`, `.strict()`, `reason` from the existing `reasonSchema`. `BOS_INVITE_LINK_REISSUED` details carry the reason, the same way revoke's do. Add route tests for a missing reason and a short reason (both 400). | Medium |
| **R-8** | §3.3, audit | `BOS_INVITE_EMAIL_SENT` / `_NOT_SENT` (and the 2b resend's email event) carry **`userId` and `actorId` = the admin**, as `BOS_INVITE_CREATED` does (`route.ts:152-153`), not null. FR-7 wants the actor. | Low |
| **R-9** | D-4, `inviteEmail.ts` | Build the link only with `buildInviteLink(token)` (`inviteToken.ts:48`), so the emailed link is byte-identical to the panel link, with no second env read. `redactInLogs` must contain the **raw token**: a URL-encoded or HTML-escaped copy of the link still contains the token verbatim (base64url), but not the literal link. The leak test also asserts that neither the token nor the link appears in any logger or audit call. | Low |
| **R-10** | §6.1, §6.2, a4, b4 | **Checker rows:** add one that asserts **no column-level privileges** on `business_os_invites` (every non-dropped column has `attacl IS NULL`). This is the proof that the new columns inherit table privileges only. Make the **total CHECK count** rows (M03 and the 2b/2c equivalents) **informational, not part of the VERDICT**, so the next migration does not produce yet another fail-by-design checker. The named-list rows (M02, D02) already catch our own constraints going missing. Pin both in the text tests. | Low |
| **R-11** | 2a-2 | Before writing `UserPreferencesRepository`, run the `business-os-schema-check` skill on `user_preferences.preferred_language` (existence, type, default, nullability; the table is not in the repo's migrations). Record the result in this workplan. | Low |
| **R-12** | a27, 2b files | **Entitlements.** Preferred: pass `planName` (already computed in `adminInviteOps.ts`, which is registered) into `sendInvitationEmail` and the template, so `inviteEmail.ts` imports nothing from `lib/business-os/entitlements/**` and needs no registration. Otherwise, register it with its exact symbols. Any new symbol that `adminInviteOps.ts`/`inviteSchemas.ts` import updates their `symbols` lists. The resend route imports the expiry options through `inviteSchemas.ts`, not directly. `ReissueDialog.tsx` gets the options from the GET payload (`formOptions`), never from config. Run `npm run test:bos-entitlements` in 2a-9 and 2b-7 and report it. | Low |
| **R-13** | §1 "Transport fallbacks" row | Correct the claim: the final "no transport delivered" warn logs the **full** subject (`emailTransport.ts:578`). This is harmless because the subject never carries the link, and the template test already pins that. Doc only. | Low |
| **R-14** | §9 | Add to 2a-1: "rebased onto `origin/main` after 1c merged; migration numbers re-verified (R-1)". Add to 2a-9: "O-1 and O-2 recorded (R-3)". | Low |

#### Ops setup: what a Vercel or Resend admin configures, and when

Vercel env changes take effect **only after a redeploy**. The user does not have Vercel admin, so the Vercel items go to Offir. The Resend items go to whoever holds the Resend dashboard.

| # | When | Where | What exactly | Recorded where |
|---|---|---|---|---|
| **O-1** | **Before the 2a PR merges (gate)** | Vercel → Project → Settings → Environment Variables (Production), and Resend → Domains | Confirm `RESEND_FROM_EMAIL` **is set** on Production, and read its address. In Resend → Domains, confirm that address's domain shows **Verified** (SPF and DKIM), and that it is an **AgentPilot** domain, not `neuronforge.app`. The display name in the variable does not matter to invites. If it is unset or NeuronForge: stop and go to U-1. | This workplan (the E3 line), which also answers Slice 1's open B3/C9 "record the From". |
| **O-2** | **Before the 2a PR merges (gate)** | Resend → Domains → the O-1 domain → Configuration/Tracking | **Click tracking: OFF.** Also record the open-tracking state (not a gate). If click tracking is ON, and nothing uses click counts, turn it off. If something does use them, go to U-2. | This workplan; E5 proves it after the merge. |
| **O-3** | Before 2a merges (information only) | Vercel Production env | Record **which fallback transports are configured**: `SMTP_HOST`/`SMTP_USER` present? `GMAIL_USER` present, and its address? If Gmail fallback is configured, an invite sent while Resend is down arrives **from `GMAIL_USER`'s address** (the name and Reply-To survive; L-9). | This workplan, §1 fallback row. |
| **O-4** | Before each PR merges | Supabase SQL editor (the user, by hand) | Apply `20261020` (then later `20261021`, `20261022`) and get the checker to `VERDICT PASS` before merging (the CR-1 rule). | §7 runbooks. |
| **O-5** | **Before the 2c PR merges** (not needed for 2a or 2b) | Vercel Production env, then redeploy | Set `RESEND_WEBHOOK_SECRET` to the signing secret (`whsec_…`) shown on the Resend webhook below. Without it the webhook refuses every event and statuses stay "Sent". | 2c R1. |
| **O-6** | **Before the 2c PR merges** | Resend → Webhooks | The endpoint `https://<production host>/api/webhooks/resend` exists and is subscribed to `email.delivered`, `email.bounced`, `email.complained`, `email.failed` and `email.suppressed`. **Add; do not remove** any existing `email.opened`/`email.clicked` subscription, which the automation emails in `email_sends` use. | 2c R1, R6, R7. |

#### Decisions for the user (business terms)

**None unconditional.** Two can arise only if an ops check finds something unexpected. TL raises them only in that case:

- **U-1 (only if O-1 finds the platform still sends from a NeuronForge address, or from none):** *"Today your platform's system emails (sign-up codes, and the address behind booking and invoice emails) come from a NeuronForge address. Invitations must come from AgentPilot. Switching the platform's sending address to AgentPilot fixes every email at once, but it needs the AgentPilot domain verified with our email provider first (a one-time DNS setup by whoever manages the domain). Until then, invitations cannot be emailed; admins keep copying the link by hand."* Recommended: verify the AgentPilot domain and switch the platform-wide address.
- **U-2 (only if O-2 finds click tracking ON and something relies on click counts):** *"Our email provider can count clicks on links, but to do that it routes every link through its own servers. For invitations that means the private invite link passes through a third party and looks like a tracking link. Turning it off for the whole sending domain stops click counts on automation emails too."* Recommended: turn it off. The engagement signal that matters (opens and delivery) is unaffected.

### Approval
[x] Workplan approved, conditional on R-1 to R-14. Proceed to implementation of 2a once 1c has merged. 2a does not merge until O-1 and O-2 are recorded (R-3).

### SA Code Review 2a — 2026-09-29

**Code Review by SA — 2026-09-29**
**Status:** ✅ **Code Approved with conditions.** There is one must-fix (CR2a-1, a test fixture) and one comment fix (CR2a-2). Both are small and need no second SA pass: Dev fixes them, re-runs the named suites and `tsc`, and records the result in §9.1. Reviewed: the uncommitted tree on `feature/bos-invite-signup-slice-2a` from `origin/main` cd8dcb43 (21 modified files, +1,174 / −34, plus 13 new files).

**What SA ran on the final tree (not copied from §9.1):**

| Check | Result |
|---|---|
| Invites lib, admin and public invite routes, admin screen, `/invite`, invite + preferences + lineage repositories, notifications, email templates, audit, all migration text tests | **44 suites, 1,092 tests, all pass** |
| Every `guard` / `forbidden` / `invariant` suite | **40 suites, 1,037 tests, all pass** |
| `npm run test:authz-guard` | **119 pass** |
| `npm run test:bos-entitlements` (R-12) | **87 suites, 1,818 tests, all pass** |
| `npm run lint:hooks` | exit 0 |
| `npx next build` with `build.yml`'s placeholder env | **exit 0** |
| `tsc --noEmit` (8 GB heap) | repo total 2,088; **one of them is new and caused by 2a** (CR2a-1) |

**R-items and other checks:**

| Item | Verdict | Evidence |
|---|---|---|
| R-2 fail closed | ✅ | `platformSenderAddress()` (`emailTransport.ts:284-291`) reads only `RESEND_FROM_EMAIL` and never `RESEND_DEFAULT_FROM`; it parses both a bare address and `Name <addr>`, and checks the shape. `sendInvitationEmail` checks it first. On `undefined`, or if the lookup throws, it never calls `sendEmail`, records `not_sent` / `sender_not_configured` and logs `warn` (`inviteEmail.ts:168-181`). Tests cover unset, blank, a throwing lookup, and "never neuronforge". |
| From / Reply-To / fallback | ✅ | The From line is `"<Name> via AgentPilot" <addr>`. The fallback name, or a name that is empty after cleaning, gives `AgentPilot <addr>` (`inviteSender.ts:329-333`). Header-unsafe characters are stripped and the name is capped at 64 code points. Reply-To is the gate's email, normalised, and never a body field; `.strict()` refuses `from`/`replyTo`. There is no `ownerUserId`, so `resolveSender` leaves `from` as given. |
| R-9 link | ✅ | The link is built only by `buildInviteLink(token)` (`inviteEmail.ts:143`). `redactInLogs: [token, link]` is applied longest-first inside `errorTextForLog`, which covers every provider-error log line and the returned `error`. The stored detail is scrubbed again (token, link, hash, email-shaped text) and capped at 300. Audit details hold only status words, the provider and the message id. Leak tests exist at unit and route level. |
| D-dev-2a-2 write-back | ✅ | `recordInviteEmailOutcome` (`BusinessOsInviteRepository.ts:255-287`) is `.update(patch, { count: 'exact' }).eq('id').eq('token_hash')`, with **no `.select()` and no `.or()`**. It returns `true` only when `count === 1`, and the test asserts that neither `select` nor `or` is called. **2a adds no `.or()`+`.select()` chain.** |
| D-dev-2a-6 throw | ✅ | If the template or the transport throws, the result is `not_sent` / `transport_failed`, recorded, and the route still answers 201 with the link (`inviteEmail.ts:212-221`, plus a route test). |
| R-8 actors | ✅ | Both email events carry `userId` = `actorId` = the admin, pinned by a route test. |
| R-12 entitlements | ✅ | `inviteEmail.ts`, `inviteSender.ts`, `inviteEmailPolicy.ts`, the template and the new repository import nothing from `lib/business-os/entitlements/**`, and a source test pins that. `planName` comes from the already-registered `adminInviteOps.ts`. `enforcementPoints` is untouched and `test:bos-entitlements` is green. |
| Repository / tenant isolation | ✅ | `UserPreferencesRepository.findPreferredLanguage` is `.eq('user_id', userId).maybeSingle()`, read-only, with the M-1 scrub through `safeDbError`. Its only caller passes the gate's own id. Invite writes are admin-gated `ForAdmin` methods on a global catalogue, built field by field. |
| Gate, Zod, logging | ✅ | `requireAdmin` is still the first statement of GET and POST. `sendEmail: z.boolean()` is required inside the `.strict()` objects. No touched or new file uses `console.*`. |
| R-10 / migration | ✅ | See below. |
| R-11 | ✅ | Closed by TL's live check today; recorded in §10.3. |

**Migration `20261020`: APPROVED TO PASTE.** The SQL itself needs no change. It is one `BEGIN`/`COMMIT` with no comments, no string literals and no aliases. It adds 7 nullable columns, 4 NULL-safe CHECKs that every existing row satisfies, and 1 partial unique index. No `GRANT`/`REVOKE` is needed, because the table ACL covers new columns.

The checker is read-only. M07 proves there is no column-level ACL (R-10). M03, the total count, is `INFO` and outside the verdict. A missing table fails M01. The rollback drops the index, then the constraints, then the columns in reverse order. §7.2's pre-check is a separate read-only paste.

The apply order is unchanged:
1. O-1 and O-2 recorded.
2. Pre-check.
3. Paste the migration.
4. Checker `VERDICT PASS`.
5. Slice 0 checker PASS.
6. Merge.

**Rulings on Dev's deviations:**

| # | Ruling |
|---|---|
| D-dev-2a-1 | **Accepted.** `email_provider_message_id` is needed server-side to tell "Sent" from "Sent (not tracked)", and `toInviteListView` is the only mapper to a response. Tests pin that it never reaches a view, a response or a log. `inviter_reply_to` and `email_problem_detail` stay out of every select. §11's a17 row is superseded on this point. |
| D-dev-2a-2 | **Accepted.** This is the preferred shape for any compare-and-swap write that does not need the row back. |
| D-dev-2a-3 | **Superseded:** TL closed R-11 live (§10.3). |
| D-dev-2a-4 | Accepted; 2c replaces the branch. |
| D-dev-2a-5 | Accepted. |
| D-dev-2a-6 | **Accepted; this is required behaviour** (FR-16). |
| D-dev-2a-7 | Accepted. The panel reports the send; the row reports what the list will show on reload. |
| D-dev-2a-8 | Accepted. |
| D-dev-2a-9 | Accepted. |
| D-dev-2a-10 | Accepted. A bad gate email must never make an insert fail the CHECK. |
| D-dev-2a-11 | Accepted for now. Moving `safeDbError` into a shared repository helper is a later tidy-up, not a 2a item. |
| D-dev-2a-12 | Accepted. The native-speaker read of `he`/`es` should happen before the §12.1 checks. |
| D-dev-2a-13 | Accepted. It goes with the 1b hotfix or later. |
| D-dev-2a-14 | Accepted. |

### Code Review Comments

1. **CR2a-1** `app/api/admin/business-os/invites/__tests__/revoke.route.test.ts:84-120`: the `row()` fixture is typed `BusinessOsInvite` but lacks the five new required fields. `tsc` therefore reports a **new** TS2322 (`email_attempted_at` is `string | null | undefined`). Jest passes because it does not type-check. The file is outside the diff, which is how §9.1's "0 errors in touched files" missed it. **Fix:** add `email_attempted_at`, `email_sent_at`, `email_provider_message_id`, `email_problem` and `email_problem_at` as `null`, re-run `tsc`, and confirm that no error names an invite file. Priority: **Medium (must-fix before commit)**
2. **CR2a-2** `lib/notifications/emailTransport.ts:145-146`: the new `redactInLogs` doc says "The subject and the body are never logged by this transport". The subject **is** logged: 50 characters at `:563` and `:574`, and in full at `:640`. That is the same claim R-13 corrected. **Fix:** say that the body is never logged but the subject is, so callers keep secrets out of it (the invitation template does). Priority: **Low (must-fix, comment only)**
3. `lib/business-os/invites/adminInviteOps.ts:427`: the 201's `emailStatusAt` comes from a second `deps.email.now()` call, so it can differ by milliseconds from the stored timestamp. Cosmetic. Priority: Low (nit)
4. `app/admin/business-os-invites/page.tsx:95`: the intro says an invite "is emailed to them" unconditionally, but the checkbox can turn that off. Consider "can be emailed to them". Priority: Low (nit)
5. `inviteSender.ts:311` vs `emailTransport.ts:264`: there are two address-shape regexes (the sender one requires a dot, the Reply-To one does not), and `EMAIL_SHAPED` is duplicated at `inviteEmail.ts:111`. Harmless; fold them into one helper when convenient. Priority: Low (nit)

### Notes for TL, QA and the hotfix

- **The `.or()`+`.select()` hotfix.** 2a adds no such chain. The existing `revokeForAdmin` (`BusinessOsInviteRepository.ts:212-229`, unchanged by 2a) still chains `.or(noLiveClaim)` with `.select(BUSINESS_OS_INVITE_ADMIN_COLUMNS)`. Under the stated failure condition it is safe, because `claimed_at` is in that select list and 2a keeps it there. The hotfix's `mutationOrSelect.guard.test.ts` must either allow that case or convert revoke too. The hotfix and 2a edit the same repository file, in different methods. Whichever lands second rebases and re-runs the repository and guard suites.
- **QA locally.** `RESEND_FROM_EMAIL` is not set in `.env.local`, so a local create with the box ticked will show "Not sent" (`sender_not_configured`). That is R-2 working as designed. To test a real send locally, set the variable to an address on a verified domain.
- **O-1 context: should 1b's signup-code email do the same?** Yes, as a **follow-up, not in 2a**. Today 1b passes no `from`. So the code email goes out from `RESEND_FROM_EMAIL`, **including that variable's own display name**, or from the NeuronForge constant when the variable is unset. An invitee who gets "Dana via AgentPilot" and then a code email under another name, or from `neuronforge.app`, has reason to distrust it.
  - **Recommendation:** 1b's `sendCode` should use the same `platformSenderAddress()` with the fixed display name `AgentPilot`, **and fail closed** when it is unset: no send, a `warn`, and the code step reports a failed send as it already does for `sent: false`.
  - **Cost:** once O-1 is recorded, the fail-closed branch cannot be reached on production. It costs nothing there and keeps the brand rule if the variable is ever removed.
  - **Difference from 2a:** an unsent code blocks that signup, because there is no copy-the-link fallback. That is why O-1 must stay a hard gate.
  - **Owner:** TL, after the 1b hotfix lands.

### Optimisation Suggestions
- Items 3 to 5 above.

### Code Approved for QA: **Yes, once CR2a-1 and CR2a-2 are fixed.** Dev self-verifies; SA does not need to re-review. The merge still waits for O-1, O-2 and O-4 (§7.1, R-3).


---

## QA Testing Report

### QA Report 2a — 2026-09-29

**QA — 2026-09-29**
**Test mode:** full
**Strategy used:** A + B. Jest unit and route suites in the worktree. Probes kept in the QA scratchpad (not in the tree) run the **real** route, `adminInviteOps`, `inviteEmail`, `inviteSender`, template and `emailTransport`, with only `fetch`, `nodemailer`, the gate, the repositories, the audit and the logger stubbed. The mutation run used 14 mutants. The real `20261012`/`13`/`14` + `20261020` SQL, the rollback and three checkers ran on an in-memory PGlite. Playwright is not set up (CLAUDE.md), so the browser path is the production checklist below.
**Focus:** api, security, schema, ui (source/render)
**Skipped:** Live DB, live email and the browser, by instruction: no DB writes and no real sends. The transport was stubbed at `fetch`/`nodemailer`. `tsc` was not re-run by QA: SA ran it, and QA confirmed the CR2a-1 fixture fields are present (`revoke.route.test.ts:116-120`).
**Input source:** prompt keywords (TL brief)
**Safety:** Before any test ran, QA snapshotted all 36 modified and untracked files, plus `git status` and `git diff --stat`, with SHA-256 hashes. Each mutant was applied to one file, then that file was restored from the snapshot and hash-checked; all 14 restored equal. At the end `git status --porcelain` and `git diff --stat` were byte-identical to the snapshot, and every file compared equal. No `checkout`/`stash`/`reset`/`clean`/`restore`/`rebase`, and no commit. This section is the only change.

#### Tests run

| Run | Result |
|---|---|
| 2a + neighbouring suites (invites lib, admin + public invite routes, admin screen, `/invite`, invite + preferences + lineage repositories, notifications, email + templates, audit, the four invite migration tests, Resend webhook) | **46 suites, 943 tests, all pass** |
| Every `*guard*` / `*forbidden*` / `*invariant*` suite | **38 suites, 1,025 tests, all pass**. There is no `mutationOrSelect.guard` on this branch yet: it belongs to the 1b hotfix. |
| `npm run test:authz-guard` | **119 pass** |
| `npm run test:bos-entitlements` | **87 suites, 1,818 tests, all pass** (the diff adds no entitlements importer) |
| QA route probe (real transport, stubbed network) | **37 / 37 pass** |
| QA pure-function edge probe | **4 / 4 pass** (records behaviour; see QA2a-2 to QA2a-4) |
| QA SQL probe (PGlite) | **43 / 43 pass** |
| Mutation run | **14 / 14 killed** |

#### Test Coverage

| Acceptance criterion / check | Tested? | Result | Notes |
|---|---|---|---|
| R-2: fail closed when `RESEND_FROM_EMAIL` is unset, blank, unparseable, `a@b` with no dot, `X <nope>`, or the lookup throws | ✅ | Pass | Route probe with the real `platformSenderAddress`: 201, the link, `not_sent`, `fetch` **never called**, the stored detail is exactly `sender_not_configured`, the `EMAIL_NOT_SENT` reason is `sender_not_configured`, and "neuronforge" appears nowhere in the logs, audit, outcome or response. The unit test covers the throwing lookup. Mutants M1 and M2 were killed. |
| From "<Name> via AgentPilot" and the fallback | ✅ | Pass | Real Resend body: `"Dana Levi via AgentPilot" <team@agentpilot.example>`. With no name: `AgentPilot <addr>`. CR, LF, NUL, `"`, `<`, `>` and `\` in the admin name are stripped from From and Subject. A 300-character name is capped at 64. |
| Reply-To from the gate only; `.strict()` | ✅ | Pass | `reply_to` is the gate email, lower-cased. The body keys `from`, `replyTo`, `reply_to` and `inviterReplyTo` each get 400 with nothing inserted or sent. A missing `sendEmail` gets 400. Mutant M10 (Reply-To from the body) was killed. |
| R-9: the link is never in logs, DB, audit, errors or stored detail | ✅ | Pass | Resend 422 bodies echoed five things: the link, `encodeURIComponent(link)`, the full HTML, the raw token, and the invitee's address beside the link. `fetch` also threw with the whole text part, and the SMTP fallback failed with `#t=<token>` in its error. In every case the serialised logs, audit, recorded outcome and insert hold no token (nor its first 10 characters), no encoded link and no invitee address. The detail is ≤300 characters and starts `transport_failed`. The response carries the token exactly once (`data.link`). Mutants M3a, M3b and M3c were killed. Partial echoes: see QA2a-2. |
| Write-back keyed on `(id, token_hash)`, `count:'exact'`, no `.select`/`.or`; stale token → no write | ✅ | Pass | The unit test asserts the chain. In PGlite, the repository's exact patch writes 1 row, and the same patch with a replaced `token_hash` writes **0** rows and leaves the earlier message id. At route level a lost CAS shows the row as `unknown` while the response says `sent` (D-dev-2a-7). Mutants M4 and M4b were killed. |
| A throwing send → `not_sent` / `transport_failed`, 201, link shown | ✅ | Pass | Route probe (a throwing `fetch`) and unit test. Mutant M5 was killed. |
| Checkbox off → no send, "Not emailed" | ✅ | Pass | No `fetch` call. `email_attempted_at` is NULL, the result is `{ requested: false, status: 'not_emailed' }`, the row reads `not_emailed`, only `BOS_INVITE_CREATED` is audited, and no outcome is written. |
| Language default from `preferred_language`; `en` on error | ✅ | Pass | GET: `he` → `he`; a repository error, a thrown error, `fr` or no row → `en`, still 200. |
| Templates en/he/es, RTL for he, note escaped | ✅ | Pass | he has `dir="rtl"`; en and es do not. `<img onerror>`, `<script>`, `"><a href="javascript:">` in the note and `<b>` in the name are all rendered as text (`&lt;script&gt;`), line breaks become `<br>`, and the subject has no `#t=`. Mutant M6 was killed. **Copy for he/es needs a native read (D-dev-2a-12).** |
| Admin list statuses; the message id never in a view or response | ✅ | Pass | GET on five rows gives `sent`, `sent_untracked`, `not_sent`, `unknown`, `not_emailed`. Rows carrying `msg_…`, `inviter_reply_to` and `email_problem_detail` leak none of them into the GET. The 201 omits the message id. The render test pins the "Sent" / "Sent (not tracked)" / "Not sent" / "Not emailed" labels and the panel lines. Mutants M7a and M7b were killed. |
| R-8 audit | ✅ | Pass | `BOS_INVITE_CREATED`, then `BOS_INVITE_EMAIL_SENT`. Both have `userId = actorId =` the admin, and neither's details holds the token, hash, `#t=`, invitee email or admin email. `EMAIL_SENT` does carry the Resend message id, by design (§3.3); see note N-1. |
| `requireAdmin` first; no `ownerUserId` (T-11) | ✅ | Pass | Mutant M8 (a body read before the gate) was killed by the gate-first test. Mutant M9 (`ownerUserId` passed) was killed. |
| Migration `20261020`: editor-safe, NULL-safe CHECKs | ✅ | Pass | It applies verbatim over rows created before it. It has one `BEGIN`/`COMMIT`, no comments, no string literals, and no GRANT, REVOKE, POLICY, TRIGGER or FUNCTION. Column types are as designed. Every CHECK refuses its bad shape: detail 301, a problem word of 33, a message id of 256, an unpaired problem, sent without an attempt, an id without sent, and an unnormalised, too-short or too-long Reply-To. A 300-emoji detail is accepted. A duplicate message id is refused by the partial unique index. A second paste fails atomically with `already exists`, and the table is unchanged. |
| Checker (M01–M09, M07, M03 INFO) | ✅ | Pass | Before apply: FAIL (5 pass, 3 fail). After: **`VERDICT PASS`, 8 pass 0 fail 1 info**, and M03 reads "27 in total". **M07 FAILs on a real column-level GRANT** and PASSes again after the REVOKE, so there is no false alarm. An extra CHECK leaves M03 as INFO and the verdict unaffected (R-10). anon and authenticated cannot read the new columns; service_role can. Slice 0 checker: PASS, 11/0. 1b checker: S02 FAILs by design ("27 of 23"), and every other row passes, as §6 documents. |
| Rollback | ✅ | Pass | It removes the 7 columns, the 4 named CHECKs and the index. The Slice 0 and 1b checkers are back to PASS (the 1b checker is 12/0 again). A re-apply succeeds, and the 2a checker is PASS. |

#### Issues Found

##### Bugs (must fix before commit)
None.

##### Edge Cases (should or nice to fix; none blocks)
1. **QA2a-1: the invitation send has no deadline, so a provider that hangs costs the admin the link.** Severity: **Medium** (edge; not blocking). Files: `lib/notifications/emailTransport.ts:332` (Resend `fetch` with no timeout), the SMTP/Gmail `nodemailer` defaults (2-minute connection timeout), `app/api/admin/business-os/invites/route.ts:73` (`maxDuration = 30`) and `lib/business-os/invites/inviteEmail.ts:199` (awaited with no bound).
   - Steps to reproduce: the QA probe gives `fetch` a promise that never resolves, then POSTs a create with `sendEmail: true`.
   - Expected (FR-16, D-5): the admin always gets the link once; a failed send reads "not sent" or "unknown".
   - Actual: the row is inserted with `email_attempted_at` set, and no outcome is recorded. After 3 s the 201 still has not answered. On Vercel the function is killed at 30 s, so the admin gets an error, never sees the link, and the row shows "Unknown". Before 2b, the only recovery is to revoke and create again. The same happens if Resend fails fast but a configured SMTP host is unreachable (O-3 will say whether SMTP is configured).
   - Suggested fix (Dev/SA decide; 2a or 2b): bound the send in `sendInvitationEmail`, for example a race of about 20 s that records nothing and returns `unknown` (the mail may still go out). Or add an opt-in `AbortSignal.timeout` on the Resend `fetch`. Either keeps the 201 and the link inside `maxDuration`.
2. **QA2a-2: redaction is whole-string only.** Severity: Low. Files: `inviteEmail.ts:117-124`, `emailTransport.ts:258-265`. A provider error that echoes a **truncated** token (`#t=AbCdEf…`) or one broken by a quoted-printable soft line break (`=\r\n`) passes through; the probe shows both. This is unlikely, because Resend's API errors do not echo bodies, and a partial token is not a credential (T-5 needs the mailbox code). A possible hardening is to also redact a fixed prefix of the token (for example its first 12 characters). E9's log search would catch it either way.
3. **QA2a-3: `platformSenderAddress()` refuses the constant by source, not by value.** Severity: Low (information). If `RESEND_FROM_EMAIL` is literally `NeuronForge <notifications@neuronforge.app>`, invites send from it. R-2 as written is met; **O-1 is the only guard against a NeuronForge value, so it must stay a hard gate.** A value that holds two addresses returns the last one. It is operator-set, so this is harmless.
4. **QA2a-4: the display name accepts `@` and U+0085.** Severity: Low (information). `"support@bank.example via AgentPilot" <addr>` is possible, because the name comes from the admin's own profile. U+0085 (NEL) is not `\s` in JS, so it survives. It is not an injection, because the transports encode non-ASCII names, and only gated admins set names. No change is needed.
5. **QA2a-5: the checker's `SET default_transaction_read_only = on` only covers later transactions.** Severity: Information. The PGlite probe proves it: an UPDATE pasted in the same text as the checker is allowed, and the next statement in that session is refused. It is harmless because the checker only SELECTs, and every earlier checker has the same shape. **Paste the checker on its own**, as §7.2 already says.

##### Notes
- **N-1:** `BOS_INVITE_EMAIL_SENT` details carry the Resend message id (§3.3, by design). The rule "never in a view or response" is about the invite list and the create response, and those hold. The audit-trail admin screen can show the id. It is not a secret.
- The SA nits (items 3 to 5) remain open, and none is a QA concern. The `page.tsx` intro nit (item 4) is already addressed ("it can be emailed to them").

#### Mutation results (each restored from the snapshot and hash-checked)

| # | Mutant | Killed by |
|---|---|---|
| M1 | Fail-closed branch disabled (`if (!address && false)`) | `inviteEmail.test` "unset sender: no send at all" + route tests (4 failed) |
| M2 | `platformSenderAddress()` returns the NeuronForge constant's address when unset | `emailTransport.redactRecipient.test` "unset → undefined" (3 failed) |
| M3a | Raw token dropped from `redactInLogs` (link only) | `inviteEmail.test` "exact transport parameters" |
| M3b | Transport redaction loop disabled | `emailTransport.redactRecipient.test` "echoes the link, an escaped link and the token" (3 failed) |
| M3c | Stored-detail scrub drops the secrets | `inviteEmail.test` "detail scrubbed of token, link, hash and email" (4 failed) |
| M4 | Write-back filters `id` only (no `token_hash`) | `BusinessOsInviteRepository.test` "CAS on id AND token_hash" |
| M4b | Write-back adds `.select('id')` | same test (asserts no `.select`) |
| M5 | A throwing send propagates | `inviteEmail.test` "a send that THROWS still ends as not_sent" |
| M6 | Note not HTML-escaped | `invite-invitation.test` "escapes the note and the name" |
| M7a | Message id added to the 201's `email` | route test (8 failed) |
| M7b | Message id added to the list view | `adminInviteOps.test` "never the message id or the Reply-To" + route tests (5 failed) |
| M8 | Body read (`request.clone().text()`) before `requireAdmin` | route test "the body is never read before the gate, by any reader" |
| M9 | `ownerUserId` passed to the transport | `inviteEmail.test` "NO ownerUserId" (2 failed) |
| M10 | Reply-To taken from the body instead of the gate | route test "sendEmail true, sent …" |

#### Production checklist (the user; tester's own mailbox only)

**Gates first. Do not merge until all of the gates below are ✅ and recorded in §7.1.**

| # | Do | Expect | Pass? |
|---|---|---|---|
| G1 (**O-1**) | Vercel → Production env: read `RESEND_FROM_EMAIL`. In Resend → Domains, find that address's domain. | Set. The domain shows **Verified** (SPF + DKIM) and is an **AgentPilot** domain, not `neuronforge.app`. Record the address here. Unset or NeuronForge → stop, and TL raises U-1. (QA2a-3: code does not refuse a NeuronForge value, so this gate is the guard.) | ⬜ |
| G2 (**O-2**) | Resend → Domains → that domain → Tracking. | **Click tracking OFF.** Record the open-tracking state. | ⬜ |
| G3 (O-3, information) | Vercel Production env: are `SMTP_HOST`/`SMTP_USER` and `GMAIL_USER` present? | Recorded. If SMTP is present, note QA2a-1 (a hanging SMTP host can cost the admin the link). | ⬜ |
| G4 | Pre-check (read-only, its own paste, §7.2 step 1). | `0` | ⬜ |
| G5 | Paste the whole of `supabase/migrations/20261020_business_os_invite_email.sql`. | "Success. No rows returned." | ⬜ |
| G6 | Paste `scripts/check-bos-invite-email-migration.sql` **on its own**. | `VERDICT PASS`, **8 pass 0 fail 1 info**; M03 "27 in total". | ⬜ |
| G7 | Paste the Slice 0 checker `scripts/check-bos-invites-migration.sql`. | `VERDICT PASS`, 11 pass. (The 1b checker's S02 now FAILs by design; ignore it.) | ⬜ |
| G8 | Merge the 2a PR, then confirm the Vercel deploy is live. | Deployed. | ⬜ |

**After deploy** (`<you+s2a>` = a plus-address of your own mailbox that has never had an AgentPilot account):

| # | Do | Expect | Pass? |
|---|---|---|---|
| P1 | Admin → Signup Invites → New invite. | Language pre-selected to **your** saved language (English if never set). "Send the invitation email" **ticked**. | ⬜ |
| P2 | Champion, 30 days, language **Hebrew**, a two-line note that includes `<b>test</b>`, reason "QA slice 2a". Create. | The panel says "The invitation was emailed to `<you+s2a>`" **and** still shows the link once. The row reads Pending, and the Email column reads **Sent**. | ⬜ |
| P3 | Open the email. | From: **"<your name> via AgentPilot"** at the G1 address. Hebrew, right to left. Your note has its line break, with `<b>test</b>` shown as **literal text**, not bold. The plan, the button, the plain link, the expiry date and the "not expecting this" line are all there. | ⬜ |
| P4 | Hit **Reply**. | Addressed to **your own admin email**. Discard it. | ⬜ |
| P5 | Hover over or inspect the button, and the plain link. | `https://<platform>/invite#t=…`, **not** a Resend or other tracking hostname (proves G2). | ⬜ |
| P6 | Click the button in a private window. | The valid invite page, in Hebrew. | ⬜ |
| P7 | Create a second invite for `<you+s2a2>` with the box **unticked**. | The link is shown once, the panel says nothing about an email, the row reads **Not emailed**, and **no email arrives**. | ⬜ |
| P8 | (Optional) An English and a Spanish invite to two more plus-addresses. | Left to right, the right language. **A native Hebrew and Spanish speaker reads the copy** (D-dev-2a-12). | ⬜ |
| P9 | **Leak check.** Vercel logs for the last hour: search for `<you+s2a>`, its local part, and the first 10 characters of the P2 token (from the panel link). | **No hits.** The "Email sent" line shows `to` masked (`y•••@…`). | ⬜ |
| P10 | `audit_trail` rows for the P2 invite id (read-only). | `BOS_INVITE_CREATED` and `BOS_INVITE_EMAIL_SENT`, with your admin id as actor; no email, link, token or hash (the message id is expected, N-1). | ⬜ |
| P11 | Clean up: revoke every test invite. | Revoked. | ⬜ |

#### Final Status
- [x] **All acceptance criteria pass: ready for commit (PASS WITH NOTES)**, with no bug and one Medium edge case (QA2a-1). TL and the user choose whether to fix QA2a-1 in 2a or carry it into 2b.
- [ ] Issues found — Dev must address before commit
- **Merge stays blocked on G1 (O-1), G2 (O-2) and G4–G7 (O-4)** per R-3 and the CR-1 rule.

---

## Commit Info

**Do not merge 2a until O-1 and O-2 are confirmed and recorded in this workplan (§7.1). (SA R-3)**

**Merge-order note for RM (the CR-1 rule):** apply `20261020` and get `scripts/check-bos-invite-email-migration.sql` to `VERDICT PASS` **before** the 2a PR merges; the same for `20261021` (2b, `scripts/check-bos-invite-email-window-migration.sql`) and `20261022` (2c, `scripts/check-bos-invite-email-delivery-migration.sql`). 2c additionally waits for O-5 and O-6. Rebase 2a onto `origin/main` after Slice 1c merges, and re-verify the migration numbers right before each PR opens (R-1).

**Slice 2a: user approval.** The user reviewed the 2a diff and approved the commit and PR on **2026-09-29** (relayed by TL). The approval covers committing and opening the PR only; **the merge is not approved** and stays blocked on gates G1–G8 (QA Report 2a).

| Field | Value |
|---|---|
| Branch | `feature/bos-invite-signup-slice-2a` (from `origin/main` cd8dcb43) |
| Commits | `docs:` this workplan; `feat:` the 2a code with migration `20261020`, its checker and rollback, and the existing-test edits; `test:` the new test files |
| Reviews | SA Code Review 2a approved (CR2a-1, CR2a-2 fixed); QA Report 2a PASS WITH NOTES (QA2a-1, QA2a-2 fixed) |
| Merge | **Not merged. Do not merge** until G1–G8 are recorded; no auto-merge |

*[Commit hashes and PR URL: TL records them from RM's report]*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-29 | Slice 2a approved for commit (RM) | User approved the 2a diff for commit and PR (not merge). Committed as docs/feat/test on `feature/bos-invite-signup-slice-2a`; PR opened with a do-not-merge section listing G1–G8. |
| 2026-09-29 | Created | Slice 2 workplan on `feature/bos-invite-signup-slice-2` (from `origin/main` 8cdff1cb): recommends a 2a/2b split (send on create + message id + language default; resend + cap + webhook delivery status), migrations `20261016` (7 columns, 4 CHECKs, 1 partial unique index) and `20261017` (3 columns, 2 CHECKs) with checkers, pre-checks and rollbacks; traceability to L-9, C-8, T-5/7/8/11/12, FR-14 to FR-17, AC-10; test plan; production checks with the tester's own address and Resend's test addresses; 14 findings for SA. No `console.*` in any touched file. |
| 2026-09-29 | SA workplan review | Approved with conditions. Rulings on F-1 to F-14 (reason required on resend per FR-7; invites fail closed on the sender; click tracking OFF is a pre-merge gate for 2a). R-1 to R-14, including the renumbering to `20261020`–`20261022` (`20261015` is on open PR #140), the 2b/2c re-cut, a conditional webhook write, and a column-privilege checker row. Ops list O-1 to O-6 with timing; two conditional user decisions U-1 and U-2. |
| 2026-09-29 | Slice 2a: SA and QA fixes (Dev, uncommitted) | SA CR2a-1 (the revoke-route test fixture gains the five email fields; `tsc` back to 2,087), CR2a-2 (`redactInLogs` doc: the subject is logged, the body never), nits (one `now` in the create, the page intro says "can be emailed"). QA2a-1 send timeout (D-dev-2a-15) and QA2a-2 token-prefix redaction (D-dev-2a-16). Affected suites and eslint green. |
| 2026-09-29 | Slice 2a implemented (Dev, uncommitted) | Branch `feature/bos-invite-signup-slice-2a` from `origin/main` cd8dcb43 (after 1c, #142). Migration `20261020` + rollback + checker (M07 column-ACL row, M03 INFO) + text test; `UserPreferencesRepository`; `platformSenderAddress()` (fail closed) and `redactInLogs` in the transport; invitation template (en/he/es, RTL); `inviteSender`, `inviteEmailPolicy`, `inviteEmail` (never throws, CAS write-back with `count: 'exact'` and no `.select()`, leak test); `sendEmail` required on create; email status in the list and the panel; two audit events with the admin as actor. All suites, guards, authz, entitlements, lint:hooks, eslint, tsc (touched) and `next build` green (§9.1). Deviations D-dev-2a-1..14. R-11 checked statically only (live check owed, §10.3). O-1/O-2 still open (merge gate). |
| 2026-09-29 | R-1 to R-14 folded in (text only, no code) | Renumbered to `20261020` (2a), `20261021` (2b, window), `20261022` (2c, delivered). Re-cut into 2a / 2b (resend + cap, reason required) / 2c (webhook delivery status, optional, gated on O-5/O-6). D-1a fail-closed sender (never the `neuronforge.app` default). O-1/O-2 as §7.2 step 0 and an RM do-not-merge line; ops table O-1 to O-6 with timing in §7.1. Create opens the send window, fixed-window semantics documented (R-5). Webhook write conditional on the message id; restructure a/b/c; early-event race documented (R-6). Admin as audit actor (R-8). `buildInviteLink` only and raw token in `redactInLogs` (R-9). Column-ACL checker row; total CHECK counts made INFO (R-10). R-11 schema check before the preferences repository (§10.3 placeholder). `planName` passed in so `inviteEmail.ts` imports no entitlements code; `test:bos-entitlements` reported (R-12). Full-subject warn corrected (R-13). Task-list additions (R-14). Findings table now carries SA's rulings. |
