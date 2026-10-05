# Workplan: Admin BOS Cleanup, Slice 7d ("Drain now" on Scheduled jobs & queues)

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md): §4.2 FR-Q2, FR-Q3, FR-Q7; the slice 7 lines of §9 that apply to Drain now; TA-9; and **"SA Review — slice 7 (2026-10-04)"** in full. The binding parts for 7d are §C (last column), §D.4–D.5, §F (last bullet), §G (`BOS_QUEUE_DRAINED`), §I, and conditions **C7-10, C7-11, C7-13, C7-14, C7-15, C7-16** (the Drain now items).
**Branch:** `feature/admin-queue-actions` @ `5b26c361` (`origin/main` after PR #191 and PR #192; drafted on `5f10a926`, re-based per W7D-12). Worktree `neuronforge-admin-queues`. Created by RM. The requirement already carries uncommitted edits (SA's slice 7 review, the user's decisions, and SA's 7d amendments). This workplan does not touch them.
**Process:** Dev workplan → SA workplan review → Dev implement → SA code review → QA → the user sees the uncommitted diff → user approval → RM. Dev commits nothing.
**Date:** 2026-10-04
**Status:** Code Complete (SA approved the workplan with conditions W7D-1..W7D-12; they govern where they differ from §2–§6, see [section 13](#13-sa-conditions-folded-in-w7d-1w7d-12))
**Effort:** S, about 1 to 1.5 days of Dev time. Breakdown in [section 11](#11-effort-estimate).

## Overview

The Scheduled jobs & queues page is read-only today. If a queue cron is down, or `CRON_SECRET` is missing, the only way to move a queue is SQL. Slice 7d adds one **"Drain now"** button per queue. The button opens a confirm dialog that requires a written reason. On confirm it calls a new admin route, `POST /api/admin/jobs-queues/drain`. The route runs **the same drain function the cron runs for that queue**, in-process and awaited, under `maxDuration = 60`. Before running the drain it writes one write-ahead `BOS_QUEUE_DRAIN_STARTED` audit row (reason, queue, correlationId) through `logAndFlush`; afterwards it returns the drain's numeric counts. The page shows the counts and refreshes.

What it never does: bill plan stages, scan for overdue invoices, mark invoices overdue, retry Stripe charges, call a cron URL, read `CRON_SECRET`, or write a `bos_cron_runs` row. It does not retry, release or cancel any single item; those are 7a–7c, which follow later as separate PRs (user decision, 2026-10-04).

There is no migration, no new repository and no change to any cron route or drain function.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify](#3-files-to-create--modify)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. Timeout Behaviour (a drain that runs past 60 s)](#6-timeout-behaviour-a-drain-that-runs-past-60-s)
- [7. Manual QA Check](#7-manual-qa-check)
- [8. Acceptance Criteria Traceability](#8-acceptance-criteria-traceability)
- [9. Risks and Rollback](#9-risks-and-rollback)
- [10. PR Body Draft](#10-pr-body-draft)
- [11. Effort Estimate](#11-effort-estimate)
- [12. Open Points for SA](#12-open-points-for-sa)
- [13. SA Conditions Folded In (W7D-1..W7D-12)](#13-sa-conditions-folded-in-w7d-1w7d-12)

---

## 1. Analysis Summary

### 1.1 The five entry points, as built (read on `5f10a926`)

| Queue id (`BosQueueId`) | Entry point (C7-10) | Module | Returns | The cron route also runs (Drain now never calls these) |
|---|---|---|---|---|
| `payment_reminders` | `paymentReminderService.processDueReminders()` | `lib/services/PaymentReminderService.ts:945` (singleton `:1719`) | `{ processed, sent, failed }`. Rethrows on a claim error | `billDueDatedStages()`, `processOverdueItems()`, `paymentInvoiceRepository.markAllOverdueInvoices()` (`app/api/cron/payment-reminders/route.ts:115-139`) |
| `payment_automations` | `paymentAutomationEngine.processScheduledExecutions()` | `lib/services/PaymentAutomationEngine.ts:289` (singleton `:382`) | **`void`**. Logs and returns on a claim error | `paymentRetryService.processDueRetries()` (Stripe charges, `payment-retry/route.ts:70`; `processScheduledExecutions` is at `:73`) |
| `daily_briefing_sends` | `processDueBriefings()` | `lib/services/DailyBriefingDispatchService.ts:55` | `{ enqueued, sent, skipped, failed }` | nothing else |
| `lead_responses` | `dispatchLeadResponses()` | `lib/services/LeadResponseDispatchService.ts:77` | `{ reaped, enqueued, claimed, sent, skipped }` | nothing else |
| `insight_actions` | `drainInsightActions()` | `lib/services/InsightActionDispatchService.ts:92` | `{ reaped, claimed, sent, skipped, failed }` | nothing else |

Each one is **reap → (enqueue) → claim → dispatch → close**. The claim is a `FOR UPDATE SKIP LOCKED` RPC on `status = 'pending'`, and the reaper uses a 90 s lease against the cron routes' `maxDuration = 60` (SA B7-1). So calling the function from a second runtime behaves exactly like a second, overlapping cron run. Vercel already produces those, so the safety argument is the existing one (SA §D.4).

Two of the five also **enqueue** before claiming:
- The briefing queues every opted-in business that is inside its local 07:00–10:59 window (`localHour` 7 to 10 inclusive). `UNIQUE(user_id, briefing_date)` makes a second enqueue a no-op.
- Lead replies queue owner-approved chases through an upsert with `ignoreDuplicates`.

Both are idempotent (SA §C), so Drain now may run them. The dialog says so.

### 1.2 Where the drain may call an AI model (bos-llm-call-standards)

I traced each drain's dispatch path through its direct imports:

| Queue | AI call in the drain? | Attribution and charge when an admin presses Drain now |
|---|---|---|
| Payment reminders | **No.** The dispatch builds the email from `generateChaseInvoiceEmail` and sends it through `emailTransport`. | n/a |
| Payment automations | **No.** `callBlockExecutor` is a placeholder (SA B7-3). | n/a |
| Morning briefing | **Yes.** `dispatchOne` → `getBriefing(userId, facts, language, 'scheduled', …)` → `runAiAction({ area: 'briefing', actionType: 'briefing_narration', trigger: 'scheduled', accountId: userId })` → `narrateBriefing`. `briefing_narration` is `isCharged: true`, and its diary label is "Wrote your daily briefing". | It is attributed to **the business owner's account**, with trigger `'scheduled'`, and charged to **the owner's credits**. This is exactly what the cron would do. The narration is cached per business-local day by a hash of the facts (`BriefingStore.ts`). So Drain now normally moves the one daily narration earlier rather than adding one. It re-narrates only if the facts changed since an earlier narration that day, which the cron would also do. The admin is never charged. The admin's identity does not reach the AI call. |
| Lead replies | **No.** `LeadResponseDispatchService`, `LeadBookingLinkService`, `InvoiceDeliveryService`, `BookingEmailService` and `lib/business-os/gaps/*` contain no `runAiAction` or provider factory call. | n/a |
| Insight actions | **No.** The drain sends fixed templates (`lib/email/templates/insight-actions`). The AI work happened earlier, at detection (`insight-detect` cron), not in this drain. | n/a |

So the only billable AI call that Drain now can trigger is the briefing narration. It goes under the owner's attribution and the `'scheduled'` trigger. This is raised as **OP-1** in [section 12](#12-open-points-for-sa); the default is to leave it unchanged. QA re-runs the transitive grep at code review time (task T12), because a grep of direct imports is evidence, not proof.

### 1.3 The page and its guard

- `app/admin/jobs-queues/page.tsx` renders `JobsQueuesView`. It is a client component.
- `JobsQueuesView.tsx` renders one `QueueCard` per queue from `GET /api/admin/jobs-queues`. `QueueView.id` is the `BosQueueId`.
- The page header says "Read-only."
- **`app/admin/__tests__/jobsQueues.source.guard.test.ts` deliberately forbids** the word `Drain`, any `method: 'POST'`, the words Retry/Requeue/Cancel and "OK" in both client files (SA SC-7 of the reorganisation slice 5).
- **`jobsQueues.render.test.tsx:96`** asserts that the only button is Refresh.

7d must amend both deliberately. This is not a silent loosening: see T8, T9 and OP-3.

### 1.4 Admin surface (C7-14)

`app/api/admin/**/route.ts` currently has 58 files and 87 handlers, 81 of which use `requireAdmin` and 6 are inline (register rows to 90). `adminGate.writes.test.ts` pins `CASES` at **57**. 7d adds one file, one handler and one case. This gives **59 files, 88 handlers = 82 + 6 + 0, register row 91**, and `adminGate.writes` goes **57 → 58**. (SA's §M said 58 → 59 assuming 7b would ship first. 7d now ships first, so 7b becomes 58 → 59 later.) No `CAPS` value moves. No exemption is added.

### 1.5 Logging compliance (C7-15)

Counted on `5f10a926`: `console.*` = 0 in `JobsQueuesView.tsx`, `page.tsx`, `jobsQueuesTypes.ts`, `lib/audit/events.ts`, `eventAudience.ts`, `types.ts`, `filterOptions.ts` and `adminGate.writes.test.ts`. T1 re-counts these before editing, so nothing is assumed. The new files use Pino only. The five service files are **not modified**.

---

## 2. Implementation Approach

### 2.1 Server module: `lib/admin/jobs/runQueueDrain.ts` (new, server-only)

This module holds the queue → entry-point map in one place, so the source guard has one file to pin.

```typescript
import 'server-only';
import { paymentReminderService } from '@/lib/services/PaymentReminderService';
import { paymentAutomationEngine } from '@/lib/services/PaymentAutomationEngine';
import { processDueBriefings } from '@/lib/services/DailyBriefingDispatchService';
import { dispatchLeadResponses } from '@/lib/services/LeadResponseDispatchService';
import { drainInsightActions } from '@/lib/services/InsightActionDispatchService';
import type { BosQueueId } from '@/lib/cron/bosCronJobs';
import type { DrainCount } from '@/lib/admin/jobs/jobsQueuesTypes';

/** Exhaustive over BosQueueId: TypeScript refuses a missing or extra queue. */
const DRAINS: Record<BosQueueId, () => Promise<unknown>> = {
  payment_reminders: () => paymentReminderService.processDueReminders(),
  payment_automations: () => paymentAutomationEngine.processScheduledExecutions(),
  daily_briefing_sends: () => processDueBriefings(),
  lead_responses: () => dispatchLeadResponses(),
  insight_actions: () => drainInsightActions(),
};

export async function runQueueDrain(queue: BosQueueId): Promise<DrainCount[]>;
```

- It awaits the function and passes the raw result to `pickDrainCounts(queue, raw)`.
- **Counts only (C7-13).** `pickDrainCounts` lives in the pure module in §2.2. It uses a **fixed per-queue key allow-list** with fixed labels, and keeps only finite numbers (the `bosCronJobs` counts rule). Anything else in the result is dropped, including any string that a future version of a drain might add. `payment_automations` returns `void`, so it yields `[]`, and the UI says "This queue's drain reports no counts" (OP-2).
- No `.from(...)`, no RPC, no logger content beyond the queue id and the counts, no `cronRunRecorder` import.
- **Why `server-only`.** The jobs C-21 guard keeps client files off `lib/admin/jobs` at runtime. The `server-only` import makes a mistaken client import a build error, not a bundle leak.

### 2.2 Pure module: `lib/admin/jobs/drainCounts.ts` (new, no imports)

- `DRAIN_COUNT_KEYS: Record<BosQueueId, ReadonlyArray<{ key: string; label: string }>>`:
  - `payment_reminders`: processed "picked up", sent "sent", failed "failed".
  - `payment_automations`: `[]`.
  - `daily_briefing_sends`: enqueued "queued", sent "sent", skipped "skipped (a quiet day or nothing to say)", failed "failed".
  - `lead_responses`: reaped "recovered from a dead run", enqueued "queued", claimed "picked up", sent "sent", skipped "skipped".
  - `insight_actions`: reaped, claimed, sent, skipped, failed (same labels).
- The labels follow the wording already used in `BOS_CRON_JOBS` for the same keys.
- `pickDrainCounts(queue, raw: unknown): DrainCount[]` returns `{ key, label, value }` entries for finite numbers only, in allow-list order. A missing or non-numeric key is dropped, never shown as 0.
- `DrainCount` is added to `lib/admin/jobs/jobsQueuesTypes.ts` as a type, so the client can `import type` it (C-21).

### 2.3 Route: `app/api/admin/jobs-queues/drain/route.ts` (new)

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Must stay BELOW the 90 s reaper lease of every drained queue (SA §D.4, B7-1),
// so a run the platform kills is provably dead before anyone re-claims its rows.
export const maxDuration = 60;

const DrainBodySchema = z.object({
  queue: z.enum(BOS_QUEUE_IDS),                 // derived from BOS_QUEUES (pure data)
  reason: z.string().trim().min(3).max(500),
}).strict();                                     // no accountId / userId / anything else (SA §F)

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement (C7-14). Nothing above it reads the body or touches a queue.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;
  ...
}
```

Flow after the gate:
1. **Parse** the JSON with `.catch(() => undefined)`, then `safeParse`. On failure the route returns **400** `{ success: false, error: 'Choose a queue and give a reason of at least 3 characters', code: 'invalid_input', details: dev-only issue }`. This covers an unknown queue, a short or long reason, an extra key and a non-JSON body. Nothing runs.
2. Log at `info` `{ adminUserId, queue }` with the message "Drain now starting". Neither the reason nor any content is logged.
3. `const started = Date.now()`, then **`await runQueueDrain(queue)`** inside try/catch. There is no `Promise.race`, no timer and no fire-and-forget (§D.4, B7-11).
4. **Audit, always, before responding**, on success *and* on a thrown drain. A drain that threw may already have sent some items, so the admin's action must be on record either way:
   ```typescript
   await logAndFlush({
     action: AUDIT_EVENTS.BOS_QUEUE_DRAINED,
     entityType: 'bos_queue',
     entityId: queue,
     userId: adminId,            // the admin: the drain touches no single account (§G)
     actorId: adminId,
     severity: 'warning',        // written explicitly: writer severity beats registration
     details: { reason, queue, correlationId, outcome: 'completed' | 'failed', counts: {key: value}, durationMs },
     request,
   }, requestLogger, { reason: 'queue drain', continues: 'the drain result is returned regardless' });
   ```
   `logAndFlush` never throws (bounded at 2 s), so an audit failure cannot change the response (CLAUDE.md, Audit Trail).
5. Log at `info` `{ adminUserId, queue, outcome, counts, durationMs }` with the message "Drain now finished". On a thrown drain the log is at `error` with `{ err }` (server log only).
6. Respond:
   - success: **200** `{ success: true, data: { queue, counts: DrainCount[], durationMs } }`.
   - thrown drain: **500** `{ success: false, error: 'The drain stopped with an error. Some items may already have been sent. Check the queue counts.', code: 'drain_failed', details: dev-only message }`.

**Never in the response, the logs or the audit row:** item ids, account ids, payload, error messages from rows, skip reasons, or client or business names. The drain functions' results contain only counts, and `pickDrainCounts` enforces the allow-list in any case.

**Never imported by the route or `runQueueDrain`:** `app/api/cron/**`, `@/lib/cron/cronRunRecorder`, `paymentRetryService`, `PaymentStageBillingService`, `paymentInvoiceRepository`. The names `processOverdueItems`, `billDueDatedStages`, `markAllOverdueInvoices`, `processDueRetries`, `CRON_SECRET`, `withCronRunRecord` and `bos_cron_runs` never appear. The source guard in §5.4 pins all of this.

**No server lock and no cool-down.** Two concurrent Drain now calls, or one alongside the cron, are two overlapping runs, which is safe by §D.4. The button is disabled while its own call is in flight (§D.5).

### 2.4 Audit registration (C7-16, SA §G)

| File | Change |
|---|---|
| `lib/audit/events.ts` | Add `BOS_QUEUE_DRAINED` under a new "BUSINESS OS QUEUES (admin-only)" block, with a comment. Add `EVENT_METADATA[BOS_QUEUE_DRAINED] = { severity: 'warning', description: 'An admin ran a Business OS queue drain now' }`. |
| `lib/audit/eventAudience.ts` | `[AUDIT_EVENTS.BOS_QUEUE_DRAINED]: 'bos'` |
| `lib/audit/types.ts` | Add `'bos_queue'` to `AUDIT_ENTITY_TYPES`, with a comment ("One Business OS queue; written only by the admin Drain now route; the entity id is the queue id"). `audit_trail.entity_id` is `TEXT`, so a non-uuid id is valid (`'ais_config'` precedent). |
| `lib/audit/filterOptions.ts` | Add a group rule `{ prefix: 'BOS_QUEUE_', label: 'Business OS Queues' }`, so the dropdown does not fall back to "Bos". This is cosmetic, and 7b/7c's two events will land in the same group. |

The audit trail dropdown tests (`eventAudience.test.ts`, `filterOptions.test.ts`, `app/admin/audit-trail/__tests__/filterOptions.guard.test.ts`) must pass **unedited** once these registrations exist.

### 2.5 UI

**New file `app/admin/components/jobs/DrainNowDialog.tsx`** (`'use client'`). The POST lives here and nowhere else on the page:
- Uses the `Dialog` primitive with the archiving dialog's `DARK_DIALOG` override pattern (C7-13, TA-1). The trigger is a small "Drain now" button inside each `QueueCard`'s header.
- **Body copy** (fixed text with per-queue lines; no data from rows):
  - What it does: "Runs this queue's scheduled step now, the same one {drainedByLabel} runs: it recovers items whose run died, picks up items that are due, and sends them. Each item is checked again before it is sent."
  - For `daily_briefing_sends` and `lead_responses`: "It also queues what has just become due, the same as the scheduled run."
  - For `daily_briefing_sends`: "Writing a briefing uses AI and is charged to that business's credits, as it would be on the scheduled run."
  - What it does **not** do: "It does not re-send failed or dead-lettered items. It does not touch items scheduled for later. It does not record a run of the scheduled job, so the job's status still shows when Vercel last ran it."
  - For `payment_reminders`: "It does not bill plan stages, look for newly overdue invoices or mark invoices overdue. Those stay with the scheduled job."
  - For `payment_automations`: "It does not retry card payments."
- **Reason**: a required text input with label, `maxLength={500}`, and the hint "Don't paste client details." Confirm stays disabled until `reason.trim()` has at least 3 characters (the RevokeDialog pattern). The server enforces the same rule.
- **Confirm** posts `{ queue, reason: reason.trim() }` to `/api/admin/jobs-queues/drain`. While the call is in flight: confirm shows "Draining…", is disabled and `aria-busy`, and the dialog cannot be dismissed by Escape or a click outside.
- **On 200**: the dialog shows "Done in {s} s" and the list of `label: value` counts (or "This queue's drain reports no counts"), then calls `onDrained()`. The parent's `load()` refreshes the view (FR-Q7).
- **On error**: a plain sentence chosen by `code` (`invalid_input`, `drain_failed`, a 401/403 "Your admin session has ended. Sign in again.", or a generic fallback). The view also refreshes after `drain_failed`, because items may have moved. The raw server text is never shown.
- Logging: `createLogger({ module: 'AdminDrainNowDialog' })` with `logger.error({ err, queue }, …)` on a failed call. No reason or body is logged.

**`JobsQueuesView.tsx`**: `QueueCard` gets an `onDrained` prop and renders `<DrainNowDialog queueId={queue.id} queueLabel={queue.label} drainedByLabel={queue.drainedByLabel} onDrained={…} />` in its header, beside the badge. The button shows even when the figures could not be read, because recovery is the point. The header's "Read-only." becomes "Each queue has a Drain now button; everything else here is read-only." The file still contains no POST and does not use the word "Drain" as a standalone word in code: the identifier `DrainNowDialog` does not match `\bDrain\b`, and the visible text lives in the dialog file. **`page.tsx`**: comment only ("Read-only" → "Read-only apart from Drain now").

### 2.6 Access doc and requirement

- `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`, targeted insertions only:
  - register row **91** `jobs-queues/drain#POST`;
  - an "87 → 88" note in As-Built State, with the census re-measured from disk by the existing method;
  - a Change History row.
- The requirement is **not** edited by Dev. The 57 → 58 / 58 → 59 renumbering (§1.4) is reported to SA (OP-5).

---

## 3. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/api/admin/jobs-queues/drain/route.ts` | create | The Drain now route (C7-10, C7-11, C7-14) |
| `lib/admin/jobs/runQueueDrain.ts` | create | Queue → entry-point map; the only importer of the five drains on this path (server-only) |
| `lib/admin/jobs/drainCounts.ts` | create | Pure per-queue count allow-list and labels (C7-13) |
| `lib/admin/jobs/jobsQueuesTypes.ts` | modify | Add the `DrainCount` and `DrainResponse` types (types only) |
| `app/admin/components/jobs/DrainNowDialog.tsx` | create | Button, confirm dialog, reason, counts |
| `app/admin/components/jobs/JobsQueuesView.tsx` | modify | Render the dialog per queue; refresh on drain; header copy |
| `app/admin/jobs-queues/page.tsx` | modify | Header comment only |
| `lib/audit/events.ts` | modify | `BOS_QUEUE_DRAINED` and its metadata |
| `lib/audit/eventAudience.ts` | modify | Tag `'bos'` |
| `lib/audit/types.ts` | modify | Entity type `'bos_queue'` |
| `lib/audit/filterOptions.ts` | modify | `BOS_QUEUE_` group label |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | One case, 57 → 58, count comment; `jest.mock` the five service modules (each records a touch) |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts` | modify | Add `DrainNowDialog.tsx` to the client-file checks; allow exactly one POST, to the drain URL, in that file only (§5.6) |
| `app/admin/__tests__/jobsQueues.render.test.tsx` | modify | "Only button is Refresh" → "Refresh plus one Drain now per queue" |
| `app/api/admin/jobs-queues/drain/__tests__/route.test.ts` | create | Route behaviour (§5.1–5.3, §5.5) |
| `app/api/admin/jobs-queues/drain/__tests__/drain.source.guard.test.ts` | create | C7-10 / C7-11 source guard (§5.4) |
| `lib/admin/jobs/__tests__/drainCounts.test.ts` | create | Allow-list and finite-number rule |
| `lib/admin/jobs/__tests__/runQueueDrain.test.ts` | create | Each queue calls exactly its own entry point once |
| `app/admin/__tests__/jobsQueues.drain.render.test.tsx` | create | Dialog: reason required, POST body, counts shown, refresh, errors |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify (insertions) | Register row 91, census note, Change History |
| `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7D_WORKPLAN.md` | create | This file |

**Explicitly not touched:**
- the five cron routes (`app/api/cron/{payment-reminders,payment-retry,daily-briefing,lead-response,insight-actions}/route.ts`)
- the five service files
- `lib/cron/bosCronJobs.ts` and `lib/cron/cronRunRecorder.ts`
- `AdminJobsQueuesRepository.ts` (7d reads and writes no queue table directly)
- `app/api/admin/jobs-queues/route.ts`
- `vercel.json`
- the admin authz guard and its `CAPS`
- `ArchiveConfirmDialog.tsx` (its pattern is reused, not the file)
- `app/api/business-os/leads/[id]/route.ts` (BL-7a, later)
- `docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md`
- No migration.

---

## 4. Task List

**SA conditions carried in:** C7-10, C7-11, C7-13 (privacy and the dialog), C7-14, C7-15, and the Drain now parts of C7-16. SA's workplan review (to come) governs where it differs from this list.

- [x] **T1** ✅ Re-count `console.*` in every file in §3 marked "modify" (expected 0; C7-15). Confirm the branch with `git branch --show-current`, and that `app/api/admin/**/route.ts` = 58 files / 87 handlers (census method from the access doc).
- [x] **T2** ✅ `lib/admin/jobs/drainCounts.ts` and the `DrainCount` type in `jobsQueuesTypes.ts`, plus `drainCounts.test.ts`.
- [x] **T3** ✅ `lib/admin/jobs/runQueueDrain.ts` (exhaustive `Record<BosQueueId, …>`, `server-only`), plus `runQueueDrain.test.ts`.
- [x] **T4** ✅ Audit registrations (§2.4). Run `eventAudience.test.ts`, `filterOptions.test.ts` and `filterOptions.guard.test.ts` unedited.
- [x] **T5** ✅ `app/api/admin/jobs-queues/drain/route.ts`: gate first, strict Zod, awaited drain, audit on both outcomes through `logAndFlush`, counts-only response, standard error format, `maxDuration = 60`.
- [x] **T6** ✅ Route test (§5.1–5.3, §5.5).
- [x] **T7** ✅ Source guard test (§5.4).
- [x] **T8** ✅ `DrainNowDialog.tsx`, the `JobsQueuesView.tsx` wiring and copy, and the `page.tsx` comment.
- [x] **T9** ✅ Amend `jobsQueues.source.guard.test.ts` and `jobsQueues.render.test.tsx` (§5.6), and add `jobsQueues.drain.render.test.tsx`.
- [x] **T10** ✅ `adminGate.writes.test.ts`: import the route, add one case with a valid body, set `CASES` to 58 and extend the count comment, and mock the five service modules. Run the admin authz surface guard locally (`npx jest lib/admin/__tests__/admin-authz-surface.guard.test.ts`).
- [x] **T11** ✅ Access doc insertions (§2.6), with the census re-measured from disk (expected 88 = 82 + 6 + 0, 59 files).
- [x] **T12** ✅ Re-run the AI-call trace of §1.2 transitively. Grep every module reachable from the four non-briefing drains for `runAiAction`, `getProviderFactory` or `ProviderFactory`, and record the result in Implementation Notes.
- [x] **T13** ✅ Local runs: the new and amended suites; `npx jest app/api/admin lib/admin lib/audit app/admin/__tests__ app/admin/audit-trail`; `npx tsc --noEmit -p .` filtered to the touched files; `npm run lint` on the touched files; `npm run lint:hooks`. Record the counts and anything pre-existing that is red.
- [x] **T14** ✅ `git diff --stat` check (no deletion-only file; agent file-write hazard). Update this workplan's Status to Code Complete and add the Implementation Notes. Commit nothing.

---

## 5. Test Plan

All Jest. Mocks: `@/lib/auth` (`getUser`), `@/lib/services/AdminAccessService`, `@/lib/logger` (records every call), `@/lib/audit/boundedAuditFlush` (`logAndFlush`, recording call order), and the five service modules (`jest.fn` per entry point). The mocked drains mean no test imports the real services, so the PDF-renderer ESM chain behind `InvoiceDeliveryService` is never loaded.

### 5.1 Gate: 401/403, and nothing runs (`route.test.ts`)

| # | Case | Expect |
|---|---|---|
| G-1 | Signed out | 401. No drain mock called. `logAndFlush` not called. The body is never read: a `request.json` spy is not called |
| G-2 | Signed in, not an admin | 403, and the same "nothing called" assertions |
| G-3 | Admin check throws | 403, nothing called |
| G-4 | Auth lookup throws | 401, nothing called |
| G-5 | Invalid body **and** signed out | 401, not 400 (the gate wins) |
| G-6 | Source position: the first statement inside `POST` after the correlation-id lines is `await requireAdmin(` | Pinned by a regex over the source (the P-15 / R-9 precedent) |

`adminGate.writes` repeats G-1..G-4 with its strict `mockTablesTouched` assertions, plus "a real admin gets through" (T10).

### 5.2 Zod: 400 (`route.test.ts`)

| # | Body | Expect |
|---|---|---|
| Z-1 | `{ queue: 'nope', reason: 'abc' }` | 400 `invalid_input`, no drain, no audit |
| Z-2 | Reason missing / `'  a '` (2 characters after trim) / 501 characters | 400 each |
| Z-3 | `{ queue, reason, accountId: '…' }` (strict) | 400 |
| Z-4 | Not JSON / empty body | 400 |
| Z-5 | Reason `'  fix stuck cron  '` | 200; the audit `details.reason === 'fix stuck cron'` (trimmed) |
| Z-6 | `details` present only when `NODE_ENV === 'development'` | Both modes checked |

### 5.3 Each queue calls only its own drain function (`route.test.ts` and `runQueueDrain.test.ts`)

- `it.each` over the five queue ids: POST that queue → **exactly that** entry point is called **once** with no arguments, and the other four have **zero** calls. For `payment_reminders` the test also asserts that the mocked `paymentReminderService` object's `processOverdueItems`, `billDueDatedStages` (and a mocked `paymentInvoiceRepository.markAllOverdueInvoices` that is registered but must not be imported) were not called. For `payment_automations` it asserts that a mocked `paymentRetryService.processDueRetries` was not called.
- `runQueueDrain.test.ts`:
  - The map's keys equal `BOS_QUEUES.map(q => q.id)` exactly. A sixth queue added to `bosCronJobs` without a drain fails here as well as in `tsc`.
  - A drain that rejects propagates the rejection.
- **Concurrency (§D.4).** Two POSTs for the same queue fired with `Promise.all` both return 200, and the mock is called twice: no server lock serialises or refuses them. A second test runs the route while the mocked drain is in flight and asserts the route awaited it: the response does not resolve until the drain's promise resolves, so it is not fire-and-forget. **What unit tests cannot prove** is real `SKIP LOCKED`. That is proven by the existing drain suites (`PaymentReminderService.drain.test.ts`, `InsightActionDispatchService.test.ts`) and `scripts/dev-payment-queue.ts`. 7d calls the very same exported functions, which the source guard pins, so it inherits that proof. QA's manual check (§7, M-5) runs Drain now while the cron is due.

### 5.4 Source guard, C7-10 and C7-11 (`drain.source.guard.test.ts`)

It reads `app/api/admin/jobs-queues/drain/route.ts` and `lib/admin/jobs/runQueueDrain.ts` with comments stripped (the `codeOf` helper from the jobs guard).

| # | Assertion |
|---|---|
| S-1 | `runQueueDrain.ts`'s runtime imports from `@/lib/services/*` are exactly these five `{module, symbol}` pairs: `PaymentReminderService`/`paymentReminderService`, `PaymentAutomationEngine`/`paymentAutomationEngine`, `DailyBriefingDispatchService`/`processDueBriefings`, `LeadResponseDispatchService`/`dispatchLeadResponses`, `InsightActionDispatchService`/`drainInsightActions`. Every other import is `import type`, `server-only` or `./drainCounts` |
| S-2 | The route imports no `@/lib/services/*` and no `@/lib/repositories/*`. It reaches the drains only through `runQueueDrain` |
| S-3 | Neither file contains `processOverdueItems`, `billDueDatedStages`, `markAllOverdueInvoices`, `processDueRetries`, `paymentRetryService`, `CRON_SECRET`, `withCronRunRecord`, `cronRunRecorder`, `bos_cron_runs`, `verifyCronSecret` or `/api/cron` |
| S-4 | Neither file imports from `app/api/cron` (by alias or relative path) |
| S-5 | The route exports `maxDuration = 60` and `runtime = 'nodejs'` |
| S-6 | No fire-and-forget: in `runQueueDrain.ts` each drain call is returned or awaited, and the route has `await runQueueDrain(`. Neither file contains `.catch(` directly on a drain call or `void runQueueDrain` |
| S-7 | Neither file contains `.from(` or `.rpc(` (C7-12, no direct table access) |
| S-8 | **The cron routes are unchanged in the ways that matter.** For each of the five cron routes: it still contains `verifyCronSecret`, `withCronRunRecord('<job id>'` and `export const maxDuration = 60`, and does **not** mention `requireAdmin`, `jobs-queues/drain` or a bypass header (`x-admin`, `x-drain`). Byte-for-byte unchanged is checked in the PR diff (QA, §7 M-7). See OP-4 on a hash pin |
| S-9 | `app/api/business-os/leads/[id]/route.ts` is not imported (BL-7a's pattern is not copied) |

### 5.5 Audit before the response, no `bos_cron_runs`, no content (`route.test.ts`)

| # | Case | Expect |
|---|---|---|
| A-1 | Happy path, `lead_responses`, mock returns `{reaped:1,enqueued:2,claimed:3,sent:2,skipped:1}` | `logAndFlush` called once with `action 'BOS_QUEUE_DRAINED'`, `entityType 'bos_queue'`, `entityId 'lead_responses'`, `userId === actorId === admin`, `severity 'warning'`, and `details` with exactly the keys `{reason, queue, correlationId, outcome:'completed', counts, durationMs}`. `counts` holds those five numbers |
| A-2 | **Order** | The `logAndFlush` mock returns a promise that the test resolves manually. The route's response promise is still pending until it resolves (audit before response). The call log shows the order drain → logAndFlush → response |
| A-3 | `logAndFlush` resolves after "timing out" (its contract: never rejects) | The response is still 200 |
| A-4 | The drain throws `new Error('SECRET-ROW-TEXT')` | 500 `drain_failed`. The audit is still written, with `outcome:'failed'` and `counts: {}`. `SECRET-ROW-TEXT` is in neither the production body nor the audit `details` (it appears only in the `err` of the server error log) |
| A-5 | **No run record** | `@/lib/cron/cronRunRecorder` is mocked with a spy on `withCronRunRecord` (and on any export). No call. Also the stub Supabase client records `from()` calls, and none are made for `bos_cron_runs` (none at all from the route) |
| A-6 | **No content (C7-13)** | The drain mock returns its counts **plus** sentinel fields: `{ sent: 1, error_message: 'SENTINEL-ERR', skip_reason: 'SENTINEL-SKIP', payload: {to:'sentinel@client.test'}, recommendation: 'SENTINEL-REC', contactId: 'SENTINEL-CONTACT', invoiceId: 'SENTINEL-INV', ids: ['SENTINEL-ID'] }`. Asserted for all five queues (`it.each`): the serialised response body, `JSON.stringify` of every logger call, and `JSON.stringify` of the audit entry contain no `SENTINEL`, no `@` and no `client.test`. The response's `data` keys are exactly `queue, counts, durationMs` |
| A-7 | The reason is not logged | No logger argument contains the reason string. It is in the audit row only |
| A-8 | `payment_automations` (void) | 200, `counts: []`, and the audit `counts: {}` |

### 5.6 UI (`jobsQueues.drain.render.test.tsx`, plus the two amended suites)

| # | Case | Expect |
|---|---|---|
| U-1 | Page renders five queues | Five "Drain now" buttons, one inside each `queue-<id>` section. Each button is present even when that queue's `figures` is `null` |
| U-2 | Open the dialog for `payment_reminders` | The "does / does not" copy is shown, including the line about billing stages and overdue scans. Confirm is disabled |
| U-3 | Type `'ab'`, then `'  ab  '` | Confirm stays disabled. Type `'abc'` → enabled |
| U-4 | Confirm | `fetch('/api/admin/jobs-queues/drain', { method:'POST', body: JSON.stringify({queue:'payment_reminders', reason:'abc'}) … })`. The button shows "Draining…" and is disabled while the call is pending. The dialog cannot be closed while pending |
| U-5 | 200 with counts | Each `label: value` is shown with the duration, and the jobs route is fetched a second time (refresh) |
| U-6 | 200 with `counts: []` | "This queue's drain reports no counts" |
| U-7 | 500 `drain_failed` | The plain sentence is shown and the view refreshes. The server's `error`/`details` text is never rendered verbatim |
| U-8 | 400 / 403 | The mapped sentences |
| U-9 | Briefing dialog | Shows the AI/credits line. The lead-replies dialog shows the "also queues" line. Other queues show neither |

**Amended, deliberately (OP-3):**
- `jobsQueues.render.test.tsx` "is read-only: the only button is Refresh" becomes "the only buttons are Refresh and one Drain now per queue", asserting exactly 1 + 5 buttons.
- `jobsQueues.source.guard.test.ts`:
  - `DrainNowDialog.tsx` joins the client-file, C-21 import, console and green checks.
  - The "no action button, no POST" check stays **unchanged for `page.tsx` and `JobsQueuesView.tsx`**.
  - For `DrainNowDialog.tsx`: `Retry` and `Requeue` are still forbidden; there is exactly one `method: 'POST'`; every `fetch(` targets `'/api/admin/jobs-queues/drain'`; and no `\bOK\b`.
  - "Cancel" is allowed in the dialog file only, as the dialog's dismiss button.

### 5.7 Unchanged suites that must stay green

- `app/api/admin/jobs-queues/__tests__/*`
- `lib/admin/jobs/__tests__/*`
- `lib/cron/__tests__/*` (including `bosCronJobs.test.ts`, which pins each cron route's `maxDuration`)
- the five cron routes' tests under `app/api/cron/__tests__`
- `lib/services/__tests__/*` for the five services
- `lib/audit/__tests__/*`
- `app/admin/audit-trail/__tests__/*`
- `lib/admin/__tests__/admin-authz-surface.guard.test.ts`
- `app/admin/components/__tests__/AdminSidebar.nav.test.ts`

---

## 6. Timeout Behaviour (a drain that runs past 60 s)

What happens, step by step:
1. **The platform kills the function at 60 s** (`maxDuration`). The browser receives a platform error (typically 504, often with a non-JSON body). The dialog treats a non-JSON or non-2xx response as `drain_failed` (U-7). It shows "The drain stopped with an error. Some items may already have been sent. Check the queue counts." and refreshes the view.
2. **Rows claimed by the killed run** stay `processing` with `claimed_at` set. They are **not** re-claimed until their lease (90 s) has passed. Then the next reaper, which is the next cron run or the next Drain now, either returns them to `pending` with backoff or dead-letters them at the attempt limit. Because lease 90 s > `maxDuration` 60 s, a killed run is provably dead before its rows can be reclaimed. This is the same guarantee every cron run relies on (B7-1).
3. **The rows a killed run had already closed** (sent or skipped) are terminal and are never re-sent. The only duplicate exposure is the item in flight at the moment of the kill: sent, but not yet closed. That is the existing at-least-once tail (SA §D.6), and BL-7a narrows it.
4. **The audit row is not written** if the kill lands before step 4 of §2.3. The trace that remains is the Pino `info` line "Drain now starting" with `adminUserId`, `queue` and `correlationId`, which is written before the drain. This is a known gap: an admin-started drain that was killed has a log line but no audit row. **OP-6** offers a pre-drain audit row as the fix. The default is to accept the gap for 7d, because the cron has the same exposure and writes no audit at all.
5. **Budget.** The drain functions are sized for the cron's 60 s budget (batch 100 / 25 / 25 / 50, per-row sends). `logAndFlush` adds at most 2 s after the drain. A drain that uses 58 s or more can therefore lose its audit to the kill (same gap as item 4). No in-route deadline or `Promise.race` is added: answering before the drain finishes would leave the drain running on an instance free to freeze, which is the fire-and-forget pattern SA forbade (B7-11).
6. **No client-side timeout** is added. The fetch waits for the platform's answer.

---

## 7. Manual QA Check

On a preview or local build, as a platform admin:

| # | Step | Expect |
|---|---|---|
| M-1 | Open `/admin/jobs-queues` | Five "Drain now" buttons, one per queue card. The header copy says everything else is read-only |
| M-2 | Open the dialog and try to confirm with an empty reason, or a 2-character one | Confirm is disabled |
| M-3 | Drain `insight_actions` with a reason | Counts are shown and the view refreshes. `/admin/audit-trail` shows one `BOS_QUEUE_DRAIN_STARTED` row with the admin, `warning`, the reason, the queue and a correlation id (no counts, by design), under the "Business OS Queues" group |
| M-4 | Check `bos_cron_runs` / the jobs table after M-3 | **No** new run for `insight-actions`. "Last run" is unchanged |
| M-5 | With local dev data, fire Drain now for `payment_reminders` twice at once (two tabs), or alongside `curl` to the dev cron route | Each due reminder is sent once (inspect `payment_reminders.status` and the email log). `scripts/dev-payment-queue.ts` can seed the rows |
| M-6 | As a non-admin, `curl -X POST /api/admin/jobs-queues/drain` | 403, and nothing drained |
| M-7 | `git diff origin/main -- app/api/cron lib/services lib/cron vercel.json` | Empty |

---

## 8. Acceptance Criteria Traceability

| Criterion | Where |
|---|---|
| FR-Q2: Drain now runs the same drain the cron runs, through the same claim path | §2.1, §5.3, §5.4 S-1 |
| §9: "Drain now uses the same claim path as the cron (tested)" | §5.3, §5.4 S-1/S-8 |
| FR-Q3: reason required; audit row flushed before the response | §2.3 step 4, §5.2, §5.5 A-1/A-2 |
| FR-Q7: the page shows new counts | §2.5 refresh, §5.6 U-5 |
| §9: no payload or content in the page or the API response | §5.5 A-6/A-7 |
| C7-10 | §2.3, §5.4 |
| C7-11 | §5.5 A-5, §7 M-4 |
| C7-13 (privacy, dialog) | §2.5, §5.5 A-6, §5.6 |
| C7-14 | §2.3, §5.1, T10, T11 |
| C7-15 | T1, §2.3, §2.5 |
| C7-16 (Drain now: "calls the exact entry point once"; audit shape; `logAndFlush` awaited) | §5.3, §5.5 |
| CLAUDE.md Testing: happy path + auth failure + invalid input | §5.1, §5.2, §5.5 A-1 |

---

## 9. Risks and Rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| An admin drain overlaps the cron and sends something twice | Low | Same exposure as two overlapping cron runs (`SKIP LOCKED`, terminal status as dedupe). No new claim path (S-1). The remaining at-least-once tail is SA §D.6 and BL-7a |
| A drain is killed at 60 s and leaves rows in progress | Low | The lease is 90 s, so the next run reaps them (§6) |
| Drain now hides a dead cron | None by design | No `bos_cron_runs` write (C7-11, A-5). Health and "Last run" still reflect Vercel only |
| A future edit adds `processOverdueItems` or the Stripe retry to the drain path | Low | Source guard S-1/S-3 |
| The briefing drain spends the owner's credits | Expected | It is the same narration the cron would make, cached per day, and the dialog says so (OP-1) |
| A morning briefing goes out earlier than the cron would have sent it | Low | Only businesses already inside their 07:00–10:59 local window are queued. Drain now cannot send a briefing outside that window |
| Lead chases: Drain now queues approved chases that are already due | Expected | Same as the 5-minute cron. Consent and applicability are re-checked at send time (B7-6) |
| Amending the jobs guard and render tests weakens the read-only pin | Medium (process) | Narrow amendment: the view and page files keep the old rule, and the new file is allowed exactly one POST, to one URL (§5.6). SA approves explicitly (OP-3) |
| `adminGate.writes` "real admin gets through" case runs the route | Low | The five service modules are mocked in that file, so no real drain runs |

**Rollback:** one PR, no migration, no data change, no cron or service change. Reverting it removes the route, the dialog and the registrations. Any `BOS_QUEUE_DRAIN_STARTED` rows already written stay in `audit_trail`. After a revert their action is no longer registered: the dropdown treats an unregistered event as visible, so they are still found, and an unregistered entity type is display-only. The access doc row then needs striking in the same revert PR. A partial revert of the UI only (hiding the button) is safe and leaves the route admin-gated and unused.

---

## 10. PR Body Draft

```markdown
## feat(admin): "Drain now" for each Business OS queue (ADMIN_BOS_CLEANUP slice 7d)

### What changes
- `/admin/jobs-queues`: each of the five queues gets a **Drain now** button. A confirm dialog says what the drain does and does not do, requires a reason (3–500 characters), then shows the drain's counts and refreshes the page.
- New `POST /api/admin/jobs-queues/drain` (`requireAdmin` first, strict Zod `{ queue, reason }`, `maxDuration = 60`). It runs **the same function the cron runs for that queue**, in-process and awaited:
  `processDueReminders`, `processScheduledExecutions`, `processDueBriefings`, `dispatchLeadResponses`, `drainInsightActions`.
- One write-ahead audit row per drain, `BOS_QUEUE_DRAIN_STARTED` (audience `bos`, severity `warning`, actor = the admin), with the reason, the queue and the correlation id only, written through `logAndFlush` **before the drain runs**, so it survives a drain that throws or is killed at 60 s. Outcome, counts and duration go in the response and the Pino log, keyed by the correlation id.

### What it never does
- Never bills plan stages, scans for overdue invoices, marks invoices overdue or retries card payments (those stay with the cron).
- Never calls a cron URL, reads `CRON_SECRET` or records a `bos_cron_runs` row, so a dead cron still shows as dead.
- Never retries, releases or cancels a single item (slices 7a–7c, later).
- Response, logs and audit row carry counts only, never item content, ids or names.

### Safety
Two drains at once, or a drain beside the cron, behave like two overlapping cron runs: `FOR UPDATE SKIP LOCKED` hands each row to one runner, and the 90 s reaper lease is above the 60 s time limit. A source guard pins the five entry points and the forbidden names. The cron routes and drain functions are unchanged.

### AI and credits
Only the morning briefing drain can call an AI model (the daily narration, cached per business day). As on the scheduled run, it is attributed to and charged to the business's own credits under the `scheduled` trigger; the dialog says so.

### Registrations
- `adminGate.writes` 57 → 58
- access register row 91, census 88 = 82 + 6 + 0, 59 files
- no guard cap moved
- event `BOS_QUEUE_DRAIN_STARTED`, entity type `bos_queue`, dropdown group "Business OS Queues"

### Tests
Route (gate 401/403 with nothing run, Zod 400, per-queue entry point, audit-before-response, no run record, sentinel no-content), source guard (C7-10/C7-11), counts allow-list, dialog render. Amended deliberately: the jobs page guard and render test (one POST, to the drain URL, in the dialog file only).

### Rollback
Revert the PR. No migration and no data.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 11. Effort Estimate

| Part | Hours |
|---|---|
| T1 census and counts | 0.25 |
| T2–T3 pure counts and drain map, plus tests | 1.5 |
| T4 audit registrations | 0.5 |
| T5–T6 route and route tests | 2.5 |
| T7 source guard | 1 |
| T8–T9 dialog, view wiring, UI tests, guard amendments | 2.5 |
| T10 `adminGate.writes` and the local authz guard | 0.75 |
| T11 access doc | 0.5 |
| T12–T14 AI trace, local runs, notes | 1 |
| **Total** | **about 10.5 h, about 1.3 days (S)**, within SA's 1–1.5 days |

---

## 12. Open Points for SA

| # | Point | Dev default |
|---|---|---|
| **OP-1** | **AI attribution under Drain now.** Only the briefing drain makes a billable AI call (§1.2). Under Drain now it is still attributed to **the owner's account**, with trigger **`'scheduled'`**, and charged to **the owner's credits**, exactly as the cron does. The admin is never charged and never appears in `token_usage`. Lead replies and insight actions make **no** AI call in the drain (the AI ran at detection). Should an admin-triggered narration carry a distinct trigger (for example a new `'admin'` value in `AiTrigger`)? | **No.** Keep `'scheduled'`: the drain is the scheduled step run early, and the narration is cached per day, so it adds no charge class. A new trigger value is a `bos-llm-call-standards` change (catalogue, diary, ledger), so it would get its own review. The `BOS_QUEUE_DRAINED` row and its timestamp link the two |
| **OP-2** | **`processScheduledExecutions()` returns `void`.** Payment automations therefore report no counts. Should 7d change it to return `{ reaped, claimed, completed, failed }`? The cron ignores the return value, so its route would stay unchanged | **No.** Do not touch a live drain function in this slice. The dialog says "This queue's drain reports no counts", and the page refresh shows the queue's figures. The queue has no live producer anyway (`BOS_QUEUES` note) |
| **OP-3** | **Amending SA SC-7's read-only pins** (`jobsQueues.source.guard.test.ts`, `jobsQueues.render.test.tsx:96`). Proposal in §5.6: the view and page keep the original rule, and the new `DrainNowDialog.tsx` is allowed exactly one POST, to the drain URL, plus a "Cancel" dismiss button | Approve the narrow amendment. 7a–7c will widen it again, each under its own review |
| **OP-4** | **"The cron routes are unchanged" (C7-10).** A sha256 pin of the five cron files would also fail every unrelated future edit to a cron route. I propose structural invariants (S-8) plus the PR-diff check (M-7) | Structural invariants plus the diff check. A hash pin only if SA wants it |
| **OP-5** | **Count renumbering.** Because 7d ships first, `adminGate.writes` goes 57 → 58 here and 58 → 59 in 7b, the reverse of §M and C7-14's text. Should SA note this in the requirement, or should Dev? | SA notes it. Dev does not edit the requirement |
| **OP-6** | **A drain killed at 60 s leaves no audit row** (§6 item 4), only the Pino "starting" line. Option: write a second event, `BOS_QUEUE_DRAIN_STARTED` (same shape, no counts), before the drain. That costs up to 2 s of drain budget and adds one event to register | **Accept the gap in 7d.** One event, as §G rules. Revisit if QA or operations see killed drains |
| **OP-7** | **Audit on a thrown drain.** §G describes the row with counts. I also write it when the drain throws (`outcome: 'failed'`, `counts: {}`), because a drain that threw may already have sent items | Write it on both outcomes. Confirm that `details.outcome` is acceptable |
| **OP-8** | **Entity type.** SA's §G names `'bos_queue'`, which is not in `AUDIT_ENTITY_TYPES` today. 7d adds it (plus the `BOS_QUEUE_` dropdown group). 7b/7c will add `'bos_queue_item'` | Add `'bos_queue'` now |
| **OP-9** | **The enqueue side effects of two drains.** The briefing and lead-reply drains also enqueue what has become due (idempotent, §1.1). That matches §C's "only this entry point", and the dialog says so. Is any further limit wanted, such as hiding Drain now on the briefing queue outside business mornings? | No. Only businesses in their local window are queued anyway |

---

## 13. SA Conditions Folded In (W7D-1..W7D-12)

SA's workplan review (below) governs. Where it differs from §2–§6, this is what is built:

| # | What changes from the draft |
|---|---|
| W7D-1 | **One write-ahead audit row.** Event `BOS_QUEUE_DRAIN_STARTED` (not `BOS_QUEUE_DRAINED`), severity `warning`, audience `bos`. Route order: gate → Zod → "Drain now starting" log → `await logAndFlush({…, details: { reason, queue, correlationId } })` → `await runQueueDrain(queue)` → "Drain now finished" log → respond. `details` has exactly those three keys. Outcome, counts and `durationMs` go only into the response and the Pino "finished" line (at `error` with `{ err }` on a throw), keyed by `correlationId`. OP-7's "audit on throw" is removed: the row exists before anything is sent. §6 item 4's gap is closed: a killed drain already has its row. Tests A-1, A-2, A-4, A-8 reordered; A-9 added (no audit on a 400 or a denied gate) |
| W7D-2 | Guard amendment, exactly: `page.tsx` keeps every rule; `JobsQueuesView.tsx` keeps every rule except that `\bDrain\b` appears exactly once, inside the header sentence "Each queue has a Drain now button; everything else here is read-only.", and its only `fetch(` is the jobs GET; `DrainNowDialog.tsx` has exactly one `method: 'POST'`, exactly one `fetch(` to the literal `'/api/admin/jobs-queues/drain'`, a body built from `queue` and `reason` only, no `Retry`/`Requeue`, no green class, no `OK`; `Cancel` allowed in that file only |
| W7D-3 | `requireAdmin(` preceded only by the correlation-id read and `logger.child(…)`; G-6 regex |
| W7D-4 | `DRAIN_QUEUE_IDS = [...] as const satisfies readonly BosQueueId[]` in `drainCounts.ts`, used in `z.enum(DRAIN_QUEUE_IDS)`; set-equality test against `BOS_QUEUES` ids and `Object.keys(DRAIN_COUNT_KEYS)` |
| W7D-5 | Repo-walk guard: under `app/api/admin/**`, `lib/admin/**`, `app/admin/**` only `lib/admin/jobs/runQueueDrain.ts` imports any of the five service modules |
| W7D-6 | The five service modules mocked with `jest.mock(path, () => ({…}))` factories in `route.test.ts` and `adminGate.writes.test.ts`; the writes file keeps its strict `mockTablesTouched` assertions |
| W7D-7 | Dialog copy: "processes", not "sends"; automations' success says "Finished. This queue's drain reports no counts; the refreshed figures below show what changed."; briefing adds "A briefing already written today is reused." and its 07:00–10:59 scope; a separate time-out sentence ("It ran out of time. Anything it did not reach is picked up by the next run. Wait a few minutes before pressing again.") for a 504 or a non-JSON body |
| W7D-8 | `queueId: BosQueueId` via `import type`; `QueueView.id` (a `string`) narrowed at the call site by a type guard, no `as` cast, `QueueView` unchanged |
| W7D-9 | Pino lines carry `adminUserId`, `queue`, `correlationId`, `outcome`, `counts`, `durationMs` only; reason in the audit row only; sentinel test over all five queues |
| W7D-10 | No run record (A-5); S-3 forbids `withCronRunRecord` and `bos_cron_runs` |
| W7D-11 | Registrations as OP-8 with the W7D-1 name; dropdown "Drain Started" under "Business OS Queues"; access doc row 91, census 88 = 82 + 6 + 0, 59 files |
| W7D-12 | Header base `5b26c361`; §1.1 line refs and the 07:00–10:59 window fixed |

OP-1 stands: the briefing narration stays `'scheduled'`, attributed and charged to the owner. No AI attribution code changes.

### 13.1 Implementation Notes (Dev, 2026-10-04)

**Built on** `feature/admin-queue-actions` @ `5b26c361`. Uncommitted.

| Item | Result |
|---|---|
| T1 `console.*` in the files modified | 0 in all eight (re-counted before editing) |
| T1 / T11 census (access doc method, scratch script) | Before 58 files / 87 = 81 + 6 + 0; after **59 / 88 = 82 + 6 + 0** |
| Tests first | The 8 new or amended suites were run before any implementation: all 8 failed (26 failing tests; the rest could not load the missing modules) |
| New and amended suites after implementation | 8 suites, 415 tests, all pass |
| Wide run (`app/admin`, `app/api/admin`, `lib/admin`, `lib/audit`, `lib/business-os/llm`, `lib/cron`, the three service drain suites, `app/api/cron/__tests__`) | 154 suites. Red: `eventAudience.test.ts` (catalogue pin, see deviation 1, fixed); two page render suites timed out under load and pass alone; `runRecord.adoption.test.ts` payment-reminders is **red on the base** (see below) |
| Audit catalogue and dropdown (`lib/audit`, `app/admin/audit-trail`) | 21 suites / 274 tests pass after the pin bump. `filterOptions.test.ts` and `filterOptions.guard.test.ts` pass unedited |
| Admin authz surface guard (`npm run test:authz-guard`) | 119 / 119 pass, no cap moved |
| ESLint on touched files | 0 errors; 6 warnings, all on lines this slice did not write (`events.ts:1242`, `types.ts` `any`s) |
| `npm run lint:hooks` | clean |
| Scoped `tsc` (scratch tsconfig, `"include": []`, touched files only) | 0 errors in touched files. 35 errors in files reached transitively, none touched here (`StripeInvoiceService`, `aiAnalytics`, `MemorySummarizer`, `admin-helpers`/`ais-helpers` entity literals `'reward_config'` / `'workflow_step'`, `InvoicePDFGenerator`, and others) |
| T12 AI trace (static transitive closure, scratch script) | Same as SA §D: reminders 86 files / automations 11 / briefing 75 / leads 80 / insight 34; AI reachable from the briefing drain only |

**Deviations from the approved plan:**
1. **`lib/audit/__tests__/eventAudience.test.ts` edited** (W7D-11 said "pass unedited"). Its last case pins the catalogue size (175 → 176, `bos` 30 → 31). Every event-adding slice has bumped it, with a comment line, and so does this one. The exhaustiveness cases in the same file, and both filter-option suites, pass unedited.
2. **The time-out sentence also covers any non-JSON body** (for example a 502 platform page), as W7D-7 says ("a non-JSON body, or a 504"). A network failure where `fetch` itself rejects gets its own sentence ("The request did not complete, so the drain may or may not have run. Check the queue counts before pressing again."), and the page refreshes. The workplan only had a "generic fallback" here.
3. **After a result, Confirm is hidden and Cancel reads "Close".** This stops a second press from the same dialog. A new press needs a new dialog and a new reason.
4. **The briefing's 07:00–10:59 scope** is one sentence appended to its "also queues" line, so it states the window W7D-7 asks for.
5. **Access doc: insertions only, as instructed.** The headline figures ("87 handlers across 58 route files") and the "What is true" row ("Every one of the 87 …, 81 via `requireAdmin`") are left as the dated 2026-10-02 measurement. The new 87 → 88 note says that it supersedes them. A one-word update of each is owed if a doc owner wants them current.

**Pre-existing red, not touched here:** `app/api/cron/__tests__/runRecord.adoption.test.ts` › payment-reminders returns 500 on `5b26c361`. The cron route calls `paymentReminderService.billDueDatedStages()` (`payment-reminders/route.ts:114`), and that test's factory mock has no `billDueDatedStages`. This slice changes no cron, service or `lib/cron` file (`git diff -- app/api/cron lib/services lib/cron vercel.json` is empty).

---

## SA Review Notes

### SA Workplan Review (2026-10-04)

**Reviewed by SA — 2026-10-04.** **Status: ✅ APPROVED WITH CONDITIONS (W7D-1..W7D-12).** Re-measured on `feature/admin-queue-actions` @ **`5b26c361`** (origin/main after PR #191 and PR #192), not on `5f10a926`. Reviewed against C7-1..C7-16 and the §C matrix, UC-7, CLAUDE.md, and the `durable-queue-drain`, `new-api-route`, `bos-llm-call-standards` and `tenant-isolation-guard` skills. The design is right: it reuses the cron's own drain in-process, awaits it, adds no claim path, no cron-run row and no new pattern beyond the dialog. The conditions fix one audit gap (OP-6), one self-contradiction with the guard (§2.5 header copy), and some copy and test details.

#### A. Re-check against the new base `5b26c361`

| Item | Workplan (on `5f10a926`) | Measured on `5b26c361` | Verdict |
|---|---|---|---|
| What #191 / #192 touched in this area | — | #191: `helpbot-config` and `system-config` routes (bodies only, no handler added or removed, gate unchanged), the audit-trail page (`user_email` fallback). #192: billing repository, Stripe helper, migration `20261025`, purge registrations. **Nothing** under `lib/audit/`, `app/api/cron/`, `lib/services/` (the five), `lib/cron/`, `lib/admin/`, `app/admin/jobs-queues`, `app/admin/components/jobs`, `app/api/admin/__tests__/`, `docs/admin/` or `vercel.json` (`git diff --name-only` = 0 files) | No impact |
| Admin route census (access doc method, scratch script) | 58 files / 87 handlers = 81 + 6 + 0 | **58 files / 87 handlers = 81 `requireAdmin` + 6 inline + 0 open** | ✅ unchanged |
| After 7d | 59 / 88 = 82 + 6 + 0 | **59 / 88 = 82 + 6 + 0** | ✅ |
| `adminGate.writes` `CASES` | 57 → 58 | `toHaveLength(57)` at `:344` → **58** | ✅ (OP-5 ruling below) |
| Access doc register | rows to 90, new row 91 | rows to **90** (90 rows, 87 live; 47–49 struck), new row **91** | ✅ |
| Audit catalogue | `BOS_QUEUE_*`, `'bos_queue'`, `BOS_QUEUE_` group absent | All three absent; `filterOptions.ts` has the `BOS_INVITE_` / `BOS_CREDIT_LOT_` precedent rules; no DB CHECK on `audit_trail.entity_type` | ✅ (event renamed, W7D-1) |
| `console.*` in the files to modify | 0 | 0 in `page.tsx`, `JobsQueuesView.tsx`, `jobsQueuesTypes.ts`, `events.ts`, `eventAudience.ts`, `types.ts`, `filterOptions.ts`, `adminGate.writes.test.ts` | ✅ C7-15 |
| Admin-path importers of the five service modules | — | **None** today in `app/api/admin/**`, `lib/admin/**`, `app/admin/**`. Outside the admin path: the five cron routes and `app/api/business-os/leads/[id]` (BL-7a) | `runQueueDrain.ts` will be the only admin-path importer (W7D-5) |
| `server-only` | — | Not in `node_modules`; Next resolves it and `jest.config.js` maps it to `__mocks__/server-only.js`; 6 precedents | ✅ usable |

The workplan header still says `5f10a926`. Update it to `5b26c361` (W7D-12).

#### B. Verified facts the design relies on

1. **SKIP LOCKED, per queue.** Each claim RPC is defined once, with no later redefinition: `claim_due_payment_reminders` (`2026-08-14_payment_reminders_claim.sql:63`), `claim_due_payment_automation_executions` (`2026-08-14_payment_automation_executions_claim.sql:78`), `claim_due_daily_briefings` (`20260911_daily_briefing.sql:145`), `claim_due_lead_responses` (`20260914_lead_responses.sql:136`), `claim_due_insight_actions` (`20260917_insight_actions.sql:171`). Each is `FOR UPDATE SKIP LOCKED` on `status = 'pending'`.
2. **Reaper first, in all five.** `processDueReminders` (`PaymentReminderService.ts:957`), `processScheduledExecutions` (`PaymentAutomationEngine.ts:293`), `processDueBriefings` (`DailyBriefingDispatchService.ts:59`), `dispatchLeadResponses`, `drainInsightActions` (`:97`) each call `reapStale(90, MAX_ATTEMPTS)` before claiming. Each `reap_stale_*` is two plain `UPDATE … WHERE status = '<in progress>' AND claimed_at < now() - lease`. Two concurrent reapers on one row: the second waits on the row lock, re-checks its WHERE under READ COMMITTED, finds the row no longer in progress and does nothing. **Idempotent.**
3. **Enqueue is idempotent.** Briefing: `upsert(…, { onConflict: 'user_id,briefing_date', ignoreDuplicates: true })` (`DailyBriefingSendRepository.ts:51`). Lead replies: `upsert(…, { onConflict: 'kind,contact_id,entity_id', ignoreDuplicates: true })` (`LeadResponseRepository.ts:90-111`).
4. **So a Drain now beside the cron is two overlapping runs.** That case already happens on Vercel. §D.4 holds as built.
5. **Every cron route** exports `maxDuration = 60`, has its own `verifyCronSecret`, and is wrapped as `withCronRunRecord('<job id>', runJob)`. S-8's strings exist as written.
6. **Nits in §1.1:** `processDueRetries` is at `payment-retry/route.ts:70` (not `:268`), and `processScheduledExecutions` at `:73`. The briefing window is `localHour` 7 to 10 **inclusive**, so it is 07:00–10:59, not 07:00–10:00 (fix it in §1.1 and §9).

#### C. Timeout: can a drain exceed 60 s?

**Yes, at a full batch, and a backlog is exactly when an admin presses Drain now.**

| Queue | Batch | Per-row work (sequential) | Can exceed 60 s? |
|---|---|---|---|
| Payment reminders | 100 | build the email, send, `updateStatus`, `emitPaymentEvent` | **Yes**, at a full batch (about 0.5–1.5 s a row) |
| Payment automations | `BATCH` | rule and event reads, guardrails, placeholder executor | Unlikely (no I/O beyond the database) |
| Morning briefing | 25 | facts build, **AI narration** when the cache is cold, branding, send | **Yes.** 25 cold narrations in sequence can take minutes |
| Lead replies | 25 | gap checks, booking link or **invoice PDF**, send | Possible |
| Insight actions | 50 | fixed-template send | Unlikely |

**It is still safe.** The platform kills the function at 60 s, and the 90 s lease is above that. So a row the killed run claimed is re-claimed only after the run is provably dead. This is the same guarantee the cron relies on, and the same exposure. Two costs stay, and both already exist on the cron:
- (a) the one in-flight item may be sent and not closed (the §D.6 at-least-once tail; BL-7a narrows it);
- (b) **every row that was claimed but not reached spends one attempt.** The reaper returns it to `pending` with a backoff of 2, 4 or 8 minutes. On the briefing and lead queues (`MAX_ATTEMPTS = 3`), three kills in a row would dead-letter rows that were never tried. The backoff stops repeated presses from re-claiming them at once, so this does not grow with the admin's clicking. Recorded below as backlog **BL-7c**, not fixed here: the fix is a smaller batch or an in-drain deadline, which changes the live drain functions.

Fixes in this slice: the audit row must survive a kill (W7D-1), and the dialog must tell a time-out apart from an error (W7D-7).

#### D. AI attribution (OP-1), traced transitively by SA

I computed the **static transitive import closure** of each service module with a scratch script. It resolves `@/` and relative imports, follows dynamic `import()` and `require`, and skips `import type`. Then I grepped every reached file for `runAiAction`, `getProviderFactory`/`ProviderFactory`, `narrateBriefing` and the SDK call shapes.

| Entry module | Files reached | AI reachable? |
|---|---|---|
| `PaymentReminderService.ts` | 86 | **No** |
| `PaymentAutomationEngine.ts` | 11 | **No** |
| `DailyBriefingDispatchService.ts` | 75 | **Yes**: `BriefingStore` → `runAiAction` → `BriefingNarrator`, `providerFactory`, the charge recorder |
| `LeadResponseDispatchService.ts` | 80 | **No** |
| `InsightActionDispatchService.ts` | 34 | **No** |

The Dev's claim is confirmed: **only the briefing drain can make an AI call.** T12 stays as a code-review re-check, because the closure is static.

**Ruling OP-1: keep `'scheduled'`, attributed to and charged to the owner. No new trigger value.**
- `dispatchOne` calls `getBriefing(userId, facts, language, 'scheduled', …)`, and `runAiAction` gets `accountId: userId`.
- Under `bos-llm-call-standards`, scheduled actions are recorded with the **platform actor**, not a person. An admin pressing Drain now runs the scheduled job early. They do not ask for a briefing themselves, so `'scheduled'` is the truthful trigger, and `'user'` or `'external'` would be false.
- **The owner pays only for the service they opted into**, at most once per business-local day for unchanged facts (the facts-hash cache is shared with My Day). Drain now cannot create a briefing outside the business's 07:00–10:59 window, and cannot re-send a `sent` row (it is terminal, and the claim takes `pending` only).
- **The admin is never charged and never appears in `token_usage` or the AI action audit.** The admin's action is linked to it by the audit row's timestamp and `correlationId`.
- A distinct `'admin'` trigger would be a catalogue, ledger and diary change under its own review, and nothing here needs it.

#### E. Rulings on OP-1..OP-9

| # | Ruling |
|---|---|
| **OP-1** | **Approved as the Dev's default** (§D above). |
| **OP-2** | **Approved: do not touch `processScheduledExecutions`.** It also *swallows* a claim error (logs, returns `void`). So "no counts" cannot mean "it worked". The success copy for this queue must not claim items moved (W7D-7). |
| **OP-3** | **Approved in the narrowest form, W7D-2.** The read-only pins (SC-7) are loosened for **one new file only**. `page.tsx` keeps every original rule. `JobsQueuesView.tsx` keeps every original rule except one exact, counted allowance for the header sentence. |
| **OP-4** | **Approved: structural invariants (S-8) plus the PR-diff check (M-7). No hash pin.** "Byte-for-byte unchanged" in C7-10 / §I means unchanged **in this PR**, proven by the diff. After that it is pinned structurally. Requirement amended (dated note). |
| **OP-5** | **Ruled: the counts follow ship order.** 7d: `adminGate.writes` 57 → 58, census 88, row 91. 7b, later: 58 → 59. SA amends C7-14 and §M with a dated note. Dev does not edit the requirement. |
| **OP-6** | **Default overruled. The audit row is written *before* the drain (write-ahead), not after.** The §C analysis shows that a kill is *likely* in the recovery case, and FR-Q3 says every action writes an audit row. An audit written after the drain is lost exactly when it matters. **One row per press, no second event.** See W7D-1. The pre-drain `logAndFlush` costs at most 2 s of the 60 s budget. Requirement §G amended (dated note). |
| **OP-7** | **Moot under OP-6.** The one row exists before anything is sent, so a thrown or killed drain is already on record. The outcome (`completed` / `failed`), the counts and `durationMs` go into the response and into the Pino "Drain now finished" line, at `error` with `{ err }` on a throw, keyed by `correlationId`, which the audit row also carries. |
| **OP-8** | **Approved:** add entity type `'bos_queue'` (comment as proposed; `entity_id` is `TEXT`, and the `'ais_config'` precedent applies) and the group rule `{ prefix: 'BOS_QUEUE_', label: 'Business OS Queues' }`. 7b/7c's `BOS_QUEUE_ITEM_*` events land in the same group, and `'bos_queue_item'` comes with 7b. |
| **OP-9** | **Approved: no extra limit.** The enqueue on both queues is idempotent (§B.3), the briefing enqueue only takes businesses inside their local window, and lead chases are owner-approved and re-checked at send time (B7-6). Hiding the button by time of day would hide recovery when it is needed. |

#### F. Conditions (W7D-1..W7D-12)

1. **W7D-1 (OP-6): write-ahead audit, one row, renamed event.**
   - The event is **`BOS_QUEUE_DRAIN_STARTED`**, not `BOS_QUEUE_DRAINED`: the row is written before the drain, so the name must not claim it finished. Metadata: severity `'warning'`, description "An admin started a Business OS queue drain now". Audience `'bos'`. Dropdown: "Drain Started" under "Business OS Queues".
   - Order in the route: gate → Zod → "Drain now starting" log → **`await logAndFlush({ action: BOS_QUEUE_DRAIN_STARTED, entityType: 'bos_queue', entityId: queue, userId: adminId, actorId: adminId, severity: 'warning', details: { reason, queue, correlationId }, request }, …)`** → `await runQueueDrain(queue)` → "Drain now finished" log → respond.
   - `details` has **exactly** those three keys. No counts or outcome are in the row (OP-7).
   - `logAndFlush` never rejects. An audit failure does not block the drain (CLAUDE.md, Audit Trail).
   - Tests:
     - A-1: the row shape has exactly these keys.
     - A-2: the order is `logAndFlush` resolved → drain called → response. The drain mock is **not** called while the `logAndFlush` promise is pending.
     - A-4: on a throw → 500 `drain_failed`, **exactly one** `logAndFlush` call (the pre-drain one), and the sentinel error text is not in the body or the audit entry.
     - A-8: `payment_automations` → 200, `counts: []`.
     - New A-9: invalid body or denied gate → `logAndFlush` is not called with this event.
2. **W7D-2 (OP-3): the guard amendment, exactly.**
   - **`page.tsx`:** every original rule unchanged. Its comment edit is invisible to `codeOf` anyway.
   - **`JobsQueuesView.tsx`:**
     - every original rule unchanged (no `Retry|Requeue|Cancel`, no `method: 'POST'|…`, no console, no `OK`, the green rule);
     - **except** that `\bDrain\b` may appear **exactly once**, inside the literal header sentence "Each queue has a Drain now button; everything else here is read-only." The test asserts that count, and that the sentence is present;
     - it must also still contain **no `fetch(` other than the existing jobs GET**.
     - §2.5's claim that the view never shows the word does not hold for the proposed header copy, so this allowance is needed. Do not get round it by hiding the sentence in a constant in the dialog file.
   - **`DrainNowDialog.tsx`** joins the client-file, C-21, console and `OK` checks, plus:
     - no `Retry`/`Requeue`;
     - **exactly one** `method: 'POST'`;
     - **exactly one** `fetch(`, whose first argument is the literal `'/api/admin/jobs-queues/drain'`;
     - the body is built from `queue` and `reason` only;
     - **no green class** (SC-7(g): green only on a Healthy or Clear badge; the success state uses neutral text);
     - `Cancel` is allowed in this file only.
   - **Render test:** exactly 1 + 5 buttons, each "Drain now" inside its `queue-<id>` section.
3. **W7D-3: gate first.** In the handler, `requireAdmin(` is preceded only by the correlation-id header read and `logger.child(…)` (the `admins#GET` C-1 precedent). G-6 pins this with a regex. Nothing reads the body, imports a service or logs before the gate.
4. **W7D-4: strict Zod from a single id list.**
   - Export `DRAIN_QUEUE_IDS = [...] as const satisfies readonly BosQueueId[]` from `drainCounts.ts` and use it in `z.enum(DRAIN_QUEUE_IDS)`. Not a `.map()` cast.
   - `drainCounts.test.ts` asserts set-equality with `BOS_QUEUES.map(q => q.id)` and with `Object.keys(DRAIN_COUNT_KEYS)`.
   - `.strict()`. The reason rule is `trim().min(3).max(500)`.
   - 400 uses the standard error format, with `details` only in development.
5. **W7D-5: one admin-path importer.** Extend S-2 into a repo walk: no file under `app/api/admin/**`, `lib/admin/**` or `app/admin/**` other than `lib/admin/jobs/runQueueDrain.ts` imports any of the five service modules. S-1 stays as written. The cron routes and `leads/[id]` are outside the admin path and are not in scope of this assertion.
6. **W7D-6: factory mocks only.** In `adminGate.writes.test.ts` and `route.test.ts`, each of the five service modules is mocked with a `jest.mock(path, () => ({ … }))` **factory**, never automock, so no real service module (and not the PDF ESM chain) is loaded. The writes case must still keep its strict `mockTablesTouched` assertions: `[]` for 401 and the two fail-closed cases, and `['audit_trail']` for 403.
7. **W7D-7: dialog copy, per queue, accurate.**
   - **Shared line, reworded** so that it is true for automations: "Runs this queue's scheduled step now, the same one {drainedByLabel} runs: it recovers items whose run died, picks up items that are due, and processes them. Each item is checked again before it goes out."
   - **`payment_automations`:** "It does not retry card payments." Also, on success: "Finished. This queue's drain reports no counts; the refreshed figures below show what changed." Never "Done" alone (OP-2).
   - **`daily_briefing_sends`:** "Writing a briefing uses AI and is charged to that business's credits, as on the scheduled run. A briefing already written today is reused." Also the "also queues" line. Its scope is businesses in their local morning (07:00–10:59).
   - **Time-out:** a non-JSON body, or a 504, maps to its own sentence: "It ran out of time. Anything it did not reach is picked up by the next run. Wait a few minutes before pressing again." A thrown drain (`drain_failed`) keeps the workplan's sentence. Both refresh the view.
   - Keep every other §2.5 line. They are accurate: the claim takes `pending` only, so failed and dead-lettered rows are not re-sent, rows scheduled for later are not touched, and no run row is written.
8. **W7D-8: client typing.** `DrainNowDialog`'s `queueId` is `BosQueueId` via `import type` from `@/lib/cron/bosCronJobs` (C-21 allows type-only imports). `QueueView.id` is typed `string` today, so narrow it at the call site with a type guard or a typed lookup, not an `as` cast. Do not change `QueueView`.
9. **W7D-9: logs and privacy (C7-13).**
   - The Pino lines carry `adminUserId`, `queue`, `correlationId`, `outcome`, `counts` and `durationMs` only.
   - The reason is in the audit row only (A-7).
   - A-6's sentinel test covers the response body, every logger call and the audit entry, for all five queues.
10. **W7D-10: no run record (C7-11).** A-5 stays as written. S-3 also forbids `withCronRunRecord` and `bos_cron_runs` in both files.
11. **W7D-11: registrations.**
    - `events.ts`, `eventAudience.ts`, `types.ts` and `filterOptions.ts` per OP-8, with the W7D-1 event name.
    - The audience, filter options and guard tests pass **unedited**.
    - Access doc: row **91** `jobs-queues/drain#POST`, an "87 → 88 (2026-10-0x)" note in As-Built State re-measured on the final base (**59 files / 88 = 82 + 6 + 0**), and a Change History row.
    - Run the authz surface guard locally.
12. **W7D-12: housekeeping.**
    - Update the header base to `5b26c361`, and fix the §1.1 line refs and the window hours (§B.6).
    - §1.4 expected figures stand.
    - T1 re-runs the census on whatever base is current at implementation time. If `main` moves again before the PR, re-run it and re-run `adminGate.writes`.

#### G. Backlog found here (not 7d)

- **BL-7c: a killed drain spends one attempt on every claimed-but-unreached row** (§C(b)). This is the same on the cron. A fix (a smaller claim batch, or an in-drain deadline that stops claiming new work at about 45 s, the `runArchive` budget precedent) changes the live drain functions, so it is its own SA-reviewed change, best bundled with BL-7a.

#### H. For the user (business terms)

There is no blocking question. One FYI, with its default:
- **FYI-7d: pressing "Drain now" on the morning briefing uses the business's own AI credits**, exactly as the normal morning run would. It only covers businesses that asked for the briefing, during their own morning, and at most one write-up a day. The admin is never charged. *Default: as stated.*

#### Approval

- [x] Workplan approved. **Proceed to implementation under W7D-1..W7D-12.** The SA code review checks each W-item against the diff.

### SA Code Review (2026-10-04)

**Code Review by SA — 2026-10-04.** **Status: ✅ APPROVED WITH CHANGES (CR7D-1, CR7D-2; both documentation-only).** Reviewed the uncommitted diff in `neuronforge-admin-queues` on `feature/admin-queue-actions` @ `5b26c361` (HEAD verified) against W7D-1..W7D-12, OP-1..OP-9, C7-1..C7-16 with the 2026-10-04 amendments, and CLAUDE.md. Each Dev claim in §13.1 was re-checked, not taken on trust. No code change is required; the code is approved for QA as it stands.

#### A. Verification against the conditions

| Item | Checked | Result |
|---|---|---|
| W7D-1 write-ahead audit | `route.ts:97-120`: "starting" log → `await logAndFlush({ action: BOS_QUEUE_DRAIN_STARTED, entityType: 'bos_queue', entityId: queue, userId/actorId: adminId, severity: 'warning', details: { reason, queue, correlationId }, request })` → `await runQueueDrain(queue)`. `details` has exactly 3 keys. No other `logAndFlush`/audit call in the route. Tests A-1 (exact `toEqual` + key list), A-2 (drain not called while the flush is pending; order `audit → drain → response`), A-4 (one audit call on a throw), A-9 (none on 400/401/403) | ✅ |
| W7D-2 guard amendment (OP-3) | `jobsQueues.source.guard.test.ts`: `page.tsx` keeps every rule and gets a no-`Drain`, no-`fetch(` pin; the view's only allowance is the exact header sentence (stripped once, then `\bDrain\b` counted = 1), and exactly one `fetch(`, the jobs GET; the dialog: exactly one `method: 'POST'`, exactly one `fetch(` to the literal drain URL, body from `queueId` + `reason.trim()` only, no Retry/Requeue/green/`OK`/console, `Cancel` in this file only. Render test: 1 + 5 buttons, one "Drain now" per `queue-<id>` | ✅ exactly the narrow form ruled |
| W7D-3 gate first | `route.ts:70-76`; G-6 parses the handler and pins the three statements before `await requireAdmin(`. G-1/G-2 prove `request.json` is never called on a denial | ✅ |
| W7D-4 strict Zod | `DRAIN_QUEUE_IDS … as const satisfies readonly BosQueueId[]` (`drainCounts.ts:27-33`) → `z.enum(DRAIN_QUEUE_IDS)`, `.strict()`, `trim().min(3).max(500)`; set-equality tests vs `BOS_QUEUES` and `DRAIN_COUNT_KEYS`; 400 in standard format, `details` dev-only (Z-6) | ✅ |
| W7D-5 one admin-path importer | `drain.source.guard.test.ts:108-131` genuinely recurses `app/api/admin`, `lib/admin`, `app/admin` with `readdirSync`, resolves `@/` and relative specs, and expects `[RUNNER]`. `jest.mock(...)` factories are not counted (correct). Passes | ✅ (see L-3) |
| C7-10 / C7-11 source guard | S-3 forbids `processOverdueItems`, `billDueDatedStages`, `markAllOverdueInvoices`, `processDueRetries`, `paymentRetryService`, `CRON_SECRET`, `withCronRunRecord`, `cronRunRecorder`, `bos_cron_runs`, `verifyCronSecret`, `/api/cron` in both files; S-4 no cron import; S-7 no `.from(`/`.rpc(`; S-8 structural pin of the five cron routes (OP-4) | ✅ |
| W7D-6 factory mocks | `route.test.ts`, `runQueueDrain.test.ts`, `adminGate.writes.test.ts`: all five as `jest.mock(path, () => ({…}))`; the writes file's drains push to `mockTablesTouched`, so its strict denial assertions also catch a pre-gate drain | ✅ |
| W7D-7 dialog copy | Shared line ("processes them … before it goes out"), reminders' no-billing line, automations' "does not retry card payments" and the "Finished. … reports no counts …" success (never "Done" alone, U-6), briefing's AI/credits/reuse line and 07:00–10:59 scope, time-out sentence for 504 or non-JSON, `drain_failed` sentence, session sentence for 401/403, a fetch-rejection sentence. Confirm hidden once there is a result (U-5) | ✅ |
| W7D-8 typing | `queueId: BosQueueId` via `import type`; `isDrainQueueId` type guard (`hasOwnProperty` on the exhaustive `QUEUE_COPY`), no `as`; `QueueView` unchanged | ✅ |
| W7D-9 privacy | Log lines carry `adminUserId`, `queue`, `outcome`, `counts` (numbers), `durationMs`, `err` only; `correlationId` via `logger.child`. A-6 sentinel covers all 5 queues across response, every logger call and the audit details; A-7 reason never logged | ✅ |
| W7D-10 no run record | A-5 + S-3 | ✅ |
| W7D-11 registrations | `events.ts` constant + metadata (`warning`, SOC2, "An admin started a Business OS queue drain now"); `eventAudience.ts` `'bos'`; `types.ts` `'bos_queue'`; `filterOptions.ts` `{ prefix: 'BOS_QUEUE_', label: 'Business OS Queues' }`, so `classifyAuditEvent` yields group "Business OS Queues", label "Drain Started". `filterOptions.test.ts` and `filterOptions.guard.test.ts` unedited and green | ✅ (deviation 1 ruled below) |
| Census | SA re-measured from disk: **59** route files; 85 `GET/POST/PUT/PATCH/DELETE` + 3 `HEAD` = **88** handlers; **82** `await requireAdmin(` + **6** files without it (the 6 inline rows) + **0** open. `adminGate.writes` `toHaveLength(58)`; register row **91** | ✅ |
| Untouched paths | `git diff --stat 5b26c361 -- app/api/cron lib/services lib/cron vercel.json lib/repositories` = empty, and no untracked files there. The authz guard file and its `CAPS` untouched | ✅ |
| Drain return shapes vs allow-list | Read the five signatures: reminders `{processed,sent,failed}` (`PaymentReminderService.ts:945`), automations `void` (`PaymentAutomationEngine.ts:289`), briefing `DispatchSummary` (`:48`), leads `DispatchResult` (`:68`), insight `DrainResult` (`:84`). Every allow-listed key exists | ✅ |
| CLAUDE.md | Pino only, `console.*` = 0 in all 11 new/modified source files; `requireAdmin` from the canonical `@/lib/admin/requireAdminRoute`; standard error format; no repository bypass (the route touches no table); ESLint on the new files: clean | ✅ |

**Tests run by SA** (read-only, in the worktree): the 8 new/amended suites plus `lib/audit`, `app/admin/audit-trail`, `adminGate.writes` and the admin authz surface guard: **33 suites, 915 / 916 pass**. The one red was `jobsQueues.drain.render.test.tsx` › U-3 under the parallel run; the suite alone is **21 / 21** (see L-1).

#### B. Findings

| # | File:line | Finding | Severity |
|---|---|---|---|
| **CR7D-1** | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md:3, :43-44, :102, :122, :129` | Stale figures after the insertions (deviation 5). Besides the two the Dev listed, the register heading still says "(87)" (`:122`) and its summary line still says "**81 `requireAdmin` · 6 correct-but-inline · 0 open** … **90 rows, 87 live**" (`:129`). A reader of the "What is true" row is told 87/81, which the doc's own rule says must be the measured figure. **Fix in this PR, in place, minimal:** `:3` Last Updated → 2026-10-04; `:43-44` → "Re-derived **2026-10-04** (ADMIN_BOS_CLEANUP slice 7d, on `5b26c361` plus that slice): **88 handlers across 59 route files = 82 `requireAdmin` + 6 inline + 0 open.**"; `:102` → 88 / 82, "True as of 2026-10-04"; `:122` → "(88)"; `:129` → "**82 … 0 open.**", append "and row 91 on 2026-10-04", "**91 rows, 88 live**". Then reword the inserted note's last sentence ("this note supersedes them") to say the headline was updated. No other line changes | Medium |
| **CR7D-2** | this workplan `:15`, `:418` (M-3), `:459`, `:472`, `:490` | The Overview, the manual QA step M-3, the rollback note and the **PR body draft (§10)** still say `BOS_QUEUE_DRAINED`, and §10 says the row carries "the counts". §13 governs for Dev, but QA reads M-3 and RM publishes §10 as written: QA would look for a row that cannot exist, and the PR would describe an audit design SA overruled. **Fix before QA runs M-3:** change those five places to `BOS_QUEUE_DRAIN_STARTED`, written before the drain, details `reason, queue, correlationId` only (outcome and counts in the response and the log). §2.3/§2.4 may stay as the historical draft, since §13 says it governs | Medium |
| L-1 | `app/admin/__tests__/jobsQueues.drain.render.test.tsx:130-143` | U-3 (four `user.type` calls) exceeded the default timeout under a 33-suite parallel run and passes alone, the same load symptom the Dev saw on two page suites. Not a code defect. Optional: `userEvent.setup({ delay: null })` in `openDialog`, or a per-test timeout, so the suite does not flake once CI runs Jest | Low |
| L-2 | `app/admin/components/jobs/DrainNowDialog.tsx:146, :289` | After a `timed_out`, `drain_failed` or `unknown` outcome, Confirm stays enabled with the same reason, while the time-out copy says "Wait a few minutes before pressing again". Safe (overlapping runs are safe by §D.4, and each press writes its own row), so not blocking. Optional: also hide Confirm when `problem` is in `REFRESH_AFTER`, matching deviation 3 | Low |
| L-3 | `app/api/admin/jobs-queues/drain/__tests__/drain.source.guard.test.ts:38-52` | `importsOf` does not see `export { x } from '…'` re-exports, so a barrel under the admin path re-exporting a service would slip past the W7D-5 walk. None exists today. Optional one-line addition of `export\s+[^;]*?from` to the import regex | Low |
| L-4 | `lib/admin/jobs/drainCounts.ts:52` | The briefing label "skipped (a quiet day or nothing to say)" differs from `BOS_CRON_JOBS`' "skipped (a quiet day)" for the same key. It was the approved §2.2 wording and is more accurate; the module comment saying the labels "follow `BOS_CRON_JOBS`" is therefore slightly overstated. Cosmetic | Low |

#### C. Rulings on the Dev's deviations

1. **Deviation 1 (`eventAudience.test.ts` edited): ACCEPTED.** W7D-11's "pass unedited" was aimed at the exhaustiveness and dropdown tests, whose job is to catch a missing registration; those are unedited and green. The last case is a deliberate size ratchet that every event-adding slice bumps with a dated comment line (slice 11b, `PAYMENT_PLAN_CANCELLED`, …). The bump is exactly +1 total (175 → 176) and +1 `bos` (30 → 31), with `shared` 61 and `agentspilot` 84 unchanged, which is what one `bos` event should produce. Editing it is the ratchet working, not a weakened guard.
2. **Deviation 2 (fetch rejection gets its own sentence, page refreshes): ACCEPTED.** More accurate than a generic fallback: a rejected fetch genuinely cannot say whether the drain ran.
3. **Deviation 3 (Confirm hidden, Cancel reads "Close" after a result): ACCEPTED.** It meets the "Confirm hidden once there is a result" expectation (U-5). See L-2 for the optional extension to error outcomes.
4. **Deviation 4 (briefing window appended to the "also queues" line): ACCEPTED.**
5. **Deviation 5 (access doc left with stale headline figures): NOT ACCEPTED as left. Fix in this PR** with minimal in-place edits, per CR7D-1. The doc's As-Built section exists precisely so a reader is not shown a superseded count as current; a supersede note under a headline that still says 87 defeats that. The edits are figure-and-date substitutions only, no restructuring.

#### D. Pre-existing red: `runRecord.adoption.test.ts` › payment-reminders

**Confirmed, and not introduced by PR #192.**
- On `git show` copies of `5b26c361` (scratchpad): `app/api/cron/payment-reminders/route.ts:114` calls `paymentReminderService.billDueDatedStages()`, and the test's factory mock (`runRecord.adoption.test.ts:103-108`) defines only `processOverdueItems` and `processDueReminders`. The call throws a `TypeError`, the cron's error path answers 500, and the test expects 200. Re-run in this worktree, where those files are byte-identical to the base: "Expected: 200, Received: 500" at `:155`.
- **Introduced by `8dfbd138`** ("chore: commit outstanding branch work", offiromer, 2026-09-27), which added the `billDueDatedStages` block to the cron route. It reached `main` through **PR #127** (merge `64a4062d`, 2026-09-27 23:39 -0400). The adoption test had landed earlier that day with PR #123 (merge `03f5402f`; test commit `5768ca41`). Red on `main` since `64a4062d`, unnoticed because no required CI check runs Jest. `git log -S billDueDatedStages` on the route shows only `8dfbd138` and the merge `3f1ee26d`; PR #192 did not touch either file.
- Not 7d's to fix (7d may not touch cron files or their tests' subjects). One-line fix for whoever owns it: add `billDueDatedStages: async () => ({ … zero counts … })` to that mock. Recommend a tracked follow-up.

#### E. Optimisation suggestions (non-blocking)

- L-1..L-4 above.

#### Code Approved for QA: **Yes**, with CR7D-2 done before QA runs M-3, and CR7D-1 done before RM commits. Neither touches code, so no SA re-review of code is needed; SA checks the two doc diffs only.

## QA Testing Report

### QA Report (2026-10-04)

**QA — 2026-10-04.** **Verdict: PASS WITH NOTES.** No High or Medium code bug. Three Low edge cases (two already raised by SA as L-1/L-2). The browser check is owed by the user.
**Test mode:** full · **Strategy:** A (unit and source guards) + B (route with mocked gate, audit flush and the five services) + D (browser checklist for the user; QA cannot sign in) · **Focus:** api, ui, security · **Skipped:** the live browser run and a live drain (no sign-in, no DB access) · **Input source:** TL prompt + workplan §5 / §13.
**Tree:** `feature/admin-queue-actions` @ `5b26c361` plus the uncommitted diff. Old-code checks ran on a `git archive 5b26c361` copy in the scratchpad, with a scratch Jest config pointing at the shared `node_modules`. Nothing stashed, swapped or installed.
**Audit event tested against:** `BOS_QUEUE_DRAIN_STARTED`, written before the drain, `details` = `reason, queue, correlationId` only, no counts (§13 W7D-1). The `BOS_QUEUE_DRAINED` mentions elsewhere in this workplan are stale (SA CR7D-2) and were not used.

#### Test runs (independent re-run)

| Set | Result |
|---|---|
| The 8 new or amended suites (`route.test.ts`, `drain.source.guard.test.ts`, `drainCounts.test.ts`, `runQueueDrain.test.ts`, `jobsQueues.drain.render`, `jobsQueues.render`, `jobsQueues.source.guard`, `adminGate.writes`) | **8 / 8 suites, 415 / 415 tests** (39 + 16 + 14 + 7 + 19 + 12 + 15 + 293). With `eventAudience.test.ts`: 9 suites, 436 tests |
| After QA's 3 added tests (below) | `route.test.ts` 40, `jobsQueues.drain.render` 21: all pass |
| `adminGate.writes` | 293 tests pass; `CASES` pinned at **58** (`:395`) |
| `npm run test:authz-guard` | **119 / 119** |
| `lib/audit` + `app/admin/audit-trail` | **21 suites / 274 tests** |
| Three service drain suites (`PaymentReminderService.drain`, `PaymentAutomationEngine.drain`, `InsightActionDispatchService`) | **3 suites / 20 tests** |
| Wide set (`app/admin`, `app/api/admin`, `lib/admin`, `lib/audit`, `lib/business-os/llm`, `lib/cron`, `app/api/cron/__tests__`) | **150 suites, 3,837 tests; 5 failed in 4 suites.** All four re-run alone: 3 pass, 1 is the pre-existing base failure (below) |
| ESLint on the 4 new source files and the 2 test files QA edited | clean; `console.*` = 0 in all four new source files |

**Wide-run failures, explained:**
- `runRecord.adoption.test.ts` › payment-reminders (500, expected 200): **reproduces on the `5b26c361` archive copy, run alone.** The cron route calls `paymentReminderService.billDueDatedStages()` (`app/api/cron/payment-reminders/route.ts:114`) and the test's factory mock has no such method. `git diff 5b26c361 -- app/api/cron lib/services lib/cron vercel.json` is empty. Not this slice (SA §D traced its origin).
- `business-os-invites/page.render` (2 tests, 5 s time-out), `qa-slice5-pr2.route` (a `< 1000 ms` timing assertion took 1,678 ms) and **`jobsQueues.drain.render` U-4 (5 s time-out)**: all load-only. Each passes alone on the branch. The invites and archiving render suites also pass alone on the base copy, and did not time out in the base wide run (load varies run to run). The diff touches neither invites nor archiving. U-4 is new in this slice; see Edge Case 2.
- The base wide run had 5 more red suites that are **artefacts of the partial export**, not base defects: there are no `supabase/migrations/` or `scripts/` in the copy (`admin-authz-surface.guard` SQL scan, `modelSettingsSeed`, `ownerPolicyMigration`, `llm-settings` S1-T12), and `jobsQueues.source.guard` reads files relative to the working directory, so on the base it read the branch's view file.

#### Test coverage

| Acceptance criterion | Tested? | Result | Evidence |
|---|---|---|---|
| FR-Q2: Drain now runs the same drain the cron runs, same claim path | ✅ | Pass | `route.test.ts` Q `it.each` (exact entry point once, no args, other four 0, `NEVER` list 0); `runQueueDrain.test.ts`; source guard S-1/S-3/S-8 + the W7D-5 repo walk; real SKIP LOCKED proof inherited from the 3 service drain suites (green) |
| §9 "Drain now uses the same claim path as the cron (tested)" | ✅ | Pass | as above; the cron, services and `lib/cron` diff is empty |
| FR-Q3: reason required; one audit row, flushed (write-ahead) | ✅ | Pass | Z-1..Z-6, A-1 (exact shape, 3 keys), A-2 (flush settles before the drain), A-3, A-4 (row exists when the drain throws), A-9 (none on 400/401/403); QA test: two presses = two rows |
| FR-Q7: the page shows new counts | ✅ | Pass (unit) | U-5, U-6, U-7 and the time-out cases: the jobs GET is fetched a 2nd time. Browser check owed (B-4) |
| §9: no payload or content in the page or the response | ✅ | Pass | A-6 over all five queues (body, every log call, audit row); A-7 (reason never logged, log keys allow-listed); U-7 (server text never rendered); `pickDrainCounts` allow-list tests |
| C7-10 / C7-11: only the five entry points; no `bos_cron_runs`, no cron URL or secret | ✅ | Pass | source guard (16), A-5 (no `withCronRunRecord`, no table touched) |
| C7-14: `requireAdmin` first, `correlationId` | ✅ | Pass | G-1..G-6, `adminGate.writes` 58, authz guard 119/119 |
| C7-15: Pino, error format, `details` dev-only | ✅ | Pass | Z-6, A-4 (`details` undefined outside development) |
| C7-16: exact entry point once; audit shape; flush awaited | ✅ | Pass | Q, A-1, A-2 |
| W7D-2: read-only pins, one POST, in the dialog only | ✅ | Pass | `jobsQueues.source.guard` (15), `jobsQueues.render` 1 + 5 buttons |
| W7D-7: per-queue copy, automations "no counts", time-out sentence | ✅ | Pass | U-2, U-6, U-9 ×4, time-out ×3 |
| W7D-11: registrations | ✅ | Pass | `eventAudience` 176 / bos 31; filter-option suites unedited and green |
| CLAUDE.md Testing: happy path + auth failure + invalid input | ✅ | Pass | A-1, G-1/G-2, Z-1..Z-4 |
| "QA records a manual check of each changed page as a platform admin" | ⚠️ | **Owed** | QA cannot sign in. Checklist below for the user |

**Gaps found in the mapping:** the network-failure sentence (deviation 2) and "two presses write two audit rows" had no test, and nothing tested a double-click inside one dialog. QA added all three (below). The manual page check remains open.

#### Edge cases probed

| Probe | Result | Evidence |
|---|---|---|
| Two concurrent presses on the same queue | Both run, **two audit rows**, each with its own reason and correlation id; no server lock. Safe: SKIP LOCKED + a 90 s lease above the 60 s `maxDuration` (SA §B) | existing Q test + **new QA test** `route.test.ts:361` |
| Double-click on Confirm in one dialog | **One** request (the button disables on the first click) | **new QA test** `jobsQueues.drain.render.test.tsx:307` |
| Drain throws | Audit row already written; 500 `drain_failed`; no `details` outside development; the error text is only in the server `err` log; the dialog shows the plain sentence and refreshes | A-4, U-7 |
| 504, or a non-JSON body | Time-out sentence, refresh | 3 cases in the render test |
| `fetch` rejects (network) | Its own sentence ("The request did not complete…"), not the time-out one; the page refreshes; Confirm stays available | **was untested; new QA test** `jobsQueues.drain.render.test.tsx:288` |
| Reason whitespace-only / 2 characters / 501 characters | 400 on the server (`trim().min(3).max(500)`); Confirm disabled in the UI; input `maxLength=500` | Z-2 ×6, U-3 |
| Unknown queue / extra key `accountId` | 400, nothing runs, no audit | Z-1, Z-3 |
| Confirm disabled until valid; no close mid-request; Confirm hidden after a result | All hold (Escape, outside click, Cancel and the corner Close are all blocked while busy) | U-3, U-4, U-5 |
| Automations "no counts" copy | "Finished. This queue's drain reports no counts…"; never "Done", "moved" or "sent" | U-6, A-8 |
| Card whose figures failed to load | Still offers Drain now | U-1 (`insight_actions` figures `ok: false`) |
| Sentinel content | Absent from the response, every log call and the audit row, for all five queues; the server error text is never rendered | A-6, A-4, U-7 |

#### Issues found

**Bugs (must fix before commit):** none.

**Performance issues:** none.

**Edge cases (nice to fix, all Low):**
1. **A non-JSON 5xx that is not a time-out reads as one.** `classify` maps any `body === null` to `timed_out` (`app/admin/components/jobs/DrainNowDialog.tsx:117`, fed by `:170`). A function crash with an HTML 500 or 502 page tells the admin "It ran out of time…". SA approved this mapping in W7D-7, and the advice (wait, then check the counts) is still safe, so this is wording only. A 200 with a non-JSON body takes the same path.
2. **The new render suite flakes under load** (same symptom as SA L-1). `jobsQueues.drain.render.test.tsx:145` (U-4) exceeded Jest's 5 s default in the wide run; SA saw U-3 do the same. Both pass alone; the suite takes about 20 s for 21 tests. SA L-1's fix (`userEvent.setup({ delay: null })` or a per-test timeout) covers both.
3. **Re-press from a failed dialog reuses the same reason** (same as SA L-2). After `drain_failed`, a time-out or a network failure, Confirm stays enabled, so a second press writes a second audit row with the same reason. That is honest (two presses, two rows), and safe.

#### Tests QA added (uncommitted, in this worktree)
- `app/api/admin/jobs-queues/drain/__tests__/route.test.ts:361`: two concurrent presses write two `BOS_QUEUE_DRAIN_STARTED` rows, with distinct reasons and correlation ids.
- `app/admin/__tests__/jobsQueues.drain.render.test.tsx:288`: `fetch` rejects → the network sentence, not the time-out one; refresh; Confirm still offered; the raw error is not rendered.
- `app/admin/__tests__/jobsQueues.drain.render.test.tsx:307`: a double-click on Confirm sends one request.

#### Browser checklist for the user (signed in as a platform admin, on a preview or local build)

| # | Step | Expect |
|---|---|---|
| B-1 | Open `/admin/jobs-queues` | Five queue cards, each with a "Drain now" button beside its status badge. The header says "Each queue has a Drain now button; everything else here is read-only." |
| B-2 | **Pick a queue with little or no backlog for the first try** (Due now 0 or near it; Insight actions or Payment automations are good). Open its dialog | The per-queue copy is shown; Confirm is greyed out |
| B-3 | Type 2 characters, then only spaces | Confirm stays greyed out. Type a real reason ("QA check, 7d") and Confirm turns on |
| B-4 | Press Confirm | The button reads "Draining…"; Escape and clicking outside do nothing. Then the counts with a time (for Payment automations: "Finished. This queue's drain reports no counts…"); Confirm disappears and Cancel reads "Close"; the figures behind the dialog refresh |
| B-5 | Open `/admin/audit-trail`, group "Business OS Queues", event "Drain Started" | **One `BOS_QUEUE_DRAIN_STARTED` row** for this press: you as the actor, severity warning, entity the queue id, and details showing your reason, the queue and a correlation id. **No counts in the row** (by design) |
| B-6 | Back on `/admin/jobs-queues`, look at the job that drains that queue | Its "Last run" is **unchanged** (Drain now records no run of the scheduled job) |
| B-7 | Morning briefing: open its dialog only; press it only if you accept the cost | The dialog says writing a briefing uses AI on the business's credits. Pressing it sends only to businesses in their 07:00–10:59 local window |
| B-8 | Signed out, or as a non-admin: `curl -X POST <host>/api/admin/jobs-queues/drain -H 'content-type: application/json' -d '{"queue":"insight_actions","reason":"abc"}'` | 401 or 403, and no new audit row |
| B-9 | `git diff origin/main -- app/api/cron lib/services lib/cron vercel.json` on the PR branch | Empty (M-7) |

#### Final status
- [x] All automated acceptance criteria pass, with no High or Medium code bug. Ready for the user's diff review. **The browser check (B-1..B-9) is owed by the user.** SA's CR7D-1 and CR7D-2 (documentation) are still open.
- [ ] Issues found that Dev must address before commit: none required. Edge cases 1–2 are optional.

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | Created | Dev workplan for slice 7d only (user decision: 7d first; 7a–7c and BL-7a later, each its own PR). Read on `5f10a926`. Nine open points for SA |
| 2026-10-04 | SA workplan review | **APPROVED WITH CONDITIONS (W7D-1..W7D-12).** Re-measured on `5b26c361` (after #191/#192): census 58 / 87 = 81 + 6 + 0 → 59 / 88 = 82 + 6 + 0, writes 57 → 58, row 91; #191/#192 touched nothing in this slice's area. SA confirmed SKIP LOCKED claims and idempotent reapers on all five queues, and traced AI transitively (only the briefing). OP-6 overruled: one **write-ahead** audit row `BOS_QUEUE_DRAIN_STARTED` before the drain. OP-3 approved narrowly (the dialog file only, plus one counted header sentence in the view). OP-5 ruled (counts follow ship order). New backlog BL-7c |
| 2026-10-04 | Dev implementation, Code Complete | SA conditions W7D-1..W7D-12 folded in (§13), then implemented test-first on `5b26c361`. Census 88 = 82 + 6 + 0, 59 files; `adminGate.writes` 58; access row 91. Implementation Notes and five recorded deviations in §13.1. Uncommitted |
| 2026-10-04 | SA code review | **APPROVED WITH CHANGES (CR7D-1, CR7D-2, documentation only).** All W7D-1..W7D-12 verified against the diff; census re-measured 59 files / 88 = 82 + 6 + 0; no change under `app/api/cron`, `lib/services`, `lib/cron`, `vercel.json`. Deviations 1–4 accepted; deviation 5 not accepted: fix the access doc's stale figures in place (CR7D-1). Stale `BOS_QUEUE_DRAINED` in Overview, M-3, rollback and the §10 PR body (CR7D-2). Pre-existing red `runRecord.adoption` › payment-reminders traced to `8dfbd138` via PR #127 (`64a4062d`), not PR #192. Four Low optional items |
| 2026-10-04 | QA report | **PASS WITH NOTES.** 8 suites / 415 tests, `adminGate.writes` 58, authz guard 119/119, audit 21/274, service drains 3/20, wide set 150 suites (4 red: 3 load-only, 1 the pre-existing `runRecord.adoption`, confirmed on a `5b26c361` archive copy). 3 tests added (two presses = two audit rows; the network-failure sentence; a double-click = one request). 3 Low edge cases. Browser checklist B-1..B-9 owed by the user |
| 2026-10-04 | CR7D-1, CR7D-2 and L-1 applied (main session) | CR7D-2: the Overview, M-3, the rollback note and the §10 PR body now name `BOS_QUEUE_DRAIN_STARTED` (write-ahead, details reason/queue/correlationId only); the pre-review plan sections (§2–§5) are superseded by §13. CR7D-1: the access doc headline, "What is true", the register heading and the summary line now read 88 / 59 files = 82 + 6 + 0, 91 rows and 88 live, with Last Updated 2026-10-04. L-1: `jobsQueues.drain.render.test.tsx` gets a 20 s per-file timeout for parallel load. |
