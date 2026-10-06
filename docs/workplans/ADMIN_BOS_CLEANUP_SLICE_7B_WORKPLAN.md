# Workplan: Admin BOS Cleanup, Slice 7b (cancel one queue item)

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md): §4.2 FR-Q1 (cancel), FR-Q3, FR-Q4, FR-Q5, FR-Q7; the slice 7 lines of §9 that apply to cancel; TA-9; and **"SA Review — slice 7 (2026-10-04)"** in full, with SA's 7d and 7a amendments. The binding parts for 7b are §C (the Cancel column), §D.1–D.3 and D.5, §F, §G (`BOS_QUEUE_ITEM_CANCELLED`), §H, and conditions **C7-1, C7-2, C7-3, C7-6, C7-9, C7-12, C7-13, C7-14, C7-15, C7-16** (the cancel items). User decisions used: UC-7 (7d, 7a, 7b, 7c, each its own PR), UC-8 (the business name is enough), Q-SA7-1 (owner notification) unanswered, so its default (no) applies.
**Branch:** `feature/admin-queue-cancel`, rebased (W7B-10) onto `origin/main` @ `5b5d2f5c` (includes #201, #206, #207), then (CR7B-2) onto `7eac5b98` (#194, #205, #208, #209); originally cut at `b1070558`. Worktree `neuronforge-admin-queues`. Created by RM.
**Process:** Dev workplan → SA workplan review → Dev implement → SA code review → QA → the user sees the uncommitted diff → user approval → RM. Dev commits nothing.
**Date:** 2026-10-04
**Status:** Code Complete (2026-10-04), uncommitted; awaiting SA code review. Migration 20261035 NOT applied (the user applies and verifies it before merge, W7B-1 f). The §6.1 probe is prepared, NOT run (the user runs it after code review, W7B-4)
**Effort:** M, about 2.55 days: 2.3 days with the owner-visibility migration (OP-2, option 1, decided) plus about 0.25 days for the checker and probe extension (W7B-12). Breakdown in [section 11](#11-effort-estimate).

## Overview

Slice 7a lists a queue's items and marks each one "Cancellable: yes / no". It has no action. Slice 7b adds the first action that **writes to a live queue**: **Cancel item**. A cancelled item is closed for good. The queue never picks it up, so it is never sent.

The admin presses "Cancel item" on a row that the shared eligibility function marks cancellable. A confirm dialog opens and requires a written reason. On confirm, the browser posts to a new route, `POST /api/admin/jobs-queues/items/action`, with `action: 'cancel'`. The route:
1. re-reads the row on the server;
2. checks it is still in the state the admin saw;
3. re-checks eligibility with the shared module;
4. changes it with **one compare-and-set UPDATE** that matches on `id`, the row's own `user_id`, the expected `status` and `attempts`, plus `claimed_at IS NULL` for an orphaned in-progress row.

The action wins only when the UPDATE reports exactly one row. On a win, one `BOS_QUEUE_ITEM_CANCELLED` audit row is flushed before the response. On a loss, the response is **409 `item_changed`**, with no audit row.

Cancel never touches a leased in-progress row, never moves anything to `pending`, and never touches a finished row. The response, the logs and the audit row carry metadata only.

New:
- one route;
- one write repository, `AdminQueueActionsRepository`;
- one read method on `AdminJobsQueuesRepository`;
- one dialog;
- one audit event and one entity type.

Also: possibly one migration, which only hides the new audit rows from business owners (OP-2). No cron, drain, service or claim function changes.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify](#3-files-to-create--modify)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. The Live PostgREST Probe and the Constraint Check](#6-the-live-postgrest-probe-and-the-constraint-check)
- [7. Manual QA Check](#7-manual-qa-check)
- [8. Acceptance Criteria Traceability](#8-acceptance-criteria-traceability)
- [9. Risks and Rollback](#9-risks-and-rollback)
- [10. PR Body Draft](#10-pr-body-draft)
- [11. Effort Estimate](#11-effort-estimate)
- [12. Open Points for SA](#12-open-points-for-sa)

---

## 1. Analysis Summary

### 1.1 What exists on `b1070558`, and what 7b does with it

| Piece | As built | 7b |
|---|---|---|
| `lib/admin/jobs/queueItemEligibility.ts` | The C7-9 single source. `CANCEL_FROM_STATUSES` (§C Cancel column), `IN_PROGRESS_STATUS`, and `queueItemEligibility(queue, facts, now)`. Cancel is `leased` for an in-progress row with `claimed_at` set, `not_cancellable_state` for anything outside the set (unknown statuses included), and does not depend on the clock | **Imported, never copied** (§2.2, §2.3). The route calls it with the real clock (W7A-8) and reads `.cancel` only |
| `lib/repositories/AdminJobsQueuesRepository.ts` | Service role, cross-account, read-only. `ADMIN_QUEUE_ITEM_COLUMNS` and the private `mapItemRow` (field-by-field mapping, fails a malformed row). Isolation guard: only `app/api/admin/**` names it | **One new read method**, `readQueueItemAllAccounts` (one row by id, the same columns and mapper). Its header gains one sentence. It still writes nothing (§2.2) |
| `lib/admin/jobs/buildQueueItemsView.ts` | `QUEUE_ITEM_QUEUE_IDS` (the Zod enum source), `QUEUE_ITEM_STATUS_LABELS`, `kindLabel` | The route reuses the id list and the status labels for its responses |
| `app/admin/components/jobs/QueueItemsPanel.tsx` | Read-only. One GET. Buttons: four tabs, Previous and Next. The "Cancellable" cell shows "yes" / "no" / the lease words | The "Cancellable" cell renders the new dialog's trigger, **"Cancel item"**, when `item.cancel.allowed`. Otherwise the 7a words are unchanged. A new `onChanged` prop refreshes the page after an action |
| `app/admin/components/jobs/DrainNowDialog.tsx` | The 7d dialog pattern: `DARK_DIALOG`, a required reason of 3 to 500 characters, cannot be dismissed while busy, outcomes mapped to fixed sentences, Confirm hidden after a result | The pattern is **reused in a new file**. `DrainNowDialog.tsx` is not touched |
| `app/api/admin/jobs-queues/drain/route.ts` | `requireAdmin` first, then strict Zod, then `logAndFlush`, with the standard error format | The template for the new route's shape |
| `lib/audit/*` | `BOS_QUEUE_DRAIN_STARTED`, entity type `bos_queue`, the group rule `BOS_QUEUE_` → "Business OS Queues". Catalogue pin **177**, `bos` **32** | New event `BOS_QUEUE_ITEM_CANCELLED`, entity type `bos_queue_item`. The group rule already covers it, so the dropdown label is "Item Cancelled". The catalogue pin goes to 178, `bos` 33 |
| `lib/audit/ownerVisibility.ts` + the owner RLS policy (`20261018`) | **Every entity type is classified.** An `'operator'` type must also be in the policy's `NOT IN` list: `ownerVisibility.test.ts` fails when the latest owner-policy migration and the registry differ | **Finding F-1** (§1.4, OP-2) |

### 1.2 Status values and constraints per table (C7-6, read from the migrations; live confirmation is OP-3)

| Queue → table | Status CHECK (migration) | Cancellable from (§C, as data) | Becomes | Patch (exact) |
|---|---|---|---|---|
| `payment_reminders` → `payment_reminders` | **None.** `2026-08-14_payment_reminders_claim.sql:13` says "there is NO CHECK constraint on this column today and this migration deliberately does NOT add one". The vocabulary includes `cancelled`. The owner path already writes it (`PaymentReminderRepository.cancel`, `:118-134`) | `pending`, `failed` (dead-lettered included), `processing` only with `claimed_at IS NULL` | `cancelled` | `{ status: 'cancelled' }` |
| `payment_automations` → `payment_automation_executions` | **None** (`2026-08-14_payment_automation_executions_claim.sql:13`, same wording). `cancelled` is in the documented vocabulary | `pending` (including no due time), `failed`, `dead_letter`, `running` only with `claimed_at IS NULL` | `cancelled` | `{ status: 'cancelled' }` |
| `daily_briefing_sends` | `CHECK (status IN ('pending','processing','sent','skipped','failed'))` (`20260911_daily_briefing.sql:96-97`). `skip_reason TEXT`, no CHECK (`:105`) | `pending`, `failed`, `processing` only with `claimed_at IS NULL` | `skipped` | `{ status: 'skipped', skip_reason: 'cancelled_by_admin' }` |
| `lead_responses` | The same CHECK (`20260914_lead_responses.sql:64-65`). `skip_reason TEXT` (`:78`) | the same | `skipped` | the same |
| `insight_actions` | The same CHECK (`20260917_insight_actions.sql:62-63`). `skip_reason TEXT` (`:75`) | the same | `skipped` | the same |

What the patch does **not** contain:
- `error_message` (kept for diagnosis, C7-6);
- `attempts`, `claimed_by`, `claimed_at`, `next_attempt_at`;
- any payload or target column;
- `updated_at` (no such column, §A).

A zero-row update cannot prove a CHECK: Postgres evaluates it only on rows it writes. So the live confirmation is a read of `pg_constraint` (OP-3, §6.2).

**No trigger** exists on any of the five tables. A grep of every `CREATE TRIGGER` in `supabase/` finds none `ON` these tables, and SA's §F says the same. The §6.2 SQL also confirms it live.

### 1.3 Facts that bound the design

- **`failed` is terminal on all five queues.** A retryable insight failure goes back to `pending` (`InsightActionRepository.markFailed`, `:188-198`). The other queues' failure paths and reapers write `failed`, `dead_letter` or `pending`. No claim takes `failed`. So cancelling a `pending` row is what stops a send. Cancelling a `failed` row closes it, so that 7c can never re-send it and the failure counts stop showing it.
- **What happens after a cancel, per queue.** This is the dialog's "what happens next" copy.
  - **Briefing:** `UNIQUE(user_id, briefing_date)` stops a re-enqueue for that day.
  - **Lead replies:** `UNIQUE(kind, contact_id, entity_id)` plus the status-blind `hasRowFor` stop a re-enqueue.
  - **Insight actions:** `UNIQUE(dedupe_key)`, where the key is `kind:target:period`, stops a re-enqueue in the same period. A later period can queue a new one.
  - **Payment reminders:** the overdue scan dedupes on any reminder of that type in the last 24 h, whatever its status (`findRecentByInvoice`, `:266-290`). So a later reminder day can still schedule a new reminder for an unpaid invoice.
  - **Payment automations:** later events can still queue new runs.
- **Owner-side cancels already exist** with the same shape: pending only, then status `cancelled` or `skipped` plus a reason (`PaymentReminderRepository.cancel`, `LeadResponseRepository.cancelPending`, `InsightActionRepository.cancel`). They race the admin's update exactly as a claim does, and the CAS handles them the same way.
- **Live data (SA 7a §A):** about 65 `pending` payment reminders, all of them real client reminders. There are no `failed`, `dead_letter`, `processing` or `running` rows. So the only cancellable live rows are real waiting reminders (§7, OP-12).
- **`{ count: 'exact' }` on an update has a precedent:** `BusinessOsInviteRepository.recordInviteEmailOutcome` (`:393-423`), with the same "no `.select()`, `count === 1`" rule and the same 42703 note.

### 1.4 Finding F-1: the audit row would be visible to the business owner

SA §G and the brief put `userId` = **the item's account** on the audit row (the entitlements pattern). Since BD-26 (`20261018`, PR #202), an owner reads back every audit row written against their account **unless its entity type is classified `'operator'`**:
- **App reads** (`AuditTrailRepository.listOwnerEntries`, the data export) filter on the registry in code. That takes effect on deploy.
- **The owner RLS policy** filters on a literal `NOT IN (...)` list. That changes only through a migration.

`ownerVisibility.test.ts` fails if the two differ.

So `bos_queue_item` can only be:
- **(1) `'operator'`, with a migration** that adds it to the policy list. The admin's reason stays admin-only and the row stays account-linked. This contradicts SA §H ("no migration").
- **(2) `'owner'`, written with the admin's own id as `userId`.** This is the `bos_queue` and `archive_run` precedent: no migration, but the row is not linked to the account by `user_id`.

Writing it against the owner's account and classifying it `'owner'` is **not** acceptable. The business owner would see the admin's internal reason, which Q-SA7-1's default does not want. This is **OP-2**. The plan below assumes option (1) and marks the files that exist only under it.

### 1.5 Finding F-2: stale lead-reply kind labels (7a)

SA §A, and so 7a's label map, take `lead_responses.kind` as `('invite', 'chase')`. Two later migrations widened the CHECK to `('invite', 'chase', 'invoice_chase', 'intake_chase', 'meeting_reminder')` (`20260916_lead_response_kinds.sql:44-45`, `20260923_meeting_reminder.sql:112-114`). So 7a labels three real kinds "Other", and the 7b dialog would read "Other for <business>". This is a label-only fix: three entries in `QUEUE_ITEM_KIND_LABELS` (OP-11).

### 1.6 Admin surface (C7-14) and logging (C7-15)

- **Census on `b1070558`** (access doc, rows to 92): **60 files, 89 handlers = 83 `requireAdmin` + 6 inline + 0 open.**
- **After 7b:** **61 files, 90 = 84 + 6 + 0**, register row **93** `jobs-queues/items/action#POST`.
- **`adminGate.writes`:** `CASES` **58 → 59** (`:395`), per SA's ordering note.
- No `CAPS` value moves and no exemption is added. T1 re-measures the census with the guard's own scanner (W7A-11).
- **`console.*`** counted on `b1070558`: **0** in every source and test file this slice modifies (`JobsQueuesView.tsx`, `QueueItemsPanel.tsx`, `page.tsx`, `AdminJobsQueuesRepository.ts`, `jobsQueuesTypes.ts`, `buildQueueItemsView.ts`, `events.ts`, `eventAudience.ts`, `types.ts`, `ownerVisibility.ts`, `lib/repositories/index.ts`, and the five test files listed in §3). New files use Pino only.

---

## 2. Implementation Approach

### 2.1 Request flow (the route)

**File:** `app/api/admin/jobs-queues/items/action/route.ts` (new)

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The actions this route performs. 7c adds 'retry' here and a handler below. */
const QUEUE_ITEM_ACTIONS = ['cancel'] as const satisfies readonly QueueItemAction[];

const ItemActionBodySchema = z
  .object({
    queue: z.enum(QUEUE_ITEM_QUEUE_IDS),
    itemId: z.string().uuid(),
    action: z.enum(QUEUE_ITEM_ACTIONS),
    expected: z
      .object({
        status: z.string().regex(/^[a-z_]{1,32}$/),
        attempts: z.number().int().min(0).max(100_000),
      })
      .strict(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict(); // no userId, accountId, ownerId or anything else (SA §F)

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement (C7-14, W7D-3). Nothing above it reads the body or a queue.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  ...
  switch (body.action) {
    case 'cancel':
      return cancelItem(...);
    default:
      return assertNever(body.action); // 7c: one more case
  }
}
```

Steps after the gate, in this order. Each refusal is a fixed sentence in the standard error format, with `details` in development only.

| # | Step | On refusal |
|---|---|---|
| 1 | Parse JSON (`.catch(() => undefined)`), then `safeParse` | **400** `invalid_input`. Nothing is read or written. Covers an extra key (`userId`, `accountId`), a non-uuid id, an unknown queue or action (`'retry'` in 7b), a bad `expected`, and a reason under 3 or over 500 characters |
| 2 | **"From" check before any read (§D.2):** `expected.status ∈ CANCEL_FROM_STATUSES[queue]` | **422** `not_cancellable_state`. Nothing is read. A client cannot widen the matrix by lying about what it saw |
| 3 | **Read the row** on the server: `adminJobsQueuesRepository.readQueueItemAllAccounts(ctx, queue, itemId)` under `underDeadline` (5 s) | read error or time-out → **500** `action_failed`; no row in **that queue's** table → **404** `item_not_found` |
| 4 | **Still what the admin saw?** `row.status === expected.status && row.attempts === expected.attempts` | **409** `item_changed`, with `current: { status, statusLabel }`. No update, no audit row. Logged at `info` |
| 5 | **Eligibility (C7-9), server-side:** `queueItemEligibility(queue, factsOf(row), new Date()).cancel`, with the **real** clock (W7A-8) | **422** with the module's own code: `leased` (an in-progress row with `claimed_at` set) or `not_cancellable_state` |
| 6 | **CAS (C7-3):** `adminQueueActionsRepository.cancelQueueItemAllAccounts(ctx, { queue, itemId: row.id, ownerUserId: row.userId, expected: { status: row.status, attempts: row.attempts } })` | see 7 and 8 |
| 7 | **Won** (`outcome: 'cancelled'`, that is `count === 1`): log at `info` "Queue item cancelled" `{ adminUserId, queue, itemId, from, to }` → **`await logAndFlush(BOS_QUEUE_ITEM_CANCELLED …)`** (§2.5) → **200** | — |
| 8 | **Lost** (`outcome: 'not_matched'`, `count === 0`): re-read the row once (under the deadline) | gone → **404** `item_not_found`; present → **409** `item_changed` with its current status. **No second update and no audit row.** Logged at `info` |
| 9 | **Unconfirmed** (a repository error, or a `count` other than 0 or 1) | **500** `outcome_unknown`, logged at `error` with `queue`, `itemId` and `correlationId`. No audit row (OP-9) |

Notes on the flow:
- **Where the owner comes from:** `ownerUserId` is **always `row.userId` from step 3**. Nothing from the body reaches the CAS except `queue` (which maps to a fixed table) and the uuid `itemId`. `expected` is used only for the comparison in step 4. The CAS then uses the row's own `status` and `attempts`, which equal it after step 4.
- **No deadline or abort on the write.** Aborting a single-row primary-key update mid-flight would make its outcome unknowable. The reads stay under the 5 s deadline.
- **What the route never does:**
  - send anything;
  - import a service, drain or cron module (the W7D-5 repo walk stays green);
  - call `.from(` itself (C7-12);
  - log the reason, which goes in the audit row only (W7D-9).

**200 body:** `{ success: true, data: { queue, itemId, action: 'cancel', before: { status, statusLabel }, after: { status, statusLabel } } }`. Exactly these keys. The labels come from `QUEUE_ITEM_STATUS_LABELS`.

**409 body:** `{ success: false, error: 'This item changed since the list was loaded. Nothing was cancelled.', code: 'item_changed', current: { status, statusLabel } }`. The raw status word is already sent by the 7a list for this same purpose (7a QA note 1).

### 2.2 The single-item read: `AdminJobsQueuesRepository.readQueueItemAllAccounts` (C7-12 reads)

```typescript
async readQueueItemAllAccounts(
  context: AdminReadContext,          // FIRST and REQUIRED
  queue: AdminQueueId,
  itemId: string,
  options: AdminReadOptions = {}      // abort signal
): Promise<RepositoryResult<RawQueueItem | null>>;  // null = no such row in this queue
```

- One request: `.from(spec.table).select(ADMIN_QUEUE_ITEM_COLUMNS[queue].join(', ')).eq('id', itemId).limit(1)`. It does not use `.single()`, so a missing row is `null`, never a PGRST116 error.
- It maps the row through the existing `mapItemRow`. A malformed row fails the read.
- **The same column allow-list as the 7a list.** No new column is read: no `error_message`, `skip_reason`, payload, contact, invoice or claimer column. `user_id` is read only so the CAS can be scoped (C7-12's existing reason for it).
- Unknown queue or a missing context: an error is returned and **no request** is made.
- Logs `info` `{ correlationId, adminUserId, queue, found }`, never a row value. On error it logs `warn` with the code only.
- **Why here and not in the write repository (OP-7):** C7-12 rules "reads extend `AdminJobsQueuesRepository`". The column list and the mapper already live there, and the existing isolation guard ("only `app/api/admin/**`") already covers the new caller. Its header gains: "One single-item read for the slice 7b action route; this repository still writes nothing."

### 2.3 The write repository: `lib/repositories/AdminQueueActionsRepository.ts` (new, `new-repository`, `tenant-isolation-guard`)

```typescript
/** Same shape as AdminReadContext; named for what it guards. */
export interface AdminActionContext { correlationId: string; adminId: string }

/** The exact patch per queue (C7-6). Frozen; never built from input. */
export const ADMIN_QUEUE_CANCEL_PATCH: Readonly<Record<BosQueueId, Readonly<Record<string, string>>>> = {
  payment_reminders:    { status: 'cancelled' },
  payment_automations:  { status: 'cancelled' },
  daily_briefing_sends: { status: 'skipped', skip_reason: 'cancelled_by_admin' },
  lead_responses:       { status: 'skipped', skip_reason: 'cancelled_by_admin' },
  insight_actions:      { status: 'skipped', skip_reason: 'cancelled_by_admin' },
};

/** Queue → table. Pinned equal to ADMIN_QUEUE_SPECS[q].table by test (OP-8). */
export const ADMIN_QUEUE_ACTION_TABLES: Readonly<Record<BosQueueId, string>>;

export interface CancelQueueItemInput {
  queue: BosQueueId;
  itemId: string;
  /** The row's own user_id, as read by the route. NEVER from a request. */
  ownerUserId: string;
  expected: { status: string; attempts: number };
}

async cancelQueueItemAllAccounts(
  context: AdminActionContext,
  input: CancelQueueItemInput
): Promise<RepositoryResult<{ outcome: 'cancelled' | 'not_matched' }>>;
```

The one UPDATE (§D.1, C7-3):

```typescript
let query = this.supabase
  .from(ADMIN_QUEUE_ACTION_TABLES[queue])
  .update({ ...ADMIN_QUEUE_CANCEL_PATCH[queue] }, { count: 'exact' })   // a copy of a frozen constant; nothing from input
  .eq('id', input.itemId)
  .eq('user_id', input.ownerUserId)
  .eq('status', input.expected.status)
  .eq('attempts', input.expected.attempts);
if (input.expected.status === IN_PROGRESS_STATUS[queue]) {
  query = query.is('claimed_at', null);      // C7-2, in the write itself, not only in the pre-check
}
const { error, count } = await query;          // NO .select(), NO .or()
```

- **Refuses with no request** when:
  - the context is missing;
  - the queue is unknown;
  - `expected.status ∉ CANCEL_FROM_STATUSES[queue]` (imported from `queueItemEligibility`; a second line of defence after route step 2);
  - `expected.attempts` is not a non-negative integer;
  - either id is empty.
- **Outcome:** `count === 1` → `cancelled`; `count === 0` → `not_matched`; an error, or any other `count` (including `null`) → `{ data: null, error }`, logged at `error` with code `count_unconfirmed` or the PostgREST code.
- **No `.or()` anywhere in the file**, so the 2026-09-29 defect (UPDATE + `.or()` + `.select()` → misleading 42703) cannot arise. **No `.select()`** on the update.
- **Why the service role (code comment and class header):** "Close this one queue item, whichever account it belongs to" is an admin, cross-account action by design. CLAUDE.md rule 4 is replaced by the caller's `requireAdmin` gate. The tenant boundary is the route's server-side read: the owner is the row's own `user_id`, and both keys are named in the write (tenant-isolation-guard Steps 2–3). No trigger fires (§1.2). There is no upsert, and the patch is a fixed constant. So the "scope-defeating three" do not apply.
- **`AllAccounts` in the name**, the context first and required, and logs with `{ correlationId, adminUserId, queue, itemId, from, outcome }` only. The owner id is not logged.
- **Never throws:** it returns `{ data, error }`.
- **Single source (C7-9):** the "from" set and the in-progress status are **imported** from `lib/admin/jobs/queueItemEligibility.ts`, never copied. The table map is local, because importing `ADMIN_QUEUE_SPECS` would name `AdminJobsQueuesRepository` and trip that repository's isolation guard. A test pins the local map equal to `ADMIN_QUEUE_SPECS[q].table` (OP-8). The queue type is `BosQueueId` (`import type` from `lib/cron/bosCronJobs`), which 7a pinned set-equal to `AdminQueueId`.
- **Only permitted caller:** `app/api/admin/jobs-queues/items/action/route.ts`. A source guard enforces this (§5.9). It is exported from the barrel with a comment, as `AdminJobsQueuesRepository` is (`new-repository` Step 4). The guard exempts the barrel and tests.
- **7c** adds `retryQueueItemAllAccounts` beside it, under its own review.

### 2.4 Wire types (`lib/admin/jobs/jobsQueuesTypes.ts`, types only)

- `QueueItemAction = 'cancel'`, so 7c only widens the union.
- `QueueItemActionRequest = { queue; itemId; action; expected: { status; attempts }; reason }`.
- `QueueItemActionResult = { queue; itemId; action; before: { status; statusLabel }; after: { status; statusLabel } }`.
- `QueueItemActionRefusal = 'invalid_input' | 'not_cancellable_state' | 'leased' | 'item_not_found' | 'item_changed' | 'action_failed' | 'outcome_unknown'`.

### 2.5 Audit (C7-13, SA §G), and the timing decision (OP-1)

**Proposed: record actual changes only. The row is written after the winning CAS and before the response, not write-ahead.**

| | Write-ahead (the 7d precedent) | **After the win (proposed)** |
|---|---|---|
| What it protects against | Losing the record of an action the platform kills partway. Drain now runs up to 60 s, and a kill is likely on a backlog (W7D-1) | Recording a change that did not happen |
| How long the action runs here | — | One primary-key UPDATE, a few milliseconds. The kill window between "won" and "flushed" is that short |
| Lost CAS / double-click | Would leave a row saying "cancelled" for an item that was not, unless the event were renamed to "requested" and given a second outcome row | **No row** (SA §D.5), and a double-click gives **exactly one** update and **one** row, as the brief requires |
| Residual | — | If `logAndFlush` times out (2 s) and the instance freezes, the change is unaudited. Two traces remain: the Pino `info` line written immediately after the win, with `correlationId`, `queue`, `itemId` and `from`/`to`; and on the three non-payment tables the row itself carries `skip_reason = 'cancelled_by_admin'`. The same residual exists for every WC-7 write (entitlements, credit lots) |

The entry:

```typescript
await logAndFlush(
  {
    action: AUDIT_EVENTS.BOS_QUEUE_ITEM_CANCELLED,
    entityType: 'bos_queue_item',
    entityId: row.id,                 // the queue row's own uuid
    userId: row.userId,               // the item's account (§G; see OP-2)
    actorId: adminId,
    severity: 'warning',              // explicit: the writer's severity beats registration
    changes: { before: { status: row.status, attempts: row.attempts }, after: { status: target } },
    details: { reason, queue, action: 'cancel', correlationId, dueAnchor },   // dueAnchor = eligibility.anchorAt (ISO or null)
    request,
  },
  requestLogger,
  { reason: 'queue item cancel', continues: 'the cancel stands regardless' }
);
```

- **Never in the row:** `error_message`, `skip_reason`, payload, recommendation, contact, invoice, booking or rule ids, client or business names. The row is never mapped with a spread.
- **`deadLettered`, which §G lists, is omitted** (OP-10). On four tables it needs the `error_message` marker, which the item read does not select. `changes.before.status` already records `failed` or `dead_letter`.
- **Registrations:**
  - `events.ts`: the constant under the "BUSINESS OS QUEUES" block, with a comment. Metadata: `{ severity: 'warning', complianceFlags: ['SOC2'], description: 'An admin cancelled one Business OS queue item; it will not be sent' }`.
  - `eventAudience.ts`: `'bos'`.
  - `types.ts`: `'bos_queue_item'`, with a comment.
  - `ownerVisibility.ts`: `bos_queue_item: 'operator'` under OP-2 option 1, or `'owner'` under option 2, with a comment.
  - `filterOptions.ts`: **no edit**. The existing `BOS_QUEUE_` rule gives group "Business OS Queues" and label "Item Cancelled".
  - The `eventAudience.test.ts` size ratchet: **177 → 178, `bos` 32 → 33**, with a dated comment line (the accepted 7d deviation-1 precedent).

### 2.6 Owner visibility (F-1). Files that exist only under OP-2 option 1

This is a copy of the BD-26 package shape (`20261018`), with one literal added:

- `supabase/migrations/2026103X_audit_trail_owner_policy_hides_queue_items.sql`. **The number is to be agreed with RM**: SA §H puts the next free block at `20261035` or later.

  ```sql
  BEGIN;
  SET LOCAL lock_timeout = '5s';
  ALTER POLICY "Users can view their own audit logs" ON public.audit_trail
    USING (
      auth.uid() = user_id
      AND (entity_type IS NULL
           OR entity_type NOT IN ('ai_action', 'bos_queue_item', 'business_os_account_plan',
                                  'business_os_credit_lot', 'business_os_credit_period'))
    );
  COMMIT;
  ```

- `supabase/SQL Scripts/2026103X_..._rollback.sql`. This restores exactly the `20261018` USING expression. It is one transaction with one `ALTER POLICY`.
- `scripts/check-audit-owner-policy-migration.sql`. Its C03 hidden-type list gains `bos_queue_item`. It stays read-only.
- `supabase/migrations/__tests__/audit-owner-policy-hides-queue-items.migration.test.ts` (new, modelled on the BD-26 test). It checks:
  - one transaction with a lock timeout;
  - one `ALTER POLICY` by name;
  - the `NOT IN` list equals `OWNER_HIDDEN_ENTITY_TYPES`;
  - the rollback restores `20261018`;
  - SQL-editor safety.
- `supabase/migrations/__tests__/audit-owner-policy-hides-admin-entries.migration.test.ts`. Its "hides the registry set" case is changed to pin **`20261018`'s own frozen four-type list**. A superseded migration must not follow the live registry: the latest migration does that, through `ownerVisibility.test.ts`.

**Apply order:** the user applies the migration **before** 7b is deployed. If it is applied first, it hides a type nobody writes yet, which is harmless. If 7b is deployed first, the app reads already hide the rows, but an owner could read their own `bos_queue_item` rows through a direct REST call with their session until the migration lands.

### 2.7 UI

**New `app/admin/components/jobs/CancelQueueItemDialog.tsx`** (`'use client'`). The new POST lives here and nowhere else.

**Props:**
- `queueId: BosQueueId` (`import type`);
- `queueLabel`;
- `item: Pick<QueueItemView, 'id' | 'status' | 'statusLabel' | 'attempts' | 'kindLabel' | 'businessName' | 'lease'>`;
- `onChanged: () => void`.

**Trigger (in the row):** a small **"Cancel item"** button. The panel renders it only when `item.cancel.allowed`.

**Wording (the "Cancel" ambiguity):**
- The action is always **"Cancel item"**: the trigger, and the confirm button.
- The dismiss button is **"Close"**, never "Cancel".
- While busy, the confirm button reads **"Cancelling…"**.
- After a result, Confirm is hidden and only "Close" remains (the 7d deviation-3 precedent).

**Title:** "Cancel this item?"

**Description:** "{kindLabel} for {businessName} · item {first 8 characters of id} · {statusLabel}". This is fixed data from the list.

**Body (fixed text):**
- "Cancelling closes this item for good. The queue will never pick it up or send it, and it cannot be re-sent afterwards."
- Per queue, "what happens next" (§1.3):
  - **reminders:** "The invoice is not changed. If it stays unpaid, a later reminder can still be scheduled under the business's reminder settings."
  - **automations:** "The automation rule is not changed; later events can still queue new runs."
  - **briefing:** "No briefing goes to this business for that day. Other days are not affected."
  - **lead replies:** "This message is not queued again for the same lead."
  - **insight actions:** "The same action is not queued again in the same period."
- For an orphaned in-progress row (`lease === 'none'`): "No run holds this item (no claim was recorded), so closing it is safe."
- "The business is not told. Your reason is kept in the admin audit trail." This is true under Q-SA7-1's default and OP-2 option 1. Under option 2 the second sentence still holds.

**Reason:**
- a required text input labelled "Why are you cancelling this item? (at least 3 characters)";
- `maxLength={500}`;
- the hint "Don't paste client details.";
- Confirm stays disabled until `reason.trim().length >= 3`.

**POST:** `fetch('/api/admin/jobs-queues/items/action', { method: 'POST', headers, body: JSON.stringify({ queue: queueId, itemId: item.id, action: 'cancel', expected: { status: item.status, attempts: item.attempts }, reason: reason.trim() }) })`. No other field.

**While in flight:**
- the confirm button is disabled and `aria-busy`;
- Escape, a click outside and Close all do nothing;
- a double-click sends **one** request.

**Outcomes.** Each is a fixed sentence. Server `error` and `details` text are never rendered.

| Response | Sentence | Refresh |
|---|---|---|
| 200 | "Cancelled. The queue will not send it." (W7B-7) | yes, on Close (D-1) |
| 409 `item_changed` | "This item changed since the list was loaded (it is now {current.statusLabel}). Nothing was cancelled." | yes, on Close (D-1) |
| 404 | "This item is no longer in this queue. Nothing was cancelled." | yes, on Close (D-1) |
| 422 `leased` | "A run has picked this item up, so it cannot be cancelled now." | yes, on Close (D-1) |
| 422 `not_cancellable_state` | "This item can no longer be cancelled." | yes, on Close (D-1) |
| 400 | "This request was not accepted. Nothing was cancelled. Close this and try again." (SA code review suggestion; QA note 1: the reason field is hidden once an outcome shows) | no |
| 401/403 | "Your admin session has ended. Sign in again." | no |
| 500 `action_failed` | "Could not read the item just now. Nothing was cancelled." (SA code review suggestion: the route answers it only when this request wrote nothing) | yes, on Close (a lost race may have moved the item) |
| any other 500, a non-JSON body or a rejected fetch | "The request did not complete, so the item may or may not have been cancelled. The list refreshes when you close this; check its status there." (D-1) | yes, on Close (D-1) |

`current.statusLabel` is used only if it is a string in `QUEUE_ITEM_STATUS_LABELS`' values, mirrored client-side as a type-only check of the shape. Otherwise the sentence drops the parenthesis.

**Logging:** `createLogger({ module: 'AdminCancelQueueItemDialog' })`, with `{ queue, status, kind }` on a non-2xx and `{ err, queue }` on a rejected fetch. No reason, item id or body is logged.

**Styles (D-4):** `DARK_DIALOG` and the same footer button classes as `DrainNowDialog` and `ArchiveConfirmDialog`. The confirm button is `bg-sky-600`; the problem text is `text-red-300`. No green and no new colour.

**`QueueItemsPanel.tsx`:**
- It gains `onChanged: () => void`.
- The "Cancellable" cell renders `{item.cancel.allowed ? <CancelQueueItemDialog … onChanged={onChanged} /> : cancellableWords(item)}`. The 7a "yes" text is replaced by the button.
- The header line becomes: "Items marked cancellable can be closed from their row; re-sending comes in a later release. Failed items keep no failure time, so their age is counted {anchor}." It has no capital-C "Cancel" word, which keeps the panel guard unchanged on that rule.
- Its one `fetch(` (the GET) and its three `<button` elements are unchanged.

**`JobsQueuesView.tsx`:**
- `QueueCard` passes `onChanged={onDrained}` (the existing `load` callback) to the panel. After an action the card figures and the open list both reload (FR-Q7), through the existing `refreshKey`. The list returns to page 1 (W7A-2 behaviour).
- The header sentence becomes **"Each queue has a Drain now button, and a waiting, failed or orphaned item can be cancelled from its queue's list; everything else here is read-only."** The old sentence ("everything else here is read-only") would be false after 7b (the §8 Honesty NFR).

**`page.tsx`:** comment only ("read-only apart from Drain now and cancelling one item").

### 2.8 Guard amendments (OP-3 style, exactly)

**In `app/admin/__tests__/jobsQueues.source.guard.test.ts`:**
- **`page.tsx`:** every rule is unchanged (no Drain, no fetch).
- **`JobsQueuesView.tsx`:** every rule is unchanged, except that `VIEW_HEADER_SENTENCE` becomes the new sentence. It still says "Drain" exactly once, has no capital-C "Cancel", no POST and exactly one `fetch(` (the jobs GET).
- **`QueueItemsPanel.tsx`** stays in `FILES` with **every** read-only rule: no `Retry|Requeue|Cancel|Drain` word, no write method, no console, no `OK`, one GET, the three `<button` elements, and no `onClick` in a `<td>`. **One counted allowance:** exactly one `<CancelQueueItemDialog\b` element, which must be the conditional branch `item.cancel.allowed ?` inside the last `<td>`. The identifier does not match `\bCancel\b`; the test asserts this explicitly, so the allowance is a decision, not a regex accident.
- **New `CancelQueueItemDialog.tsx`** joins `CLIENT_FILES` (client component, C-21 type-only imports, no console, no `OK`), plus:
  - exactly one `method: 'POST'`;
  - exactly one `fetch(`, whose first argument is the literal `'/api/admin/jobs-queues/items/action'`;
  - exactly one `JSON.stringify(`, matching the body shape in §2.7 (queue, itemId, action `'cancel'`, expected status and attempts, trimmed reason) and nothing else, so no `userId` or `accountId` can be added;
  - no `Retry`, `Requeue` or `Drain`;
  - no green class;
  - the word "Cancel" is allowed in this file only.
- **`DrainNowDialog.tsx`:** unchanged, with all its 7d pins.

**In `app/admin/__tests__/jobsQueues.items.render.test.tsx`:** W7A-10's exact-button case becomes "the four tabs, then one **Cancel item** per cancellable row, then Previous and Next". The case-insensitive "no action words" sweep allows exactly the text "Cancel item". `td button` equals the number of cancellable rows, and there is no `td a` or `td input`.

**Unchanged:**
- `jobsQueues.render.test.tsx`: panels are closed, so it stays at 1 + 5 + 5 buttons.
- `drain.source.guard.test.ts`: the W7D-5 walk stays green, because the new route imports no service.
- `AdminJobsQueuesRepository` isolation guard: the new caller is under `app/api/admin/**`.
- `readJobsQueues` C-6 list: no new `lib/admin` module.

---

## 3. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/api/admin/jobs-queues/items/action/route.ts` | create | The action route, cancel only (C7-14) |
| `lib/repositories/AdminQueueActionsRepository.ts` | create | The CAS write (C7-3, C7-6, C7-12) |
| `lib/repositories/AdminJobsQueuesRepository.ts` | modify | `readQueueItemAllAccounts`; header sentence |
| `lib/repositories/index.ts` | modify | Barrel export of the new repository, with the "only caller" comment |
| `lib/admin/jobs/jobsQueuesTypes.ts` | modify | Action wire types (types only) |
| `lib/admin/jobs/buildQueueItemsView.ts` | modify (OP-11) | Three lead-reply kind labels (F-2) |
| `app/admin/components/jobs/CancelQueueItemDialog.tsx` | create | Trigger, confirm dialog, reason, outcomes |
| `app/admin/components/jobs/QueueItemsPanel.tsx` | modify | Trigger in the Cancellable cell, `onChanged`, header line |
| `app/admin/components/jobs/JobsQueuesView.tsx` | modify | Pass `onChanged`; honest header sentence |
| `app/admin/jobs-queues/page.tsx` | modify | Comment only |
| `lib/audit/events.ts` | modify | `BOS_QUEUE_ITEM_CANCELLED` and its metadata |
| `lib/audit/eventAudience.ts` | modify | `'bos'` |
| `lib/audit/types.ts` | modify | `'bos_queue_item'` |
| `lib/audit/ownerVisibility.ts` | modify | `bos_queue_item` classification (OP-2) |
| `supabase/migrations/2026103X_audit_trail_owner_policy_hides_queue_items.sql` | create (OP-2 option 1 only) | Owner policy hides the new type |
| `supabase/SQL Scripts/2026103X_audit_trail_owner_policy_hides_queue_items_rollback.sql` | create (option 1 only) | Restores `20261018` |
| `scripts/check-audit-owner-policy-migration.sql` | modify (option 1 only) | C03 hidden list gains `bos_queue_item` |
| `supabase/migrations/__tests__/audit-owner-policy-hides-queue-items.migration.test.ts` | create (option 1 only) | Migration, rollback and checker pins |
| `supabase/migrations/__tests__/audit-owner-policy-hides-admin-entries.migration.test.ts` | modify (option 1 only) | Pin `20261018`'s own frozen list, not the registry |
| `app/api/admin/jobs-queues/items/action/__tests__/route.test.ts` | create | §5.1–§5.8 |
| `lib/repositories/__tests__/AdminQueueActionsRepository.test.ts` | create | §5.9: methods, CAS shape, isolation guard, source pins |
| `lib/repositories/__tests__/AdminJobsQueuesRepository.items.test.ts` | modify | `readQueueItemAllAccounts` cases |
| `app/admin/__tests__/jobsQueues.cancel.render.test.tsx` | create | §5.10 |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts` | modify | §2.8 |
| `app/admin/__tests__/jobsQueues.items.render.test.tsx` | modify | §2.8; new kind labels |
| `lib/admin/jobs/__tests__/buildQueueItemsView.test.ts` | modify (OP-11) | Three labels |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | modify | One case, 58 → 59 |
| `lib/audit/__tests__/eventAudience.test.ts` | modify | Size ratchet 177 → 178, `bos` 32 → 33 |
| `lib/audit/__tests__/ownerVisibility.test.ts` | modify | `bos_queue_item` classified; under option 1 the "latest migration" floor moves to the new number |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify (targeted edits) | Row 93; census 90 = 84 + 6 + 0, 61 files; headline, "What is true", register heading and summary line updated in place (CR7D-1, W7A-11); Change History |
| `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7B_WORKPLAN.md` | create | This file |

**Explicitly not touched:**
- the five cron routes, the five service files, and the five queue repositories;
- `lib/cron/*` and `vercel.json`;
- the claim and reaper RPCs and every other migration;
- `DrainNowDialog.tsx` and the drain route;
- `queueItemEligibility.ts`, which is imported unchanged;
- `filterOptions.ts`;
- `BusinessProfileRepository.ts`;
- the admin authz guard and its `CAPS`;
- the requirement doc (SA edits it);
- `app/api/business-os/leads/[id]/route.ts` (BL-7a).

No change to any send path.

---

## 4. Task List

**SA conditions carried in:** C7-1, C7-2, C7-3, C7-6, C7-9, C7-12, C7-13, C7-14, C7-15, C7-16 (cancel). SA's workplan review governs where it differs.

- [x] ✅ **T1** Confirm the branch (`feature/admin-queue-cancel`) and the base. Re-count `console.*` in every file marked "modify" (expected 0). Re-measure the census with the guard's own scanner (expected 60 / 89 = 83 + 6 + 0 before).
- [x] ✅ **T2** Tests first for the two repository methods (§5.9, R-1..R-14), the route (§5.1–§5.8) and the dialog (§5.10). Run them red and record the counts.
- [x] ✅ **T3** `AdminJobsQueuesRepository.readQueueItemAllAccounts`, then green.
- [x] ✅ **T4** `AdminQueueActionsRepository` (constants, the CAS, the refusals, the logs, the service-role comment) and the barrel export, then green. Then the isolation and source guards.
- [x] ✅ **T5** Audit registrations (§2.5), including `ownerVisibility.ts` per SA's OP-2 ruling. Run `lib/audit` and `app/admin/audit-trail` with only the size ratchet edited.
- [x] ✅ **T6** *(OP-2 option 1 only)* The owner-policy migration package (§2.6), with the number agreed with RM before the file is created. Freeze the `20261018` test's list.
- [x] ✅ **T7** Wire types (§2.4).
- [x] ✅ **T8** The route (§2.1), then green.
- [x] ✅ **T9** `adminGate.writes.test.ts`: import the route and add one case with a valid body. Set `CASES` to 59 and extend the count comment. Then run `npm run test:authz-guard`.
- [x] ✅ **T10** `CancelQueueItemDialog.tsx`, then the panel, view and page edits (§2.7).
- [x] ✅ **T11** Guard and render amendments (§2.8), and the new dialog render suite.
- [x] ✅ **T12** *(OP-11)* The three lead-reply kind labels, plus the builder and render tests.
- [x] ✅ **T13** Access doc: row 93; census note "89 → 90 (2026-10-0x)" re-measured from disk; headline, "What is true", register heading "(90)" and its summary line ("84 … 6 … 0 open", "93 rows, 90 live") updated in place; a Change History row.
- [x] ✅ **T14** Write the live-probe script and the constraint SQL to `scratchpad/dev7b/` (never committed), for SA or the user to run (§6). Record nothing about live data myself: I have no database access.
- [x] ✅ **T15** Local runs:
  - the new and amended suites;
  - `npx jest app/admin app/api/admin lib/admin lib/repositories lib/audit supabase/migrations/__tests__`;
  - `npm run test:authz-guard`;
  - scoped `tsc` (scratch tsconfig, `NODE_OPTIONS=--max-old-space-size=8192`, checking the exit code);
  - ESLint on the touched files;
  - `npm run lint:hooks`.

  Record the counts. The known pre-existing red (`runRecord.adoption` › payment-reminders) is not this slice's.
- [x] ✅ **T16** Mutation proofs on scratch copies, never the worktree (§5.11). Then `git diff --stat`: no deletion-only file (the agent file-write hazard). Update Status and add Implementation Notes. Commit nothing.

---

## 5. Test Plan

All Jest. Mocks:
- `@/lib/auth`;
- `AdminAccessService`;
- `@/lib/logger` (records every call);
- `@/lib/audit/boundedAuditFlush` (records order; its promise is resolvable by the test);
- the two repositories, as factory mocks in the route suite;
- a recording Supabase client in the repository suites.

The route suite models the row as **mutable state**: the mocked read returns the current row; the mocked CAS applies the patch only if its predicates match that state and returns `count` accordingly. So the concurrency and double-click cases exercise real compare-and-set semantics, not canned answers.

### 5.1 Gate (`route.test.ts`)

| # | Case | Expect |
|---|---|---|
| G-1 | Signed out | 401. `request.json` is never called. No repository call and no `logAndFlush` |
| G-2 | Signed in, not an admin | 403, and the same "nothing called" assertions |
| G-3 | Admin check throws | 403, nothing called |
| G-4 | Auth lookup throws | 401, nothing called |
| G-5 | Invalid body and signed out | 401, not 400 |
| G-6 | Source position | Inside `POST`, `await requireAdmin(` is preceded only by the correlation-id read and `logger.child(…)` (W7D-3 regex) |

`adminGate.writes` repeats G-1..G-4 with its strict `mockTablesTouched` assertions, and "a real admin gets through" (the empty fake client gives a 404, not a 401 or 403).

### 5.2 Zod: 400, with nothing read (`route.test.ts`)

| # | Body | Expect |
|---|---|---|
| Z-1 | Unknown queue; unknown action; `action: 'retry'` (not in 7b) | 400 `invalid_input` each. Neither repository is called |
| Z-2 | `itemId` not a uuid; `expected` missing; `expected.attempts` −1, 1.5 or a string; `expected.status` `'PENDING'` or 40 characters | 400 each |
| Z-3 | Reason missing, `'  a '`, or 501 characters | 400 each |
| Z-4 | **Extra keys:** `userId`, `accountId`, `ownerUserId` at the top level, and `expected.userId` (strict at both levels) | 400 each. Neither repository is called |
| Z-5 | Not JSON; empty body | 400 |
| Z-6 | Reason `'  wrong client  '` | 200; audit `details.reason === 'wrong client'` |
| Z-7 | `details` present only when `NODE_ENV === 'development'` | Both modes |
| Z-8 | `QUEUE_ITEM_ACTIONS` set-equal to the `QueueItemAction` union (a type-level `satisfies` plus a runtime list check) | — |

### 5.3 Per-queue success (C7-6, C7-16 "a happy path per allowed action")

`it.each` over **every allowed cell**:
- `payment_reminders`: `pending`, `failed`, `failed` dead-lettered, and `processing` with `claimed_at` null;
- `payment_automations`: `pending`, `pending` with no `scheduled_at`, `failed`, `failed` guardrail, `dead_letter`, and `running` with `claimed_at` null;
- each of the three others: `pending`, `failed`, `failed` dead-lettered, and `processing` with `claimed_at` null.

Each case expects:
- **200** with `data` keys exactly `queue, itemId, action, before, after`;
- `after.status` is `cancelled` (payment tables) or `skipped` (the others);
- the CAS was called **once** with the patch equal to `ADMIN_QUEUE_CANCEL_PATCH[queue]`;
- `ownerUserId === row.userId`;
- `expected` equal to the row's status and attempts;
- the stored mock row now has that patch applied, **and `error_message` unchanged**.

### 5.4 Refused cells: the C7-1 negative tests, and C7-2

| # | Case | Expect |
|---|---|---|
| N-1 | For each queue, `expected.status` outside the Cancel column: reminders `sent`, `cancelled`; automations `completed`, `cancelled`; the three others `sent`, `skipped`; plus an unknown `'zzz'` on every queue | **422 `not_cancellable_state`. Neither repository is called** (the "from" check precedes the read) |
| N-2 | **Leased in-progress:** `processing` (or `running`) with `claimed_at` set, expected matching the row, on every queue. Covers both an expired lease (the Stuck tab) and a fresh one | **422 `leased`.** The CAS is **never called** |
| N-3 | **Leased in the write too:** the pre-check passes (the row was orphaned), then the stored row gains a `claimed_at` before the CAS | The CAS's `.is('claimed_at', null)` makes it miss → `count 0` → re-read → **409**. No audit row |
| N-4 | **Never to `pending`:** every patch in `ADMIN_QUEUE_CANCEL_PATCH` | `status` ∉ {`pending`, `processing`, `running`} (repository pin, R-3) |
| N-5 | **Finished between load and click:** expected `pending`, the stored row is `sent` (or `completed`, `skipped`, `cancelled`) | **409 `item_changed`** with `current.statusLabel` "Sent". The CAS is never called |
| N-6 | Retry is not offered in 7b | Z-1 (`'retry'` → 400) |

### 5.5 Stale `expected`, concurrency and double-click (§D.5, §9 double-send)

| # | Case | Expect |
|---|---|---|
| X-1 | **Stale attempts (ABA):** expected `pending`/0. The stored row is `pending`/1: claimed, then reaped back to `pending` | **409**. The CAS is not called. No audit row |
| X-2 | **Stale status:** expected `failed`, stored `skipped` (the owner or another admin closed it) | 409, and the current label is "Skipped" |
| X-3 | **A concurrent claim wins the race** (the §9 double-send test): the pre-check passes; the test's claim simulation flips the stored row to `processing`, `attempts + 1`, `claimed_at` set, between the read and the CAS | The CAS returns `count 0`, then a re-read, then **409** with "In progress". The CAS was called **exactly once** (no retry loop). No audit row. The stored row is still the claim's: the admin changed nothing |
| X-4 | Row deleted between read and CAS | count 0, re-read null → **404** |
| X-5 | **Double-click, sequential:** the same body POSTed twice | First 200, second **409** (pre-check: now `cancelled`/`skipped`). The CAS ran **once** and `logAndFlush` ran **once** |
| X-6 | **Two admins at once:** two bodies via `Promise.all`, both passing the pre-check before either CAS (the read mock awaits a shared gate) | Exactly **one 200 and one 409**. Exactly **one** applied patch and **one** audit row |
| X-7 | `count: null` (Prefer ignored) / `count: 2` / a PostgREST error from the CAS | **500 `outcome_unknown`**. An `error` log line with `queue`, `itemId` and `correlationId`. No audit row |
| X-8 | Read error or deadline time-out at step 3 or step 8 | 500 `action_failed`. No CAS after a failed first read |

What a unit test cannot prove is Postgres's real behaviour: the UPDATE waiting on a claim's row lock, then re-checking its WHERE under READ COMMITTED. That is SA's §D.1 argument. The live probe (§6.1) proves the PostgREST request shape. The lock argument rests on the claim RPCs' `FOR UPDATE SKIP LOCKED`, which the existing drain suites exercise.

### 5.6 Tenant isolation (`tenant-isolation-guard` Step 7)

| # | Case | Expect |
|---|---|---|
| T-1 | **The owner comes from the row:** the stored row's `user_id` is `OWNER-A` | The CAS receives `ownerUserId: 'OWNER-A'`. The recording client in R-5 shows `.eq('user_id', 'OWNER-A')` and `.eq('id', <itemId>)` |
| T-2 | An injected `userId` / `accountId` / `ownerUserId` in the body | 400 (Z-4). Nothing is read |
| T-3 | **The wrong queue for an id:** the id exists in `lead_responses` but the body says `insight_actions` | The read hits only `insight_actions` → **404**. The CAS is never called, and no other table is touched |
| T-4 | Unknown id | 404. The CAS is never called |
| T-5 | The patch is a constant | Even with a body carrying extra fields inside `expected` (rejected by Z-4), the repository's patch equals `ADMIN_QUEUE_CANCEL_PATCH[queue]` exactly. The route source never spreads the body (source pin) |

### 5.7 Audit (C7-13, §G, OP-1)

| # | Case | Expect |
|---|---|---|
| A-1 | Success on `lead_responses` | `logAndFlush` called **once**, with `action 'BOS_QUEUE_ITEM_CANCELLED'`, `entityType 'bos_queue_item'`, `entityId === row.id`, **`userId === row.userId`**, **`actorId === adminId`**, `severity 'warning'`, `changes` exactly `{ before: { status, attempts }, after: { status } }`, and `details` with exactly the keys `reason, queue, action, correlationId, dueAnchor` |
| A-2 | **Order** | The CAS resolves, then `logAndFlush` is called, then the response. The response is still pending while the `logAndFlush` promise is held (flushed before responding) |
| A-3 | `logAndFlush` "times out" (it resolves; it never rejects) | Still 200 |
| A-4 | **No audit row on any refusal:** 400, 401, 403, 404, 409 (pre-check and lost CAS), 422 (both codes), 500 | `logAndFlush` is never called with this event. The 409 and 422 cases are logged at `info` |
| A-5 | Registrations | Event in the catalogue with `warning` and SOC2; audience `bos`; entity type registered; `classifyAuditEvent('BOS_QUEUE_ITEM_CANCELLED')` gives `{ group: 'Business OS Queues', label: 'Item Cancelled' }`; `filterOptions.test.ts` and `filterOptions.guard.test.ts` pass unedited; `ownerVisibility.test.ts` passes (option 1: the new migration's list equals the registry) |
| A-6 | Reason never logged | No logger argument contains the reason string |

### 5.8 Privacy: sentinel and no leak (C7-13, §9)

`it.each` over the five queues. The mocked item read returns a row object that **also** carries `error_message: 'SENTINEL-ERR'`, `skip_reason: 'SENTINEL-SKIP'`, `payload: { to: 'sentinel@client.test' }`, `recommendation: 'SENTINEL-REC'`, `contact_id`, `invoice_id`, `booking_id` and `entity_id` of `'SENTINEL-…'`, `claimed_by: 'SENTINEL-RUNNER'`, and `timezone: 'SENTINEL/Zone'`. This simulates a client that returned more than was selected.

Expect, across the success, 409, 404 and 422 paths:
- the serialised response body contains no `SENTINEL`, no `@` and no `client.test`;
- nor does `JSON.stringify` of every logger call, or of every `logAndFlush` entry;
- the response never contains the owner's `user_id` (an `OWNER-SENTINEL` value);
- the CAS patch never contains `error_message`.

The repository layer (R-11) repeats the drop-unknown-fields check on `mapItemRow`.

### 5.9 Repositories (`AdminQueueActionsRepository.test.ts`; `AdminJobsQueuesRepository.items.test.ts`)

| # | Case |
|---|---|
| R-1 | `ADMIN_QUEUE_CANCEL_PATCH` equals the C7-6 table **exactly**, per queue (`toEqual`, five entries) |
| R-2 | `skip_reason` appears only in the three non-payment patches. The payment patches have exactly one key, `status` |
| R-3 | No patch sets `pending`, `processing` or `running`. No patch has `error_message`, `attempts`, `claimed_*`, `next_attempt_at`, `updated_at` or `user_id` |
| R-4 | `ADMIN_QUEUE_ACTION_TABLES[q] === ADMIN_QUEUE_SPECS[q].table` for every queue. Its keys are set-equal to `BOS_QUEUES` ids (OP-8) |
| R-5 | **The CAS chain, recorded:** `from(<table>)`, then `update(<patch>, { count: 'exact' })`, then `eq('id')`, `eq('user_id')`, `eq('status')`, `eq('attempts')`, in this order, with no `select`, no `or` and no `single`. For an in-progress `expected.status`, also `is('claimed_at', null)`; for `pending` and `failed`, not |
| R-6 | `count 1` → `{ outcome: 'cancelled' }`; `count 0` → `not_matched`; `count null` / `2` → an error with code `count_unconfirmed`; a PostgREST error → the error with its code; a thrown client → returned, not thrown |
| R-7 | **Refuses with no request:** missing context; unknown queue; `expected.status` outside `CANCEL_FROM_STATUSES[queue]`, for every queue (including `sent`, `completed`, `skipped`, `cancelled` and `pending` on a non-existent queue); attempts −1 or 1.5; an empty `itemId` or `ownerUserId` |
| R-8 | Logs: `info` with `{ correlationId, adminUserId, queue, itemId, from, outcome }` only. The `ownerUserId` value never appears in any log call |
| R-9 | **Isolation guard:** no file outside `app/api/admin/jobs-queues/items/action/route.ts` names `AdminQueueActionsRepository` / `adminQueueActionsRepository` (tests, the barrel and the file itself excepted). The tree walk is proven non-empty |
| R-10 | **Source pins on the repository file (comments stripped):** exactly one `.update(`; `count: 'exact'` present; **no** `.or(`, `.select(`, `.insert(`, `.upsert(`, `.delete(`, `.rpc(`, `error_message` or `...input`. `CANCEL_FROM_STATUSES` and `IN_PROGRESS_STATUS` are imported from `@/lib/admin/jobs/queueItemEligibility` and not redeclared |
| R-11 | `readQueueItemAllAccounts`: the exact column list per queue; `.eq('id')` plus `.limit(1)`; no `single`; found → a mapped `RawQueueItem`; `[]` → `null`; malformed → error; unknown queue or missing context → no request; abort signal passed; sentinel extra fields not in the result |
| R-12 | `readQueueItemAllAccounts` never selects `error_message` or `skip_reason` (the existing "only inside filters" pin covers the new method) |
| R-13 | The figures read stays pinned to `ADMIN_QUEUE_FIGURE_COLUMNS`, and `ADMIN_QUEUE_SELECTABLE_COLUMNS` is unchanged: no new column |
| R-14 | The `AdminJobsQueuesRepository` file still contains no `.update(`, `.insert(`, `.upsert(` or `.delete(` (its header's promise) |

### 5.10 UI (`jobsQueues.cancel.render.test.tsx`, plus the amended suites)

| # | Case | Expect |
|---|---|---|
| U-1 | Panel with three rows: cancel allowed, `leased`, `not_cancellable_state` | Exactly one "Cancel item" button, in the allowed row's Cancellable cell. The other two show the 7a words. The Retry and Re-send cells are unchanged |
| U-2 | Open the dialog | Title, kind, business, 8-character id and status are shown. The "never sent" sentence and the per-queue "what happens next" line are shown (each queue, `it.each`). The orphan line appears only for `lease === 'none'`. Confirm ("Cancel item") is disabled. The dismiss button reads "Close", and **no button in the dialog reads "Cancel"** |
| U-3 | Reason `'ab'` / `'  ab  '` → disabled; `'abc'` → enabled | — |
| U-4 | Confirm | `fetch('/api/admin/jobs-queues/items/action', { method: 'POST', … })` with a body of **exactly** `{ queue, itemId, action: 'cancel', expected: { status, attempts }, reason }`, from the row. While pending: "Cancelling…", disabled, `aria-busy`, and Escape, a click outside and Close do nothing |
| U-5 | **Double-click** on Confirm | One request |
| U-6 | 200 | "Cancelled. The queue will not send it." (W7B-7) Confirm hidden; "Close" shown. On Close, `onChanged` is called once, so the jobs GET and the items GET are both re-fetched (D-1) |
| U-7 | 409 with `current.statusLabel: 'In progress'` | The item-changed sentence with "(it is now In progress)". Refresh. An unexpected label value (`'<b>x</b>'`) is not rendered |
| U-8 | 404 / 422 `leased` / 422 `not_cancellable_state` | Each fixed sentence, with a refresh |
| U-9 | 400 / 401 / 403 | Fixed sentences, no refresh |
| U-10 | 500 with server text `'SENTINEL-ERR'`; a 504 with an HTML body; a rejected `fetch` | The unknown-outcome sentence and a refresh. `SENTINEL` never appears in `document.body` |
| U-11 | No green class in the dialog or the panel | — |
| U-12 | The view's header sentence is the new one; the 1 + 5 + 5 buttons with panels closed are unchanged | — |

### 5.11 Mutation proofs (T16, on scratch copies)

Each must turn named tests red:
1. drop `.eq('user_id', …)`;
2. take `ownerUserId` from the body;
3. drop `.eq('attempts', …)`;
4. drop `.is('claimed_at', null)`;
5. treat `count !== 0` as a win;
6. add `.select()`;
7. move the audit before the CAS;
8. skip the "from" check;
9. skip the eligibility call;
10. put `error_message: null` into a patch;
11. patch `status: 'pending'`;
12. render server `error` text in the dialog (and the old 200 sentence, W7B-7);
13. a "Cancel" dismiss label.

---

## 6. The Live PostgREST Probe and the Constraint Check

There is one database (production) and no branch database. Dev and QA have no database access. SA ran 7a's live checks from a scratch script with the service role. Both checks below are therefore **prepared by Dev/QA in `scratchpad/dev7b/` (never committed) and run once by SA or the user** on the final code, and their output goes into the QA report (OP-4).

### 6.1 The C7-3 probe: one zero-row UPDATE per table, through the real repository

**Goal:** prove on real PostgREST that the exact chain the code sends:
- is accepted (no 42703, no PGRST error);
- returns `count` as the number **0** for a no-match, not `null`;
- names only real columns in the patch and the filters.

`schema:check` does not cover `.update()` payloads (`business-os-schema-check`, "Blind spots"), so this is the only check of the patch columns.

**Script** (`scratchpad/dev7b/probe-cancel-cas.ts`, never committed; env read inside the script from the main checkout's `.env.local`):
- For each of the five queues, it calls the **real** `adminQueueActionsRepository.cancelQueueItemAllAccounts` with:
  - `itemId = crypto.randomUUID()`;
  - `ownerUserId = crypto.randomUUID()`;
  - `expected = { status: IN_PROGRESS_STATUS[queue], attempts: 99999 }` (inside the route's own Zod range, W7B-4 (b)). The in-progress status is the superset chain: it adds `.is('claimed_at', null)`.
- **Four independent "matches nothing" guarantees:**
  1. a fresh random primary key, confirmed absent first (below);
  2. a fresh random owner id;
  3. `attempts = 99999`. No row reaches that: the attempt limits are 3 to 5, and attempts only grow by one per claim;
  4. the in-progress status chain, which also requires `claimed_at IS NULL`.
- **Before each call**, it runs a read-only, **count-only** check: `select('id', { count: 'exact', head: true }).eq('id', itemId)`. Any count other than `0`, or any error, stops the script before the update. No row is returned by this read.
- **Expected per queue:** `{ data: { outcome: 'not_matched' }, error: null }`. The repository returns `not_matched` **only** for `count === 0`. A `null` count is an error (R-6), so this one result proves both "accepted" and "count is a number".
- **One negative control, raw client, `payment_reminders` only:** the same impossible filters with the patch `{ skip_reason: 'x' }`, a column that table does not have. Expected: **`PGRST204`** (PostgREST's "column not found in the schema cache", its answer for an unknown write-payload column; CR7B-1). **`42703`** (Postgres "undefined column") also passes. Either is raised while the request is planned, before any row is considered. This proves the probe would catch a wrong patch column.
- **It prints** only `queue`, `outcome` and the error **code**. No row, id or owner value.
- **It stops at the first failure:** after any result other than `not_matched`, no further table is touched.

**How the user runs it** (PowerShell, once, after SA's code review; never `npm install`). Use a **clean shell**: a fresh PowerShell window in which `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are **not** set. The script keeps a value already in the environment over `.env.local`, so a stray variable would point the probe at a different database (QA note 4).

```powershell
cd "C:\Users\Barak\My Projects\AgentsPilot\neuronforge-admin-queues"
.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.json "C:/Users/Barak/AppData/Local/Temp/claude/C--Users-Barak-My-Projects-AgentsPilot-neuronforge/13333d69-85f2-4f8a-8578-946d6a876a59/scratchpad/dev7b/probe-cancel-cas.ts"
```

`tsx.cmd` rather than `tsx`: in PowerShell, `node_modules\.bin\tsx` resolves to `tsx.ps1`, which the execution policy may block (CR7B-3).

**Expected output** (plus the repository's own Pino JSON lines, interleaved):

```text
payment_reminders      pre-read empty   outcome not_matched
payment_automations    pre-read empty   outcome not_matched
daily_briefing_sends   pre-read empty   outcome not_matched
lead_responses         pre-read empty   outcome not_matched
insight_actions        pre-read empty   outcome not_matched
control payment_reminders skip_reason   error PGRST204
PROBE PASS
```

`error 42703` on the control line also passes. Anything else: stop, change nothing, and send the output to Dev / SA.

**What it does not do:**
- it does not call the route, so no audit row is written and no admin session is needed;
- it does not use `.select()`;
- it changes no row: zero rows match, so no row trigger could fire, and none exists anyway (§1.2).

**Rejected alternative:** `Prefer: tx=rollback`. Supabase's PostgREST runs with `db-tx-end = commit`, which ignores that header. So it would offer false comfort.

### 6.2 Constraint and trigger confirmation (OP-3), read-only SQL in the Supabase SQL editor

```sql
SET default_transaction_read_only = on;

SELECT c.relname AS table_name, con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('payment_reminders', 'payment_automation_executions',
                    'daily_briefing_sends', 'lead_responses', 'insight_actions')
  AND con.contype = 'c'
ORDER BY 1, 2;

SELECT c.relname AS table_name, t.tgname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('payment_reminders', 'payment_automation_executions',
                    'daily_briefing_sends', 'lead_responses', 'insight_actions')
  AND NOT t.tgisinternal;
```

**Expected:**
- (a) `daily_briefing_sends`, `lead_responses` and `insight_actions` each have a status CHECK that includes `'skipped'`;
- (b) neither payment table has a CHECK on `status`, or any CHECK there allows `'cancelled'`;
- (c) no CHECK mentions `skip_reason`;
- (d) the trigger query returns **zero rows**.

Any other result stops the merge: the C7-6 targets would be rejected or would fire unexpected writes.

**Result (run by the user in the Supabase SQL editor, 2026-10-04, read-only session):** PASS on all four expectations.
- (a) `daily_briefing_sends_status_check`, `lead_responses_status_check` and `insight_actions_status_check` each allow `pending, processing, sent, skipped, failed`, so `skipped` is allowed.
- (b) Neither `payment_reminders` nor `payment_automation_executions` has any CHECK constraint, so `cancelled` is allowed.
- (c) No CHECK mentions `skip_reason`. The other CHECKs found are `insight_actions_kind_check`, `insight_actions_one_target` and `lead_responses_kind_check`, whose live list is `invite, chase, invoice_chase, intake_chase, meeting_reminder`; that confirms OP-11's five kinds.
- (d) The trigger query (with `pg_get_triggerdef`) returned **zero rows**.


---

## 7. Manual QA Check

On a preview or local build, as a platform admin. **Never cancel a real client's item to test this, and never seed, hand-edit or re-status a live queue row** (W7A-12). The only cancellable live rows are about 65 real waiting payment reminders (§1.3).

| # | Step | Expect |
|---|---|---|
| M-1 | `/admin/jobs-queues` | The header says Drain now and per-item cancel exist, and everything else is read-only |
| M-2 | Payment reminders → View items → Waiting | A "Cancel item" button in the Cancellable column of each cancellable row. No button on any other row |
| M-3 | Open one dialog, read it, press **Close** | Title, kind, business, short id, status, the "never sent" sentence and the reminders' "what happens next" line. Confirm is disabled until a reason of 3 or more characters. The dismiss button reads "Close". **Do not confirm** |
| M-4 | DevTools → open the dialog only | No request is made by opening it |
| M-5 | **Only if** the user names, in writing, a specific waiting item of their own test business that they genuinely want gone (W7B-5): cancel it with a reason | "Cancelled. The queue will not send it." On Close, the row leaves Waiting, and the card's figures refresh. `/admin/audit-trail` → "Business OS Queues" → "Item Cancelled" shows one row (the actor, `warning`, the business's account, the reason, the queue, the correlation id, before and after status). In DevTools, the 200 body has only `queue, itemId, action, before, after`. Otherwise **skip M-5**; it is covered by §5.3, §5.7 and the §6.1 probe |
| M-6 | Signed out, or as a non-admin: `curl -X POST <host>/api/admin/jobs-queues/items/action -H 'content-type: application/json' -d '{"queue":"insight_actions","itemId":"00000000-0000-4000-8000-000000000000","action":"cancel","expected":{"status":"pending","attempts":0},"reason":"abc"}'` | 401 or 403. No audit row except the 403 refusal record |
| M-7 | `git diff origin/main --stat -- app/api/cron lib/services lib/cron vercel.json supabase/migrations/2026-08-14_* supabase/migrations/20260911_* supabase/migrations/20260914_* supabase/migrations/20260917_*` | Empty |
| M-8 | Record the §6.1 probe and the §6.2 SQL output, run by SA or the user | 5 × `not_matched`, the control `42703`, the constraints as expected, zero triggers |

States not exercisable on live data (orphaned in-progress, failed, dead-lettered, any 409) are covered by §5 and recorded as "not exercisable on live data", as 7a did.

---

## 8. Acceptance Criteria Traceability

| Criterion | Where |
|---|---|
| FR-Q1 (cancel) per the §C matrix; each ❌ cell refused (§9 as amended, C7-1) | §2.1 steps 2–5, §5.3, §5.4 |
| C7-2: never a leased row, never to `pending`, never a finished row | §2.3 `.is('claimed_at', null)`, §5.4 N-2..N-5, R-3, R-5 |
| C7-3: one CAS, `count: 'exact'`, `count === 1`, no `.or()` + `.select()`, "from" check first, live probe | §2.1, §2.3, §5.5, R-5, R-6, R-10, §6.1 |
| FR-Q3: reason required; one audit row, flushed before the response | §2.5, §5.2 Z-3, §5.7 |
| FR-Q4 / §9 double-send: an action racing a claim never causes two sends | §5.5 X-3, X-5, X-6 |
| FR-Q5 / §9 no content in the page or the responses | §5.8, U-10, R-11 |
| FR-Q7: page and tiles refresh | §2.7 `onChanged`, U-6 |
| C7-6 cancel targets | §1.2, R-1, R-2, §6.2 |
| C7-9 one shared function | §2.1 step 5, §2.3 (imported), R-10 |
| C7-12 data access | §2.2, §2.3, R-9..R-14 |
| C7-13 privacy and dialog copy | §2.5, §2.7, §5.8 |
| C7-14 gate, correlationId, writes 58 → 59, row 93, no CAPS move | §1.6, §5.1, T9, T13 |
| C7-15 Pino, error format | §1.6, Z-7 |
| C7-16 (cancel): happy path per cell, CAS loss → 409, foreign id → 404, strict schema, audit shape and order | §5.3, X-3, T-3/T-4, Z-4, A-1/A-2 |
| tenant-isolation-guard | §2.3, §5.6 |
| CLAUDE.md Testing: happy + auth failure + invalid input; a repository test per method | §5.1–§5.3, §5.9 |

---

## 9. Risks and Rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| Cancel races a claim and the client still receives the message | Low | Single-statement CAS on `status` + `attempts` against `FOR UPDATE SKIP LOCKED` claims (§D.1). The loser is told (409). X-3, the §6.1 probe |
| **A runner that outlived its lease overwrites a cancel with `sent`** | Very low | Terminal writes are fenced by id only (B7-2). This is reachable only through the lead route's fire-and-forget drain (B7-11). It is pre-existing and accepted as BL-7a. The copy says "the queue will never pick it up", which stays true |
| An admin cancels the wrong item | Medium (human) | A confirm dialog naming the kind, business, short id and status; a required reason; an audit row. **There is no undo by design:** moving anything back to `pending` is forbidden (C7-2), and 7c's retry is limited to `failed` |
| The audit row is lost after a winning cancel | Very low | The Pino line right after the win (with `correlationId`); `skip_reason = 'cancelled_by_admin'` on three tables. The same residual as every WC-7 write (OP-1) |
| The owner reads the admin's reason | Medium without F-1 | OP-2 option 1, with the migration applied **before** deploy, or option 2 |
| A wrong patch column or PostgREST shape in production | Low | §6.1 probe, with a negative control; R-5/R-10 source pins |
| The CHECK on a table differs from its migration | Low | §6.2 before merge |
| The guard amendments weaken the read-only pins | Medium (process) | One counted allowance in the panel; the view only gets an honest sentence; one POST in one new file (§2.8); SA approves explicitly |
| Briefing card "Skipped, last 7 days (expected)" now includes admin cancels | Expected | Cancelling closes the row as `skipped` (C7-6). The audit row tells the two apart. Noted for the user |
| Payment-reminder cancels look like owner or settled cancels in the data | Expected | `payment_reminders` has no `skip_reason` (§A). The audit row is the record |

**Rollback:** one PR. Reverting it removes the route, the repository, the dialog and the registrations. Rows already cancelled **stay cancelled**, which is correct: they were terminal decisions, and no code path re-opens them. Their `BOS_QUEUE_ITEM_CANCELLED` rows stay in `audit_trail`. After a revert the event is unregistered, but the dropdown still finds unregistered events.

Under option 1:
- **leave the migration in place.** It only hides a type that no code writes after the revert, and owners must still not read the rows already written;
- run the rollback script only if the BD-26 owner policy itself has to go back to `20261018`;
- strike the access-doc row 93 in the same revert PR.

A UI-only partial revert (hiding the button) leaves the route admin-gated and unused, which is safe.

---

## 10. PR Body Draft

```markdown
## feat(admin): cancel one Business OS queue item (ADMIN_BOS_CLEANUP slice 7b)

### What changes
- `/admin/jobs-queues`: in a queue's item list, each cancellable row (waiting, failed or dead-lettered, or in progress with no claim recorded) gets a **Cancel item** button. A confirm dialog names the item, says it will never be sent and what happens next for that queue, and requires a reason (3–500 characters).
- New `POST /api/admin/jobs-queues/items/action` (`requireAdmin` first; strict Zod `{ queue, itemId, action: 'cancel', expected: { status, attempts }, reason }`; no account id accepted). Shaped so slice 7c can add `retry`.
- Cancel = one compare-and-set UPDATE: `id` + the row's own `user_id` (read on the server, never from the request) + the status and attempts the admin saw (+ `claimed_at IS NULL` for an orphaned in-progress row), sent as `.update(patch, { count: 'exact' })`; the action wins only on `count === 1`. Anything that moved in between → 409 "item changed", nothing written.
- Targets per queue: `cancelled` on the two payment tables; `skipped` + `skip_reason = 'cancelled_by_admin'` on the briefing, lead-reply and insight-action tables. `error_message` is kept.
- One `BOS_QUEUE_ITEM_CANCELLED` audit row per successful cancel (audience `bos`, severity `warning`, user = the item's account, actor = the admin; reason, queue, correlation id, before/after status), written after the update won and flushed before the response. No row for a refused or lost action.
- The dialog shows the outcome first; the page and the list refresh when it is closed.

### What it never does
- Never touches a leased in-progress item, never moves anything back to `pending`, never touches a sent/completed/skipped/cancelled item.
- Never sends, drains, or calls any service, cron or claim function.
- Never returns or logs content: no payload, error text, skip reason, client detail or account id.
- Never emits a payment event (`reminder.cancelled`), so no owner automation can start from an admin cancel (W7B-6).

### Owner visibility
- Migration `20261035_audit_trail_owner_policy_hides_queue_items.sql` adds `bos_queue_item` to the owner policy's hidden list, so the admin's reason is never readable by the business. Rollback script included; the shared read-only checker and the write probe now cover the fifth type.
- [ ] **The user has applied 20261035 and run `scripts/check-audit-owner-policy-migration.sql` (VERDICT PASS) and `scripts/probe-audit-owner-policy-migration.sql` (PROBE PASS, P01–P08 and P10). Do not merge before this is ticked** (merging deploys production, W7B-1 f).

### Verified live (read-only / zero-row)
- One zero-row compare-and-set per queue table through the real repository: accepted, `count = 0`; negative control PGRST204 (42703 also passes). *(Corrected 2026-10-04 in slice 7c, CR7B-1: this line said 42703.)*
- §6.2, run by the user 2026-10-04 (read-only): status CHECKs allow `skipped` on the three non-payment tables; no CHECK on either payment table; no `skip_reason` CHECK; zero triggers on the five tables.

### Registrations
- `adminGate.writes` 58 → 59; access register row 95 (after the rebase onto `7eac5b98`, where `main` already held rows 93 and 94); census 92 = 86 + 6 + 0, 63 files at merge; no guard cap moved. *(Corrected 2026-10-04 in slice 7c, CR7B-2: this line showed the pre-rebase row 93 and census 91 = 85 + 6 + 0, 62 files; the merged PR #211 body carried the right figures. Re-measured on `1a9944a5` with the guard's own scanner: 93 = 87 + 6 + 0, 64 files; the extra handler is `business-os/ai-activity/drill-down#GET` from PR #214, gated but not yet in the register.)*
- Event `BOS_QUEUE_ITEM_CANCELLED`, entity type `bos_queue_item` (group "Business OS Queues").

### Tests
Route (gate 401/403 with nothing read; Zod 400 incl. injected account ids; every allowed cell per queue; every refused cell; leased; stale status/attempts → 409; simulated concurrent claim → 409 with one update and no audit; double-click and two admins → one update, one audit row; audit shape and order; sentinel no-leak), repositories (CAS chain, refusals, isolation and source guards), dialog render, guard amendments (one counted allowance in the panel; one POST in the new dialog).

### Rollback
Revert the PR. Cancelled items stay cancelled (terminal by design). Leave the policy migration in place.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 11. Effort Estimate

| Part | Hours |
|---|---|
| T1 census and counts | 0.25 |
| T2–T3 tests first; item read | 1.5 |
| T4 actions repository, guards, barrel | 2.5 |
| T5 audit registrations | 0.5 |
| T6 owner-policy migration package (option 1 only) | 3.0 |
| T7 wire types | 0.25 |
| T8 route and route suite (mutable-state model) | 3.5 |
| T9 `adminGate.writes` and the authz guard | 0.5 |
| T10 dialog and panel/view wiring | 2.5 |
| T11 guard and render amendments, dialog suite | 2.0 |
| T12 kind labels (OP-11) | 0.25 |
| T13 access doc | 0.5 |
| T14 probe script and SQL | 0.5 |
| T15–T16 local runs, mutations, notes | 1.25 |
| **Total** | **about 18.5 h, about 2.3 days with option 1; about 15.5 h, about 1.9 days without T6.** SA estimated about 2 days; the difference is F-1 |

---

## 12. Open Points for SA

| # | Point | Dev default |
|---|---|---|
| **OP-1** | **Audit timing.** 7d writes ahead because a drain runs up to 60 s and a kill is likely. A cancel is one primary-key UPDATE of a few milliseconds. Writing ahead would record cancels that lost the race, or need a "requested" event plus an outcome. That contradicts §D.5 ("no audit row for a lost CAS") and the brief's "one update, one audit row" (§2.5) | **After the win, before the response, through `logAndFlush`.** Accept the residual: a timed-out flush on a freezing instance, with the Pino line and `skip_reason` as traces. This is the same as every WC-7 write |
| **OP-2** | **F-1: owner visibility of the audit row.** With `userId` = the item's account, BD-26 forces a choice. (1) `bos_queue_item: 'operator'` **plus a migration** that adds it to the owner policy's `NOT IN` list (`ownerVisibility.test.ts` requires the two to match). This contradicts §H's "no migration"; it needs a number ≥ `20261035` agreed with RM, and the user applies it by hand **before** deploy. (2) No migration: write the row with the **admin** as `userId` (the `bos_queue` / `archive_run` precedent), classify it `'owner'`, and lose the `user_id` link to the business. Writing it against the account and classifying it `'owner'` is not acceptable: the owner would read the admin's reason, against Q-SA7-1's default | **Option 1.** It keeps §G's account link, consistent with entitlement and credit-lot admin rows, which are `'operator'` for the same reason. If SA prefers no migration in 7b, option 2 is self-contained and T6 drops out |
| **OP-3** | **CHECK confirmation per table.** The migrations say: no CHECK on either payment table's `status` (stated deliberately in both `2026-08-14` files); the three others CHECK `('pending','processing','sent','skipped','failed')`; `skip_reason` is unconstrained TEXT. A zero-row probe cannot test a CHECK. §6.2 gives a read-only `pg_constraint` / `pg_trigger` query with the expected results | SA (or the user) runs §6.2 once before merge, and QA records the output. Any deviation stops the merge |
| **OP-4** | **The C7-3 live probe** (§6.1). Five zero-row UPDATEs through the real repository method, each matching nothing three ways (random id, random owner, an impossible attempts value), each read-confirmed empty first, plus one `42703` negative control. It runs against production because there is no other database. No route, no audit row, no `.select()`, and it prints codes only. QA prepares it; it needs someone with the service role | SA runs it once on the final code (as for 7a §A), and QA records the output in its report. Is three-way "matches nothing" enough on production, or does SA want a further guard? |
| **OP-5** | **Q-SA7-1 (notify the owner): unanswered, so the default "no" applies.** Nothing is built to notify. The dialog says "The business is not told." Under OP-2 option 1 the owner cannot read the audit row either. Their dashboards only show the item's new state (for example, a queued lead reply no longer listed as queued) | No notification. Revisit if the user answers yes |
| **OP-6** | **Payment-automation guardrail decisions** (status `failed` with a guardrail marker), deferred from 7a OP-5. They are cancellable under §C but excluded from the Failed tab, so the UI cannot reach them. They are terminal decisions that never run again (no claim takes `failed`), so cancelling one changes nothing a client receives, and the queue has no live producer and 0 rows | **No new tab in 7b.** Revisit when the automations queue has a producer. Likewise no "cancellable" filter tab (7a OP-6): every row carries its own button |
| **OP-7** | **Where the single-item read lives.** In `AdminJobsQueuesRepository` (C7-12: "reads extend" it; it reuses its column list and mapper and is already covered by its isolation guard), not in the new write repository | As proposed. That repository's "writes nothing" header stays true and is pinned (R-14) |
| **OP-8** | **The write repository's sources.** It imports `CANCEL_FROM_STATUSES` and `IN_PROGRESS_STATUS` from `lib/admin/jobs/queueItemEligibility.ts` (C7-9, a single source, so a repository imports a pure `lib/admin` module). It keeps its own queue → table map, pinned equal to `ADMIN_QUEUE_SPECS` by test, because importing that constant would name `AdminJobsQueuesRepository` and trip its isolation guard | As proposed |
| **OP-9** | **`count` that is neither 0 nor 1** (`null` if the Prefer header were ignored; `> 1` is impossible on a primary key). The route answers 500 `outcome_unknown` and logs at `error` with the ids, and writes no audit row, because it cannot say what happened. §6.1 proves `count` comes back as a number | As proposed |
| **OP-10** | **§G's `details` for cancel.** Included: `reason, queue, action, correlationId, dueAnchor` (the eligibility anchor, a timestamp). **Omitted: `deadLettered`.** On four tables it needs the `error_message` marker, which the item read does not select (C7-12). `changes.before.status` already shows `failed` / `dead_letter`. The alternative is one extra filter-only head count per action | Omit |
| **OP-11** | **F-2: stale lead-reply kind labels** (a 7a defect). `lead_responses.kind` also allows `invoice_chase`, `intake_chase` and `meeting_reminder` (`20260916`, `20260923`); 7a shows them as "Other", and the 7b dialog would too. Proposed labels: "Invoice chase to a client", "Intake form reminder", "Meeting reminder". SA §A's "CHECK ('invite','chase')" may want a dated correction | Fix in 7b: three labels plus tests |
| **OP-12** | **Manual QA on live data.** The only cancellable live rows are about 65 real waiting payment reminders. A live confirm would cancel a real client's reminder | QA does not confirm a cancel on live data. M-5 only if the user has their own test-business item to spare; otherwise the confirm path is proven by §5 and §6.1 |
| **OP-13** | **Wording.** "Cancel item" for the action; "Close" for dismissal. No "Cancel" button in the new dialog. `DrainNowDialog`'s existing "Cancel" dismiss button is left as is (its 7d guard requires the word); renaming it to "Close" is a one-line follow-up if SA wants consistency | As proposed |
| **OP-14** | **No domain event.** The owner's own reminder cancel emits `reminder.cancelled` (`PaymentReminderService.ts:879-884`), and so does the drain for a settled skip (`:1000`). That event feeds the payment event stream, which can trigger the owner's automation rules (`PaymentBuildingBlocks.ts:280` lists it as an emitted event). An admin cleanup action should not start owner automations. The cost: anything that listens for `reminder.cancelled` will not see an admin cancel | No `emitPaymentEvent` and no other event; the audit row is the record. If SA wants parity with the owner path, emitting it is a one-line addition, but it then needs a check of which rules it can fire |
| **OP-15** | **Guard amendment form** (§2.8). The panel keeps every read-only rule plus one counted `<CancelQueueItemDialog` allowance in the Cancellable cell. The view's header sentence changes to stay honest. The new dialog file owns one POST to one literal URL with a pinned body | Approve this narrow form |
| **OP-16** | **The `QUEUE_ITEM_ACTIONS` shape for 7c.** A `z.enum` over a const list, plus an exhaustive `switch` with an `assertNever`. 7c adds `'retry'` to the list and one `case`. The shared steps (gate, parse, "from" check, read, compare, eligibility, CAS, lost-CAS re-read, audit) are factored so retry plugs in its own "from" set, CAS and event | As proposed |
| **OP-17** | **Census and counts**, measured on `b1070558`: 60 / 89 = 83 + 6 + 0 before; **61 / 90 = 84 + 6 + 0, row 93, `adminGate.writes` 58 → 59** after (SA's ordering note); event catalogue 177 → 178 (`bos` 32 → 33) | T1 and T13 re-measure on the final base |

---

## Implementation Notes (Dev, 2026-10-04)

Implemented on `feature/admin-queue-cancel`, rebased onto `5b5d2f5c`, under W7B-1..W7B-14 and the user's decisions: UC-9 (OP-2 option 1), the W7B-7 wording, OP-11 (five kinds), OP-14 (pinned) and OP-12 (binding). Nothing is committed, migration 20261035 is not applied, and there was no database access of any kind.

### Re-measured on the rebased base (W7B-10)

| Figure | Workplan said | Measured on `5b5d2f5c` | After 7b |
|---|---|---|---|
| `adminGate.writes` CASES | 58 | 58 | **59** |
| Census (the authz guard's own `scanHandlers` + `stripComments`) | 60 / 89 = 83 + 6 + 0 | **61 / 90 = 84 + 6 + 0** | **62 / 91 = 85 + 6 + 0** |
| Register | last row 92, "(89)" | last row 92. `business-os/ai-activity#GET` (Gap B slice B1a, `077b3de2`) is on disk, gated, and **unregistered** | rows 93 (this route) and 94 (B1a, doc only), "(91)", "94 rows, 91 live" |
| Event catalogue | 177, `bos` 32 | 177, `bos` 32 | **178, `bos` 33** |
| `ownerAuditReads.guard` / `AuditTrailRepository` after #206 | — | The guard follows the registry and stayed green. **Four literal pins** of the hidden list (#206's data-export suites and `AuditTrailRepository.test.ts`) needed `bos_queue_item` | Updated in place, kept literal, each with a dated note |
| `console.*` in modified files | 0 | 0 | 0 (new files use Pino only) |

### Deviations

| # | What | Why |
|---|---|---|
| D-1 | **The dialog refreshes the page on Close, not immediately.** The 200, 409, 404, 422 and unknown outcomes show first. `onChanged` runs when the dialog is closed after any outcome that may have moved the item. The unknown-outcome sentence reads "The list refreshes when you close this; check its status there." instead of "The list has been refreshed". | The dialog lives in the item's own row. An immediate refresh usually drops that row (a cancelled item leaves Waiting), which unmounts the dialog before the admin reads the outcome, so the success sentence would never be seen. The copy changed so it stays true. **SA to confirm.** |
| D-2 | **Access register row 94** for `business-os/ai-activity#GET`, doc only. | The re-measure found it on `main`, gated but unregistered, so "N rows, N live, equal to the measured count" would otherwise be false. It can be dropped from this PR if TL prefers a separate doc fix. |
| D-3 | **Four existing literal pins updated** (`app/api/user/data-export/__tests__/route.test.ts`, `route.characterization.test.ts`, `lib/repositories/__tests__/userDataExportReads.test.ts`, `lib/repositories/__tests__/AuditTrailRepository.test.ts`), plus one `bos_queue_item` short-circuit case. | They hard-code the owner-hidden list on purpose, and the registry gained a type. They are not in §3's file list: they arrived with #206 or were not anticipated. |
| D-4 | `jobsQueues.items.render.test.tsx` gains `jest.setTimeout(20000)`. | Each cancellable row now renders a Radix dialog trigger, so the 50-row paging flows passed alone but exceeded the 5 s default in the wide run. This follows the 7d drain render suite (SA L-1). |
| D-5 | `QUEUE_ITEM_ACTIONS` lives in `buildQueueItemsView.ts`, beside `QUEUE_ITEM_QUEUE_IDS`, not in the route. `statusLabelFor` is added there too. | A Next.js `route.ts` may export only route fields. This is the same pattern as the queue id list (W7D-4). |
| D-6 | The probe's `bos_queue_item` check is numbered **P10**, not inserted among P01–P08. | Renumbering would move every existing pin and change the output the user already knows. P09 stays the live-row INFO line. |
| D-7 | Comment-only touches: the `lib/repositories/AuditTrailRepository.ts` and `lib/audit/ownerVisibility.ts` headers now name `bos_queue_item` and 20261035. The BD-26 paragraph of `docs/architecture/BUSINESS_OS_ENTITLEMENTS.md` gains the type (W7B-1 h), with a Change History row. | W7B-1 (h): every place that states the hidden list. |

### Verification

- **Tests first.** All 12 new or amended suites failed before any implementation: 44 failing tests, plus 3 suites that could not load the missing modules.
- **Wide set** (`app/admin app/api/admin lib/admin lib/repositories lib/audit supabase/migrations/__tests__ app/api/audit app/api/user/data-export`): **212 suites, 5,280 tests, all passed.**
- **Other suites.** `npm run test:bos-entitlements`: 165 suites, 3,969 tests, all passed. `npm run test:authz-guard`: 119 passed.
- **ESLint** on every touched file: 0 errors. All 6 warnings are on 2025 lines of `events.ts` and `types.ts`. `npm run lint:hooks`: clean.
- **Scoped tsc** (scratch tsconfig, `"include": []`, `NODE_OPTIONS=--max-old-space-size=8192`): 0 errors in any touched file. The 38 errors it reports are pre-existing, in 12 untouched files reached transitively.
- **Mutation proofs.** Each mutant is a scratch copy swapped in through a scratch Jest `moduleNameMapper` and an `fs.readFileSync` shim; no worktree file is written. Three no-change controls pass (165/165, 109/109 and 62/62). **All 22 mutants were killed**:

  | Mutant | Tests failed |
  |---|---|
  | drop `eq user_id` | 16 |
  | drop `eq attempts` | 16 |
  | drop `claimed_at IS NULL` | 5 |
  | `count !== 0` wins | 5 |
  | add `.select()` | 17 |
  | `error_message` in a patch | 6 |
  | patch to `pending` | 9 |
  | owner = the admin | 30 |
  | body accepts `ownerUserId` | 1 |
  | `expected` not strict | 2 |
  | audit before the CAS | 37 |
  | audit on a lost race | 5 |
  | no log line before the audit | 1 |
  | skip the "from" check | 15 |
  | skip eligibility | 5 |
  | skip the attempts compare | 1 |
  | `bos_queue_item` classified `'owner'` | 5 |
  | dialog renders server text | 2 |
  | unfiltered 409 label | 1 |
  | "Cancel" dismiss label | 1 |
  | old 200 sentence | 1 |
  | no double-click ref | 1 (killed after a same-tick double-click test was added) |

- **§6.1 probe:** `scratchpad/dev7b/probe-cancel-cas.ts`. **Not run** (W7B-4); type-checked only.

### SA code review fixes and rebase onto `7eac5b98` (Dev, 2026-10-04)

- **CR7B-2, rebase.** The uncommitted work was moved onto `origin/main` @ `7eac5b98` by patch (no stash, no commit): `git diff --binary` saved, tracked files restored, `merge --ff-only`, `git apply --3way`. Two files conflicted:
  - `lib/repositories/AuditTrailRepository.ts` header: B1b's text kept, 7b's queue-item clause and "then 20261035" added, B1b's closing line ("Only the admin exceptions above read AI entries.") kept;
  - `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`: `main`'s rows 93 (11c) and 94 (ai-activity) and its "89 → 91" note kept; this slice's own row 94 **dropped** (D-2); the cancel route is now **row 95**; a "91 → 92" note and a Change History row added on top of `main`'s.
  - `BUSINESS_OS_ENTITLEMENTS.md` and the requirement's Change History applied without conflict; both sides' content is present.
- **Re-measured on `7eac5b98` plus this slice** with the guard's own `scanHandlers` / `stripComments`: **92 handlers / 63 files = 86 `requireAdmin` + 6 inline + 0 open**. Headline, "What is true", register heading "(92)" and summary line ("95 rows, 92 live") updated in place (CR7D-1). `main`'s heading had read "(89)" and its summary line "93 rows, 90 live"; both are now correct. Pins unchanged: `adminGate.writes` **59**, event catalogue **178**. No new literal pin of the owner-hidden list on `main` (grepped the `5b5d2f5c..7eac5b98` diff).
- **CR7B-1.** The probe's negative control now passes on `PGRST204` (expected) or `42703`; the header's expected-output block says so.
- **CR7B-3 / QA notes 3 and 4.** §6.1 rewritten: `attempts` 99999, the count-only head pre-read, four guarantees, control `PGRST204` or `42703`, and the PowerShell run line `.\node_modules\.bin\tsx.cmd …` with a clean-shell note. The same run line is in the probe header and in QA's pre-merge item 4.
- **Dialog wording (SA's optional suggestions, QA note 1).** 400: "This request was not accepted. Nothing was cancelled. Close this and try again." A 500 `action_failed` has its own outcome: "Could not read the item just now. Nothing was cancelled.", with a refresh on Close (the route also answers `action_failed` when the re-read after a lost race fails, so the item may have moved). §2.7's table and the U-7..U-10 table are updated. QA notes 2 and 5 are left as documented.
- **Verification after the rebase:** slice and related suites 42 / 1,488 green (jobs-queues render, guard and route suites, the cancel route, both repositories, `lib/audit/**` incl. `ownerVisibility`, `ownerAuditReads.guard`, `eventAudience`, data export, `AuditTrailRepository`, migration tests 20261018 and 20261035, `adminGate.writes` 298 tests); `test:authz-guard` 119 / 119; `test:bos-entitlements` 173 / 4,273. ESLint on touched files: 0 errors, 6 warnings, all present on the base. Scoped tsc: the same 38 errors as before the rebase, all in untouched transitively imported files, none in a slice file. The §6.1 probe was **not run**.

## SA Review Notes

### SA Workplan Review (2026-10-04)

**Reviewed by SA — 2026-10-04**, on `feature/admin-queue-cancel` @ `b1070558`.
**Status:** ✅ **APPROVED WITH CONDITIONS (W7B-1..W7B-14).**
**Live database:** nothing was run. SA tried a read-only, counts-only check of the queue tables. This environment's permission policy refused it as a production read, so SA ran no further live query, the OP-4 probe included. OP-3 and OP-4 go to the user (W7B-3, W7B-4).

#### Verified by SA in code (all on `b1070558` unless stated)

| Claim | Result |
|---|---|
| `adminGate.writes` `CASES` is 58 | ✅ `app/api/admin/__tests__/adminGate.writes.test.ts:395` |
| Catalogue 177, `bos` 32 | ✅ `lib/audit/__tests__/eventAudience.test.ts:57-58` |
| Register: last row 92, heading "(89)" | ✅ `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md:133, 235` |
| `CANCEL_FROM_STATUSES`, `IN_PROGRESS_STATUS` and `cancelFor` match §C. Cancel does not depend on the clock | ✅ `lib/admin/jobs/queueItemEligibility.ts:68-82, 142-146` |
| `RawQueueItem` carries `userId`, `status`, `attempts`, `claimedAt` | ✅ `lib/repositories/AdminJobsQueuesRepository.ts:179-195` |
| `attempts` is `INT` on all five tables | ✅ the five claim migrations |
| F-2: `lead_responses.kind` allows five kinds | ✅ `20260916_lead_response_kinds.sql:45`, `20260923_meeting_reminder.sql:114`. 7a maps two |
| F-1: owner reads follow `OWNER_HIDDEN_ENTITY_TYPES` in code; the RLS list is a literal; `ownerVisibility.test.ts` ties them together | ✅ `lib/audit/ownerVisibility.ts`, `ownerVisibility.test.ts`. The data export on `origin/main` (after #206) still goes through `AuditTrailRepository` and the registry |
| The BD-26 package has **two** registry-coupled cases that option 1 turns red: "hides the registry set" (`:199`) **and** "checker and probe name every hidden type" (`:326`) | ⚠️ The workplan names only the first one → W7B-1 (d) |
| `reminder.cancelled` has consumers | ✅ `emitPaymentEvent` writes an owner-visible `payment_events` row and **enqueues automation reactions** for rules on that event (`PaymentEventService.ts:151-163`). No default rule uses it (`defaultPaymentRules.ts`), but an owner-built rule can → OP-14 |
| Migration `20261035` is free | ✅ No file ≥ `20261027` on `origin/main`, any remote branch, or any of the 20 worktrees. Reserved blocks per §H |
| `origin/main` has moved past the base | ⚠️ #201, #206 and #207. #206 changed `ownerAuditReads.guard.test.ts` and `AuditTrailRepository.ts` → W7B-10 |

#### Rulings on the open points

**OP-2: owner visibility. Ruling: Option 1.** The entity type `bos_queue_item` is `'operator'`, and the audit row keeps `userId` = **the item's account**. One owner-policy migration, `20261035`. §H is amended (requirement note, 2026-10-04).

Why:
1. **This is BD-26's own rule, applied as designed.** An admin operation on **one** account is written against that account and classified `'operator'`: plan ops (`business_os_account_plan`) and credit grants (`business_os_credit_lot`), with the internal reason. The admin's own id is used only where there is **no single account**: `bos_queue` (Drain now runs across every account) and `archive_run`. A cancel targets one account's item, so it is in the first group.
2. **Option 2 cannot identify the business without carrying an account id.** `entityId` is the queue row's id, and `details.queue` names its table. So the business can be derived only while that row exists. The Business OS data purge deletes queue rows with the account, and from then on the audit row could not say whose message was cancelled. Putting the account id into `details` instead would create an account reference that no RLS policy, purge, export or erasure rule knows about. That is worse than the `user_id` column the platform already governs. Option 2 would also drop the row out of the admin audit trail's per-account filter.
3. **The cost is small and paid once.** The migration is a one-literal copy of `20261018`, which is applied and verified. Slice 7c's `BOS_QUEUE_ITEM_RETRIED` uses the same entity type, so **7c needs no migration**.
4. **Writing against the account and classifying it `'owner'` is rejected**, as Dev says. It would show the admin's internal reason to the business, against Q-SA7-1's default and BD-26's purpose.

**Is it a business question?** **Not a new one.** It is Q-SA7-1 ("should the owner be told?"), which is unanswered, so its default (no) applies. Option 1 is how that default is implemented. If the user later answers yes, the answer is a **purpose-written notice** to the owner, never the admin's internal note. So option 1 does not foreclose it. Plain wording for the user is in W7B-1 (f).

**OP-1: audit after the winning update. Ruling: accepted.** 7d writes ahead because a drain runs up to 60 s, a kill is most likely exactly when Drain now is pressed, and its event is honestly named "started" (it records an intent whose outcome the platform may never learn). A cancel is the opposite case. It is **one atomic statement** whose outcome is known within milliseconds. §D.5 forbids an audit row for a lost compare-and-set, and "one update, one audit row" is the double-click invariant. Write-ahead would need a "requested" event plus an outcome row: two rows and a new pattern, to cover a few milliseconds. The residual (a 2 s flush time-out on an instance that then freezes) is the same as every WC-7 write. It keeps two traces: the Pino line, and `skip_reason` on three tables. W7B-2 fixes the order of those traces.

**OP-3: CHECK and trigger confirmation. Ruling: the user runs §6.2** in the Supabase SQL editor, **now**. It does not depend on the code. SA has no `pg_catalog` access: PostgREST does not expose it, and production reads are refused here. The expected results in §6.2 (a)–(d) are right, and any deviation stops the slice. §6.2 **must** come before the OP-4 probe. Its trigger query also lists **statement-level** triggers, and Postgres fires those on an UPDATE that matches **zero** rows. So "zero rows, so no trigger fires" holds only once §6.2 (d) has returned zero rows (W7B-3).

**OP-4: the live zero-row probe. Ruling: safe as designed, with the W7B-4 amendments. The user runs it once, on the final code, at the QA stage.**
- It cannot change a row. Each update needs:
  - a fresh random primary key, read-confirmed absent;
  - a fresh random owner id;
  - an `attempts` value no row reaches;
  - for the in-progress chain, `claimed_at IS NULL`.

  It has no `.select()`, does not go through the route, writes no audit row, and prints codes only.
- The 42703 negative control is rejected while PostgREST plans the request, before any row is read.
- SA cannot run it here (see the top note). SA would have run it only after §6.2, in any case.

**OP-9: `count` neither 0 nor 1. Ruling: accepted** (500 `outcome_unknown`, an `error` log line, no audit row). A PostgREST error means the transaction rolled back. A lost response after a commit is the only real "unknown". The dialog already says "may or may not", and the list refreshes.

**OP-11: kind labels. Ruling: fix in 7b**, with Dev's three labels. §A's "CHECK ('invite','chase')" gets a dated correction in the requirement.

**OP-12: QA must not cancel a live item. Ruling: binding** (W7B-5).

**OP-14: no `reminder.cancelled` event. Ruling: accepted, and pinned.** Emitting it would:
1. write an **owner-visible** `payment_events` row, which would tell the business through the back door, against Q-SA7-1's default;
2. **enqueue automation reactions** for any owner rule triggered by `reminder.cancelled` (`PaymentEventService.ts:162-163`). An admin's cleanup must not start the owner's automations.

No default rule listens to it, and the automation executor is a placeholder today (B7-3). So nothing the owner relies on breaks. The only cost is that a future listener will not see admin cancels; the audit row is the record. Pinned by W7B-6.

**OP-16: the action shape for 7c. Ruling: accepted**: a const list, `z.enum`, an exhaustive `switch` with `assertNever`. **Do not build ahead.** Factor out only the helpers 7b itself calls (gate, parse, read, compare, lost-CAS re-read, audit). Leave no `retry` stub, hook or option. `'retry'` stays a 400 in 7b (Z-1). 7c adds its own "from" set, CAS and event under its own review.

**The other points:**

| # | Ruling |
|---|---|
| OP-5 | Accepted: no notification (Q-SA7-1 default) |
| OP-6 | Accepted: no guardrail tab and no "cancellable" tab in 7b |
| OP-7 | Accepted: the single-item read lives in `AdminJobsQueuesRepository` (C7-12). R-14 keeps its "writes nothing" header true |
| OP-8 | Accepted: imports the constants from `queueItemEligibility.ts`, never copies them; a local table map pinned by R-4 |
| OP-10 | Accepted: `deadLettered` is omitted for cancel. §G is amended for cancel. 7c may not read `error_message` to get it either (C7-12); if 7c wants it, it uses a filter-only head count |
| OP-13 | Accepted. Renaming Drain's "Cancel" to "Close" is a later one-line follow-up, **not** in 7b (it would move 7d pins) |
| OP-15 | Accepted: the narrow guard form of §2.8, and the explicit `\bCancel\b` assertion |
| OP-17 | Verified (table above). Re-measure after W7B-10 |

#### Answers to the "also check" items

- **The compare-and-set** (§2.3) is exactly §D.1–D.2. It matches `id`, the row's own `user_id`, `status` and `attempts` (+ `claimed_at IS NULL` only for the in-progress status), and uses `.update(patch, { count: 'exact' })`. A win is `count === 1`. No `.or()`, no `.select()`. R-5, R-6 and R-10 pin it, and mutations 1, 3–6 prove the pins. ✅
- **On a loss:** one re-read, then 404 or 409, with no audit row and no second update (step 8, X-3, X-6). ✅
- **Before the write:** the "from" state is checked against the frozen set before any read (step 2), the row is compared with `expected` (step 4), and eligibility is checked with the real clock (step 5). The CAS then uses the **row's** values. ✅
- **Tenant isolation:** `ownerUserId` is only ever `row.userId`. A strict schema at both levels refuses `userId` / `accountId` / `ownerUserId` (Z-4, T-1..T-5). There is no trigger (to be proven by §6.2), no upsert, and the patch is a frozen constant. This meets `tenant-isolation-guard` Steps 2–4 and 7 under SA §F's admin ruling. ✅
- **The write repository's caller guard** (R-9) names one permitted route. The repository imports the eligibility constants (R-10). ✅ Plus W7B-6.
- **Residual BL-7a: 7b may ship before BL-7a.** The overwrite needs a runner that outlived its 90 s lease, and that is reachable only through the lead route's fire-and-forget drain (B7-11). In that case the old runner **has already sent** the message, so the cancel neither causes nor adds a send. It can only fail to stop a send already in flight, which no cancel could stop. Cancel strictly reduces sends. BL-7a matters for **7c** (retry puts rows back into play), and 7c's review will weigh it again. The one honesty fix is the 200 sentence (W7B-7).
- **The UI wording:** "Cancel item" for the action, "Close" to dismiss, "Cancelling…" while busy. Approved. The guard amendments are narrow and counted. Approved (OP-15).
- **Counts:** `adminGate` 58 → 59; census 61 files / 90 = 84 + 6 + 0; register row 93; catalogue 177 → 178 (`bos` 32 → 33). Confirmed against the as-built numbers. T1 and T13 re-measure after the rebase.

#### Conditions

1. **W7B-1 (OP-2, option 1): the owner-policy package.** Priority: High.
   - (a) `ownerVisibility.ts`: `bos_queue_item: 'operator'`, with a comment ("an admin's action on one account's queue item, with the internal reason; written against that account like `business_os_credit_lot`").
   - (b) Migration **`supabase/migrations/20261035_audit_trail_owner_policy_hides_queue_items.sql`**. Dev runs `ls supabase/migrations` after the rebase and records the number with RM before creating the file. It is one transaction, `SET LOCAL lock_timeout = '5s'`, and one `ALTER POLICY` by name. The `NOT IN` list is the **five** types, sorted. The `auth.uid() = user_id` scope and the `entity_type IS NULL` arm are unchanged.
   - (c) The rollback `supabase/SQL Scripts/20261035_…_rollback.sql` restores **exactly** the `20261018` USING expression.
   - (d) **Both** of the BD-26 helper scripts follow the live registry, because they check the current state, not one migration:
     - `scripts/check-audit-owner-policy-migration.sql`: C03 gains `bos_queue_item`, and C06's per-type counts gain a `bos_queue_item` count;
     - `scripts/probe-audit-owner-policy-migration.sql`: gains one tagged `bos_queue_item` row (a realistic action `BOS_QUEUE_ITEM_CANCELLED`, no severity) and a P-check "the owner cannot see the `bos_queue_item` row". Its service-role expected row count moves from 6 to 7.

     The `20261018` migration test keeps its case at `:326` ("checker and probe name every hidden type") **following the registry**. Only its `:199` migration-SQL case is frozen to `20261018`'s own four literals.
   - (e) The new migration test pins: one transaction with a lock timeout; one `ALTER POLICY` by name; the `NOT IN` list equal to `OWNER_HIDDEN_ENTITY_TYPES`; the rollback equal to `20261018`'s expression; SQL-editor safety (the BD-26 literal rules); and `20261035` used by exactly one file. In `ownerVisibility.test.ts`: `EXPECTED_HIDDEN` gains `bos_queue_item`, the floor moves to `20261035`, and the negative control keeps working.
   - (f) **Apply order: the user applies `20261035` and runs the checker (C01–C06 + VERDICT) and the probe to PASS before the PR merges.** Merging to `main` deploys production, so "before deploy" means before merge. RM does not merge until the user has confirmed this, and the PR body carries it as an unticked checkbox. In the meantime the app's owner reads already hide the type in code. The gap would be a direct REST read only.
   - (g) Wording for the user, in Q-SA7-1 terms: *"When an admin cancels one of a business's waiting messages, the business owner will not see that in their activity log, and will not see the admin's reason. They only notice that the message is no longer waiting. This needs one small database change that you apply by hand before the release, like the one for hidden credit grants."*
   - (h) Find any doc that states "the four hidden types" (`grep` `docs/` for the BD-26 list) and update it in place, with a dated note.
2. **W7B-2 (OP-1): the trace order on a win.** In this order:
   - the route logs `info` "Queue item cancelled" with `{ correlationId, adminUserId, queue, itemId, from, to }`, before awaiting `logAndFlush`, and never with the reason or the owner id;
   - then `await logAndFlush(…)`;
   - then the 200.

   A-2 also asserts that the log line comes before `logAndFlush`. Priority: Medium.
3. **W7B-3 (OP-3): §6.2 first, run by the user.** Add `pg_get_triggerdef(t.oid)` to the trigger query's output, so that a row-level and a statement-level trigger can be told apart. The user runs both queries now and pastes the output into this workplan. Expected: (a)–(d) as in §6.2. **Any trigger at all, row or statement, stops the slice** and comes back to SA, with no probe run. Priority: High.
4. **W7B-4 (OP-4): probe amendments.**
   - (a) Run it only after W7B-3 shows zero triggers.
   - (b) Use `attempts = 99999` as the impossible value. It is inside the route's own Zod range and far below the `INT` limit, so the probe sends a value the route itself could send.
   - (c) The pre-read uses `id` and is a `head`/count read. Stop at the first non-zero count or any error, and print only `empty` / the code.
   - (d) Run with the repo's existing `tsx` (`node_modules/.bin/tsx`). **Never `npm install`.** Env comes from the main checkout's `.env.local`, loaded in the script, and the file is never copied.
   - (e) The user runs it once, on the final code, after SA's code review. The output (5 × `not_matched`, the control `42703`) goes into the QA report (M-8).
   - (f) The script stays in the scratch folder and is never committed.

   Priority: High.
5. **W7B-5 (OP-12): no live cancel during QA.**
   - QA never presses Confirm on production data.
   - QA does not seed, edit or re-status a live queue row.
   - M-5 runs **only** if the user names, in writing, a specific item of their own test business. Otherwise M-5 is recorded as "not run (no expendable item)".
   - M-3 and M-4 (open the dialog, then Close) are allowed.

   Priority: High.
6. **W7B-6 (OP-14): pin "no domain event".** Add to R-10 and to the route source pin: no `emitPaymentEvent`, no `PaymentEventService`, no `lib/services/` import in the route or in `AdminQueueActionsRepository.ts`. The PR body's "What it never does" gains: "never emits a payment event (`reminder.cancelled`), so no owner automation can start from an admin cancel". Priority: Medium.
7. **W7B-7 (honesty, BL-7a edge):** the 200 sentence becomes **"Cancelled. The queue will not send it."** "It will not be sent" is false in the one BL-7a case where a run that outlived its lease is already sending. The body's "The queue will never pick it up or send it" stays. Update U-6 and §5.11 #12 accordingly. Priority: Low.
8. **W7B-8 (OP-16): no build-ahead for 7c.** No `retry` code path, stub or option in 7b. Shared helpers only as far as 7b uses them. Priority: Low.
9. **W7B-9 (OP-10):** the cancel `details` keys are exactly `reason, queue, action, correlationId, dueAnchor` (A-1). `deadLettered` is omitted, as amended in §G. Priority: Low.
10. **W7B-10: rebase first.** Before T2, bring the branch onto `origin/main`: currently #201, #206 and #207 past `b1070558`. #206 touched `ownerAuditReads.guard.test.ts` and `AuditTrailRepository.ts`. Use RM's usual method, with **no `git stash`** on a shared worktree; commit nothing (RM's call on mechanics). After W7B-1, re-run `lib/audit`, `app/api/audit`, `app/api/user/data-export` and `supabase/migrations/__tests__`. T1's census is measured on the rebased tree. Priority: Medium.
11. **W7B-11 (OP-11):** the three lead-reply labels as proposed. Their keys are pinned set-equal to the five kinds of the `20260923` CHECK by a test that reads the migration text, so the next new kind fails a test instead of showing "Other". Priority: Low.
12. **W7B-12: the effort line.** The plan is option 1, so take about 2.3 days plus about 0.25 days for W7B-1 (d) (the probe and checker extension). Priority: Low.
13. **W7B-13: the PR body** (§10). Remove the "[option 1]" brackets, because option 1 is decided. Add the W7B-1 (f) apply checkbox, the §6.2 output line, and the W7B-6 line. Priority: Low.
14. **W7B-14: carry-forward to the 7c review.** Not a 7b task. BL-7a weighs more heavily on retry, and 7c's review will rule on whether retry ships before it. Recorded so it is not lost.

#### Optimisation suggestions (non-blocking)

- Each new `'operator'` entity type costs one hand-applied policy migration. If a third admin-on-account type appears, consider a backlog item: a SQL function or a lookup table for the hidden list, so the policy stops carrying literals. That would be a new pattern under its own SA review; not now.
- The `adminGate.writes` case for the new route: the "real admin gets through" body should use a well-formed uuid and a valid `expected`, so the 404 comes from the empty fake client and not from Zod.

#### Approval

- [x] Workplan approved. **Proceed to implementation under W7B-1..W7B-14.** Before T2: W7B-10 (rebase). The user can run W7B-3 (§6.2) in parallel, now. The OP-4 probe runs after SA's code review. The migration is applied and verified before merge.

### SA Code Review (2026-10-04)

**Reviewed by SA — 2026-10-04**, uncommitted tree on `feature/admin-queue-cancel` (base `5b5d2f5c`). No database access, nothing committed, no worktree file changed except this section and one Change History row.
**Status:** 🔄 **APPROVED WITH CHANGES.** The code is approved for QA. CR7B-1 must be fixed **before the user runs the §6.1 probe**; CR7B-2 before the PR is opened; CR7B-3 is documentation.

#### Re-verified by SA (not taken from the Implementation Notes)

| Claim | SA result |
|---|---|
| Wide set (`app/admin app/api/admin lib/admin lib/repositories lib/audit supabase/migrations/__tests__ app/api/audit app/api/user/data-export`) | 212 suites, **5,286** tests (Dev: 5,280; QA is adding tests in this worktree in parallel). 1 failure in `app/admin/business-os-invites/__tests__/page.render.test.tsx`, a file 7b does not touch: a timeout under load; it passes alone (52/52) |
| The slice's 40 targeted suites | 1,370 / 1,370 |
| `npm run test:authz-guard` | ✅ 119 |
| `npm run test:bos-entitlements` | ✅ 165 suites, 3,969 |
| Scoped `tsc` (Dev's file list, copied to `scratchpad/sa7b`) | ✅ 38 errors, **none in a touched file** (all in untouched transitive files, e.g. `lib/audit/admin-helpers.ts`) |
| 22 mutants killed | Not re-run. SA checked that a pin exists for each mutant (R-5..R-10, X-1..X-8, A-1..A-4, T-1..T-5, U-4..U-6, OP-15 guard) |
| Untouched: cron routes, services, claim / reaper functions, `queueItemEligibility.ts`, `DrainNowDialog.tsx` | ✅ None is in `git status` |
| `console.*` in touched files | ✅ 0. The probe script's `console.log` is a scratch CLI, never committed |

#### The compare-and-set (`lib/repositories/AdminQueueActionsRepository.ts`) ✅

- One `.update({ ...FROZEN_PATCH }, { count: 'exact' })` on `id`, `user_id` (the row's own, `:157-160`), `status`, `attempts`, plus `.is('claimed_at', null)` only for the in-progress status (`:161-164`). No `.select()`, no `.or()` (R-10 pins both).
- `count === 1` → `cancelled`; `count === 0` → `not_matched`; `null`, `undefined`, `2`, `-1`, `1.5` or an error → an error (`:166-181`, R-6).
- Patches (`:57-63`): `cancelled` on the two payment tables; `skipped` + `skip_reason = 'cancelled_by_admin'` on the other three. `skip_reason` exists on those three tables (`20260911:105`, `20260914:78`, `20260917:75`). `error_message`, `attempts`, `claimed_at` and the owner are never written. No target is `pending`.
- A leased row cannot match: the route refuses it at step 5, and the write itself requires `claimed_at IS NULL` for the in-progress status. A finished row cannot match: the "from" set is checked again in the repository (`:137`), and `status` is in the filter.
- Single-caller guard (R-9): it walks `app lib components hooks scripts` and allows only the route (the barrel and tests are exempt). A barrel import elsewhere would still name the singleton and fail. The eligibility constants are imported, not copied (`:41`, R-10). No `lib/services` import, no payment event (W7B-6).

#### The route (`app/api/admin/jobs-queues/items/action/route.ts`) ✅

Order verified: `requireAdmin` first (`:121`); strict Zod at both levels (`:59-72`); the "from" check before any read (`:173`); the read under the 5 s deadline (`:182`); the expected-value compare → 409 (`:195`); eligibility with `new Date()` → 422 (`:201-216`); the CAS with the **row's** own owner, status and attempts (`:223-226`). On a loss: one re-read → 404 / 409, no second update, no audit (`:229-239`). Any other outcome → 500 `outcome_unknown`, logged at error (`:241-249`). A throw after the CAS was sent is `outcome_unknown`, never `action_failed` (`:284-287`). `logAndFlush` never throws (`boundedAuditFlush.ts` contract), so a won cancel cannot be reported as unknown.

The trace order on a win is: the Pino line (`:254`), then `await logAndFlush` (`:256`), then the 200. `details` holds exactly `reason, queue, action, correlationId, dueAnchor`: no `deadLettered`, error text, payload or `skip_reason` (A-1). `userId` is the item's account, `actorId` the admin, `severity: 'warning'`. `bos_queue_item` is `'operator'` (`ownerVisibility.ts`). The 409 body carries only a status word and its fixed label.

#### Migration 20261035 and the rollback ✅ (ready for the user to apply)

- `diff 20261018 20261035`: **one line differs**, the added `'bos_queue_item', ` literal. Both files are ASCII with CRLF line endings and no BOM.
- The rollback is **byte-identical** to `20261018` (an empty `diff`). It restores the expression that is live today.
- One transaction, `SET LOCAL lock_timeout = '5s'`, one `ALTER POLICY … USING`. With no `TO` clause, the roles and command are unchanged. No comments, and only `[A-Za-z0-9_ ]` inside literals, so it is safe to paste into the SQL editor. If the lock is not obtained in 5 s, the whole transaction rolls back and the policy is untouched.
- Number: no `2026102[7-9]` or `20261030+` file exists on `origin/main` (now at `7eac5b98`) or any remote branch. `20261035` is free.
- Checker: C03 gains the needle, so it **FAILs before apply** (a discriminating baseline) and passes after; C06 gains the count. Probe: one `bos_queue_item` row with a realistic action and no severity; P10; P08 expects 7 rows. Before apply, P10 **and** P06 FAIL, which is the expected baseline. The `20261018` test: the migration case is frozen to its four literals (`:209-217`); the checker and probe cases follow the registry (`:288-332`). The new test pins the one-literal difference and the rollback = `20261018`.
- **User order:** apply `20261035` → checker VERDICT PASS → probe PROBE PASS (P01–P08, P10; P09 INFO) → tick the PR checkbox → merge.

#### The live zero-row probe (`scratchpad/dev7b/probe-cancel-cas.ts`): ✅ safe, with one fix (CR7B-1)

It **cannot change a real row**:
- Each update requires a fresh random primary key, which a count-only `head` read confirms absent; any error or a non-zero count calls `process.exit(1)` before the update.
- It also requires a fresh random owner id, `attempts = 99999`, and the in-progress status with `claimed_at IS NULL`. Any one of these alone matches nothing.
- It goes through the real repository, so the patch is the frozen constant. It sends no `.select()`, does not use the route (so no audit row), and §6.2 found no trigger.
- It prints the queue, the outcome and an error code only. The env is read from the main checkout's `.env.local`, never copied, and limited to two names.
- The negative control is rejected before execution (see CR7B-1), so it changes nothing either.

#### Code review comments

1. **CR7B-1 — `scratchpad/dev7b/probe-cancel-cas.ts:146-147` (and the header's EXPECTED OUTPUT, §6.1, W7B-4 (e)): the negative control expects the wrong code.** For a write-payload column that does not exist, PostgREST answers **`PGRST204`** ("column not found in the schema cache"), not `42703`. This project has already seen exactly that (`app/api/onboarding/build/route.ts:277`; `docs/BUSINESS_OS_TEST_PAGE_SCOPE.md`, 2026-08-09 row). As written, a correct run would print `PROBE FAIL`. Fix: accept `PGRST204` (expected) or `42703` as the control's pass, and update the expected-output block. SA's own OP-4 ruling said 42703; this corrects it. Safety is unaffected: both codes are raised before any row is considered. Priority: **Medium. Fix before the user runs it.**
2. **CR7B-2 — rebase before the PR: `origin/main` moved to `7eac5b98`** (#194 credit deduction 11c, #205 AI Activity B1b, #208, #209). Priority: **Medium. RM / Dev, before the PR.**
   - `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`: `main` already registers `business-os/credits/accounts/[accountId]#GET` as row **93** and `business-os/ai-activity#GET` as row **94**, with a census of 91 / 85 + 6 + 0 / 62 files. After the rebase, this route is row **95**. This PR's row 94 is **dropped** (D-2). The figures become **92 / 86 + 6 + 0 open / 63 files**, the heading "(92)", and "95 rows, 92 live". Re-measure with the guard's `scanHandlers` instead of trusting this arithmetic.
   - Other conflicts expected:
     - the `lib/repositories/AuditTrailRepository.ts` header (B1b rewrote it; keep both, D-7);
     - the `BUSINESS_OS_ENTITLEMENTS.md` BD-26 paragraph and Change History;
     - the requirement's Change History.
   - After the rebase, re-run the authz guard, the wide set and `test:bos-entitlements`. Expected: `adminGate.writes` stays at **59** (11c is a GET), the catalogue at 178, and `ownerAuditReads.guard` stays green. SA checked `main` for new literal pins of the hidden list: none was added (`app/api/audit/__tests__/auditRoutes.test.ts:140` is a sample, not a set).
3. **CR7B-3 — §6.1 of this workplan is stale.** It still says `attempts = 2147483647`, a `select id … []` pre-read, and 42703. Align it with W7B-4 and the script: `99999`, a count-only `head` read, and PGRST204 / 42703. The script's run line, `node_modules\.bin\tsx`, resolves in PowerShell to `tsx.ps1`, which execution policy may block. Give the user `.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.json "<full path>"` (or the same from `cmd`). Priority: Low.

#### Rulings on the deviations

| # | Ruling |
|---|---|
| D-1 | **Approved; it is correct and safe.** The dialog is a Radix modal, so nothing outside it can be clicked while it is open (Refresh and Drain now included), and the page does not auto-refresh (A-11). Nothing can unmount the row while an outcome is on screen. Every dismissal path (Close, Escape, a click outside, the corner ×) goes through `onOpenChange(false)`. That calls `onChanged` exactly once for every outcome that may have moved the item, and never while busy. `load()` keeps the cards mounted and bumps `refreshKey`, so the figures and the open list both reload (FR-Q7). **The unknown-result wording is true:** the list does refresh on close, and "may or may not" is the honest OP-9 statement. It also covers a 500 `action_failed`, where nothing was cancelled; that is conservative, not false |
| D-2 | **Moot after the rebase: drop row 94 from this PR.** `main` (#194) has already registered `ai-activity#GET` as row 94 with the same census correction. This route becomes row 95 (CR7B-2). No split PR is needed |
| D-3 | Approved. Those four pins are literal on purpose. Updating them in place with a dated note is right, and the extra `bos_queue_item` short-circuit case is welcome |
| D-4 | Approved (the 7d L-1 precedent). Note: these render suites take 50–65 s under load |
| D-5 | Approved. A `route.ts` may export only route fields (the W7D-4 precedent); `statusLabelFor` falls back to "Unrecognised status" |
| D-6 | Approved. Keeping P01–P09 stable is worth more than numeric order. P10 prints between P05 and P06, which is cosmetic |
| D-7 | Approved. Expect a header conflict on rebase in `AuditTrailRepository.ts` (CR7B-2) |

#### Also checked

- **The UI.** "Cancel item" for the action, "Close" to dismiss, no button reads "Cancel", "Cancelling…" while busy. The 200 sentence is the W7B-7 text. The 409 label is shown only from the fixed set. The double-click guard is a ref, tested in the same tick. The body is pinned to exactly the row's queue, id, status and attempts plus the trimmed reason. The guard amendments are narrow and counted (OP-15).
- **The five lead-reply kind labels.** The W7B-11 test reads the latest `lead_responses_kind_check` migration, with comments stripped. It matches §6.2's live list.
- **W7B-1 (h).** `ownerVisibility.ts`, `AuditTrailRepository.ts`, `BUSINESS_OS_ENTITLEMENTS.md` and the requirement each name the fifth type.

#### Optimisation suggestions (non-blocking)

- Dialog: map a 500 with code `action_failed` to its own sentence, "Could not read the item just now. Nothing was cancelled." The server already guarantees that nothing was written.
- The 400 sentence says "then try again", but the reason field is hidden after any outcome. "Close this and try again" would be exact. The 400 is nearly unreachable from the UI.
- Requirement amendments, Q-SA7-1 bullet: it still says "still unanswered". A later Change History row records UC-9; consider a one-line dated note on the bullet.

#### Code Approved for QA: **Yes**, with CR7B-1 fixed before the probe runs and CR7B-2 before the PR.

## QA Testing Report

### QA Report (2026-10-04)

**QA — 2026-10-04**, worktree `neuronforge-admin-queues`, branch `feature/admin-queue-cancel` @ `5b5d2f5c`, all changes uncommitted.
**Test mode:** full
**Strategy used:** A + B (Jest unit and route integration with mocked repositories over a mutable row store; recording Supabase client for the repositories), C (read-only review of the §6.1 probe script, not run), D (browser checklist for the user; QA cannot sign in). No database access.
**Focus:** api, security, ui, schema
**Skipped:** live browser run (no admin session available to QA, W7B-5); the §6.1 probe and the 20261035 apply (user-owned, pre-merge).
**Input source:** TL brief + workplan §5, §7, §8

**Verdict: PASS WITH NOTES.** No bug of any severity in the 7b code. Three pre-merge items are still owed by the user (below). Merge is blocked until they are done.

#### Test runs (re-run independently by QA)

| Run | Suites | Tests | Result |
|---|---|---|---|
| New suites: route (after QA's additions) | 1 | 115 (109 Dev + 6 QA) | ✅ all pass |
| New suites: `AdminQueueActionsRepository` / cancel render / 20261035 migration | 3 | 56 / 31 / 14 | ✅ all pass |
| `adminGate.writes` (CASES = 59) | 1 | 298 | ✅ all pass |
| New + amended set (16 suites: route, both repositories, cancel and items render, source guard, builder, eventAudience, ownerVisibility, AuditTrailRepository, userDataExportReads, both data-export suites, both owner-policy migration tests, adminGate.writes) | 16 | 865 (before QA's additions) | ✅ all pass |
| `npm run test:authz-guard` | 1 | 119 | ✅ |
| `npm run test:bos-entitlements` | 165 | 3,969 | ✅ |
| Wide set: `app/admin app/api/admin lib/admin lib/repositories lib/audit supabase/migrations/__tests__ app/api/audit app/api/user/data-export` | 212 | 5,286 (Dev's 5,280 + QA's 6) | ✅ all pass |

No failure and no load flake in any run, so there was nothing to isolate.

**QA's added tests (real gap, route level only):** `app/api/admin/jobs-queues/items/action/__tests__/route.test.ts`. The suite tested a reason of 1 character after trimming and of 501 characters, but not the exact edges. Added:
- refused with 400 and nothing read: `'ab'`, whitespace only, `'   ab   '`;
- accepted with 200 and the audit reason recorded trimmed: exactly 3 characters, exactly 500, and 500 plus surrounding whitespace (Zod trims before `max`).

#### Test Coverage (workplan §8 → evidence)

| Acceptance Criterion | Tested? | Result | Evidence |
|---|---|---|---|
| FR-Q1 cancel per the §C matrix; every refused cell refused (C7-1) | ✅ | Pass | Route S-cells: 22 allowed cells, pinned set-equal to `CANCEL_FROM_STATUSES` per queue. N-1: 15 refused cells, including `zzz`, return 422 with nothing read. Repository R-7: every status outside the column is refused with no request |
| C7-2: never a leased row, never to `pending`, never a finished row | ✅ | Pass | N-2: fresh and expired lease on all 5 queues → 422 `leased`, CAS never called. N-3: claimed between read and write → `claimed_at IS NULL` misses → 409. R-3: no patch re-opens. N-5: finished row → 409, no CAS |
| C7-3: one CAS, `count: 'exact'`, win only on `count === 1`, no `.or()`/`.select()`, "from" check first | ✅ | Pass (live part pending) | R-5 chain order. R-6: `count` null, undefined, 2, −1 or 1.5 → `count_unconfirmed`. Route X-7 → 500 `outcome_unknown`, no audit. R-10 source pins. **§6.1 live probe: NOT RUN (user, pre-merge)** |
| FR-Q3: reason required (3–500), one audit row flushed before the response | ✅ | Pass | Z-1..Z-3 plus QA edges; A-1 shape; A-2 order (CAS → log line → flush → response, response held while flush pending); A-3 |
| FR-Q4 / §9: an action racing a claim never causes two sends | ✅ | Pass (unit) | X-3 (claim wins: one CAS, 409, claim stands), X-5 double-click (one CAS, one audit), X-6 two admins (one 200, one 409, one patch, one audit), U-5 one request on double and same-tick clicks. Real row-lock behaviour rests on SA §D.1 (not unit-provable) |
| FR-Q5 / §9: no content in page or responses | ✅ | Pass | P-suite sentinel on all 5 queues across 200/409/404/422: response, logs and audit clean. U-10: server text never rendered. R-11: mapper drops extra fields |
| FR-Q7: page and tiles refresh | ✅ | Pass | U-6 on the page: after Close, the jobs GET and the items GET each re-fetch once (D-1) |
| C7-6 cancel targets | ✅ | Pass | R-1/R-2 exact patches; S-cells: `error_message` kept, `skip_reason` only on 3 tables; §6.2 live PASS (user, 2026-10-04) |
| C7-9 one shared eligibility function | ✅ | Pass | R-10 import pin; mutation "skip eligibility" killed (Dev) |
| C7-12 data access | ✅ | Pass | R-9 caller guard, R-11..R-14, T-5 route has no `.from(`/`supabaseServer` |
| C7-13 privacy, dialog copy | ✅ | Pass | §5.8 P-suite; U-2 copy; W7B-7 sentence; A-6 reason never logged |
| C7-14 gate, correlationId, writes 59, row 93, no CAPS move | ✅ | Pass | G-1..G-6; `adminGate.writes` 59 (298 tests); authz guard 119 green; access doc row 93 present |
| C7-15 Pino, error format | ✅ | Pass | Z-7 `details` dev-only; no `console.*` in new files (source guard) |
| C7-16 (cancel) happy path per cell, CAS loss → 409, foreign id → 404, strict schema, audit shape and order | ✅ | Pass | S, X-3, T-3, T-4, Z-4, A-1, A-2 |
| tenant-isolation-guard | ✅ | Pass | T-1 owner = row's own `user_id`; Z-4/T-2 `userId`, `accountId`, `ownerUserId` and `expected.userId` → 400 with nothing read; R-5 `eq('user_id')` |
| UC-9: owners never see admin cancels | ⚠️ | Partial | App reads: `ownerVisibility` 'operator', AuditTrailRepository + data-export pins (5-type NOT IN). **RLS: migration 20261035 NOT applied; checker and probe NOT run (user, pre-merge)** |
| W7B-6: no `reminder.cancelled` / payment event | ✅ | Pass | T-5 route pin + repository W7B-6 pin (no `emitPaymentEvent`, `PaymentEventService`, `lib/services/`) |
| W7B-11: five lead-reply kind labels | ✅ | Pass | Builder test reads the latest `lead_responses_kind_check` migration; §6.2 confirmed the 5 live kinds |
| CLAUDE.md: happy + auth failure + invalid input; a repository test per method | ✅ | Pass | Route S/G/Z; `cancelQueueItemAllAccounts` (56) and `readQueueItemAllAccounts` (items suite) |

#### Edge-case probe (requested list)

| Case | Covered by | Result |
|---|---|---|
| Every cancellable cell per queue / every refused cell | S-cells (22), N-1 (15), R-7 | ✅ |
| Leased in-progress row | N-2, R-5 (`is claimed_at null`) | ✅ 422, no CAS |
| Finished row | N-5 (sent/completed/skipped) | ✅ 409, no CAS |
| Stale expected status / attempts | X-2 / X-1 | ✅ 409, no CAS, no audit |
| Claimed between read and update | X-3, N-3 | ✅ 409, one CAS, no audit |
| Deleted between | X-4 | ✅ 404 |
| Double-click | X-5, U-5 (two variants) | ✅ |
| Two admins at once | X-6 | ✅ |
| Item id from another queue's table | T-3 | ✅ 404, only that table read |
| Body with `userId` / `accountId` / `ownerUserId` | Z-4 | ✅ 400, nothing read |
| Reason 2 chars / whitespace only / 501 chars | Z-3 + QA additions | ✅ 400 |
| `action: 'retry'` | Z-1 | ✅ 400 |
| `count` = 2 | R-6 (repo → `count_unconfirmed`) + X-7 (route → 500 `outcome_unknown`, no audit) | ✅ |
| Audit row has no error, payload or skip_reason text | A-1 exact keys; P-suite | ✅ |
| Owner cannot see a `bos_queue_item` row | ownerVisibility, AuditTrailRepository (incl. `bos_queue_item` short-circuit), both data-export suites, userDataExportReads | ✅ in code; RLS pending 20261035 |
| No `reminder.cancelled` | W7B-6 pins | ✅ |
| Five lead-reply kind labels | builder test (migration-read) + items render | ✅ |
| Dialog: Confirm disabled until valid; result before refresh; Close refreshes | U-3, U-6 (onChanged not called before Close; called once on Close), U-7..U-10 | ✅ |
| Sentinel: no leaks in response, logs, UI | P-suite, U-10, U-7 (`<b>x</b>` label not rendered) | ✅ |

#### Issues Found

**Bugs (must fix before commit):** none.

**Performance issues:** none. Each action costs one indexed primary-key read, one primary-key UPDATE and, only after a lost CAS, one more read.

**Edge cases (nice to fix, all Low, none blocking):**
1. **400 outcome offers "try again" with nothing to retry.** `app/admin/components/jobs/CancelQueueItemDialog.tsx:104-105` (sentence), `:252` and `:294` (the reason input and Confirm are hidden once any outcome is set). After a 400 the admin must Close and reopen. Because the client already enforces the 3-character reason, a 400 in practice comes from something else (attempts over 100,000, a bad status word), so "Give a reason of at least 3 characters" can be the wrong hint. Suggest a neutral sentence, or keep the input for `invalid_input`.
2. **Pessimistic outcome after a known-lost CAS if the re-read throws.** `app/api/admin/jobs-queues/items/action/route.ts:222` and `:282-287`. `casSent` is already true, so a throw in the re-read reports `outcome_unknown` ("may or may not") although the CAS is known to have matched zero rows. `underDeadline` does not normally throw, so this is very unlikely and the message stays safe (it is pessimistic, never optimistic).
3. **Doc drift in §6.1.** The text still says `attempts: 2147483647` and "three independent guarantees". The script uses `99999` per W7B-4 (b) and states four guarantees. Doc only.
4. **Probe env precedence.** `probe-cancel-cas.ts` `loadEnv()` keeps an already-set `process.env` value over `.env.local`, so a different `NEXT_PUBLIC_SUPABASE_URL` or service key in the user's shell would win. Safety is unaffected (zero-row by construction). Run it in a clean shell so the result is about the intended database.
5. **Live confirmation of the audit write.** No `audit_trail.entity_type` CHECK exists in the repo migrations, and `bos_queue` (7d) writes fine live, so `bos_queue_item` is expected to insert. `logAndFlush` never rejects, though, so a refused insert would be silent. The first real cancel (M-5, or the first production use) should be checked in `/admin/audit-trail`.

#### §6.1 probe script verdict (read, NOT run)

`scratchpad/dev7b/probe-cancel-cas.ts`: **safe. It cannot change a real row.**
- **It goes through the real repository.** A bad input (status outside the column, bad attempts) is refused before any request is sent.
- **Each UPDATE matches nothing, on four independent grounds:**
  - a fresh `randomUUID()` primary key, confirmed absent by a count-only head read (any non-zero count or any error exits before the update);
  - a fresh random `user_id`;
  - `attempts = 99999`;
  - the in-progress status plus `claimed_at IS NULL`.
- **The patch is the frozen constant.**
- **No trigger can fire.** It sends no `.select()` and does not use the route, so it writes no audit row. §6.2 (d) proved zero row-level or statement-level triggers.
- **The negative control cannot touch a row either.** It uses the same impossible filters on `payment_reminders`, and is rejected while planning with `42703`. Even if that column existed, nothing would match.
- **It stops at the first failure.** On any non-`not_matched` result, no further table is touched.
- **Its output** is the queue, the outcome and error codes. The repository's Pino lines also carry the run's random ids, which identify no real row.
- **Run it** with the worktree's `node_modules\.bin\tsx`. Never `npm install`.

#### Browser checklist for the user (QA cannot sign in)

**Never press "Cancel item" inside the dialog on a real client's item.** The only cancellable live rows are real waiting payment reminders.

**Pre-merge (blocking, in this order):**
1. ⬜ Apply `supabase/migrations/20261035_audit_trail_owner_policy_hides_queue_items.sql` in the Supabase SQL editor.
2. ⬜ Run `scripts/check-audit-owner-policy-migration.sql`. Expect C01–C06 PASS (C03 "hides all five types") and VERDICT PASS.
3. ⬜ Run `scripts/probe-audit-owner-policy-migration.sql` after pasting your own user id. Expect "PROBE PASS … rolls everything back", with P01–P08 and **P10 "the owner cannot see the bos_queue_item row"** PASS, and P08 "service_role sees all 7 probe rows". Repeat 2 and 3 until both PASS. Any FAIL: stop and send the output to SA.
4. ⬜ Run the §6.1 zero-row probe from the 7b worktree in a clean shell, with the exact PowerShell line in §6.1 (`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.json "<full path>\probe-cancel-cas.ts"`). Expect 5 × `pre-read empty   outcome not_matched`, `control payment_reminders skip_reason   error PGRST204` (`42703` also passes), then `PROBE PASS`. Paste the plain lines into this report (M-8). *(Run line and control code updated by Dev for CR7B-1 / CR7B-3.)*

**In the browser (preview or local build, signed in as a platform admin):**

5. ⬜ `/admin/jobs-queues`: the header reads "Each queue has a Drain now button, and a waiting, failed or orphaned item can be cancelled from its queue's list; everything else here is read-only." (M-1)
6. ⬜ Payment reminders → View items → Waiting. Each cancellable row shows a small "Cancel item" button in the Cancellable column, and no other row has one. The panel header no longer says "Read-only". (M-2)
7. ⬜ Open DevTools → Network, then click "Cancel item" on one row. Opening the dialog sends **no** request. (M-4)
8. ⬜ In the dialog (M-3):
   - the title reads "Cancel this item?";
   - the line under it shows the kind, the business, `item` plus 8 characters, and the status;
   - the "closes this item for good" line and the reminders' "what happens next" line are there;
   - "The business is not told…" is there;
   - the dismiss button reads **Close**, and no button reads "Cancel".
9. ⬜ Confirm ("Cancel item") is disabled when the reason is empty, `ab`, or only spaces. Type `abc` and it becomes enabled. **Do not click it.**
10. ⬜ Press **Close**. The dialog closes, no POST appears in Network, and the list is unchanged.
11. ⬜ Repeat 7–10 with Escape, then with a click outside the dialog. Each closes it with no request.
12. ⬜ Open Lead replies → View items. Any row of the three newer kinds shows "Invoice chase to a client", "Intake form reminder" or "Meeting reminder", not "Other". There may be none today.
13. ⬜ Signed out (or a non-admin), run the M-6 `curl`. Expect 401 or 403.
14. ⬜ M-5 only if you name, in writing, an item of your **own test business** that you want gone. Otherwise record "M-5 not run (no expendable item)".
    - If you do run it: the dialog shows "Cancelled. The queue will not send it." first, and the list refreshes only after Close.
    - `/admin/audit-trail` → "Business OS Queues" → "Item Cancelled" shows one `warning` row with your reason. This also confirms edge case 5.
15. ⬜ M-7: `git diff origin/main --stat -- app/api/cron lib/services lib/cron vercel.json` is empty.

#### Final Status
- [ ] All acceptance criteria pass — ready for commit
- [x] Code-level criteria pass with no open bug. **Not ready to merge until pre-merge items 1–4 are done**: the 20261035 apply, the checker and probe both PASS, and the §6.1 probe output recorded. The five Low edge cases are optional for Dev.

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | Created | Dev workplan for slice 7b only (cancel one queue item), on `feature/admin-queue-cancel` @ `b1070558` (7d and 7a merged). Two findings: F-1, a `bos_queue_item` audit row written against the owner's account is owner-readable unless its type is `'operator'`, which since BD-26 needs a policy migration (OP-2); F-2, the 7a lead-reply kind labels miss three kinds. Seventeen open points for SA |
| 2026-10-04 | SA workplan review | **APPROVED WITH CONDITIONS (W7B-1..W7B-14).** OP-2: option 1. `bos_queue_item` is `'operator'`, `userId` = the item's account, owner-policy migration `20261035` (the checker **and** the probe follow the registry), applied and verified by the user **before merge**. OP-1: audit after the winning update, accepted. OP-3: the user runs §6.2 now (`pg_get_triggerdef` added; any trigger stops the slice). OP-4: the zero-row probe is safe as amended (`attempts` 99999, after §6.2), and the user runs it after code review. OP-14: no payment event, pinned. 7b may ship before BL-7a; the 200 sentence becomes "Cancelled. The queue will not send it." Rebase onto `origin/main` first. No live query was run by SA (a production read was refused by the environment) |
| 2026-10-04 | §6.2 run by the user; Q-SA7-1 answered | The user ran §6.2 read-only: PASS (status CHECKs allow `skipped` on the three non-payment tables, no CHECK on the payment tables, no `skip_reason` CHECK, zero triggers; live `lead_responses.kind` has the five kinds). The user confirmed OP-2 option 1: owners do not see admin cancels; migration `20261035` is accepted and will be applied and verified by the user before merge. |
| 2026-10-04 | Implemented (Dev) | Code complete on the rebased base `5b5d2f5c`, uncommitted. Re-measured: census 61 / 90 before, 62 / 91 = 85 + 6 + 0 after (an unregistered B1a handler found and registered as row 94), `adminGate.writes` 59, catalogue 178. Migration 20261035 + rollback written, checker and probe extended (probe P10, 7 rows); not applied. W7B-7 wording folded into §2.7, U-6, M-5; W7B-12 effort; W7B-13 PR body. Deviations D-1..D-7 in Implementation Notes (D-1: refresh on Close). 22 of 22 mutants killed. §6.1 probe prepared in the scratchpad, not run |
| 2026-10-04 | QA report | **PASS WITH NOTES.** Re-run independently: wide set 212 suites / 5,286 tests, `test:bos-entitlements` 165 / 3,969, `test:authz-guard` 119, `adminGate.writes` 59 cases / 298 tests, all green. QA added 6 route reason-edge cases. No bugs; 5 Low edge cases. §6.1 probe reviewed (not run): it cannot change a row. Pre-merge items owed by the user: apply 20261035, then the checker and the probe to PASS, then the §6.1 probe |
| 2026-10-04 | SA code review | **APPROVED WITH CHANGES; code approved for QA.** CAS, route order, audit-after-win, owner-policy package and UI verified. Migration 20261035 = 20261018 + one literal; rollback byte-identical to 20261018. The §6.1 zero-row probe cannot change a row. CR7B-1: its control must accept PGRST204 (not only 42703) before the user runs it. CR7B-2: rebase onto `7eac5b98`; main already holds register rows 93 (11c) and 94 (ai-activity), so this route becomes row 95 and D-2 is dropped (census 92 / 86 + 6 + 0 / 63). CR7B-3: §6.1 text and the run line. D-1, D-3..D-7 approved |
| 2026-10-04 | SA code review fixes; rebased onto `7eac5b98` (Dev) | CR7B-2: uncommitted work moved onto `origin/main` @ `7eac5b98` by patch; conflicts in the `AuditTrailRepository.ts` header and the access doc resolved keeping `main` and adding 7b. This slice's row 94 dropped; the cancel route is row **95**; census re-measured **92 / 86 + 6 + 0 / 63 files**, "95 rows, 92 live". `adminGate.writes` 59, catalogue 178. CR7B-1: probe control accepts `PGRST204` or `42703`. CR7B-3: §6.1 aligned (99999, count-only pre-read, four guarantees) with a PowerShell `tsx.cmd` run line and a clean-shell note. Dialog: new 400 sentence, own `action_failed` sentence. All listed suites green; probe not run. Uncommitted |
