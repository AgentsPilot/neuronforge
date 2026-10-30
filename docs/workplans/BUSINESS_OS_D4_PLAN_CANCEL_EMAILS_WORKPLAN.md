# Workplan: D4 / SX-3 — Plan cancel emails (cancelled, kept, 3-day reminder), switch off

> **Last Updated**: 2026-10-29

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) §5, §6.2 row SX-3, §7, §10 carried rulings (C-1, C-9, C-11, SA-9, SA-15); parent [BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md) §6, §17
**Plan:** [BUSINESS_OS_ACCOUNT_DELETION_PLAN.md](/docs/workplans/BUSINESS_OS_ACCOUNT_DELETION_PLAN.md) §1 row SX-3
**Branch:** D4a `feature/plan-cancel-emails-d4` (worktree `neuronforge-d4`, from `origin/main` `415f726e`; merged as PR #566). D4b `feature/plan-cancel-reminder-d4b` (same worktree, from `origin/main` `32effb8d`)
**Date:** 2026-10-28
**Status:** D4a merged (PR #566). D4b Code Complete (2026-10-29, awaiting SA code review; migration 20261100 not applied)

## Overview

D4 sends the three plan-cancel emails the requirement names: **"Plan cancelled"** when an owner cancels in Settings → Plan, **"Plan kept"** when they press Keep my plan, and a **reminder about 3 days before a cancelled plan ends** (BQ-36, answered yes by the user on 2026-10-28). It also does the two small SX-3 items: the R-3 refusal text and the P-7a note (C-1). The emails sit behind a new server switch, **off by default**. The user has not yet confirmed that `agentspilot.ai` is verified in Resend or that `RESEND_FROM_EMAIL` is set in production, so D4 merges with the switch off and is switched on later. The reminder needs a durable once-only record, so D4 needs **one migration** (number to be reserved, §6). The estimate is **≈ 2.2 d** against the 1.5 d budget, under the 2.5 d cap (§9).

## Table of Contents

1. [What exists today (verified on 415f726e)](#1-what-exists-today-verified-on-415f726e)
2. [Scope and non-scope](#2-scope-and-non-scope)
3. [Design](#3-design)
4. [Copy (English drafts)](#4-copy-english-drafts)
5. [Files to create / modify](#5-files-to-create--modify)
6. [Migration](#6-migration)
7. [Task list](#7-task-list)
8. [Test plan](#8-test-plan)
9. [Effort](#9-effort)
10. [Open questions for SA](#10-open-questions-for-sa)
11. [Questions for the user (business only)](#11-questions-for-the-user-business-only)
12. [SA Review Notes](#12-sa-review-notes)
13. [QA Testing Report](#13-qa-testing-report)
14. [Commit Info](#14-commit-info)
15. [Change History](#change-history)

---

## 1. What exists today (verified on 415f726e)

| Item | Where | What it means for D4 |
|---|---|---|
| The one "don't renew" engine | `lib/business-os/billing/planSubscriptionManage.ts` (`managePlanSubscription`) | Returns `cancelled` (with `endsOn`, and `mode: 'immediate'` for P-7a.4), `reactivated` (with `renewsOn`), `unchanged` or a refusal. **D6 (deletion request) will call the same engine**, so the plan-cancel emails must NOT be sent from inside it |
| Routes | `app/api/business-os/billing/plan/cancel/route.ts`, `…/reactivate/route.ts` | Behind `BUSINESS_OS_PLAN_PRICES_ENABLED` (404 when off). Audit through `logAndFlush`. No email today. 0 `console.*` |
| Cancel switch | none of its own | `isPlanSelfCancelEnabled()` was superseded (D2 W-1, P-7a C-1 / BQ-1): cancel follows the price-recognition switch. D3 added no switch. So "switch on" in SX-3 can only mean **the email switch D4 adds** |
| What the drawer showed | `lib/business-os/entitlements/planEndingView.ts` → `readPlanEndingView({ accountId, endsAt, locale })` | Kinds `free_plan` (Test Flight until `until`, `credits`, then read-only `thenReadOnlyDays`, paused from `thenPausedFrom`), `back_to_plan` (Founding Partner until `until`), `unknown`. The halving for repeat cancels is already inside (D3.1). The email reuses this, so the email and the drawer state the same rule (C-9) |
| Date format on the account's clock | `formatAccountDay(iso, language, timeZone)` in `components/business-os/settings/planUpgradeCopy.ts` (plain TS, no `'use client'`) | The drawer formats dates with it; the email uses the same function so the day is the same |
| Platform → owner email precedent | `lib/business-os/invites/inviterNotification.ts` + `inviterNotificationDeps.ts`, template `lib/email/templates/invite-accepted.ts` | Injected deps, never throws, one deadline, fails closed when `platformSenderAddress()` is unset, recipient = live auth email (`authAccountRepository.findUserIdentity`), language = `resolveUserLanguage` (`business_profiles.language`, then `user_preferences.preferred_language`), `redactRecipientInLogs: true`, en/he/es with RTL via `wrapInBrandedTemplate({ locale })` |
| Email transport | `lib/notifications/emailTransport.ts` | `kind: 'transactional'` is required. No `idempotencyKey` today; EXPORT adds it in MX-3 (S-10). **D4 only calls `sendEmail`; it does not change `SendEmailParams`** (coordinator constraint, 2026-10-28) |
| Timezone | `userPreferencesRepository.findTimezone(userId)` | `null` when unset → UTC (CLAUDE.md: NULL = not asked) |
| Existing daily Stripe sweep | `/api/cron/bos-billing-reconcile` (05:41 UTC, `maxDuration = 60`, 45 s budget), passes in `lib/business-os/billing/reconcilePasses.ts`, counts in `lib/cron/bosCronJobs.ts` | The seam to append a pass without a new cron and without touching `vercel.json`. Its header says "NOT A QUEUE DRAIN"; the reminder pass is one, so it brings its own claim (§3.4) |
| Once-only record | none | `email_sends` needs a `contact_id` (owner mail is never recorded there); audit is non-blocking and is not a claim. A durable record must be added: §6 |
| R-3 refusal text | `lib/business-os/purge/adminDeletionRefusals.ts` `R3_CLEARING` | **Already re-worded by P-7a.3** ("The owner cancels it in Settings → Plan, or cancel it in the Stripe dashboard …"). The 2 `console` hits in that file are the words "admin console" in strings, not calls (0 real `console.*`) |
| P-7a note (C-1) | `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` §9.1 P-7a row | D2 already added "Self-service exit SX C-1 (D2 / SX-1)". Missing: that SX-3 adds the cancel emails, and that the portal cannot cancel (verified: `portalConfiguration.ts` `subscription_cancel: false`) |
| Migrations on `origin/main` | `supabase/migrations/` highest **20261098** | Next free **20261099**, **not yet reserved**. The coordination file says 97 was taken from main without a reservation; check `ls supabase/migrations` on fresh `origin/main` again just before writing the file |

---

## 2. Scope and non-scope

**In scope**

- "Plan cancelled" email, including the P-7a.4 immediate end ("Your plan has ended", U-2).
- "Plan kept" email.
- The 3-day reminder, sent once, only while the plan is still set to end (§7 AC).
- A server switch `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED`, off by default, plus its `FEATURE_FLAGS.md` row.
- The R-3 text check (and a small addition if SA wants one, S-13), and the P-7a note.
- Audit for each send or not-send.

**Not in scope**

- Turning the switch on. That is an ops step after the user confirms Resend (§9 of the plan, ops gate).
- Emails for the deletion request (DL-3 owns them, from its own lifecycle job).
- Emails for a cancel or reactivation done by an operator in the Stripe dashboard, or mirrored by the webhook (S-6).
- Any change to the engine, the webhook, `emailTransport.ts`, the drawer, or `vercel.json`.

---

## 3. Design

### 3.1 The switch

`lib/business-os/billing/planCancelEmailsFlag.ts` → `isPlanCancelEmailsEnabled()`, reading `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` through `parseBooleanFlag(…, false)`. It is server-only, has no `NEXT_PUBLIC_` prefix, and is read on every call, the same shape as `planPricesFlag.ts`. The name is `is…Enabled`, never `use…` (CLAUDE.md).

When the switch is off: nothing is looked up, composed, sent or audited. The routes behave exactly as today, and the reminder pass returns `{ skipped: 1 }` without claiming a row.

When the switch is on but `platformSenderAddress()` is `undefined`: nothing is sent, the reason `sender_not_configured` is audited, and the reminder row is released, not marked (so it is retried once the sender is fixed, while still inside the window).

### 3.2 One composer for all three emails

`lib/business-os/billing/planCancelEmail.ts`, in the shape of `inviterNotification.ts`:

```text
sendPlanCancelEmail({ event, userId, endsOn | renewsOn, mode? }, deps) → { outcome: 'sent' | 'not_sent' | 'unknown', reason?, language, provider }
  event: 'cancelled' | 'ended_now' | 'kept' | 'reminder'
```

- **Never throws.** Every dependency call is guarded. The whole run sits under one deadline (4 s, like `INVITER_NOTIFICATION_POLICY`), so a cancel press waits at most that long for the email.
- **Recipient (SA-9):** the account's live auth email, `authAccountRepository.findUserIdentity(userId)`. The id is the session user's (routes) or the claimed row's `user_id` (reminder), never a request value. `.invalid` addresses are refused by the transport already (DE-10b.1).
- **Language (SA-9):** `resolveUserLanguage({ profileLanguage, preferredLanguage })`, the server-side email standard. Note for SA (S-7): the my-plan route that feeds the drawer reads `user_preferences.preferred_language` only, so in a rare mismatch the email and the drawer can speak different languages.
- **Timezone (SA-9):** `userPreferencesRepository.findTimezone(userId)`, UTC when `null` or unreadable. Dates are formatted with `formatAccountDay`, the drawer's own function.
- **What happens next (C-9):** `readPlanEndingView({ accountId: resolveAccountId(userId), endsAt, locale })`, where `endsAt` is the engine's `endsOn` (cancel) or the claimed row's `current_period_end` (reminder). A `null` or `unknown` view drops the "what happens next" paragraph and keeps the facts that are certain (end date, no further charge). It never guesses. The kept email does not need the view.
- **Sender:** no `from`, no `replyTo`, no `ownerUserId`. The transport uses `RESEND_FROM_EMAIL` (`notifications@agentspilot.ai`, open issue 1). The support address shown in the footer is a config constant equal to that address, not a literal in three templates.
- **Logs:** `redactRecipientInLogs: true`. Pino lines carry ids, event, outcome, reason code, language and language source only. Never an address, a name or a plan name.
- **Deps file:** `planCancelEmailDeps.ts` wires the real repositories, transport, `platformUrl`, `readPlanEndingView` and `resolveAccountId`. It is the only D4 file that imports from `lib/business-os/entitlements/`, so it is the one `KNOWN_NON_GATE_IMPORTERS` entry (display only, refuses nothing). `planCancelEmail.ts` takes the view through a port and imports only the `PlanEndingView` **type**, so it needs an entry too (S-16 asks whether to avoid that by re-declaring a structural type).

### 3.3 Cancelled and kept: sent from the routes

The routes are the only owner-initiated paths, and D6 will call the engine but must not send these emails. So the send goes in the routes, after the audit flush:

| Engine result | Email |
|---|---|
| `cancelled`, period end | "Plan cancelled" (`cancelled`) |
| `cancelled`, `mode: 'immediate'` (P-7a.4) | "Your plan has ended" (`ended_now`, U-2) |
| `reactivated` | "Plan kept" (`kept`) |
| `unchanged`, any refusal, `outcomeUnknown` | none. SA-9: send only on a real change |

The route's response does not depend on the email outcome. The email outcome is audited (§3.6) and logged. Two tabs pressing at the same instant can both reach the Stripe write (already noted in the cancel route) and so send two emails. That is accepted as rare, and S-10 asks SA to confirm.

### 3.4 The reminder: a pass on the existing daily billing cron

A new pass `planCancelReminderPass` (name `cancelreminder`, lower-case letters only, as `PASS_NAME` requires) is appended to `RECONCILE_PASSES`. **No new cron, no `vercel.json` change, no added CI time.** Its counters are added to the job's `counts` in `lib/cron/bosCronJobs.ts`.

It follows the durable-queue-drain skill (§8.1), with the deviations S-3 asks about:

```text
if switch off → return { skipped: 1 }
runner = randomUUID()
rows = repo.claimCancelReminders(runner, livemode = current key mode, window = 3 d, lease = 90 s, batch = 25)   // one RPC, FOR UPDATE SKIP LOCKED
for each row (stop starting rows past context.deadlineAt):
   fresh = stripe.retrieveBusinessOsSubscription(row.subscriptionId)          // choke point
   C-4 cross-checks (id, customer, mode, bos_user_id) → mismatch: release, count, alert
   still cancelling (flag OR cancel_at), not ended, active/trialing, period end == row's → else release, count notCancelling
   sendPlanCancelEmail({ event: 'reminder', userId: row.userId, endsOn: row.periodEnd })
   sent → repo.completeCancelReminder(row.id, runner, row.periodEnd)          // the once-only marker
   not sent → repo.releaseCancelReminder(row.id, runner)                       // retried next day while still in the window
return counts (examined, sent, notCancelling, notSent, mismatch, deferred, deadlineHit)
```

- **Sent once:** the marker is `cancel_reminder_sent_for = current_period_end`. The claim only picks rows whose marker differs from their current period end. A Keep followed by a re-cancel for the same period end does not send a second reminder. A renewed plan cancelled in a later period gets its own reminder.
- **Only while still set to end:** checked at the claim (our row) **and** at the choke point (Stripe, fresh). Our row can lag the dashboard (P-7a C-2 / C-3), and Stripe is the authority.
- **Timing:** the daily run at 05:41 UTC picks plans ending within the next 3 days. So a reminder lands between 3 and 2 days before the end, early morning UTC (U-1). The copy says "ends on {date}", never "in 3 days", so it is true whichever run sends it.
- **Bounded retries:** a failed send is retried by later daily runs only while the end is still in the future, so at most about 3 attempts. That is the reason S-3 proposes no attempts column and no dead-letter.
- **Tenant isolation (`tenant-isolation-guard`):** a service-role, cross-user read by design. Every id comes from the claimed row. The Stripe answer is cross-checked against that row before any send. The email goes only to that row's own user.
- **Only the current key mode's rows**, because only those can be checked against Stripe fresh (S-12).

### 3.5 Durable record

There are three columns on `business_os_billing_accounts` and three server-only functions (§6). The repository gains `claimCancelReminders`, `completeCancelReminder` and `releaseCancelReminder`, each marked `⟨unscoped-by-design⟩` (cron, cross-user by row id, the `PluginConnectionRepository` precedent). Complete and release update by `id` **and** `cancel_reminder_claimed_by = runner`, using `{ count: 'exact' }` rather than `.select()` (the PostgREST UPDATE + select issue). A lost lease therefore writes nothing.

### 3.6 Audit

One new event, `BOS_PLAN_CANCEL_EMAIL` (S-9: one event or a SENT / NOT_SENT pair as invites do). It is appended at **DELETE's own anchor** in `lib/audit/events.ts` and `lib/audit/eventAudience.ts`, right after `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL`. Severity `info` for sent, `warning` for not sent. Compliance `SOC2`, audience `bos`. Entity `business_os_billing_account`, id = the account. Details: `email` (`cancelled` / `ended_now` / `kept` / `reminder`), `outcome`, `reason`, `provider`, `language`, `languageSource`, `subscriptionId`, `periodEnd`, `livemode`, `actor` (`owner` from the routes, `system` from the cron), `correlationId`. Never an address, a name or the leave reason. The routes write it through `logAndFlush` (WC-7). The cron writes it non-blocking with `.catch`.

### 3.7 R-3 and the P-7a note

- **R-3:** P-7a.3 already points the admin at Settings → Plan. D4 proposes one added sentence to `R3_CLEARING`, so the admin knows why a cancelled plan still refuses: "A plan cancelled at the end of its period stays live until that date." That is a string only, plus the existing test's expectation (S-13: or leave it as is).
- **P-7a note (C-1):** one sentence in the plan-payments requirement §9.1 P-7a row, plus a Change History row: "SX-3 / D4 (2026-10-28): owner-initiated cancel and Keep send the "Plan cancelled" / "Plan kept" emails, and a reminder goes out about 3 days before a cancelled plan ends, behind `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` (off until Resend is confirmed). The portal cannot cancel (`subscription_cancel: false`)."

---

## 4. Copy (English drafts)

These are drafts for SA and the user (G-5). Hebrew and Spanish follow in the diff and the user reviews them. Every claim matches what the code does (C-9), and every number and date comes from `planEndingView` or the engine. The emails never say "free tier".

**Plan cancelled** — subject "Your plan is cancelled"
> You cancelled your plan. It stays on until **{endsAt}**, and you will not be charged again. Nothing is refunded for the current month.
> *(free_plan)* After that, your account moves to **{planName}** until **{until}**, with {credits} credits. Then it is read-only for {thenReadOnlyDays} days and paused from {thenPausedFrom}.
> *(back_to_plan)* After that, you go back to your **{planName}** free access, which runs until {until} *(or "with no end date" when `until` is null)*.
> Your data stays, and you can export it at any time.
> [Keep my plan] → Settings → Plan · Questions? notifications@agentspilot.ai

**Your plan has ended** (`ended_now`) — subject "Your plan has ended"
> Your plan ended today at your request, and you will not be charged again. Any unpaid invoice for it was cancelled. *(then the same "after that" paragraph, built from today, as the drawer's `now` mode)*

**Plan kept** — subject "Your plan continues"
> Your plan continues and renews on **{renewsOn}**. Nothing else changes.

**Reminder** — subject "Your plan ends on {endsAt}"
> Your plan ends on **{endsAt}**, as you asked. *(the same "after that" paragraph)* Changed your mind? [Keep my plan] before that date.

The subject carries a date only, never an address or a name (the transport logs subjects).

---

## 5. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `lib/business-os/billing/planCancelEmailsFlag.ts` | create | The switch (§3.1) |
| `lib/email/templates/plan-cancel.ts` | create | Four variants × en/he/es, RTL, `escapeHtml`, `wrapInBrandedTemplate` |
| `lib/business-os/billing/planCancelEmail.ts` | create | Composer (§3.2), pure orchestration over ports |
| `lib/business-os/billing/planCancelEmailDeps.ts` | create | Real wiring. The entitlements importer |
| `lib/business-os/billing/planCancelReminderPass.ts` (+ `…Deps.ts` if needed) | create | The reminder pass (§3.4) |
| `lib/business-os/billing/reconcilePasses.ts` | modify | Append the pass (the documented seam) |
| `app/api/cron/bos-billing-reconcile/route.ts` | modify (header comment only) | "NOT A QUEUE DRAIN" no longer holds for the new pass; say which pass claims |
| `lib/cron/bosCronJobs.ts` | modify | The pass's counters; the description mentions the reminder |
| `app/api/business-os/billing/plan/cancel/route.ts` | modify | Send after the audit flush (§3.3); header |
| `app/api/business-os/billing/plan/reactivate/route.ts` | modify | Same, for `kept` |
| `lib/repositories/BusinessOsBillingAccountRepository.ts` | modify | Three `⟨unscoped-by-design⟩` reminder methods |
| `supabase/migrations/20261099_business_os_plan_cancel_reminders.sql` | create **after SA approval and TL reservation** | §6 |
| `supabase/SQL Scripts/20261099_…_rollback.sql`, `scripts/precheck-plan-cancel-reminders.sql`, `scripts/check-plan-cancel-reminders-migration.sql` | create | Precedent of 20261098 |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts` | modify, **shared, add only at DELETE's anchor** | §3.6 |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | modify | `KNOWN_NON_GATE_IMPORTERS` entries (XC-19) |
| `lib/business-os/purge/adminDeletionRefusals.ts` (+ its test) | modify (if S-13 = add) | R-3 sentence |
| `docs/FEATURE_FLAGS.md` | modify, **shared, add only at DELETE's anchor** | Switch row |
| `docs/requirements/BUSINESS_OS_PLAN_PAYMENTS_REQUIREMENT.md` | modify | P-7a note (C-1) + Change History |
| `docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md`, `docs/workplans/BUSINESS_OS_ACCOUNT_DELETION_PLAN.md` | modified in this step | BQ-36 answer (§9 line, plan §1/§4). §11 and the dated review records untouched |
| tests (see §8) | create | |

**Shared files (coordinator, 2026-10-28)**

| File | D4's touch |
|---|---|
| `lib/notifications/emailTransport.ts` | **None.** D4 only calls `sendEmail` and `platformSenderAddress`. `SendEmailParams` is unchanged. EXPORT adds `idempotencyKey` in MX-3. D4 does not depend on it, because "sent once" rests on our own row (S-10) |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts` | Append after `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL` (DELETE's anchor). Whoever lands second merges by hand |
| `vercel.json` | **None** (an existing cron is reused) |
| `docs/FEATURE_FLAGS.md` | One row at DELETE's anchor |
| `lib/business-os/entitlements/__tests__/enforcementPoints.test.ts` | Add-only entries |
| `lib/repositories/BusinessOsBillingAccountRepository.ts`, `bos-billing-reconcile` | Plan-payments files. D4 adds methods and a pass through the documented seam. Coordination row needed (TL) |

**`console.*` in touched files:** none in any code file listed. `adminDeletionRefusals.ts` matches twice on the words "admin console" inside strings. Those are not calls. `docs/FEATURE_FLAGS.md` mentions `console.` in prose (a doc, not code).

---

## 6. Migration

**Needed: yes**, one: **20261100** (`supabase/migrations/20261100_business_os_plan_cancel_reminders.sql`), reserved for D4b. 20261099 went to `20261099_business_os_first_plan_payments_view.sql` on main; 20261100 was re-checked free on fresh `origin/main` just before the file was written. (This section first proposed 20261099; the text below is the original sketch, corrected where DR-3 overturned it.)

Sketch (one transaction, pre-guard and post-condition, `lock_timeout`, as 20261098):

- `ALTER TABLE public.business_os_billing_accounts ADD COLUMN cancel_reminder_sent_for timestamptz NULL, ADD COLUMN cancel_reminder_claimed_by uuid NULL, ADD COLUMN cancel_reminder_claimed_at timestamptz NULL` and a CHECK that the claim pair is both set or both null.
- A partial index on `(current_period_end) WHERE cancel_at_period_end AND ended_at IS NULL`.
- `claim_bos_plan_cancel_reminders(p_runner uuid, p_livemode boolean, p_window_seconds int, p_lease_seconds int, p_batch int)`: `UPDATE … SET claimed_by, claimed_at = now() WHERE id IN (SELECT … WHERE livemode = p_livemode AND cancel_at_period_end AND ended_at IS NULL AND subscription_status IN ('active','trialing') AND user_id IS NOT NULL AND stripe_subscription_id IS NOT NULL AND current_period_end > now() AND current_period_end <= now() + window AND cancel_reminder_sent_for IS DISTINCT FROM current_period_end AND (claimed_at IS NULL OR claimed_at < now() - lease) ORDER BY current_period_end LIMIT p_batch FOR UPDATE SKIP LOCKED) RETURNING id, user_id, stripe_subscription_id, stripe_customer_id, current_period_end, livemode`. `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT EXECUTE … TO service_role`.
- Complete and release are plain repository updates (§3.5), or two small functions if SA prefers (S-3).
- No FK, no RLS or policy change (the table stays server-write-only). **One grant change (DR-3):** `GRANT UPDATE (cancel_reminder_sent_for, cancel_reminder_claimed_by, cancel_reminder_claimed_at) ON TABLE public.business_os_billing_accounts TO service_role`, and nothing else. The table has column-level UPDATE grants (20261025), so without it the repository writes are refused with 42501.
- **No cleanup regeneration** (to be confirmed by SA, S-2). The test-account cleanup removes the billing row whole. The anonymise mode keeps the billing row, but the new columns hold only timestamps and a runner uuid (no personal data). No purge descriptor change, because the table is already classified.
- SQL editor hazards: no word "into" in any string or comment. LF line endings in the pasted body (the CRLF md5 mismatch of 96).
- Manual prod gate: apply **before** the merge deploy, and this order is **required** (QA B-1). The D4b code writes the three columns on every customer swap (`replaceCustomer`, `attachTestClockCustomer`, R-C), whatever the switch says. Without the columns PostgREST refuses the whole update (PGRST204), so plan checkout for an owner whose Stripe customer is gone, and the admin test-clock attach, would fail.

**Apply runbook for 20261100 (SA code review F-2).** Run each script in the Supabase SQL editor, in this order:

1. **Pre-check:** `scripts/precheck-plan-cancel-reminders.sql` (read-only). Every row must say `ok`. Any `FAIL` stops the apply: paste the output back to TL and apply nothing.
2. **Apply** `supabase/migrations/20261100_business_os_plan_cancel_reminders.sql` **BEFORE the D4b merge deploy**. It is one transaction; a failed pre-guard or post-condition applies nothing.
3. **Checker:** `scripts/check-plan-cancel-reminders-migration.sql` (read-only). Rows 1–11 must say `ok` (row 12 is information only). Any `FAIL`: roll back in the same sitting with step 4, and paste the output back to TL.
4. **Rollback**, only when needed: `supabase/SQL Scripts/20261100_business_os_plan_cancel_reminders_rollback.sql`. Run it only **after the D4b code is reverted and deployed**. The switch being off is **not** enough (QA B-1: the customer swaps write the three columns whatever the switch says). It refuses while a reminder run holds a lease younger than 10 minutes.

All four files are LF and `.gitattributes` keeps them LF on every checkout (F-1). After 20261100 the historical 20261025 checker's "21 columns" no longer holds (DR-13).

---

## 7. Task list

- [ ] **T-0** (TL, not Dev) Reserve 20261099 in the coordination file; add the D4 shared-items row (billing repository + reconcile seam, events anchor).
- [x] **T-1** ✅ (D4a) Switch `planCancelEmailsFlag.ts` + test + `FEATURE_FLAGS.md` row + `lib/admin/environment/catalogue.ts` entry with its reader in `catalogue.test.ts`.
- [x] **T-2** ✅ (D4a) Template `plan-cancel.ts`: three variants (cancelled / ended_now / kept) × en/he/es, RTL, escaping. The reminder variant is D4b's. Hebrew and Spanish drafts for G-5.
- [x] **T-3** ✅ (D4a) Composer `planCancelEmail.ts` + deps. Recipient, language, timezone, view, deadline, fails closed. Audit entry builder.
- [x] **T-4** ✅ (D4a) Routes: cancel (`cancelled` / `ended_now`) and reactivate (`kept`), after the audit flush, only on a real change, switch-gated. Headers updated.
- [x] **T-5** ✅ (D4b) Migration **20261100** (20261099 was taken on main by the first-plan-payments view) + rollback + pre-check + checker + migration text test.
- [x] **T-6** ✅ (D4b) Repository: `claimCancelReminders`, `completeCancelReminder`, `releaseCancelReminder` (`⟨unscoped-by-design⟩`), `markCancelReminderCovered` (user-scoped, R-D); R-C clears on both customer swaps; tests.
- [x] **T-7** ✅ (D4b, under R-A) `planCancelReminderPass` + deps on its OWN cron route `/api/cron/bos-plan-cancel-reminders` (not `RECONCILE_PASSES`), `vercel.json` `"53 5 * * *"`, one `bosCronJobs.ts` entry, the reminder template variant, R-D wiring.
- [x] **T-8** ✅ (D4a) Audit pair `BOS_PLAN_CANCEL_EMAIL_SENT` / `_NOT_SENT` at DELETE's anchor (events + audience + descriptions, S-9).
- [x] **T-9** ✅ (D4a) Entitlements registrations (2 `KNOWN_NON_GATE_IMPORTERS` entries, S-16); `npm run test:bos-entitlements` 326 suites / 9,729 tests green.
- [x] **T-10** ✅ (D4a) R-3: unchanged per S-13 (met by P-7a.3). P-7a note (C-1) added to the plan-payments requirement §9.1 P-7a row + Change History.
- [ ] **T-11** Typecheck filtered to touched files (checking it did not OOM), `npm run build`, the touched Jest suites, `npm run test:bos-llm` not needed (no LLM). **D4a (2026-10-28):** `npx tsc --noEmit` ran to completion (8 GB heap, 1,864 pre-existing errors, no OOM), 0 errors in touched files; `npm run lint:hooks` clean; touched suites 129 / 5,833 green; `npm run build` not run by Dev (RM's ship drill step 1).

**D4a build notes (2026-10-28, Dev).**

- **DR-1 re-verify on `abe9fd64`** (fast-forward from `415f726e`, P-8b.2 #559 merged): the §1 rows D4a relies on are unchanged: engine result shape, both routes (switch 404 first, Zod `.strict()`, `logAndFlush`, 0 `console.*`), `readPlanEndingView`, `formatAccountDay`, `safeTimezone`, `platformSenderAddress`, `R3_CLEARING`, portal `subscription_cancel: false`. The rows that moved (`RECONCILE_PASSES` now `[boostReconcilePass, planReconcilePass]`, `bosCronJobs.ts`, the billing repository and its test, 20261099 reserved) are D4b's and are taken up by the D4b addendum.
- **Guard allow-lists touched (add-only, test files):** `authAccountRepository.callers.guard.test.ts` (R-4) now lists `planCancelEmailDeps.ts` (reads the SESSION user's own address) and `route.d4a.test.ts`; `BusinessOsBillingAccountRepository.test.ts` › "only the listed files name the repository" lists `route.d4a.test.ts` (it fakes the repository module, as the other cancel route tests do). PLAN PAYMENTS sign-off on the second one. No repository code changed.
- **Switch shape:** the reader is pure (`parseBooleanFlag`, as `planPricesFlag.ts`), so the catalogue's reader-parity test holds; the "also refuses when `RESEND_FROM_EMAIL` is unset" rule lives in the composer (`sender_not_configured`, audited, `error` + `alert: true`).
- **Copy:** the "after that" sentences, the no-refund line and the Keep button reuse the drawer's own he/es/en strings verbatim (pinned to the dictionaries by the template test, DR-11). The `loses` list is not in the email.

**D4b build notes (2026-10-29, Dev)** on `feature/plan-cancel-reminder-d4b` from `origin/main` `32effb8d` (D4a #566 and EXPORT's MX-3a #565 merged). Nothing committed, pushed or applied.

- **Migration number: 20261100.** Main took 20261099 for `20261099_business_os_first_plan_payments_view.sql`. Re-checked free on fresh `origin/main` just before writing. Wherever §6, DR-3 or DR-4 say 20261099 for D4b, read 20261100.
- **T-5 files:**
  - `supabase/migrations/20261100_business_os_plan_cancel_reminders.sql`;
  - `supabase/SQL Scripts/20261100_business_os_plan_cancel_reminders_rollback.sql`;
  - `scripts/precheck-plan-cancel-reminders.sql`;
  - `scripts/check-plan-cancel-reminders-migration.sql`;
  - `supabase/migrations/__tests__/business-os-plan-cancel-reminders.migration.test.ts`.
- **What the migration does:**
  - One transaction with `lock_timeout`. A pre-guard refuses unless the table still has its 21 columns and nothing D4b adds exists yet. A post-condition counts 24 columns (DR-13), checks the types, the pair CHECK, the index, the definer function, its grants and the column grants, and that browser roles hold nothing.
  - Three nullable columns, plus the pair CHECK.
  - A partial index on `current_period_end WHERE cancel_at_period_end AND ended_at IS NULL`.
  - `claim_bos_plan_cancel_reminders(p_runner, p_livemode, p_window_seconds, p_lease_seconds, p_batch)`. It is plpgsql, `SECURITY DEFINER` and `SET search_path = public`. It validates its inputs (batch 1 to 100, window up to 10 days, lease up to 1 h). It locks with FOR UPDATE SKIP LOCKED. The lease reclaim is folded in (S-3 a). DR-2's `NOT EXISTS` on `business_os_account_closures` uses the statuses `('requesting','pending','grace','locked')`. It returns `reminder_*` columns.
  - The function is revoked from PUBLIC, anon and authenticated (schema-qualified, after the CREATE) and granted EXECUTE to service_role.
  - DR-3: `GRANT UPDATE` on the 3 columns to service_role and nothing else.
  - No `updated_at` anywhere.
- **Rollback, scripts and editor safety:**
  - The rollback locks the table and refuses while a lease younger than 10 minutes exists.
  - The word that breaks the SQL editor appears in none of the 4 files, and all 4 are LF. The text test pins both.
  - `migrationNumberUnique` and `security-definer-surface` are green.
  - Note (DR-13): the historical 20261025 checker's "21 columns" (B2) no longer holds after 20261100. The new checker says so in its header.
- **T-6 (repository, add-only apart from R-C):**
  - `claimCancelReminders`: the one `.rpc(` in the file. It maps each row strictly to canonical ISO and refuses a row in the other mode or more rows than the batch.
  - `completeCancelReminder` and `releaseCancelReminder` are ⟨unscoped-by-design⟩: a CAS on `id` + `cancel_reminder_claimed_by` + `user_id` + `livemode`, with `{ count: 'exact' }` and no `.select()` or `.or()`.
  - `markCancelReminderCovered` is user-scoped: a CAS on `user_id` + `livemode` + `stripe_subscription_id` + `current_period_end` + `cancel_at_period_end = true`.
  - R-C: `replaceCustomer` and `attachTestClockCustomer` also NULL the 3 columns.
  - Unit tests: `BusinessOsBillingAccountRepository.d4b.test.ts`.
- **T-6, edits to the PLAN PAYMENTS test (sign-off owed):**
  - The pinned-set tests now read the 20261025 grant **plus** the 20261100 grant (`grantedUpdateColumns()`), and both explicit swap payloads gain the 3 keys.
  - The source-guard counts move: updates 8→11, `.from(` 12→15, `user_id` 9→12, `livemode` 11→14, `stripe_subscription_id` 4→5. "No rpc" becomes exactly one rpc, the claim. The 3 new writes join the no-select loop.
  - DR-4: the SQL-updaters list adds 20261100, and a new test pins that its one UPDATE sits inside `claim_bos_plan_cancel_reminders` and that its SET names only `cancel_reminder_claimed_by` and `cancel_reminder_claimed_at`.
  - "Only the listed files name the repository" adds `planCancelEmailDeps.ts`, `planCancelReminderPassDeps.ts` and the d4b test, sorted.
- **T-7 (R-A: its own cron):**
  - `app/api/cron/bos-plan-cancel-reminders/route.ts` is the reconcile shell: fail-closed `CRON_SECRET`, `runtime = 'nodejs'`, `maxDuration = 60`, a 45 s deadline and `withCronRunRecord`.
  - The run is `lib/business-os/billing/planCancelReminderPass.ts`, pure over ports. Its wiring is `planCancelReminderPassDeps.ts`.
  - Policy: window 3 d, lease 90 s, batch 25, no row started with less than 8 s left. A test pins `LEASE_SECONDS > maxDuration`.
  - Only the current key mode is claimed. S-14: Stripe's `cancel_at ?? the one item's period end` must equal our row's end. C-4: the id, customer, mode and `bos_user_id` must match. S-5: no heal.
  - DR-5: `sent` or `unknown` completes the row; `not_sent` releases it.
  - R-B: it never throws, and a failed claim is counted and logged with `alert: true`.
  - Counts: `examined, sent, notSent, notCancelling, periodMismatch, mismatch, covered, deferred, deadlineHit, skipped`. A test pins the registry keys to the pass keys both ways, and the worst-case counts JSON under 1,024 bytes.
  - Registrations:
    - `vercel.json`: one appended entry, `"53 5 * * *"`;
    - `bosCronJobs.ts`: one appended entry, `drainsQueue: null`, `addedOn: '2026-10-29'` (RM: set it to the real merge day);
    - the job count is 22→23 in both cron tests, with no ordinal comments;
    - `reconcilePasses.ts`, the reconcile route and its counts are untouched.
- **Reminder email:**
  - The template has a `reminder` variant in en/he/es. Its subject is "Your plan ends on {date}" and its lead "Your plan ends on {date}." The "after that" paragraph and "data kept" line are the cancelled email's, from the view. Then: "Want to keep it? Choose "{button}" before {date}.", where `{button}` is filled with the Keep button's own label. There is no "as you asked" and no "Changed your mind?" (DR-9). The he/es wording goes to the user for G-5.
  - The composer gained `actor` (default `owner`) and `idempotencyKey`. The pass sends `plan-cancel-reminder:{billingRowId}:{periodEnd}`, which is ids and a date (82 chars) and under the transport's 1..256 limit. `emailTransport.ts` is untouched.
  - Audit: the D4a SENT/NOT_SENT pair, `email: 'reminder'`, `actor: 'system'`, written non-blocking with `.catch`, plus one bounded flush at the end of the run (`flushPlanCancelReminderAudit`).
- **R-D wiring:**
  - `notifyPlanCancelEmail` calls `coverReminderAfterCancelEmail` after the send. It marks only for `cancelled` with an outcome of `sent` or `unknown` and an end at most 3 days ahead. That window is the same constant the claim uses (`PLAN_CANCEL_REMINDER_WINDOW_SECONDS`).
  - A failed mark is a `warn` and never changes the response.
  - Tests: in the window → marked; outside → not; `not_sent` / `skipped` → not.
- **Where the reminder's email wiring lives:** `planCancelEmailDeps.ts` (`buildPlanCancelReminderEmailDeps`), sharing D4a's lookups. That means:
  - no new `KNOWN_NON_GATE_IMPORTERS` entry (its `readPlanEndingView` `why` text was extended);
  - no new auth-callers entry (its comment was extended);
  - one routerPlacement entry change: `planCancelEmailDeps.ts` gains `BILLING_ACCOUNTS`, and `planCancelReminderPassDeps.ts: [BILLING_ACCOUNTS]` is new. The D4a literals were hoisted into `AUTH_ACCOUNTS`, `BUSINESS_PROFILES` and `USER_PREFERENCES` (PLAN PAYMENTS nit).
  - The view's account is the claimed row's `user_id`. That column is the account, and the repository maps it to `accountId`. The seam is the identity today.
- **Shared doc:** `docs/FEATURE_FLAGS.md` gains a paragraph saying the switch now also gates the reminder cron, plus a Change History row. The admin catalogue is unchanged (no new variable).
- **D4a test touched:** `planCancelEmail.qa.test.ts`'s "only these import the email path" list adds the two D4b files. The engine still imports none.
- **Verification:**
  - Touched and requested suites: 400 / 14,081 green.
  - `npm run test:bos-entitlements`: 331 / 9,881 green.
  - `npm run lint:hooks`: clean.
  - `tsc --noEmit` (8 GB heap): ran to completion with no OOM. 1,920 diagnostics, 0 in any touched file.
  - Full `npx jest`: 1,875 suites passed, 25 failed, 8 skipped, out of 1,908. Tests: 48,151 passed, 146 failed, 65 skipped. The 25 failing suites (V6, pilot, orchestration, CRM contact-drawer guards, onboarding, throttling and similar) name no file this slice touches.

---

## 8. Test plan

All pure Jest with fakes and small fixtures, inside the existing job: **no added CI time** (no new workflow, no database in CI).

| # | Test | Proves |
|---|---|---|
| 1 | `planCancelEmailsFlag.test.ts` | Off by default; `true`/`1` on; junk off |
| 2 | `plan-cancel.test.ts` (template) | Each variant × each language renders; `he` is `dir="rtl"`; dates and names escaped; the subject has no address; `unknown` view drops the "after that" paragraph; `back_to_plan` with `until: null` reads "no end date"; never "free tier" |
| 3 | `planCancelEmail.test.ts` (composer) | Switch off → no lookup, no send. Sender unset → `sender_not_configured`, no send. Recipient missing or lookup failed → not sent. Language from profile before preference. Timezone null → UTC. View failure → email without the paragraph. Deadline → `unknown`. Never throws. Logs carry no address (log capture) |
| 4 | Cancel route tests (extend `route.test.ts`) | `cancelled` → one `cancelled` send. `immediate` → `ended_now`. `unchanged` / refusal / `outcomeUnknown` → no send. Switch off → no send. Email failure → the response is unchanged (200). **Auth failure (401) and invalid input (400) → no send** (all-slices AC) |
| 5 | Reactivate route tests | `reactivated` → one `kept` send; `unchanged` → none; 401 / 400 → none |
| 6 | `planCancelReminderPass.test.ts` | Switch off → no claim. **Two concurrent runs never send to the same row** (fake RPC modelling SKIP LOCKED). Sent → completed with that period end and never re-claimed. Stripe says not cancelling / ended / other period end → released, not sent, not marked. C-4 mismatch → released + alert. Send failure → released (retried). Deadline → stops starting rows. Counters flattened under `cancelreminder…` |
| 7 | Repository tests | Complete/release scoped to `id` + `claimed_by`; a lost lease writes 0 rows; RPC args |
| 8 | Migration text test (`supabase/migrations/__tests__/…`) | Columns, CHECK, partial index, `FOR UPDATE SKIP LOCKED`, `SECURITY DEFINER`, `search_path`, REVOKE from anon/authenticated, grant to service_role; no "into" in strings |
| 9 | `oneDontRenewPath.guard.test.ts` (unchanged, must stay green) | D4 never calls the engine-only Stripe methods; the reminder pass only reads |
| 10 | `npm run test:bos-entitlements` | Registrations exact |
| 11 | Existing `adminDeletionRefusals` tests | R-3 text (if changed) |

**QA manual critical path (recorded in §13):** on the sandbox with the switch **on** locally (Resend test key or the dev console preview): cancel → "Plan cancelled" with the same dates as the drawer; Keep → "Plan kept"; move a test-clock subscription to 2 days before its end and trigger the cron route locally → one reminder, and a second trigger sends none. Then press Keep and trigger → none. One Hebrew send to check RTL. With the switch **off**: cancel and Keep send nothing.

---

## 9. Effort

| Task | Days |
|---|---|
| T-1 switch | 0.1 |
| T-2 template (4 × 3 languages) | 0.45 |
| T-3 composer + deps | 0.4 |
| T-4 routes + tests | 0.2 |
| T-5 migration + scripts + test | 0.35 |
| T-6 repository | 0.15 |
| T-7 reminder pass + tests | 0.35 |
| T-8 – T-11 audit, registrations, R-3, P-7a note, build | 0.2 |
| **Total** | **≈ 2.2 d** |

This is **over the 1.5 d budget** but **under the 2.5 d cap**. The difference is the once-only record for the reminder: the requirement's §6.2 row expected no migration, and a durable claim needs columns, a claim function, scripts and a manual prod gate. If SA prefers, S-1 offers a split into two PRs, each well under the cap.

---

## 10. Open questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| **S-1** | One PR, or split? | One PR (≈ 2.2 d). Alternative: **D4a** cancelled / kept / ended-now emails + switch + R-3 + P-7a note, no migration (≈ 1.1 d), then **D4b** reminder + migration (≈ 1.1 d). The split lets D4a merge without a manual prod gate |
| **S-2** | Where the "sent once" record lives | Three columns on `business_os_billing_accounts` (§6). Rejected: a new table (purge descriptor + cleanup regeneration under the S-1 lock), `email_sends` (needs `contact_id`), audit (not a claim). Please confirm no cleanup regeneration is needed (row removed whole; anonymise keeps it, but the columns hold no personal data) and that no function-inventory or drift test must list the new function |
| **S-3** | Deviations from the durable-queue-drain skill | (a) lease reclaim folded into the claim predicate (`claimed_at < now() - 90 s`) instead of a separate reaper RPC; (b) no `attempts` / dead-letter, because the 3-day window bounds retries to about 3 daily runs; (c) complete / release as repository updates scoped by `claimed_by`, not RPCs. Acceptable? |
| **S-4** | Reuse `bos-billing-reconcile` (daily 05:41 UTC) or wait for DL-3's hourly :50 lifecycle cron? | Reuse it now: no new cron, no `vercel.json` change, the documented seam. The cron header's "NOT A QUEUE DRAIN" is amended to say the reminder pass claims its rows |
| **S-5** | At the choke point, on "no longer cancelling", heal our row from Stripe? | No. Release only. The webhook converges, and the pass stays a reader of billing state |
| **S-6** | Triggers for cancelled / kept | Routes only, on `cancelled` / `reactivated`. Not from the engine (D6 calls it), not for `unchanged` / refusals / `outcomeUnknown`, not for dashboard or webhook-mirrored changes |
| **S-7** | SA-9 sources | Recipient = live auth email (`findUserIdentity`); language = `resolveUserLanguage` (profile, then preference) although the my-plan route uses the preference only; timezone = `user_preferences.timezone`, UTC when null. Confirm, or rule that the email follows my-plan's language source |
| **S-8** | Import `formatAccountDay` from `components/business-os/settings/planUpgradeCopy.ts` in a server template | Yes, as-is (precedent: `invite-accepted.ts` imports `INVITE_FRIENDS_COPY` from components). Or move it to `lib/` in this PR |
| **S-9** | Audit shape | One event `BOS_PLAN_CANCEL_EMAIL` with `outcome` in the details, or a SENT / NOT_SENT pair like the invites |
| **S-10** | No Resend idempotency key | Accept. The once-only record is our row. The residual risk is a crash between Resend accepting the message and the complete write: one duplicate, after which the lease expires. The same for two tabs pressing cancel at once. When EXPORT's `idempotencyKey` lands, a follow-up may pass `plan-cancel-reminder:{billingRowId}:{periodEnd}` |
| **S-11** | The route awaits the send (≤ 4 s deadline) after the audit flush | Yes, awaited, because an un-awaited promise can be frozen with the instance (the invites' reasoning). Worst case adds about 4 s to a cancel press |
| **S-12** | Only the current Stripe key mode's rows are reminded | Yes, because only those can be checked against Stripe fresh |
| **S-13** | R-3 text | P-7a.3 already did the main change. Add "A plan cancelled at the end of its period stays live until that date.", or leave it unchanged and record SX-3's R-3 item as met by P-7a.3 |
| **S-14** | Reminder date | Our row's `current_period_end`, required to equal Stripe's fresh period end (else skip). The email says "ends on {date}", never "in 3 days" |
| **S-15** | Switch | `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED`, server-only, default off, gating all three emails. Plus the existing fail-closed `platformSenderAddress()` |
| **S-16** | `KNOWN_NON_GATE_IMPORTERS` | Two entries (`planCancelEmailDeps.ts`: `readPlanEndingView`, `resolveAccountId`; `planCancelEmail.ts`: type `PlanEndingView`), or have the composer re-declare a structural type so only the deps file imports the module |

---

## 11. Questions for the user (business only)

| # | Question | Suggestion |
|---|---|---|
| **U-1** | The reminder goes out once a day at 05:41 UTC (morning in Israel and Europe, night in the Americas), so it arrives between 3 and 2 days before the plan ends. Is that fine? | Yes. An hourly send at a local hour is possible later with the deletion job (DL-3) |
| **U-2** | When a plan is cancelled during a failed payment, it ends at once (P-7a.4). Should the owner also get an email ("Your plan has ended")? | Yes, the same template with "ended today" |

The he/es wording of all four emails comes to the user with the diff (G-5), as for every slice.

---

## 12. SA Review Notes

**Reviewed by SA — 2026-10-28** (code read on `415f726e` and on fresh `origin/main` `abe9fd64`)
**Status:** ⚠️ Approved with changes DR-1 to DR-14. Build as **two PRs** (S-1). Neither PR is fundamentally wrong, so this is not an escalation.

### What SA checked against the tree

| Claim in §1 / §3 / §6 | Result |
|---|---|
| Engine result shape: `cancelled` (+ `mode: 'immediate'`), `reactivated`, `unchanged`, refusals, `outcomeUnknown` | ✅ `planSubscriptionManage.ts` L249-258. **But** `endsOn` / `renewsOn` are `string \| null`, and the immediate end carries `invoicesLeftOpen` (`number \| null`). See DR-6 and DR-7 |
| Routes: switch 404 first, session user, Zod `.strict()`, `logAndFlush`, 0 `console.*` | ✅ cancel + reactivate |
| `readPlanEndingView({ accountId, endsAt, locale })`, kinds `back_to_plan` / `free_plan` / `unknown` | ✅ `planEndingView.ts` L61, L189 |
| `formatAccountDay` is plain TS; the drawer formats with it | ✅. The drawer's zone is `LanguageContext.timezone` = `user_preferences.timezone` through `safeTimezone`, else UTC. `formatAccountDay` itself does **not** sanitise the zone (DR-8) |
| Transport: `platformSenderAddress()`, `redactRecipientInLogs`, `.invalid` refused, no `idempotencyKey` | ✅ |
| `R3_CLEARING` already re-worded by P-7a.3; the 2 `console` hits are strings | ✅ |
| Portal `subscription_cancel: false` | ✅ `portalConfiguration.ts` L65 |
| `bos-billing-reconcile` seam, `PASS_NAME` / `COUNT_KEY` rules | ✅. **But on `origin/main` the seam has moved**: P-8b.2 (#559) appended `planReconcilePass` and also changed `bosCronJobs.ts`, `BusinessOsBillingAccountRepository.ts` and its test (DR-1) |
| Migration 20261099 "not yet reserved" | ❌ Out of date: the coordination file reserved it for D4 on 2026-10-28 (next free is 20261100) |
| "No grant change on the table" (§6) | ❌ **Wrong.** `business_os_billing_accounts` has **column-level** UPDATE grants: 20261025 L88 grants exactly 17 columns to `service_role`. A plain repository update of the new columns is refused with 42501 unless the migration grants them (DR-3) |
| No other test is affected by an UPDATE of the billing table in SQL | ❌ `BusinessOsBillingAccountRepository.test.ts` › "in SQL, only the apply function (20261027, replaced by 20261028) updates the billing table" scans every migration. The claim function's `UPDATE public.business_os_billing_accounts` turns it red (DR-4) |
| Cleanup regeneration / function inventory / drift (S-2) | ✅ None needed (S-2 ruling below) |
| D6 will not trigger the plan-cancel emails | ✅ for cancelled / kept (they are sent from the routes, not the engine). ❌ **for the reminder**: the reminder pass keys on row state, and D6's deletion request sets `cancel_at_period_end` through the same engine (DR-2) |

### Rulings S-1 to S-16

| # | Ruling |
|---|---|
| **S-1** | **Split.** **D4a** (no migration): switch, template, composer + deps, `cancelled` / `ended_now` / `kept` from the routes, audit pair, registrations, P-7a note. **D4b** (20261099, manual prod gate): migration, repository methods, reminder pass, cron counters. D4b branches from `main` **after** D4a merges, never stacked. Reasons: the DRs push one PR to about 2.5 d, which is the cap. The split also keeps every PLAN PAYMENTS-owned change (repository, reconcile seam, their tests) in one PR they can review. D4a can ship on CI alone, because the switch stays off |
| **S-2** | **Three columns on `business_os_billing_accounts`: approved.** Verified that **no cleanup regeneration** is needed. The descriptor (`descriptors.ts` L1500) and the generator handle the table as a whole (step B delete, plus an explicit anonymise null-scrub list of 2 columns). The new columns hold no personal data and have no FK, and `FUNCTION_REQUIRED_TABLES` lists tables, not columns. No function inventory names claim functions. The tests the new file does meet: `migrationNumberUnique.guard` (99 is unique, fine), `security-definer-surface.guard` (R-a to R-d: one schema-qualified `REVOKE … FROM PUBLIC, anon, authenticated` after the CREATE, plus `SET search_path`; the plan already matches) and the SQL-updaters test (DR-4) |
| **S-3** | (a) **Approved.** The lease reclaim folded into the claim predicate is equivalent to the reaper, because a 90 s lease is longer than `maxDuration` 60 s, so a row claimed longer ago than that is provably dead. Pin `LEASE_SECONDS > maxDuration` in a test. (b) **Approved with a condition.** No `attempts` and no dead-letter, because the window bounds retries. But a send whose outcome is `unknown` (the deadline hit, or the answer was lost) **completes** the row and is not released, so the reminder goes **at most once** (DR-5). (c) **Approved.** Plain repository updates, scoped by `id` + `cancel_reminder_claimed_by` **+ `user_id` + `livemode`** (tenant-isolation-guard Step 6), using `{ count: 'exact' }` with no `.select()`. They need the column grant (DR-3), and they do not write `updated_at`: that column means "billing state changed", and the reminder bookkeeping is not a billing change |
| **S-4** | **Reuse `bos-billing-reconcile`.** Append the pass **after** `planReconcilePass` (DR-1). Because it runs last, it gets what is left of the 45 s budget. So: do not claim at all when less than 10 s remain (count `starved`); do not start a row when less than 8 s remain; release rows that were claimed but never started. Batch 10, not 25. Update the route header's "NOT A QUEUE DRAIN" paragraph so it names the one pass that does claim |
| **S-5** | **No heal. Release only.** The pass writes only its own three columns. Plan payments' Step B already flags rows that disagree with Stripe |
| **S-6** | **Approved.** Send from the routes only, and only on `cancelled` / `reactivated`. Never from the engine. No emails for dashboard or webhook-mirrored changes. Add DR-2 for the reminder |
| **S-7** | **Approved as proposed.** Recipient: `findUserIdentity(userId)`. Language: `resolveUserLanguage` (SA-9, the server email standard). Timezone: `user_preferences.timezone` through `safeTimezone`, else UTC (DR-8). A language mismatch with the drawer changes the wording, never the day. Note it in the composer header |
| **S-8** | **Import `formatAccountDay` as it is** (precedent: `invite-accepted.ts`). Do not move it in this slice. Wrap the zone in `safeTimezone` before the call (DR-8) |
| **S-9** | **A pair, like the invites**: `BOS_PLAN_CANCEL_EMAIL_SENT` / `BOS_PLAN_CANCEL_EMAIL_NOT_SENT`. Both `info` (invite N-1: a skipped courtesy email is not an operator alert), `SOC2`, audience `bos`, at DELETE's anchor. No per-call severity override. `sender_not_configured` while the switch is on is the operator signal, and it goes out as a Pino `error` with `alert: true`, not as audit severity. The details stay as §3.6 lists them |
| **S-10** | **Accepted.** Our row is the once-only record. The residual duplicate is a crash between Resend accepting the message and the complete write, plus two tabs pressing at the same instant. Follow-up only: when EXPORT's `idempotencyKey` lands, pass `plan-cancel-reminder:{billingRowId}:{periodEnd}`. `emailTransport.ts` is not changed in D4 |
| **S-11** | **Approved.** Awaited, under one 4 s deadline, after the action's audit flush. The email-outcome audit is flushed too (bounded). The response never depends on the email, and the send sits inside its own guard so it can never turn a 200 into a 500 |
| **S-12** | **Approved.** Only rows in the current key mode |
| **S-13** | **Leave `R3_CLEARING` as it is.** It already ends "Deletion is possible once the subscription has ended", which is true and complete (C-9). Record SX-3's R-3 item as met by P-7a.3. Touch neither the file nor its test |
| **S-14** | **The date is Stripe's**, read fresh: `cancelAt ?? the item's current_period_end` (on `2025-10-29.clover` the period lives on the ITEM, SA V-8; require exactly one item). It must equal our row's `current_period_end`, or the row is released and `periodMismatch` is counted. The copy says "ends on {date}" |
| **S-15** | **Approved.** `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED`, server-only, default off, gating all three emails and the reminder claim. Plus the fail-closed `platformSenderAddress()`. Row in `docs/FEATURE_FLAGS.md` |
| **S-16** | **Two `KNOWN_NON_GATE_IMPORTERS` entries.** Import the `PlanEndingView` type and declare it. Do not re-declare it as a structural copy: a declared importer can be audited, a copy can drift. Symbols must match exactly. Run `npm run test:bos-entitlements` and report the result |

### Required changes (DR-*)

| # | PR | Change |
|---|---|---|
| **DR-1** | both | **Rebase onto current `origin/main`** (≥ `abe9fd64`, P-8b.2 #559) before T-6 / T-7, and re-verify §1. `RECONCILE_PASSES` is now `[boostReconcilePass, planReconcilePass]`. `bosCronJobs.ts` and the billing repository and its test changed. Update §1 "verified on" and the 20261099 row (reserved 2026-10-28) |
| **DR-2** | D4b | **The reminder must not go to an account with a pending deletion** (D6 calls the same engine; the deletion plan card has no "Keep my plan", and DL-3 sends its own reminders). Add `AND NOT EXISTS (SELECT 1 FROM public.business_os_account_closures c WHERE c.user_id = b.user_id AND c.status IN ('requesting','pending','grace','locked'))` to the claim. This is SQL only, so no new caller of `AccountClosureRepository`. Test it in the migration-text test, and record it in the D6 hand-over |
| **DR-3** | D4b | The migration grants `UPDATE (cancel_reminder_sent_for, cancel_reminder_claimed_by, cancel_reminder_claimed_at) … TO service_role`, and nothing else. §6 "no grant change on the table" is corrected. The checker verifies the grant |
| **DR-4** | D4b | Amend `BusinessOsBillingAccountRepository.test.ts` › "in SQL, only the apply function … updates the billing table", **add-only**: allow 20261099, and assert that its UPDATE is inside `claim_bos_plan_cancel_reminders` and that its SET names only the two claim columns. Add the new callers to "only the listed files name the repository". The `current_period_end` writer test must stay green. Plan payments signs off on both (coordination row) |
| **DR-5** | D4b | Outcome `sent` or `unknown` → complete. `not_sent` → release. Pin both in the pass test |
| **DR-6** | D4a | `endsOn` / `renewsOn` can be `null`. With no date, `cancelled` / `ended_now` / `kept` are not sent (`not_sent`, reason `no_date`). Never print an empty date |
| **DR-7** | D4a | C-9 on `ended_now`: write "Any unpaid invoice for it was cancelled" **only** when `invoicesLeftOpen === 0`. Otherwise leave the sentence out. Say "ended on {date}", not "today": the mail may be read later. Pass `invoicesLeftOpen` to the composer |
| **DR-8** | D4a | Timezone = `safeTimezone(findTimezone(userId))`, else UTC, exactly as the drawer does. An invalid stored zone otherwise makes `toLocaleDateString` throw. Test: the same view and zone give the same day string as the drawer's `formatAccountDay` |
| **DR-9** | D4a | Reminder copy: delete "as you asked" and "Changed your mind?". The claim also catches a flag set by an operator in the Stripe dashboard (the mirror writes it), so those words would be false (C-9). Use "Want to keep it? [Keep my plan] before {date}." Plan kept: delete "Nothing else changes" (the code does not check it) |
| **DR-10** | D4a | The support line is the value of `platformSenderAddress()` (`RESEND_FROM_EMAIL`, which BQ-3 made both sender and support address). No new constant and no literal |
| **DR-11** | D4a | The "after that" paragraph is built only from the view's fields: any `null` field (`credits`, `thenReadOnlyDays`, `thenPausedFrom`) drops its clause. Each language's wording is checked against the drawer's `settings.plan_cancel.changes.*` strings (SA-15: the configured rule, not a promise). The template test asserts "no clause with a null field" and "never 'free tier'" in en/he/es |
| **DR-12** | D4b | Pass counters: `examined, sent, notSent, notCancelling, periodMismatch, mismatch, closurePending` (when counted), `deferred, starved, skipped`. Add each to `bosCronJobs.ts` `counts`. `deferred` or `starved` > 0 gets a `warn` |
| **DR-13** | D4b | The migration does not touch `updated_at`, and the repository methods do not write it. The new checker counts 24 columns. Note in the D4b runbook that the historical 20261025 checker's "21 columns" (B2) no longer holds after 99 |
| **DR-14** | both | Correct the estimate in the plan §1 SX-3 row (≈ 2.1 d) to match this file, and write D4a / D4b as two rows |

### Things that need a user (business) decision

- **U-1** (05:41 UTC daily; lands 3 to 2 days before the end) and **U-2** (`ended_now` email): SA has no objection to the suggestions.
- **U-3 (new): a cancel less than 3 days before the end.** The next morning's reminder then follows the "Plan cancelled" email within a day. Suggestion: send only the cancel email in that case, since it already gives the date. If the user agrees, the cancel route marks `cancel_reminder_sent_for` through a user-scoped repository method when it sends `cancelled` for an end inside the window (D4b, about +0.1 d). If not, both emails go out and both are true.

### Approval

[x] Workplan approved with changes DR-1 to DR-14. Build D4a first; D4b after D4a merges, once DR-1 to DR-5 are in its plan. TL relays U-3 to the user.

### D4b addendum — SA, 2026-10-28 (after PLAN PAYMENTS' #559 findings)

**User answers (2026-10-28):** U-1 accepted: an early-morning UTC daily send (see R-A for the minute). U-2 yes: send the `ended_now` email. U-3: cancel email only. When the cancel happens inside the last 3 days before the end, no reminder goes out.

| # | Ruling |
|---|---|
| **R-A** (counts cap) | **Option (b): its own cron job.** It replaces S-4 and DR-12's prefixed counters. Measured: `bos_cron_runs.counts` has `CHECK octet_length(counts::text) <= 1024` (20261011 L345), and `bos-billing-reconcile` already sits at about 963 bytes worst case. **(c) is rejected:** the 2 short keys that would fit (about 18 bytes each with a 6-letter prefix) cannot show why a reminder did not go, and they leave R-B and the S-4 starvation in place. **(a) is rejected:** widening the CHECK on a shared platform table from a DELETE migration changes every job's contract, and needs its own SA review. **(b):** route `/api/cron/bos-plan-cancel-reminders`, a copy of `bos-billing-reconcile`'s shell (fail-closed `CRON_SECRET`, `runtime = 'nodejs'`, `maxDuration = 60`, a 45 s deadline, `withCronRunRecord`). One `bosCronJobs.ts` entry with `drainsQueue: null`. One **append-only** `vercel.json` entry, `"53 5 * * *"` (05:53 UTC: a free minute, not divisible by 5, 12 minutes after reconcile so two Stripe sweeps never overlap; U-1's "early morning UTC" still holds, and TL tells the user about the minute). Coordination row for `vercel.json` (shared with EXPORT). Batch back to 25. Unprefixed counts `examined, sent, notSent, notCancelling, periodMismatch, mismatch, covered, deferred, deadlineHit, skipped`: worst case with 5-digit values is about 170 bytes, pinned by a test that asserts the job's worst-case counts JSON is under 1,024 bytes. No change to `reconcilePasses.ts`, the reconcile route or its counts. No added CI time (pure Jest) |
| **R-B** (window coupling) | Mostly moot under R-A: the reminder no longer writes `passesFailed` on the reconcile run record. The rule still holds for its own route: the reminder run never throws. Every port call is guarded per row, and a failed claim RPC is counted and logged with `alert: true`. A defect throw is caught by the route, which marks the run `failed` |
| **R-C** (`replaceCustomer` / `attachTestClockCustomer`) | **Yes, the three columns are subscription-scoped.** `cancel_reminder_sent_for` describes one subscription's period end, and a lease is only meaningful for the subscription it was claimed for. Both methods clear all three (`NULL`, which satisfies the pair CHECK). Update the pinned-set test against the migration text and the attach payload. A runner whose lease is cleared this way then completes nothing (0 rows, by `claimed_by`), and the new subscription is not cancelling, so this is harmless. The DR-3 grant covers these writes. Every write is a CAS with `{ count: 'exact' }`, never UPDATE + `.or()` + `.select()`. Each file (tests and type-only imports included) is added, sorted, to the caller guard of the repository it names. For D4b that is `BusinessOsBillingAccountRepository.test.ts` only: no new file names the event repository, so `BusinessOsBillingEventRepository.test.ts` is unchanged (amended at the D4b code review; PLAN PAYMENTS agreed). PLAN PAYMENTS signs off |
| **R-D** (U-3 implementation) | In D4b, the composer's deps (not the route) call a new **user-scoped** repository method, `markCancelReminderCovered({ userId, livemode, stripeSubscriptionId, periodEnd })`. It does `SET cancel_reminder_sent_for = periodEnd`, as a CAS on `user_id` + `livemode` + `stripe_subscription_id` + `current_period_end = periodEnd` + `cancel_at_period_end`, with `{ count: 'exact' }`. It is called only after a `cancelled` email whose outcome is `sent` or `unknown` (S-3 b's at-most-once rule) **and** whose end is ≤ 3 days from now. If the cancel email was `not_sent`, the reminder still goes. A failed mark is logged and never fails the response. The reminder counts such rows as `covered`, only when the claim sees them (in practice the claim skips them, because `sent_for` already equals the period end). Tests: a cancel inside the window → marked → no reminder; outside the window → not marked; not sent → not marked |

D4b estimate after R-A to R-D: about 1.5 d (new route shell + `vercel.json` + job entry + U-3 mark), still under the 2.5 d cap.

### SA Code Review — D4a

**Code Review by SA — 2026-10-28** (uncommitted diff on `feature/plan-cancel-emails-d4` over `origin/main` `abe9fd64`)
**Status:** ⚠️ Code approved with one fix (F-1). F-1 is copy plus one test. QA may start once it is in. It does not need another SA pass if it is built as written below.

| Check | Result |
|---|---|
| S-11: the email can never turn a 200 into a 500, and is bounded | ✅ `notifyPlanCancelEmail` wraps everything in try/catch (its logger call is guarded too). `sendPlanCancelEmail` guards `isEnabled`, races `run()` (which has its own `.catch`) against one 4 s timer that is always cleared, and guards the logger and the audit port. Worst-case added latency = 4 s + `AUDIT_FLUSH_TIMEOUT_MS` for the outcome audit, which S-11 allowed. Route tests: send refused → 200, transport throws → 200 |
| S-6: sent only on a real change, from the routes, never from the engine | ✅ The call comes after `await audit(result.audit)` on `cancelled` / `reactivated` only. `unchanged`, refusals, `outcomeUnknown`, 401 and 400 send nothing (all tested). `planSubscriptionManage.ts` is untouched, so D6 cannot trigger it |
| Audit pair: order, non-blocking | ✅ The action audit is flushed first. The email audit then goes through `logAndFlush` (bounded, never throws) inside a try/catch. Both `info`, `SOC2`, audience `bos`; audience totals +2 |
| Pino, correlationId, no PII | ✅ `requestLogger` = `logger.child({ correlationId })`, and the audit details carry `correlationId`. Ids, kind, outcome, reason class, language, provider, `periodEnd`, `livemode` only. No address, name or plan name (log-capture test). `redactRecipientInLogs: true`. 0 `console.*` in new and touched files |
| `lib/notifications/emailTransport.ts` | ✅ Unchanged against `origin/main` |
| DR-6 / DR-7 / DR-8 / DR-10 / DR-11 | ✅ `no_date` before any lookup and again when a date will not format. The invoice sentence only when `invoicesLeftOpen === 0`. "ended on {date}". `safeTimezone` then `formatAccountDay`. Support line = `platformSenderAddress()`, with the address isolated `dir="ltr"`. A null view field drops its clause |
| Hebrew RTL | ✅ `dir="rtl"` with a right-aligned wrapper. The address is isolated LTR. The plural address form matches the drawer. G-5 wording still goes to the user with the diff |
| Tenant isolation | ✅ Every read is keyed on `user.id` from `getUser()`; `accountId` = `resolveAccountId(user.id)`. The only service-role read is `findUserIdentity(session user id)`: the user's own address, read-only, given only to the transport |
| Entitlements | ✅ Two `KNOWN_NON_GATE_IMPORTERS` entries with exact symbols. **SA ran `npm run test:bos-entitlements`: 326 suites / 9,729 tests green** |
| Switch | ✅ Pure `parseBooleanFlag` reader, default off. Catalogue entry (`lenient`) + reader-parity test + `FEATURE_FLAGS.md` |
| Tests SA ran | ✅ composer, switch, template, all 5 cancel route suites (incl. `route.d4a`), `eventAudience`, `catalogue`, both repository guard tests: **12 suites / 431 tests green** |

**Code Review Comments**

1. **F-1 (required, Medium, C-9)** `lib/email/templates/plan-cancel.ts:123`, `:152`, `:181`. The `ended_now` lead always says "…and you will not be charged again". On this path the code knows whether that is true. `invoicesLeftOpen > 0` means a void failed, and `null` means the list was not read. P-7a.4's C-11 / sandbox X-4 record shows that such an invoice stays payable and that a late payment goes through. The email is sent after the fact, so it must not repeat the drawer's pre-confirm promise when the code knows it may be false. **Fix:** in en / he / es, move "you will not be charged again" out of `endedNow.lead`. Show it only under the same `unpaidInvoicesCancelled` condition (`invoicesLeftOpen === 0`), e.g. "Your plan ended on {date} at your request." + "Any unpaid invoice for it was cancelled, and you will not be charged again." Add a template test: `unpaidInvoicesCancelled: false` → no "charged again" wording in any language. The `cancelled` lead keeps its sentence, because no invoice is open on that path.

**Optimisation Suggestions (non-blocking)**

- `lib/repositories/AuthAccountRepository.ts` L26-30: the header comment still says `findUserIdentity` has "Two callers", and it now has three. Fix it when the file is next touched.
- `planCancelEmailDeps.ts:93` re-derives `resolveAccountId(userId)` although the context already carries `accountId`. Harmless (same seam), but `context.accountId` would make it one source.

**Rulings on Dev's declared deviations**

1. **Guard allow-lists: accepted.** `findUserIdentity` is called with the session user's own id (route `user.id` from `getUser()`, never request data). That is the caller's own address, not a cross-tenant read: the S-7 recipient as ruled. Both lines are add-only and commented. The `route.d4a.test.ts` line in the billing repository allow-list fakes the module by name, as its siblings do. PLAN PAYMENTS sign-off on it is still owed (TL). It does not block QA, but it must be in before commit.
2. **`RESEND_FROM_EMAIL` refusal in the composer: accepted.** The reader stays pure, so catalogue reader-parity holds. The check runs before any lookup, is audited, and raises S-9's `alert: true` error. The catalogue and `FEATURE_FLAGS.md` both describe it.
3. **Copy: accepted, with F-1.** Leaving out `thenPausedFrom` and the "You'll lose" list is allowed: DR-11 builds only from what it renders, and leaving a clause out is never false. "Your data is kept…" on every send matches the drawer, whose `changes.unknown` carries the same sentence, so it is true on every path. "You can keep it any time before {date}" is true, because reactivate stays available while `cancel_at_period_end` holds. DR-9 holds: the kept email says only "continues and renews on {date}". The one C-9 gap is F-1.
4. **DR-14: TL does it before commit.** This branch already edits the plan's §1 SX-3 row, and the edit is stale: it still says "number reserved by TL" (20261099 is reserved) and "≈ 2.1 d", with no S-1 split. Replace it with two rows, D4a (≈ 1.1 d, no migration, switch off) and D4b (20261099, ≈ 1.5 d after R-A to R-D, manual prod gate), and add a Change History line. Doc-only; does not block QA.

**Code Approved for QA: Yes, once F-1 is applied.** DR-14 and the PLAN PAYMENTS sign-off are needed before commit.

### SA Code Review — D4b

**Code Review by SA — 2026-10-29** (uncommitted diff on `feature/plan-cancel-reminder-d4b` over `origin/main` `32effb8d`; migration **20261100**. Every "20261099" in the D4b rulings reads 20261100)
**Status:** ⚠️ Code approved with changes. F-1 and F-2 are required before commit. Neither needs another SA pass if built as written. QA may start now.

| Check | Result |
|---|---|
| Migration: one transaction, `lock_timeout` 5 s, pre-guard, post-condition, LF, no "the SQL-editor word" | ✅ `BEGIN` … `COMMIT`, pre-guard (21 columns, nothing D4b-owned exists, closures table exists, no browser CREATE on `public`), 10-step post-condition. 0 CR bytes and 0 hits in all 4 files (SA counted bytes). See F-1 for what happens after commit |
| DR-2 | ✅ `NOT EXISTS` on `business_os_account_closures` with exactly the 4 open statuses of the 20261093 CHECK (`kept` is the only other) |
| DR-3 | ✅ One grant: `UPDATE` on the 3 columns to `service_role`. Post-condition 8 and checker row 10 verify it, and that `user_id` / `livemode` stay non-updatable |
| DR-13 | ✅ No `updated_at` in the migration or in the 4 new repository writes. Table has no trigger (20261025 L74). Post-condition and checker count 24 |
| Claim function | ✅ plpgsql, `SECURITY DEFINER`, `SET search_path = public`, `VOLATILE`, inputs validated (batch 1–100, window ≤ 10 d, lease ≤ 1 h), schema-qualified `REVOKE ALL … FROM PUBLIC, anon, authenticated` after the CREATE, `GRANT EXECUTE` to `service_role`. `FOR UPDATE SKIP LOCKED` in the inner select, `ORDER BY current_period_end, id`. `RETURNS TABLE` names are `reminder_*`, so no OUT-parameter / column ambiguity |
| Claim predicate vs §6 + S-12 | ✅ Matches §6 line for line, plus `livemode = p_livemode` (S-12), the lease folded in (S-3 a) and DR-2. See "past_due" below |
| Rollback | ✅ Reviewed. One transaction, `lock_timeout`, refuses unless all 3 columns exist, takes `ACCESS EXCLUSIVE` **before** the lease check (so no claim slips between check and drop), refuses on a lease younger than 10 min, drops function → index → CHECK → columns (the column grant goes with them). Header states the one cost (re-apply can re-remind inside the last 3 days) and the order (code reverted or switch off first) |
| Pre-check / checker | ✅ Both read-only `WITH … SELECT`. Pre-check proves the 21-column shape the pre-guard expects. Checker row 8 reads `pg_get_functiondef` for SKIP LOCKED and DR-2; row 12 is information only. Its header records DR-13's note about the 20261025 checker |
| Repository CAS writes | ✅ `completeCancelReminder` / `releaseCancelReminder`: `id` + `user_id` + `livemode` + `cancel_reminder_claimed_by` (S-3 c). `markCancelReminderCovered`: `user_id` + `livemode` + `stripe_subscription_id` + `current_period_end` + `cancel_at_period_end = true` (R-D). All `{ count: 'exact' }`, count other than 0/1 is an error, no `.select()`, no `.or()`. R-C: both swaps null the 3 columns. The claim maps rows to canonical ISO and refuses other-mode or oversize answers. PLAN PAYMENTS signed off on these hunks |
| S-14 / C-4 | ✅ `stripeEndOf`: exactly one item, else `null` → `periodMismatch`; `cancelAt ?? items[0].currentPeriodEnd` (item-level on clover) must equal our row's end to the second. C-4 is the engine's own four checks, `!claim \|\| claim === row.userId` as `planSubscriptionManage.ts` L394, and the mode must match the key too |
| DR-5 | ✅ `sent` / `unknown` → complete; `not_sent` → release; `skipped` mid-run → release + `deferred`. Pinned in the pass test |
| Lease > maxDuration | ✅ Pinned: the test reads `maxDuration` from the route source, asserts 90 > 60 and 45 s < 60 s |
| R-B | ✅ Switch, key mode, Stripe factory, claim, every port and the logger are guarded; a row that throws is released and counted. Route catches a defect throw (500, run `failed`) |
| Deadline | ✅ No row started with < 8 s left; un-started rows released, `deadlineHit = 1`. The Stripe read is cut at the deadline. Worst case after the cut: 4 s email + 2 writes + bounded audit flush, inside 60 s |
| Counts ≤ 1,024 bytes | ✅ Worst-case JSON pinned under 1,024; registry keys pinned to `PLAN_CANCEL_REMINDER_COUNT_KEYS` both ways |
| Tenant isolation (`tenant-isolation-guard`) | ✅ The pass takes no id from input. Row id, user id, mode, subscription and customer all come from the claimed row; Stripe is cross-checked against it before any send; the composer's recipient, language, zone and view are keyed on that row's `user_id`; audit entity = that account. The two cron writes are CAS'd on the row's own `user_id` + `livemode` + runner. The one user-facing write (R-D) is keyed on the session `user.id` |
| Idempotency key | ✅ `plan-cancel-reminder:{billingRowId}:{periodEnd}` (ids + an ISO date, 82 chars, inside 1..256). `emailTransport.ts` unchanged. Note: a keyed send is refused in production without Resend (`idempotency_unsupported`) → `not_sent` → released and retried; consistent with the switch staying off until Resend is confirmed |
| Cron route + registry | ✅ Fail-closed `CRON_SECRET`, `runtime = 'nodejs'`, `maxDuration = 60`, 45 s deadline, `withCronRunRecord('bos-plan-cancel-reminders', …)`, counts-only response. `vercel.json` appended `"53 5 * * *"` (minute unique on the hour). `bosCronJobs.ts` one entry, `drainsQueue: null`; both cron tests say "23" literally, no ordinals (C-6) |
| R-D U-3 mark | ✅ Only `event === 'cancelled'` (so never `ended_now`), only `sent` / `unknown`, only for an end > now and ≤ `PLAN_CANCEL_REMINDER_WINDOW_SECONDS` (the claim's own constant). Never throws; a failure is a `warn`; the response is unchanged. The engine mirrors `cancel_at_period_end` onto our row synchronously (`planSubscriptionManage.ts` L468) before the route sends, so the CAS normally matches |
| Standards | ✅ 0 `console.*` in all new and touched source files. Pino, `correlationId` on the route logger. Logs and audit carry ids, mode, reason, outcome and dates only: no address, name or plan name. Rules 1–6 hold (all DB access in the repository; `user_id` on every non-cron write; the cron writes are documented ⟨unscoped-by-design⟩) |
| Tests SA ran | ✅ 28 touched suites / 1,297 tests green. Wider sweep (cron routes, admin, purge, repositories, security, scripts, supabase, billing, finance, audit, billing routes, notifications): 446 suites, 443 green. The 3 red are `publicEndpointsAreThrottled` (known Windows path noise), `bookingNextStep.test.ts` and `supabaseFetch.test.ts`; neither of the last two reads any file this slice touches |

**Code Review Comments**

1. **F-1 (required, Medium)** LF is only true in this working copy. `core.autocrlf` is `true` here and `.gitattributes` has no rule for these files, so the committed blob is LF but every later Windows checkout writes CRLF (20261098 is CRLF on disk in this same tree). Two effects: the migration text test's "every file is LF only" (`raw(...).includes('\r')`) turns red locally on Windows the moment another worktree checks it out, and the operator pastes a CRLF body (the 96 hazard the test exists for). **Fix:** add-only `.gitattributes` rules, in the style of the cleanup-SQL lines: `supabase/migrations/20261100_business_os_plan_cancel_reminders.sql`, `supabase/SQL[[:space:]]Scripts/20261100_business_os_plan_cancel_reminders_rollback.sql`, `scripts/precheck-plan-cancel-reminders.sql`, `scripts/check-plan-cancel-reminders-migration.sql`, each `text eol=lf`.
2. **F-2 (required, Low, docs only)** There is no apply runbook for 20261100. §6 still says 20261099, "not reserved yet" and "no grant change on the table", which DR-3 overturned. The migration header does say "Apply BEFORE the D4b merge deploy". **Fix:** correct §6 to 20261100 with the DR-3 grant, and add a short apply block (in §6 or §14): (1) `scripts/precheck-plan-cancel-reminders.sql`, every row `ok`; (2) apply 20261100 **before the merge deploy**; (3) `scripts/check-plan-cancel-reminders-migration.sql`, rows 1–11 `ok`, else roll back in the same sitting; (4) rollback only with the switch off or the code reverted. TL: confirm 20261100 is reserved in the coordination file (SA could not find that file in the tree).
3. **F-3 (optional, Low)** `notifyPlanCancelEmail` awaits `markCancelReminderCovered` after the 4 s email deadline with no timer of its own, so S-11's latency bound becomes 4 s + audit flush + one unbounded DB round-trip. Suggest racing it against a short timer (for example 2 s, treated as `failed`). Not blocking: the Supabase client has its own request ceiling.
4. **F-4 (optional, Low; PLAN PAYMENTS point 2)** One unreadable claimed row fails the whole batch, and because the claim orders by `current_period_end` it would head every batch until it leaves the window (up to about 3 days). **Ruling:** keep failing the whole batch. A guessed row is worse than none, and the rows that are unreadable here (a subscription or customer id that fails its pattern) cannot come from the validated writers. The alert already exists: the pass logs `claim_failed` with `alert: true` on every run. Adding `alert: true` to the repository's own `claimCancelReminders` error line is welcome but not required.
5. **F-5 (information; PLAN PAYMENTS point 3) `past_due` is left out on purpose. No user decision is needed.** Both the claim (`subscription_status IN ('active','trialing')`) and the pass's fresh check (`RUNNING_STATUSES`) exclude it, so they agree. The reason is C-9: the reminder says "Choose Keep my plan before {date}" and "ends on {date}", and for a `past_due` plan neither is reliably true. Keep is refused on `past_due` (the engine answers `payment_failed_contact_us`, `planSubscriptionManage.ts` L22), and Stripe's dunning can end the subscription before the period end. That owner is already on the failed-payment path (P-7a: cancel ends now, the banner and payment-failure emails). "Paying" in `payingSubscriptionStatuses.ts` is a revenue classification, not "can be kept". A plan that is cured and goes back to `active` inside the window is reminded on the next daily run. Dev: add one line to the claim's header comment and the pass header saying this.

**Rulings on Dev's declared deviations**

1. **R-C allow-lists: accepted.** The event repository guard is exact and no new file names that repository, so adding the files there would be wrong. R-C's row has been amended to say "each file is added, sorted, to the caller guard of the repository it names". PLAN PAYMENTS agreed.
2. **Repository test not purely add-only: accepted.** The count moves (updates 8→11, `.from(` 12→15, `user_id` 9→12, `livemode` 11→14, `stripe_subscription_id` 4→5, exactly one rpc) are exactly the 4 new methods plus the claim. The DR-4 loop skipping 20261100 is acceptable because the separate test pins the one UPDATE inside the claim function and its two SET columns. PLAN PAYMENTS signed off.
3. **Failures without a count key → `deferred`; `unknown` → `notSent`: accepted.** All of those are "not done this run, will be retried or alerted". `unknown` completes the row (DR-5), and its registry label already reads "not confirmed sent (refused, failed or timed out)". The composer's own log line and audit row carry the exact outcome.
4. **`partlyDoneWhen` (`deferred`, `deadlineHit`, `mismatch`, `notSent` ≥ 1): accepted.** `skipped` (switch off), `notCancelling`, `periodMismatch` and `covered` are correct answers, not partial runs.
5. **Audit (`.catch` per row + one bounded end-of-run flush): accepted.** This is CLAUDE.md § Audit Trail's non-blocking rule plus the WC-7 flush, without spending the run deadline per row. The flush is raced against `AUDIT_FLUSH_TIMEOUT_MS` and never throws.
6. **Wiring in `planCancelEmailDeps.ts`; view account = the claimed row's `user_id`, no `resolveAccountId`: accepted.** Keeping both wirings in one file shares D4a's lookups and keeps the entitlements importer count at the S-16 two. That file is already a declared non-gate importer and is on the auth-callers and routerPlacement lists. Using the claimed row's `user_id` directly is correct today. The billing row is keyed by the account, the seam is the identity, and passing it through `resolveAccountId` would only add an indirection that the claim already resolved. **Condition:** when the account seam stops being the identity (the owner and the account differ), this function has to split the recipient (the owner user) from the view's account. The header comment states the assumption; keep it there.
7. **Copy: accepted.** "Want to keep it? Choose "Keep my plan" before {date}." meets DR-9: no "as you asked", no "Changed your mind?". `{button}` is filled from the button's own label, so the sentence and the button cannot drift. "before {date}" is the cautious and true form. The he/es wording goes to the user for G-5.
8. **Migration additions: accepted, all three.** The 21-column pre-guard makes a surprise prod shape refuse instead of mis-count (the pre-check proves it first). The bounded inputs keep a bad caller from leasing the table. The rollback's 10-minute lease refusal (taken under `ACCESS EXCLUSIVE`) avoids dropping columns under a sending run.
9. **`addedOn: '2026-10-29'`: accepted as a placeholder.** RM sets the real merge day.
10. **Cancel while the cron holds the row: accepted.** The cron can only hold a row that is already cancelling, so this needs the engine's mirror to land inside that run's lease window, between the claim and the send. The outcome is two true emails, which is S-10's accepted class.
11. **`docs/FEATURE_FLAGS.md` paragraph: accepted.** It is accurate (dashboard cancels included, deletion requests excluded, U-3, `skipped: 1`, needs 20261100) and has a Change History row.

**Code Approved for QA: Yes.** F-1 and F-2 are needed before commit. F-3 and F-4 are optional. F-5 needs a one-line comment only.

**Dev fixes (2026-10-29), all applied:**

- [x] **F-1** `.gitattributes` gained four add-only `text eol=lf` lines (migration, rollback via `SQL[[:space:]]Scripts`, pre-check, checker), in the style of the cleanup-SQL lines. `git check-attr eol` reports `lf` for all four. `git ls-files --eol` after `git add -N` showed `w/lf attr/text eol=lf`, and the intent-to-add was then reset, so nothing is staged.
- [x] **F-2** §6 now says 20261100 (reserved) and the DR-3 column grant, and has the apply runbook (pre-check → apply before the merge deploy → checker → rollback only with the switch off or the code reverted). TL still to confirm the coordination-file reservation.
- [x] **F-3** `coverReminderAfterCancelEmail` races `markCovered` against `PLAN_CANCEL_REMINDER_COVER_TIMEOUT_MS` (2 s). A timeout is `failed`, logged `warn` with `reason: 'mark_timed_out'`, and never fails the response. Test added in `planCancelEmail.d4b.test.ts`.
- [x] **F-4** `claimCancelReminders`' error line now carries `alert: true`.
- [x] **F-5** One comment each in the migration header (claim function) and the pass header: `past_due` is excluded on purpose (Keep is refused, dunning can end it sooner; a plan cured inside the window is reminded on the next run).

---

## 13. QA Testing Report

### QA Testing Report — D4a

**QA — 2026-10-28** (uncommitted diff on `feature/plan-cancel-emails-d4` over `origin/main` `abe9fd64`, F-1 applied)
**Test mode:** full
**Strategy used:** A (Jest, injected ports) for the composer and template; B-style route tests through the REAL routes and REAL production wiring with the engine and edges faked; C (a render script) for the HTML previews. No live send, no DB, no prod write; the switch stayed off in every real environment.
**Focus:** api, security (PII), schema-free copy/i18n
**Skipped:** real inbox rendering (needs a human, listed below); D4b (reminder) is out of scope
**Input source:** prompt keywords (TL brief)

#### QA test files added (test-only, no guard allow-list change)

| File | Tests | What it adds |
|---|---|---|
| `lib/business-os/billing/__tests__/planCancelEmail.qa.test.ts` | 83 | Email day = drawer day in `America/Los_Angeles`, `Pacific/Kiritimati`, `Asia/Jerusalem` across midnight × 3 events × en/he/es (and not the UTC day); invalid zones → UTC; `ended_now` × `invoicesLeftOpen` 0 / 1 / 3 / null / undefined × 3 languages ("charged again" only at 0, in subject, text and HTML); DR-6 for every event (null, empty, blank, unparsable); a hanging identity / timezone / view lookup cut at the deadline; a throwing sender reader → `sender_not_configured`; switch off reads not even the sender; no address / plan name in logs or audit (sent and refused, 3 × 3); D6 static guard (engine imports no email path; only the two routes import it) |
| `app/api/business-os/billing/plan/cancel/__tests__/route.d4a.qa.test.ts` | 58 | REAL routes + REAL `planCancelEmailDeps` (engine faked at its own seam; identity through the real auth-account repository over a fake client, so no allow-list is touched). A send that never answers → 200, same body, NOT_SENT `unknown`; the email audit write throwing → 200 on both routes; identity read erroring / throwing → 200, `recipient_lookup_failed`; order action audit → send → email audit; `ended_now` at the route with 0 / 2 / null left open; engine `endsOn` / `renewsOn` null → `no_date`; zone parity at the route; no address / plan name in any route log line or audit row (ok / hang / throw); every `PLAN_MANAGE_REFUSALS` code × both routes × with and without `outcomeUnknown` and `unchanged` → no send, no email audit; switch off → only the engine and the action audit run |

#### Test Coverage

| Acceptance criterion (brief) | Tested? | Result | Notes |
|---|---|---|---|
| Switch `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` off by default; off → nothing read / sent / audited | ✅ | Pass | Flag test (12) + composer + route (`order` = engine, action audit only) |
| Switch on, `RESEND_FROM_EMAIL` missing → no send, audited `sender_not_configured`, `error` + `alert: true` | ✅ | Pass | Also when the sender reader throws; no lookups happen first |
| Send only on `cancelled` / `reactivated`; never on `unchanged`, refusals, `outcomeUnknown`, 401, 400 | ✅ | Pass | Every refusal code on both routes, with and without `outcomeUnknown` |
| Email failure / throw / timeout never changes the 200 body, never a 500 | ✅ | Pass | Refused, rejected, hanging send; throwing email audit; failing identity read |
| Added latency bounded | ✅ | Pass | Deadline 4 s pinned. True worst case is 4 s + `AUDIT_FLUSH_TIMEOUT_MS` (2 s) for the email audit ≈ 6 s; SA S-11 allowed this |
| SENT / NOT_SENT pair after the action audit | ✅ | Pass | Order pinned on both routes; both `info`, `SOC2`, audience `bos` |
| No address / name / plan name in logs or audit | ✅ | Pass | Composer (3 events × 3 languages, sent + refused) and route (ok / hang / throw), capturing every logger level; `redactRecipientInLogs: true`; subject has no `@` and no plan name |
| en / he / es parity, Hebrew RTL | ✅ | Pass | Dev key/placeholder parity tests + 12 renders; he has `<html lang="he" dir="rtl">`, the content `dir="rtl"` right-aligned, the support address isolated `dir="ltr"` |
| Email date = drawer date, same account / zone (non-UTC near midnight, invalid zone → UTC) | ✅ | Pass | Both sides of UTC; the drawer's chain checked in source: `PlanCancelDrawer.tsx:177` `formatAccountDay(iso, language, timezone)` with `LanguageContext` `safeTimezone(...)`, else `'UTC'` |
| `ended_now` with `invoicesLeftOpen` 0 / >0 / null (DR-7, F-1) | ✅ | Pass | The invoice sentence and any "charged again" wording only at 0 |
| DR-6 null date → no send (`no_date`) | ✅ | Pass | All three events, composer and route; no recipient lookup happens |
| Engine never sends (D6 safety) | ✅ | Pass | `planSubscriptionManage.ts` unchanged vs `abe9fd64` and imports no email path (static test); `oneDontRenewPath.guard` green |
| `lib/notifications/emailTransport.ts` unchanged vs `origin/main` | ✅ | Pass | `git diff --stat origin/main -- lib/notifications/emailTransport.ts` empty |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. (Worst case ≈ 6 s extra on a cancel press, not ~4 s: 4 s email deadline + the 2 s bounded email-audit flush. Within S-11 as ruled; noted so the brief's "~4 s" is not quoted as the bound.)

**Edge cases (nice to fix / for the user's G-5 copy review):**

1. **`ended_now` "after that" tense.** The paragraph reuses the drawer's future-tense line with the end date, so the ended email reads "Your plan ended on 1 December … On 1 December your plan moves to the free plan …" (all languages). True, slightly odd once the date has passed. Copy only — `lib/email/templates/plan-cancel.ts` `changes.freePlan` reuse in the `ended_now` branch (L252). Low.
2. **`ended_now` with an invoice left open says nothing about it.** After F-1 the email (correctly) makes no "not charged again" promise, but it also does not tell the owner an unpaid invoice may still be payable. A product choice, not a C-9 breach. Low.
3. **Latin plan name inside a Hebrew sentence** ("…לתוכנית החינמית, Test Flight, עם 1,000 קרדיטים…") is plain bidi text without isolation; it reads correctly in the preview, but should be eyeballed in a real client. Low.

#### Test Outputs / Logs

```text
D4a suites + both billing repository guards + auth callers guard + mockedRepositoryMethods guard
+ eventAudience + catalogue + enforcementPoints + oneDontRenewPath guard + all plan route suites:
Test Suites: 22 passed, 22 total
Tests:       989 passed, 989 total        (incl. the 2 QA files: 83 + 58)

npm run test:bos-entitlements:  Test Suites: 326 passed, 326 total / Tests: 9729 passed, 9729 total (EXIT 0)
npm run lint:hooks:             clean (--max-warnings 0)
npx tsc --noEmit (8 GB heap):   ran to completion, printed 1,864 diagnostics (all pre-existing, same count
                                as Dev's), 0 in any touched or QA file; no OOM / V8 trace
console.* in the 6 new or touched code files: 0
emailTransport.ts / planSubscriptionManage.ts: no diff
```

**Rendered previews (eyeball only, not committed):** `C:/Users/Barak/AppData/Local/Temp/claude/C--Users-Barak-My-Projects-AgentsPilot-neuronforge/2a6aa3a2-bfdd-4f5a-9d02-97ced6d883a6/scratchpad/d4a-emails/index.html` (local scratchpad, forward slashes on purpose: Tailwind scans docs) → 12 HTML + 12 `.txt` files (`{en,he,es}-{cancelled,ended_now-invoices-cleared,ended_now-invoice-left-open,kept}`), zone `Asia/Jerusalem`, end `2026-11-30T22:30Z` (shows 1 December).

#### What only a human click proves

- Real inbox rendering in Gmail (web + mobile) and Outlook (desktop + web): layout, button, dark mode.
- Hebrew RTL in a real client: alignment, the LTR-isolated address, the Latin plan name mid-sentence, the date "ב-1 בדצמבר 2026".
- An actual Resend delivery from `RESEND_FROM_EMAIL` (domain verification) with the switch on in a non-prod env — the ops gate before switching on.
- The full §8 manual path on the sandbox: cancel → "Plan cancelled" with the same day as the drawer; Keep → "Plan kept"; switch off → nothing.

#### Final Status

- [x] All acceptance criteria pass — ready for commit (QA side). Still owed before commit, not QA's: DR-14 plan-row edit (TL) and the PLAN PAYMENTS sign-off on the `route.d4a.test.ts` allow-list line (TL). The G-5 he/es wording review by the user.
- [ ] Issues found — Dev must address before commit

### QA Testing Report — D4b

**QA — 2026-10-29** (uncommitted diff on `feature/plan-cancel-reminder-d4b` over `origin/main` `32effb8d`, SA F-1..F-5 applied)
**Verdict:** ⚠️ **Code PASS; one Medium doc bug (B-1, runbook / headers only) to fix before commit.** No code defect found. No High bug.
**Test mode:** full
**Strategy used:** A (Jest, injected ports) for the pass and template; B-style route tests through the REAL cancel / reactivate routes, the REAL wiring and the REAL billing repository over a fake service-role client; the REAL cron route with the run faked; close reading (not execution) of the four SQL files; C (a throw-away render through the real composer) for the HTML previews. No database touched, no SQL run, no real email, nothing committed, pushed or stashed, no `jest -u`.
**Focus:** api, pipeline-free cron, security (tenant isolation, PII), schema (migration text), copy / i18n
**Skipped:** live sandbox path (§8 manual: test-clock reminder, second trigger sends none) — needs the switch on and 20261100 applied; listed under "What only a human click proves"
**Input source:** prompt keywords (TL brief)

#### QA test files added (test-only; no guard allow-list change)

| File | Tests | What it adds |
|---|---|---|
| `lib/business-os/billing/__tests__/planCancelReminderPass.qa.test.ts` | 61 | Three runs truly interleaved (sends yield) over 70 rows: no double send, every row once, no lease left, nothing on day 2; a live lease is skipped, a dead one (91 s) reclaimed; a lost lease completes 0 rows + `alert`. DR-5 across the whole window: `unknown` completed and never re-claimed on days 1–3; `not_sent` released and sent by the next daily run; never retried after the end. Every Stripe "no" (flag off, `cancel_at` 0, ended, canceled / past_due / unpaid / incomplete / paused, ±1 s, −1 day, 0 or 2 items, null item end) and every C-4 field alone (id, customer, null customer, mode, `bos_user_id`) → released, never sent or completed; mismatch logs `alert`. F-5: `past_due` never claimed (model + SQL text). Tenant isolation: each send carries its own row's account, subscription, mode, end and key; Stripe naming account B on A's row sends to nobody; a hostile context id is ignored. R-B: 19 ports each throwing alone (sync and async) → the run still resolves. Deadline with a moving clock (4 of 10 sent, 6 released), a past deadline, a Stripe read that never answers. Counts JSON (5-digit and max-safe values) < 1,024 bytes; lease 90 s > `maxDuration` 60 s. Provider key exact shape, 82 chars ≤ 256, stable per period end. Log contexts: ids, reason codes and counts only |
| `app/api/cron/bos-plan-cancel-reminders/__tests__/route.qa.test.ts` | 15 | Dev shipped no route test. Missing / wrong / unschemed / lower-case / suffixed / prefix secret → 401 and neither deps nor run touched; `CRON_SECRET` unset in production → 401 + `error` log for every header; empty secret → 401; `NODE_ENV=test` still needs it. Authorised → the run once, 45 s deadline, counts-only body; a defect throw → 500 with no details. `runtime` nodejs, `maxDuration` 60, `GET = withCronRunRecord('bos-plan-cancel-reminders', runJob)`, no other verb, no `console.`; `vercel.json` one entry `53 5 * * *` (the only `53` minute), one registry entry, `drainsQueue: null` |
| `app/api/business-os/billing/plan/cancel/__tests__/route.d4b.qa.test.ts` | 22 | U-3 / R-D through the real routes: end in 1 h / 2 d / 2 d 23 h, sent → ONE update `{ cancel_reminder_sent_for }` only, `{ count: 'exact' }`, no `.select()` / `.or()`, filters exactly `user_id` (session) + `livemode` + `stripe_subscription_id` + `current_period_end` + `cancel_at_period_end = true`, no `updated_at`; `unknown` → marked; `+00:00` end written canonical; 3 d + 1 min / 10 d / past → no write; not_sent (refused, rejected, identity unreadable) → no write; switch off → nothing; count 0 → 200, no error. F-3: a mark that never answers is cut at 2,000 ms, `warn mark_timed_out`, same 200 body; error / throw → 200 + `warn mark_failed`. `ended_now` and `kept` (renewal inside 3 days) never mark. No address or plan name in any log line |
| `lib/email/templates/__tests__/plan-cancel.reminder.qa.test.ts` | 31 | Subject = the lead without its full stop, date only, no `@` / HTML / plan name, no name placeholder exists; credits null / read-only days null / back-to-plan `until` null each drop their clause in en/he/es, no `null`/`undefined`/empty paragraph; the keep sentence's `{button}` is the label inside the very `<a href>` the HTML shows; he `<html lang="he" dir="rtl">`, content right-aligned, address isolated LTR; en / es LTR; DR-9 and "today" / "in N days" / "free tier" absent in all three languages for every view shape; no refund or "charged again" line |

#### Test Coverage

| Acceptance criterion (brief) | Tested? | Result | Notes |
|---|---|---|---|
| 1. Switch off → no claim | ✅ | Pass | Dev test + QA R-B (`isEnabled` throwing = off) |
| 1. Two concurrent runs never send to the same row | ✅ | Pass | SKIP LOCKED model, 3 interleaved runs, 70 rows |
| 1. Sent or unknown → completed with that period end, never claimed again (DR-5) | ✅ | Pass | Checked on every later day of the window |
| 1. not_sent → released, retried next run | ✅ | Pass | Sent on day 2; never after the end |
| 1. Stripe not cancelling / ended / other end / ≠ 1 item → released, not sent (S-14) | ✅ | Pass | 14 shapes |
| 1. C-4 mismatch → released + `alert` | ✅ | Pass | Each field alone, plus a claim row in the other mode |
| 1. Deadline → stops starting rows | ✅ | Pass | Moving clock; past deadline; hung Stripe read cut |
| 1. Never throws (R-B) | ✅ | Pass | 19 ports one at a time. See E-1 for the two that are not guarded |
| 1. Worst-case counts JSON < 1,024 bytes | ✅ | Pass | 10 keys at `MAX_SAFE_INTEGER` still fit |
| 1. Lease > maxDuration | ✅ | Pass | 90 s > 60 s; 45 s + 8 s margin ≤ 60 s |
| 1. Idempotency key shape and transport limits | ✅ | Pass | 82 chars, `IDEMPOTENCY_KEY_MAX_LENGTH` 256; `emailTransport.ts` unchanged |
| 1. `past_due` never reminded (F-5) | ✅ | Pass | Claim (model + SQL) and choke point agree |
| 1. Email only to the claimed row's own user | ✅ | Pass | Pass + deps wiring (`accountId: input.userId`) read |
| 2. Missing / wrong secret → 401, nothing runs | ✅ | Pass | New route test |
| 2. `CRON_SECRET` unset → fails closed | ✅ | Pass | 401 + `error` log |
| 2. `withCronRunRecord`, nodejs, 60 s, `vercel.json` `53 5 * * *`, `bosCronJobs.ts` | ✅ | Pass | Also `runRecord.adoption` and both cron registry tests green |
| 3. U-3 / R-D mark: ≤ 3 d sent/unknown → marked; > 3 d → not; not_sent → not | ✅ | Pass | Through the real routes and repository |
| 3. Mark times out (F-3, 2 s) → failed, logged, 200 unchanged | ✅ | Pass | Measured ≈ 2,010 ms |
| 3. ended_now / kept never mark (reactivated) | ✅ | Pass | |
| 4. Complete / release CAS on id + claimed_by + user_id + livemode; lost lease 0 rows; `{count:'exact'}`, no `.select()`/`.or()`; no `updated_at`; R-C nulls the 3 columns on both swaps | ✅ | Pass | Read + Dev's `…d4b.test.ts` and the amended PLAN PAYMENTS test (R-C at L412 / L517). No QA repository file: naming the repository would need a guard allow-list change |
| 5. DR-2 closure exclusion | ✅ | Pass | The 4 open statuses of the 20261093 CHECK; `user_id` uuid both sides |
| 5. DR-3 grant = 3 columns only | ✅ | Pass | One `GRANT UPDATE (…3…) TO service_role`; post-condition 8 and checker row 10 also prove `user_id` / `livemode` stay non-updatable |
| 5. No "into" anywhere | ✅ | Pass | 0 hits (case-insensitive) in all 4 files; 0 non-ASCII bytes |
| 5. LF + `.gitattributes` | ✅ | Pass | 0 CR bytes in all 4; `git check-attr` → `eol: lf`, `text: set` for all 4 |
| 5. Claim predicate matches §6 | ✅ | Pass | Line for line, plus S-12 mode, S-3 a lease, DR-2, `ORDER BY current_period_end, id` |
| 5. Rollback restores the pre-migration state | ✅ | Pass | Drops function → index → CHECK → columns (column grant goes with them); dropped columns are `attisdropped`, so the 21-column pre-guard holds on a re-apply. **But see B-1 for its "switch off is enough" claim** |
| 5. Anything that would fail in the SQL editor | ✅ | Pass | None found. `RETURN QUERY UPDATE … RETURNING` has applied precedent (`2026-08-14_payment_reminders_claim.sql`); `RETURNS TABLE` types (uuid, uuid, boolean, text, text, timestamptz, timestamptz) match the 20261025 columns exactly, so no "structure of query does not match" at run time; `reminder_*` names cannot shadow a column; index `LIKE` matches `pg_get_indexdef`'s form; `proconfig @> {search_path=public}` matches |
| 6. en / he / es render; he RTL; subject; DR-9; `{button}` = label; null clauses dropped; never "free tier" | ✅ | Pass | Dev test + QA test; 3 previews below |
| 7. No address / name / plan name in logs or audit | ✅ | Pass | Pass logs (key allow-list), route logs (3 mark modes), and the composer's real log line + audit row captured in the previews run (`*-logs-and-audit.json`): ids, `email: reminder`, outcome, language, provider, `periodEnd`, `actor: system` only |

#### Issues Found

**Bugs (must fix before commit):**

1. **B-1 — "switch off" is not a safe state for the 20261100 rollback, and "code that runs first breaks nothing" is not true** — Severity: **Medium** (doc / runbook only, but it is the operator's prod instruction). Files: `supabase/SQL Scripts/20261100_business_os_plan_cancel_reminders_rollback.sql` L2-4, `supabase/migrations/20261100_business_os_plan_cancel_reminders.sql` L22-23, this workplan §6 runbook step 4.
   - Why: R-C made `replaceCustomer` and `attachTestClockCustomer` write `cancel_reminder_sent_for` / `_claimed_by` / `_claimed_at` **unconditionally** (no switch). Without the columns, PostgREST refuses the whole update (PGRST204, column not in the schema cache).
   - Steps: apply 20261100, deploy D4b, then roll back with only `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` off (as the rollback header and §6 step 4 allow) — or deploy D4b before the migration.
   - Expected: plan checkout for an owner whose stored Stripe customer is gone still replaces it; the admin test-clock attach still works.
   - Actual: `replaceCustomer` errors → `businessOsStripeCustomer.ts` throws `billing_row_not_recorded` → that checkout fails; `attachTestClockCustomer` fails the same way.
   - Fix (text only): the rollback runs only **after the D4b code is reverted** (switch off is not enough, because of R-C); and the migration header should say a D4b deploy before 20261100 breaks the customer swap and the test-clock attach, which is why "apply BEFORE the merge deploy" is mandatory, not just safe. No code change needed.

**Performance issues:** none. The cron run is bounded at 45 s + per-row 8 s margin inside 60 s; the cancel press gains at most the 2 s mark bound (F-3) on top of D4a's ≈ 6 s.

**Edge cases (nice to fix / for the record):**

1. **E-1 (Low, R-B letter):** `deps.newRunnerId()` (L290) and `deps.now()` (loop head, L321) are called outside any `try`, so a throwing runner-id or clock port would throw the run. The real ports are `randomUUID()` and `Date.now()`, which do not throw, and the route catches a defect throw (500, run `failed`). Wrap them if R-B is to hold literally.
2. **E-2 (Low):** `release` and `complete` writes have no timer of their own. A hung database write keeps the run past its 45 s deadline until `maxDuration` kills it; the 90 s lease then frees the row. Safe, but the counts of such a run are lost.
3. **E-3 (Low, accepted S-10 class):** a send that goes out but whose `complete` write fails leaves the row claimable when the lease expires, so the **next daily run re-sends** it. The provider key does not help there: Resend keeps a key about 24 h, and the next run is about 24 h later. The `complete_failed` line carries `alert: true`, so an operator sees it.
4. **E-4 (copy, G-5):** the reminder's HTML heading is the subject and the first paragraph is the same sentence again ("Your plan ends on December 1, 2026" / "Your plan ends on December 1, 2026."). The cancelled email does not repeat itself this way. Copy-only.
5. **E-5 (copy, G-5):** the footer "You're getting this because of a change to your plan" (he / es the same) is shared with the reminder, which reports no new change. True in a loose sense (the plan was set to end); the user may prefer a reminder-specific footer.
6. **E-6 (Low, existing pattern):** like `bos-billing-reconcile`, the route runs **without a secret** when `NODE_ENV=development`. Local development shares the production database (`cronRunRecorder.ts` header), so a local GET with the switch on would send real reminders to production rows. Not new (copied shell); keep the switch off locally.
7. **E-7 (information):** `unknown` is counted under `notSent` and so makes the run "partly done" on the admin page although the row is completed. SA accepted it (deviation 3); noting it so an operator does not chase it.

#### Test Outputs / Logs

```text
QA files alone:  4 suites / 129 tests green (61 + 15 + 22 + 31)

Regression sweep (lib/audit, lib/email, lib/business-os/billing, app/api/business-os/billing, app/api/stripe,
lib/repositories/__tests__, lib/cron, app/api/cron, supabase/migrations/__tests__, supabase/__tests__,
lib/admin/environment, lib/business-os/entitlements, lib/notifications) — includes every touched suite and the QA files:
Test Suites: 411 passed, 411 total
Tests:       14319 passed, 14319 total
Snapshots:   111 passed, 111 total

npm run test:bos-entitlements:  Test Suites: 331 passed / Tests: 9881 passed (EXIT 0)
npm run lint:hooks:             clean (--max-warnings 0, EXIT 0)
npx tsc --noEmit (8 GB heap):   ran to completion, 1,920 diagnostics (= Dev's count, all pre-existing),
                                0 in any D4b or QA file; no OOM / V8 trace
publicEndpointsAreThrottled:    3 known Windows-path failures (book/manage calendar, public consent-copy,
                                public invoice pay); none names a D4b file
SQL files (4):                  0 CR bytes, 0 non-ASCII bytes, 0 "into"; git check-attr eol = lf, text = set
```

**Rendered previews (eyeball only, not committed):** `C:/Users/Barak/AppData/Local/Temp/claude/C--Users-Barak-My-Projects-AgentsPilot-neuronforge/fbb66f51-b54b-4128-aea8-21f71f8538ff/scratchpad/d4b-emails/` (local scratchpad, forward slashes on purpose: Tailwind scans docs) → `en-reminder.html`, `he-reminder.html`, `es-reminder.html`, each with a `.txt` (subject, key, plain text) and a `-logs-and-audit.json` capture. Rendered through the real composer with zone `Asia/Jerusalem`, end `2026-11-30T22:30Z` (shows 1 December), a free-plan view (Test Flight, 1,000 credits, 7 read-only days).

#### What only a human click proves

- The §8 manual path on the sandbox once 20261100 is applied and the switch is on in a non-prod env: a test-clock subscription 2 days before its end → trigger the cron route → one reminder; trigger again → none; press Keep and re-cancel → none (same period end); cancel inside the last 3 days → only the "Plan cancelled" email.
- Real inbox rendering (Gmail, Outlook; Hebrew RTL; dark mode) and a keyed Resend delivery.
- The prod apply itself: pre-check all `ok`, apply before the merge deploy, checker rows 1–11 `ok` (run by the operator, not QA).

#### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] Issues found — Dev must address before commit: **B-1 only** (three comment / runbook lines, no code). Once fixed, no re-test is needed beyond `business-os-plan-cancel-reminders.migration.test.ts` (it reads those files). Still owed, not QA's: TL confirms the 20261100 reservation; the user's G-5 he/es review (E-4, E-5 are copy points for it).

---

## 14. Commit Info

*(RM populates this section.)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-28 | Created (Dev) | Workplan for D4 / SX-3 on `feature/plan-cancel-emails-d4` from `415f726e`: cancelled / ended-now / kept emails from the routes, 3-day reminder as a claim-pattern pass on the existing `bos-billing-reconcile` cron, email switch off by default (Resend not confirmed), R-3 and P-7a note. Migration 20261099 proposed (not yet reserved). ≈ 2.2 d. S-1 to S-16, U-1, U-2. BQ-36 answer recorded in the requirement §9 and the plan |
| 2026-10-28 | SA workplan review | ⚠️ Approved with changes DR-1 to DR-14 (§12). Split into D4a (emails from the routes, no migration) and D4b (reminder + 20261099). Must rebase onto P-8b.2 (#559). The billing table needs a column UPDATE grant, and a PLAN PAYMENTS SQL-updaters test needs an add-only amendment. The reminder claim leaves out accounts with an open closure row (D6). Audit is a SENT / NOT_SENT pair. R-3 left as it is (met by P-7a.3). New business question U-3 |
| 2026-10-28 | D4a code complete (Dev) | Merged `origin/main` (`abe9fd64`, fast-forward) and re-verified §1 (DR-1). Built the switch `BUSINESS_OS_PLAN_CANCEL_EMAILS_ENABLED` (catalogue + FEATURE_FLAGS.md), template `plan-cancel.ts` (cancelled / ended_now / kept × en/he/es), composer `planCancelEmail.ts` + `planCancelEmailDeps.ts`, the cancel / reactivate route hooks (S-6, S-11, U-2), the SENT / NOT_SENT audit pair, 2 non-gate registrations, the P-7a note. No migration, no repository code, no cron change. Tests: template 74, composer 31, switch 12, routes 17; `test:bos-entitlements` green. T-1 to T-4, T-8 to T-10 ticked |
| 2026-10-28 | SA code review — D4a | ⚠️ Approved with one fix, F-1 (C-9): the `ended_now` "you will not be charged again" only when `invoicesLeftOpen === 0`. SA ran 12 suites / 431 tests and `test:bos-entitlements` (326 / 9,729), all green. Deviations 1–3 accepted. DR-14 to be done by TL before commit. PLAN PAYMENTS sign-off still owed for the billing-repository allow-list line |
| 2026-10-28 | D4a F-1 + both suggestions (Dev) | F-1: `endedNow.lead` no longer says "not charged again" in en/he/es; the promise moved into `invoicesCancelled`, which shows only when `invoicesLeftOpen === 0`. New template test: `unpaidInvoicesCancelled: false` → no "charged again" wording in any language (text, HTML, subject). Suggestions: `planCancelEmailDeps.ts` reads the view on `context.accountId` (no `resolveAccountId` import; its non-gate entry is now `['readPlanEndingView']`); `AuthAccountRepository.ts` header now lists every `findUserIdentity` caller (comment only). D4a suites + both repository guards 21 / 760 green, `test:bos-entitlements` 326 / 9,729 green |
| 2026-10-28 | QA — D4a | ✅ Pass, no bugs. Two QA test files (composer 83, routes 58; no guard allow-list change). 22 suites / 989 tests green, `test:bos-entitlements` 326 / 9,729, `lint:hooks` clean, `tsc` 0 in touched files (1,864 pre-existing, no OOM). `emailTransport.ts` and the engine unchanged. 3 low edge cases for the G-5 copy review; worst-case added latency ≈ 6 s (4 s + 2 s audit flush), within S-11. 12 HTML previews rendered for the user |
| 2026-10-29 | G-5 user review — D4a | ✅ Diff and he/es copy approved. Mixed tense in the ended email: left as is. Invoice left open or not read: the ended email now says it may still be unpaid and could still be charged (`endedNow.invoiceMayBeOpen`, en/he/es), shown exactly when `invoicesCancelled` is not. Template + QA tests extended; 14 suites / 557 green |
| 2026-10-29 | D4b code complete (Dev) | On `feature/plan-cancel-reminder-d4b` from `32effb8d`. Migration **20261100**, not 20261099, which main took: 3 columns, pair CHECK, partial index, definer claim function with DR-2's closure exclusion, DR-3 column grant, 24-column post-condition. Rollback, pre-check, checker and text test added. Repository: claim, complete and release (unscoped-by-design CAS), plus the user-scoped covered mark (R-D). Both swaps clear the 3 columns (R-C). The PLAN PAYMENTS test was amended for counts, grants, DR-4 and the allow-list. The reminder runs as its own cron, `/api/cron/bos-plan-cancel-reminders` at `"53 5 * * *"`, with ten unprefixed counts (R-A). The reminder template variant is in en/he/es (DR-9) with a provider key (S-10). FEATURE_FLAGS paragraph added. 400 / 14,081 touched suites green, `test:bos-entitlements` 331 / 9,881, `lint:hooks` clean, tsc 0 in touched files. Full Jest has 25 failing suites, none touching this slice. T-5, T-6 and T-7 ticked |
| 2026-10-29 | SA code review — D4b | ⚠️ Approved with changes. F-1 (required): `.gitattributes` `eol=lf` rules for the 4 SQL files, because autocrlf would make them CRLF on the next Windows checkout. F-2 (required, docs): fix §6 (20261100, DR-3 grant) and add the apply order (pre-check, apply before the merge deploy, checker, rollback rule); TL confirms the 20261100 reservation. F-3 and F-4 optional. F-5: `past_due` left out on purpose (Keep is refused and dunning can end the plan sooner, C-9), so a one-line comment is enough and no user question is needed. All 11 Dev deviations accepted; deviation 6 has a condition about the account seam. R-C row amended: each file goes to the caller guard of the repository it names. Rollback reviewed. SA ran 28 touched suites (1,297 tests), all green, and a 446-suite sweep in which the only 3 failures are unrelated |
| 2026-10-29 | SA code review fixes — D4b (Dev) | F-1: four add-only `text eol=lf` lines in `.gitattributes` for the 20261100 migration, rollback, pre-check and checker (verified with `git check-attr` / `git ls-files --eol`, nothing staged). F-2: §6 corrected to 20261100 and the DR-3 grant, apply runbook added. F-3: the covered mark is raced against a 2 s timer (`PLAN_CANCEL_REMINDER_COVER_TIMEOUT_MS`), timeout = `failed`, logged, test added. F-4: `alert: true` on the repository claim error. F-5: `past_due` exclusion stated in the migration and pass headers |
| 2026-10-29 | QA — D4b | ⚠️ Code pass, one Medium doc bug. B-1: the rollback header, the migration header and §6 step 4 say the switch being off is enough, and that code deployed first breaks nothing. Neither is true: R-C's `replaceCustomer` / `attachTestClockCustomer` write the 3 columns whatever the switch says, so without them the stale-customer checkout and the test-clock attach fail. Fix is text only. 4 QA test files, 129 tests (pass 61, cron route 15, U-3 route 22, template 31), no guard allow-list change. Sweep 411 suites / 14,319 tests green; `test:bos-entitlements` 331 / 9,881; `lint:hooks` clean; `tsc` 0 in D4b and QA files (1,920 pre-existing, no OOM). SQL read closely, not run: nothing found that would fail in the editor. 7 edge cases (E-1 to E-7, Low or copy). 3 HTML previews (en/he/es) rendered for the user |
| 2026-10-29 | QA B-1 fixed (TL) | Rollback header, migration header and §6 (gate + runbook step 4) corrected: applying 20261100 before the merge deploy is required, not just safe, and the rollback runs only after the D4b code is reverted and deployed; the switch being off is not enough, because `replaceCustomer` / `attachTestClockCustomer` write the three columns regardless. Text only; migration SQL unchanged |
