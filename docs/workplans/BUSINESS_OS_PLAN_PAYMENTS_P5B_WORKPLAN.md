# Workplan: Business OS Plan Payments, P-5b (Champion, admin and reports see the payment)

> **Last Updated**: 2026-10-13

**Developer:** Dev
**Requirement:** [BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md): §9.1 P-5b row; F2 rows 3 and 4; §9.1.1 "P-5 scoping (2026-10-11)" (D5-4, D5-5, D5-6, G5-1, G5-3, G5-9, G5-10, N-2, N-5, **N-6**); the **SA Review — P-5 scoping (2026-10-11)**: rulings S5-4, S5-5, S5-8, P5-3 (reuse, tenant isolation, SA-P18 batching), P5-N1, **P5-N2**, conditions **P5-C3**, **P5-C8**, **P5-C9**, **P5-C10**, P5-C11; SA-P18; AC-F2.2, **AC-F2.8**, **AC-F2.10**; the P-5a.1 SA code review D-3 forward condition and **O-4** ([P-5a workplan](/docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P5A_WORKPLAN.md)).
**Invite requirement:** [BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md): FR-25 (read through SA-P5: the source is `business_os_billing_events`, not `billing_events`; G5-9), FR-31, FR-39 to FR-41 (N-1, reused), **FR-43** (N-2), §7.10 N1 to N7, §8.3 (the "inviter notified / not notified" rows), T-9, T-13.
**Depends on:** P-5a merged (P-5a.1 #314, 20261028 applied to production 2026-10-12; P-5a.2 #327).
**Date:** 2026-10-13
**Branch:** `feature/bos-plan-payments-p5b`, worktree `neuronforge-invite-s1`, fresh from `origin/main` `cc1bf66b` (#348). Confirmed with `git branch --show-current` on 2026-10-13. `origin/main` has since moved to `f302680f` (#352, P-7b.1b); main is merged in at T0 (RM's call).
**Status:** In Progress. SA approved with conditions (2026-10-13). **P-5b.1 "N-2 email"**: SA approved with fixes (F-1/F-2 applied), QA pass with notes, he/es approved by the user 2026-10-14; committed e173161c and opened as [PR #359](https://github.com/AgentsPilot/neuronforge/pull/359) (merge gate: the user's demo). P-5b.2 not started.

## Overview

P-5a lets a held friend pay and get in. P-5b makes that payment visible to the three audiences that care about it:

1. **The champion.** Their invite list shows **"Subscribed"** for a friend who has paid (FR-31), and they get **one** email, "{email} has subscribed", in their own language (N-2, FR-43). A replay, a reconciliation that re-applies the invoice, a boost and (later) a waiver send nothing.
2. **The admin.** The Signup Invites list shows, for an invited account, **paid, the date and the amount in USD**, read from the money history `business_os_billing_events` by matching the account **and** the invoice together (S5-8). A held friend shows as **"Signed up, not paid"** (FR-25, BQ-8).
3. **The reports.** The entitlement shadow report labels held accounts **"awaiting payment"** instead of listing them as `no_assignment` anomalies, and the launch dry run lists them separately, so the S-5 switch-on does not read them as broken accounts or turn them into free champions (SA-P18, T-9).

N-2 reuses N-1's notifier, template, 4 s deadline and audit events (`BOS_INVITE_INVITER_NOTIFIED` / `BOS_INVITE_INVITER_NOT_NOTIFIED` with `event: 'subscribed'`). It is sent directly from the shared apply orchestration `planPaymentApply.ts`, after the money write and the audit flush, driven only by the `out_first_payment_stamped` flag that P-5a.1 added (S5-5, P5-C3, P5-C8). There is no outbox and no cron.

**No migration is expected.** N-6 is met without one (§3.2, Q-1). If SA rules for a new operator entity type instead, one owner-policy migration is needed on the next free number (`20261059` on `origin/main` `f302680f` today).

**Production after merge:** the shadow-report label and the dry-run list are live at once (read-only, admin-only). The N-2 code, the "Subscribed" status and the admin paid fields are live but empty: nothing calls the apply function while `BUSINESS_OS_PLAN_PRICES_ENABLED` is off, and `paidInvitesAvailable` is false.

**Size: about 3 dev-days**, above the 2 to 2.5 the scoping estimated. **Split proposed** into **P-5b.1 "N-2 email"** (≈1.6d) and **P-5b.2 "Who sees the payment"** (≈1.4d), never stacked (§10).

---

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Scope](#2-scope)
3. [Implementation Approach](#3-implementation-approach)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Gates](#5-gates)
6. [Task List](#6-task-list)
7. [Tests](#7-tests)
8. [Demo Plan](#8-demo-plan)
9. [i18n and RTL](#9-i18n-and-rtl)
10. [Sizing and Split](#10-sizing-and-split)
11. [Migration Check](#11-migration-check)
12. [Risks](#12-risks)
13. [Rollout and Rollback](#13-rollout-and-rollback)
14. [Questions for SA](#14-questions-for-sa)
15. [SA Review Notes](#sa-review-notes)
16. [Implementation Notes (P-5b.1)](#implementation-notes-p-5b1)
17. [QA Testing Report](#qa-testing-report)
18. [Commit Info](#commit-info)
19. [Change History](#change-history)

---

## 1. Analysis Summary

As built on the branch (`cc1bf66b`), checked in this worktree on 2026-10-13.

| Piece | Where | What it does today | What P-5b changes |
|---|---|---|---|
| Apply orchestration | `lib/business-os/billing/planPaymentApply.ts` → `afterApply` | On `applied` / `recorded` with `firstPaymentStamped === true`: `firstPaymentSource()` reads the lineage once (**unbounded**, O-4), builds the `BOS_BILLING_FIRST_PAYMENT_STAMPED` companion entry, and `recordPlanChange` logs it with `BOS_BILLING_INVOICE_PAID` under one bounded flush (2 s). Nothing after the apply throws | The lineage read returns `{ source, inviteId }` and runs **under the N-2 deadline** (O-4). After `recordPlanChange` resolves, a new injected port `firstPaymentNotifier` is called for `source = 'account_invite'` only, behind a backstop, never throwing (§3.1) |
| Handler wiring | `lib/business-os/billing/planBillingHandler.ts` | Wires `lineage: businessOsAccountLineageRepository` | Wires the new port to the production champion notifier |
| N-1 notifier | `lib/business-os/invites/inviterNotification.ts` (`server-only`) | `notifyInviter(input, deps)`: one 4 s deadline (`INVITER_NOTIFICATION_POLICY.deadlineMs`) over lookups, template and send; never throws; writes `BOS_INVITE_INVITER_NOTIFIED` / `_NOT_NOTIFIED` through `deps.audit` **after** the deadline race; status from `landing` (`joined` / `not_subscribed_yet`); recipient is the issuer's **live** auth email, language from the recipient (N7); transport redaction (C-3) | `event: 'subscribed'` added; the status follows the event (`subscribed`). The input becomes a discriminated union so the N-1 call sites stay unchanged. Champion recipients only for `subscribed` |
| N-1 deps | `lib/business-os/invites/redemptionDeps.ts` (`inviterNotificationDeps`, inline) | Builds the transport, lookups and an audit that **queues** (`auditTrail.log`) with entity `business_os_invite`, `userId: null`, `actorId: null` (N-1 SA Q-4); the redemption route flushes | The builder is **extracted** to one shared module so the webhook and the redemption use the same wiring; the redemption keeps its queue-then-route-flush audit byte-for-byte, the webhook passes a bounded `logAndFlush` audit (§3.1 step 6) |
| Template | `lib/email/templates/invite-accepted.ts` | `InviterNotificationEvent = 'accepted'` (commented "N-2 adds `'subscribed'`"); the held status words come from `INVITE_FRIENDS_COPY[locale].status.joined` (SA Q-5: never re-translated); subject carries no address | `'subscribed'` event with its own subject, heading and lead; the status word comes from `INVITE_FRIENDS_COPY[locale].status.subscribed` (the list's word, so email and list never disagree) |
| Champion list | `lib/business-os/invites/friendInviteOps.ts`, `app/api/business-os/friend-invites/route.ts`, `components/business-os/settings/InviteFriendsSection.tsx`, `inviteFriendsCopy.ts` | `FriendInviteStatus = 'pending' \| 'expired' \| 'revoked' \| 'joined'` (G5-10). `joined` reads "Signed up — not subscribed yet". The section renders `copy.status[invite.status]` | `'subscribed'` added, derived from one issuer-scoped batched lineage read (§3.3). View keys unchanged (status only, never a date or amount) |
| Admin invites list | `lib/business-os/invites/adminInviteOps.ts` → `listInvitesForAdmin`, `app/api/admin/business-os/invites/route.ts` (GET, `requireAdmin` first), `app/admin/business-os-invites/**` (admin layout L-6, merged #315) | Batched lineage read `findByInviteIdsForAdmin` (≤200 ids, selects `account_id, invite_id, level, parent_account_id`). The row shows the accepted account, date, `L{level}` and parent. **"Signed up, not paid" is not shown anywhere today** | The lineage read also selects `source, first_paid_at, first_payment_ref`; a new batched money-history read matches account **and** invoice (S5-8); each accepted row gets a `payment` view (§3.4) rendered as a chip line under the State chip, in the L-6 standard |
| Shadow report | `lib/business-os/entitlements/report.ts` → `buildStatic` (walk of `pagePlans`, 500 per page); route `app/api/admin/business-os/entitlements/shadow-report/route.ts` | Every held friend's plan row has no basis (T-13 layer 1), so `deriveLifecycle` reports it as an `anomalies[]` entry `no_assignment` | Anomaly account ids are classified after the walk with **one batched hold read per 200 ids** and the shared `isAwaitingPayment`; held ones move to a new `awaitingPayment` section (§3.5) |
| Launch dry run | `app/api/admin/business-os/entitlements/launch/route.ts` (the walk lives in the route) | A held friend (tier NULL, cohort NULL) counts in `wouldBecomeChampion`: the launch as written would make them free champions (T-9, AB-17) | Per page, the would-become ids are classified with the same batched helper; held ones are counted and sampled separately and excluded from `wouldBecomeChampion` (§3.5) |
| Hold predicate | `lib/business-os/invites/paymentHold.ts` | `isAwaitingPayment(lineage, grantKind)` (pure) and `readPaymentHold` (one account, two reads at most). Imports nothing from the entitlements module (source guard) | **Unchanged.** A new sibling `paymentHoldBatch.ts` applies `isAwaitingPayment` to batched reads (P5-C10); never `readPaymentHold` per account |
| Lineage repository | `lib/repositories/BusinessOsAccountLineageRepository.ts` (service role, no write method by design, P5-C4) | `findByInviteIdsForAdmin`, `findHoldFactsForAccount` (selects `invite_id, source, first_paid_at`) | Two read methods added, one widened (§3.6). Still no write method |
| Money-history repository | `lib/repositories/BusinessOsBillingEventRepository.ts` (service role; a source guard holds the exact list of files allowed to name it) | `applyPlanPayment`, `recordEvent` | One admin read `findPaidInvoicesForAccounts(pairs)` (S5-8). The caller list in the guard gains `adminInviteOps.ts`'s wiring site |
| Invite repository | `lib/repositories/BusinessOsInviteRepository.ts` | `findHoldFactsById` (grant kind, language), `findByIdForAdmin` (the full row) | Two narrow reads: the N-2 facts of one invite, and grant kinds for a batch (§3.6) |
| Audit visibility | `lib/audit/ownerVisibility.ts`, owner policy `20261035` (`auth.uid() = user_id AND entity_type NOT IN (...)`) | `business_os_account_lineage` is `'owner'` (D-3); `business_os_invite` is `'owner'`. N-1 writes its entries with `user_id = NULL` | **No change proposed** (§3.2, Q-1) |

**Schema verified from migrations** (`business-os-schema-check`): `business_os_account_lineage` (20261014 + 20261024): PK `account_id`, `invite_id` UNIQUE, `source` CHECK in (`admin_invite`, `account_invite`, `organic`), `parent_account_id` (= the invite's `issuer_account_id` for a friend, set by `business_os_finalise_friend_invite_redemption`, 20261024 line 86), `first_paid_at`, `first_payment_ref` (paired CHECK). `business_os_billing_events` (20261027): `user_id` (FK `auth.users`, **ON DELETE SET NULL**), `kind`, `stripe_invoice_id`, `amount_minor` (= Stripe `amount_paid`, tax included; `planInvoiceFacts.ts:144`), `amount_tax_minor`, `currency`, `paid_at`, `livemode`; partial UNIQUE `(stripe_invoice_id) WHERE kind = 'invoice_paid'`. Highest migration on `origin/main` `f302680f`: **20261058**.

**Platform design phase.** Not V6 or plugin work; no pipeline phase is touched.

**Findings during analysis**

- **A-1.** The N-1 audit entries are written with `user_id = NULL`. The owner policy requires `auth.uid() = user_id`, and both owner readers (`listOwnerEntries`, `listOwnerEntriesForExport`) filter by `user_id`. So **no owner can read an entry with `user_id = NULL`, whatever its entity type.** N-2's entries reuse that shape and never name the lineage entity, which meets N-6's purpose without a migration (Q-1).
- **A-2.** The webhook route has no `maxDuration` and no awaited audit flush of its own. N-2 adds up to about 6.5 s after the apply in the worst case (§3.1 step 7). Stripe's endpoint timeout and the function's effective limit are confirmed at T0 (Q-2).
- **A-3.** `findHoldFactsForAccount` does not select `first_payment_ref` or `parent_account_id`. N-2 needs only `invite_id` (already selected); the admin view reads `first_payment_ref` through the widened admin method instead.
- **A-4.** The admin Signup Invites page is English-only, as is every `/admin` page, and it imports nothing from outside its folder (source guard). Its new labels are English; en/he/es applies to the champion-facing text (Q-7).
- **A-5.** A paid row whose money-history row cannot be matched is possible: the account was deleted (`user_id` SET NULL) or the ref is wrong. The view says so rather than guessing (Q-8).
- **A-6.** `BOS_INVITE_INVITER_NOT_NOTIFIED`'s registry description says "accepted invite". It is widened to cover "subscribed" (description text only).

---

## 2. Scope

| In (P-5b) | Out |
|---|---|
| N-2: one "{email} has subscribed" email to the champion, inline under N-1's 4 s deadline, exactly once from the stamp flag, friend invites only (P5-C8) | Any email to an admin about a P-9 invitee's first payment, or to a Founding Partner about their own (G5-14) |
| N-2 audit entries reusing N-1's events with `event: 'subscribed'`; every failure audited as "not notified" (AC-F2.8, S5-4) | The waiver and its "waived" label (P-13, D5-2) |
| The lineage read moved under the N-2 deadline (O-4) | Perks for either side (FR-38) |
| "Subscribed" in the champion's list, status only (FR-31, P5-C9) | Reminders or deletion of unpaid friends (BQ-8) |
| The admin paid line: paid, date, amount in USD, test-mode marker; "Signed up, not paid" for a held account (FR-25, S5-8, P5-C9) | A "Paid" KPI tile or a payment filter on the admin page (possible follow-up, not asked for) |
| The shadow report's `awaitingPayment` section; the launch dry run's separate list (SA-P18, T-9, P5-C10) | The launch execution's automatic exclusion (T-9 "exclude automatically" belongs to the execution slice, which is not built; the dry run is) |
| en/he/es for the email and the "Subscribed" label; he/es drafts for the user | Retrying a lost N-2 send (D5-6: not retried) |
| Source guards: one caller of the champion notifier; boost never reaches it | Turning any switch on anywhere shared |

---

## 3. Implementation Approach

### 3.1 N-2 in the apply orchestration (S5-5 a to d, P5-C3, P5-C8, O-4)

**The port** (on `PlanPaymentDeps`, `planPaymentApply.ts`):

```typescript
export interface FirstPaymentNotifier {
  /** The whole budget for the lineage read plus the notification (N-1's 4 s). */
  readonly deadlineMs: number;
  /** Never rejects by contract; the caller still guards it. */
  notifyChampion(input: {
    accountId: string;           // resolved from OUR billing record (SR-8)
    inviteId: string | null;     // from the lineage row of that account; null when unread
    lineageRead: 'ok' | 'failed' | 'timed_out' | 'no_row' | 'no_port';
    remainingMs: number;         // what is left of deadlineMs after the lineage read
    livemode: boolean;
    stripeEventId: string;
  }): Promise<void>;
}

export interface PlanPaymentDeps {
  // …existing ports…
  lineage?: Pick<BusinessOsAccountLineageRepository, 'findHoldFactsForAccount'>;
  firstPaymentNotifier?: FirstPaymentNotifier; // Q-4: optional + alert when missing, or required
}
```

**The flow in `afterApply`, `applied` / `recorded` only, and only when `result.firstPaymentStamped === true`:**

1. **Start the N-2 clock** (`deadlineMs`, 4 s, read from the port so `planPaymentApply.ts` imports nothing from `lib/business-os/invites/`).
2. **One lineage read, bounded (O-4).** `readStampLineage(deps, accountId, log, deadlineMs)` replaces `firstPaymentSource`: the same primary-key read (`findHoldFactsForAccount`), raced against the clock, returning `{ source, inviteId, outcome }`. It never throws. A missing port, a failed read, a missing row, a throw or a timeout all give `source: null`, `inviteId: null`, a warn, and the stamp entry is **still written** (W-5 unchanged).
3. **The stamp entry and `BOS_BILLING_INVOICE_PAID`**, as today, under the one bounded flush (P5-C7 unchanged). This is "after the money write and the audit flush" (S5-5).
4. **Decide whether N-2 applies.** `source === 'account_invite'` → notify. `source` is `admin_invite` or `organic` → no N-2, an `info` log, **no audit** (nothing was expected). `source === null` (unread) → the notifier is still called with `lineageRead` set, so the failure is **audited as not notified** (AC-F2.8) rather than silently skipped.
5. **Call the port behind a backstop** (`notifyFirstPaymentSafely`, the same shape as `notifyInviterSafely` in `inviteRedemption.ts`): `remainingMs = deadlineMs − lineage elapsed`; a backstop at `remainingMs + 500 ms` plus the audit budget abandons a hung notifier; a rejection is caught and logged by error class only. **Nothing here throws** (S5-5 b), so a stamped payment is never released for a Stripe retry that would answer `already_applied` and lose the email.
6. **The notifier writes its own audit** through a bounded `logAndFlush` (2 s), after its deadline race, as N-1's `deps.audit` runs after the race. This is the one extra serial flush, unavoidable because S5-5 orders the send after the first flush (Q-3).
7. **Time budget, worst case after the apply commits:** lineage read plus N-2 ≤ 4 s (one clock; the stamp flush between them is not counted against it), stamp flush ≤ 2 s, N-2 audit flush ≤ 2 s, backstop slack 0.5 s: **≤ 8.5 s**, against today's ≤ 2 s. The typical case is one primary-key read, one invite read, four parallel lookups and one Resend call: well under 1.5 s. T0 confirms the webhook's effective `maxDuration` and Stripe's endpoint timeout (Q-2). **Where the figure shows (C-4 as amended by SA F-1):** P-3b's `bos_billing_invoice_applied` line is written immediately after the commit, before this chain starts, with its existing fields and no timing; the chain is wrapped in a `try/finally` whose `finally` writes a separate `info` line, `bos_billing_invoice_post_commit`, with `status`, the ids and `postCommitMs`. A function cut off mid-chain therefore still leaves the commit-time line.

**Exactly once.** Driven only by `firstPaymentStamped === true`, which comes from the same transaction that inserted the paid invoice under its partial UNIQUE (S5-3). `already_applied`, `already_recorded`, `subscription_conflict`, refusals, `plan_row_missing` and `billing_row_missing` never reach step 4. A future reconciler (P-8b) that goes through `applyPaidPlanInvoice`'s orchestration inherits this: the first application notifies, a re-application does not (S5-5 a). A send lost to a crash after the apply is not retried (D5-6).

**What never sends N-2.** A boost never calls the apply function (P5-C4 guard). A waiver (P-13) writes no `first_paid_at`, so no flag. A $0 invoice stamps nothing (S5-3). A guard pins that the champion notifier has exactly one caller, `planBillingHandler.ts`'s wiring, and that no file under `lib/business-os/boost/` names it.

### 3.2 The champion notifier and its audit (S5-5 c, d; N-6)

**File:** `lib/business-os/invites/championSubscribedNotification.ts` (`import 'server-only'`; imports nothing from the entitlements module).

`createFirstPaymentNotifier(deps)` returns the port. `notifyChampion(input)`:

1. If `input.inviteId` is null (lineage unread or no row): audit **not notified**, reason `recipient_lookup_failed` (`lineageRead` in details), entity `business_os_invite` with `entityId: null`. Return.
2. **One invite read by id, bounded by `remainingMs`:** `findInviterNotificationFactsById(inviteId)` → `{ issuer_kind, issuer_account_id, email, redeemed_account_id }`.
3. **Cross-checks (`tenant-isolation-guard` step 2):** `issuer_kind === 'account'`, `issuer_account_id` present, and **`redeemed_account_id === input.accountId`** (the invite named by this account's lineage was redeemed by this account). A mismatch is not notified with reason `invite_mismatch` (new reason class, Q-5) and logged at `error` with `alert: true`, ids only: it means the lineage and the invite disagree. A failed read is `recipient_lookup_failed`.
4. **`notifyInviter({ event: 'subscribed', inviteId, issuerKind: 'account', issuerAccountId, issuerAdminId: null, inviteeEmail: email }, { ...sharedDeps, deadlineMs: remainingAfterInviteRead })`.** From here everything is N-1's: the champion's live auth email (never the `inviter_reply_to` snapshot), the champion's language (business profile, then preference, then English; N7, FR-41), the platform sender with no Reply-To, `redactRecipientInLogs: true` and `redactInLogs: [inviteeEmail]` (S5-5 d, FR-40), fail closed when `RESEND_FROM_EMAIL` is not configured, and one audit entry per outcome.
5. Never throws: every step is guarded, and a throw becomes not notified, `transport_failed`.

**The champion is found only through our own records** (S5-5 c): the account comes from our billing row (SR-8); its lineage row gives the invite id; the invite row gives `issuer_account_id`. Stripe metadata is never read.

**The audit entries and N-6.** N-2 writes exactly N-1's shape, through the shared deps builder:

| Field | Value |
|---|---|
| `action` | `BOS_INVITE_INVITER_NOTIFIED` or `BOS_INVITE_INVITER_NOT_NOTIFIED` (registered, `bos`, `info`; S5-4) |
| `entityType` / `entityId` | `business_os_invite` / the invite id (null only in step 1) |
| `userId` / `actorId` | `null` / `null` on the audit input (N-1 SA Q-4: a system event). **Stored** `user_id` (SA C-2 correction): NULL, or the platform account when `SYSTEM_ADMIN_USER_ID` is set (`AuditTrailService.buildLogEntry`), never the friend or the champion |
| `details` | `event: 'subscribed'`, `recipientKind: 'champion'`, `recipientAccountId` (the champion), `status: 'subscribed'`, `outcome`, `language`, `reason`, plus `accountId` (the friend), `stripeEventId`, `livemode`; **never an email address** |

**Why this meets N-6 without a migration (Q-1).** N-6 forbids putting the "not notified" outcome on `business_os_account_lineage`, because that type is owner-visible and the entry would land in the friend's own audit view. N-2's entries are not on that type, and their `user_id` is NULL (or the platform account when `SYSTEM_ADMIN_USER_ID` is set; never the friend or the champion, SA C-2), so the owner policy (`auth.uid() = user_id AND …`) and both owner readers (which filter on `user_id`) can never return them, to the friend or to the champion. They are visible to admins only, exactly as N-1's. If SA prefers the letter of N-6 (an operator-only entity type), the fallback is a new type `business_os_invite_notification` classified `'operator'`, plus an owner-policy migration on the next free number (20261059 today) that re-issues `ALTER POLICY` with the type added to the `NOT IN` list, plus the `ownerVisibility` test update (≈ +0.4d, §11).

**The shared deps builder.** `lib/business-os/invites/inviterNotificationDeps.ts` (`server-only`) exports `buildInviterNotificationDeps({ logger, correlationId, request?, audit })`, holding the service-role lookups that `redemptionDeps.ts` builds inline today (with their tenant-isolation comment moved verbatim). `redemptionDeps.ts` calls it with its existing queueing audit, so its behaviour, and its tests, are unchanged. The webhook wiring passes `audit = (entry) => logAndFlush(toAuditInput(entry), logger, { … })`.

**Template.** `invite-accepted.ts`: `InviterNotificationEvent = 'accepted' | 'subscribed'`; `InviteAcceptedStatus` gains `'subscribed'`. The copy table gains a `subscribed` block per locale (subject, heading, lead), with no "held" note. The status word comes from `INVITE_FRIENDS_COPY[locale].status.subscribed`. The subject still names no address. **`inviterNotification.ts`:** `NotifyInviterInput` becomes `{ event: 'accepted'; landing } | { event: 'subscribed' }` (common fields shared); `statusFor` keys on the event first. `subscribed` with `issuerKind: 'admin'` is refused at the type level (champion only, FR-43).

### 3.3 "Subscribed" in the champion's list (FR-31, P5-C9, G5-10, D5-5)

- **Repository:** `BusinessOsAccountLineageRepository.findSubscribedInviteIdsForIssuer(issuerAccountId, inviteIds)`: `SELECT invite_id … WHERE parent_account_id = $issuer AND source = 'account_invite' AND invite_id IN (…) AND first_paid_at IS NOT NULL`. Refuses more than `LINEAGE_LOOKUP_LIMIT` (200) ids, which equals the champion list cap (`BUSINESS_OS_FRIEND_INVITE_LIST_LIMIT` = 200), so one query per list. It returns invite ids only: never a date, an amount or an account id.
- **Scoping, twice:** the invite ids come from `listForIssuerAccount(sessionAccountId)` (issuer-scoped, existing), and the lineage read is itself filtered by `parent_account_id = sessionAccountId`, so a wrong id cannot reveal another champion's friend. The session account comes from `getUser()` → `resolveAccountId` in the route, as today.
- **Ops:** `getFriendInviteSummary` gains the port `lineage: Pick<…, 'findSubscribedInviteIdsForIssuer'>`. It reads only for accepted rows (`redeemed_at` set). `friendInviteStatus(row, now, subscribed)` returns `'subscribed'` when the derived state is `accepted` and the id is in the set. A failed read does not fail the list: those rows stay `joined` ("Signed up — not subscribed yet", the less-claiming word) and a warn is logged.
- **D5-5:** a waived friend (P-13) has no `first_paid_at`, so they stay `joined` with no code here.
- **UI:** `InviteFriendsStatus` and `FriendInviteStatus` gain `'subscribed'`; `copy.status.subscribed` in en/he/es. `InviteFriendsSection` renders `copy.status[invite.status]` already; no layout change. `FRIEND_INVITE_VIEW_KEYS` unchanged.

### 3.4 The admin paid line (FR-25, S5-8, P5-C9)

- **Lineage, widened:** `findByInviteIdsForAdmin` also selects `source, first_paid_at, first_payment_ref` (the type `BusinessOsAccountLineageLevel` gains three fields). Still one batched read per 200 accepted invites.
- **Money history, new:** `BusinessOsBillingEventRepository.findPaidInvoicesForAccounts(pairs: Array<{ accountId; invoiceId }>)`, at most 200 pairs: `SELECT user_id, stripe_invoice_id, amount_minor, amount_tax_minor, currency, paid_at, livemode FROM business_os_billing_events WHERE kind = 'invoice_paid' AND stripe_invoice_id IN (…) AND user_id IN (…)`, then **kept only where the row's `(user_id, stripe_invoice_id)` equals a requested pair** (S5-8: account and invoice matched together, so a reused or wrong ref cannot show another account's payment). The partial UNIQUE makes it at most one row per invoice. Invoice ids are shape-checked (`in_…`) and account ids checked as UUIDs before the query. **Service role, documented in the method:** an admin cross-account read; the only caller is `listInvitesForAdmin`, behind `requireAdmin` as the first statement of `GET /api/admin/business-os/invites` (unchanged). The repository's caller-list guard gains the admin route wiring.
- **Ops:** `listInvitesForAdmin` gains the port `billingEvents?: Pick<…, 'findPaidInvoicesForAccounts'>`. For each accepted row it builds:

```typescript
type InvitePaymentView =
  | { state: 'awaiting_payment' }                                   // isAwaitingPayment(lineage, row.grant_kind)
  | { state: 'paid'; paidAt: string; amountMinor: number; currency: 'usd'; livemode: boolean }
  | { state: 'paid_record_missing' }                                // stamped, no matching money row (A-5)
  | { state: 'unknown' };                                           // a read failed
// absent: not a paid-invite account (an L1 champion, an organic account) — nothing to show.
```

  "Awaiting payment" uses `isAwaitingPayment(lineageFacts, row.grant_kind)` from `paymentHold.ts`: the same predicate as the gate, with the grant kind already on the invite row, so no extra read and no copy (P5-C10's spirit). The date and amount come **only** from the money-history row; nothing is copied onto lineage (AC-F2.2). A failed money-history read gives `unknown` with a warn, never "not paid".
- **Screen:** `types.ts` gains `payment?: InvitePaymentView` (absent from an older server: nothing shown). `InviteList.tsx`, under the State chip, in the L-6 standard: `StatusChip` `ok` "Paid" + `{day(paidAt)} · $79.00 USD` (formatted in the folder with `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })` from minor units), and a `neutral` "Test payment" chip when `livemode` is false (P5-N1); `warn` "Signed up, not paid"; `warn` "Paid, record not found"; `neutral` "Payment unknown". The amount is the amount paid, tax included, labelled "paid" (not "price"). English only (A-4).
- **P-13 forward note:** the view is a union so P-13 adds `{ state: 'waived' }` without reshaping it (S5-9: views show waived as different from paid).

### 3.5 Shadow report and launch dry run (SA-P18, T-9, P5-C10)

**Shared helper.** `lib/business-os/invites/paymentHoldBatch.ts` (imports nothing from the entitlements module, like `paymentHold.ts`):

```typescript
export async function readAwaitingPaymentAccounts(
  accountIds: readonly string[],
  readers: {
    lineage: Pick<BusinessOsAccountLineageRepository, 'findHoldFactsForAccountsForAdmin'>;
    invites: Pick<BusinessOsInviteRepository, 'findGrantKindsByIdsForAdmin'>;
  }
): Promise<{ ok: true; held: ReadonlySet<string> } | { ok: false }>;
```

It reads lineage in batches of 200 (`account_id, invite_id, source, first_paid_at`), then, only for unpaid `admin_invite` rows, the invites' grant kinds in batches of 200, and applies `isAwaitingPayment` per row. Any failed batch → `{ ok: false }` (the caller decides what a failure means; it never reads as "nobody is held"). Never `readPaymentHold` per account.

**Shadow report** (`report.ts`, inside the entitlements module): after the walk, the account ids in `anomalies` are classified once. A held account's anomaly is **removed from `anomalies`** and listed in a new section:

```typescript
awaitingPayment: {
  scanFailed: boolean;      // read this first, as tenantsWithoutPlanRow (SA S0-1)
  count: number | null;     // null when scanFailed
  accountIds: string[];     // ids only (RC-16), capped at 200 with `truncated`
  truncated: boolean;
}
```

On a failed read, `scanFailed: true`, `count: null`, and **the anomalies stay as they were**: a failed read never hides an anomaly. The injected readers are optional on `ShadowReportOptions` and default to the repository singletons, like `planRepository` today. RC-16 holds: ids and counts only.

**Launch dry run** (route): per page, the would-become-champion ids are classified with the same helper. Held ones are excluded from `wouldBecomeChampion` and reported as `awaitingPayment` (count) and `awaitingPaymentSample` (≤ 20 ids). A failed classification sets `holdScanFailed: true` and leaves those rows counted in `wouldBecomeChampion`, with an `error` log: the count stays an upper bound, never an understatement. The dry run's audit details gain `awaitingPayment` and `holdScanFailed`. The real run stays 501 (Slice 2), so T-9's automatic exclusion is a note for that slice (§2).

### 3.6 Repository methods (rule 7: what is new, and why)

| Method | Kind | Why it is needed | Scoping |
|---|---|---|---|
| `BusinessOsBillingEventRepository.findPaidInvoicesForAccounts` | new | S5-8, the one SA named | account and invoice matched together; admin only |
| `BusinessOsAccountLineageRepository.findByInviteIdsForAdmin` | widened (+3 columns) | the admin row needs `source`, `first_paid_at`, `first_payment_ref` | unchanged (admin only, invite ids from the admin list) |
| `BusinessOsAccountLineageRepository.findSubscribedInviteIdsForIssuer` | new | the champion's "Subscribed" (P5-C9) | `parent_account_id` = session account, plus issuer-scoped invite ids |
| `BusinessOsAccountLineageRepository.findHoldFactsForAccountsForAdmin` | new | the batched hold read (P5-C10) | admin only (report, dry run) |
| `BusinessOsInviteRepository.findInviterNotificationFactsById` | new | N-2's champion, typed address and redeemer (S5-5 c) | the invite id from the lineage of the account our billing row resolved; cross-checked against `redeemed_account_id` |
| `BusinessOsInviteRepository.findGrantKindsByIdsForAdmin` | new | `isAwaitingPayment` for unpaid admin invitees in batch | admin only |

All are reads. No write method is added anywhere; the P5-C4 guard keeps the lineage repository write-free. `firstPaymentStamp.guard.test.ts`'s allow-list of files that may **name** `first_paid_at` / `first_payment_ref` gains exactly the files that read them here (the lineage repository already; `adminInviteOps.ts` and `paymentHoldBatch.ts` through types), still never next to `.update(` / `.upsert(` / `.insert(`. The SA's scoping said "one repository method (S5-8)"; the extra reads are what the champion, N-2 and P5-C10 need (Q-6). The alternative for N-2 is to reuse `findByIdForAdmin`, which selects the whole invite row (token hash included) for a webhook that needs four fields; the narrow read is preferred.

### 3.7 Entitlements registration (P5-C11, `business-os-entitlements`)

| File | Imports from `lib/business-os/entitlements/` | Change |
|---|---|---|
| `lib/business-os/billing/planPaymentApply.ts` | unchanged symbols | none |
| `lib/business-os/billing/planBillingHandler.ts` | unchanged | imports the new notifier from `lib/business-os/invites/`, not from the module |
| `lib/business-os/invites/championSubscribedNotification.ts`, `inviterNotificationDeps.ts`, `paymentHoldBatch.ts` | **none** (pinned by a source guard, like `inviterNotification.ts` and `paymentHold.ts`) | new files |
| `lib/business-os/invites/friendInviteOps.ts`, `adminInviteOps.ts` | unchanged symbols | none |
| `app/api/admin/business-os/entitlements/launch/route.ts` | `getEntitlementConfig` (registered) | unchanged symbols |
| `lib/business-os/entitlements/report.ts` | inside the module | imports `paymentHoldBatch.ts` (outside the module; no registration) |

No new importer is expected. `npm run test:bos-entitlements` runs at T0 (baseline) and before each hand-over, and its result is recorded here.

### 3.8 Tenant isolation (`tenant-isolation-guard`)

| Path | Who supplies the id | Guard |
|---|---|---|
| N-2 | billing row (SR-8) → its lineage `invite_id` → invite `issuer_account_id` | `redeemed_account_id` must equal the account; `issuer_kind` must be `account`; Stripe metadata never read |
| Champion "Subscribed" | session (`getUser()` → `resolveAccountId`) | invite ids from the issuer-scoped list; lineage filtered by `parent_account_id` = session account; status only |
| Admin paid line | admin list rows | `requireAdmin` first; money rows kept only where account and invoice both match |
| Report / dry run | the plan walk | `requireAdmin` first; ids and counts only |

No service-role write is added. The only writes are audit entries.

### 3.9 Logging and audit

Pino via `createLogger` only; ids and reason classes, never an address (C-3). New log events: `bos_billing_first_payment_lineage_unread` (replaces `bos_billing_first_payment_source_unread`, same fields plus `outcome`), `bos_invite_subscribed_not_applicable` (info, a non-friend first payment), `bos_invite_subscribed_invite_mismatch` (error, `alert: true`), `bos_invite_subscribed_notifier_abandoned` (warn), `bos_invite_subscribed_notifier_unwired` (error, `alert: true`, only if Q-4 keeps the port optional), `bos_invite_list_subscribed_unread` (warn), `bos_invite_admin_payment_unread` (warn), report and dry-run `hold_scan_failed` (error). No `console.*` in any touched file (checked at T0; flagged per CLAUDE.md if one is found).

---

## 4. Files to Create / Modify

| File | Action | Reason | Part |
|---|---|---|---|
| `lib/email/templates/invite-accepted.ts` (+ test) | modify | `subscribed` event, status, copy en/he/es | .1 |
| `components/business-os/settings/inviteFriendsCopy.ts` | modify | `status.subscribed` en/he/es (the list's word, reused by the email) | .1 |
| `lib/business-os/invites/inviterNotification.ts` (+ test) | modify | discriminated input, `statusFor` by event | .1 |
| `lib/business-os/invites/inviteEmailPolicy.ts` | modify | reason class `invite_mismatch` (Q-5) | .1 |
| `lib/business-os/invites/inviterNotificationDeps.ts` (+ test) | create | shared deps builder | .1 |
| `lib/business-os/invites/redemptionDeps.ts` | modify | use the shared builder; behaviour unchanged | .1 |
| `lib/business-os/invites/championSubscribedNotification.ts` (+ test) | create | the port's production implementation (§3.2) | .1 |
| `lib/repositories/BusinessOsInviteRepository.ts` (+ test) | modify | `findInviterNotificationFactsById` (.1); `findGrantKindsByIdsForAdmin` (.2) | .1 / .2 |
| `lib/repositories/types.ts` | modify | the new row types; lineage admin type widened | .1 / .2 |
| `lib/business-os/billing/planPaymentApply.ts` | modify | `readStampLineage` under the clock, the port, the safe call | .1 |
| `lib/business-os/billing/planBillingHandler.ts` | modify | wire the notifier | .1 |
| `lib/business-os/billing/__tests__/planPaymentApply.firstPayment.test.ts`, new `planPaymentApply.n2.test.ts` | modify / create | exactly once, never throws, budget | .1 |
| `lib/audit/events.ts` | modify | `BOS_INVITE_INVITER_*` descriptions widened (A-6) | .1 |
| `lib/business-os/billing/__tests__/firstPaymentStamp.guard.test.ts` | modify | one caller of the notifier; boost never names it; allow-list additions | .1 / .2 |
| `lib/repositories/BusinessOsAccountLineageRepository.ts` (+ test) | modify | three reads (§3.6); header lists the new callers | .2 |
| `lib/repositories/BusinessOsBillingEventRepository.ts` (+ test, caller guard) | modify | `findPaidInvoicesForAccounts` | .2 |
| `lib/business-os/invites/friendInviteOps.ts`, `friendInviteDeps.ts` (+ tests) | modify | `subscribed` status and its read | .2 |
| `components/business-os/settings/__tests__/InviteFriendsSection.render.test.tsx` | modify | `subscribed` × en/he/es | .2 |
| `lib/business-os/invites/adminInviteOps.ts` (+ test), `app/api/admin/business-os/invites/route.ts` | modify | payment view, wiring | .2 |
| `app/admin/business-os-invites/types.ts`, `components/InviteList.tsx` (+ render test) | modify | the paid line in the L-6 standard | .2 |
| `lib/business-os/invites/paymentHoldBatch.ts` (+ test) | create | batched hold classification (P5-C10) | .2 |
| `lib/business-os/entitlements/report.ts` (+ tests) | modify | `awaitingPayment` section | .2 |
| `app/api/admin/business-os/entitlements/launch/route.ts` (+ `__tests__/routes.test.ts`) | modify | separate list in the dry run | .2 |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | §9.1 P-5b status at each stage, Change History | both |
| `docs/requirements/BUSINESS_OS_INVITE_SIGNUP_REQUIREMENT.md` | modify | §0 status rows for 5c / N-2 when merged (as the invite doc's practice) | both |

---

## 5. Gates

| # | Gate | When |
|---|---|---|
| G-1 | SA approves this workplan (and rules on the split) | Before T1 |
| G-2 | T0 time-budget check recorded: the webhook's effective `maxDuration` on Vercel and Stripe's endpoint timeout leave room for §3.1 step 7 (Q-2) | Day 1 |
| G-3 | The user approves the he/es wording (email and "Subscribed") | Before P-5b.1 merges |
| G-4 | `npm run test:bos-entitlements` green and recorded (P5-C11) | Before each SA code review |
| G-5 | Demo run (§8), or the user waives it. N-2's demo sends a real email to an address the user controls (P5-N2) | Before each merge |
| G-6 | Only if SA picks the N-6 migration fallback: the owner-policy migration applied to production with its checker before the PR that writes the new entity type merges | Before that PR merges |

---

## 6. Task List

Estimates in dev-days. The split column assumes SA accepts §10.

- [x] ✅ **T0 (0.15d) Day-1 checks.** *(P-5b.1 done 2026-10-13; the main merge was skipped, see Implementation Notes (P-5b.1) I-1)* Merge `origin/main` (RM). `git ls-tree origin/main supabase/migrations/` (no migration expected; record the highest number). G-2: the webhook route's effective `maxDuration` and Stripe's endpoint timeout. `test:bos-entitlements` baseline. `console.*` scan of the touched files. *(.1, repeated briefly at .2's start)*
- [x] ✅ **T1 (0.25d) Template and copy.** `subscribed` event and status, copy en/he/es (drafts), `INVITE_FRIENDS_COPY.status.subscribed`; template tests (subject without address, RTL, escaping, the list's word reused). *(.1)*
- [x] ✅ **T2 (0.3d) Notifier input and shared deps.** Discriminated `NotifyInviterInput`; `statusFor` by event; reason `invite_mismatch`; extract `buildInviterNotificationDeps`; `redemptionDeps.ts` on it with its suites **unedited and green**. *(.1)*
- [x] ✅ **T3 (0.35d) Champion notifier.** `findInviterNotificationFactsById` (+ repository test), `championSubscribedNotification.ts` (§3.2 steps 1 to 5), bounded `logAndFlush` audit, tests for every branch. *(.1)*
- [x] ✅ **T4 (0.35d) Apply orchestration.** `readStampLineage` under the clock (O-4), the port, `notifyFirstPaymentSafely` with the backstop, handler wiring; the never-throw and exactly-once tests; existing `planPaymentApply` suites green (the stamp entry's fields unchanged). *(.1)*
- [ ] **T5 (0.25d) Champion "Subscribed".** `findSubscribedInviteIdsForIssuer`, `friendInviteOps` status and port, route wiring, render test × en/he/es. *(.2)*
- [ ] **T6 (0.4d) Admin paid line.** Lineage admin read widened, `findPaidInvoicesForAccounts` (+ caller guard), payment view in `listInvitesForAdmin`, `types.ts`, `InviteList.tsx` chips, render and ops tests, the page's source guard green. *(.2)*
- [ ] **T7 (0.35d) Reports.** `findHoldFactsForAccountsForAdmin`, `findGrantKindsByIdsForAdmin`, `paymentHoldBatch.ts`, report `awaitingPayment`, dry-run separate list, tests (incl. RC-16 shape test and failure paths). *(.2)*
- [ ] **T8 (0.15d) Guards and registration.** *(.1 share ✅ 2026-10-13: notifier single-caller, apply-caller and boost guards; `findInviterNotificationFactsById` caller guard; C-8 added next to `paymentHold.ts`; `test:bos-entitlements` green. .2 share open)* Notifier single-caller and boost guards; first-payment allow-list; `KNOWN_NON_GATE_IMPORTERS` checked (expected unchanged); `test:bos-entitlements`. *(both)*
- [ ] **T9 (0.1d) Full checks.** *(.1 share ✅ 2026-10-13, results in Implementation Notes (P-5b.1). .2 share open)* Jest scope of every touched area, `npx tsc --noEmit` over the touched files, `npm run lint`, `npm run lint:hooks`, `git diff --stat` for any deletion without insertion. *(both)*
- [ ] **T10 (0.25d) Demo** (§8). *(.1: D5 to D8 owed, needs the user; checklist in Implementation Notes (P-5b.1) I-9)* Needs the user: a fresh held test friend, the standard sandbox, the champion's real inbox. *(both)*
- [ ] **T11 (0.1d) Docs.** *(.1 share ✅ 2026-10-13: requirement P-5b row and Change History, this workplan. Invite requirement §0 rows at merge)* Requirement §9.1 P-5b status lines and Change History at each stage; invite requirement §0 rows at merge; this workplan's records. *(both)*

**Total ≈ 3.0d** (P-5b.1 ≈ 1.6d: T0, T1 to T4, and its shares of T8 to T11; P-5b.2 ≈ 1.4d: T5 to T7 and its shares).

---

## 7. Tests

| Area | Test | Pins |
|---|---|---|
| Exactly once | `planPaymentApply.n2.test.ts` | Stamped friend → notifier called once with the lineage `inviteId`. Not stamped, `already_applied`, `already_recorded`, `subscription_conflict`, every refusal, `plan_row_missing`, `billing_row_missing` → **never called**. The same `invoice.paid` twice through the handler → one call. `admin_invite` / `organic` → not called, no audit |
| Never throws (S5-5 b) | same | The notifier rejecting, hanging past the backstop, throwing synchronously; the lineage read throwing, erroring, timing out; `recordPlanChange` rejecting → `applyPaidPlanInvoice` resolves, **no `PlanPaymentRetryError`**, the stamp entry still written (W-5) |
| Order (S5-5) | same | The notifier runs after `recordPlanChange` resolved (call order recorded) |
| Budget (O-4) | same, fake timers | The lineage read and the notifier share one 4 s clock; `remainingMs` = 4000 − lineage elapsed; the stamp flush is not counted; the backstop abandons at its bound |
| Champion notifier | `championSubscribedNotification.test.ts` | No invite id → not notified `recipient_lookup_failed`, entity id null. Read failed / timed out → not notified. `issuer_kind = 'admin'`, a missing issuer, `redeemed_account_id` ≠ account → not notified `invite_mismatch` + alert log. Happy path → `notifyInviter` with `event: 'subscribed'`, the champion id from the invite row, `deadlineMs` = remaining. Audit fields: N-1 shape, `userId` and `actorId` null, `event: 'subscribed'`, `accountId`, no email anywhere (a scan of every logged and audited value for `@`) |
| N-1 regression | existing `inviterNotification` and redemption suites | **Unedited** and green: N-1's accepted email, statuses and audits unchanged |
| Template | `invite-accepted` test | `subscribed` × en/he/es: subject carries no address; `dir="rtl"` for he; the address escaped and `dir="ltr"`; the status word equals `INVITE_FRIENDS_COPY[l].status.subscribed`; no held note |
| Champion list | ops, route and render tests | `subscribed` only for accepted rows in the set; lineage read failure → `joined` + warn, list still answers; the read is never called with another issuer's id; view keys unchanged; label × en/he/es |
| Lineage reads | repository tests | `findSubscribedInviteIdsForIssuer` filters `parent_account_id`, `source`, `first_paid_at IS NOT NULL`, refuses > 200; `findHoldFactsForAccountsForAdmin` refuses > 200; no write call anywhere (P5-C4 guard) |
| Money read | repository test | Refuses > 200 pairs and bad shapes before any query; a row whose `user_id` does not match its pair is dropped (the S5-8 mutation test: swap two accounts' refs → neither shows a payment); `kind = 'invoice_paid'` only |
| Admin view | ops and render tests | `awaiting_payment` from `isAwaitingPayment` (friend; admin tier invite; admin champion invite → absent); `paid` with date, `$79.00 USD`, "Test payment" when `livemode` false; `paid_record_missing`; `unknown` on a failed read; an older server's row without `payment` renders as before. Page source guard green |
| Batch helper | `paymentHoldBatch.test.ts` | Same answers as `readPaymentHold` over a table of cases (friend unpaid, friend paid, admin tier unpaid, admin champion, organic, no row); batches of 200; invite read only for unpaid `admin_invite`; any failed batch → `{ ok: false }` |
| Shadow report | report tests | Held anomaly moved to `awaitingPayment`; other anomalies untouched; a failed read → `scanFailed: true`, `count: null`, anomalies unchanged; RC-16 shape (ids and counts only) |
| Dry run | routes test | Held excluded from `wouldBecomeChampion`, counted and sampled; failed read → `holdScanFailed`, counts unchanged; audit details |
| Guards | `firstPaymentStamp.guard.test.ts` + a new notifier guard | The notifier is constructed only in `planBillingHandler.ts`; no file under `lib/business-os/boost/` names `championSubscribedNotification`, `firstPaymentNotifier` or `notifyChampion`; the new invite modules import nothing from the entitlements module |
| Entitlements | `npm run test:bos-entitlements` | No new importer (or each registered with exact symbols) |

---

## 8. Demo Plan

**Prerequisites (N-5 as updated 2026-10-12, N-4, P5-N1, P5-N2).**

- The standard sandbox **`acct_1UPKR4C7KDUGYIcA`** for local demos; its webhook does not forward to production, so no production endpoint pause. Events reach localhost with `stripe listen --events <the documented list> --forward-to localhost:3000/api/stripe/webhook` and its `whsec_` in `STRIPE_WEBHOOK_SECRET`.
- Locally only, **never committed**: `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=true`, `BUSINESS_OS_PLAN_PRICES_ENABLED=true`, `paidInvitesAvailable: true` in the working tree (S5-7).
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` set locally, or N-2 is audited `sender_not_configured` (which is itself a valid failure-path demo).
- **A test champion whose sign-in address the user controls** (N-2 sends a real email to it). Set the champion's language to **Hebrew** so the email is seen right to left.
- **A fresh held test friend**: a new friend invite from that champion, accepted, so the account sits on "Finish your payment". (The P-5a friend has already paid and cannot show the transition.)
- Local and production share one database, so the money row, the stamp and the audit rows are real rows in it, written in test mode.

**P-5b.2 steps (no payment needed, run first):**

| Step | Action | Expected |
|---|---|---|
| D1 | Champion: Settings → Invite friends | The friend reads "Signed up — not subscribed yet" (Hebrew) |
| D2 | Admin: `/admin/business-os-invites` | The friend's row: Accepted, L2, **"Signed up, not paid"** |
| D3 | Admin: shadow report (`GET …/shadow-report`) | The friend's account id under `awaitingPayment`, not in `anomalies` |
| D4 | Admin: launch dry run (`POST …/launch` with `dryRun: true`) | `awaitingPayment` counts the friend; `wouldBecomeChampion` does not |

**P-5b.1 steps (and the end state for .2):**

| Step | Action | Expected |
|---|---|---|
| D5 | Friend pays with `4242 4242 4242 4242` | Processing, then onboarding (P-5a) |
| D6 | The champion's inbox | **One** email, Hebrew, right to left: subject without the address, "{email}" and the status "Subscribed" in Hebrew, button to the invite list |
| D7 | Read-only SQL (user) | One `BOS_INVITE_INVITER_NOTIFIED` with `details.event = 'subscribed'`, `user_id` NULL **or the platform account** (when `SYSTEM_ADMIN_USER_ID` is set; never the friend or the champion, SA C-2), entity `business_os_invite` / the invite id, `details.accountId` = the friend, `details.recipientAccountId` = the champion; one `BOS_BILLING_FIRST_PAYMENT_STAMPED`; one `BOS_BILLING_INVOICE_PAID` |
| D8 | Resend `invoice.paid` from the sandbox dashboard | `already_applied`; **no second email**; no new audit rows |
| D9 | Champion list (needs .2) | "Subscribed" (Hebrew) |
| D10 | Admin list (needs .2) | **Paid** · date · **$79.00 USD** · "Test payment" |
| D11 | Shadow report and dry run again (needs .2) | The friend is gone from `awaitingPayment` (paid) |
| D12 | Cleanup, the same day | Cancel the test subscription in the sandbox (N-4); revert the local switch flips; the friend may then go through the Danger Zone cleanup (refused while the subscription is live, PF-14) |

If P-5b.2 merges first, D1 to D4 are its demo and D9 to D11 are shown with P-5b.1's demo.

---

## 9. i18n and RTL

Champion-facing text only; the admin page and the report stay English, like every `/admin` page (A-4, Q-7). **The he and es lines below are drafts for the user (G-3).** Hebrew avoids gendered verbs about the friend, as the N-1 copy does.

| Key | en | he (draft) | es (draft) |
|---|---|---|---|
| List status `subscribed` | Subscribed | נרשם למנוי | Suscrito |
| Email subject | Your invitation turned into a subscription | ההזמנה שלך הפכה למנוי | Tu invitación se convirtió en una suscripción |
| Email heading | Your friend subscribed | יש מנוי חדש מההזמנה שלך | Nueva suscripción desde tu invitación |
| Email lead | `{email}` has subscribed. | התשלום עבור `{email}` הושלם והמנוי פעיל. | `{email}` se suscribió. |
| Status row value | the list's `subscribed` word | same | same |
| Button, footer | N-1's existing champion button and footer | same | same |

The en lead is FR-43's wording. The list's `subscribed` word in Hebrew keeps the list's existing generic form ("נרשם — עדיין ללא מנוי" for `joined`). The address is wrapped in `dir="ltr"` inside the Hebrew sentence, as N-1 does.

---

## 10. Sizing and Split

≈ **3.0 dev-days** (§6), above the 2 to 2.5 the scoping estimated. The difference is N-2's plumbing (the shared deps builder, the champion notifier with its cross-checks, the moved lineage read) and the report and dry-run work, which reach more files than the scoping assumed.

**Proposed split, never stacked:**

| PR | Scope | Size | Gates | Demo |
|---|---|---|---|---|
| **P-5b.1 "N-2 email"** | T0 to T4, its shares of T8 to T11 | ≈1.6d | G-2, G-3 (he/es), G-4, G-5 | D5 to D8: a real email, once, and nothing on a replay |
| **P-5b.2 "Who sees the payment"** | T5 to T7, its shares | ≈1.4d | G-4, G-5 | D1 to D4 (live at once), then D9 to D11 |

Reasons: the two halves have different review surfaces (the webhook's money path and its time budget against read-only views and reports); the only he/es gate falls on P-5b.1; P-5b.2 needs no payment for most of its demo and is useful in production at once (the report label). The coupling is one type: `InviteFriendsStatus` gains `'subscribed'` in P-5b.1 (the email reuses the list's word) and P-5b.2 starts emitting it. Either can merge first; P-5b.1 first is proposed so the demo's payment shows both.

---

## 11. Migration Check

**None expected.** P-5b adds no table, column, grant or function, so the test-account cleanup chain (`20261047`) is untouched (N-2). Every read uses existing columns and existing `service_role` SELECT grants (20261014 lineage; 20261027 money history; the invite table's existing grants).

**Only if SA rules the N-6 fallback (Q-1, option B):** one migration on the **next free number at Dev time** (`20261059` on `origin/main` `f302680f`; re-checked at T0 and before the PR), which `ALTER POLICY "Users can view their own audit logs"` with the new operator type added to the `NOT IN` list, sorted as `OWNER_HIDDEN_ENTITY_TYPES`, plus a checker with a VERDICT line and a rollback, all in the user's SQL paste rules (no `--`, no punctuation in strings, never the word "into" in a string); `ownerVisibility.ts`, `AUDIT_ENTITY_TYPES` and `ownerVisibility.test.ts` updated; G-6 applies.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R-1 | The webhook runs longer (up to ≈8.5 s in the worst case) and hits a function or Stripe timeout, so Stripe retries an already-applied invoice | G-2 checks both limits on day 1; a retry answers `already_applied`, writes nothing and sends nothing, so the only loss is the late email (D5-6). Typical case ≈1.5 s |
| R-2 | A second email on a concurrent or replayed delivery | Driven only by the flag from the transaction holding the partial UNIQUE (S5-3); D8 and the exactly-once tests |
| R-3 | The champion's address leaks to a log or audit | N-1's redaction settings reused; the test scans every logged and audited value for an address |
| R-4 | The extracted deps builder changes N-1's behaviour | N-1 suites run unedited; the builder is a move, the audit callback stays the caller's |
| R-5 | A wrong or reused `first_payment_ref` shows another account's payment to admins | Account and invoice matched together (S5-8), with a mutation test |
| R-6 | A failed hold read hides an anomaly or understates the dry run | Failures are explicit (`scanFailed`, `holdScanFailed`); anomalies and counts stay as they were |
| R-7 | Test-mode payments on the shared database look like real ones in the admin view (P5-N1) | "Test payment" chip from the money row's `livemode` |
| R-8 | A held friend who paid between P-5a and P-5b's deploy never gets N-2 | Production has every switch off, so none exist; accepted per D5-6 |
| R-9 | The he/es wording is not approved | G-3 before P-5b.1 merges |
| R-10 | The branch is behind `origin/main` (now `f302680f`) | T0 merge |

---

## 13. Rollout and Rollback

**Rollout.** No switch. In production after merge: the shadow-report `awaitingPayment` section and the dry-run list are live at once, for friends already held (read-only, admin-only). N-2, "Subscribed" and the admin paid line are live code with nothing to show, because nothing calls the apply function while `BUSINESS_OS_PLAN_PRICES_ENABLED` is off and `paidInvitesAvailable` is false. They start working at §9.5 rows 15 and 17 (the latter only after P-9).

**Rollback.** Revert the PR. Nothing persisted depends on the code: audit rows already written stay, and no schema changed. (Under the Q-1 fallback, the policy migration's rollback restores the previous `NOT IN` list.)

---

## 14. Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| Q-1 | **N-6.** Is reusing N-1's audit shape (entity `business_os_invite`, `user_id` NULL, never the lineage type) enough, given that no owner reader can return a NULL-`user_id` row? | **Yes, option A, no migration** (§3.2, A-1). Option B (new `'operator'` type `business_os_invite_notification` + owner-policy migration on 20261059, ≈ +0.4d) if SA wants N-6's letter |
| Q-2 | The time budget: one 4 s clock over the lineage read and N-2, excluding the stamp flush; one extra bounded flush for N-2's audit; worst case ≈8.5 s after the apply | Accept, with the G-2 day-1 check of the webhook's effective `maxDuration` and Stripe's timeout. If the limit is tight, set `maxDuration` on the webhook route (a one-line change SA would rule on) |
| Q-3 | N-2's audit needs its own bounded flush, since S5-5 puts the send after the first flush (P5-C7's "no second serial flush" was about the stamp entry) | `logAndFlush` in the webhook's `audit` callback, after the deadline race, as N-1's audit runs after its race |
| Q-4 | `firstPaymentNotifier` optional or required on `PlanPaymentDeps` | **Optional** (existing test deps stay unedited), with an `error` + `alert: true` log when a stamped friend payment finds it unwired, so a future reconciler that forgets it is seen. Required is the stricter alternative (compile-time), at the cost of editing every test that builds the deps |
| Q-5 | New reason class `invite_mismatch` for "the lineage invite was not redeemed by this account / is not a friend invite" | Accept, alerted; reason classes are not user-facing |
| Q-6 | Six repository reads (five new, one widened) against the scoping's "one repository method (S5-8)" | Each is a narrow purpose read (§3.6); the alternative for N-2, reusing `findByIdForAdmin`, reads the whole invite row in the webhook |
| Q-7 | G5-3 lists "admin labels" for en/he/es; the admin console is English-only | Admin labels and report keys stay English; en/he/es for the champion's status and the email |
| Q-8 | A stamped account whose money row cannot be matched (account deleted, `user_id` SET NULL; or a bad ref) | Show "Paid, record not found" with no date or amount, warn-logged; never fall back to the lineage date (AC-F2.2: from the money history only) |
| Q-9 | Shadow report: held anomalies **removed** from `anomalies` into `awaitingPayment` (SA-P18 "instead of"), or kept in both with a label | Removed, with `scanFailed` keeping them in place when the read fails |
| Q-10 | The dry run on a failed hold read | Keep them in `wouldBecomeChampion` (upper bound) and set `holdScanFailed: true` |
| Q-11 | The split (§10) | Two PRs, P-5b.1 then P-5b.2, never stacked |
| Q-12 | The "Test payment" chip for `livemode = false` on the admin line (P5-N1) | Accept |

---

## SA Review Notes

**Reviewed by SA — 2026-10-13**
**Status:** ✅ APPROVED WITH CONDITIONS (C-1 to C-12 below; none needs a re-review of the plan, all are checked at code review)

### What SA verified (not taken from the workplan)

| Claim | Checked against | Result |
|---|---|---|
| Live owner policy hides `user_id IS NULL` rows | `20261035_audit_trail_owner_policy_hides_queue_items.sql`: `USING (auth.uid() = user_id AND (entity_type IS NULL OR entity_type NOT IN (…)))` | `NULL = uuid` is NULL, so the predicate is never true: **no signed-in owner can read a NULL-`user_id` row, whatever its entity type** |
| No other SELECT policy reaches those rows | `create_audit_trail.sql` also defines "Admins can view all audit logs" (keyed on user-writable `raw_user_meta_data`) | Recorded **not live** (LLM audit workplan M-6, resolved); the live set is the owner policy plus `service_role_bypass_rls`. Nothing else reads them with a user session |
| Both owner readers filter on the caller | `AuditTrailRepository.listOwnerEntries` (l.278) and `listOwnerEntriesForExport` (l.425): `.eq('user_id', userId)` with `userId` = the authenticated caller (`/api/audit/query`, `/api/user/data-export`) | Confirmed; the other `user_id`-scoped methods are admin-only or the boost finding check |
| Admin views tolerate NULL `user_id` | `app/api/admin/audit-trail/route.ts` (`filter(Boolean)` on ids, `users`/`business` null when absent); `admin/users/[id]/audit-logs` filters by a chosen account | No break: N-1 already writes this shape in production. The per-account admin views simply do not list N-2 entries (see C-2) |
| What `userId: null` actually writes | `AuditTrailService.buildLogEntry`: `user_id = input.userId \|\| SYSTEM_ADMIN_USER_ID \|\| null` | **Correction to §3.2 and D7:** the row's `user_id` is NULL **or the platform account** when `SYSTEM_ADMIN_USER_ID` is set. Either way it is never the friend or the champion, so N-6's purpose holds (C-2) |
| Webhook duration config | `app/api/stripe/webhook/route.ts`: `runtime = 'nodejs'`, **no `maxDuration`**; `vercel.json` has no `functions` block | The effective limit is the plan/compute default, which the repo does not pin (Q-2, C-3) |
| Pre-apply work is already unbounded | `planPaymentApply.ts`: `listInvoiceLinesAll`, up to two `retrieveBusinessOsSubscription`, catalog load, billing-row lookups before `applyPlanPayment` | The 8.5 s is on top of that, so Stripe's timeout can already be crossed today in a degraded state (Q-2) |
| Highest migration | `git ls-tree origin/main` at `f302680f` | `20261058`; no migration needed (Q-1) |
| Gates | `launch/route.ts:53`, `shadow-report/route.ts:58`, `invites/route.ts` | `requireAdmin` first statement in all three; unchanged by the plan |
| Repository caller guards | `BusinessOsBillingAccountRepository.test.ts:731` ALLOWED list; the money-history repository's own caller guard; `firstPaymentStamp.guard.test.ts` | Exist; the new callers go into them in a reviewable diff (C-7) |
| Entitlements direction | `report.ts` imports repositories already; `paymentHold.ts` imports nothing from the module (guarded) | `report.ts` → `invites/paymentHoldBatch.ts` is an import **out of** the module, no registration, provided the batch helper never imports back (C-8) |

### Rulings on Q-1 to Q-12

| # | Ruling |
|---|---|
| **Q-1** | **Option A accepted, no migration.** N-6 exists to keep the "not notified" outcome out of an owner's audit view; the binding text offered "an operator-only entity type" as the means because the P-5a.1 entries carry the owner's `user_id`. N-2's entries never use `business_os_account_lineage` and are written with `userId: null`, which the live policy and both owner readers can never return to the friend or the champion. That meets N-6. Option B would add an owner-policy migration and a production apply gate to hide rows no owner can reach: disproportionate. **Binding:** the invariant is "N-2 entries are written with `userId: null` and `actorId: null` and never on the lineage entity", pinned by test (C-2). The requirement's N-6 row is annotated with this ruling (SA, 2026-10-13). **P-13 is not covered by this ruling:** the waiver has an admin actor and must still be decided on its own workplan |
| **Q-2** | **Accepted with a cap and a pinned limit (C-3, C-4).** Exactly-once does not depend on Stripe's timeout: a Stripe retry (after its timeout, or a manual resend) re-enters `applyPlanPayment`, gets `already_applied` from the transaction that holds the partial UNIQUE, and never reaches the notifier, including when it arrives while the first invocation is still inside N-2. Stripe timing out does not stop our function, so the only cost of a slow delivery is a "failed" mark and a no-op retry. The real risk is the **function limit**, which could cut the chain between the commit and the audit flush; that limit is not pinned in the repo today. So: (a) the webhook route sets `export const maxDuration = 60` with a one-line comment naming P-5b's post-commit budget (precedent: three admin routes); (b) the post-commit chain stays as designed, ≤ 8.5 s, every leg bounded; no ordering change (S5-5's order is the reason the stamp entry is durable before the email). G-2 still records Stripe's documented endpoint timeout and whether the project runs on fluid compute, for the record, but neither is a gate any more |
| **Q-3** | **Accepted.** The second bounded flush is N-2's own entry, after its own race, exactly as N-1's audit runs after its race. P5-C7's "no second serial flush" governed the stamp entry and stays met (the stamp and `INVOICE_PAID` still share one flush) |
| **Q-4** | **Optional, with the alert log, plus a source guard (C-5).** Consistent with `lineage?` from P-5a.1 and keeps the existing test deps unedited. The guard closes the gap that "optional" opens: every non-test file that calls `applyPaidPlanInvoice(` must also name `firstPaymentNotifier` in its deps, so the future P-8b reconciler cannot forget it silently (S5-5 a) |
| **Q-5** | **Accepted.** `invite_mismatch` added to `INVITER_NOT_NOTIFIED_REASONS`, logged at `error` with `alert: true`, ids only. It covers: `issuer_kind ≠ 'account'`, missing `issuer_account_id`, and `redeemed_account_id ≠ accountId` |
| **Q-6** | **Accepted, six reads (five new, one widened).** "One repository method" in the scoping counted the S5-8 money read only; the others are narrow purpose reads that P5-C9, P5-C10 and S5-5 c each require, and every one is a read. The narrow N-2 invite read is preferred over `findByIdForAdmin` (which selects the token hash into a webhook). Every new method carries its caller list in the repository header and in a guard (C-7) |
| **Q-7** | **Accepted.** Admin labels and report keys English, like every `/admin` page; en/he/es for the champion's status word and the email. G5-3's "admin labels" is read as the champion-facing labels |
| **Q-8** | **Accepted.** "Paid, record not found", no date or amount, a warn with ids only; never the lineage date (AC-F2.2) |
| **Q-9** | **Accepted: removed** from `anomalies` into `awaitingPayment`, and left in place when the scan fails. `byState` and `accountsScanned` are not changed by the move, so the report's totals still reconcile (C-9) |
| **Q-10** | **Accepted.** On a failed hold read the held rows stay in `wouldBecomeChampion` (an upper bound, never an understatement) with `holdScanFailed: true` and an `error` log |
| **Q-11** | **Split accepted:** two PRs, never stacked (below) |
| **Q-12** | **Accepted.** "Test payment" chip from the money row's `livemode = false` (P5-N1) |

### Coverage of the binding conditions

| Condition | Where in the plan | Test that pins it | Verdict |
|---|---|---|---|
| P5-C3 (stamp-driven, in `planPaymentApply.ts`, never throws) | §3.1 | `planPaymentApply.n2.test.ts` "Exactly once", "Never throws" | ✅ |
| P5-C8 (inline, 4 s, friend only, template + audit, en/he/es) | §3.1, §3.2, §9 | n2 test, `championSubscribedNotification.test.ts`, template test × 3 locales | ✅ with C-1 |
| P5-C9 (account + invoice matched; champion status only) | §3.3, §3.4 | money-read mutation test (swapped refs → neither shows); view-keys-unchanged test | ✅ |
| P5-C10 (`isAwaitingPayment` on batched reads) | §3.5 | `paymentHoldBatch.test.ts` parity table against `readPaymentHold` | ✅ with C-8 |
| S5-4 (N-1 events with `event: 'subscribed'`) | §3.2 table | notifier test "Audit fields" | ✅ with C-2 |
| S5-5 a–d (shared orchestration; no throw; `account_invite` only, champion from our records; typed address, champion language, redaction) | §3.1, §3.2 | n2 + notifier tests, the `@` scan | ✅ with C-5 |
| O-4 (lineage read inside the bound) | §3.1 step 2 | n2 "Budget" with fake timers | ✅ |
| D-3 / N-6 | §3.2 | C-2 | ✅ (Q-1) |
| `requireAdmin` first; repositories only; Pino; no `console.*` | §3.8, §3.9, T0 | existing admin-gate CI guard; T0 scan | ✅ |

### Conditions (checked at code review)

1. **C-1 (Hebrew/Spanish, G-3).** Whichever PR merges first carries the `subscribed` status type and its en/he/es word; G-3 (the user's approval of he/es) applies to that PR. The email's status row must read the list's word, never a second translation (template test).
2. **C-2 (N-6 invariant, Q-1).** A test pins that every N-2 audit input has `userId: null`, `actorId: null`, `entityType: 'business_os_invite'`, and that no N-2 path names `business_os_account_lineage`. Fix §3.2's table and the D7 demo step: the stored `user_id` is NULL, or the platform account when `SYSTEM_ADMIN_USER_ID` is set; never the friend or the champion. `details` carry `accountId` and `recipientAccountId` so an admin can find the entry from either account (the per-account admin views filter on `user_id` and will not list it; that is accepted, as for N-1).
3. **C-3 (function limit, Q-2).** `export const maxDuration = 60` on `app/api/stripe/webhook/route.ts`, with a one-line why. If the router placement guard pins the route's exports, update it in the same diff.
4. **C-4 (budget and replay tests, Q-2).** With fake timers and every leg hanging (lineage read, invite read, Resend, both flushes), `applyPaidPlanInvoice` resolves within the documented bound (≤ 8.5 s after the commit) and throws nothing. A second delivery of the same `invoice.paid` that arrives **while the first invocation's notifier is still pending** resolves `already_applied` and does not call the notifier (one call in total). Add `postCommitMs` to the existing apply log line so production shows the real figure.
5. **C-5 (Q-4).** Extend `firstPaymentStamp.guard.test.ts`: every non-test file that calls `applyPaidPlanInvoice(` names `firstPaymentNotifier`; the notifier is constructed only in `planBillingHandler.ts`; nothing under `lib/business-os/boost/` names it. Non-vacuity check included (the handler is found).
6. **C-6 (unread lineage).** When the lineage read fails, the "not notified" entry is written with `details.lineageRead` and must read as "may have been owed", not as a confirmed friend: the reason stays `recipient_lookup_failed` and the log says the source is unknown. No email is attempted without an invite id.
7. **C-7 (caller guards).** Each new repository method is added to its repository's header caller list and to the existing guards: the money-history read's only caller is the admin invites wiring (behind `requireAdmin`); `findHoldFactsForAccountsForAdmin` and `findGrantKindsByIdsForAdmin` only from `paymentHoldBatch.ts`, whose only callers are `report.ts` and the launch route; `findInviterNotificationFactsById` only from `championSubscribedNotification.ts`; `findSubscribedInviteIdsForIssuer` only from `friendInviteOps.ts`'s wiring. Service-role use commented in each method.
8. **C-8 (no cycle).** `paymentHoldBatch.ts`, `championSubscribedNotification.ts` and `inviterNotificationDeps.ts` import nothing from `lib/business-os/entitlements/` (added to the existing source guard next to `paymentHold.ts`), so `report.ts` importing the batch helper cannot form a cycle. `npm run test:bos-entitlements` result recorded per G-4; `KNOWN_NON_GATE_IMPORTERS` expected unchanged.
9. **C-9 (report reconciliation).** The move from `anomalies` to `awaitingPayment` leaves `byState` and `accountsScanned` untouched; a test asserts the totals still add up. The existing report suites (`report.test.ts`, `dormantChampions.test.ts`, `planActive.noEffect.test.ts`, `shadow.test.ts`) must **never reach the real singletons**: either they inject the new readers, or the default path is unreachable in them. A test run that touches the network is a fail.
10. **C-10 (deps extraction is a move).** `redemptionDeps.ts`'s suites run **unedited** and green; the builder's tenant-isolation comment moves verbatim; the audit callback stays the caller's (queue in the redemption, bounded `logAndFlush` in the webhook).
11. **C-11 (admin money read).** Pairs come only from lineage rows on the page (`account_id`, `first_payment_ref`); ids shape-checked before the query; the kept-only-where-both-match filter is in the repository, not the caller, so no other caller can skip it.
12. **C-12 (`git diff --stat`).** Before each hand-over, check for any file with deletions and no insertions (the truncation hazard), and record it.

### Split decision (Q-11)

**Two PRs, never stacked, both from `origin/main`:**

| PR | Scope | Size |
|---|---|---|
| **P-5b.1 "N-2 email"** | T0 to T4 + shares of T8 to T11; includes C-2 to C-6, C-10 | ≈1.6d |
| **P-5b.2 "Who sees the payment"** | T5 to T7 + shares; includes C-7 (its methods), C-8, C-9, C-11 | ≈1.4d |

Either order is acceptable; .1 first is the default because its demo payment then shows both halves. If G-3 is still waiting on the user, .2 may go first, and then it carries the `subscribed` type and word and G-3 moves with it (C-1). Branch the second PR from `origin/main` after the first merges.

### Observations (non-blocking)

- O-1. When `SYSTEM_ADMIN_USER_ID` names a real person's account that is also a Business OS owner, that account's own audit view lists N-1 and N-2 entries (ids only, no addresses). Existing N-1 behaviour; not changed here. Worth a line in the follow-ups if the platform account is ever a person.
- O-2. The pre-apply Stripe calls in `planPaymentApply.ts` use the SDK's default request timeout. Not in P-5b's scope; a candidate for P-8 hardening.
- O-3. The he draft "נרשם למנוי" keeps the list's existing generic form; the user decides at G-3 (no SA position on wording).

### Approval
[x] Workplan approved with conditions C-1 to C-12. Proceed to implementation of P-5b.1 (or P-5b.2 under C-1). No business question for the user beyond G-3 (he/es wording) and the demo prerequisites in §8.

## Implementation Notes (P-5b.1)

**Dev, 2026-10-13.** P-5b.1 "N-2 email" (T0 to T4 plus its shares of T8 to T11, and, per C-1, the shared `'subscribed'` status type and its word in en/he/es). Branch `feature/bos-plan-payments-p5b` in worktree `neuronforge-invite-s1`, on `cc1bf66b`, **uncommitted** (RM commits after SA code review, QA and the user's approval). P-5b.2 (T5 to T7) not started.

### I-1. T0 (day-1 checks)

| Check | Result |
|---|---|
| Branch | `git branch --show-current` → `feature/bos-plan-payments-p5b` |
| Merge `origin/main` | **Skipped, recorded for RM.** `origin/main` is at `f302680f` (#352) and changes `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md`, which holds this cycle's uncommitted SA edits, so `git merge` would refuse; stashing is not allowed in this repo. RM merges at commit time. Overlap checked: of the files P-5b.1 touches, only the requirement and two repository caller allow-lists (`BusinessOsBillingAccountRepository.test.ts`, `BusinessOsBillingEventRepository.test.ts`) are also changed on main; main's hunks there (P-7b.1b's `planUpgrade.captured.test.ts` entries) sit two lines away from P-5b.1's, so a clean merge is expected. No P-5b.1 source file is touched by main |
| Migrations | None added. Highest on `origin/main` `f302680f`: `20261058` |
| G-2 | Not a gate any more (SA Q-2). `maxDuration = 60` pinned on the webhook route (C-3). Stripe's endpoint timeout and fluid compute were not looked up from here (no Stripe or Vercel calls in this session); left for the demo session |
| `test:bos-entitlements` baseline | 252 suites, 7 341 tests, green |
| `console.*` scan | 0 in every touched source file (and in `app/api/stripe/webhook/route.ts`) |

### I-2. What was built

| Area | Files | Notes |
|---|---|---|
| Shared status and word (C-1) | `components/business-os/settings/inviteFriendsCopy.ts`, `lib/business-os/invites/friendInviteOps.ts` | `'subscribed'` added to `InviteFriendsStatus` and `FriendInviteStatus`; `status.subscribed` in en/he/es (I-6). Nothing emits it yet (P-5b.2) |
| Template (T1) | `lib/email/templates/invite-accepted.ts` | `event: 'subscribed'` with its own subject, heading and lead; status `subscribed` reads `INVITE_FRIENDS_COPY[l].status.subscribed`; no held note; button and footer shared |
| Notifier input (T2) | `lib/business-os/invites/inviterNotification.ts`, `inviteEmailPolicy.ts` | `NotifyInviterInput` is a union: `accepted` (either issuer, with `landing`) or `subscribed` (`issuerKind: 'account'` only, so an admin recipient does not type-check). `statusFor` keys on the event. `deadlineMs` comment widened (N-2 uses it). Reason `invite_mismatch` added |
| Shared deps builder (T2, C-10) | new `lib/business-os/invites/inviterNotificationDeps.ts`; `redemptionDeps.ts` | A move of the inline N-1 lookups. The audit callback and logger stay the caller's (redemption: queue, then the route flushes, unchanged). Redemption suites ran **unedited** and green |
| N-2 invite read (T3, C-7) | `BusinessOsInviteRepository.findInviterNotificationFactsById`, type `BusinessOsInviteNotificationFacts` | Four columns; service-role use and its one caller documented in the method and in the header (item 7) |
| Champion notifier (T3) | new `lib/business-os/invites/championSubscribedNotification.ts` | `createFirstPaymentNotifier(deps)` and the production audit writer `writeChampionNotificationAudit` (bounded `logAndFlush`, Q-3). Steps as §3.2; every entry on `business_os_invite`, `userId: null`, `actorId: null` (C-2); details carry N-1's keys plus `accountId`, `stripeEventId`, `livemode`, `lineageRead` (and `inviteRead` when the invite read failed) |
| Apply orchestration (T4) | `lib/business-os/billing/planPaymentApply.ts` | Port `FirstPaymentNotifier` / `FirstPaymentNotifyInput` (optional on the deps, Q-4). `readStampLineage` replaces `firstPaymentSource`: the same one read, now raced against N-2's clock (O-4), returning `source`, `inviteId`, `outcome`, `elapsedMs`. The post-commit work moved into `afterCommit`; N-2 runs after `recordPlanChange` through `notifyFirstPayment` (backstop = remaining + 2 s + 0.5 s; never throws). `bos_billing_invoice_applied` stays at the commit with P-3b's fields; `postCommitMs` is on a new `info` line `bos_billing_invoice_post_commit` (`status`, ids, `postCommitMs`), written in the `finally` around `afterCommit` (C-4 as amended, SA F-1) |
| Wiring (T4, C-5) | `lib/business-os/billing/planBillingHandler.ts` | The only `createFirstPaymentNotifier(` call; only the one invite read is handed over |
| Function limit (C-3) | `app/api/stripe/webhook/route.ts` | `export const maxDuration = 60;` with its reason. The placement guard pins repository imports only, not route exports; it gained the invite repository for the handler (I-3) |
| Audit registry (A-6) | `lib/audit/events.ts` | Both `BOS_INVITE_INVITER_*` descriptions widened to cover "subscribed"; the comment notes the N-6 shape |
| Lineage header | `lib/repositories/BusinessOsAccountLineageRepository.ts` | Comment only: the existing read's `invite_id` now also feeds N-2. No method change |

### I-3. Guards (T8 share)

| Guard | Change |
|---|---|
| `firstPaymentStamp.guard.test.ts` | New block (C-5, C-7): every non-test caller of `applyPaidPlanInvoice(` names `firstPaymentNotifier` (non-vacuity: the handler is found); `createFirstPaymentNotifier(` is called only in `planBillingHandler.ts`; the notifier module is imported only there; `findInviterNotificationFactsById` is named only by the repository, the notifier and the handler, and called only by the latter two; no boost file names the notifier, the port, `notifyChampion` or the N-2 read. The existing guards (stamp columns, lineage table, `planPaymentApply` naming the lineage table only as the stamp entity type) are unchanged and green |
| `routerPlacement.guard.test.ts` | `planBillingHandler.ts` may import `BusinessOsInviteRepository` too (P-5b.1 comment) |
| `authAccountRepository.callers.guard.test.ts` | `inviterNotificationDeps.ts` and its test added (the lookups moved there) |
| `BusinessOsBillingEventRepository.test.ts`, `BusinessOsBillingAccountRepository.test.ts` | Caller allow-lists gain `planPaymentApply.n2.test.ts` (it imports the repositories' TYPES for its fakes, as the first-payment test does) |
| `paymentHold.test.ts` | C-8: `championSubscribedNotification.ts` and `inviterNotificationDeps.ts` added to "imports nothing from the entitlements module" |
| `BusinessOsInviteRepository.test.ts` | Method list, a method test (four columns, no address logged, service-role doc), and the row-leak check gain `findInviterNotificationFactsById` |
| Entitlements registration | No new importer: the two new modules import nothing from the module; `planBillingHandler.ts` and `planPaymentApply.ts` import the same symbols as before. `KNOWN_NON_GATE_IMPORTERS` unchanged |

### I-4. Tests

| Suite | Tests | Pins |
|---|---|---|
| new `lib/business-os/billing/__tests__/planPaymentApply.n2.test.ts` | 32 | Exactly once (stamped applied/recorded → one call with the lineage invite id; flag false, `already_*`, conflict, `plan_row_missing`, `billing_row_missing`, a refusal → never; through the handler twice → once). **C-4 mid-send replay**: a second delivery arriving while the first is inside the send gets `already_applied`; one notifier call, one email, one N-2 entry. `admin_invite` / `organic` → no call, no audit. **C-6**: unread lineage (no port, error, no row, throw) → notifier with `inviteId: null`, "not notified" `recipient_lookup_failed`, no email, stamp entry still written. Unwired notifier → `error` + `alert`. Order: record start/end, then notify; the N-2 entry flushed separately after the first flush, never through the default sink. Never throws: rejecting, sync-throwing, hung notifier abandoned at 6.5 s, `recordPlanChange` rejecting. **O-4**: a 1.5 s lineage read leaves 2.5 s, a hung stamp flush is not counted; a hung lineage read times out at the clock; the port's own deadline is used. **C-4 every leg hanging** (lineage + both flushes; invite read + both flushes; Resend + both flushes) → resolves, `postCommitMs` ≤ 8 500 and equal to the `bos_billing_invoice_post_commit` line's value (F-1). `postCommitMs` is present on that line when not stamped. F-1 (+2 tests, 34 in total): the applied line exactly once, P-3b's fields, before `record:start`; and still written when the chain never settles. The real `recordPlanChange`, bounded flush, N-2 notifier and N-1 template run |
| new `lib/business-os/invites/__tests__/championSubscribedNotification.test.ts` | 32 | Happy path (one email to the champion's live address, Hebrew, the list word, no Reply-To, redaction; the exact NOTIFIED entry). C-6 per lineage outcome. Invite read error / throw / hang (bounded) / no time left. Q-5 mismatches (admin invite, no issuer, redeemed by another, not redeemed, no row) → `invite_mismatch` + `alert`. Send failed / no sender / hung (resolves at what is left of the clock) / wiring throws / audit writer rejects. **C-2** on every path (`entityType: 'business_os_invite'`, `userId` and `actorId` null, never the lineage entity). No `@` in any log line or audit entry. Source guards (no entitlements import, no lineage entity name) |
| new `lib/business-os/invites/__tests__/inviterNotificationDeps.test.ts` | 4 | Lookups keyed by the given id; the caller's audit and logger handed back unwrapped; RLS-bypass comment; no entitlements import |
| `lib/email/templates/__tests__/invite-accepted.test.ts` | +11 | `subscribed` × en/he/es: no address in the subject, the list word exactly (C-1), RTL with the address LTR, FR-43 English, Spanish, escaping, no held note |
| Existing N-1, redemption, first-payment and apply suites | unedited | Green: `inviterNotification.test.ts`, `redemptionDeps.test.ts`, `inviteRedemption.test.ts`, `app/api/public/invites/**`, `planPaymentApply.firstPayment.test.ts`, `planPaymentApply.test.ts`, `planBillingHandler.test.ts` |

### I-5. Checks (T9 share)

| Command | Result |
|---|---|
| `npx jest lib/business-os/billing lib/business-os/invites app/api/stripe app/api/business-os/friend-invites app/api/business-os/billing app/api/public/invites app/api/admin/business-os/invites lib/audit lib/repositories/__tests__ lib/business-os/entitlements lib/email components/business-os/settings --ci` | **252 suites, 6 532 tests, all passed** |
| `npm run test:bos-entitlements` (G-4) | **252 suites, 7 346 tests, all passed** (baseline 7 341; the +5 are the invite repository's new tests) |
| `npm run typecheck:bos-llm` | **passed**, 516 files in scope, 0 new errors. It also reports one baseline entry as fixed (`app/api/onboarding/build/route.ts` TS18047), unrelated to this work and left alone |
| `tsc --noEmit -p tsconfig.json` (12 GB heap; the default heap runs out of memory) | 1 917 errors repo-wide, all pre-existing; **0 in any touched or new file** |
| `eslint` on every touched file | 0 errors; 8 warnings, all on pre-existing lines (`route.ts`, `events.ts`, `types.ts`) |
| `npm run lint:hooks` | passed |
| `git diff --stat` (C-12) | 22 tracked files, 659 insertions, 143 deletions; **no file with deletions and no insertions**. The `planPaymentApply.ts` deletions are the post-commit block moved into `afterCommit` and `firstPaymentSource` replaced by `readStampLineage`. 6 new files (2 source, 3 tests, this workplan) |

### I-6. he/es drafts for the user (G-3), verbatim

| Key | en | he (DRAFT) | es (DRAFT) |
|---|---|---|---|
| List status `subscribed` (also the email's status row) | Subscribed | נרשם למנוי | Suscrito |
| Email subject | Your invitation turned into a subscription | ההזמנה שלך הפכה למנוי | Tu invitación se convirtió en una suscripción |
| Email heading | Your friend subscribed | יש מנוי חדש מההזמנה שלך | Nueva suscripción desde tu invitación |
| Email lead | `{email}` has subscribed. | התשלום עבור `{email}` הושלם והמנוי פעיל. | `{email}` se suscribió. |

The button ("See your invitations" / "להזמנות שלך" / "Ver tus invitaciones"), the labels and the footer are N-1's, already approved. The he/es lines are marked DRAFT in `invite-accepted.ts`. G-3 must close before P-5b.1 merges.

### I-7. Deviations for SA

| # | What | Why |
|---|---|---|
| DV-1 | The lineage warn keeps P-5a.1's event name `bos_billing_first_payment_source_unread` (with `outcome` added, and a new reason `read_timed_out`) instead of the new `bos_billing_first_payment_lineage_unread` (§3.9) | The P-5a.1 suite pins the name and had to run unedited; dashboards keep working |
| DV-2 | `FirstPaymentNotifyInput` carries the delivery's `log` | The notifier is built once at module load in the handler, so it has no per-event logger otherwise; this keeps the correlation and Stripe event ids on every N-2 line |
| DV-3 | `bos_billing_invoice_applied` is now written when the post-commit chain settles (in a `finally`), not right after the commit | C-4 asks for `postCommitMs` on that line. It is still always written. If SA prefers the commit-time line kept, the alternative is a second line `bos_billing_invoice_post_commit`. **Not accepted by SA; resolved by F-1 (I-10)** |
| DV-4 | The "INTENTIONAL SERVICE-ROLE READS" comment was copied into the builder and **also kept** (with a pointer) in `redemptionDeps.ts`, rather than moved out of it | `redemptionDeps.test.ts` pins that marker in `redemptionDeps.ts` and had to run unedited (C-10). The comment is still true there: it hands the service-role lookups to the redemption |
| DV-5 | Four log events beyond §3.9: `bos_invite_subscribed_source_unknown` (warn, the C-6 "may have been owed" line), `bos_invite_subscribed_invite_unread` (warn), `bos_invite_subscribed_failed` (warn), `bos_invite_subscribed_notifier_failed` (warn) | Each failure path gets its own line, ids and error class only. `notifyInviter`'s own log context also gains `event` (N-1's lines included; no test pins it) |
| DV-6 | A lineage row read fine but with no `invite_id` on an `account_invite` first payment, and an invite id with no invite row, are both `invite_mismatch` (alerted) rather than `recipient_lookup_failed` | Both mean our records disagree, which is what Q-5's class is for; a read failure stays `recipient_lookup_failed` |
| DV-7 | An invite read that times out, or no time left before it, is `recipient_lookup_failed` with `details.inviteRead = 'timed_out'`; no time left after it (nothing started) is `deadline_exceeded` with `outcome: 'not_sent'` | Nothing was sent in either case, so N-1's `unknown` ("may still land") would overstate it |
| DV-8 | `planBillingHandler.ts` now imports `BusinessOsInviteRepository` (placement guard updated) | C-5 puts the notifier's construction in the handler; it hands over only the one read (SA N-3 practice) |

### I-8. Not done here (P-5b.2 and later)

T5 to T7 (the champion's "Subscribed" derivation, the admin paid line, the shadow report and the dry run), the C-7 guards for their methods, C-9, C-11, and the invite requirement §0 rows (at merge).

### I-9. Demo checklist (G-5, P-5b.1: D5 to D8 of §8)

Needs the user. Prerequisites as §8: the standard sandbox `acct_1UPKR4C7KDUGYIcA` with `stripe listen` forwarding to localhost; locally only, never committed: `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=true`, `BUSINESS_OS_PLAN_PRICES_ENABLED=true`, `paidInvitesAvailable: true`; `RESEND_API_KEY` and `RESEND_FROM_EMAIL` set (or the demo shows `sender_not_configured`); a test champion whose address the user controls, language Hebrew; a fresh held test friend from that champion.

| Step | Action | Expected |
|---|---|---|
| D5 | The friend pays with `4242 4242 4242 4242` | Processing, then onboarding (P-5a) |
| D6 | The champion's inbox | **One** email, Hebrew, right to left: subject "ההזמנה שלך הפכה למנוי" (no address), the friend's address left to right, status "נרשם למנוי", a button to the invite list |
| D7 | Read-only SQL | One `BOS_INVITE_INVITER_NOTIFIED`, `details.event = 'subscribed'`, entity `business_os_invite` / the invite id, `user_id` NULL or the platform account (never the friend or the champion), `details.accountId` = the friend, `details.recipientAccountId` = the champion; one `BOS_BILLING_FIRST_PAYMENT_STAMPED`; one `BOS_BILLING_INVOICE_PAID`. In the webhook's logs: one `bos_billing_invoice_applied` line (no timing), followed by one `bos_billing_invoice_post_commit` line carrying `postCommitMs` (SA F-1) |
| D8 | Resend the `invoice.paid` event from the sandbox dashboard | `already_applied`; no second email; no new audit rows |
| D12 | Cleanup, the same day | Cancel the test subscription in the sandbox; revert the local switch flips |

D9 to D11 belong to P-5b.2.

### I-10. SA code-review fixes (2026-10-14)

| # | Fix | Where | Tests |
|---|---|---|---|
| F-1 | Fixed by Dev: `bos_billing_invoice_applied` is back at the commit, before `afterCommit`, with P-3b's exact fields (`status`, `planWritten`, `anchorSet`, `tier`, ids) and no `postCommitMs`. The `try/finally` around `afterCommit` stays; its `finally` now writes a new `info` line `bos_billing_invoice_post_commit` with `status`, the ids and `postCommitMs`. Log order is P-3b's again (applied line, then the U-4 alert). Module header comment updated | `lib/business-os/billing/planPaymentApply.ts` (`afterApply`, `applied`/`recorded`) | `planPaymentApply.n2.test.ts`: the C-4 "every leg hanging" cases and the not-stamped case read `postCommitMs` from the new line and assert the applied line carries none; the order test now pins applied line → `record:start` → `record:end` → notify → post-commit line; new: the applied line is written exactly once, with exactly P-3b's fields, before `record:start`; new: a post-commit chain that never settles still leaves the applied line (and no post-commit line). `planPaymentApply.test.ts`, `planPaymentApply.firstPayment.test.ts`, `planBillingHandler.test.ts` unedited and green |
| F-2 | Applied by SA | `championSubscribedNotification.test.ts` | Kept as SA left it |
| QA-E1 | Fixed by Dev (QA Edge Case 1, test only): step 4's `if (left <= 0)` path is now pinned. `Date.now` is mocked and the invite read advances it by exactly `remainingMs`, so the clock is spent when step 4 runs | `championSubscribedNotification.test.ts` ("the invite read spends the whole clock → step 4 starts nothing") | Asserts one `NOT_NOTIFIED` with `reason: 'deadline_exceeded'`, `outcome: 'not_sent'`, `recipientAccountId` = the champion, `language: null`, the N-2 shape, the invite read once, N-1's deps never wired, nothing sent, no address. Mutant `if (false && left <= 0)` **killed** (only this test fails: N-1's deps were wired); restored by re-editing, md5 `e7c578644b9e9a81aef06dce6fca8d81` |
| QA-E2 | Fixed by Dev (QA Edge Case 2, test only): `maxDuration = 60` is now pinned | `app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts` ("exports `maxDuration = 60` at the top level, exactly once") | AST, like the rest of the guard: top-level exported `const maxDuration` initialised to `60`, exactly once. Mutant `maxDuration = 30` **killed** (only this test fails); restored by re-editing, `route.ts` md5 `ddffda2f3b71841d452f1b416404ea18` before and after. `npx jest lib/business-os/invites app/api/stripe/webhook --ci`: 33 suites, 1 123 tests, all passed |

---

## SA Code Review — P-5b.1 (2026-10-14)

**Code Review by SA — 2026-10-14**
**Status:** 🔄 APPROVED WITH FIXES. F-2 was applied by SA. F-1 is a small Dev change; SA re-checks it from the diff only, with no new review cycle.

### What SA ran (not taken from the Implementation Notes)

| Check | Result |
|---|---|
| `npx jest lib/business-os/billing lib/business-os/invites app/api/stripe app/api/public/invites lib/audit lib/repositories/__tests__ lib/email components/business-os/settings --ci` | 203 suites, 5 076 tests, all passed (before F-2) |
| `npm run test:bos-entitlements` | 252 suites, 7 346 tests, all passed. No new importer; `KNOWN_NON_GATE_IMPORTERS` unchanged (C-8) |
| Existing money suites unedited | `planPaymentApply.test.ts` (P-3b, P-7b.1a U-4), `planPaymentApply.firstPayment.test.ts` (P-5a.1), `planBillingHandler.test.ts`, `inviterNotification.test.ts`, `redemptionDeps.test.ts`, `inviteRedemption.test.ts`: none are in `git status`, and all are green |
| `console.*` in the 15 touched source files | 0 |
| `git diff --stat` (C-12) | No file has deletions without insertions |
| Boost | No file under `lib/business-os/boost/` or `app/**/boost*` is in the diff. The guard pins that none of them names the notifier, the port, `notifyChampion` or the N-2 read |
| Mutation checks, one at a time, each restored from a scratch copy and md5-verified (all three files `OK` at the end) | 15 mutants. **14 killed** on the first run. **1 survived:** in `championSubscribedNotification.ts`, passing `input.remainingMs` to N-1 instead of `left` (what is left after the invite read). No test combined a slow but successful invite read with a hung send. That mutant would let the chain overrun the 4 s clock and reach the 6.5 s backstop. **F-2 adds that test, and it now kills the mutant.** Killed: always reading the lineage (exactly-once); notifying before `recordPlanChange` (order); not charging the lineage time to the clock; removing the backstop; an unbounded lineage read; notifying for `organic` / `admin_invite`; dropping the redeemer check; dropping the issuer-kind check; `userId` = the friend; `actorId` set; the lineage entity type; an unbounded invite read; `statusFor` ignoring `subscribed` |

### Conditions verified in code

| Condition | Verdict | Where |
|---|---|---|
| P5-C3 / S5-5 a: exactly once, driven only by the stamp flag | ✅ | `afterCommit`: the lineage read and N-2 run only when `result.firstPaymentStamped === true`, on `applied`/`recorded` only. `already_*`, conflict, refusals, `plan_row_missing` and `billing_row_missing` never reach it (n2 "exactly once", mutant M1). Interleaved replay (C-4): one notifier call, one email, one entry. The real guarantee is the partial UNIQUE from P-5a.1, which the fake `apply` models faithfully |
| S5-5 b: nothing throws after the commit | ✅ | `readStampLineage` and `notifyFirstPayment` never throw (a sync throw becomes a rejection, late rejections are swallowed, and the backstop is `remaining + 2 s + 0.5 s`). `recordPlanChange` is still caught. Non-friend, non-stamped renewals, refusals and the U-4 alert keep their semantics, and the unedited P-3b/P-5a.1/P-7b.1a suites are green. Only log order changed: the U-4 alert now comes before the applied line (see F-1) |
| O-4 / P5-C8: one 4 s clock over the lineage read and the send | ✅ after F-2 | Lineage elapsed time is charged against the clock (M3), the invite read is bounded by what remains (C5), and N-1 gets what is left after that (F-2). The stamp flush is not counted, as designed. C-4 has every leg hanging, ≤ 8.5 s |
| C-2 / N-6: entity `business_os_invite`, `userId` and `actorId` null, never on the lineage entity | ✅ | One `toAuditInput` builds every entry. Pinned on every path (mutants C2, C3, C7 each fail 25 or more tests) |
| C-3: `maxDuration = 60` | ✅ | `app/api/stripe/webhook/route.ts` |
| C-5: one builder; every apply caller wires the notifier; boost never names it | ✅ | `firstPaymentStamp.guard.test.ts`, with the non-vacuity check (the handler is found, more than 10 boost files scanned) |
| C-6: an unread lineage is audited "may have been owed" | ✅ | `recipient_lookup_failed` with `details.lineageRead`, the `bos_invite_subscribed_source_unknown` warn, and no email without an invite id |
| C-7 (this PR's method) | ✅ | `findInviterNotificationFactsById`: 4 columns, service-role use documented in the method and in header item 7. Guarded: named only by the repository, the notifier and the handler |
| C-8: no cycle | ✅ | Both new modules are in the `paymentHold.test.ts` "imports nothing from entitlements" list |
| C-10: the deps builder is a move | ✅ | Redemption suites unedited and green; the audit callback stays the caller's. DV-4 below |
| Tenant isolation (`tenant-isolation-guard`) | ✅ | Account from our billing row (SR-8) → its lineage `invite_id` → the invite's `issuer_account_id`. No caller-supplied or Stripe-metadata id. The invite must be `issuer_kind = 'account'` and `redeemed_account_id` = the paying account (mutants C1, C4). Service-role reads are documented in the repository and in `inviterNotificationDeps.ts` |
| Email content (FR-40, FR-41, FR-43; N3, N5, N7) | ✅ | Recipient: only the champion's live auth address (`issuerKind: 'account'`; the type refuses an admin). Body: the typed address, the list's `subscribed` word (C-1, read from `INVITE_FRIENDS_COPY`, never re-translated), N-1's button and footer. Subject names no address. Platform sender, no Reply-To, both addresses redacted from transport logs, fails closed without a sender. No name, business, amount or plan. The Hebrew lead draft ("the payment for X was completed") is wording for G-3, not extra data |
| Pino; no address in logs | ✅ | Ids and error classes only; the `@` scan is in the notifier suite |

### Rulings on DV-1 to DV-8

| # | Ruling |
|---|---|
| DV-1 | **Accepted.** Keeping P-5a.1's event name with `outcome` added is the right call: dashboards and the unedited suite both keep working |
| DV-2 | **Accepted.** The notifier is a module-level singleton, so the delivery's logger has to travel in the input to keep the correlation id and the Stripe event id. It carries no data |
| DV-3 | **Not accepted as built; F-1.** With the applied line in a `finally`, a function cut off mid-chain loses the commit-time evidence. That is most likely exactly when it matters: after a slow pre-apply (O-2), close to the 60 s limit. Before this change, P-3b wrote that line before the flush. C-4's wording ("on the existing apply log line") caused this; SA amends C-4 as below |
| DV-4 | **Accepted.** A duplicated comment with a pointer is better than editing a pinned suite. C-10 is met in substance |
| DV-5 | **Accepted.** One line per failure path, ids only |
| DV-6 | **Accepted.** A lineage that reads `account_invite` with no `invite_id`, or an id with no invite row, means our own records disagree. That is `invite_mismatch`, alerted. A read failure stays `recipient_lookup_failed` |
| DV-7 | **Accepted.** Nothing was handed to the transport in either case, so `not_sent` is accurate and N-1's `unknown` would overstate it |
| DV-8 | **Accepted.** It follows from C-5; the placement guard is updated in the same diff, and only the one read is handed over |

### Code Review Comments

1. **F-1 (Dev). `lib/business-os/billing/planPaymentApply.ts` `afterApply`, `applied`/`recorded` case: DV-3. Priority: Medium.**
   - Put `bos_billing_invoice_applied` back where it was: immediately after the commit, before `afterCommit`, with P-3b's exact fields and no `postCommitMs`.
   - Keep the `try/finally` around `afterCommit`, but have the `finally` write a second line, `bos_billing_invoice_post_commit` (`info`), with `status`, `...ids` and `postCommitMs`.
   - In `planPaymentApply.n2.test.ts`, re-point the two assertions that read `postCommitMs` from the applied line (C-4 "every leg hanging" and "postCommitMs on the applied line") to the new line. Also assert that the applied line is still written exactly once and comes before `record:start`.
   - Update I-2, D7 and §3.1 step 7 to name the new line.
   - **C-4 is amended accordingly:** `postCommitMs` goes on its own post-commit line, not on the applied line.
2. **F-2 (applied by SA). `lib/business-os/invites/__tests__/championSubscribedNotification.test.ts`. Priority: Medium.** Added a `slow` invite option to the harness and the test "a 1 s invite read then a hung send → resolves at remainingMs in total". 33/33 pass, and the surviving mutant (`deadlineMs: input.remainingMs`) is now killed.

### Optimisation Suggestions (non-blocking)

- O-1. `notifyInviter`'s log context gained `event`, which also applies to N-1's lines. That is harmless and useful; mention it in the PR body so log searches are not surprised.
- O-2. The interleaved-replay test models the partial UNIQUE with a `Map`. That is fine for orchestration. The real guarantee stays with P-5a.1's probe, and D8 in the demo is the live check.

### Code Approved for QA: **Yes, once F-1 is applied** and `planPaymentApply.n2.test.ts`, `planPaymentApply.test.ts` and `planPaymentApply.firstPayment.test.ts` are green. SA re-checks F-1 from the diff only. G-3 (the user's approval of the he/es wording) and the demo (D5 to D8) remain merge gates, as planned.

---

## QA Testing Report

### P-5b.1 "N-2 email"

**QA — 2026-10-14**
**Test mode:** full (focus api, security), against the uncommitted worktree `neuronforge-invite-s1`, branch `feature/bos-plan-payments-p5b` on `cc1bf66b`, after SA F-2 and Dev F-1
**Strategy used:** A + B (Jest with fakes, fake timers and source guards; the real `recordPlanChange`, bounded flush, N-2 notifier and N-1 template run inside the n2 suite) plus code reading. No browser, no real database, no Stripe, no real email in this session, so the live half (D5 to D8, D12) is a run-sheet for the user below
**Focus:** api, security, performance (the post-commit budget)
**Skipped:** live demo (needs the user's sandbox session and inbox); `e2e` (no UI in this PR)
**Input source:** TL prompt (QA focus 1 to 7) plus SA Code Review QA focus

#### Commands run (QA's own runs, not copied)

| Command | Result |
|---|---|
| `npx jest lib/business-os/billing lib/business-os/invites app/api/stripe app/api/business-os/friend-invites app/api/business-os/billing app/api/public/invites app/api/admin/business-os/invites lib/audit lib/repositories/__tests__ lib/email components/business-os/settings lib/business-os/entitlements --ci` | **252 suites, 6 535 tests, all passed** (Dev's 6 532 + F-2's 1 + F-1's 2) |
| `npm run test:bos-entitlements` | **252 suites, 7 346 tests, all passed**. No new importer; `KNOWN_NON_GATE_IMPORTERS` unchanged |
| `npm run typecheck:bos-llm` | **passed**: 516 files, 28 errors, 0 new (the one "baseline entry fixed" note on `app/api/onboarding/build/route.ts` is pre-existing and unrelated) |
| `npm run lint:hooks` | **passed** (exit 0, max-warnings 0) |
| Re-run after the mutation was restored: n2, firstPayment, apply, handler, stamp guard, notifier, deps, paymentHold, N-1, redemptionDeps and `app/api/stripe/webhook` | 26 suites, 756 tests, all passed |
| `console.*` in the new or touched N-2 sources and the webhook route | 0 |
| `git diff --stat` (C-12) | 22 tracked files; no file has deletions without insertions. `invite-accepted.test.ts` is additions only (+66); `paymentHold.test.ts` +9/−1 (the C-8 list) |

The SA public-invite path is `app/api/public/invites` (there is no `app/api/invite`); it is in the run above.

#### Test Coverage

| # | What was checked | Tested? | Result | Evidence |
|---|---|---|---|---|
| 1 | After F-1: `bos_billing_invoice_applied` written once, at the commit, before the audit; `postCommitMs` only on `bos_billing_invoice_post_commit` | ✅ | Pass | Code: the applied line is the first statement of the `applied`/`recorded` case, then `afterCommit` inside `try/finally`, the `finally` writes the post-commit line with `postCommitMs`. n2 tests "SA F-1: the applied line is written exactly once, before record:start, with P-3b's fields and no postCommitMs", "a post-commit chain that never settles still leaves the applied line", the order test and "postCommitMs on the post-commit line". `planPaymentApply.test.ts`, `planPaymentApply.firstPayment.test.ts`, `planBillingHandler.test.ts` unedited (not in `git status`) and green |
| 2 | Exactly once: replay mid-send gives one email and no second N-2 audit | ✅ | Pass | n2 "C-4: a replay arriving WHILE the first delivery is still sending": second delivery logs `already_applied`, one `notifyChampion` call, one send, N-2 entries = `['BOS_INVITE_INVITER_NOTIFIED']`. Plus "through the real handler, the same invoice twice: one notification". Live proof is D8 (the partial UNIQUE is modelled by a `Map`, SA O-2) |
| 3 | Friend first payment: one email to the champion's live address only; subject with no address; Hebrew RTL; no Reply-To; addresses redacted; fails closed without a sender | ✅ | Pass | Notifier happy path: `to` = the champion's address from `findUserIdentity`, subject `ההזמנה שלך הפכה למנוי` with no `@`, `redactRecipientInLogs: true`, `redactInLogs: [invitee]`, no `replyTo`, no `from`; "no platform sender → sender_not_configured, nothing sent". Template suite (+11): `subscribed` × en/he/es, RTL with the address LTR, list word read from `INVITE_FRIENDS_COPY`. No `@` in any log line or audit entry (scan on every notifier path) |
| 4a | Organic and admin-invite first payments: no send, no N-2 audit | ✅ | Pass | n2 `it.each(['admin_invite','organic'])`: notifier not called, `n2Entries()` empty, an info line only. Code: `source !== null && source !== 'account_invite'` returns before the port. `source` is `NOT NULL` with a CHECK in `20261014` (verified), so a read-ok row can never reach the notifier with a null source and be mis-alerted |
| 4b | Renewal / second payment sends nothing | ✅ | Pass | n2 "applied, flag false" / "recorded, flag false" / `already_*` / `subscription_conflict`: never called, no lineage read. The flag comes only from the SQL function's stamp (`first_paid_at IS NULL` guard in `20261028`) |
| 4c | Invite redeemed by another account → `invite_mismatch`, alerted, no email | ✅ | Pass | Notifier Q-5 table: admin invite, no issuer, redeemed by another, not redeemed, no row → `reason: invite_mismatch`, `outcome: not_sent`, `error` + `alert: true`, ids only, nothing sent |
| 4d | Lineage read failure → not notified, "may have been owed", no send | ✅ | Pass | n2 C-6 table (no port, error, no row, throw) and notifier C-6 table (failed, timed_out, no_row, no_port): `recipient_lookup_failed`, `entityId: null`, `details.lineageRead`, the `bos_invite_subscribed_source_unknown` warn, no invite read, no email; the stamp entry still written with `source: null` |
| 4e | One 4 s clock incl. a slow invite read and a hung send (F-2) | ✅ | Pass | Notifier "a 1 s invite read then a hung send → resolves at remainingMs in total" (2 499 ms not done, 2 500 ms done, `unknown`/`deadline_exceeded`); n2 O-4 tests (1.5 s lineage leaves 2.5 s; hung lineage times out at 4 s; the port's own deadline); C-4 every-leg-hanging cases resolve with `postCommitMs` ≤ 8 500 |
| 5 | N-2 audit shape: `business_os_invite`, `userId`/`actorId` null, never the lineage entity; owners cannot read it | ✅ | Pass | One `toAuditInput` builds every entry; the notifier C-2 table pins it on every path; source guard: no N-2 file names the lineage entity. Owner side, read by QA: the live owner policy (`20261035`) is `auth.uid() = user_id AND …`, which is never true for a NULL `user_id`; both owner readers (`listOwnerEntries`, `listOwnerEntriesForExport`) are `.eq('user_id', <caller>)`. `AuditTrailService` stores `userId \|\| SYSTEM_ADMIN_USER_ID \|\| null`, so the row is NULL or the platform account, never the friend or the champion |
| 6 | `maxDuration = 60` exported on the webhook route | ✅ | Pass | `app/api/stripe/webhook/route.ts`, next to `runtime = 'nodejs'`, with its reason (see Edge Case 2: nothing pins it) |
| 7a | C-5 / C-7 / C-8 guards | ✅ | Pass | `firstPaymentStamp.guard.test.ts` (every `applyPaidPlanInvoice(` caller names `firstPaymentNotifier`, handler found; `createFirstPaymentNotifier(` only in `planBillingHandler.ts`; `findInviterNotificationFactsById` named only by the repository, notifier and handler; no boost file names the notifier, port, `notifyChampion` or the N-2 read); `BusinessOsInviteRepository.test.ts` method list + row-leak check; `paymentHold.test.ts` C-8 list; `routerPlacement.guard.test.ts`; `authAccountRepository.callers.guard.test.ts`. All green |
| 7b | Boost untouched | ✅ | Pass | No path containing `boost` in `git status`; `boostRouting.integration.test.ts` green |
| 7c | N-1 "invite accepted" behaviour unchanged | ✅ | Pass | `inviterNotification.test.ts`, `redemptionDeps.test.ts`, `inviteRedemption.test.ts`, `app/api/public/invites/**` unedited and green. Only N-1 change in behaviour: its log context gains `event` (SA O-1, harmless) |

#### Mutation check (one, of QA's choice)

| Mutant | File | Result |
|---|---|---|
| Step 4's guard disabled: `if (left <= 0)` → `if (false && left <= 0)` (the check that nothing is started once the clock is spent after the invite read, DV-7's `deadline_exceeded` / `not_sent` path) | `lib/business-os/invites/championSubscribedNotification.ts` | **Survived**: notifier + n2 suites 67/67 green. Restored by re-editing; md5 `e7c578644b9e9a81aef06dce6fca8d81` before and after (matches the scratch copy); key suites re-run green (26 / 756) |

What the surviving mutant means: without the guard, an invite read that finishes exactly as the clock runs out hands `notifyInviter` a deadline of 0 or less. Its race resolves `unknown`/`deadline_exceeded` at once, but `run()` keeps going in the background and can still dispatch the email after the delivery has returned, which is what step 4 is there to prevent. The audit would say "may still land", so nothing is mis-recorded, and the window is milliseconds wide. The code is correct as written; only the pin is missing (Edge Case 1).

#### Issues Found

##### Bugs (must fix before commit)
None.

##### Performance Issues (should fix)
None. The post-commit chain is bounded at ≤ 8.5 s with every leg hanging (C-4), and `maxDuration = 60` leaves a wide margin. The pre-apply Stripe calls on the SDK's default timeout remain SA O-2 (P-8), out of scope.

##### Edge Cases (nice to fix)
1. **Step 4's `deadline_exceeded` / `not_sent` path has no test** — `lib/business-os/invites/__tests__/championSubscribedNotification.test.ts` — Severity: Low. The mutant above survives. Suggested pin, under fake timers: an invite read that resolves at exactly `remainingMs` (or a deps hook that advances the clock past it before returning) → one `NOT_NOTIFIED` with `reason: 'deadline_exceeded'`, `outcome: 'not_sent'`, `recipientAccountId` = the champion, and `sent` empty.
2. **`maxDuration = 60` is not pinned by any test** — `app/api/stripe/webhook/route.ts` — Severity: Low. SA C-3 only asked for a guard update if one already pinned the route's exports, and none does, so this is not a C-3 miss. A one-line source assertion (for example in `routerPlacement.guard.test.ts`) would stop a silent removal.

##### Notes (informational)
- N-1's log lines now carry `event` (SA O-1); mention it in the PR body.
- The main merge was skipped by Dev (I-1). RM merges `origin/main` at commit time; the overlap is two caller allow-lists and the requirement.
- G-3 (the user's approval of the he/es drafts in I-6) and the live demo below are still merge gates, as SA set them.
- **G-2 (informational, not a gate after SA Q-2):** in the demo session, record (a) the Stripe webhook endpoint's documented delivery timeout from the Stripe docs or dashboard, and (b) whether Vercel fluid compute is on for the project (Vercel → Project → Settings → Functions). Neither changes exactly-once; they only decide whether a slow delivery shows "failed" in Stripe before a no-op retry.

#### Demo run-sheet for the user (D5 to D8, D12) — sandbox `acct_1UPKR4C7KDUGYIcA`

Local and production share one database: everything below writes real test-mode rows. Every SQL query is read-only. The queries use time windows instead of pasted ids, so nothing has to be copied in, and their strings contain only plain words.

**Before you start (about 10 minutes)**

| # | Do | Check |
|---|---|---|
| P1 | In the worktree, set locally: `BUSINESS_OS_PLAN_CHECKOUT_ENABLED=true` and `BUSINESS_OS_PLAN_PRICES_ENABLED=true` in `.env.local`; `paidInvitesAvailable: true` at `lib/business-os/entitlements/config/invites.ts` (line 128) | These must never be committed. This worktree holds the uncommitted P-5b.1 change, so write the flip down: it is reverted in D12 before RM commits |
| P2 | `RESEND_API_KEY` and `RESEND_FROM_EMAIL` set in `.env.local` | Without them N-2 is audited `sender_not_configured` and no email arrives (a valid failure demo, not the happy one) |
| P3 | `stripe listen --forward-to localhost:3000/api/stripe/webhook` on the standard sandbox; its `whsec_` in `STRIPE_WEBHOOK_SECRET`; `npm run dev` | The listener prints `Ready` |
| P4 | A test champion whose inbox you control. Set the champion's language to **Hebrew** in Settings | Hebrew shows in Settings |
| P5 | As the champion, invite a **new** friend address (one you can sign up with). Sign up as that friend | The friend lands on "Finish your payment" (held). The champion gets the N-1 "invite accepted" email: that one is expected and is not the email under test |

**The run**

| Step | Do | Expected |
|---|---|---|
| D5 | As the friend, pay with `4242 4242 4242 4242`, any future date, any CVC | Processing, then onboarding. In `stripe listen`: `invoice.paid` → `200` |
| D6 | Open the champion's inbox | **Exactly one new** email (besides P5's): Hebrew, right to left; subject `ההזמנה שלך הפכה למנוי` with no address in it; the friend's address shown left to right; status `נרשם למנוי`; a button to the invitations list; reply goes to the platform sender (no Reply-To) |
| D7 | Run the SQL checks below, then check the `npm run dev` output | Query 1: one row, `entity_type` = `business_os_invite`, `user_null_or_platform` true, `is_friend` and `is_champion` false, `account_matches` and `recipient_matches` true, `outcome` = `sent`. Query 2: one stamped row with `source` = `account_invite`. Query 3: one `invoice_paid` row. Logs: one `bos_billing_invoice_applied` line (no timing), then one `bos_billing_invoice_post_commit` line with `postCommitMs` (expect well under 4 000) |
| D8 | Stripe dashboard (sandbox) → Developers → Events → the `invoice.paid` from D5 → **Resend** to the CLI endpoint (or `stripe events resend <evt id>`) | `stripe listen` shows `200`; dev log shows `bos_billing_invoice_replayed` with `already_applied`; **no second email**; re-run queries 1 to 3: the counts are unchanged |
| D9 | Record G-2 (above) | Informational |
| D12 | Same day: cancel the test subscription in the sandbox; revert P1 and P2 (`paidInvitesAvailable` back to `false`, the two env switches removed); confirm `git diff -- lib/business-os/entitlements/config/invites.ts` is empty. Then, if wanted, the friend through the Danger Zone cleanup (refused while the subscription is live) | Nothing from P1 or P2 left in the working tree |

**SQL checks (read-only, paste one at a time)**

Query 1, the N-2 audit entry:

```sql
select a.created_at, a.action, a.entity_type, a.details ->> 'outcome' as outcome, a.details ->> 'reason' as reason, a.details ->> 'language' as language, a.user_id is null or a.user_id not in (i.issuer_account_id, i.redeemed_account_id) as user_null_or_platform, coalesce(a.user_id = i.redeemed_account_id, false) as is_friend, coalesce(a.user_id = i.issuer_account_id, false) as is_champion, (a.details ->> 'accountId') = i.redeemed_account_id::text as account_matches, (a.details ->> 'recipientAccountId') = i.issuer_account_id::text as recipient_matches
from public.audit_trail a
left join public.business_os_invites i on i.id::text = a.entity_id
where strpos(a.action, 'INVITER') > 0
  and a.details ->> 'event' = 'subscribed'
  and a.created_at > now() - interval '3 hours'
order by a.created_at;
```

Query 2, the first payment stamp and its audit entry:

```sql
select l.account_id, l.source, l.invite_id, l.first_paid_at, l.first_payment_ref, (select count(*) from public.audit_trail t where t.entity_id = l.account_id::text and strpos(t.action, 'STAMPED') > 0) as stamp_entries
from public.business_os_account_lineage l
where l.first_paid_at > now() - interval '3 hours';
```

Query 3, the money row and its audit entry:

```sql
select e.kind, e.livemode, e.stripe_invoice_id, e.amount_minor, e.currency, e.created_at, (select count(*) from public.audit_trail t where t.entity_id = e.user_id::text and strpos(t.action, 'INVOICE') > 0 and strpos(t.action, 'PAID') > 0 and t.created_at > now() - interval '3 hours') as invoice_paid_entries
from public.business_os_billing_events e
where e.created_at > now() - interval '3 hours'
  and e.livemode = false
order by e.created_at;
```

Expected after D8: query 1 still one row, query 2 `stamp_entries` 1, query 3 one `invoice_paid` row with `invoice_paid_entries` 1.

#### Final Status
- [x] All acceptance criteria in scope pass in tests — ready for commit once the merge gates close: **G-3** (the user approves the he/es drafts) and the **live demo** above (D5 to D8, D12)
- [ ] Issues found — no Bugs; two Low edge cases (test pins) that Dev may add before commit or track as a follow-up

**Verdict: PASS WITH NOTES.**

---

## Commit Info

_To be completed by RM._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-13 | Workplan written (Dev) | P-5b per §9.1, §9.1.1 (N-6) and the SA review of the P-5 scoping (S5-4, S5-5, S5-8, P5-C3, P5-C8 to P5-C11, P5-N2) and the P-5a.1 code review (D-3, O-4). Branch `feature/bos-plan-payments-p5b` from `origin/main` `cc1bf66b`. N-2 from `planPaymentApply.ts` through an injected notifier under one 4 s clock (lineage read included), N-1's audit shape for N-6 with no migration, champion "Subscribed" through an issuer-scoped lineage read, admin paid line matching account and invoice together, batched hold classification for the shadow report and the launch dry run. ≈3.0d; split proposed into P-5b.1 "N-2 email" (≈1.6d) and P-5b.2 "Who sees the payment" (≈1.4d). No migration expected (highest on `origin/main` `f302680f`: 20261058). Q-1 to Q-12 for SA |
| 2026-10-13 | SA workplan review: **APPROVED WITH CONDITIONS** (SA) | Verified the live owner policy (20261035) and both owner readers: NULL-`user_id` rows are unreachable by any owner, so **Q-1 option A, no migration**, N-6 met by `userId: null` on the invite entity (C-2; stored `user_id` may be the platform account when `SYSTEM_ADMIN_USER_ID` is set). **Q-2:** exactly-once rests on the stamp flag, not on Stripe's timeout; the webhook gets `maxDuration = 60` (C-3) and a hanging-legs budget test plus an interleaved-replay test (C-4). Q-3 to Q-12 accepted as proposed (Q-4 optional + a caller guard, C-5). Conditions C-1 to C-12. **Split accepted:** P-5b.1 "N-2 email" ≈1.6d and P-5b.2 "Who sees the payment" ≈1.4d, never stacked, either order (G-3 moves with the `subscribed` word) |
| 2026-10-13 | P-5b.1 "N-2 email" code complete (Dev) | T0 to T4 and the .1 shares of T8 to T11, plus the shared `'subscribed'` status and its en/he/es word (C-1). Uncommitted on `feature/bos-plan-payments-p5b` at `cc1bf66b`; main merge skipped (I-1). N-2 from `planPaymentApply.ts` through the optional `firstPaymentNotifier` port (built only in `planBillingHandler.ts`), one 4 s clock over the lineage read and the notification, N-1's template, sender and audit events with `event: 'subscribed'`, every entry on `business_os_invite` with no owner (C-2); webhook `maxDuration = 60` (C-3); budget, every-leg-hanging and mid-send replay tests and `postCommitMs` (C-4); caller and boost guards (C-5, C-7); unread lineage audited "not notified" (C-6); no entitlements import (C-8); deps builder a move with the redemption suites unedited (C-10). §3.2 table and D7 corrected for the stored `user_id` (C-2). Tests: scope 252 suites / 6 532 passed; `test:bos-entitlements` 252 / 7 346 passed; `typecheck:bos-llm` passed. Deviations DV-1 to DV-8 and the he/es drafts (G-3) in Implementation Notes (P-5b.1) |
| 2026-10-14 | SA code review P-5b.1: **APPROVED WITH FIXES** (SA) | Every C-condition, P5-C3, P5-C8 and O-4 verified in code. SA ran 203 suites / 5 076 tests and `test:bos-entitlements` (252 / 7 346), all green; the existing money suites are unedited. 15 mutants: 14 killed, 1 survived (the clock handed to N-1 not charged for the invite read), now killed by F-2's new test (applied by SA). DV-1, DV-2 and DV-4 to DV-8 accepted. **DV-3 not accepted: F-1 (Dev)** restores the commit-time `bos_billing_invoice_applied` line and puts `postCommitMs` on a new `bos_billing_invoice_post_commit` line (C-4 amended). Approved for QA once F-1 is applied; SA re-checks F-1 from the diff |
| 2026-10-14 | SA F-1 applied (Dev) | `planPaymentApply.ts`: `bos_billing_invoice_applied` back at the commit with P-3b's exact fields and no `postCommitMs`; the `finally` around `afterCommit` writes a new `info` line `bos_billing_invoice_post_commit` (`status`, ids, `postCommitMs`). `planPaymentApply.n2.test.ts` re-pointed to the new line, plus 2 tests (applied line once, P-3b's fields, before `record:start`; still written when the chain never settles), 34 tests. §3.1 step 7, I-2, I-4, I-9 D7, DV-3 updated; I-10 added. `npx jest lib/business-os/billing lib/business-os/invites app/api/stripe --ci`: 68 suites, 2 273 tests, all passed. Money suites (`planPaymentApply.test.ts`, `planPaymentApply.firstPayment.test.ts`, `planBillingHandler.test.ts`) unedited and green. Uncommitted |
| 2026-10-14 | QA P-5b.1: **PASS WITH NOTES** (QA) | Scoped Jest 252 suites / 6 535 tests, `test:bos-entitlements` 252 / 7 346, `typecheck:bos-llm` passed (0 new), `lint:hooks` passed. F-1 order and exactly-once (mid-send replay) confirmed; organic, admin-invite, renewal, mismatch and unread-lineage paths send nothing; N-2 entries ownerless on `business_os_invite`; `maxDuration = 60`; C-5/C-7/C-8 guards green; boost and N-1 untouched. One mutant (step 4 `left <= 0` guard) survived: Low test-gap edge case, plus `maxDuration` unpinned. No bugs. Demo run-sheet (D5 to D8, D12, G-2) in the QA section |
| 2026-10-14 | QA Edge Cases 1 and 2 pinned (Dev, tests only) | I-10 QA-E1: `championSubscribedNotification.test.ts` gains the step-4 test (clock spent by the invite read → `deadline_exceeded` / `not_sent`, nothing wired or sent); QA's surviving mutant is now killed. I-10 QA-E2: `routerPlacement.guard.test.ts` pins `export const maxDuration = 60` by AST; mutant `= 30` killed. Both sources restored by re-editing (md5 verified). `npx jest lib/business-os/invites app/api/stripe/webhook --ci`: 33 suites, 1 123 tests, all passed. Uncommitted |
| 2026-10-14 | P-5b.1 PR opened (TL) | Committed e173161c, merged main efde2a8e, PR #359; status line updated; the two DRAFT comments in invite-accepted.ts replaced by the user's approval note |
