# Workplan: Admin BOS Cleanup, Slice 7c (retry one queue item)

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md): §4.2 FR-Q1 (retry), FR-Q3, FR-Q4, FR-Q5, FR-Q6, FR-Q7; the slice 7 lines of §9; TA-9; and **"SA Review — slice 7 (2026-10-04)"** in full, with SA's 7d, 7a and 7b amendment notes. The binding parts for 7c are §C (the Retry column), §D.1–D.3, D.5 and D.6, §E, §F, §G (`BOS_QUEUE_ITEM_RETRIED`), §H as amended, and conditions **C7-1, C7-2, C7-3, C7-4, C7-5, C7-7, C7-8, C7-9, C7-12, C7-13, C7-14, C7-15, C7-16** (the retry items), plus the four 7a "carried to 7c" items and W7B-14. User decisions used: OQ-3 (a 72-hour retry window, then cancel only), UC-7 (7d, 7a, 7b, 7c, each its own PR), UC-8 (the business name is enough), UC-9 (owners never see an admin's retry or cancel, nor the reason).
**Branch:** `feature/admin-queue-retry` @ `origin/main` `50a30939` (7d, 7a and 7b merged; migration `20261035` applied to production). Worktree `neuronforge-admin-queues`. Created by RM.
**Process:** Dev workplan → SA workplan review → Dev implement → SA code review → QA → the user sees the uncommitted diff → user approval → RM. Dev commits nothing.
**Date:** 2026-10-04
**Status:** Code Complete (uncommitted). SA code review APPROVED WITH CHANGES; CR7C-1..CR7C-8 and QA-3 applied (IN-8). Not mergeable before P2 (the P2 gate test is red by design). SA approved the workplan with conditions W7C-1..W7C-16; see "Scope as amended by SA" below and the Implementation Notes after the SA review.

> **Scope as amended by SA (W7C-1..W7C-16), folded in before implementation (2026-10-04).**
> - **Base moved:** the branch was fast-forwarded to `origin/main` **`1a9944a5`**. Every count below is re-measured there (Implementation Notes, IN-1).
> - **P1 (briefing stale-date guard) is MERGED** (PR #215, `processDueBriefings`). Its tasks are dropped from this plan: §2.5's code, T5, `DailyBriefingDispatchService.staleDate.test.ts`, §5.6 D-1..D-7 and mutations 16–17 belong to P1. **7c's diff does not touch `DailyBriefingDispatchService.ts`.** BM-1..BM-5 (the route side) stay.
> - **P2 (lead route `maxDuration` + awaited drain) is NOT built**; it waits on Q-SA7C-1. **7c's diff does not touch `app/api/business-os/leads/[id]/route.ts`.** Lead-reply retry is built in full, and **7c does not merge until P2 merges.** SA's fallback (b) is implemented as one switch, **`LEAD_RETRY_HELD`** (default `false`) in `lib/admin/jobs/retryHolds.ts`: when `true`, lead retry is refused with 422 `retry_held` and a plain sentence, in the eligibility module (so the list says so), the route (before any read) and the repository. Both states are tested. The placement is Dev's proposal, flagged for SA.
> - **Q-SA7C-2 defaults to "charge as normal"**: no billing change.
> - Everything else is as written below, read with SA's rulings: OP-7 as clarified (no second wrapper call; "`max` of the two" deleted), §2.5's owner-card sentence corrected (no owner surface reads `daily_briefing_sends`), and the `runQueueDrain.ts` comment-only amendment (OP-3).
**Effort:** M, about 2.5 days (about 19.75 h) for 7c as proposed, including the briefing dispatcher guard (OP-1). The BL-7a lead-route change that OP-2 recommends landing first is a separate, smaller PR of about 0.5 day. Breakdown in [section 11](#11-effort-estimate).

## Overview

Slice 7a marks each listed queue item "Re-send: until …" or "no: …". Slice 7b added **Cancel item**. Slice 7c adds the riskiest action in slice 7: **Retry item**. A cancel can only remove a send. A retry **adds one more send attempt to a real client** (or, for the briefing, to the business owner). So this slice is mostly about double-send safety.

A retry puts one `failed` item back to `pending`. **It never sends.** The send happens only through the queue's own claim, on the next cron run or when an admin presses Drain now. The retry:
- never resets `attempts`, so one retry buys exactly one more try (B7-8);
- never clears `error_message`, `skip_reason`, the payload or any target column;
- never touches a leased, in-progress or finished item;
- never rewrites `scheduled_at`, so repeated retries cannot slide the 72-hour window forward.

The admin presses "Retry item" on a row the shared eligibility function marks retryable. A confirm dialog opens. It requires a reason, states the known risk ("if an earlier attempt was actually delivered but not recorded, the client may receive it twice"), and says what happens next on that queue. On confirm, the browser posts to the existing `POST /api/admin/jobs-queues/items/action` with `action: 'retry'`. The route:
1. checks the queue rule and the "from" state before any read;
2. re-reads the row on the server and checks it is still what the admin saw;
3. for payment reminders, works out the next sending-hours time through a public wrapper of `PaymentReminderService.sendableAt` (C7-8);
4. re-checks eligibility with the **real** clock;
5. changes the row with **one compare-and-set UPDATE**: `id`, the row's own `user_id`, `status = 'failed'`, the expected `attempts`, no recorded send, and the queue's window predicate.

One `BOS_QUEUE_ITEM_RETRIED` audit row is flushed before the response, and only after a win.

Two findings change the scope SA set, and both are open points:
- **Carried item 3 (F-1, OP-1).** A same-day briefing retry **can** stay `pending` past midnight and then be sent with the next day's content under the old date: a double send. The fix proposed here is a small guard in the briefing **dispatcher** (a send-path change, flagged).
- **Carried item 4 (F-2, OP-2).** A retry **does** make BL-7a worse, but only on the lead-replies queue. The proposed minimum is BL-7a part (2) (bound and await the lead route's drain), landed **before** 7c's lead-reply retry.

New in 7c:
- one case in the existing route;
- one write method on `AdminQueueActionsRepository`;
- one pure companion in the eligibility module;
- one public method on `PaymentReminderService`, reached through one `lib/admin` helper;
- one guard in the briefing dispatcher;
- one dialog;
- one audit event.

There is **no migration**: `bos_queue_item` is already owner-hidden by `20261035`. No route is added: `adminGate.writes` stays at 59 and the census stays at 92.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify](#3-files-to-create--modify)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. The Live PostgREST Probe](#6-the-live-postgrest-probe)
- [7. Manual QA Check](#7-manual-qa-check)
- [8. Acceptance Criteria Traceability](#8-acceptance-criteria-traceability)
- [9. Risks and Rollback](#9-risks-and-rollback)
- [10. PR Body Draft](#10-pr-body-draft)
- [11. Effort Estimate](#11-effort-estimate)
- [12. Open Points for SA](#12-open-points-for-sa)

---

## 1. Analysis Summary

### 1.1 What exists on `50a30939`, and what 7c does with it

| Piece | As built | 7c |
|---|---|---|
| `lib/admin/jobs/queueItemEligibility.ts` | The C7-9 single source. `RETRY_FROM_STATUSES` is `['failed']` on four queues and `[]` on payment automations. Dead-lettered rows are status `failed` with the marker on these four tables. Retry rules in order: automations → `retry_not_offered`; status → `not_retryable_state`; briefing → `briefing_not_today` (today in the **row's** timezone), others → `retry_window_passed` with the inclusive bound `retryAt <= anchor + 72 h`; a missing anchor → `no_due_time`; an invalid clock fails closed. It has an `options.retryAt` hook "for 7c" | Called with the **real** clock (carried item 1) and, for reminders, `retryAt` = the next sending-hours time. **One additive pure export**, `retryWriteBound` (§2.2), so the CAS predicate comes from the same module as the decision (carried item 2). Nothing existing changes |
| `app/api/admin/jobs-queues/items/action/route.ts` | `QUEUE_ITEM_ACTIONS = ['cancel']` (in `buildQueueItemsView.ts`), strict Zod at both levels, `requireAdmin` first, an exhaustive `switch` with `assertNever`, `readRow` under a 5 s deadline, the shared `refuse()` helper | `'retry'` joins the list; one `case 'retry': return retryItem(…)`. The refusal sentences become per-action (they say "Nothing was cancelled" today) |
| `lib/repositories/AdminQueueActionsRepository.ts` | `cancelQueueItemAllAccounts`: one `.update(patch, { count: 'exact' })`, no `.select()`/`.or()`, a win only on `count === 1`, the frozen per-queue patch, the local table map, the single-caller guard | **One new method**, `retryQueueItemAllAccounts`, beside it (the file header already says so). The same discipline. Source pins move from "exactly one `.update(`" to "exactly two" |
| `CancelQueueItemDialog.tsx`, `QueueItemsPanel.tsx`, `JobsQueuesView.tsx` | The 7b dialog pattern (reason 3–500, outcome first, refresh on Close, "Close" never "Cancel"). The panel's Re-send cell is text only. The view header names Drain now and cancel | A **new** `RetryQueueItemDialog.tsx` with the same pattern. The panel's Re-send cell renders it when `item.retry.allowed`. The view and panel header sentences are updated |
| `lib/services/PaymentReminderService.ts` | `sendableAt(desired, userId)` is **private**. It reads `user_preferences.timezone` (per-instance cache, UTC fallback on a read error) and moves a time outside 08:00–20:00 to the next 08:00 | **One public wrapper**, `nextSendableAt` (C7-8). Reused, never copied |
| `lib/services/DailyBriefingDispatchService.ts` | `dispatchOne(row.user_id, row.timezone, now)` renders **today** (`businessDayFor(now, …)`), not `row.briefing_date` | **F-1**: one guard. A row whose `briefing_date` is not the run's business day is closed `skipped / stale_date` and never rendered (OP-1) |
| `lib/audit/*` | `BOS_QUEUE_ITEM_CANCELLED`; `bos_queue_item` is `'operator'` (`20261035` applied); catalogue **178**, `bos` **33** | New event `BOS_QUEUE_ITEM_RETRIED`. **No new entity type and no migration.** Catalogue 178 → 179, `bos` 33 → 34. Dropdown label "Item Retried" from the existing `BOS_QUEUE_` rule |
| `app/api/admin/jobs-queues/drain/__tests__/drain.source.guard.test.ts` | W7D-5: `runQueueDrain.ts` is the **only** importer of the five service modules under `app/api/admin`, `lib/admin` and `app/admin` | **F-3**: C7-8's wrapper needs one more importer. A narrow, counted amendment (§2.9, OP-3) |

### 1.2 The retry matrix per table (§C, C7-4, C7-5, C7-7, C7-8)

| Queue → table | Retry from | Window (route **and** CAS) | Patch (exact) | Never written |
|---|---|---|---|---|
| `payment_reminders` | `failed` (dead-lettered included) | `retryAt <= scheduled_at + 72 h`, where `retryAt` = `nextSendableAt(row owner, now)`. CAS: `.gte('scheduled_at', retryAt − 72 h)` | `{ status: 'pending', next_attempt_at: <retryAt ISO>, claimed_by: null, claimed_at: null }` | `attempts`, `error_message`, `scheduled_at`, `sent_at`, `invoice_id`, `installment_id`, `contact_id`, `channel`, `metadata`, `user_id` |
| `payment_automations` | **none** | — | — | **422 `retry_not_offered`** before any read (C7-5) |
| `daily_briefing_sends` | `failed` | `briefing_date` = today in the **row's** `timezone`. CAS: `.eq('briefing_date', <today>)` | `{ status: 'pending', next_attempt_at: null, claimed_by: null, claimed_at: null }` | `attempts`, `error_message`, `skip_reason`, `briefing_date`, `timezone`, `sent_at`, `user_id` |
| `lead_responses` | `failed` | `now <= created_at + 72 h`. CAS: `.gte('created_at', now − 72 h)` | the same as the briefing | `attempts`, `error_message`, `skip_reason`, `kind`, `contact_id`, `entity_id`, `sent_at`, `user_id` |
| `insight_actions` | `failed` | `now <= created_at + 72 h`. CAS: `.gte('created_at', now − 72 h)` | the same | `attempts`, `error_message`, `skip_reason`, `kind`, `dedupe_key`, payload / target columns, `sent_at`, `user_id` |

Every retry CAS also carries `.eq('status', 'failed')`, `.eq('attempts', <expected>)`, `.eq('user_id', <row owner>)`, `.eq('id', <row id>)` and **`.is('sent_at', null)`** (F-4, OP-6).

Why the patch clears `claimed_by` / `claimed_at` (§D.3): `PaymentReminderRepository.updateStatus` writes `failed` **without** clearing them (`:97-115`), so a runner-failed reminder keeps a stale claim. The other three tables already clear them on every terminal write and dead-letter. The claim overwrites both anyway; clearing them keeps the list's lease words honest.

Why `next_attempt_at` is `null` and not "now" on the three non-reminder tables (OP-5): every claim treats `NULL` as due (`next_attempt_at IS NULL OR next_attempt_at <= now()`). The lead and insight claims order `NULLS FIRST`. And `NULL` takes no time from the app clock, which can be a few seconds ahead of the database clock.

### 1.3 Facts that bound the design

- **Who can be the "earlier runner" of a `failed` row, per queue.** This decides how safe a retry is.
  - **Payment reminders.** Claimed only by the cron (`maxDuration = 60`, awaited) and Drain now (`maxDuration = 60`, awaited). `sendReminder` (ad-hoc, no claim) has **no caller** in `app/` or `lib/`. A reminder is `failed` after its runner's own `updateStatus` (the send failed), or after the reaper dead-letters it (attempts ≥ 5).
  - **Briefing and insight actions.** Claimed only by their cron and by Drain now. Both are awaited, with `maxDuration = 60`.
  - **Lead replies.** Claimed by the cron, by Drain now, **and by `PATCH /api/business-os/leads/[id]` "send now"**. That route calls `dispatchLeadResponses()` **fire-and-forget** and exports no `maxDuration` (B7-11). A lead row becomes `failed` **only** through the reaper's dead-letter: a throw leaves it `processing` (`LeadResponseDispatchService.ts:106-109`). So **every** failed lead row is a row whose runner never closed it within the lease.
- **How a retry is sent:** only through `claim_due_*`, which takes `status = 'pending'` rows with `next_attempt_at` due (`payment_reminders` also needs `scheduled_at <= now()`). Each claim bumps `attempts`. No claim takes `failed`.
- **One retry = one more try** (B7-8, re-checked):
  - reminders: a failure writes `failed` at once, and a crash at attempts ≥ 5 is dead-lettered;
  - briefing: `markFailed` when `attempts >= 3`, and a crash is dead-lettered;
  - lead replies: a throw is left `processing`, then dead-lettered at ≥ 3;
  - insight actions: `markFailed(retryable = attempts < 5)`, so at ≥ 5 it is terminal.

  A retried row arrives with `attempts` at or past its limit, so the next failure closes it. No backoff loop follows.
- **What is re-checked at send time** (B7-6). Reminders: a settled invoice or installment is skipped as `cancelled`. Lead replies: consent, applicability, booking state, appointment passed. Insight actions: the daily cap, a settled invoice, the business. The briefing re-renders the day's facts.
- **Live data (SA 7a §A, 7b §1.3):** there were **no** `failed` rows on any queue. So no live row is retryable today (§7, OP-17).

### 1.4 Finding F-1 (carried item 3): a same-day briefing retry CAN be sent under a stale date

**The proof, from the code on `50a30939`:**

1. **The claim has no date predicate.** `claim_due_daily_briefings` selects `status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now())` (`20260911_daily_briefing.sql:138-146`). A `pending` row from yesterday is claimable today.
2. **The dispatcher renders "now", not the row's date.** `processDueBriefings` passes `(row.user_id, row.timezone, now)` (`DailyBriefingDispatchService.ts:74`). `dispatchOne` builds `businessDayFor(now, timezone)` and renders **that** day's facts (`:169-171`), with `date: day.date` in the email (`:237`). `row.briefing_date` is never read.
3. **The send window gates the enqueue, not the claim.** The 07:00–10:59 window is checked only in `enqueueDueBusinesses` (`:147-148`). A retried row is claimed by the next run, whatever the hour.
4. **The cron runs hourly, at :10 UTC** (`vercel.json`), so no run is guaranteed between the retry and midnight:
   - whole-hour zones: the last run of a business day is at about 23:10 local. A retry pressed from then until midnight waits for the 00:10 run;
   - half-hour zones such as Asia/Kolkata: the last run is at 23:40 local;
   - **if the cron is down** (a missing `CRON_SECRET` is the very case these tools exist for), a retried row waits for however long the outage lasts.
5. **The next day's own row is still created.** `UNIQUE(user_id, briefing_date)` sees a different date, so the morning enqueue inserts a new row.

So a retry pressed late in the business day goes out after midnight with **the new day's content** on the old row. The new day's own row then sends again: the **B7-4 double send**. Today the reaper path cannot reach midnight (a row enqueued by 10:59, three attempts, backoff ≤ 1 h). A cron outage that spans midnight can, so this is also a latent pre-existing defect.

**Route-side refusal alone cannot close it.** "Refuse unless N minutes of the day remain" assumes the cron will run in time, which a cron outage defeats.

**Proposed guard (G-B, a dispatcher change, flagged for SA, OP-1).** In `processDueBriefings`, compute the run's business day **once per row** and pass it into `dispatchOne`, so the date checked is the date rendered. If `row.briefing_date !== day.date`, close the row `skipped` with `skip_reason = 'stale_date'`, log at `info`, count it as skipped, and **never** build facts, narrate or send (§2.5).
- **Normal operation is unchanged.** Rows are enqueued with that zone's today and claimed the same morning.
- **Drain now gets the guard too**, because it runs the same function.
- **The pre-existing outage case is fixed as well.**

Edge, accepted: one run straddling midnight. `now` is fixed at the run's start, so a row claimed at 00:00:30 by a run that began at 23:59:50 is checked **and** rendered for the old day. It is the old day's briefing, sent once, a minute late. It is not a double.

### 1.5 Finding F-2 (carried item 4): BL-7a and retry

**Does a retry make BL-7a worse? Yes, on the lead-replies queue only.**

The lease rule (`durable-queue-drain` Step 3): a row still `processing` after 90 s is provably dead, because the platform hard-kills the function at `maxDuration = 60`. That holds on every claim path **except** the lead route's fire-and-forget drain (B7-11). That drain is not awaited and not bounded at 60 s. On Vercel it can keep running after the response, or be frozen with the instance and resumed later. Nothing proves it dead at 90 s.

The scenario retry creates:
1. The lead route's drain (runner Z) claims lead row L, which is at `attempts = 2` (it has failed twice before), and outlives its lease.
2. The 5-minute cron's reaper sees L `processing` past 90 s with `attempts >= 3`, and dead-letters it: `failed`, `claimed_by = NULL`.
3. **Without 7c:** Z resumes, sends once, and `finish(sent)` (fenced by id only) overwrites `failed` with `sent`. **One send.**
4. **With 7c:** an admin sees L `failed` and retries it. It goes back to `pending`, the cron claims it and sends (send #1). Z resumes and sends from the row it already holds in memory (send #2). **A retry turns a dead-lettered row that a live runner still owns into a second live claim.**

On the other three retryable queues every runner is awaited and bounded at 60 s, so a `failed` row's last runner is provably dead and a retry cannot race it.

**What BL-7a part (1) does and does not do.** Fencing terminal writes on `claimed_by` stops Z's `finish` from overwriting the newer runner's state. It does **not** stop Z's send: Z already holds the row and sends before it writes. So (1) is about state accuracy, and it is **not** needed for 7c.

**The minimum guard is BL-7a part (2):** bound and await the lead route's drain (`export const maxDuration = 60`, and `await` the drain instead of fire-and-forget), so the 90 s lease is provably dead on every lead claim path. Two options for SA (OP-2):
- **(a) Recommended:** land BL-7a(2) as its own small SA-reviewed PR **before** 7c (about 0.5 day). 7c then retries all four queues as specified.
- **(b)** Ship 7c with lead-reply retry **held**: a 422 `retry_held` on `lead_responses` until BL-7a(2) lands. That needs one new code in the eligibility module, the list and the dialog. Payment reminders, the briefing and insight actions are unaffected.

Option (c), shipping lead retry before BL-7a(2), is not recommended. The bad case needs a "send now" press, a frozen instance and an admin retry inside the freeze. That is rare, but this slice exists to make double sends impossible, not rare.

The product cost of (a): the owner's "send now" response waits for the drain, which processes at most 25 rows, instead of returning at once. That is a business-visible trade-off for the BL-7a review, and it is not decided here.

### 1.6 Finding F-3: C7-8's wrapper conflicts with the W7D-5 guard

C7-8 asks for "a small public method on `PaymentReminderService`", reused, never copied. Two existing pins forbid importing that service on the admin path:
- **W7D-5** (`drain.source.guard.test.ts` S-2): `runQueueDrain.ts` must be the **only** file under `app/api/admin`, `lib/admin` and `app/admin` that imports any of the five service modules;
- **W7B-6** (route test T-5): the action route imports nothing from `lib/services/`.

**Proposed (OP-3):** a new server-only helper, `lib/admin/jobs/reminderRetryTime.ts`, is the one extra importer. It imports exactly `paymentReminderService` and calls exactly `.nextSendableAt(`. The action route imports the helper, so W7B-6 stays true **unchanged**. W7D-5 is amended narrowly: the importer set becomes exactly `[runQueueDrain.ts, reminderRetryTime.ts]`, with a pin on the helper's single member call and a forbidden-name list (`processDueReminders`, `processOverdueItems`, `billDueDatedStages`, `markAllOverdueInvoices`, `sendReminder`, `scheduleReminder`, `emitPaymentEvent`).

The alternative is to extract the window arithmetic into a pure `lib/payments` module that the service and the admin route would both call. It is rejected as the default, because it changes the live scheduling code and splits the zone resolution in two.

### 1.7 Finding F-4: a `failed` row can carry a recorded send

`sent_at` exists on all four retryable tables (SA §A). A `failed` row with `sent_at` set means a runner recorded a delivery and something later marked the row failed. Two ways this can happen:
- **Payment reminders:** the drain's catch branch writes `failed` without clearing `sent_at` (`PaymentReminderService.ts:1012-1019`);
- **Insight actions:** a BL-7a-style late runner's `markFailed` lands after a newer runner's `markSent`.

Both are rare. But re-arming a row whose send is **recorded** is the one double send that can be ruled out for free. **Proposed (OP-6):** the CAS adds `.is('sent_at', null)` as a filter-only predicate. `sent_at` is not added to any read, so C7-12's column list does not move.

### 1.8 AI and credit attribution (carried item 5, `bos-llm-call-standards`)

| Queue | Does the retried send call AI or charge credits? | Attribution |
|---|---|---|
| Daily briefing | **Possibly one narration.** `getBriefing(…, 'scheduled', …)` serves the cached narrative when today's facts hash is unchanged, so there is no call. When the facts moved since the cached narration, it runs **one** `runAiAction({ area: 'briefing', actionType: 'briefing_narration', trigger: 'scheduled', accountId: row.user_id })` | Charged to **the business's account** at its normal measured cost (option B), `actorId` = the platform actor (`trigger 'scheduled'`), grouped by the briefing's day. **Never the admin**: the send runs in the cron or Drain now, and nothing in the admin path calls the LLM layer. No new catalogued call, no model literal |
| Lead replies | No. The dispatch path (`LeadResponseDispatchService`, `LeadBookingLinkService`, `InvoiceDeliveryService`, `BookingEmailService.sendMeetingReminder`) makes no `runAiAction` or provider call (grepped) | Email only |
| Insight actions | No (grepped) | Email only |
| Payment reminders | No (grepped) | Email only |

So an admin retry costs the owner **at most one briefing narration, at the normal price, and only when the day's figures changed**. Whether the owner should pay for an admin-initiated retry at all is a small business question (OP-9). The default is the normal cost, which is what the cron would have charged had the first attempt worked.

### 1.9 Admin surface (C7-14), logging (C7-15) and deprecated patterns

- **Same route, same handler.** `adminGate.writes` `CASES` stays at **59** (`adminGate.writes.test.ts:420`, verified on `50a30939`); its existing case keeps `action: 'cancel'`. The census stays at **92 = 86 + 6 + 0, 63 files**, and the register stays at row 95, whose **text** is updated in place to name retry (T13). `npm run test:authz-guard` passes on the base (119 / 119, run 2026-10-04). No `CAPS` value moves.
- **`console.*`** counted on `50a30939`: **0** in every file this slice modifies (the route, `AdminQueueActionsRepository.ts`, `queueItemEligibility.ts`, `PaymentReminderService.ts`, `DailyBriefingDispatchService.ts`, `QueueItemsPanel.tsx`, `JobsQueuesView.tsx`, `CancelQueueItemDialog.tsx`, `jobsQueuesTypes.ts`, `buildQueueItemsView.ts`, `events.ts`, `eventAudience.ts`, `page.tsx`).
- **Flagged, not extended (CLAUDE.md rule 1, "Deprecated").** `PaymentReminderService.ts` makes 11 direct `.from(` calls and `DailyBriefingDispatchService.ts` makes 4. 7c adds none:
  - the wrapper reuses `businessZone`'s existing read;
  - the dispatcher guard uses the existing `markSkipped`.

  Moving them behind repositories is the existing backlog (access doc OI-9 spirit), not this slice.

---

## 2. Implementation Approach

### 2.1 Request flow (the route, `retryItem`)

**File:** `app/api/admin/jobs-queues/items/action/route.ts` (modify)

```typescript
switch (body.action) {
  case 'cancel':
    return cancelItem({ request, requestLogger, correlationId, adminId, body });
  case 'retry':
    return retryItem({ request, requestLogger, correlationId, adminId, body });
  default:
    return assertNever(body.action);
}
```

Steps after the gate and the parse, in this order. Each refusal is a fixed sentence in the standard error format, with `details` in development only.

| # | Step | On refusal |
|---|---|---|
| 1 | **Queue rule first (W7A-1, C7-5):** `queue === 'payment_automations'` | **422 `retry_not_offered`**. Nothing is read |
| 2 | **"From" check before any read (§D.2):** `expected.status ∈ RETRY_FROM_STATUSES[queue]` (that is, `'failed'`) | **422 `not_retryable_state`**. Nothing is read |
| 3 | **Read the row:** `readRow(args, timings)` (the 7b helper, 5 s deadline) | error or time-out → **500 `action_failed`**; no row in that queue's table → **404 `item_not_found`** |
| 4 | **Still what the admin saw?** status and attempts | **409 `item_changed`** with `current`. No update, no audit row |
| 5 | **The clock (carried item 1):** `const now = new Date()`, **once**. It is used for eligibility, for the CAS bound and for nothing else. The list's minute-floored clock is never imported | — |
| 6 | **Reminders only (C7-8):** `retryAt = await underDeadline(… reminderRetryTime(row.userId, now) …)`. The owner is always the row's own `user_id` | error or time-out → **500 `action_failed`**. Nothing is written |
| 7 | **Eligibility (C7-9):** `queueItemEligibility(queue, factsOf(row), now, { retryAt })` | **422** with the module's code (`retry_window_passed`, `briefing_not_today`, `no_due_time`, `not_retryable_state`) and `anchorAt` (the §E anchor as ISO, never an account id) |
| 8 | **The CAS bound (carried item 2):** `bound = retryWriteBound(queue, factsOf(row), now, retryAt)`, from the same module (§2.2) | `null` (impossible after step 7) → **500 `action_failed`**. Nothing is written |
| 9 | **CAS (C7-3):** `adminQueueActionsRepository.retryQueueItemAllAccounts(ctx, { queue, itemId: row.id, ownerUserId: row.userId, expected: { status: row.status, attempts: row.attempts }, bound, nextAttemptAt: queue === 'payment_reminders' ? retryAt.toISOString() : null })` | see 10–12 |
| 10 | **Won** (`count === 1`): log `info` "Queue item retried" with `{ adminUserId, queue, itemId, from, to: 'pending', nextAttemptAt }` → **`await logAndFlush(BOS_QUEUE_ITEM_RETRIED …)`** → **200** | — |
| 11 | **Lost** (`count === 0`): re-read once | gone → **404**; status or attempts moved → **409 `item_changed`** with `current`; **unchanged** → re-run eligibility with a fresh `new Date()` and the same `retryAt` (`max` of the two). If it now refuses → **422** with that code (the window closed between check and write). If it still allows → **422 `not_retryable_state`**, logged at `warn` with `cause: 'write_predicate'` (only the `sent_at` fence remains, F-4, OP-7). **No second update and no audit row** |
| 12 | **Unconfirmed** (an error, or a `count` other than 0 or 1, or a throw after the CAS was sent) | **500 `outcome_unknown`**, logged at `error`. No audit row |

**Refusal sentences become per-action.** `SENTENCES` becomes `Record<QueueItemAction, Record<…, string>>`, so a retry never answers "Nothing was cancelled". The cancel sentences are unchanged byte for byte (pinned). For retry:

| Code | Sentence |
|---|---|
| `retry_not_offered` | "Payment automations are never re-sent from here. They can be cancelled." |
| `not_retryable_state` | "This item can no longer be retried. Nothing was changed." |
| `retry_window_passed` | "This item is more than 72 hours past when it was due, so it can be cancelled but not retried. Nothing was changed." |
| `briefing_not_today` | "This briefing's day has passed in the business's time zone, so it can be cancelled but not retried. Nothing was changed." |
| `no_due_time` | "This item has no due time recorded, so it cannot be retried. Nothing was changed." |
| `item_not_found` | "This item is no longer in this queue. Nothing was retried." |
| `item_changed` | "This item changed since the list was loaded. Nothing was retried." |
| `action_failed` | "Could not read the item just now. Nothing was retried." |
| `outcome_unknown` | "The retry could not be confirmed. Check the item's status before trying again." |

**200 body (retry):** `{ success: true, data: { queue, itemId, action: 'retry', before: { status, statusLabel }, after: { status: 'pending', statusLabel: 'Waiting' }, nextAttemptAt } }`. `nextAttemptAt` is ISO for reminders and `null` otherwise. Exactly these keys (OP-14).

**422 body (retry window codes):** the standard body plus `anchorAt` (ISO or `null`), which the dialog formats. `anchorAt` is the §E anchor already shown in the list (the due time, the queue time or the business day's start). It is not content and not an id.

**What the route never does:** send, drain or claim; import a service directly (W7B-6 pin unchanged); call `.from(` (C7-12); log the reason; take a time, owner or patch value from the body.

### 2.2 The eligibility companion: `retryWriteBound` (C7-9, carried items 2 and 3)

**File:** `lib/admin/jobs/queueItemEligibility.ts` (modify, additive; nothing existing changes)

```typescript
export type RetryWriteBound =
  | { column: 'scheduled_at' | 'created_at'; gte: string }   // ISO; the anchor must be at or after this
  | { column: 'briefing_date'; eq: string };                  // 'YYYY-MM-DD'

/** The CAS predicate that re-checks, inside the write, exactly what queueItemEligibility decided. */
export function retryWriteBound(
  queue: BosQueueId, facts: QueueItemFacts, now: Date, retryAt?: Date
): RetryWriteBound | null;
```

- **Payment reminders:** `{ column: 'scheduled_at', gte: (retryAt − 72 h).toISOString() }`, never `now − 72 h`. `retryAt <= anchor + 72 h` is the same inequality as `anchor >= retryAt − 72 h`.
- **Lead replies and insight actions:** `{ column: 'created_at', gte: (now − 72 h).toISOString() }`.
- **Briefing:** `{ column: 'briefing_date', eq: businessDayFor(now, facts.timezone ?? 'UTC').date }`. This is the same zone fallback the eligibility check and the dispatcher use.
- **Payment automations**, an invalid clock or an invalid `retryAt` → `null` (fail closed).
- **Precision (carried item 3 of the 7a list):** Postgres keeps microseconds and `Date.parse` keeps milliseconds. The parsed anchor is never later than the stored one, so the function's allow is never looser than the CAS. A boundary test pins this direction (§5.12, E-4).

### 2.3 The write: `AdminQueueActionsRepository.retryQueueItemAllAccounts` (`new-repository`, `tenant-isolation-guard`)

```typescript
/** The constant part of the retry patch (C7-4). Frozen; never built from input. */
export const ADMIN_QUEUE_RETRY_PATCH: Readonly<Record<RetryableQueueId, Readonly<Record<string, string | null>>>> = Object.freeze({
  payment_reminders:    Object.freeze({ status: 'pending', claimed_by: null, claimed_at: null }),   // + next_attempt_at from input
  daily_briefing_sends: Object.freeze({ status: 'pending', claimed_by: null, claimed_at: null, next_attempt_at: null }),
  lead_responses:       Object.freeze({ status: 'pending', claimed_by: null, claimed_at: null, next_attempt_at: null }),
  insight_actions:      Object.freeze({ status: 'pending', claimed_by: null, claimed_at: null, next_attempt_at: null }),
});
type RetryableQueueId = Exclude<BosQueueId, 'payment_automations'>;

export interface RetryQueueItemInput {
  queue: BosQueueId;
  itemId: string;
  /** The row's own user_id, as the route read it. NEVER from a request. */
  ownerUserId: string;
  expected: { status: string; attempts: number };
  /** From retryWriteBound. Its column must be this queue's (checked). */
  bound: RetryWriteBound;
  /** payment_reminders only: the next sending-hours time, ISO. null on every other queue. */
  nextAttemptAt: string | null;
}

async retryQueueItemAllAccounts(
  context: AdminActionContext,
  input: RetryQueueItemInput
): Promise<RepositoryResult<{ outcome: 'retried' | 'not_matched' }>>;
```

The one UPDATE:

```typescript
const patch = queue === 'payment_reminders'
  ? { ...ADMIN_QUEUE_RETRY_PATCH[queue], next_attempt_at: input.nextAttemptAt }   // validated ISO, computed server-side
  : { ...ADMIN_QUEUE_RETRY_PATCH[queue] };
let query = this.supabase
  .from(ADMIN_QUEUE_ACTION_TABLES[queue])
  .update(patch, { count: 'exact' })
  .eq('id', input.itemId)
  .eq('user_id', input.ownerUserId)
  .eq('status', input.expected.status)          // 'failed', checked against RETRY_FROM_STATUSES first
  .eq('attempts', input.expected.attempts)
  .is('sent_at', null);                          // F-4, OP-6
query = 'eq' in bound ? query.eq(bound.column, bound.eq) : query.gte(bound.column, bound.gte);
const { error, count } = await query;            // NO .select(), NO .or()
```

- **Refuses with no request when:**
  - the context is missing, or the queue is unknown;
  - the queue is `payment_automations` (C7-5, a second line of defence);
  - `expected.status ∉ RETRY_FROM_STATUSES[queue]`, or `attempts` is not a non-negative integer;
  - either id is empty;
  - the bound's column is not this queue's (`RETRY_ANCHOR_COLUMN[queue]`, exported beside `retryWriteBound`), or its value does not parse (ISO instant / `YYYY-MM-DD`);
  - `nextAttemptAt` is missing or not a valid ISO instant on `payment_reminders`, or is present on any other queue.
- **Outcome:** `count === 1` → `retried`; `count === 0` → `not_matched`; an error or any other count → an error (`count_unconfirmed` or the PostgREST code). The same rules as cancel, sharing the private count interpreter.
- **Imports, never copies,** `RETRY_FROM_STATUSES`, `RETRY_ANCHOR_COLUMN` and the `RetryWriteBound` type from the eligibility module.
- **Logs** `{ correlationId, adminUserId, queue, itemId, from, outcome }` only, never the owner id, the bound or the patch. **Never throws.**
- **The single-caller guard is unchanged** (only the action route). The header gains the retry paragraph: "back to `pending` for exactly one more claim; never sends; never resets attempts".

### 2.4 The reminder's next sending time (C7-8, F-3)

**`lib/services/PaymentReminderService.ts` (modify, additive):**

```typescript
/**
 * The soonest moment a reminder may go out, for a desired time: the same rule
 * `sendableAt` applies when a reminder is scheduled. Public for the admin retry
 * (ADMIN_BOS_CLEANUP slice 7c, SA C7-8): reuse it, never copy the window.
 */
async nextSendableAt(userId: string, desired: Date): Promise<Date> {
  return new Date(await this.sendableAt(desired, userId));
}
```

There is no other change to the service. The private `sendableAt`, `businessZone`, the window constants, the drain and the scheduling paths are untouched (pinned by the PR diff and §5.13).

**`lib/admin/jobs/reminderRetryTime.ts` (new, `import 'server-only'`):**

```typescript
import 'server-only';
import { paymentReminderService } from '@/lib/services/PaymentReminderService';

/** The retried reminder's next sending-hours time. The ONLY service call on the admin action path (W7D-5 as amended). */
export function reminderRetryTime(ownerUserId: string, now: Date): Promise<Date> {
  return paymentReminderService.nextSendableAt(ownerUserId, now);
}
```

The route wraps the call in `underDeadline` (5 s). A failure or time-out is a 500 `action_failed`, and nothing is written.

**Accepted behaviour, inherited (OP-4):**
- the zone read falls back to UTC on an error, as every scheduled reminder does;
- the zone is cached per instance with no expiry, so a just-changed business timezone may be used late on a warm admin instance.

### 2.5 The briefing dispatcher guard (F-1, OP-1)

**File:** `lib/services/DailyBriefingDispatchService.ts` (modify; a send-path change, so SA reviews it explicitly)

```typescript
for (const row of claimed.data) {
  // One business day per row, used for BOTH the check and the render (B7-4,
  // ADMIN_BOS_CLEANUP 7c F-1): a row is sent only on its own date. The claim
  // has no date predicate, so a row left pending past midnight (an admin
  // retry, a cron outage) would otherwise render the next day under the old
  // date, and that day's own row would send again.
  const day = businessDayFor(now, row.timezone);
  if (row.briefing_date !== day.date) {
    await dailyBriefingSendRepository.markSkipped(row.id, 'stale_date');
    summary.skipped += 1;
    logger.info({ userId: row.user_id, briefingDate: row.briefing_date, runDate: day.date }, 'Briefing row is not for today; closed without sending');
    continue;
  }
  try {
    const outcome = await dispatchOne(row.user_id, day, now);
    …unchanged…
```

- `dispatchOne(userId, day, now)` takes the `BusinessDay` instead of recomputing it from the timezone. A one-line signature change inside the module; it is not exported.
- `markSkipped` already clears the claim (`markTerminal`), so the row is closed and the reaper ignores it.
- `stale_date` is a fixed reason code. The admin list never shows skip reasons. The owner's briefing card counts it under "Skipped (expected)", which is honest.
- Nothing else in the file changes: the enqueue window, the reaper, the claim, the batch and the constants.

### 2.6 Wire types (`lib/admin/jobs/jobsQueuesTypes.ts`, types only)

- `QueueItemAction = 'cancel' | 'retry'`; `QUEUE_ITEM_ACTIONS = ['cancel', 'retry']`.
- `QueueItemActionResult` becomes a union by `action`. The retry member adds `nextAttemptAt: string | null`.
- `QueueItemActionRefusal` gains `'retry_not_offered' | 'not_retryable_state' | 'retry_window_passed' | 'briefing_not_today' | 'no_due_time'`. These are the existing `QueueItemRetryRefusal` codes, referenced, not redeclared.

### 2.7 Audit (C7-13, SA §G)

The same timing as 7b (OP-1 ruling there): written **after** the winning CAS and **before** the response, never for a lost or refused retry. The trace order is fixed (W7B-2): Pino line → `await logAndFlush` → 200.

```typescript
await logAndFlush(
  {
    action: AUDIT_EVENTS.BOS_QUEUE_ITEM_RETRIED,
    entityType: 'bos_queue_item',          // already 'operator' + owner policy 20261035 (UC-9)
    entityId: row.id,
    userId: row.userId,                    // the item's account
    actorId: adminId,
    severity: 'warning',
    changes: {
      before: { status: row.status, attempts: row.attempts },
      after: { status: 'pending', next_attempt_at: nextAttemptAt },   // ISO (reminders) or null
    },
    details: { reason, queue, action: 'retry', correlationId, dueAnchor: eligibility.anchorAt },
    request,
  },
  requestLogger,
  { reason: 'queue item retry', continues: 'the retry stands regardless' }
);
```

- **`details` keys exactly** `reason, queue, action, correlationId, dueAnchor`, as 7b's. `deadLettered` is **omitted** (OP-8): getting it would mean reading `error_message` or a head count, and `changes.before.attempts` already shows an exhausted row.
- **Never in the row:** error text, `skip_reason`, payload, contact, invoice, booking or rule ids, client names, the sending-hours zone.
- **Registrations:**
  - `events.ts`: `BOS_QUEUE_ITEM_RETRIED`, with metadata `{ severity: 'warning', complianceFlags: ['SOC2'], description: 'An admin put one failed Business OS queue item back for exactly one more send attempt' }`;
  - `eventAudience.ts`: `'bos'`;
  - the size ratchet: **178 → 179, `bos` 33 → 34**, with a dated comment line.
- **No change** to `types.ts`, `ownerVisibility.ts`, the owner policy, the data-export pins or `filterOptions.ts`. The group is "Business OS Queues" and the label "Item Retried".

### 2.8 UI

**New `app/admin/components/jobs/RetryQueueItemDialog.tsx`** (`'use client'`). It follows the 7b dialog pattern exactly: `DARK_DIALOG`, a required reason of 3–500 characters, cannot be dismissed while busy, the outcome shown first, refresh on Close (7b D-1), fixed sentences only. It reuses `KNOWN_STATUS_LABELS` by import from `./CancelQueueItemDialog` (OP-15).

- **Trigger (in the Re-send cell):** a small **"Retry item"** button, rendered only when `item.retry.allowed`. Under it, the 7a "until …" words stay as small text.
- **Wording:** the action is always "Retry item" (the trigger and the confirm button). The dismiss button is **"Close"**. While busy: "Retrying…". After a result only "Close" remains.
- **Title:** "Retry this item?" **Description:** "{kindLabel} for {businessName} · item {8 characters} · {statusLabel} · {attempts} attempts so far".
- **Body (fixed text):**
  - "Retrying puts this item back in its queue for **one more try**. Nothing is sent from here: the queue sends it on its next run, or when Drain now is pressed for this queue. If it fails again, it is closed as failed."
  - **Known-risk warning** (an amber box, C7-13): "If an earlier attempt was actually delivered but not recorded, **{the client | the business owner}** may receive it twice." The briefing says "the business owner"; the other three say "the client".
  - **What happens next, per queue:**
    - **reminders:** "It is sent at the next time inside the business's sending hours (08:00–20:00 in its time zone), on the hourly reminders run after that. If the invoice has been paid by then, it is not sent. If the business's next scheduled reminder for this invoice falls due meanwhile, the client may get both that day." (OP-10)
    - **briefing:** "Only today: it is sent by the next hourly briefing run while it is still {briefing date} in the business's time zone, which may be well after the usual morning time. If no run happens before midnight there, it is closed without being sent. If the day's figures changed, writing it again uses AI, charged to the business at its normal rate." (OP-1, OP-9)
    - **lead replies:** "It is sent on the next lead-replies run (every 5 minutes), after the queue checks again that the business still allows it and that it still applies (for example, the lead has not booked)."
    - **insight actions:** "It is sent on the next run (every 15 minutes), after the queue checks the daily limit and the invoice or booking again."
  - "The business is not told. Your reason is kept in the admin audit trail." (UC-9)
- **Reason:** a required input labelled "Why are you retrying this item? (at least 3 characters)", with `maxLength={500}` and the hint "Don't paste client details." Confirm stays disabled until `reason.trim().length >= 3`.
- **POST:** `fetch('/api/admin/jobs-queues/items/action', { method: 'POST', headers, body: JSON.stringify({ queue: queueId, itemId: item.id, action: 'retry', expected: { status: item.status, attempts: item.attempts }, reason: reason.trim() }) })`. No other field: the client never sends a time.
- **Double-click:** a ref guard in the same tick, so there is **one** request.

**Outcomes** (fixed sentences; server `error` and `details` never rendered):

| Response | Sentence | Refresh on Close |
|---|---|---|
| 200 | "Queued for one more try. The queue sends it on its next run." Reminders add: "Not before {formatUtc(nextAttemptAt)} (the business's sending hours)." | yes |
| 409 `item_changed` | "This item changed since the list was loaded (it is now {label}). Nothing was retried." | yes |
| 404 | "This item is no longer in this queue. Nothing was retried." | yes |
| 422 `retry_window_passed` | Reminders: "This reminder was due {formatUtc(anchorAt)}. Its next sending-hours time is more than 72 hours after that, so it can be cancelled but not retried." Others: "This item was queued {formatUtc(anchorAt)}, more than 72 hours ago, so it can be cancelled but not retried." | yes |
| 422 `briefing_not_today` | "This briefing's day has passed in the business's time zone, so it can be cancelled but not retried." | yes |
| 422 `retry_not_offered` / `not_retryable_state` / `no_due_time` | "This item can no longer be retried." | yes |
| 400 | "This request was not accepted. Nothing was retried. Close this and try again." | no |
| 401/403 | "Your admin session has ended. Sign in again." | no |
| 500 `action_failed` | "Could not read the item just now. Nothing was retried." | yes |
| any other 500, a non-JSON body or a rejected fetch | "The request did not complete, so the item may or may not have been put back in its queue. The list refreshes when you close this; check its status there." | yes |

`anchorAt` and `nextAttemptAt` are rendered only when they parse as dates. Otherwise the sentence drops the time.

**Logging:** `createLogger({ module: 'AdminRetryQueueItemDialog' })`, with `{ queue, status, code }` on a non-2xx and `{ err, queue }` on a rejected fetch. The reason, the item id and the body are never logged.

**`QueueItemsPanel.tsx`:**
- The Re-send cell becomes `{item.retry.allowed ? (<RetryQueueItemDialog … onChanged={onChanged} />) : resendWords(queueId, item)}`. The dialog renders the "until …" words under its trigger, so `resendWords` keeps only its refusal branches.
- The header line becomes: "Items marked cancellable can be closed from their row, and items with a re-send window can be retried from theirs. Failed items keep no failure time, so their age is counted {anchor}." There is still no capital-C "Cancel" and no capital-R "Retry" word.

**`JobsQueuesView.tsx`:** the header sentence becomes **"Each queue has a Drain now button; a waiting, failed or orphaned item can be cancelled, and a recently failed item can be retried, from its queue's list; everything else here is read-only."** It names "Drain" once, has no capital-C "Cancel" and no "Retry" word.

**`page.tsx`:** comment only ("… cancelling or retrying one item").

### 2.9 Guard amendments (OP-3 style, exactly; OP-16)

**`app/admin/__tests__/jobsQueues.source.guard.test.ts`:**
- **`page.tsx`, `JobsQueuesView.tsx`:** every rule unchanged except `VIEW_HEADER_SENTENCE` (the new text).
- **`QueueItemsPanel.tsx`:** stays in `FILES` with every read-only rule (no `Retry|Requeue|Cancel|Drain` word, one GET, three `<button`, no `onClick` in a `<td>`, no write method). **One more counted allowance:** exactly one `<RetryQueueItemDialog\b` element, which must be the allowed branch `item.retry.allowed ?` of the **second-to-last** `<td>` (Re-send). The `<CancelQueueItemDialog` pin on the last cell is unchanged, and neither element may appear in any other cell. The case asserting that `'RetryQueueItemDialog'` does not match `\bRetry\b` is added beside the Cancel one.
- **New `RetryQueueItemDialog.tsx`** joins `CLIENT_FILES`, plus:
  - exactly one `method: 'POST'`;
  - exactly one `fetch(`, to the literal `'/api/admin/jobs-queues/items/action'`;
  - exactly one `JSON.stringify(` matching the §2.8 body with `action: 'retry'`;
  - no `userId|accountId|ownerUserId|user_id|nextAttemptAt|retryAt|scheduled` inside the body;
  - no `Cancel` (capital C), `Requeue` or `Drain` word;
  - no green, no console, no `OK`;
  - no `.error|.details|.message` read from a response;
  - "Retry item" present.
- **`CancelQueueItemDialog.tsx`:** unchanged. It still forbids `Retry`, and it now **exports** nothing new (the label set is already exported).

**`app/api/admin/jobs-queues/drain/__tests__/drain.source.guard.test.ts` (W7D-5, F-3):**
- S-2's walk expects exactly `[RUNNER, 'lib/admin/jobs/reminderRetryTime.ts']`.
- New **S-10**:
  - the helper's runtime imports are exactly `server-only` and `paymentReminderService` from `@/lib/services/PaymentReminderService`;
  - its code contains exactly one `paymentReminderService.` member access, and it is `.nextSendableAt(`;
  - it names none of `processDueReminders`, `processOverdueItems`, `billDueDatedStages`, `markAllOverdueInvoices`, `sendReminder`, `scheduleReminder`, `emitPaymentEvent`, `PaymentEventService`, `CRON_SECRET`, `/api/cron`;
  - its return is the awaited or returned promise, never fire-and-forget.
- S-1 (runQueueDrain's own imports) and S-3..S-9 are unchanged.

**Route suite T-5 / W7B-6 pin:** unchanged and still true. The route imports `@/lib/admin/jobs/reminderRetryTime`, not a service. One assertion is added: the route names no `processDue`, `drain`, `claim_due` or `rpc(` (send-path names).

**Repository R-10 pins:** "exactly one `.update(`" becomes **exactly two** (cancel, retry). `RETRY_FROM_STATUSES` and `RETRY_ANCHOR_COLUMN` are imported, not redeclared. Still no `.or(`, `.select(`, `.insert(`, `.upsert(`, `.delete(`, `.rpc(`, `error_message` or `...input`.

**Unchanged:** `adminGate.writes` (59), the authz guard and its `CAPS`, the `AdminJobsQueuesRepository` guards, `jobsQueues.render.test.tsx` (panels closed: 1 + 5 + 5 buttons).

### 2.10 Doc fix carried from 7b (stale §10)

`docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7B_WORKPLAN.md` §10 still shows the pre-rebase numbers. Two targeted edits, each with a dated note (the merged PR #211 body already carried the right figures):
- "Registrations": `access register row 93 (and row 94 …); census 91 = 85 + 6 + 0, 62 files` → **`row 95; census 92 = 86 + 6 + 0, 63 files`** (CR7B-2);
- "Verified live": `negative control 42703` → **`negative control PGRST204 (42703 also passes)`** (CR7B-1).

---

## 3. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/api/admin/jobs-queues/items/action/route.ts` | modify | `case 'retry'`, `retryItem`, per-action sentences, 422 `anchorAt` |
| `lib/repositories/AdminQueueActionsRepository.ts` | modify | `retryQueueItemAllAccounts`, `ADMIN_QUEUE_RETRY_PATCH`, header paragraph |
| `lib/admin/jobs/queueItemEligibility.ts` | modify (additive) | `retryWriteBound`, `RETRY_ANCHOR_COLUMN`, `RetryWriteBound` |
| `lib/admin/jobs/reminderRetryTime.ts` | create | The one service call on the action path (F-3) |
| `lib/services/PaymentReminderService.ts` | modify (additive) | Public `nextSendableAt` (C7-8) |
| `lib/services/DailyBriefingDispatchService.ts` | modify (OP-1) | Stale-date guard; `dispatchOne` takes the day |
| `lib/admin/jobs/jobsQueuesTypes.ts` | modify | Action and refusal unions; retry result |
| `lib/admin/jobs/buildQueueItemsView.ts` | modify | `QUEUE_ITEM_ACTIONS` gains `'retry'` |
| `app/admin/components/jobs/RetryQueueItemDialog.tsx` | create | Trigger, dialog, reason, warning, outcomes |
| `app/admin/components/jobs/QueueItemsPanel.tsx` | modify | Re-send cell trigger; header line |
| `app/admin/components/jobs/JobsQueuesView.tsx` | modify | Header sentence |
| `app/admin/jobs-queues/page.tsx` | modify | Comment only |
| `lib/audit/events.ts` | modify | `BOS_QUEUE_ITEM_RETRIED` and its metadata |
| `lib/audit/eventAudience.ts` | modify | `'bos'` |
| `app/api/admin/jobs-queues/items/action/__tests__/route.test.ts` | modify | Retry suites (§5.1–§5.10); Z-1's `'retry'` case moves from 400 to allowed |
| `lib/repositories/__tests__/AdminQueueActionsRepository.test.ts` | modify | §5.11; R-10 pin to two updates |
| `lib/admin/jobs/__tests__/queueItemEligibility.test.ts` | modify | §5.12 `retryWriteBound` |
| `lib/admin/jobs/__tests__/reminderRetryTime.test.ts` | create | §5.13 helper |
| `lib/services/__tests__/PaymentReminderService.nextSendableAt.test.ts` | create | §5.13 wrapper |
| `lib/services/__tests__/DailyBriefingDispatchService.staleDate.test.ts` | create (OP-1) | §5.6 |
| `app/admin/__tests__/jobsQueues.retry.render.test.tsx` | create | §5.15 |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts` | modify | §2.9 |
| `app/admin/__tests__/jobsQueues.items.render.test.tsx` | modify | Exact-button case: + one "Retry item" per retryable row; "no action words" sweep allows exactly "Retry item" |
| `app/api/admin/jobs-queues/drain/__tests__/drain.source.guard.test.ts` | modify | W7D-5 amendment, S-10 |
| `lib/audit/__tests__/eventAudience.test.ts` | modify | 178 → 179, `bos` 33 → 34 |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify (targeted) | Row 95 text names retry; Change History. Census unchanged |
| `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7B_WORKPLAN.md` | modify (targeted) | §10 stale numbers (§2.10) |
| `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7C_WORKPLAN.md` | create | This file |

**Explicitly not touched:**
- the five cron routes and `vercel.json`;
- `lib/cron/*`;
- every claim and reaper RPC and every migration (**no migration**);
- `LeadResponseDispatchService.ts`, `InsightActionDispatchService.ts`, `PaymentAutomationEngine.ts`;
- the queue repositories (`DailyBriefingSendRepository` is reused via `markSkipped`, unchanged);
- `PaymentReminderService`'s private methods, the drain and the scheduling;
- `runQueueDrain.ts` and the drain route;
- `CancelQueueItemDialog.tsx` and `DrainNowDialog.tsx`;
- `ownerVisibility.ts`, `types.ts` and the owner policy;
- the admin authz guard and its `CAPS`;
- the requirement doc (SA edits it);
- `app/api/business-os/leads/[id]/route.ts`, unless SA rules OP-2 (a) **into** this PR (default: its own PR).

---

## 4. Task List

**SA conditions carried in:** C7-1, C7-2, C7-3, C7-4, C7-5, C7-7, C7-8, C7-9, C7-12, C7-13, C7-14, C7-15, C7-16 (retry); the 7a carried items 1–4; W7B-14. SA's workplan review governs where it differs.

- [ ] ⬜ **T0** *(open: P1 MERGED, PR #215; P2 NOT built, waits on Q-SA7C-1. 7c does not merge until P2 merges, or SA rules fallback (b) and `LEAD_RETRY_HELD` is set to `true`)* *(OP-2 (a), if ruled)* Confirm that BL-7a(2) has merged, or that SA has ruled option (b). Do not start T9's lead-reply cell otherwise.
- [x] ✅ **T1** Confirm the branch (`feature/admin-queue-retry`) and the base. Re-count `console.*` in every file marked "modify" (expected 0). Re-measure the census with the guard's own scanner (expected 63 / 92 = 86 + 6 + 0, unchanged after) and `adminGate.writes` (59, unchanged).
- [x] ✅ **T2** Tests first: eligibility companion (§5.12), wrapper and helper (§5.13), dispatcher guard (§5.6), repository (§5.11), route (§5.1–§5.10), dialog (§5.15). Run them red and record the counts.
- [x] ✅ **T3** `retryWriteBound`, `RETRY_ANCHOR_COLUMN`, then green.
- [x] ✅ **T4** `PaymentReminderService.nextSendableAt` and `reminderRetryTime.ts`; amend W7D-5 and add S-10; then green.
- [x] ~~**T5**~~ *(moved to P1 by W7C-1; P1 MERGED as PR #215; not in this diff)* *(OP-1)* The dispatcher guard and the `dispatchOne(day)` change; then green, plus the existing drain suites (`runQueueDrain.test.ts`, `drain/route.test.ts`, `runRecord.adoption`).
- [x] ✅ **T6** `retryQueueItemAllAccounts`, the patch constant and the R-10 pin change; then green.
- [x] ✅ **T7** Audit registration (§2.7); run `lib/audit` and `app/admin/audit-trail` with only the ratchet edited.
- [x] ✅ **T8** Wire types and `QUEUE_ITEM_ACTIONS` (§2.6).
- [x] ✅ **T9** The route (§2.1), then green. Re-run `adminGate.writes` and `npm run test:authz-guard` (both unchanged).
- [x] ✅ **T10** `RetryQueueItemDialog.tsx`, then the panel, view and page edits (§2.8).
- [x] ✅ **T11** Guard and render amendments (§2.9), and the new dialog render suite.
- [x] ✅ **T12** `npm run test:bos-entitlements` (the route imports nothing from entitlements; run anyway, as for 7b).
- [x] ✅ **T13** Docs: access row 95 text updated in place, plus a Change History row (census unchanged, so the headline does not move); the 7b §10 fix (§2.10).
- [x] ✅ **T14** Write the live probe to `scratchpad\dev7c\probe-retry-cas.ts` (§6). **Not run, never committed.** No database access.
- [x] ✅ **T15** Local runs:
  - the new and amended suites;
  - `npx jest app/admin app/api/admin lib/admin lib/repositories lib/audit lib/services/__tests__ app/api/cron/__tests__ supabase/migrations/__tests__`;
  - `npm run test:authz-guard`;
  - scoped `tsc` (scratch tsconfig, `NODE_OPTIONS=--max-old-space-size=8192`, exit code checked);
  - ESLint on the touched files;
  - `npm run lint:hooks`.

  Record the counts.
- [x] ✅ **T16** Mutation proofs on scratch copies, never the worktree (§5.17). Then `git diff --stat`: no deletion-only file (the agent file-write hazard). Update Status and add Implementation Notes. Commit nothing.

---

## 5. Test Plan

All Jest. Mocks as in 7b:
- `@/lib/auth`, `AdminAccessService`, `@/lib/logger` (records), `@/lib/audit/boundedAuditFlush` (records order, resolvable);
- both repositories as factory mocks over a **mutable row store**, whose CAS applies the patch only if **every** predicate (`id`, `user_id`, `status`, `attempts`, `sent_at IS NULL`, the bound) matches;
- `@/lib/admin/jobs/reminderRetryTime` (a controllable promise);
- a fake clock (`jest.useFakeTimers({ now })`) where a case needs one.

### 5.1 Gate

G-1..G-6 from 7b, repeated with an `action: 'retry'` body: 401 / 403 before 400, and nothing read, called or flushed. That includes `reminderRetryTime`, which is never called before the gate.

### 5.2 Zod (400, nothing read)

| # | Body | Expect |
|---|---|---|
| Z-1 | `action: 'retry'` | **Now accepted** (the 7b Z-1 case moves). `action: 'requeue'` / `'release'` → 400 |
| Z-2 | Extra keys: `nextAttemptAt`, `retryAt`, `scheduledAt`, `sendAt`, `userId`, `accountId`, `ownerUserId`; `expected.sentAt` | 400 each. Nothing read, and the wrapper is not called. **The client cannot choose a send time** |
| Z-3 | The 7b reason and `expected` edges with `action: 'retry'` | as 7b |

### 5.3 Allowed cells (C7-1, C7-16 "a happy path per allowed action")

`it.each` over every allowed cell:
- `payment_reminders`: `failed` with attempts 1 (a runner failure, `claimed_at` still set), and `failed` dead-lettered (attempts 5, claim cleared);
- `daily_briefing_sends`: `failed` (attempts 3), `briefing_date` = today in the row's zone;
- `lead_responses`, `insight_actions`: `failed` dead-lettered, created 1 h ago.

Each case expects:
- **200**, with `data` keys exactly `queue, itemId, action, before, after, nextAttemptAt`;
- `after.status` is `pending`;
- the CAS called **once**, with `ownerUserId === row.userId` and `expected` equal to the row's;
- `bound` equal to `retryWriteBound(…)` for the same `now`;
- the stored row now has `status = 'pending'`, `claimed_by = claimed_at = null`, **`attempts` unchanged**, **`error_message`, `skip_reason`, `scheduled_at`, `sent_at` and the payload unchanged**;
- `next_attempt_at` is the wrapper's value (reminders) or `null` (others).

### 5.4 Refused cells (C7-1 negatives, C7-2, C7-5)

| # | Case | Expect |
|---|---|---|
| N-1 | `payment_automations`, every status (`pending`, `failed`, `dead_letter`, `running`, `completed`, `cancelled`, `zzz`) | **422 `retry_not_offered`. Neither repository nor the wrapper is called** |
| N-2 | Each of the four queues, `expected.status` ∈ {`pending`, `processing`, `sent`, `skipped`, `cancelled`, `zzz`} | **422 `not_retryable_state`.** Nothing read |
| N-3 | **Leased or orphaned in progress** (`processing`, `claimed_at` set or null) | 422 `not_retryable_state` (C7-2: retry never touches an in-progress row) |
| N-4 | **Never to anything but `pending`; never from anything but `failed`** | Repository pin: every retry patch's `status` is `pending`, and the CAS always filters `status = 'failed'` |
| N-5 | Finished between load and click: expected `failed`, stored `sent` / `skipped` | 409, the CAS never called |
| N-6 | Reminder with `scheduled_at` null | 422 `no_due_time`; the CAS never called |
| N-7 | Briefing with a malformed `briefing_date` | 422 `no_due_time` |

### 5.5 Boundaries: 72 h, sending hours, real clock

| # | Case | Expect |
|---|---|---|
| B-1 | Lead / insight, `created_at` = `now − 72 h` exactly | Allowed. The CAS bound is `gte created_at = now − 72 h` (the same ISO) |
| B-2 | The same, plus 1 ms older | 422 `retry_window_passed` with `anchorAt`; the CAS never called |
| B-3 | Reminder, inside sending hours, `scheduled_at + 72 h = now` | Allowed; `retryAt = now`; bound `gte scheduled_at = now − 72 h` |
| B-4 | **Reminder, 21:30 local, `scheduled_at` 70 h ago** | The wrapper returns the next 08:00, which is past `scheduled_at + 72 h` → **422 `retry_window_passed`**. The route checks the **eligible time**, not `now` (carried item 2) |
| B-5 | Reminder, 02:00 local, `scheduled_at` 60 h ago | `retryAt` = 08:00 today (66 h) → allowed; `next_attempt_at` = 08:00 local in UTC; bound `gte = retryAt − 72 h`, **not** `now − 72 h` (mutation target 3) |
| B-6 | Sending-hours edges via the real wrapper (§5.13): 07:59:59.999 → 08:00 the same day; 08:00:00.000 → itself; 19:59:59.999 → itself; 20:00:00.000 → next day 08:00 | — |
| B-7 | DST day (Europe/London 2026-10-25; America/New_York 2026-11-01) at 01:30 local | `retryAt` = 08:00 local on that date, computed by `businessInstant` |
| B-8 | **Real clock (carried item 1):** the route source imports no list clock helper and calls `new Date()` exactly once in `retryItem`; the same instance reaches the eligibility call and `retryWriteBound` (spy) | — |
| B-9 | **Microseconds (E-4):** anchor `…T09:00:00.123456+00:00`; `retryAt` = parsed anchor + 72 h | Function allows; bound `gte` = the parsed anchor (`.123`), which is ≤ the stored `.123456`, so the CAS also matches. The direction is safe: the function is never looser |

### 5.6 Briefing across midnight, and the dispatcher guard (F-1, OP-1)

Route (`retryItem`):

| # | Case | Expect |
|---|---|---|
| BM-1 | Zone `America/Los_Angeles`, row date D, `now` = D 23:59:59.999 local | Allowed; CAS `.eq('briefing_date', D)` |
| BM-2 | Same row, `now` = D+1 00:00:00.000 local | 422 `briefing_not_today` |
| BM-3 | `Asia/Kolkata` (+5:30) and `Pacific/Chatham` (+12:45): BM-1 and BM-2 at the local midnight | The same |
| BM-4 | The row's `timezone` null or invalid | The route, the bound and the dispatcher all fall back to UTC (the same result in all three) |
| BM-5 | **The race:** the check passes at 23:59:59.990; the stored-row CAS evaluates "today" as D+1 (simulated by a bound mismatch) | count 0, unchanged re-read, fresh eligibility → **422 `briefing_not_today`**. No audit row |

Dispatcher (`DailyBriefingDispatchService.staleDate.test.ts`; repository, facts, store, branding and email mocked):

| # | Case | Expect |
|---|---|---|
| D-1 | Claimed row with `briefing_date` = the run's day | `buildBriefingFacts` called with **that** `BusinessDay` object (the same instance used for the check); sent as before |
| D-2 | **A retry left pending past midnight:** row date D, run `now` = D+1 00:10 local | `markSkipped(row.id, 'stale_date')`; `buildBriefingFacts`, `getBriefing`, `resolveEmailBranding` and `sendEmail` **never** called; `summary.skipped` + 1 |
| D-3 | Row date D+1 (a clock-skewed or future row) | Skipped the same way |
| D-4 | Mixed batch: 2 today, 1 stale | Exactly the stale one skipped; the others dispatched in order |
| D-5 | Run straddling midnight: `now` = D 23:59:50, the row claimed "at" 00:00:30 | Checked **and** rendered for D (one send). Documents the accepted edge |
| D-6 | Source pins | `businessDayFor(` called once in the loop, and `dispatchOne` no longer calls it; `SEND_WINDOW_START/END`, `LEASE_SECONDS`, `MAX_ATTEMPTS`, `BATCH` unchanged; the claim and reap calls unchanged |
| D-7 | Drain now path | `runQueueDrain('daily_briefing_sends')` reaches the same guard (existing runner test plus one stale row) |

### 5.7 Concurrency, double-click, the double-send test (§D.5, §9, FR-Q4)

| # | Case | Expect |
|---|---|---|
| X-1 | Stale attempts: expected `failed`/3, stored `failed`/4 (retried and failed again in between) | 409; the CAS never called; no audit |
| X-2 | Stale status: stored `skipped` (another admin cancelled) | 409 with the label "Skipped" |
| X-3 | **Another admin retries between our read and our CAS** (the store flips to `pending` before the CAS) | count 0 → re-read → **409 "Waiting"**. The CAS was called once; no audit; the store has exactly one retry applied |
| X-4 | Deleted between read and CAS | 404 |
| X-5 | **Double-click, sequential** | First 200, second **409** ("Waiting"). The CAS ran once and `logAndFlush` ran once |
| X-6 | **Two admins at once** (`Promise.all`, a shared read gate) | Exactly one 200 and one 409; one patch; one audit row |
| X-7 | **The §9 double-send test for retry.** After a winning retry, model the claim (`SKIP LOCKED`): two concurrent claims → exactly one gets the row (`processing`, `attempts + 1`). Then a second retry with the original `expected` → 409 (status moved) | The row is claimed exactly once. A retry can add at most **one** claim |
| X-8 | **The retry versus a cancel by another admin:** both pass their pre-checks; whichever CAS is first wins | Exactly one 200 and one 409; the store is either `pending` or `skipped`/`cancelled`, never both |
| X-9 | `count: null` / `2` / a PostgREST error | 500 `outcome_unknown`, `error` log with ids, no audit |
| X-10 | A read error or time-out at step 3 or step 11 | 500 `action_failed`; no CAS after a failed first read |
| X-11 | `reminderRetryTime` rejects / exceeds the 5 s deadline | 500 `action_failed`; the CAS never called; no audit |
| X-12 | **`sent_at` fence (F-4):** the stored row is `failed` with `sent_at` set; everything else allowed | CAS count 0 → unchanged re-read → fresh eligibility still allows → **422 `not_retryable_state`**, `warn` with `cause: 'write_predicate'`. No audit; the row unchanged |
| X-13 | **The window closes between check and write** (fake clock advanced past the bound, CAS predicate fails) | 422 `retry_window_passed` (BM-5 for the briefing) |

As in 7b, a unit test cannot prove Postgres's real lock behaviour. The §6 probe proves the request shape, and SA §D.1 carries the lock argument.

### 5.8 Tenant isolation (`tenant-isolation-guard` Step 7)

| # | Case | Expect |
|---|---|---|
| T-1 | The stored row's owner is `OWNER-A` | The CAS gets `ownerUserId: 'OWNER-A'`; **`reminderRetryTime` is called with `'OWNER-A'`** (the zone is the item's business, never the admin's) |
| T-2 | Injected owner / account / time fields | 400 (Z-2) |
| T-3 | An id that exists in `lead_responses`, sent as `insight_actions` | 404; only `insight_actions` read |
| T-4 | Unknown id | 404 |
| T-5 | The patch is a constant plus one server-computed time | Source pin: no spread of `body`, `parsed`, `expected`, `row` or `input` into a patch; `next_attempt_at` assigned only from `input.nextAttemptAt` |

### 5.9 Audit (C7-13, §G)

| # | Case | Expect |
|---|---|---|
| A-1 | Success, each of the four queues | One `logAndFlush`: `BOS_QUEUE_ITEM_RETRIED`, `bos_queue_item`, `entityId === row.id`, **`userId === row.userId`**, **`actorId === adminId`**, `severity 'warning'`, `changes` exactly `{ before: { status, attempts }, after: { status: 'pending', next_attempt_at } }`, `details` keys exactly `reason, queue, action, correlationId, dueAnchor` with `action 'retry'` |
| A-2 | Order | CAS → Pino line → `logAndFlush` → response (held while the flush is pending) |
| A-3 | Flush "times out" | Still 200 |
| A-4 | No audit on any refusal (400, 401, 403, 404, 409, every 422, 500) | `logAndFlush` never called with this event; 409/422 logged at `info` (X-12 at `warn`) |
| A-5 | Registrations | Catalogue 179, `bos` 34; `warning` + SOC2; audience `bos`; `classifyAuditEvent` → "Business OS Queues" / "Item Retried"; `filterOptions` suites unedited and green; `ownerVisibility.test.ts` unchanged and green (no new type) |
| A-6 | The reason is never logged | No logger argument contains it |

### 5.10 Privacy: sentinel and no leak (C7-13, §9)

7b's P-suite over the four retryable queues: the read mock also returns `error_message`, `skip_reason`, `payload`, `recommendation`, contact / invoice / booking / entity ids, `claimed_by`, `sent_at: 'SENTINEL-SENT'` and `timezone: 'SENTINEL/Zone'`.

Across 200, 409, 404 and every 422:
- no `SENTINEL`, `@` or `client.test` in the response body, any log call or any audit entry;
- no owner id in the response;
- the patch never contains `error_message`, `skip_reason` or `sent_at`;
- `anchorAt` and `nextAttemptAt` are ISO only.

### 5.11 Repository (`AdminQueueActionsRepository.test.ts`)

| # | Case |
|---|---|
| R-1 | `ADMIN_QUEUE_RETRY_PATCH` equals the §1.2 table exactly; it has no `payment_automations` key; frozen at both levels |
| R-2 | No retry patch has `attempts`, `error_message`, `skip_reason`, `scheduled_at`, `sent_at`, `user_id`, `briefing_date` or any payload / target column; `status` is always `pending`; `claimed_by` / `claimed_at` are always `null` |
| R-3 | Reminders: `next_attempt_at` equals `input.nextAttemptAt`. Others: `null`, and a supplied `nextAttemptAt` is refused with no request |
| R-4 | **The chain, recorded, in order:** `from(table)`, `update(patch, { count: 'exact' })`, `eq id`, `eq user_id`, `eq status`, `eq attempts`, `is sent_at null`, then `gte scheduled_at` (reminders) / `gte created_at` (leads, insights) / `eq briefing_date` (briefing). No `select`, `or`, `single` or `rpc` |
| R-5 | Outcomes: 1 → `retried`; 0 → `not_matched`; null / 2 / −1 / 1.5 → `count_unconfirmed`; a PostgREST error → its code; a thrown client → returned |
| R-6 | **Refuses with no request:** missing context; unknown queue; `payment_automations`; status other than `failed`; attempts −1 / 1.5; empty ids; bound column wrong for the queue (e.g. `created_at` on reminders, `scheduled_at` on leads); unparseable bound; reminders without `nextAttemptAt` or with a non-ISO one |
| R-7 | Logs: `{ correlationId, adminUserId, queue, itemId, from, outcome }` only; never the owner id, the bound or the patch |
| R-8 | Source pins: **exactly two** `.update(`; `RETRY_FROM_STATUSES` and `RETRY_ANCHOR_COLUMN` imported from the eligibility module, never redeclared; still no `.or(` / `.select(` / `error_message` / `...input`; W7B-6 (no `lib/services`, no event) unchanged |
| R-9 | The single-caller guard unchanged and green |

### 5.12 Eligibility companion (`queueItemEligibility.test.ts`)

| # | Case |
|---|---|
| E-1 | `retryWriteBound` per queue: the column and value above; `payment_automations` → `null`; an invalid `now` or `retryAt` → `null` |
| E-2 | **Equivalence, table-driven** (every queue; anchors at −72 h −1 ms, −72 h, −71 h, now; reminders with `retryAt` at, before and after the limit; briefing over the zone set of BM-3): eligibility allowed ⇔ the bound predicate holds on the parsed anchor |
| E-3 | `RETRY_ANCHOR_COLUMN` keys are set-equal to the four retryable queues |
| E-4 | The microsecond direction (B-9) |
| E-5 | Nothing existing moved: every current eligibility test passes unedited |

### 5.13 The wrapper and the helper

| # | Case |
|---|---|
| S-1 | `new PaymentReminderService(fakeClient).nextSendableAt(user, desired)` equals the private `sendableAt(desired, user)` result (spy) as a `Date`, for B-6 and B-7's inputs |
| S-2 | Its only database access is the existing `user_preferences.timezone` read; a read error → UTC (the documented fallback); no insert, update, RPC or `emitPaymentEvent` call |
| S-3 | Source pin: the private `sendableAt`, `businessZone` and the window constants are byte-identical to the base, from the PR diff (M-7) plus a structural pin |
| H-1 | `reminderRetryTime(owner, now)` calls `nextSendableAt(owner, now)` once and returns its result; a rejection propagates |
| H-2 | S-10 (§2.9) |

### 5.14 Guards

§2.9 in full, including:
- the explicit `\bRetry\b` decision case;
- the W7D-5 importer set of exactly two;
- the route's T-5 pin still green with the new helper import.

### 5.15 UI (`jobsQueues.retry.render.test.tsx`, plus the amended suites)

| # | Case | Expect |
|---|---|---|
| U-1 | Panel rows: retry allowed; `retry_window_passed`; `briefing_not_today`; `retry_not_offered` | Exactly one "Retry item" button, in the allowed row's Re-send cell, with the "until …" words under it; the others show the 7a words; Cancel cells unchanged |
| U-2 | Open the dialog, per queue (`it.each`) | Title, description with attempts, "one more try", the known-risk warning naming **"the client"** (reminders, leads, insights) or **"the business owner"** (briefing), the per-queue next step, the briefing's AI-cost sentence on the briefing only, "The business is not told". Confirm disabled. Dismiss reads "Close"; no button reads "Cancel" |
| U-3 | Reason `'ab'` / `'  ab  '` → disabled; `'abc'` → enabled | — |
| U-4 | Confirm | One POST with body **exactly** `{ queue, itemId, action: 'retry', expected: { status, attempts }, reason }`; "Retrying…", disabled, `aria-busy`; Escape, outside click and Close do nothing |
| U-5 | Double-click, including the same tick | One request |
| U-6 | 200 (reminders, with `nextAttemptAt`) | The success sentence plus "Not before {UTC time}"; `onChanged` only on Close, once |
| U-7 | 200 (briefing, `nextAttemptAt: null`) | No time sentence |
| U-8 | 409 with label; unexpected label `<b>x</b>` | As 7b |
| U-9 | Each 422 code, with and without a valid `anchorAt`; `anchorAt: 'SENTINEL'` | The fixed sentences; an invalid time is dropped and never rendered |
| U-10 | 400 / 401 / 403 / 500 `action_failed` / other 500 / HTML body / rejected fetch | The §2.8 sentences; `SENTINEL` never in `document.body` |
| U-11 | No green class | — |
| U-12 | The view header is the new sentence; with panels closed, 1 + 5 + 5 buttons are unchanged | — |

### 5.16 Census and gate (unchanged, proven)

- `adminGate.writes` still 59 and green (its case keeps `action: 'cancel'`).
- `npm run test:authz-guard` 119 / 119.
- T1 re-measures 63 / 92 = 86 + 6 + 0 before and after.

### 5.17 Mutation targets (T16, on scratch copies)

Each must turn named tests red:
1. drop `.eq('user_id', …)` from the retry CAS;
2. take `ownerUserId` (or the wrapper's owner) from the body;
3. bound the reminder CAS on `now − 72 h` instead of `retryAt − 72 h`;
4. drop the bound entirely;
5. drop `.eq('attempts', …)`;
6. drop `.is('sent_at', null)`;
7. patch `attempts: 0` (a reset);
8. patch `error_message: null`;
9. rewrite `scheduled_at` to `retryAt`;
10. treat `count !== 0` as a win;
11. add `.select()`;
12. allow `processing` in the "from" set;
13. offer retry on `payment_automations`;
14. call eligibility with a minute-floored clock;
15. skip the briefing `.eq('briefing_date', …)`;
16. remove the dispatcher's stale-date check;
17. let `dispatchOne` recompute the day from the timezone;
18. audit before the CAS;
19. audit on a lost race;
20. import `paymentReminderService` in the route directly;
21. call `processDueReminders` from the helper;
22. a dialog body carrying `nextAttemptAt`;
23. render server text;
24. a "Cancel" dismiss label;
25. the briefing warning saying "client".

---

## 6. The Live PostgREST Probe

There is one database (production) and no branch database. Dev has no database access. As for 7b, the probe is **prepared by Dev in `scratchpad\dev7c\probe-retry-cas.ts`**, **never committed**, and **run once by the user**, after SA's code review, from a clean PowerShell window. Its output goes into the QA report.

**Goal:** prove on real PostgREST that the exact retry chain is accepted (no 42703, no PGRST error), that it returns `count` as the number **0** for a no-match, and that **every** column in the patch **and in the filters** exists (`next_attempt_at`, `claimed_by`, `claimed_at`, `sent_at`, `scheduled_at`, `created_at`, `briefing_date`). `schema:check` does not cover `.update()` payloads or update filters.

**Script design** (the 7b script's shape, with the CR7B-1 and CR7B-3 lessons):
- For each of the **four** retryable queues, it calls the **real** `adminQueueActionsRepository.retryQueueItemAllAccounts` with:
  - `itemId = crypto.randomUUID()`, `ownerUserId = crypto.randomUUID()`;
  - `expected = { status: 'failed', attempts: 99999 }`;
  - `bound = retryWriteBound(queue, <synthetic facts with today's date / a fresh anchor>, new Date(), <reminders: new Date()>)`;
  - `nextAttemptAt` = `new Date().toISOString()` for reminders, `null` otherwise.
- **Five independent "matches nothing" guarantees:**
  1. a fresh random primary key, confirmed absent first;
  2. a fresh random owner;
  3. `attempts = 99999`;
  4. `status = 'failed'` combined with (1)–(3);
  5. `sent_at IS NULL` combined with the rest.
- **Before each call,** a count-only head read `select('id', { count: 'exact', head: true }).eq('id', itemId)`. Any count other than 0, or any error, exits before the update.
- **Expected per queue:** `{ data: { outcome: 'not_matched' }, error: null }`.
- **Two negative controls, raw client, the same impossible filters:**
  1. **patch column:** `lead_responses` with patch `{ scheduled_at: <now> }` (a column that table does not have) → **`PGRST204`** (`42703` also passes);
  2. **filter column:** `lead_responses` with the retry patch and `.gte('scheduled_at', <now>)` → **`42703`** (`PGRST` 4xx also passes). This proves the probe would catch a wrong bound column.

  Both are rejected while the request is planned, before any row is considered.
- **It prints** only the queue, the outcome and the error code. It stops at the first failure.
- **The run line** (the user, PowerShell, once, after SA's code review; never `npm install`):

  ```powershell
  cd "C:\Users\Barak\My Projects\AgentsPilot\neuronforge-admin-queues"
  .\node_modules\.bin\tsx.cmd --tsconfig tsconfig.json "<scratchpad>\dev7c\probe-retry-cas.ts"
  ```

  It uses a clean shell (no `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` already set). The env is loaded from the main checkout's `.env.local` inside the script and never copied.
- **Expected output:**

  ```text
  payment_reminders      pre-read empty   outcome not_matched
  daily_briefing_sends   pre-read empty   outcome not_matched
  lead_responses         pre-read empty   outcome not_matched
  insight_actions        pre-read empty   outcome not_matched
  control lead_responses patch scheduled_at    error PGRST204
  control lead_responses filter scheduled_at   error 42703
  PROBE PASS
  ```

- **What it does not do:**
  - it does not call the route, so no audit row is written;
  - it does not use `.select()`;
  - it changes no row;
  - no trigger can fire: zero triggers on the five tables, confirmed live in 7b §6.2 (d).

  §6.2 is not repeated: no constraint or trigger is involved that 7b did not already confirm (`pending` is in every status CHECK).

---

## 7. Manual QA Check

On a preview or local build, as a platform admin. **Never confirm a retry on a real client's item, and never seed, hand-edit or re-status a live queue row** (W7A-12, W7B-5).

| # | Step | Expect |
|---|---|---|
| M-1 | `/admin/jobs-queues` | The header names Drain now, cancel and retry, and says everything else is read-only |
| M-2 | Each queue → View items → Failed / Dead-lettered | A "Retry item" button only on rows marked retryable. Live data has no failed rows (SA 7a §A), so expect none; record "not exercisable on live data" |
| M-3 | Payment automations → any tab | No "Retry item" button anywhere |
| M-4 | If a retryable row exists: open the dialog, read it, press **Close** | Title, description, the known-risk warning, the per-queue next step; Confirm disabled until 3 characters; dismiss reads "Close". **Do not confirm.** No request is made on open or close |
| M-5 | Only if the user names, in writing, a failed item of their own test business that they want re-sent | "Queued for one more try…". On Close the row leaves Failed. `/admin/audit-trail` → "Business OS Queues" → "Item Retried" shows one `warning` row. Otherwise **skip** |
| M-6 | Signed out / non-admin: the 7b M-6 `curl` with `"action":"retry"` | 401 / 403 |
| M-7 | `git diff origin/main --stat -- app/api/cron lib/cron vercel.json supabase/migrations lib/services/LeadResponseDispatchService.ts lib/services/InsightActionDispatchService.ts lib/services/PaymentAutomationEngine.ts lib/services/DailyBriefingDispatchService.ts "app/api/business-os/leads/[id]/route.ts"` | Empty. `DailyBriefingDispatchService.ts` is **unchanged** by 7c (W7C-1): its stale-date guard is P1, PR #215, already on `main`. The lead route is unchanged too (P2 is its own PR). `PaymentReminderService.ts`: additive only (the wrapper) *(amended 2026-10-04, CR7C-1)* |
| M-8 | Record the §6 probe output, run by the user | 4 × `not_matched`, both controls, `PROBE PASS` |

---

## 8. Acceptance Criteria Traceability

| Criterion | Where |
|---|---|
| FR-Q1 (retry) per the §C matrix; every ❌ cell refused (C7-1, §9 as amended) | §2.1 steps 1–2 and 7, §5.3, §5.4 |
| FR-Q6 / OQ-3 / C7-9: the 72 h rule on the server, in the route **and** the CAS | §2.1 steps 5–8, §2.2, §5.5, §5.12 |
| C7-2: never leased, never in progress, never finished | §1.2, N-3..N-5, R-4 |
| C7-3: one CAS, `count: 'exact'`, `count === 1`, no `.or()` + `.select()`, "from" check first, live probe | §2.1, §2.3, R-4, R-5, R-8, §6 |
| C7-4: no `attempts` reset; error text, skip reason and payload kept | §1.2, R-2, §5.3, mutations 7–9 |
| C7-5: no retry on payment automations | N-1, R-6, U-1, M-3 |
| C7-7 + carried item 3 (B7-4): same business day; no stale-date send | §1.4; the route side BM-1..BM-5 (§5.6); the dispatcher's stale-date guard is **P1 (PR #215, merged)**, not in this diff (W7C-1) |
| C7-8: sending hours through the public wrapper, reused | §2.4, B-4..B-7, S-1..S-3 |
| Carried items 1 and 2: real clock; reminder bound on `retryAt − 72 h` | B-4, B-5, B-8, mutations 3 and 14 |
| Carried item 4 (BL-7a) | §1.5, OP-2; P2 merges first, enforced in CI by `lib/admin/jobs/__tests__/leadRetry.p2Gate.test.ts` (CR7C-3); fallback `LEAD_RETRY_HELD` (IN-3, CR7C-4) |
| Carried item 5: AI and credit attribution | §1.8, U-2, OP-9 |
| FR-Q3: reason and one flushed audit row | §2.7, §5.9 |
| FR-Q4 / §9 double-send | X-3, X-5..X-8, X-12, D-2 |
| FR-Q5 / §9 no content | §5.10, U-9, U-10 |
| FR-Q7 refresh | U-6 (`onChanged` on Close) |
| C7-12 data access | §2.3, R-9, T-5; no read column added |
| C7-13 privacy and dialog copy | §2.8, §5.10, U-2 |
| C7-14: same route, writes 59, census 93 = 87 + 6 + 0 open / 64 files (row 96, PR #214's drill-down, registered doc only; CR7C-2), no CAPS move | §1.9, §5.16, IN-1 |
| C7-15 Pino, error format | §1.9, Z-3 |
| C7-16 (retry): happy path per cell, CAS loss, foreign id, strict schema, audit shape and order | §5.3, X-3, T-3, Z-2, A-1, A-2 |
| UC-9: owners never see a retry or its reason | §2.7 (`bos_queue_item` operator, `20261035`), A-5 |
| CLAUDE.md Testing: happy + auth failure + invalid input; a test per new repository method | §5.1–§5.3, §5.11 |

---

## 9. Risks and Rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| **An earlier attempt was delivered but not recorded, and the retry sends again** | Low per item, real for lead replies (a failed lead row is one whose runner never closed it) | It cannot be closed here (§D.6). The dialog states it plainly and names the recipient. The `sent_at` fence removes the **recorded** case (F-4). One more try at most (C7-4) |
| **A lead row's runner outlived its lease and is still alive** (BL-7a) | Very low, but a true double send | P2 (BL-7a(2)) merges first. CI enforces the order: `leadRetry.p2Gate.test.ts` is red until the lead route is the P2 shape, or until `LEAD_RETRY_HELD = true` per CR7C-4 |
| **A briefing retry crosses midnight** (B7-4) | Medium without a guard (any retry in the last hour, or a cron outage) | P1's dispatcher guard (PR #215, already on `main`): the stale row is closed `skipped / stale_date`, never sent; the dialog says "only today" |
| A reminder retry lands on the same day as the business's next scheduled overdue chase (default days 1, 3, 7) | Low–Medium | Dialog copy (OP-10). The dispatcher still skips a paid invoice. A stricter guard needs an `invoice_id` read, which C7-12 keeps out |
| The 72 h window is checked at the press; a cron outage delays the send | Low | §E's accepted tail; the dialog points to Drain now; the dispatchers re-check at send time (B7-6) (OP-11) |
| The list says "Re-send: until …" for a reminder that the route then refuses on sending hours (B-4) | Expected, near the end of the window | The route is the authority; a clear 422 sentence. The list does not resolve a timezone per row (OP-12) |
| A wrong patch or filter column in production | Low | §6 probe with two negative controls; R-4 / R-8 pins |
| The wrapper's UTC fallback or stale zone cache picks a wrong hour | Very low | The same behaviour as every scheduled reminder (OP-4) |
| Guard amendments weaken the read-only pins | Medium (process) | One counted allowance per dialog in a named cell; one extra importer with a member-call pin; SA approves explicitly |
| The owner is charged for a re-narration | Low (only when the day's facts moved) | The owner's normal cost, attributed to the platform actor; the dialog says so (OP-9) |

**Rollback:** one PR. Reverting it removes the retry case, the repository method, the dialog, the wrapper, the helper, the `LEAD_RETRY_HELD` switch, the P2 gate test and the event registration.
- **Rows already retried stay `pending`** and are sent by their queue as normal. That is the action that was taken, and a revert cannot un-queue it. To stop one, cancel it (7b) before the next run.
- **The briefing stale-date guard is not in this PR** (it is P1, PR #215), so reverting 7c leaves it in place: a retried briefing still `pending` at midnight is closed `stale_date`, never sent.
- **No migration to roll back.** `BOS_QUEUE_ITEM_RETRIED` rows stay in `audit_trail`, owner-hidden by `20261035`.
- **A UI-only revert** (hide the button) leaves the route's retry case admin-gated and unused, which is safe.

---

## 10. PR Body Draft

*(Rewritten 2026-10-04 for SA CR7C-1: the briefing dispatcher change moved to P1, PR #215, already merged; current census; the `LEAD_RETRY_HELD` switch, the P2 gate and the S-10 amendment added.)*

```markdown
## feat(admin): retry one failed Business OS queue item (ADMIN_BOS_CLEANUP slice 7c)

### What changes
- `/admin/jobs-queues`: in a queue's item list, each row marked retryable gets a **Retry item** button in its Re-send cell. A confirm dialog says this is one more try, never sent from here, states the known risk ("if an earlier attempt was actually delivered but not recorded, the client may receive it twice"; "the business owner" for the briefing), says what happens next on that queue, and requires a reason (3–500 characters).
- `POST /api/admin/jobs-queues/items/action` accepts `action: 'retry'` (same route, same strict body; no time, owner or account field accepted).
- Retry = one compare-and-set UPDATE back to `pending`: `id` + the row's own `user_id` + `status = 'failed'` + the attempts the admin saw + no recorded send (`sent_at IS NULL`) + the queue's window, re-checked inside the write:
  - payment reminders: within 72 h of `scheduled_at`, at the next sending-hours time (08:00–20:00, business time zone) via `PaymentReminderService.nextSendableAt` (the existing rule, now public, reached only through `lib/admin/jobs/reminderRetryTime.ts`); the write bound is that time minus 72 h;
  - daily briefing: same business day only (`briefing_date` = today in the row's time zone);
  - lead replies and insight actions: within 72 h of being queued;
  - payment automations: never (`retry_not_offered`).
- `attempts`, error text, skip reason, `scheduled_at` and the payload are never written. One retry buys exactly one more try.
- The send always goes through the queue's own claim (next run or Drain now). Nothing is sent inline.
- `LEAD_RETRY_HELD` (`lib/admin/jobs/retryHolds.ts`, ships `false`): a reviewed code switch that, when `true`, refuses lead-reply retry (422 `retry_held`) in the eligibility module, the route (before any read) and the repository. Flipping it is one line plus 10 test expectations in 3 suites and an SA re-check (see its header).
- One `BOS_QUEUE_ITEM_RETRIED` audit row per successful retry (audience `bos`, severity `warning`, user = the item's account, actor = the admin; owner-hidden through `bos_queue_item`), after the win, flushed before the response.

### What it never does
- Never touches a leased, in-progress or finished item; never resets attempts; never sends, drains or claims; never emits a payment event; never makes an AI or credit call; never returns content or an account id, and the route never logs one (the reminder sending-hours lookup logs the business id and zone exactly as every scheduled reminder does).
- Does not change `DailyBriefingDispatchService.ts` (its stale-date guard is P1, #215) or the lead route (P2).
- No migration (`bos_queue_item` is already owner-hidden by 20261035). No new route: `adminGate.writes` stays 59. Census **93 = 87 `requireAdmin` + 6 inline + 0 open / 64 files**; access register row 95 text updated (retry) and row **96** `business-os/ai-activity/drill-down#GET` (PR #214, gated from birth, never registered) registered doc only.

### Depends on
- [x] P1, the briefing stale-date guard (#215), merged.
- [ ] P2, BL-7a(2) (lead route `maxDuration = 60` and an awaited drain), merged and this branch rebased on it. **CI enforces this:** `lib/admin/jobs/__tests__/leadRetry.p2Gate.test.ts` is red until the lead route has that shape. The only alternative is `LEAD_RETRY_HELD = true` per its header, re-checked by SA.

### Verified live (zero-row)
- [ ] The user ran the §6 probe: 4 × `not_matched`; controls PGRST204 / 42703; PROBE PASS.

### Registrations
- Event `BOS_QUEUE_ITEM_RETRIED` (group "Business OS Queues", label "Item Retried"); catalogue 178 → 179; `bos` 33 → 34.
- W7D-5 amended: `lib/admin/jobs/reminderRetryTime.ts` is the one extra service importer on the admin path, pinned by S-10 to the single `paymentReminderService.nextSendableAt(` call (no `processDueReminders`).
- E-13 amended: the eligibility module may import `retryHolds`, itself pinned to no imports and one line.

### Tests
Route (gate, Zod incl. injected time/owner fields, every allowed and refused cell, the 72 h and sending-hours boundaries, real clock, briefing across midnight in four zones (BM-1..BM-5), CAS loss, double-click, two admins, retry versus cancel, sent_at fence, the lead hold both ways, audit shape and order, sentinel), repository (CAS chain and pins), eligibility companion (equivalence with the decision), wrapper and helper (S-10), dialog render, guard amendments, and the P2 gate (red until P2).

### Rollback
Revert the PR. Items already retried stay queued and are sent normally (cancel them first if needed). The briefing stale-date guard (P1) is not in this PR and stays.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 11. Effort Estimate

| Part | Hours |
|---|---|
| T1 base, census, counts | 0.25 |
| T2 tests first | 2.0 |
| T3 `retryWriteBound` and tests | 1.0 |
| T4 wrapper, helper, W7D-5 amendment | 1.5 |
| T5 briefing dispatcher guard and its suite (OP-1) | 1.5 |
| T6 repository method and pins | 2.0 |
| T7 audit registration | 0.5 |
| T8 wire types | 0.25 |
| T9 route and route suites | 3.5 |
| T10 dialog, panel, view | 2.5 |
| T11 guard and render amendments, dialog suite | 2.0 |
| T12–T13 entitlements run; docs (row 95, 7b §10) | 0.5 |
| T14 probe script | 0.75 |
| T15–T16 runs, mutations, notes | 1.5 |
| **Total** | **about 19.75 h, about 2.5 days.** SA estimated 1.5–2 days; the difference is F-1 (the dispatcher guard, about 1.5 h), F-3 (the helper and guard amendment, about 1 h) and F-4 (the `sent_at` fence, about 0.5 h). **BL-7a(2), if ruled first (OP-2 (a)), is a separate PR of about 0.5 day** |

---

## 12. Open Points for SA

| # | Point | Dev default |
|---|---|---|
| **OP-1** | **Carried item 3: the stale-date briefing (F-1, §1.4).** It **can** happen: the claim has no date predicate, the dispatcher renders `now` and not `row.briefing_date`, and the hourly :10 cron leaves the last 20–60 minutes of every business day (and any cron outage) uncovered. A route-side refusal cannot close it, because it assumes the cron runs. **Proposed: the dispatcher guard G-B** (§2.5): one day per row, used for both the check and the render; a stale row is closed `skipped / stale_date` and never sent. This is a **send-path change** to `DailyBriefingDispatchService.ts`. It also fixes the pre-existing outage case and covers Drain now. Optional extra: the route refuses a briefing retry in the last 70 minutes of the business day (a new code, `briefing_too_late`), to avoid spending the one attempt on a row that will be skipped | **G-B in this PR, flagged.** No "last 70 minutes" refusal: the dialog says "only today; if no run happens before midnight it is closed without being sent". If SA prefers G-B as its own PR before 7c, 7c's briefing cell waits for it |
| **OP-2** | **Carried item 4: BL-7a (§1.5).** A retry **does** make it worse, on lead replies only. It can re-arm a dead-lettered row whose runner (the lead route's unbounded fire-and-forget drain) is still alive, producing a second live claim and a second send. The other three queues are claimed only by awaited 60 s runners, so their dead-letters are provably dead. BL-7a part (1) (`claimed_by` fencing) does not stop a late runner's send, and is **not** needed for 7c. **Minimum guard: BL-7a part (2)**, `maxDuration = 60` plus an awaited drain on `PATCH /api/business-os/leads/[id]` | **(a) BL-7a(2) lands first, as its own small SA-reviewed PR** (about 0.5 day; the owner's "send now" then waits for the drain, which is a product trade-off for that review). Fallback **(b)**: ship 7c with lead-reply retry held (422 `retry_held`, a new code in the eligibility module, list and dialog) until BL-7a(2) lands. Not (c) |
| OP-3 | **F-3: reaching `sendableAt`.** C7-8's public wrapper plus a one-function `lib/admin/jobs/reminderRetryTime.ts` as the only extra service importer on the admin path. W7D-5 is amended to exactly two importers, with a member-call pin and a forbidden-name list. The route stays service-free (W7B-6 unchanged). Rejected: extracting the window into a pure module (it changes live scheduling code and splits zone resolution) | As proposed |
| OP-4 | **Inherited zone behaviour.** `businessZone` falls back to UTC on a read error and caches per instance with no expiry. For a retry, that could mean a send outside the business's real sending hours, or a just-changed zone used late on a warm admin instance | Accept: the same rule every scheduled reminder follows. A fail-closed variant would change `businessZone` for all callers |
| OP-5 | **`next_attempt_at` on the non-reminder queues.** `null` (due at once; the claims treat it as due; lead and insight claims order `NULLS FIRST`; no app-clock skew) instead of an app-clock "now". §D.3 says "the eligible time", which for these queues is now | `null` |
| OP-6 | **F-4: the `sent_at` fence.** `.is('sent_at', null)` on every retry CAS, filter-only (no read column added). It stops re-arming a row whose delivery is **recorded** (a reminder failed after a recorded send; an insight row closed failed by a late runner) | Include |
| OP-7 | **A lost CAS with an unchanged row.** It is either the window closing between check and write, or the `sent_at` fence. The route re-runs eligibility on a fresh clock: a refusal → that 422 code; still allowed → 422 `not_retryable_state`, `warn`, `cause: 'write_predicate'`. Never 409 (nothing changed) and never 500 (the outcome is known) | As proposed |
| OP-8 | **Audit `details` for retry:** exactly 7b's five keys with `action: 'retry'`; `next_attempt_at` in `changes.after`. `deadLettered` omitted, as SA ruled for cancel (OP-10 there): it needs `error_message` or a head count, and `changes.before.attempts` already shows an exhausted row | Omit `deadLettered` |
| OP-9 | **Carried item 5: AI and credits.** Only the briefing can spend: one narration, and only when the day's facts moved since the cached narration. It is charged to the business at its normal measured cost, with the platform as actor (`trigger 'scheduled'`); never the admin. Lead, insight and reminder sends make no AI call. **Business question for the user, in business terms:** "When you re-send a business's morning briefing and its figures have changed since it was first written, writing it again uses a little AI. Charge it to the business as usual, or should admin re-sends be free to them?" | Normal cost, stated in the dialog. Making it free would need a charge-exemption path in the credit layer: a new pattern, out of scope |
| OP-10 | **A retried reminder and the next scheduled overdue chase on the same day** (default overdue days 1, 3, 7; a day-1 reminder retried on day 3). The dispatcher sends both: different rows, the same message type | Dialog copy only. A guard would need an `invoice_id` read in the admin path, which C7-12 keeps out |
| OP-11 | **The window is checked at the press, not at the send** (§E accepted tail). During a cron outage a retried item can go out later than 72 h after it was due. The dispatchers still re-check the world at send time | Accept; the dialog points to Drain now |
| OP-12 | **The list stays optimistic for reminders** near the end of the window: it does not resolve a timezone per row, so "until …" ignores sending hours. The route refuses with a clear sentence | Accept (7a OP-7 already labels it "within the business's sending hours") |
| OP-13 | **Wording.** The action is "Retry item" (the brief), in a column headed "Re-send" (7a). The dismiss is "Close". The warning names "the client", or "the business owner" for the briefing. Alternative: "Re-send item", matching the column | "Retry item" |
| OP-14 | **The 200 body for retry adds `nextAttemptAt`** (ISO for reminders, `null` otherwise), so the dialog can say "not before HH:MM". `QueueItemActionResult` becomes a union by action. The cancel body is unchanged | As proposed |
| OP-15 | **Status-label reuse:** the new dialog imports `KNOWN_STATUS_LABELS` from `./CancelQueueItemDialog` rather than copying it, so the 7b dialog is untouched. Alternative: move it to a tiny shared client module (touches the 7b dialog and its pin) | Import |
| OP-16 | **Guard amendment form** (§2.9): one counted `<RetryQueueItemDialog` allowance in the Re-send cell; the new dialog owns one POST with a pinned body; W7D-5 gains one importer; the R-10 update count goes 1 → 2 | Approve this narrow form |
| OP-17 | **Manual QA on live data.** There are no `failed` rows live (SA 7a §A), so no retryable row exists. QA never confirms a retry on live data; M-5 runs only on a user-named item of their own test business | Binding, as W7B-5 |
| OP-18 | **Counts:** `adminGate.writes` 59 unchanged; census 92 = 86 + 6 + 0 / 63 unchanged; register row 95 text updated in place; event catalogue 178 → 179 (`bos` 33 → 34); no migration; no `CAPS` move | T1 re-measures |
| OP-19 | **The eligibility module gains `retryWriteBound` and `RETRY_ANCHOR_COLUMN`** (7b imported it unchanged). It is the C7-9 single source, so the CAS predicate belongs beside the decision; E-2 pins their equivalence | As proposed |
| OP-20 | **The probe** (§6): four tables through the real method, five "matches nothing" guarantees, and two controls (an unknown **patch** column → PGRST204, an unknown **filter** column → 42703). The user runs it once after SA's code review. §6.2 is not repeated (no new constraint or trigger dependency) | As proposed |

---

## SA Review Notes

### SA Workplan Review (2026-10-04)

**Reviewed by SA, 2026-10-04.** Measured on `feature/admin-queue-retry` @ `50a30939`.
**Status:** ✅ **APPROVED WITH CONDITIONS (W7C-1..W7C-16).** **Scope change:** the briefing dispatcher guard (F-1) leaves this PR and ships first as its own PR. BL-7a(2) (F-2) also ships as its own PR before 7c merges.

**PR order:**
1. **P1, briefing stale-date guard.** No business question. Can start now.
2. **P2, BL-7a(2) on the lead route.** Waits on Q-SA7C-1.
3. **P3, this slice (7c).** Implementation may start once P1 is SA-approved. **It merges only after P1 and P2 have merged.**

#### A. What SA verified (code and live)

| Claim | Verified | Evidence |
|---|---|---|
| The briefing claim has no date predicate | ✅ | `20260911_daily_briefing.sql:138-146` (`status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= now())`) |
| The dispatcher renders `now`, never `row.briefing_date` | ✅ | `DailyBriefingDispatchService.ts:74` passes `(row.user_id, row.timezone, now)`; `:169` `businessDayFor(now, timezone)`; `:237` `date: day.date`. `briefing_date` appears in the file only in the header comment (`:7`) |
| The send window gates the enqueue only | ✅ | `:147-148`, inside `enqueueDueBusinesses` |
| The cron runs hourly at :10 UTC | ✅ | `vercel.json` `/api/cron/daily-briefing` `10 * * * *` |
| `processDueBriefings` fixes `now` once per run | ✅ | `:55` `now = new Date()` default, then reused |
| `markSkipped` is terminal and clears the claim | ✅ | `DailyBriefingSendRepository.ts:119-144` (`markTerminal` clears `claimed_by`, `claimed_at`, `next_attempt_at`) |
| `skip_reason = 'stale_date'` can be written | ✅ | `skip_reason TEXT`, no CHECK (`20260911:105`). The user's 7b §6.2 live run (2026-10-04) found **no CHECK that mentions `skip_reason`**. No new SQL is needed |
| Who reads briefing skip reasons | ⚠️ **Correction** | **No owner surface reads `daily_briefing_sends`**: RLS is on and there is no policy (`20260911:118-119`), and no owner code references the table. `stale_date` appears only in the **admin** Jobs page count "Skipped, last 7 days (expected)" (`JobsQueuesView.tsx:190`). §2.5's "the owner's briefing card counts it" is wrong. Fix the sentence (W7C-2(h)) |
| Existing tests reach `processDueBriefings` | ⚠️ **None do** | Every suite that names the service **mocks** it (`runQueueDrain.test.ts:29`, `runRecord.adoption.test.ts:78`, `qa-slice5-pr2.baseCompare.test.ts:70`). The guard breaks no existing test. P1's suite is the **first** direct test of the runner. D-7 as written cannot work (W7C-2(g)) |
| The lead route drains fire-and-forget, with no `maxDuration` | ✅ | `app/api/business-os/leads/[id]/route.ts:80-82`. The handler is **`PATCH`**, not `POST` as B7-11 says (corrected in the requirement note) |
| Every other claim path is awaited and capped at 60 s | ✅ | Callers of the four drains: the four cron routes (all `maxDuration = 60`, all `await`), `runQueueDrain.ts` (awaited; drain route `maxDuration = 60`), and the lead route. Nothing else in `app/` or `lib/` |
| A lead row becomes `failed` only through the reaper's dead-letter | ✅ | `LeadResponseDispatchService.ts:106-109` leaves a throw `processing`. `LeadResponseRepository.markFailed` has **no caller** |
| F-4 (a `failed` reminder can carry a recorded send) | ✅ **and it is load-bearing** | `PaymentReminderService.ts`: the try branch writes `sent` + `sent_at`, then `await emitPaymentEvent(...)`. If the emit throws, the catch overwrites `status = 'failed'` and keeps `sent_at`. So a **delivered** reminder shows as `failed`, and without the fence a retry sends it again |
| Briefing narration attribution | ✅ | `BriefingStore.ts:68-75` `runAiAction({ area: 'briefing', actionType: 'briefing_narration', trigger, accountId: userId, groupId })`. A cached hash makes no call. Lead, insight and reminder sends make none |
| Counts on the base | ✅ | `adminGate.writes` `toHaveLength(59)` (`:420`); `eventAudience` 178 / `bos` 33 (`:58-59`) |

**Live schema (`business-os-schema-check`, read-only, 2026-10-04).** Zero-row selects (`limit(0)`) with the service role. Nothing was written and no RPC was called.

| Table | Confirmed present |
|---|---|
| `payment_reminders` | `id, user_id, status, attempts, sent_at, scheduled_at, next_attempt_at, claimed_by, claimed_at, error_message` |
| `daily_briefing_sends` | `id, user_id, status, attempts, sent_at, briefing_date, timezone, next_attempt_at, claimed_by, claimed_at, skip_reason, error_message` |
| `lead_responses` | `id, user_id, status, attempts, sent_at, created_at, next_attempt_at, claimed_by, claimed_at, skip_reason` |
| `insight_actions` | `id, user_id, status, attempts, sent_at, created_at, next_attempt_at, claimed_by, claimed_at, skip_reason` |

Negative control: `lead_responses.scheduled_at` → `42703`. **Every column in the retry patch and the CAS filters exists on all four tables.** OP-6 is confirmed. The §6 probe is still required (C7-3), because it proves the **update** shape.

#### B. Ruling on OP-1 (the briefing stale date): **guard approved, as its own PR (P1), before 7c**

**The finding is correct, and it is a live production defect today, without any admin action.** Here is the outage case. A row is enqueued at about 10:10 local on day D. The cron (or `CRON_SECRET`) is down until after local midnight. The first run on D+1 claims the D row and renders **D+1's** facts under the D row. At 07:10 on D+1 the D+1 row is enqueued and sent again. The business gets D+1's briefing twice.

**The guard is correct and minimal.**
- It sits at the choke point (the `durable-queue-drain` skill, Step 6: guardrails where the effect runs, not at the enqueuer), so the cron, Drain now and a retry all pass through it.
- It computes one `BusinessDay` per row from the **row's stored `timezone`**, the zone its `briefing_date` was written in. It does not use the current `user_preferences` zone, so a zone change mid-day cannot create a false mismatch.
- The same object is used for the check and the render, so the checked date is the rendered date.
- It closes the row with the existing terminal write (`markSkipped`), before any facts, narration (AI spend) or email.
- It needs no migration and no RPC change. A date predicate inside the claim RPC was rejected: it would need the zone arithmetic in SQL and a migration, for the same effect.

**Why its own PR, first:**
- It fixes an existing production bug on a live send path, independently of 7c.
- It must be revertable alone. The workplan's own rollback note ("keep the guard on any partial revert") shows that bundling makes 7c's revert unsafe.
- It shrinks 7c's diff to admin code plus one additive service method.
- 7c's briefing-retry safety depends on it, so it merges first. 7c's briefing dialog sentence ("if no run happens before midnight there, it is closed without being sent") is only true once P1 is live.

**Effect on the `durable-queue-drain` guarantees:** none weakened.
- Claim, reap and lease are untouched.
- `skipped` is terminal, so the reaper ignores it.
- The one new outcome is a terminal close with no effect.

  A failed `markSkipped` write (the repository logs it and returns an error) leaves the row `processing`. The reaper re-pends it with backoff, the next run skips it again, and after `MAX_ATTEMPTS` it is dead-lettered. It is **never sent**. That is fail-safe.

**Behaviour change, an FYI for the user (§F):** during an outage that spans the business's midnight, yesterday's unsent briefing is now dropped instead of being sent late with today's content. Today's own briefing still goes out.

The "last 70 minutes" route refusal (`briefing_too_late`) is **not** added. With P1 live, a late retry is harmless (at worst it is closed `stale_date`, never sent), and the dialog says so.

#### C. Ruling on OP-2 (BL-7a and lead-reply retry): **option (a), P2 before 7c merges**

**Dev's analysis is correct.**
- The lease rule (skill Step 3) holds only where the platform hard-kills the runner at `maxDuration`.
- The lead route's un-awaited drain can outlive its response. On Vercel the instance can be frozen and resumed. So nothing proves that runner dead at 90 s.
- On the three other retryable queues, a `failed` row's last runner is provably dead.
- Retry adds exactly the case Dev describes: re-arming a dead-lettered row that a frozen runner still holds in memory, which gives two live sends.
- BL-7a part (1) (the `claimed_by` fence on terminal writes) corrects the final state, but **cannot stop the late runner's send**. Part (2) is the minimum guard.
- Option (c) is rejected. Option (b) (`retry_held`) is the **fallback only** if the user declines the P2 trade-off (Q-SA7C-1). It needs an SA re-check of that delta.

**P2 content (about 0.5 day, its own SA-reviewed PR, branch `fix/lead-route-awaited-drain`):**
1. `app/api/business-os/leads/[id]/route.ts`:
   - `export const maxDuration = 60;`, with a comment tying it to `LeadResponseDispatchService` `LEASE_SECONDS = 90`;
   - replace the fire-and-forget call with `try { await dispatchLeadResponses(); } catch (err) { requestLogger.warn({ err }, 'Immediate drain failed; the cron will pick it up'); }`.

   The response stays `{ success: true }` once `sendNow` has scheduled the row. A drain failure is not the owner's failure, and the cron still sends it.
2. **Recommended, not required:** an optional `{ batch }` argument on `dispatchLeadResponses`. The default of 25 stays unchanged for the cron and Drain now (`runQueueDrain.ts` still calls it with no argument, so the W7D-5 S-1 pin holds). The route passes a small batch, for example 5, so the owner's wait stays at a few seconds and a 60 s kill (504) is unlikely. Dev measures and states the expected worst-case wait in the PR. If the batch is not added, the PR states why 25 rows fit well inside 60 s.
3. **Tests** (new `app/api/business-os/leads/[id]/__tests__/route.test.ts`, plus one guard):
   - L-1: `send_now` happy path. A held drain promise keeps the response pending, and it resolves after the drain resolves. This proves the drain is **awaited**;
   - L-2: the drain rejects → 200 `success: true`, one `warn` with `{ err }`, no 500;
   - L-3: `cancel`, and `send_now` with `scheduled: false`, never call the drain;
   - L-4: 401 without a user, 400 on an invalid body, and the drain is not called;
   - L-5: a source pin. `export const maxDuration = 60` is present, `await dispatchLeadResponses(` is present, and there is no un-awaited `dispatchLeadResponses(…).catch(`;
   - L-6, **a repo-wide lease-invariant guard** (new, small): the runtime callers of `processDueReminders`, `processScheduledExecutions`, `processDueBriefings`, `dispatchLeadResponses` and `drainInsightActions` under `app/` and `lib/` are exactly the five cron routes, `runQueueDrain.ts` and the lead route. Every **route** caller exports `maxDuration = 60` and `await`s the call. This turns the B7-11 class into a test failure instead of a review finding;
   - mutation proofs: remove `await` (L-1 and L-5 go red); remove `maxDuration` (L-5 and L-6 go red).
4. `console.*`: the route has 0 and `NeedsYouCard.tsx` has 0 (counted). The client needs no change: it already shows a working state while it waits.
5. **Not in P2:** BL-7a(1) (the `claimed_by` fence), BL-7c, and the claim/RPC.

#### D. Rulings on OP-3..OP-20

| OP | Ruling |
|---|---|
| **OP-3 / F-3** | **Approved as proposed.** `lib/admin/jobs/reminderRetryTime.ts` (`server-only`) becomes the one extra service importer. W7D-5 S-2 is amended to **exactly** `[runQueueDrain.ts, reminderRetryTime.ts]`, and S-10 pins the helper: imports, the single `.nextSendableAt(` member call, the forbidden names, and a returned promise. W7B-6 (the route imports nothing from `lib/services/`) stays **unchanged**. The intent of W7D-5 (no side-effecting service function is reachable from the admin path) is kept. **Also:** `runQueueDrain.ts`'s header says its five imports are "the only runtime imports of these service modules anywhere on the admin path". Amend that **comment only** to name the helper, because a stale guard comment misleads the next reader. The import pins (S-1) are unchanged |
| OP-4 | **Accepted** (the same rule every scheduled reminder follows). Note for the record: `businessZone` binds no `error`, so a PostgREST error (not only a throw) falls back to UTC, **and the fallback is cached** for the instance's life. Logged as backlog **BL-7d** (do not cache a fallback zone). Not this slice |
| OP-5 | **Accepted:** `next_attempt_at = NULL` on the three non-reminder queues (due now; `NULLS FIRST` on the lead and insight claims; no app-clock skew). §D.3 is amended in the requirement |
| **OP-6 / F-4** | **Required.** `.is('sent_at', null)` on every retry CAS. The column exists live on all four tables (§A). It is filter-only, so no read column is added and C7-12 is unchanged. The reminder emit-after-send path makes this fence load-bearing, not cosmetic. The underlying defect (a delivered reminder recorded as `failed` when `emitPaymentEvent` throws) is backlog **BL-7e**, not this slice |
| **OP-7** | **Accepted, with one clarification.** On a lost CAS with an unchanged `status`/`attempts`, re-run eligibility with a **fresh `new Date()`** and the **same `retryAt` already computed**. Make **no second wrapper call**, and delete the words "(`max` of the two)". For reminders the bound is `retryAt − 72 h`, which does not move with the clock, so there the only cause is the `sent_at` fence → 422 `not_retryable_state`, `warn`, `cause: 'write_predicate'`. Never 409, never 500, no audit |
| OP-8 | **Accepted:** `details` exactly `reason, queue, action, correlationId, dueAnchor`. `deadLettered` is dropped for retry as for cancel (requirement §G amended) |
| **OP-9** | **Normal cost, at most one narration, charged to the business, with the platform as actor.** Nothing in the admin path calls the LLM layer. A free admin re-send would need a charge exemption in the credit layer: a new pattern, out of scope. It is a real but small business choice, so it goes to the user as **Q-SA7C-2**, non-blocking, default "charge as normal". The dialog sentence stays |
| **OP-10** | **Accepted, as dialog copy only.** A route guard would need an `invoice_id` read, which C7-12 keeps out. The dispatcher still skips a paid invoice. The 72 h window bounds the overlap: a reminder due on day 1 can be retried until day 4 at the latest |
| **OP-11** | **Accepted** (§E's accepted tail). The window is checked at the press. At send time the dispatchers re-check the world (B7-6), and P1 adds the briefing's own send-time date check. The dialog points to Drain now |
| OP-12 | Accepted (the route is the authority; a clear 422) |
| OP-13 | Accepted: "Retry item". The dismiss is "Close". The warning names "the client", or "the business owner" for the briefing. This meets C7-13 |
| OP-14 | Accepted: `nextAttemptAt` in the retry 200 body, and the result is a union by `action`. The cancel body is byte-identical |
| OP-15 | Accepted: import `KNOWN_STATUS_LABELS` from `./CancelQueueItemDialog`. A shared module is a later refactor, not a blocker |
| OP-16 | Accepted, in the narrow form of §2.9 (one counted dialog element in the named Re-send cell; the R-10 update count goes 1 → 2) |
| **OP-17** | **Binding.** There are no `failed` rows live, so no retry is confirmed on live data. QA never creates, seeds, hand-edits or re-statuses a queue row. M-5 runs **only** on an item the user names in writing, from their own test business. Otherwise it is recorded as "not exercisable on live data" |
| OP-18 | Confirmed on the base: writes 59 unchanged, census 92 = 86 + 6 + 0 / 63 unchanged, register row 95 text only, catalogue 178 → 179, `bos` 33 → 34, no migration, no `CAPS` move. T1 re-measures |
| OP-19 | Accepted: `retryWriteBound` and `RETRY_ANCHOR_COLUMN` live beside the decision. E-2 pins their equivalence |
| **OP-20** | **Accepted.** Four tables go through the real method, with five independent "matches nothing" guarantees, a count-only pre-read that exits before any update, and two controls (an unknown **patch** column → `PGRST204`; an unknown **filter** column → `42703`). The main calls already cover every **filter** column (a missing `sent_at` would fail them with `42703`). Prints queue, outcome and code only, no ids. Run once by the user after SA's code review, never committed. Today's live column check does not replace it |

#### E. Conditions

1. **W7C-1, PR order and scope.**
   - P1 (§B) and P2 (§C) are separate PRs, and **both merge before 7c**.
   - 7c's diff **does not touch** `DailyBriefingDispatchService.ts` or `app/api/business-os/leads/[id]/route.ts`. Remove from this workplan: §2.5's code, T5, `DailyBriefingDispatchService.staleDate.test.ts`, §5.6's D-1..D-7, and mutations 16 and 17. They move to P1's workplan.
   - Keep BM-1..BM-5 (the route side).
   - M-7 then expects `DailyBriefingDispatchService.ts` to be **unchanged** in 7c's diff.
   - T0 becomes "P1 and P2 merged (or SA has ruled fallback (b))".
2. **W7C-2, P1 specification** (Dev writes a short P1 workplan; SA reviews it before code):
   - (a) The stale check sits **inside** the existing per-row `try`, so an unexpected throw affects only that row.
   - (b) It logs at **`warn`**, not `info`, with `{ userId, briefingDate, runDate }`: in normal operation it never fires, so it signals an outage or a late retry.
   - (c) It uses the reason literal `stale_date` (writable, §A).
   - (d) It computes the day from **`row.timezone`**.
   - (e) It compares exact `'YYYY-MM-DD'` strings, and the tests feed `briefing_date` in PostgREST's `DATE` shape.
   - (f) `dispatchOne(userId, day)`: drop the `now` parameter if nothing else in `dispatchOne` uses it.
   - (g) The new suite mocks `supabaseServer` (the enqueue reads, plus the profile, preferences and `auth.admin` reads) as well as the repository, facts, store, branding and email. **D-7 is replaced** by a statement that Drain now reaches the guard by construction (`runQueueDrain` maps `daily_briefing_sends` to `processDueBriefings`, already pinned).
   - (h) Correct the "owner's briefing card" sentence (§A).
   - (i) A future-dated row (D-3) is skipped, which is fail-closed. Keep the test.
   - (j) Mutation proofs: remove the check; let `dispatchOne` recompute the day; compare against `user_preferences` instead of `row.timezone`.
   - (k) PR body: "fixes a pre-existing double send when the briefing cron is down across a business's midnight", with the FYI wording from §F.
   - Effort about 0.5 day.
3. **W7C-3, P2 specification:** §C items 1–5. The PR names Q-SA7C-1's answer. Fallback (b) if the user declines.
4. **W7C-4, the retry CAS** is exactly the one statement in §2.3:
   - `.update(patch, { count: 'exact' })`, then `id`, the row's own `user_id`, `status = 'failed'`, the expected `attempts`, `.is('sent_at', null)`, and the queue bound from `retryWriteBound`. For reminders that bound is `gte scheduled_at = retryAt − 72 h`, **never** `now − 72 h`.
   - No `.select()`, no `.or()`.
   - A win only on `count === 1`.
   - Never resets `attempts`, never writes `error_message`, `skip_reason`, `scheduled_at`, `sent_at`, the payload or targets, and never sends inline.
   - Mutations 1–15 and 18–25 stay.
5. **W7C-5, the real clock:** `new Date()` exactly once in `retryItem`, used for eligibility and the bound. The list's minute-floored clock is never imported (B-8, mutation 14).
6. **W7C-6, the owner comes from the row:**
   - the CAS `ownerUserId` and the wrapper's `userId` are both `row.userId`, never the body or the admin (T-1);
   - the strict schema rejects every time, owner and account field (Z-2).
7. **W7C-7, OP-3 as ruled:** the helper, the S-2 set of exactly two, S-10, the W7B-6 pin unchanged, and the `runQueueDrain.ts` comment-only amendment. `PaymentReminderService` changes **additively only** (the one public wrapper). `sendableAt`, `businessZone` and the window constants stay byte-identical (S-3, M-7).
8. **W7C-8, OP-7 as clarified** (§D).
9. **W7C-9, no payment event, no notice:** an admin retry emits no `reminder.*` or other payment event, and writes nothing the owner can see except the eventual ordinary send (UC-9; 7b OP-14). The route's existing "no `lib/services`" pin and the new send-path name pin cover it.
10. **W7C-10, audit:**
    - `BOS_QUEUE_ITEM_RETRIED`, `bos_queue_item` (already `'operator'`, `20261035` applied), `userId` = the item's account, `actorId` = the admin, `warning`;
    - the `changes` / `details` shapes of §2.7;
    - the order Pino → `await logAndFlush` → 200, only after a win (A-1..A-6).
11. **W7C-11, AI and credits:** nothing in the admin path imports the LLM layer, `runAiAction` or a credit module. A source pin on the route, the repository and the helper is enough. A briefing re-narration, if any, happens inside the dispatcher under `trigger 'scheduled'`, `accountId` = the business, at its normal measured cost.
12. **W7C-12, the dialog copy** of §2.8 stands, including the briefing's "only today … closed without being sent" sentence (true once P1 is live) and the AI-cost sentence on the briefing only.
13. **W7C-13, the guard amendments** are exactly §2.9 (OP-16), with each amendment counted and named in the PR body.
14. **W7C-14, the probe** is §6 as ruled (OP-20). QA records its output. Any deviation stops the merge.
15. **W7C-15, counts and CI:** writes 59, census 92 / 63, catalogue 179 / `bos` 34, no migration, no `CAPS` move. `npm run test:authz-guard`, `npm run test:bos-entitlements` and `npm run lint:hooks` are run locally and recorded. `console.*` is re-counted in every modified file (expected 0). Scoped `tsc` with the exit code checked (skill Rule 7). `git diff --stat` shows no deletion-only file.
16. **W7C-16, effort:** 7c without the guard is about **18 h (about 2.25 days)**. P1 is about 0.5 day and P2 about 0.5 day. The overage against SA's 1.5–2 days is real work found here (F-1 to F-4), and is accepted. **No further split of 7c:** splitting the route from the dialog would ship an unused route case for no safety gain.

#### F. For the user (business terms)

- **Q-SA7C-1 (needed before P2): when a business owner presses "Send now" on a queued reply to a lead, should the page wait until the reply has actually gone?**
  - Today the page answers at once and the sending carries on in the background. That background sending is the one place where an admin re-send could make a client receive the same reply twice.
  - Making the page wait closes that gap. The wait is usually a few seconds.
  - *Recommended: yes, wait.* The alternative is that "Send now" means "within 5 minutes" (the regular run). That is equally safe but slower for the owner.
  - If you decline both, admin re-sends of lead replies stay switched off until this is fixed.
- **Q-SA7C-2 (non-blocking): re-sending a business's morning briefing can use a little AI, only if its figures changed since it was first written. That is charged to the business at its normal rate, as the original send would have been.**
  - Free admin re-sends would need new billing machinery.
  - *Recommended: charge as normal.* That is the default if you say nothing.
- **FYI-7C-1: a fix to an existing problem ships first.** If the briefing's scheduled run is down across a business's midnight, it could get the next day's briefing twice. After the fix, a briefing that missed its day is simply not sent late, and the next day's briefing goes out normally. No action is needed.

#### Approval

- [x] Workplan approved, **with conditions W7C-1..W7C-16**. Dev first writes P1's short workplan (SA reviews it). P2 follows Q-SA7C-1. 7c's implementation may start after P1 is SA-approved, and 7c merges after P1 and P2.

---

### SA Code Review (2026-10-04)

**Code Review by SA, 2026-10-04.** Read against `1a9944a5` (`git diff 1a9944a5` plus the 10 untracked files), uncommitted. Nothing in the worktree was written except this section and its Change History row. SA's own runs used `scratchpad\sa7c\` only.
**Status:** ✅ **Code APPROVED WITH CHANGES.** The code needs no change. Five doc and test items (CR7C-1..CR7C-5) must be done before RM; CR7C-6..CR7C-8 are Low. The **merge gates** below are unchanged from the workplan review.

#### A. What SA verified (re-run, not taken on trust)

| Dev claim | SA result |
|---|---|
| Wide run 6,375 / 6,375 | **252 suites / 6,376 tests, green.** That is one more than recorded. The route suite is 124 with X-13b, so the recorded figure predates X-13b (QA measured 6,376 too). CR7C-7 |
| `test:bos-entitlements` 4,625 | ✅ 181 suites / 4,625 |
| `test:authz-guard` 119 | ✅ 119 / 119 |
| Census 93 = 87 + 6 + 0 / 64 | ✅ Re-measured with the guard's own `scanHandlers` / `stripComments`: 64 files, 93 handlers, 87 `requireAdmin`. The +1 is `business-os/ai-activity/drill-down#GET` (PR #214), whose first statement is `requireAdmin` and which is not registered |
| Scoped `tsc`: 0 errors in touched files | ✅ SA's own scratch tsconfig (the 12 touched sources + 4 new suites). Exit 2, all 23 errors in the 5 untouched files Dev named (`StripeInvoiceService` 12, `aiAnalytics` 6, `InvoicePDFGenerator` 3, `InvoiceDeliveryService` 1, `booking-confirmation` 1) |
| ESLint, `lint:hooks` | ✅ 0 errors, the 2 pre-existing warnings; `lint:hooks` clean |
| 32 / 33 mutants killed, M11 equivalent | ✅ Read `mutate.js` and every result line. M04 first died of a suite error, and its re-run (`mutation-results-M04.txt`) is a genuine R-4 kill. M27 first **survived**, and X-13b now kills it (re-run file). The helper control's "1 failed" sits outside its S-10 filter: it is a pin-copy run where only S-10 counts, and S-10 stayed green. CR7C-8 |
| Untouched files | ✅ `git diff 1a9944a5 --stat`: no `DailyBriefingDispatchService.ts`, no `leads/[id]/route.ts`, no cron route, no `lib/cron`, no `vercel.json`, no migration, no lead / insight / automation service, no `CancelQueueItemDialog.tsx` / `DrainNowDialog.tsx`. `origin/main` has moved (#216, #217), but it touches none of 7c's files |
| `PaymentReminderService` additive only | ✅ +12 lines (the wrapper). `sendableAt`, `businessZone` and `REMINDER_WINDOW_OPENS_AT/CLOSES_AT = 8/20` are byte-identical. **Note:** the unrelated `SEND_WINDOW_START/END = 8/11` at `:173` is another rule; the dialog's "08:00–20:00" is correct |

#### B. Focus items

| Item | Verdict | Evidence |
|---|---|---|
| **The retry CAS (W7C-4)** | ✅ | `AdminQueueActionsRepository.ts` `retryQueueItemAllAccounts`: `.update(patch, { count: 'exact' })` → `.eq('id')` → `.eq('user_id', ownerUserId)` → `.eq('status', 'failed')` → `.eq('attempts')` → `.is('sent_at', null)` → the bound (`eq briefing_date` or `gte scheduled_at/created_at`). No `.select()` / `.or()`. A win only on `count === 1`; `0` → `not_matched`; `null` or any other count → `count_unconfirmed`. The patch is a copy of a frozen constant `{ status: 'pending', claimed_by: null, claimed_at: null, next_attempt_at }`. It never names `attempts`, `error_message`, `skip_reason`, `scheduled_at`, `sent_at` or the payload. R-4 pins the exact chain on all four queues. `RETRY_FROM_STATUSES` is `['failed']` on the four (dead-lettered = `failed` + marker), so "plus `dead_letter`" needs no separate status |
| **The bound** | ✅ | `retryWriteBound`: reminders `scheduled_at >= retryAt − 72 h`, and `retryAt` is **required** (DV-6); leads and insights `created_at >= now − 72 h`; briefing `briefing_date = businessDayFor(now, tz ?? 'UTC').date`, the same zone fallback as `briefingAnchor`. Each is the same inequality as the decision. The bound is checked again in the repository (`isBoundFor`: this queue's column, exactly one of `eq` / `gte`, a strict ISO instant or a real calendar date) |
| **The owner** | ✅ | `ownerUserId: row.userId` and `reminderRetryTime(row.userId, now)`, both from the server read. Strict Zod, unchanged; M21 / M22 |
| **Real clock, once** | ✅ | `retryItem` has exactly one `new Date()` (`route.ts:431`, pinned by B-8), used for the helper, the decision and the bound. `explainUnmovedRetry` uses a fresh `new Date()` with the **same** `retryAt` and makes no second helper call (OP-7 as clarified; X-13b). Reminder lost CAS → `not_retryable_state` / `cause: 'write_predicate'` |
| **`reminderRetryTime.ts` / `nextSendableAt`** | ✅ | `server-only`; imports exactly `paymentReminderService`; one member access, `.nextSendableAt(`, returned and never fire-and-forget. S-2 importer set is exactly `[runQueueDrain.ts, reminderRetryTime.ts]` and S-10 pins the helper. The forbidden names include `processDueReminders`. The route still imports nothing from `lib/services` (W7B-6 / T-5). `runQueueDrain.ts` changes in its comment only. The reminder claim honours `next_attempt_at` (`2026-08-14_payment_reminders_claim.sql:58-60`), so a future sending time really defers the send |
| **No payment event, no AI** | ✅ | Source pins: route T-5 (`processDue|drain|claim_due|.rpc(`, `runAiAction|getProviderFactory|lib/ai|business-os/(llm|credits)`), repository R-8, helper S-10. `nextSendableAt` only reads `user_preferences.timezone` |
| **Audit** | ✅ | `BOS_QUEUE_ITEM_RETRIED` is written only after `outcome === 'retried'`, after the Pino line and before the 200 (`await logAndFlush`). `entityType: 'bos_queue_item'` (operator), `userId` is the row's account, `actorId` is the admin, `severity: 'warning'`. `details` are exactly `reason, queue, action, correlationId, dueAnchor`, with **no `deadLettered`**. `changes.after.next_attempt_at` is set. Catalogue 179, `bos` 34. Nothing is written on a lost, refused or unknown outcome (M25 / M26) |
| **Dialog** | ✅ | The warning names "the business owner" for the briefing and "the client" otherwise. The per-queue next steps follow §2.8, including the OP-10 same-day chase and, on the briefing only, "only today … closed without being sent" and the AI-cost sentence. The dismiss is "Close"; there is no Cancel and no Drain (DV-4). Fixed sentences only: `error`, `details` and `message` are never read, the 409 label is accepted only from `KNOWN_STATUS_LABELS`, and times are shown only when they parse. A `useRef` in-flight guard plus `canConfirm` give one request on a same-tick double click (U-5). It cannot be dismissed while busy |
| **Guards** | ✅ narrow | Exactly §2.9 / OP-16: one counted `<RetryQueueItemDialog` in the second-to-last cell; the 7b Cancel-cell pin is unchanged plus "no retry dialog there"; the new dialog's single POST, literal URL and pinned body; the view sentence; W7D-5 +1 importer with S-10; R-10 1 → 2 updates, each `count: 'exact'`; Z-1 / Z-8; E-13 +`retryHolds` with `retryHolds.ts` pinned to no imports. Nothing else is loosened |
| **7b §10 doc fix** | ✅ | Both lines are corrected with dated notes (CR7B-1 PGRST204; CR7B-2 row 95, census 92 / 63 at merge) |

#### C. Rulings

1. **`LEAD_RETRY_HELD`: the placement is approved.** It is a constant-only module with no imports and `false as boolean`, so TS never narrows it. It is enforced at three points: the eligibility queue rule (first, like automations); the route (422 `retry_held` before any read); and the repository (no request). `retryWriteBound` also returns `null` while it is held. A code constant, not an env flag, is the right choice: holding a send path is a reviewed decision.
   - **Shipping it `false` is correct only once P2 has merged.** That was already the T0 / W7C-1 gate. QA-1 is right that nothing enforces it, so CR7C-3 makes CI enforce it.
   - **Flipping to `true` is behaviourally safe, but it is not a one-line change.** SA ran the four touched areas (`lib/admin`, `app/admin`, `app/api/admin/jobs-queues`, the repository suites: 89 suites, 2,601 tests) with `retryHolds` mapped to a `true` copy through a scratch Jest config. Every route, repository, render and guard suite stays green: the hold refuses everywhere, before any read, and offers no button. **10 tests in 3 suites go red**, and every one is an expectation that assumes lead retry is offered:
     - `buildQueueItemsView.test.ts`: W7A-7(a);
     - `queueItemEligibility.test.ts`: E-1 lead matrix ×3, E-5, E-11 lead, CR7A-1 ×2, W7A-7(a) lead;
     - `queueItemEligibility.retry.test.ts`: the "ships OFF" pin.

     Under the hold, a lead row in `processing` or `sent` also reads `retry_held` ("no: paused on this queue for now") instead of `not_retryable_state`. That is accepted, because it is a queue rule, as for automations. A flip is therefore one source line plus those expectations, and it needs SA's re-check of the delta, as ruled in §C (CR7C-4).
2. **Deviation 3 (the reminder's time shown only after the 200): accepted.**
   - The client cannot know the business's zone, and showing the time earlier would need a new per-row zone read, which C7-12 / OP-12 keep out.
   - Before confirming, the dialog states the 08:00–20:00 business-time rule.
   - After the 200 it shows "Not before {UTC}".
   - An admin who disagrees can cancel the now-`pending` row (7b) before it is due.
3. **Deviation 1 (E-13's import-list pin, + `retryHolds`): accepted.** It is forced by the hold module, it is counted, and the new module is itself pinned to no imports and to the exact one-line shape (`false|true`).
4. **Deviation 6 (`retryWriteBound` fails closed without `retryAt`): accepted. It is required behaviour.** Defaulting to `now` would silently give the looser `now − 72 h` bound (carried item 2).
5. **DV-2, DV-4, DV-5, DV-7: accepted.**
6. **The access register: add it in 7c, doc-only (CR7C-2).** The register must match the measured census at merge, and this slice's own Change History row would otherwise record a known mismatch on `main`. The precedents are the 7b D-2 doc-only row and row 94's doc-only registration on the 11c merge. If a separate fix for PR #214 lands first, drop this row on rebase, as 7b did.
7. **M11: equivalent. Keep the line as defence in depth.** Without the explicit automations refusal, the repository still makes no request:
   - `RETRY_FROM_STATUSES.payment_automations` is `[]`, so `includes('failed')` is false;
   - `isBoundFor` compares against `RETRY_ANCHOR_COLUMN['payment_automations']`, which is `undefined`.

   No observable output differs. It is also not quite "unkillable": removing the line makes `const queue: RetryableQueueId = input.queue` a type error. `tsc` would catch that; ts-jest does not type-check here.

#### D. The live probe (`scratchpad\dev7c\probe-retry-cas.ts`): **approved to run. It provably cannot change a row.**

- **All six writes filter on `.eq('id', crypto.randomUUID())`.** This covers the four repository calls and the two raw controls. A fresh v4 UUID cannot equal an existing primary key, so each UPDATE matches zero rows whatever its other filters. The four main calls also carry a fresh random owner, `attempts = 99999`, `status = 'failed'` and `sent_at IS NULL`, and they are preceded by a count-only head read that exits on any count other than 0 or on any error.
- **There is no `.select()`.** There are zero triggers on the tables (7b §6.2 (d)). The route is not called, so no audit row is written. The script refuses to run if `LEAD_RETRY_HELD` is on, so the lead call cannot silently make no request.
- **The run line is correct.** SA checked it without DB access: `tsx --tsconfig tsconfig.json` resolves the `@/` aliases from the scratchpad path (a scratch script imported `retryHolds` and `queueItemEligibility`). The full repository chain loads under tsx with dummy env values and no request: `supabaseServer` → `logger` → eligibility → `retryHolds`, with no `server-only` in that chain. `node_modules\.bin\tsx.cmd` exists. It must be run **before** the 7c files leave the worktree (they are uncommitted).
- Two Low notes (CR7C-6):
  1. The header says it prints "no ids". The repository's own Pino lines will print this run's random item id and `adminUserId: 'probe-7c'`. That is harmless, but copy 7b's paragraph that says so.
  2. The env parser does not accept an `export ` prefix (7b's did). Against an exported line it fails closed ("missing from .env.local"), so this is cosmetic.

#### E. Code Review Comments

| # | Where | Finding | Priority |
|---|---|---|---|
| CR7C-1 | Workplan §10 (PR body draft), §7 M-7, §8, §9 | **Stale after W7C-1.** RM copies the PR body. §10 still lists the briefing dispatcher change, "census 92 = 86 + 6 + 0 / 63", and "briefing dispatcher guard" under Tests. Its "Depends on" omits P1 (#215, merged) and the probe. §7 M-7 still expects "`DailyBriefingDispatchService.ts`: the §2.5 hunk only" (W7C-1 requires it **unchanged**). §8's C7-7 row cites §2.5 / §5.6, and §9 has the G-B rows and "keep the dispatcher guard on any partial revert". Fix all of them: point C7-7 at P1 (#215) plus BM-1..BM-5; add the `LEAD_RETRY_HELD` line, the S-10 amendment and the counts after CR7C-2 to the PR body | Medium |
| CR7C-2 | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | Register `business-os/ai-activity/drill-down#GET` as a **doc-only row 96** (gated; `requireAdmin` first statement, `drill-down/route.ts:60`; read-only, no audit row, `actionId` the only input, per its header). Update the headline, "What is true", the register heading `(92)` → `(93)` and the summary line to **93 / 87 + 6 + 0 open / 64 files**. Re-word this slice's Change History row (it currently says "not registered by this slice"). No cap moves, and `adminGate.writes` stays 59 | Medium |
| CR7C-3 | New test, e.g. `lib/admin/jobs/__tests__/queueItemEligibility.retry.test.ts` or `drain.source.guard.test.ts` | **The P2 interlock (closes QA-1).** Add one source pin: *if the shipped `LEAD_RETRY_HELD` is `false`, then `app/api/business-os/leads/[id]/route.ts` exports `maxDuration = 60` and contains `await dispatchLeadResponses(` with no un-awaited `dispatchLeadResponses(…).catch(`*. It reads the file with `fs` and never imports it (S-9 holds). It is **red on this branch now**, by design, and goes green when the branch is rebased on P2, or when the hold is flipped. The required Jest checks then block a merge that would offer lead retry before P2. QA's `scratchpad\qa7c\qa7c.p2Gate.test.ts` is the model. Mutation proofs: set the hold `false` against a lead-route copy without `await` (red); set it `true` (green) | Medium |
| CR7C-4 | `lib/admin/jobs/retryHolds.ts` header; IN-3 | Correct "flip it to `true`" to the measured procedure: one source line, plus the 10 expectations listed in §C.1 (3 suites), plus SA's re-check. Optionally, also name the list words ("no: paused on this queue for now") the flip produces | Low |
| CR7C-5 | `app/api/admin/jobs-queues/items/action/route.ts` header ("Never … logs … an account id") | On a reminder retry, `nextSendableAt` → `sendableAt` / `businessZone` writes the service's existing `info` / `warn` line with the business's `userId` and zone, whenever the time falls outside sending hours or the zone read fails. That is the platform's normal server logging, the same as every scheduled reminder. It is acceptable, but the header claim is now untrue for that path. Make a comment-only amendment: "…the route itself never logs an account id; the sending-hours lookup logs the business's id and zone as every scheduled reminder does" | Low |
| CR7C-6 | Probe header | §D's two Low notes | Low |
| CR7C-7 | IN-5, Change History | The wide run is **6,376** (measured by SA and QA), not 6,375 | Low |
| CR7C-8 | IN-6 | Say that M04's and M27's kills come from their re-runs (`mutation-results-M04.txt`, `-M27.txt`; M27 survived the first run, which is why X-13b exists), and that the helper control's single failure is outside its S-10 filter | Low |

#### F. Optimisation Suggestions (non-blocking)

- `KNOWN_STATUS_LABELS` is imported from `CancelQueueItemDialog.tsx` (OP-15). A tiny shared `jobsLabels.ts` remains the later refactor.
- `ANCHORED_RETRY_CODES` includes `no_due_time`, whose `anchorAt` is always `null` by definition. It is harmless, and the dialog drops the time.

#### G. Merge gates (unchanged, restated)

- [ ] **P2 merged** (Q-SA7C-1), and 7c rebased on it, so CR7C-3 is green. **Or**, if the business declines both options: `LEAD_RETRY_HELD = true` per CR7C-4, re-checked by SA.
- [ ] The user ran the §6 probe: 4 × `not_matched`, controls `PGRST204` / `42703`, `PROBE PASS`. QA records it. Any deviation stops the merge (W7C-14).
- [ ] CR7C-1..CR7C-5 done. (CR7C-6..8 are Low and may ride along.)
- [ ] Q-SA7C-2 is not blocking; the default is "charge as normal", as the dialog says.

### Code Approved for QA: **Yes**, with CR7C-1..CR7C-5 before RM. QA's PASS WITH NOTES stands. CR7C-3 adds one red-by-design test, which QA should re-run after P2.

---

## Implementation Notes (Dev, 2026-10-04)

Code complete on `feature/admin-queue-retry` @ `1a9944a5`, **uncommitted**. P1 is merged (PR #215) and is not in this diff. P2 is not built; **7c must not merge until P2 merges** (or SA rules fallback (b) and `LEAD_RETRY_HELD` is set to `true`).

### IN-1 Counts, re-measured on `1a9944a5`

| Count | Measured | Note |
|---|---|---|
| `adminGate.writes` | **59** (298 tests green) | Unchanged; its case keeps `action: 'cancel'` |
| Census (the authz guard's own `scanHandlers` + `stripComments`) | **93 = 87 + 6 + 0 open / 64 files**, before and after | Unchanged by 7c. The +1 against the access doc's 92 / 63 is `business-os/ai-activity/drill-down#GET` (PR #214, Admin AI Activity B2): gated, not registered at the time. *Amended 2026-10-04 (CR7C-2): now registered here as row 96, doc only; see IN-8* |
| `npm run test:authz-guard` | 119 / 119 | No `CAPS` value moved |
| Event catalogue | 178 → **179**; `bos` 33 → **34** | `BOS_QUEUE_ITEM_RETRIED` |
| Owner-hidden list | unchanged | `bos_queue_item` is already `'operator'` (`20261035`); `ownerVisibility`, data-export and owner-policy migration suites green, unedited. **No migration** |
| `console.*` in the 15 modified/new source files | **0** | — |

### IN-2 What was built

| File | Change |
|---|---|
| `lib/admin/jobs/queueItemEligibility.ts` | Additive: `RetryableQueueId`, `RETRY_ANCHOR_COLUMN`, `RetryWriteBound`, `retryWriteBound`; the `retry_held` queue rule. Header comment corrected (the CAS bound is `retryAt − 72 h`) |
| `lib/admin/jobs/retryHolds.ts` (new) | `LEAD_RETRY_HELD = false as boolean` (IN-3) |
| `lib/admin/jobs/reminderRetryTime.ts` (new) | `server-only`; the one `paymentReminderService.nextSendableAt(` call |
| `lib/services/PaymentReminderService.ts` | Additive only: public `nextSendableAt(userId, desired)` delegating to the private `sendableAt` |
| `lib/admin/jobs/runQueueDrain.ts` | Comment only (OP-3) |
| `lib/repositories/AdminQueueActionsRepository.ts` | `ADMIN_QUEUE_RETRY_PATCH`, `retryQueueItemAllAccounts` (W7C-4 chain), header paragraph |
| `app/api/admin/jobs-queues/items/action/route.ts` | `case 'retry'`, `retryItem`, `explainUnmovedRetry`, per-action sentences, 422 `anchorAt` |
| `lib/admin/jobs/jobsQueuesTypes.ts`, `buildQueueItemsView.ts` | `'retry'` action, `retry_held` code, the result union |
| `lib/audit/events.ts`, `eventAudience.ts` | `BOS_QUEUE_ITEM_RETRIED` (`warning`, SOC2, `bos`) |
| `app/admin/components/jobs/RetryQueueItemDialog.tsx` (new), `QueueItemsPanel.tsx`, `JobsQueuesView.tsx`, `jobs-queues/page.tsx` | The dialog; the Re-send cell trigger; header sentences; comment |
| Docs | Access row 95 text + Change History row; the 7b §10 stale figures corrected (CR7B-1, CR7B-2) with the current re-measure |

**Not touched (M-7, verified with `git diff 1a9944a5`):** `DailyBriefingDispatchService.ts`, `app/api/business-os/leads/[id]/route.ts`, the cron routes, `lib/cron`, `vercel.json`, every migration, the lead / insight / automation services, `CancelQueueItemDialog.tsx`, `DrainNowDialog.tsx`, `ownerVisibility.ts`, `types.ts`, the authz guard. The requirement file is not edited by Dev.

### IN-3 `LEAD_RETRY_HELD` (SA fallback (b)), placement flagged for SA

- **Where:** `lib/admin/jobs/retryHolds.ts`, a constant-only module with no imports. A separate module so both states can be tested (Jest swaps it with a getter mock) without editing the eligibility module.
- **Where it is enforced (three lines):** the eligibility function (a queue rule, first, like payment automations, so the list marks every lead reply "no: paused on this queue for now" and never shows the button); the route (before any read, 422 `retry_held`, "Retrying lead replies is paused for now, until a fix to how they are sent is live. Nothing was changed."); the repository (refuses with no request). `retryWriteBound` also returns `null` for leads while held. Cancel is never held; the other three queues are unaffected.
- **Both states tested:** eligibility (H tests in `queueItemEligibility.retry.test.ts`), route (H-suite in `route.retry.test.ts`), repository (R-6), and a pin that the shipped value is `false`.
- **Flipping it is not one line** (SA C.1, CR7C-4; *amended 2026-10-04*). The procedure, also in the `retryHolds.ts` header: (1) change the one source line to `true as boolean`, keeping the pinned shape; (2) update the **10 expectations in 3 suites** that assume lead retry is offered: `buildQueueItemsView.test.ts` W7A-7(a); `queueItemEligibility.test.ts` E-1 lead ×3, E-5, E-11 lead, CR7A-1 ×2, W7A-7(a) lead; `queueItemEligibility.retry.test.ts` the "ships with the hold OFF" pin; (3) SA re-checks the delta. Held, every lead row reads "no: paused on this queue for now", including `processing` / `sent` rows that otherwise read `not_retryable_state`. The P2 gate (`leadRetry.p2Gate.test.ts`) does not apply while held, so it turns green.
- **Why a constant, not an env flag:** holding a send path is a reviewed code decision, not an operator toggle.

### IN-4 Deviations from the workplan, with reasons

| # | Deviation | Reason |
|---|---|---|
| DV-1 | New suites `route.retry.test.ts`, `AdminQueueActionsRepository.retry.test.ts`, `queueItemEligibility.retry.test.ts` instead of growing the 7b suites | Keeps the 7b suites intact. Edits to existing suites are only the counted pins: Z-1 / Z-8 (`route.test.ts`), R-10's update count 1 → 2, and **E-13's purity import list (+ `retryHolds`)**. The last one breaks E-5's "unedited" by one line; it is forced by the hold module, and a new assertion pins `retryHolds.ts` itself to no imports |
| DV-2 | The panel still computes the "until …" words (`resendWords`) and passes them to the dialog as `windowNote` | One place for the words; the dialog renders them under its trigger as §2.8 asks |
| DV-3 | Reminders: before confirming, the dialog states the rule (08:00–20:00 in the business's zone); the actual next sending time is shown after the 200 ("Not before …") | The client cannot know the business's zone; showing it earlier would need a new server read. Flagged for SA |
| DV-4 | The dialog says "or sooner if this queue is run now from this page" instead of "when Drain now is pressed" | The §2.9 guard forbids the word "Drain" in the dialog |
| DV-5 | The lost-race re-judgement lives in `explainUnmovedRetry`, outside `retryItem` | W7C-5 (one `new Date()` in `retryItem`) and OP-7 (a fresh clock on a lost CAS) both hold |
| DV-6 | `retryWriteBound` requires an explicit `retryAt` for reminders (no default to `now`) | Fail closed: a missing sending time can never silently become the looser `now − 72 h` |
| DV-7 | 422 `anchorAt` is sent for `retry_window_passed`, `briefing_not_today` and `no_due_time` only | Those are the window codes; the others have no time to show |

### IN-5 Tests

- **Red first:** before any implementation the new and amended suites gave **8 failing suites, 15 failing tests** (plus suites that could not load the missing modules).
- **New / amended suites, green:** route 240 (cancel + retry, incl. X-13b), repository 167 with the helper, wrapper and drain guard, eligibility 91, dialog render 45, items render 25, page guard 41.
- **Wide run:** `app/admin app/api/admin lib/admin lib/repositories lib/audit lib/services/__tests__ app/api/user/data-export supabase/migrations/__tests__ app/api/cron/__tests__` → **252 suites, 6,376 tests, all green** (corrected from 6,375, CR7C-7: the earlier figure predated X-13b; SA and QA both measured 6,376). Re-run after the review fixes: IN-8.
- `npm run test:authz-guard` 119 / 119; `adminGate.writes` 298; `npm run test:bos-entitlements` **181 suites / 4,625 tests** green.
- ESLint on every touched file: 0 errors; 2 warnings, both pre-existing (`events.ts` `_` at base line 1277, `PaymentReminderService.ts` unused `PaymentProcessorType`). `npm run lint:hooks`: clean.
- Scoped `tsc` (scratch tsconfig, `"include": []`, the touched files and suites, `NODE_OPTIONS=--max-old-space-size=8192`): **0 errors in touched files.** Exit code 2 from 23 errors in five untouched files (`StripeInvoiceService`, `aiAnalytics`, `InvoicePDFGenerator`, `InvoiceDeliveryService`, `booking-confirmation`), reproduced from untouched entry points on the same tree, so base noise.

### IN-6 Mutation proofs

Each mutant is a **copy** under `scratchpad\dev7c\mut\` (the worktree is never modified), wired in by a scratch Jest config's `moduleNameMapper`. Source-pin tests, which read a fixed path, run as scratch copies pointed at the mutant. Harness: `scratchpad\dev7c\mutate.js`. **Five no-op controls** (repository, eligibility, route, helper, dialog), wired the same way, all **survive**, so no kill is a harness artefact.

| # | Mutant | Result | Killed by |
|---|---|---|---|
| M01 | CAS drops `.eq('user_id', …)` | ✅ killed | R-4 (all four queues) |
| M02 | CAS drops `.eq('status', …)` | ✅ killed | R-4 |
| M03 | CAS drops `.eq('attempts', …)` | ✅ killed | R-4 |
| M04 | CAS drops `.is('sent_at', null)` | ✅ killed (on re-run) | R-4. The first run died of a suite error, which is not a kill; the re-run (`mutation-results-M04.txt`) is a genuine R-4 failure |
| M05 | CAS drops the window bound | ✅ killed | R-4 |
| M06 | `count !== 0` treated as a win | ✅ killed | R-5 (count 2, −1, 1.5) |
| M07 | CAS adds `.select()` | ✅ killed | R-4 |
| M08 | Patch resets `attempts` | ✅ killed | R-1, R-2, route S |
| M09 | Patch clears `error_message` | ✅ killed | R-1, R-2, route S |
| M10 | Patch rewrites `scheduled_at` | ✅ killed | R-3, R-4 |
| M11 | Repository drops its own payment-automations refusal | ⚪ equivalent | Still refused, with no request, by the empty `RETRY_FROM_STATUSES.payment_automations` and by `RETRY_ANCHOR_COLUMN` having no automations key. Defence in depth; the route's refusal is M19 |
| M12 | Repository ignores `LEAD_RETRY_HELD` | ✅ killed | R-6 hold case |
| M13 | Reminder bound on `now − 72 h` instead of `retryAt − 72 h` | ✅ killed | E-1, E-2, route B-5 |
| M14 | Briefing retry allowed on any day | ✅ killed | E-2, existing E-7..E-10, route BM |
| M15 | Briefing bound uses the row's own date, not today | ✅ killed | E-1, E-2 |
| M16 | "From" set allows `processing` | ✅ killed | existing E-1 matrix, route N-2 |
| M17 | Eligibility ignores `LEAD_RETRY_HELD` | ✅ killed | the held-state case |
| M18 | Payment automations made retryable | ✅ killed | existing matrix, E-3 |
| M19 | Route drops the automations rule (refused only after a read) | ✅ killed | N-1 ("nothing read") |
| M20 | Route ignores `LEAD_RETRY_HELD` | ✅ killed | H ("nothing read") |
| M21 | CAS owner from the admin, not the row | ✅ killed | S, T-1 |
| M22 | Sending-hours owner from the admin | ✅ killed | S, T-1 |
| M23 | Route passes `now` as the bound's `retryAt` | ✅ killed | B-5 |
| M24 | Minute-floored clock | ✅ killed | B-8 |
| M25 | Audit written before the CAS | ✅ killed | S, A-2, A-4 |
| M26 | Audit written on a lost race | ✅ killed | BM-5, X-3, X-12, X-13 |
| M27 | Lost-race re-check drops the same `retryAt` | ✅ killed (on re-run) | **X-13b**. M27 **survived** the first run; X-13b was added for it (OP-7: the reminder bound does not move with the clock), and the re-run (`mutation-results-M27.txt`) kills it |
| M28 | Route imports `paymentReminderService` directly | ✅ killed | T-5 |
| M29 | Helper also calls `processDueReminders` | ✅ killed | S-10 |
| M30 | Dialog body carries `nextAttemptAt` | ✅ killed | U-4 and the page guard's body pin |
| M31 | Dialog renders a server status label | ✅ killed | U-8 (`<b>x</b>`) |
| M32 | Dismiss button says "Cancel" | ✅ killed | U-2 |
| M33 | Briefing warning names "the client" | ✅ killed | U-2 |

The P1 dispatcher mutations (workplan 16, 17) belong to P1 and are not repeated.

**Reading the result files (CR7C-8).** M04 and M27 are kills **on re-run** only, as noted in their rows. The helper no-op control (`C00-control-helper`) reports "1 failed, 20 passed": it runs a scratch copy of the whole drain source guard with only the helper's path repointed at the mutant, and only S-10 (its `only` filter in `mutate.js`) is scored. S-10 stayed green, so the control **survives** as intended; the single failing test sits outside the S-10 filter, belongs to the copied suite rather than the mutant, and is not counted as a kill (SA verified the same reading).

### IN-7 The live probe

Prepared, **not run, never committed**: `scratchpad\dev7c\probe-retry-cas.ts` (session scratchpad). Four tables through the real `retryQueueItemAllAccounts`, five "matches nothing" guarantees, a count-only pre-read that exits before any update, two controls (patch column → `PGRST204`, filter column → `42703`), prints queue / outcome / code only. Clean-shell check built in (refuses to run if the Supabase env is already set); run line in its header (`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.json …`).

### IN-8 SA code review fixes (CR7C-1..CR7C-8) and QA-3, 2026-10-04

Still uncommitted on `feature/admin-queue-retry` @ `1a9944a5`. No database access; the probe was **not** run.

| Item | Done |
|---|---|
| CR7C-1 | §10 PR body rewritten: no dispatcher change (P1, #215, merged, listed under "Depends on" as done); P2 listed with its CI gate; `LEAD_RETRY_HELD`, the S-10 / W7D-5 and E-13 amendments, the probe, census 93 = 87 + 6 + 0 / 64 and row 96. §7 M-7 now expects `DailyBriefingDispatchService.ts` and the lead route **unchanged** (both added to the `git diff` paths). §8: C7-7 points at P1 (#215) plus BM-1..BM-5; carried item 4 at the P2 gate and the hold; C7-14 at the current census. §9: the lead and midnight rows point at P2 / P1; the "dispatcher change affects normal sends" row and the "keep the dispatcher guard on a partial revert" bullet are removed (not in this PR); the rollback list names the hold and the gate test. Status line updated |
| CR7C-2 | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`: row **96** `business-os/ai-activity/drill-down#GET`, doc only (gated from birth, read-only, `actionId` the only input, no audit row). Headline, "What is true", heading (92) → **(93)**, summary line (87 `requireAdmin`, rows 91–96, 96 rows / 93 live) and a 92 → 93 note under As-Built State. 7c's Change History row reworded. **Census re-measured with the guard's own `scanHandlers` / `stripComments`** (`scratchpad\dev7c\census.ts`, plus a copy that classifies each non-`requireAdmin` handler): **64 files, 93 handlers, 87 `requireAdmin`, 6 inline (all name the access service), 0 open.** Note: the gate call is at `drill-down/route.ts:61` (line 60 is its comment); the row cites `:61` |
| CR7C-3 | New `lib/admin/jobs/__tests__/leadRetry.p2Gate.test.ts` (QA's scratch guard as model). Reads `retryHolds.ts` and the lead route with `fs`, comments stripped; never imports either. Rule: hold `false` ⇒ the route exports `maxDuration = 60` and **every** `dispatchLeadResponses(` call is awaited (at least one). The hold's value is parsed from the pinned one-line shape and fails closed on any other shape, so a comment saying "`= true`" cannot clear it. Six matcher self-checks (green) plus the gate (**red now, by design**: "does not export maxDuration = 60" and "1 un-awaited call"). Header explains how it clears: P2 merged and rebased, or the hold flipped per CR7C-4. The lead route is **not** changed. The gate config (`jest.gate.config.js`) collects it. Mutation proofs on scratch copies (`scratchpad\dev7c\p2gate\`): hold `true` with today's route → green; hold `false` with a P2-shaped route copy → green; hold `false` with `maxDuration = 60` but the drain still fire-and-forget → red. The synthetic import lines use `./dispatch`, because the W7D-5 S-2 scanner counts any file naming the lead service's path as an importer |
| CR7C-4 | `retryHolds.ts` header and IN-3: the measured flip procedure (one line, the 10 expectations in 3 suites, SA re-check), the list words it produces, and that the P2 gate goes green while held. The source line is unchanged (`false as boolean`) |
| CR7C-5 | Route header, comment only: the route itself never logs an account id; on a reminder retry the sending-hours lookup writes the reminder service's existing line with the business's id and zone, as every scheduled reminder does |
| CR7C-6 | Probe header (`scratchpad\dev7c\probe-retry-cas.ts`, scratch, never committed): 7b's paragraph on the repository's Pino lines (random item id, `probe-7c`); the env parser now accepts an `export ` prefix, and the header says any unreadable line fails safely ("missing from .env.local", before any import or request). Syntax-checked by transpiling only. **Not run** |
| CR7C-7 | IN-5 and the "Implemented" Change History row now say 6,376 |
| CR7C-8 | IN-6: M04 and M27 marked as kills on re-run (M27 survived the first run, hence X-13b); the helper control's single failure explained as outside its S-10 filter |
| QA-3 | `RetryQueueItemDialog.tsx`: the "sooner if this queue is run now from this page" sentence is now per queue. Reminders: "the queue sends it on a run at or after its next sending-hours time. Running this queue now from this page sends it sooner only if that time has already come." The other three keep the original sentence (their retried items are due at once: `next_attempt_at` is null). Two new render tests (U-2, QA-3) pin both forms; the page guard (no "Drain" in the dialog) stays green |
| Optional (`ANCHORED_RETRY_CODES` / `no_due_time`) | **Not done.** Removing it changes the 422 body (`anchorAt: null` disappears), which N-6 pins and DV-7 documents; it is a wire change for no behaviour gain, so it is left for SA to decide |

**Re-run after the fixes:**
- Slice suites + jobs-page guards and render tests (`app/api/admin/jobs-queues`, `lib/admin/jobs`, both `AdminQueueActionsRepository` suites, `PaymentReminderService.nextSendableAt`, `app/admin/__tests__/jobsQueues*`, `eventAudience`): **27 suites, 974 tests; 1 failed = the P2 gate only.**
- Wide set (as IN-5): **253 suites, 6,387 tests; 1 failed = the P2 gate only** (6,376 + 7 gate tests + 4 new render tests).
- `adminGate.writes` 298 green (59 cases); `npm run test:authz-guard` 119 / 119; `npm run test:bos-entitlements` 181 suites / 4,625 green.
- The P2 gate fails for the intended reason only: `["lead route does not export maxDuration = 60", "lead route has 1 un-awaited dispatchLeadResponses( call(s)"]`.
- ESLint on the five files touched here: 0 errors, 0 warnings. `console.*`: 0.

## QA Testing Report

### QA Report (2026-10-04)

**Test mode:** full · **Strategy:** A (unit: eligibility, wrapper, helper), B (route and repository over a mutable-store CAS model, mocked Supabase), D (prepared browser checklist only; QA cannot sign in) · **Focus:** api, ui, security, schema · **Skipped:** live probe (user runs it; QA read it only), browser check (user) · **Input source:** TL prompt + workplan §5, §7, §8.
**Tree:** `feature/admin-queue-retry` @ `1a9944a5`, uncommitted. No database access. Nothing in the worktree was written except this section and its Change History row. QA tests live in `scratchpad\qa7c\` only.

**Verdict: PASS WITH NOTES.** No bug found in the 7c code. Merge stays blocked until P2 merges (or `LEAD_RETRY_HELD` is set `true`) and the user has run the §6 probe. Nothing in the repo enforces the P2 order today (QA-1).

#### Test runs (re-run by QA)

| Run | Result |
|---|---|
| New suites: `route.retry` 124, `AdminQueueActionsRepository.retry` 35, `queueItemEligibility.retry` 18, `reminderRetryTime` 2, `PaymentReminderService.nextSendableAt` 13, `jobsQueues.retry.render` 45 | **6 suites, 237 tests, green** |
| Amended suites: `jobsQueues.items.render`, `jobsQueues.source.guard`, `drain.source.guard`, `route.test`, `queueItemEligibility.test`, `eventAudience`, `AdminQueueActionsRepository.test` | **7 suites, 353 tests, green** |
| `adminGate.writes` | **298 tests green**; `CASES` still `toHaveLength(59)` (`:420`) |
| `npm run test:authz-guard` | **119 / 119** |
| `npm run test:bos-entitlements` | **181 suites, 4,625 tests, green** |
| Wide set (`app/admin app/api/admin lib/admin lib/repositories lib/audit lib/services/__tests__ app/api/user/data-export supabase/migrations/__tests__ app/api/cron/__tests__`) | **252 suites, 6,376 tests, green** (Dev recorded 6,375; one more test, likely added in parallel; no failure, no flake to re-run) |
| ESLint on the 15 touched source files | 0 errors; 2 warnings, both pre-existing (`events.ts` `_`, `PaymentReminderService.ts` `PaymentProcessorType`) |
| `console.*` in the 15 touched source files | 0 |
| QA scratch suite `qa7c.route.edges.test.ts` (route suite's harness + 18 QA cases) | **18 / 18 green** |
| QA scratch guard `qa7c.p2Gate.test.ts` | **RED, as expected** (QA-1) |
| Untouched files (M-7): `DailyBriefingDispatchService.ts`, `leads/[id]/route.ts`, cron routes, `lib/cron`, `vercel.json`, migrations, lead/insight/automation services, `CancelQueueItemDialog.tsx` | `git diff 1a9944a5 --stat` empty. No deletion-only file in `git diff --numstat` |

#### Acceptance criteria (§8) → evidence

| Criterion | Tested? | Result | Evidence |
|---|---|---|---|
| FR-Q1 retry per §C; every refused cell refused (C7-1) | ✅ | Pass | route S (5 cells), N-1 (automations × 7 statuses), N-2 (4 queues × 8 statuses), N-3..N-7 |
| FR-Q6 / OQ-3 / C7-9: 72 h on the server, route and CAS | ✅ | Pass | B-1..B-5b, E-1, E-2 equivalence; QA-W: exactly 72 h allowed / +1 ms refused on **both** lead and insight; reminder `retryAt` = due + 72 h allowed / +1 ms refused |
| C7-2: never leased, in progress or finished | ✅ | Pass | N-3 (processing, claim set or null), N-5 (stored sent/skipped → 409), CAS `eq status 'failed'` (R-4) |
| C7-3: one CAS, count exact, `count === 1` only, no `.select()`/`.or()` | ✅ | Pass (unit) / ⬜ live | R-4, R-5 (null/2/−1/1.5), R-8; live shape = §6 probe, **owed by the user** |
| C7-4: no attempts reset; error text, skip reason, payload kept | ✅ | Pass | S cells, R-1/R-2, QA-E (attempts 4 kept; `error_message` and `skip_reason` byte-identical on all four queues) |
| C7-5: never payment automations | ✅ | Pass | N-1 (nothing read), R-6, U-1, QA-H (held or not) |
| C7-7 + B7-4: same business day only | ✅ | Pass | BM-1..BM-5 (LA, Kolkata, Chatham at local midnight ± 1 ms), BM-4 (null / bad zone → UTC); P1's dispatcher guard confirmed on base (`DailyBriefingDispatchService.ts:91`) |
| C7-8: sending hours via the public wrapper | ✅ | Pass | S-1..S-3, H-1, B-4/B-5, S-10 pin; the reminder claim honours `next_attempt_at` (`2026-08-14_payment_reminders_claim.sql:58-60`), so a future sending time really defers the send |
| Carried 1 + 2: real clock; reminder bound on `retryAt − 72 h` | ✅ | Pass | B-8 (one `new Date()`), B-5, E-1, M13/M23/M24 |
| Carried 4 (BL-7a) | ⚠️ | Partial | `LEAD_RETRY_HELD` both states tested (H, E-held, R-6, QA-H). **P2 not built and not enforced** (QA-1) |
| Carried 5: AI and credits | ✅ | Pass | T-5 and R-8 source pins (no LLM, credit, service, payment-event import); dialog AI sentence on briefing only (U-2) |
| FR-Q3: reason + one flushed audit row | ✅ | Pass | A-1..A-6; QA-R (the audit holds the **trimmed** reason) |
| FR-Q4 / §9 double send | ✅ | Pass | X-3, X-5 (double-click), X-6 (two admins), X-7 (one claim), X-8 (retry vs cancel), X-12 (`sent_at` fence on all four) |
| FR-Q5: no content | ✅ | Pass | P suite (200/409/404/422 × 4 queues), U-9, U-10 |
| FR-Q7: refresh | ✅ | Pass | U-6 (`onChanged` once on Close, page and list reload) |
| C7-12 data access | ✅ | Pass | R-8, T-5; route touches no table (`supabaseServer` mock throws) |
| C7-13 privacy and dialog copy | ✅ | Pass | U-2 (warning names "the client" / "the business owner"), U-9/U-10 |
| C7-14: same route, writes 59, no CAPS move | ✅ | Pass | adminGate.writes 59, authz-guard 119/119 |
| C7-15 Pino, error format | ✅ | Pass | 0 `console.*`; `details` dev-only in `respondRefused` |
| C7-16: happy path per cell, CAS loss, foreign id, strict schema, audit shape and order | ✅ | Pass | S, X-3, T-3, Z-2, A-1, A-2 |
| UC-9: owners never see | ✅ | Pass (unit) | A-5: `bos_queue_item` in `OWNER_HIDDEN_ENTITY_TYPES`; `ownerVisibility`, owner-policy migration and data-export suites green in the wide run |
| CLAUDE.md Testing: happy + auth + invalid; a test per new repo method | ✅ | Pass | G-1..G-4, Z-2/Z-3, S; `retryQueueItemAllAccounts` R-1..R-8 |

#### Edge probes (the TL list)

| Probe | Result | Where |
|---|---|---|
| Every retryable cell / every refused cell | Pass | S, N-1, N-2 |
| Exactly 72 h vs 72 h + 1 ms | Pass | B-1/B-2 (lead), **QA-W** (insight; reminder by `retryAt`) |
| Reminder whose next sending time is beyond 72 h | Pass | B-4, QA-W |
| Briefing across midnight in its own zone | Pass | BM-1..BM-5 |
| Payment automations never | Pass | N-1, R-6, QA-H |
| `failed` with `sent_at` set refused | Pass | X-12 (all four queues), M04 |
| Leased row; finished row | Pass | N-3, N-5 |
| Stale status / attempts → 409 | Pass | X-1, X-2 |
| CAS loss incl. a claim between read and write | Pass | X-3, X-4, X-13, X-13b |
| Double-click; two admins | Pass | X-5, X-6, U-5 (same tick) |
| `userId` / `accountId` in body → 400 | Pass | Z-2 (also `ownerUserId`, time fields, nested keys) |
| Reason: 2, whitespace only, 3, 500, 501 | Pass | Z-3 (2, 501) + **QA-R** (empty, whitespace only, padded 2, 3, padded 3, 500, 500 after trim) |
| `retry` on cancel-only states | Pass | N-2 (`pending`, `processing`, …) → 422 `not_retryable_state`, nothing read |
| `LEAD_RETRY_HELD` true and false, both ways | Pass | H, eligibility held tests, R-6, **QA-H** (flip true → false on the same request) |
| `attempts` never reset; `error_message` never cleared | Pass | R-2, S, **QA-E** |
| No payment event, no AI call | Pass | T-5, R-8, S-2 (wrapper writes/emits nothing) |
| Audit contents; owner cannot see | Pass | A-1, A-5 |
| Sentinel: nothing leaks | Pass | P suite, U-9/U-10 |
| Dialog: warning, per-queue next step, Confirm gated on reason, "Not before …" | Pass | U-2, U-3, U-6, U-7 |

#### Issues found

**Bugs (must fix before commit):** none.

**Process / merge gate (must hold before merge):**
1. **QA-1: nothing enforces "7c merges after P2".** — Severity: **Medium (process)** — `lib/admin/jobs/retryHolds.ts:26` ships `LEAD_RETRY_HELD = false`, and a test pins it `false`; `app/api/business-os/leads/[id]/route.ts:80` still drains fire-and-forget with no `maxDuration`. If this PR merged now, lead-reply retry would be live with the BL-7a double-send hazard. The ordering rests on people only. Options: (a) Dev adds the QA scratch guard (`LEAD_RETRY_HELD === false` ⇒ the lead route exports `maxDuration = 60` and awaits `dispatchLeadResponses`), which is red today and turns green when P2 lands; or (b) RM/TL hold the merge by checklist. SA L-6 (P2's lease-invariant guard) covers the same ground once P2 exists.

**Edge cases (nice to fix / record):**
1. **QA-2: the CAS window bound is an app-clock constant.** The bound is computed from the route's `now` (`queueItemEligibility.ts`, `retryWriteBound`), not the database clock, and anchors never change after insert. So the in-write re-check proves "same anchor", and BM-5 / X-13 model a race that real Postgres cannot produce (the bound does not move). Harmless: a briefing CAS landing just after local midnight leaves a `pending` row for D, which P1's dispatcher guard closes `stale_date` unsent. Record only.
2. **QA-3: dialog copy for an out-of-hours reminder.** `RetryQueueItemDialog.tsx` says "or sooner if this queue is run now from this page" (DV-4). For a reminder retried outside 08:00–20:00, `next_attempt_at` is in the future, so running the queue now does **not** send it sooner. The reminders paragraph right after it states the sending-hours rule, so the risk of confusion is low. Low.
3. **QA-4: the probe's "prints queue, outcome and code only" is not strictly true.** The repository's Pino lines also print, carrying the probe's random `itemId` and `correlationId: 'probe-7c'`. No real id or key is printed. Low; reword the probe header, or expect the extra lines.

**Performance:** none. The route adds one helper call (reminders only) under the existing 5 s deadline.

#### The §6 live probe (read, NOT run)

`scratchpad\dev7c\probe-retry-cas.ts`. **Verdict: it cannot change a real row.**
- The four main calls go through the real `retryQueueItemAllAccounts`, each with a fresh random `id` (confirmed absent first by a count-only `head` read; any count ≠ 0 or any error exits before the update), a fresh random `user_id`, `attempts = 99999`, `status = 'failed'` and `sent_at IS NULL`. All five predicates must match a row, and the first two alone cannot.
- Both controls also filter a fresh random `id`, a random `user_id` and `attempts = 99999`, so they match nothing even if PostgREST accepted them. They are not pre-read, which is acceptable for that reason.
- No `.select()`, no RPC, no route (so no audit row), no insert or delete. It refuses to run if the Supabase env is already set in the shell, and if `LEAD_RETRY_HELD` is on.
- Import chain checked: `supabaseServer`, the repository, eligibility and `retryHolds` import no `server-only`, so `tsx` can load them.
- Its output goes into this report once the user runs it (M-8). **Still owed.**

#### Browser checklist (for the user; QA cannot sign in)

**Never confirm a retry on a real client's item.** Never press "Retry item" inside the dialog on live data. Press **Close**.
1. Open `/admin/jobs-queues` as a platform admin. The header sentence names Drain now, cancel and retry, and ends "everything else here is read-only".
2. On each of the five queues, press **View items**, then open the **Failed** and **Dead-lettered** tabs. A "Retry item" button appears only on rows whose Re-send cell would otherwise say "until …". Live data had no failed rows (SA 7a §A), so expect none, and record "not exercisable on live data".
3. On **Payment automations**, check every tab: there is no "Retry item" button anywhere.
4. Only if a retryable row exists: press **Retry item** to open the dialog. **Do not confirm.** Check:
   - the title "Retry this item?";
   - the description shows the business name, an 8-character id, the status and "N attempts so far";
   - the amber warning names "the client" ("the business owner" on the briefing);
   - the per-queue "what happens next" sentence; the AI-cost sentence appears on the briefing only;
   - "The business is not told";
   - **Retry item** stays disabled with an empty reason, with "ab" and with spaces only, and enables at 3 characters;
   - the dismiss button reads **Close**, never "Cancel".

   Then press **Close**. In DevTools → Network, no request is sent on open or close.
5. Signed out, and as a non-admin: the 7b M-6 `curl` with `"action":"retry"` returns 401 / 403.
6. Skip M-5 (a confirmed retry) unless you name, in writing, a failed item from your own test business.

**Pre-merge items the user owes, in order:**
1. **P2 (BL-7a(2), `fix/lead-route-awaited-drain`) merged first**, or SA's fallback (b) ruled and `LEAD_RETRY_HELD` set to `true` in this PR.
2. **Run the §6 zero-row probe once**, from a clean PowerShell window, after SA's code review:
   ```powershell
   cd "C:/Users/Barak/My Projects/AgentsPilot/neuronforge-admin-queues"
   ./node_modules/.bin/tsx.cmd --tsconfig tsconfig.json "C:/Users/Barak/AppData/Local/Temp/claude/C--Users-Barak-My-Projects-AgentsPilot-neuronforge/13333d69-85f2-4f8a-8578-946d6a876a59/scratchpad/dev7c/probe-retry-cas.ts"
   ```
   Expect 4 × `not_matched`, the controls `PGRST204` / `42703`, and `PROBE PASS`, with Pino log lines in between (QA-4). Any other result stops the merge (W7C-14). Paste the output here.
3. Steps 1–5 of the browser checklist above.

#### Final status
- [ ] All acceptance criteria pass — ready for commit
- [x] Code: no bug found, so no Dev fix is required. **Not ready to merge** until P2 has merged (QA-1), the probe has passed, and the browser checklist is recorded

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | Created | Dev workplan for slice 7c only (retry one queue item), on `feature/admin-queue-retry` @ `50a30939` (7d, 7a, 7b merged; `20261035` applied). Findings: F-1, a same-day briefing retry can be sent after midnight under a stale date (carried item 3; dispatcher guard proposed, OP-1); F-2, retry worsens BL-7a on lead replies only (carried item 4; BL-7a(2) first recommended, OP-2); F-3, C7-8's wrapper conflicts with the W7D-5 guard (helper plus a narrow amendment, OP-3); F-4, the `sent_at` fence (OP-6). No migration, no new route. Twenty open points for SA |
| 2026-10-04 | SA workplan review | **APPROVED WITH CONDITIONS (W7C-1..W7C-16)** on `50a30939`. OP-1: the finding is verified and is a live production defect (a cron outage across midnight double-sends). The dispatcher guard is approved but moves to its **own PR, P1, first** (warn log, inside the per-row try, `row.timezone`; the `skip_reason` CHECK is confirmed absent). OP-2: option (a). BL-7a(2) is its **own PR, P2**, before 7c merges (`maxDuration = 60`, awaited drain, an optional small batch, plus a repo-wide lease-invariant guard), pending Q-SA7C-1. OP-3..OP-20 ruled (OP-7 clarified; OP-9 goes to the user as Q-SA7C-2; OP-17 binding). The live read-only check confirms every retry patch and filter column on all four tables, with a `42703` negative control. Corrections: no owner surface reads `daily_briefing_sends`; nothing tests `processDueBriefings` directly; the lead route is `PATCH`. Backlog BL-7d (the cached UTC fallback zone) and BL-7e (a delivered reminder overwritten to `failed` when the emit throws) |
| 2026-10-04 | Implemented (Dev) | Code complete on `1a9944a5`, uncommitted, under W7C-1..W7C-16. P1 merged (PR #215) and not in this diff; P2 not built (7c merges after it). `LEAD_RETRY_HELD` (SA fallback (b)) in `lib/admin/jobs/retryHolds.ts`, default off, enforced in eligibility, route and repository, both states tested (placement flagged). Re-measured: writes 59, census 93 = 87 + 6 + 0 / 64 (an unregistered PR #214 handler flagged), catalogue 179 / `bos` 34, no migration. Wide run 252 suites / 6,376 tests green (corrected from 6,375, CR7C-7); mutations 32 killed, 1 equivalent, 5 controls survive. 7b §10 stale figures corrected. Probe prepared, not run. See Implementation Notes |
| 2026-10-04 | QA (PASS WITH NOTES) | Re-ran: new suites 237, amended 353, adminGate.writes 298 (59 cases), authz-guard 119/119, bos-entitlements 181/4,625, wide 252 suites / 6,376 tests, all green; 18 QA scratch edge tests green. No bug. QA-1 (Medium, process): nothing enforces the P2-first merge order; a scratch guard is red today. Edge notes QA-2..QA-4. The probe was read and cannot change a row; the user still owes the run. Browser checklist written |
| 2026-10-04 | SA code review | **Code APPROVED WITH CHANGES** on `1a9944a5` (uncommitted). No code change is required. Re-verified: wide run 252 / **6,376** (not 6,375), bos-entitlements 4,625, authz 119, census 93 = 87 + 6 + 0 / 64, scoped tsc 0 errors in touched files, mutations (M04 and M27 by re-run; M11 equivalent), and untouched files against the base. The retry CAS, the bound, the single real clock, the helper / S-10, the audit, the dialog and the narrow guards all conform. Rulings: `LEAD_RETRY_HELD` placement approved; shipping it `false` requires P2 first; a flip is safe but is one line **plus 10 expectations in 3 suites** (measured with a scratch mapping); DV-3, DV-1, DV-6 accepted; drill-down registered here doc-only; M11 equivalent. The probe is approved to run: every write filters on a fresh random id. Before RM: CR7C-1 (stale §10 / §7 / §8 / §9), CR7C-2 (register row 96, census 93 / 64), CR7C-3 (a P2 interlock pin, red until P2), CR7C-4 (flip procedure), CR7C-5 (route header log claim). CR7C-6..8 Low |
| 2026-10-04 | SA review fixes (Dev) | CR7C-1..CR7C-8 and QA-3 applied, uncommitted (IN-8). §10 PR body, §7 M-7, §8 and §9 no longer claim a dispatcher change (P1, #215); access register row 96 (`ai-activity/drill-down#GET`, doc only), census re-measured with the guard's scanner: 93 = 87 + 6 + 0 / 64. New `leadRetry.p2Gate.test.ts`, **red by design** until P2 merges (or the hold is flipped per the `retryHolds.ts` header). Dialog's "sooner if run now" sentence made per queue (reminders differ). Route header log claim corrected; probe header and env parser amended (not run). Re-run: wide 253 / 6,387 with the P2 gate the only red; adminGate.writes 298, authz 119, bos-entitlements 4,625 green. `ANCHORED_RETRY_CODES` left as is (wire change) |
