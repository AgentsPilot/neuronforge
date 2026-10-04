# Workplan: Admin BOS Cleanup, Slice 7a (queue item list on Scheduled jobs & queues)

> **Last Updated**: 2026-10-04

**Developer:** Dev
**Requirement:** [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md): §4.2 FR-Q1, FR-Q5, FR-Q6, FR-Q7; the slice 7 lines of §9 that apply to a read-only list; and **"SA Review — slice 7 (2026-10-04)"** in full, with SA's 7d amendments. The binding parts for 7a are §A (schema), §C (the matrix, as data only), §E (the "due" anchors and the list's "retry until … / cancel only" marks), and conditions **C7-1, C7-2, C7-9, C7-12, C7-13, C7-14, C7-15** (the 7a items). User decisions used: UC-7 (7d first, then 7a, 7b, 7c, each its own PR), OQ-3 (72-hour retry window, then cancel only), OQ-4 (Drain now, shipped in 7d).
**Branch:** `feature/admin-queue-item-list` @ `61bda100` (`origin/main` after PR #196, slice 7d). Worktree `neuronforge-admin-queues`. Created by RM.
**Process:** Dev workplan → SA workplan review → Dev implement → SA code review → QA → the user sees the uncommitted diff → user approval → RM. Dev commits nothing.
**Date:** 2026-10-04
**Status:** Planning (awaiting SA workplan review)
**Effort:** S–M, about 1.75 days of Dev time. Breakdown in [section 11](#11-effort-estimate).

## Overview

Slice 7d gave each queue on `/admin/jobs-queues` a "Drain now" button. The page still shows only counts. When it says "3 dead-lettered", an admin cannot see *which* three. Slice 7a adds a **read-only list of individual queue items** to each queue card. An admin opens a queue's list with "View items" and picks a state: stuck, failed, dead-lettered or waiting. Each row shows metadata only: the business name, a fixed kind label, the status, the due time, attempts, how long the item has been stuck or overdue, whether it could be re-sent (and until when), and whether it could be cancelled.

**7a adds no action.** The re-send and cancel columns tell the admin what 7c and 7b *will* allow. They are computed by one shared pure function (C7-9), which 7b and 7c will reuse on the server. The only action on the page is still 7d's Drain now.

New: one route, `GET /api/admin/jobs-queues/items`; one repository method, `listQueueItemsAllAccounts`; a pure eligibility module; a pure view builder; and a client panel. No migration, no write, no audit row, and no change to any cron, drain or service.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify](#3-files-to-create--modify)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. Column Allow-List per Table](#6-column-allow-list-per-table)
- [7. Manual QA Check](#7-manual-qa-check)
- [8. Acceptance Criteria Traceability](#8-acceptance-criteria-traceability)
- [9. Risks and Rollback](#9-risks-and-rollback)
- [10. PR Body Draft](#10-pr-body-draft)
- [11. Effort Estimate](#11-effort-estimate)
- [12. Open Points for SA](#12-open-points-for-sa)

---

## 1. Analysis Summary

### 1.1 What exists today (read on `61bda100`)

| Piece | As built | What 7a does with it |
|---|---|---|
| `lib/repositories/AdminJobsQueuesRepository.ts` | Service-role, cross-account, admin-only. Two methods, `summariseCronRunsAllJobs` and `readQueueFiguresAllAccounts`. `ADMIN_QUEUE_SPECS` holds each table's in-progress status, dead-letter rule (status `failed` plus the fixed `DEAD_LETTER_MARKER`, or status `dead_letter` on payment automations), guardrail markers and window column. `ADMIN_QUEUE_SELECTABLE_COLUMNS = ['id', 'scheduled_at', 'next_attempt_at', 'created_at']`. `error_message` appears only inside filters. Its test pins the columns, the marker filters, and that only `app/api/admin/**` names the repository | Add **one** method, `listQueueItemsAllAccounts`. It reuses the spec and the same filter shapes (stuck, failed-not-dead, dead-lettered). Widen the allow-list deliberately (C7-12, [section 6](#6-column-allow-list-per-table)) and keep the figures read pinned to the original four columns |
| `lib/admin/jobs/*` | `readJobsQueues.ts` (injected readers, so `lib/admin/**` never names a repository: the C-6 guard), `buildJobsQueuesView.ts` (pure), `jobsQueuesTypes.ts` (runtime-free wire types, imported by the client with `import type` only: C-21), plus 7d's `runQueueDrain.ts` and `drainCounts.ts` | Add `queueItemEligibility.ts` (the shared C7-9 function and the §C matrix as data) and `buildQueueItemsView.ts` (pure mapping: labels, eligibility, field allow-list). Add the wire types to `jobsQueuesTypes.ts` |
| `app/api/admin/jobs-queues/route.ts` | `GET`, `requireAdmin` first, strict empty Zod, counts and timestamps only, no audit | Untouched. The new route sits beside it at `items/route.ts` |
| `BusinessProfileRepository.findAdminIdentitiesByUserIds` | Selects `user_id, company_name, vertical, sub_vertical`, chunks `.in()` at 200. Pinned by `adminReadMethods.guard.test.ts`, which also requires that only `app/api/admin/**` calls it. Already used by the audit-trail, users, credit report and leak-check admin routes | Reused as is for the business name (C7-12: "Business names come from `business_profiles.company_name` through a repository read"). No new repository method for names |
| `app/admin/components/jobs/JobsQueuesView.tsx` | One `QueueCard` per queue, with 7d's `DrainNowDialog` in the header. Exactly one `fetch(` (the jobs GET) | Each card gets a "View items" toggle and renders a new `QueueItemsPanel` below its figures. The view still makes exactly one `fetch(` |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts`, `jobsQueues.render.test.tsx` | The SC-7 read-only pins as narrowed by 7d (W7D-2): the view says "Drain" once; the dialog owns the only POST; the render test expects exactly 1 + 5 buttons | Narrow amendment (OP-3 style, [section 2.7](#27-guard-amendments-op-3-style)) |
| `lib/business-os/businessDay.ts` `businessDayFor(now, timezone)` | Pure, DST-safe, returns `{ date, startUtc, endUtc }`. The briefing dispatcher uses it | Reused for the briefing "same business day" rule (C7-7), as C7-7 asks |

### 1.2 Schema (TA-11), as measured by SA live on `5f10a926` (§A)

Dev has no database access. Every column 7a selects is in SA's §A "confirmed present" list. The full list per table is in [section 6](#6-column-allow-list-per-table); OP-3 asks SA (or QA) to re-run the zero-row select for exactly that list before merge.

Facts that shape the design:
- **No queue table has a failure timestamp** (F-8 in slice 5; §A: no `updated_at`). Every terminal failure write clears `claimed_at` (`LeadResponseRepository.finish`, `DailyBriefingSendRepository.markTerminal`, `InsightActionRepository.markFailed`, every `reap_stale_*` dead-letter branch). `PaymentReminderRepository.updateStatus` does not, so `claimed_at` cannot be used as a failure time either. "How long it has been failed" can therefore only be measured from the §E due anchor. The UI says so.
- **No queue table has an error category column.** The only categories that exist without reading `error_message` are the ones the existing filters already compute against fixed markers: *dead-lettered* (status `failed` + `DEAD_LETTER_MARKER`, or status `dead_letter`) versus *failed*, and on payment automations *a guardrail decision* (status `failed` + `'max executions reached'` / `'cooldown active'`). 7a's "error category" is the state filter that matched the row. `error_message` is never selected.
- **Kind vocabularies:** `lead_responses.kind` is CHECK `('invite', 'chase')`; `insight_actions.kind` is CHECK `('chase_invoice', 'followup_nudge', 'booking_reminder')`; `payment_reminders.reminder_type` has **no** CHECK (`20260723_enhance_payments.sql:299`; the code type is `'upcoming_due' | 'due_today' | 'overdue' | 'retry_failed' | 'payment_received'`, `PaymentReminderService.ts:48`). Unknown values map to "Other" (C7-13). `daily_briefing_sends` has no kind (one kind). `payment_automation_executions` has no kind column in C7-12 (OP-4).

### 1.3 Tenant isolation (`tenant-isolation-guard`)

7a takes **no caller-supplied row id or account id**. Its only inputs are a queue id (an enum), a state (an enum) and a page number. It is a cross-account admin read by design: the gate replaces CLAUDE.md rule 4, as for every `AllAccounts` method in this repository. There is no write, trigger, upsert or payload, so the "scope-defeating three" do not apply. `user_id` is read on the server **only** to look up business names, and is dropped before the response (C7-13). The strict query schema rejects an `accountId` or `userId` parameter.

### 1.4 Admin surface (C7-14)

Measured on `61bda100` by the access doc's method: **59 route files, 88 handlers = 82 `requireAdmin` + 6 inline + 0 open**, register rows to **91**. 7a adds one file and one `GET` handler, gated from birth:
- after 7a: **60 files, 89 handlers = 83 + 6 + 0**, register row **92** `jobs-queues/items#GET`;
- `adminGate.writes.test.ts` is **not** touched. It holds write handlers and the slice 1 GET list; C7-14 rules that this GET gets "its own four denial cases" in its route test, as `jobs-queues#GET` (row 84) did. `CASES` stays **58**;
- no `CAPS` value moves (R1–R8), no exemption is added. T13 runs the authz surface guard locally.

### 1.5 Logging (C7-15)

`console.*` counted on `61bda100`: 0 in `JobsQueuesView.tsx`, `page.tsx`, `AdminJobsQueuesRepository.ts`, `jobsQueuesTypes.ts`, `AdminJobsQueuesRepository.test.ts`, `jobsQueues.render.test.tsx`, `jobsQueues.source.guard.test.ts`, and `lib/business-os/businessDay.ts` (imported, not modified). T1 re-counts before editing. New files use Pino only.

---

## 2. Implementation Approach

### 2.1 States: what the list can show

| State (`state=`) | Rows | Order (stable; `id` breaks ties) |
|---|---|---|
| `stuck` (default) | In progress (`processing` / `running`) with `claimed_at` NULL **or** older than `STUCK_AFTER_SECONDS` (90 s + 10 min): the exact predicate of the page's "Stuck in progress" figure | `claimed_at` ascending, NULLs first (orphans, the only cancellable stuck rows, come first) |
| `failed` | Status `failed`, **not** dead-lettered and **not** a guardrail decision: the exact predicate of the "Failed" figure, without its 24 h / 7 d window | The §E window column descending (`scheduled_at` for the payment tables, `created_at` otherwise): newest first, so items still inside the 72 h window lead |
| `dead_lettered` | The exact predicate of the "Dead-lettered" figure, without its window | As `failed` |
| `waiting` | Status `pending` (due now, scheduled for later, and payment automations with no due time) | Payment tables `scheduled_at` ascending, NULLs last; others `created_at` ascending |

Not listed: leased in-progress rows that are not yet stuck, and every terminal row (`sent`, `completed`, `skipped`, `cancelled`). None is ever actionable (§C). Guardrail decisions on payment automations are not listed either (OP-5). SA's §M also names a "cancellable" filter. 7a does not add it as a filter: every row carries its own cancel mark (OP-6).

### 2.2 Shared pure module: `lib/admin/jobs/queueItemEligibility.ts` (C7-9, new)

This is the one function both the list (7a) and the action route (7c, and 7b for cancel) use. It holds the §C matrix as data, so 7b/7c's server check that `expected.status` is an allowed "from" state reads the same table.

```typescript
import { businessDayFor } from '@/lib/business-os/businessDay';
import type { BosQueueId } from '@/lib/cron/bosCronJobs';

export const RETRY_WINDOW_HOURS = 72;

/** §C, "Retry" column. Payment automations: none (C7-5). */
export const RETRY_FROM_STATUSES: Readonly<Record<BosQueueId, readonly string[]>>;
/** §C, "Cancel" column. In-progress statuses only when claimed_at IS NULL (C7-2). */
export const CANCEL_FROM_STATUSES: Readonly<Record<BosQueueId, readonly string[]>>;
export const IN_PROGRESS_STATUS: Readonly<Record<BosQueueId, 'processing' | 'running'>>;

export interface QueueItemFacts {
  status: string;
  claimedAt: string | null;
  scheduledAt: string | null;   // payment tables only
  createdAt: string;
  briefingDate: string | null;  // daily_briefing_sends only, 'YYYY-MM-DD'
  timezone: string | null;      // daily_briefing_sends only (OP-2)
}

export type RetryRefusal =
  | 'retry_not_offered'     // payment automations (C7-5)
  | 'not_retryable_state'   // not in RETRY_FROM_STATUSES
  | 'retry_window_passed'   // past anchor + 72 h (§E)
  | 'briefing_not_today'    // briefing_date is not today in the row's timezone (C7-7)
  | 'no_due_time';          // the anchor is NULL (defensive; fails closed)

export type CancelRefusal = 'leased' | 'not_cancellable_state';

export interface QueueItemEligibility {
  /** §E anchor used; for the briefing, the business day's first instant. */
  anchorAt: string | null;
  retry: { allowed: true; until: string } | { allowed: false; code: RetryRefusal };
  cancel: { allowed: true } | { allowed: false; code: CancelRefusal };
}

export function queueItemEligibility(
  queue: BosQueueId,
  facts: QueueItemFacts,
  now: Date,
  options?: { retryAt?: Date } // 7c passes the payment reminder's next sendable time (C7-8); default `now`
): QueueItemEligibility;
```

Rules, exactly per §C, §E, C7-2, C7-5, C7-7:

| Queue | Retry allowed when | `until` | Cancel allowed when |
|---|---|---|---|
| `payment_reminders` | status `failed` (dead-lettered rows are status `failed` too) **and** `retryAt ≤ scheduled_at + 72 h` | `scheduled_at + 72 h` | status `pending` or `failed`, or `processing` with `claimed_at` NULL |
| `payment_automations` | never (`retry_not_offered`) | — | status `pending`, `failed` or `dead_letter`, or `running` with `claimed_at` NULL |
| `daily_briefing_sends` | status `failed` **and** `briefing_date === businessDayFor(now, timezone).date` | that day's `endUtc` | status `pending` or `failed`, or `processing` with `claimed_at` NULL |
| `lead_responses` | status `failed` **and** `retryAt ≤ created_at + 72 h` | `created_at + 72 h` | as the briefing |
| `insight_actions` | as `lead_responses` | `created_at + 72 h` | as the briefing |

- **Boundary:** "inside the window" is **inclusive** (`retryAt ≤ anchor + 72 h`), so it agrees with the CAS predicate SA ruled for 7c, `.gte(anchor, now − 72 h)`. At exactly 72 h a retry is allowed; one millisecond later it is not. Both are tested per queue.
- **Order of checks:** state first (`not_retryable_state` / `leased`), then the queue rule, then the window. A leased in-progress row is never actionable (C7-2): retry `not_retryable_state`, cancel `leased`.
- **Fail closed:** an unparseable or NULL anchor gives `no_due_time`. An unusable timezone falls back to UTC, exactly as `businessDayFor` does for the dispatcher, so the list and the send agree on "today".
- **Pure:** no clock, no I/O, no logger. `businessDayFor` is pure. The module lives under `lib/admin/jobs/`, and the client never imports it (the server sends the result).
- **What the list cannot know (OP-7):** for payment reminders, 7c will also refuse when the next *sending-hours* time falls after `scheduled_at + 72 h` (C7-8). 7a has no sendable-time helper yet (C7-8 adds it in 7c), so the list shows `until` as the latest possible time and says "within the business's sending hours".

### 2.3 Repository: `listQueueItemsAllAccounts` (C7-12)

**File:** `lib/repositories/AdminJobsQueuesRepository.ts` (modified, `new-repository` checklist)

```typescript
export type AdminQueueItemState = 'stuck' | 'failed' | 'dead_lettered' | 'waiting';
export const ADMIN_QUEUE_ITEM_STATES: readonly AdminQueueItemState[];
export const ADMIN_QUEUE_ITEMS_PAGE_SIZE = 50;   // SA §M: the 50-row cap
export const ADMIN_QUEUE_ITEMS_MAX_PAGE = 20;    // 1,000 rows deep at most (OP-8)

/** The exact select per table (section 6). Never `*`. */
export const ADMIN_QUEUE_ITEM_COLUMNS: Readonly<Record<AdminQueueId, readonly string[]>>;
/** The original four, still the ONLY columns the figures read may select. */
export const ADMIN_QUEUE_FIGURE_COLUMNS = ['id', 'scheduled_at', 'next_attempt_at', 'created_at'] as const;
/** Widened deliberately by slice 7a (C7-12): the union of the two lists above. */
export const ADMIN_QUEUE_SELECTABLE_COLUMNS: readonly string[];

export interface RawQueueItem {
  id: string;
  userId: string;               // SERVER-ONLY: for the business-name lookup, never returned by the route
  status: string;
  attempts: number;
  claimedAt: string | null;
  createdAt: string;
  scheduledAt: string | null;
  nextAttemptAt: string | null;
  kind: string | null;          // lead_responses.kind | insight_actions.kind | payment_reminders.reminder_type
  briefingDate: string | null;
  timezone: string | null;
}

async listQueueItemsAllAccounts(
  context: AdminReadContext,           // FIRST and REQUIRED (SC-9(a))
  queue: AdminQueueId,
  state: AdminQueueItemState,
  now: Date,
  page: { page: number },              // 1-based; size is fixed at ADMIN_QUEUE_ITEMS_PAGE_SIZE
  options: AdminReadOptions = {}       // abort signal
): Promise<RepositoryResult<{ rows: RawQueueItem[]; total: number }>>;
```

- **Why the service role (code comment, as the header already says for the class):** "Which lead replies are dead-lettered, platform-wide" has no per-tenant answer. The method is admin-only and cross-account by design; CLAUDE.md rule 4 is replaced by the caller's `requireAdmin` gate, and the only permitted caller is `app/api/admin/jobs-queues/items/route.ts` (the existing source guard already enforces "only `app/api/admin/**`").
- **One request per call:** `.from(spec.table).select(ADMIN_QUEUE_ITEM_COLUMNS[queue].join(', '), { count: 'exact' })`, the state filter, the order from §2.1, then `.range(from, from + 49)`. `count: 'exact'` comes back with the same request, so `total` costs no second query.
- **Filters reuse the figures' predicates.** The `stuck`, `failedNotDead` and `deadLettered` closures are lifted out of `readQueueFiguresAllAccounts` into private helpers that both methods call, so the list can never disagree with the count on the card. The existing figures tests stay green unedited, apart from the column-list pin (§2.7, T4).
- **`.or()` is used on a SELECT only** (stuck: `claimed_at.is.null,claimed_at.lt."…"`; failed: the null-safe marker exclusion), exactly as the figures read already does in production. The 2026-09-29 PostgREST defect is UPDATE + `.or()` + `.select()`; no update exists here.
- **Bounded:** `page` outside `1..ADMIN_QUEUE_ITEMS_MAX_PAGE` is refused with an error and **no request** (the route has already refused it with a 400; this is defence in depth). The method never returns more than 50 rows: it slices defensively if PostgREST ignores the range.
- **Mapping:** each row is mapped field by field into `RawQueueItem`. A column that is not in the allow-list is never read from the row object, even if a client returned it. `attempts` must be a finite integer ≥ 0 and `id`/`created_at` strings; a malformed row fails the read (`{ data: null, error }`), rather than showing a half-understood row (the `readJobsQueues` Zod precedent, SC-5).
- **Logs:** `info` `{ correlationId, adminUserId, queue, state, page, returned, total }`, "Queue items read (all accounts)". On error, `warn` with the error **code** only, never its message (existing pattern). Never a row value.
- **Never throws:** returns `{ data, error }`.

### 2.4 Pure builder: `lib/admin/jobs/buildQueueItemsView.ts` (new)

`lib/admin/**` never names an admin repository (the C-6 guard), so this module declares its own structural input type `QueueItemInput` (the same fields as `RawQueueItem`), which the repository's rows satisfy. The route passes them in.

```typescript
export function buildQueueItemsView(input: {
  queue: BosQueueId;
  state: QueueItemState;
  page: number;
  pageSize: number;
  total: number;
  rows: readonly QueueItemInput[];
  /** user_id → company_name; `null` = the lookup failed; a missing key = no profile row. */
  names: ReadonlyMap<string, string | null> | null;
  now: Date;
}): QueueItemsView;
```

It builds each `QueueItemView` **field by field** (an allow-list, never a spread):

| Field | Source | Notes |
|---|---|---|
| `id` | row `id` | The queue row's own uuid. Not an account id. 7b/7c need it, and FR-Q5 lists "item id" (OP-9). The UI shows the first 8 characters |
| `businessName` | `names.get(userId)` | `company_name` trimmed. Fallbacks, all fixed text: "Business without a name" (profile row, empty name), "No business profile" (no row), "Name not available" (lookup failed) |
| `kindLabel` | fixed map ([section 2.5](#25-fixed-labels-c7-13)) | Unknown or NULL → "Other" |
| `status` | row `status` | The platform's own status word (`pending`, `failed`, …). 7b/7c send it back as `expected.status` (§D.2) |
| `statusLabel` | fixed map | "Waiting", "In progress", "Failed", "Dead-lettered", … ; unknown → "Unrecognised status" |
| `state`, `errorCategory` | the state filter | `errorCategory`: `'dead_lettered'` / `'failed'` / `null`. Derived from the fixed-marker filter, never from `error_message` |
| `attempts` | row | |
| `due` | §E | `{ basis: 'scheduled', at }` (payment tables, `scheduled_at`); `{ basis: 'business_day', date }` (briefing, `briefing_date`); `{ basis: 'queued', at }` (lead replies and insight actions, `created_at`, labelled "queued", because the real due time is not kept: §E) |
| `nextAttemptAt` | row | Waiting rows only, else `null` |
| `age` | see below | `{ minutes, basis }` |
| `lease` | stuck rows | `'none'` (orphaned: `claimed_at` NULL) or `'expired'` (claimed before the stuck threshold) |
| `retry`, `cancel` | `queueItemEligibility(queue, facts, now)` | Codes and `until` only. The UI maps codes to plain sentences |

`age` per state:
- `stuck`: minutes since `claimed_at` (`basis: 'since_claimed'`), or `null` with `basis: 'no_lease'`;
- `failed` / `dead_lettered`: minutes since the §E anchor (`basis: 'since_due'`). There is no failure time (§1.2), and the UI says "since it was due";
- `waiting`: minutes past the effective due time, negative when it is not yet due (`basis: 'overdue'`). Effective due = the later of `scheduled_at` and `next_attempt_at` (payment tables), else `next_attempt_at ?? created_at`. This is the same rule as the card's "Oldest item due now".

`user_id`, `timezone`, `claimed_at` and `created_at` are **not** fields of `QueueItemView`. They are used for the computation only.

Also exported: `QUEUE_ITEM_KIND_LABELS`, `QUEUE_ITEM_STATUS_LABELS` and a `kindLabel(queue, kind)` helper, for the tests.

### 2.5 Fixed labels (C7-13)

| Queue | Column | Value → label |
|---|---|---|
| `payment_reminders` | `reminder_type` | `upcoming_due` "Reminder before the due date" · `due_today` "Due-today reminder" · `overdue` "Overdue reminder" · `retry_failed` "Failed-payment notice" · `payment_received` "Payment receipt" · anything else "Other" |
| `payment_automations` | — (OP-4) | always "Payment automation" |
| `daily_briefing_sends` | — | always "Morning briefing" |
| `lead_responses` | `kind` | `invite` "Booking invite to a new lead" · `chase` "Follow-up to a lead" · else "Other" |
| `insight_actions` | `kind` | `chase_invoice` "Invoice chase" · `followup_nudge` "Follow-up nudge" · `booking_reminder` "Booking reminder" · else "Other" |

The raw kind value is never sent, so a new value added to a CHECK later shows "Other" until it gets a label.

### 2.6 Route: `GET /api/admin/jobs-queues/items` (C7-14, `new-api-route`)

**File:** `app/api/admin/jobs-queues/items/route.ts` (new)

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QueueItemsQuerySchema = z.object({
  queue: z.enum(QUEUE_ITEM_QUEUE_IDS),           // `as const satisfies readonly BosQueueId[]`, set-equal to BOS_QUEUES (W7D-4 pattern)
  state: z.enum(QUEUE_ITEM_STATES).default('stuck'),
  page: z.coerce.number().int().min(1).max(ADMIN_QUEUE_ITEMS_MAX_PAGE).default(1),
}).strict();                                       // no accountId, userId or anything else

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement (C7-14). Nothing above it reads the query or the database.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;
  ...
}
```

Flow after the gate:
1. **Parse** `Object.fromEntries(request.nextUrl.searchParams)` with `safeParse`. On failure: **400** `{ success: false, error: 'Choose a queue, a state and a page from the list', code: 'invalid_input', details: dev-only first issue }`. Nothing is read. A repeated parameter (`?queue=a&queue=b`) is resolved by `fromEntries` (last wins) and still validated.
2. `now` = the minute-floored clock, as the jobs route does, so every age is measured against one reading.
3. **Read items** under `underDeadline('queue-items', timings, (signal) => adminJobsQueuesRepository.listQueueItemsAllAccounts(context, queue, state, now, { page }, { signal }))` (5 s, `ADMIN_READ_DEADLINE_MS`). On error or time-out: **500** `{ success: false, error: 'Could not load the items just now', details: dev-only }`. No partial list.
4. **Read names**: `businessProfileRepository.findAdminIdentitiesByUserIds(distinct userIds)` (at most 50 ids, one `.in()` request), also under the deadline. If it fails or times out, the list is still served (200) with "Name not available", and a `warn` is logged with the error code. A missing name must not hide a stuck item.
5. **Build** with `buildQueueItemsView(...)`.
6. **Log** `info` `{ adminUserId, queue, state, page, returned, total, namesResolved, namesFailed, totalMs, reads: timings }`, "Queue items served". Counts only. No id, name or row value.
7. **Respond** **200** `{ success: true, data: QueueItemsView }`.

`QueueItemsView` = `{ queue, state, now, page, pageSize, total, hasMore, items: QueueItemView[] }`, with exactly those keys.

**No audit row:** this is a read, like `jobs-queues#GET` and `health-summary#GET` (OP-10). **No write of any kind:** a test asserts that the recording client sees no `insert`, `update`, `upsert`, `delete` or `rpc`.

**Never in the response or the logs:** `user_id`, any account id, `error_message`, `skip_reason`, payload, recommendation, contact, invoice, installment, booking, entity, rule or trigger ids, `claimed_by`, `timezone`, or the raw kind value.

### 2.7 UI

**New `app/admin/components/jobs/QueueItemsPanel.tsx`** (`'use client'`). It owns the list's only request:
- Props: `queueId: BosQueueId` (`import type`), `queueLabel`, `refreshKey: number`.
- **One `fetch(`**: `` fetch(`/api/admin/jobs-queues/items?${params}`, { cache: 'no-store' }) ``, where `params` is a `URLSearchParams` of `queue`, `state` and `page` only. No `method:` key (a GET).
- **State tabs** (buttons with `aria-pressed`): "Stuck", "Failed", "Dead-lettered", "Waiting". The default is "Stuck". Changing the tab resets to page 1.
- **Table** columns: Business · Item · Kind · Status · Due · Attempts · Age · Re-send · Cancellable. Read-only cells, no buttons in rows.
  - Item: the first 8 characters of `id`, with the full id in a `title` attribute (for 7b/7c and SQL look-ups).
  - Due: "2026-10-01 09:00 UTC" (`scheduled`), "business day 2026-10-04" (`business_day`) or "queued 2026-10-01 09:00 UTC" (`queued`); plus "next try …" on waiting rows.
  - Age: "stuck 25 min (claimed)", "no lease recorded", "4 h since it was due", "overdue by 20 min", "due in 3 h".
  - Re-send: "until 2026-10-07 09:00 UTC" (with "(within the business's sending hours)" on payment reminders, OP-7), "no: due more than 72 h ago", "no: the briefing's day has passed", "no: never re-sent on this queue", "no: a run holds it", "no".
  - Cancellable: "yes", "no: a run holds it", "no".
- **Header line** inside the panel: "Read-only. Re-send and cancel come in a later release; these columns show which items would qualify. Failed items keep no failure time, so their age is counted from when they were due."
- **Paging**: "Showing 51–100 of 132", with "Previous" and "Next" buttons, disabled at the ends and while loading.
- **States**: loading (`aria-busy`), empty ("No items in this state."), error (a fixed sentence: "Could not load the items. Try again in a moment."; 401/403: "Your admin session has ended. Sign in again."). The server's `error` and `details` are never rendered.
- **Refresh**: the panel refetches when `refreshKey` changes. The view bumps it after every `load()`, so Refresh and a finished Drain now also refresh an open list (FR-Q7).
- Logging: `createLogger({ module: 'AdminQueueItemsPanel' })`, `logger.error({ err, queue, state }, 'Queue items request failed')`. No row value is logged.
- No green class: the panel uses the grey and amber tones only.

**New `app/admin/components/jobs/jobsFormat.ts`** (pure, no imports): `formatUtc` and `ageWords` move here from `JobsQueuesView.tsx`, so the panel and the view share them without a circular import. `JobsQueuesView.tsx` imports them and re-exports `formatUtc` (the render test imports it from the view).

**`JobsQueuesView.tsx`**: `QueueCard` gets a "View items" / "Hide items" toggle button (`aria-expanded`) under the figures and renders `<QueueItemsPanel queueId={…} queueLabel={queue.label} refreshKey={refreshKey} />` when open. It is narrowed by 7d's existing `isDrainQueueId` type guard (W7D-8), so no `as` cast. The header sentence, the Drain now dialog and the single jobs `fetch(` are unchanged. The toggle shows even when the card's figures failed to load.

**`page.tsx`**: comment only ("read-only apart from Drain now; the per-queue item list is read-only").

### 2.8 Guard amendments (OP-3 style)

Narrowly, in `app/admin/__tests__/jobsQueues.source.guard.test.ts`:
- `page.tsx` and `JobsQueuesView.tsx`: **every rule unchanged**. The view still says "Drain" exactly once, has exactly one `fetch(` (the jobs GET), and no `Retry|Requeue|Cancel`. "View items" / "Hide items" contain none of the forbidden words.
- **`QueueItemsPanel.tsx` joins `FILES` and `CLIENT_FILES`**, so it gets every original read-only rule: client component, C-21 imports (`import type` only from `lib/admin/jobs` and `lib/cron`), no `Retry|Requeue|Cancel|Drain` as words, no `method: 'POST'|'PUT'|'PATCH'|'DELETE'`, no console, no `OK`. The copy in §2.7 is written to pass this (for example "Cancellable" and "cancel" do not match `\bCancel\b`).
- New panel-only assertions: exactly one `fetch(`; its first argument starts with the template literal `` `/api/admin/jobs-queues/items? ``; no `method:` key at all; the query is built from `queue`, `state` and `page` only; no green class.
- `jobsFormat.ts` joins the console and C-21 checks (it has no imports).

In `jobsQueues.render.test.tsx`, the button test becomes: "the only buttons are Refresh, one Drain now and one View items per queue": **1 + 5 + 5** buttons with every panel closed, and each `queue-<id>` section has exactly two buttons, "Drain now" and "View items".

In `lib/admin/jobs/__tests__/readJobsQueues.test.ts`, the C-6 guard's file list ("`lib/admin/**` never names an admin repository") gains `lib/admin/jobs/queueItemEligibility.ts` and `lib/admin/jobs/buildQueueItemsView.ts`. This is an extension, not a loosening.

In `lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts`, the figures test switches from `ADMIN_QUEUE_SELECTABLE_COLUMNS` to `ADMIN_QUEUE_FIGURE_COLUMNS`. That **tightens** the figures read back to the original four columns, so the widening cannot loosen it. A new test pins `ADMIN_QUEUE_SELECTABLE_COLUMNS` by exact equality.

### 2.9 Access doc

`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`, minimal edits:
- register row **92** `jobs-queues/items#GET`;
- an "88 → 89 (2026-10-0x)" note under As-Built State, re-measured from disk;
- a Change History row;
- the headline figures, the "What is true" row, the register heading "(89)" and its summary line ("83 `requireAdmin` · 6 inline · 0 open", "92 rows, 89 live"), updated in place. SA's CR7D-1 ruling on 7d made this required: a supersede note under a stale headline is not accepted. These are figure and date substitutions only (OP-12).

The requirement is **not** edited by Dev.

---

## 3. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/admin/jobs/queueItemEligibility.ts` | create | The C7-9 shared pure function and the §C matrix as data (reused by 7b/7c) |
| `lib/admin/jobs/buildQueueItemsView.ts` | create | Pure mapping: field allow-list, fixed labels, due, age, eligibility |
| `lib/admin/jobs/jobsQueuesTypes.ts` | modify | Wire types `QueueItemState`, `QueueItemView`, `QueueItemsView` (types only, runtime-free) |
| `lib/repositories/AdminJobsQueuesRepository.ts` | modify | `listQueueItemsAllAccounts`; column constants; shared filter helpers; header comment (SC-9(b) amended by C7-12) |
| `app/api/admin/jobs-queues/items/route.ts` | create | The read route (C7-14) |
| `app/admin/components/jobs/QueueItemsPanel.tsx` | create | The per-queue list |
| `app/admin/components/jobs/jobsFormat.ts` | create | `formatUtc` and `ageWords`, moved from the view |
| `app/admin/components/jobs/JobsQueuesView.tsx` | modify | "View items" toggle, panel, `refreshKey`; formatters imported |
| `app/admin/jobs-queues/page.tsx` | modify | Comment only |
| `lib/admin/jobs/__tests__/queueItemEligibility.test.ts` | create | Per-queue matrix, 72 h boundary, same-day briefing |
| `lib/admin/jobs/__tests__/buildQueueItemsView.test.ts` | create | Labels, field allow-list, name fallbacks, age, sentinel |
| `lib/repositories/__tests__/AdminJobsQueuesRepository.test.ts` | modify | Figures pin tightened; new `describe` for the list method |
| `app/api/admin/jobs-queues/items/__tests__/route.test.ts` | create | Gate, Zod, per-queue/state, paging, name lookup, sentinel, no write, no audit |
| `app/admin/__tests__/jobsQueues.items.render.test.tsx` | create | Panel behaviour and sentinel |
| `app/admin/__tests__/jobsQueues.source.guard.test.ts` | modify | §2.8 |
| `app/admin/__tests__/jobsQueues.render.test.tsx` | modify | 1 + 5 + 5 buttons |
| `lib/admin/jobs/__tests__/readJobsQueues.test.ts` | modify | Add the two new `lib/admin/jobs` modules to the C-6 "never names an admin repository" list |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | §2.9 |
| `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7A_WORKPLAN.md` | create | This file |

**Explicitly not touched:** the five cron routes, the five service files, every queue repository other than `AdminJobsQueuesRepository`, `BusinessProfileRepository` (reused as is), `lib/cron/*`, `vercel.json`, `app/api/admin/jobs-queues/route.ts`, the drain route and `DrainNowDialog.tsx`, `lib/admin/jobs/{readJobsQueues,buildJobsQueuesView,runQueueDrain,drainCounts}.ts`, `adminGate.writes.test.ts`, the admin authz guard and its `CAPS`, `lib/audit/*` (no new event), the requirement doc. No migration.

---

## 4. Task List

**SA conditions carried in:** C7-1 and C7-2 (as data and marks only), C7-5 (no retry mark on automations), C7-7 (same-day briefing), C7-9, C7-12, C7-13, C7-14, C7-15. SA's workplan review governs where it differs from this list.

- [ ] **T1** Confirm the branch (`git branch --show-current` = `feature/admin-queue-item-list`). Re-count `console.*` in every file marked "modify" (expected 0; C7-15). Re-run the census (expected 59 files / 88 = 82 + 6 + 0 before).
- [ ] **T2** Write the tests first for the pure modules (§5.4, §5.5) and run them red.
- [ ] **T3** `queueItemEligibility.ts`, then green.
- [ ] **T4** Repository: column constants, the shared filter helpers lifted out of the figures read, `listQueueItemsAllAccounts`, and the header comment. Tighten the figures column pin and add the list tests (§5.3). The existing figures and `qa-slice5-pr2.queueSemantics` suites must pass unedited apart from the one pin.
- [ ] **T5** Wire types in `jobsQueuesTypes.ts`; `buildQueueItemsView.ts`, then green.
- [ ] **T6** Route and route tests (§5.1, §5.2, §5.6, §5.7).
- [ ] **T7** `jobsFormat.ts` (moved formatters), `QueueItemsPanel.tsx`, the `JobsQueuesView.tsx` wiring, the `page.tsx` comment.
- [ ] **T8** Guard and render amendments (§2.8) and the new render suite (§5.8).
- [ ] **T9** Access doc (§2.9), with the census re-measured from disk (expected 60 files / 89 = 83 + 6 + 0).
- [ ] **T10** Local runs: the new and amended suites; `npx jest app/api/admin lib/admin lib/repositories/__tests__/AdminJobsQueuesRepository lib/repositories/__tests__/adminReadMethods app/admin/__tests__`; `npm run test:authz-guard`; scoped `tsc` on the touched files (scratch tsconfig, the 7d method); `npm run lint` on the touched files; `npm run lint:hooks`. Record counts and any pre-existing red (the known `runRecord.adoption` › payment-reminders failure is not this slice's).
- [ ] **T11** `git diff --stat` check (no deletion-only file: the agent file-write hazard). Update Status to Code Complete and add Implementation Notes. Commit nothing.

---

## 5. Test Plan

All Jest. Mocks follow 7d: `@/lib/auth` (`getUser`), `@/lib/services/AdminAccessService`, `@/lib/logger` (records every call), and a recording Supabase client (records every builder call, including any `update`, `insert`, `upsert`, `delete` and `rpc`).

### 5.1 Gate: 401 and 403, with nothing read (`route.test.ts`)

| # | Case | Expect |
|---|---|---|
| G-1 | Signed out | 401. The repository and the name lookup are not called. No `from()` call |
| G-2 | Signed in, not an admin | 403, same assertions |
| G-3 | The admin check throws | 403, nothing read |
| G-4 | The auth lookup throws | 401, nothing read |
| G-5 | Invalid query **and** signed out | 401, not 400 (the gate wins) |
| G-6 | Source position | Inside `GET`, `await requireAdmin(` is preceded only by the correlation-id read and `logger.child(…)` (a regex over the source, the W7D-3 pin) |

### 5.2 Zod: 400 (`route.test.ts`)

| # | Query | Expect |
|---|---|---|
| Z-1 | no `queue` / `queue=nope` | 400 `invalid_input`, no read |
| Z-2 | `state=cancelled` / `state=` | 400 |
| Z-3 | `page=0`, `page=21`, `page=abc`, `page=1.5` | 400 each |
| Z-4 | an extra parameter: `accountId=…`, `userId=…`, `limit=500` | 400 each (strict) |
| Z-5 | `queue` only | 200 with `state: 'stuck'`, `page: 1` (the defaults) |
| Z-6 | `details` | present only when `NODE_ENV === 'development'` |
| Z-7 | Set-equality | `QUEUE_ITEM_QUEUE_IDS` equals `BOS_QUEUES.map(q => q.id)` and `Object.keys(ADMIN_QUEUE_SPECS)` |

### 5.3 Repository (`AdminJobsQueuesRepository.test.ts`, new `describe`)

| # | Assertion |
|---|---|
| R-1 | No context, or a context missing `correlationId` or `adminId` → error, **no request** |
| R-2 | `it.each` over 5 queues × 4 states: reads only `spec.table`; the select string equals exactly `ADMIN_QUEUE_ITEM_COLUMNS[queue].join(', ')` with `{ count: 'exact' }`; it never matches `/error_message\|skip_reason\|payload\|recommendation\|contact_id\|invoice_id\|installment_id\|booking_id\|entity_id\|rule_id\|trigger_event_id\|claimed_by\|dedupe_key\|channel\|\*/` |
| R-3 | **Per-state filters**, for each queue: `stuck` = `eq('status', inProgress)` + `or('claimed_at.is.null,claimed_at.lt."<now − 690 s>"')`; `failed` = `eq('status','failed')` + the null-safe marker exclusion (the marker, plus the two guardrail markers on payment automations); `dead_lettered` = `eq('status','failed').eq('error_message', MARKER)` or `eq('status','dead_letter')`; `waiting` = `eq('status','pending')` only. Each is compared with the matching figures query, built by the same helper, so list and count cannot drift |
| R-4 | Order per §2.1, with `id` as the tie-breaker |
| R-5 | **Cap and paging:** page 1 → `range(0, 49)`; page 2 → `range(50, 99)`; page 20 → `range(950, 999)`; page 0 or 21 → error, no request. A client that returns 60 rows → 50 returned |
| R-6 | `total` comes from the response `count`; `null` count → 0 |
| R-7 | **Field allow-list:** a row carrying planted `error_message`, `skip_reason`, `payload`, `contact_id`, `claimed_by` values maps to a `RawQueueItem` with exactly the documented keys, and none of the planted values |
| R-8 | A malformed row (non-integer `attempts`, missing `id`) fails the read |
| R-9 | A Supabase error → `{ data: null, error }` with its code. The `warn` log carries the code, not the message (planted message text is absent from every log call) |
| R-10 | The `info` log carries `queue, state, page, returned, total` and ids only: no row value |
| R-11 | No `update`, `insert`, `upsert`, `delete` or `rpc` call on any path |
| R-12 | `ADMIN_QUEUE_SELECTABLE_COLUMNS` equals exactly the union in [section 6](#6-column-allow-list-per-table); the figures read still selects only `ADMIN_QUEUE_FIGURE_COLUMNS` (the tightened pin) |
| R-13 | The existing "only `app/api/admin/**` names it" guard passes with the new route as a caller |

### 5.4 The 72-hour window function (`queueItemEligibility.test.ts`), per queue

`it.each` over the five queues, with a fixed `now`:

| # | Case | Expect |
|---|---|---|
| E-1 | Matrix: every status in the table's vocabulary (from `ADMIN_QUEUE_SPECS.known`) × `claimed_at` NULL / set | Retry and cancel exactly per §C. A leased in-progress row → retry `not_retryable_state`, cancel `leased` (C7-2). An orphaned in-progress row → cancel allowed, retry not. Every terminal status → neither |
| E-2 | **Payment reminders**, `failed`, `scheduled_at = now − 72 h` exactly | Retry allowed, `until = scheduled_at + 72 h` |
| E-3 | Same, `now − 72 h − 1 ms` | `retry_window_passed` |
| E-4 | Same, `retryAt` option later than the window although `now` is inside it | `retry_window_passed` (the 7c sending-hours hook) |
| E-5 | **Lead replies** and **insight actions**: E-2/E-3 with `created_at` as the anchor; a `scheduled_at` value is ignored | As E-2/E-3 |
| E-6 | **Payment automations**, every status | Retry always `retry_not_offered` (C7-5); cancel per §C, including `dead_letter` and a `pending` row with no `scheduled_at` |
| E-7 | **Briefing**, `failed`, `briefing_date` = today in `Asia/Jerusalem` at 23:59 local | Allowed, `until` = that day's `endUtc` |
| E-8 | Same row one minute after local midnight | `briefing_not_today` (yesterday's row) |
| E-9 | A row whose `briefing_date` is today in its own zone but yesterday in UTC (for example `America/Los_Angeles` at 18:00 local) | Allowed: the row's zone governs, not UTC |
| E-10 | Briefing with an unusable timezone | Falls back to UTC, the same as `businessDayFor` |
| E-11 | NULL or unparseable anchor | `no_due_time`; cancel unaffected |
| E-12 | `RETRY_FROM_STATUSES` / `CANCEL_FROM_STATUSES` keys set-equal to `BOS_QUEUES` ids; `payment_automations` retry list is empty |
| E-13 | Purity: no `Date.now()` or `new Date()` without an argument in the module source (a source assertion) |

### 5.5 The builder (`buildQueueItemsView.test.ts`)

| # | Case | Expect |
|---|---|---|
| B-1 | Kind labels: every known value per queue, plus `'something_new'` and `null` | The fixed label, or "Other" |
| B-2 | Names: found / empty name / no profile row / lookup failed (`names = null`) | The name / "Business without a name" / "No business profile" / "Name not available" |
| B-3 | `due` basis per queue | `scheduled` (payment tables), `business_day` (briefing), `queued` (lead replies, insight actions) |
| B-4 | `age` per state | since claimed (stuck with a lease), `no_lease`, since due (failed, dead-lettered), overdue or not yet due (waiting, effective due incl. `next_attempt_at`) |
| B-5 | `errorCategory` | `dead_lettered` / `failed` / `null` by state |
| B-6 | Exact keys | Each item has exactly the `QueueItemView` keys; the view has exactly `queue, state, now, page, pageSize, total, hasMore, items` |
| B-7 | **Sentinel** | Input rows carry `userId: 'SENTINEL-ACCOUNT-…'`, `timezone: 'SENTINEL/Zone'`, and planted extra properties (`error_message`, `skip_reason`, `payload`, `recommendation`, `contact_id`, `invoice_id`, `booking_id`, `email`) set to `SENTINEL-*`. `JSON.stringify(view)` contains no `SENTINEL` and no `@` |
| B-8 | More rows than `pageSize` | Truncated to `pageSize`; `hasMore` from `total` |

### 5.6 Per-queue status filters and paging, through the route (`route.test.ts`)

- `it.each` 5 queues × 4 states: the repository mock is called once with `(context, queue, state, now, { page: 1 }, { signal })`, where `context` = `{ correlationId, adminId }`. The response `data.queue` and `data.state` echo the input.
- `page=3` → `{ page: 3 }`; `total: 132` → `hasMore` true on page 2, false on page 3.
- The name lookup is called **once** with the **distinct** user ids of the page (a page with 50 rows from 3 accounts → 3 ids).
- Names fail or time out → 200, "Name not available", one `warn` with a code and no message.
- The items read fails → 500 standard format, `details` only in development, no `items`.
- The items read times out (the deadline) → 500.

### 5.7 Sentinel and no write (`route.test.ts`)

| # | Case | Expect |
|---|---|---|
| S-1 | The repository mock returns rows with `userId: 'SENTINEL-ACCOUNT'` and planted extra fields (`error_message: 'SENTINEL-ERR'`, `skip_reason: 'SENTINEL-SKIP'`, `payload: { to: 'sentinel@client.test' }`, `recommendation: 'SENTINEL-REC'`, `contact_id`, `invoice_id`, `booking_id`, `entity_id` = `SENTINEL-*`), for all five queues | The serialised body, `JSON.stringify` of every logger call, contain no `SENTINEL`, no `@`, no `client.test` |
| S-2 | The name lookup returns `{ user_id, company_name: 'Acme', vertical: 'SENTINEL-VERTICAL' }` | "Acme" is in the body (by design); the vertical and the `user_id` are not; the logs do not contain "Acme" |
| S-3 | No write | The recording client sees no `update`/`insert`/`upsert`/`delete`/`rpc`. `logAndFlush` and `AuditTrailService.log` are not called (mocked spies) |
| S-4 | The 500 path with a planted error message | The message is absent from the production body |

### 5.8 UI (`jobsQueues.items.render.test.tsx`)

| # | Case | Expect |
|---|---|---|
| U-1 | The page renders | Each `queue-<id>` section has a "View items" button (also when that card's figures are `null`); no panel is open; one jobs request only |
| U-2 | Open `lead_responses` | One request to `/api/admin/jobs-queues/items?queue=lead_responses&state=stuck&page=1` with `cache: 'no-store'` and no `method`. The "Stuck" tab is pressed. The toggle reads "Hide items" with `aria-expanded="true"` |
| U-3 | Rows | Business name, the 8-character item id (full id in `title`), kind label, status label, due, attempts, age, re-send and cancellable words, for each `due.basis`, `age.basis` and refusal code |
| U-4 | Tabs | "Dead-lettered" → `state=dead_lettered&page=1`; changing a tab after paging resets to page 1 |
| U-5 | Paging | "Showing 1–50 of 132"; "Next" → `page=2`; "Previous" disabled on page 1, "Next" disabled on the last page; both disabled while loading |
| U-6 | Empty | "No items in this state." |
| U-7 | Error (500, non-JSON) and 401/403 | The fixed sentences; the server's `error`/`details` text is never rendered |
| U-8 | **Sentinel** | A response whose items carry extra `error_message`, `skip_reason`, `payload`, `userId` fields set to `SENTINEL-*` renders none of them |
| U-9 | No action | Inside an open panel, no button's text matches `/retry\|re-send\|cancel\|requeue\|release\|drain/i` (the "Re-send" and "Cancellable" column headers are `th`, not buttons) |
| U-10 | Refresh | Pressing the page's Refresh refetches the jobs view **and** the open panel's items |
| U-11 | Payment reminders row with `retry.allowed` | Shows "(within the business's sending hours)" |

Amended (§2.8): `jobsQueues.source.guard.test.ts` and `jobsQueues.render.test.tsx`.

### 5.9 Unchanged suites that must stay green

`app/api/admin/jobs-queues/__tests__/*`, `app/api/admin/jobs-queues/drain/__tests__/*`, `lib/admin/jobs/__tests__/*` (existing), `lib/repositories/__tests__/qa-slice5-pr2.queueSemantics.test.ts`, `lib/repositories/__tests__/adminReadMethods.guard.test.ts`, `app/admin/__tests__/jobsQueues.drain.render.test.tsx`, `app/admin/__tests__/health*.test.ts(x)`, `app/api/admin/__tests__/adminGate.writes.test.ts` (unedited, 58), `lib/admin/__tests__/admin-authz-surface.guard.test.ts`.

---

## 6. Column Allow-List per Table

The exact select per table. `ADMIN_QUEUE_ITEM_COLUMNS` holds these lists; R-2 pins them.

| Table | Columns selected by `listQueueItemsAllAccounts` |
|---|---|
| `payment_reminders` | `id, user_id, status, attempts, claimed_at, created_at, scheduled_at, next_attempt_at, reminder_type` |
| `payment_automation_executions` | `id, user_id, status, attempts, claimed_at, created_at, scheduled_at, next_attempt_at` |
| `daily_briefing_sends` | `id, user_id, status, attempts, claimed_at, created_at, next_attempt_at, briefing_date, timezone` |
| `lead_responses` | `id, user_id, status, attempts, claimed_at, created_at, next_attempt_at, kind` |
| `insight_actions` | `id, user_id, status, attempts, claimed_at, created_at, next_attempt_at, kind` |

**Widening of `ADMIN_QUEUE_SELECTABLE_COLUMNS`:** from `id, scheduled_at, next_attempt_at, created_at` to those plus **`user_id, status, attempts, claimed_at, reminder_type, kind, briefing_date`** (exactly C7-12's list) **and `timezone`** (beyond C7-12; OP-2).

What each one is for:

| Column | Used for | In the response? |
|---|---|---|
| `id` | the item id (7b/7c) | yes |
| `user_id` | the business-name lookup | **no** |
| `status` | the label and 7b's `expected.status` | yes (platform word) |
| `attempts` | the attempts column and 7b's `expected.attempts` | yes |
| `claimed_at` | stuck age; orphan vs leased (C7-2) | no (as `age` and `lease` only) |
| `created_at` | §E anchor (lead replies, insight actions), waiting order | as `due.at` for `queued` only |
| `scheduled_at` | §E anchor (payment tables) | as `due.at` |
| `next_attempt_at` | effective due of waiting rows | yes, waiting rows only |
| `reminder_type`, `kind` | the fixed kind label | **no** (label only) |
| `briefing_date` | §E anchor and C7-7 | as `due.date` |
| `timezone` | C7-7 "today in the row's timezone" | **no** |

**Never selected:** `error_message` (filters only, against fixed markers), `skip_reason`, `claimed_by`, `sent_at`, `executed_at`, `channel`, `invoice_id`, `installment_id`, `contact_id`, `entity_id`, `entity_type`, `rule_id`, `trigger_event_id`, `dedupe_key`, and every payload or recommendation column.

**To verify live before merge (OP-3):** a zero-row select of each list above (`limit(0)`, service role, read-only), per the `business-os-schema-check` skill. SA §A lists all of them as present, but §A lists the shared columns as "the claim set" without spelling `created_at` out for the three non-payment tables and payment automations.

---

## 7. Manual QA Check

On a preview or local build, signed in as a platform admin:

| # | Step | Expect |
|---|---|---|
| M-1 | Open `/admin/jobs-queues` | Each queue card has "View items" beside the figures, and Drain now as before. No panel is open |
| M-2 | Open a queue whose card shows a stuck or dead-lettered count | The list opens on "Stuck". Switch to "Dead-lettered": the "Showing … of N" total equals the card's all-time figure for that state (the card shows 24 h / 7 d; N may be larger, by design) |
| M-3 | Read a row | Business name, short item id, kind label, status, due, attempts, age, re-send and cancellable. No email address, client name, message text, error text or account id anywhere (also check the network response in DevTools) |
| M-4 | A failed lead reply or insight action queued more than 72 hours ago | Re-send reads "no: due more than 72 h ago"; cancellable "yes" |
| M-5 | Payment automations, any row | Re-send reads "no: never re-sent on this queue" |
| M-6 | Paging on a queue with more than 50 items in a state (if any) | "Next" moves to 51–100 |
| M-7 | Press Refresh, or finish a Drain now, with a panel open | The list reloads |
| M-8 | As a non-admin: `curl '<host>/api/admin/jobs-queues/items?queue=lead_responses'` | 401 or 403 |
| M-9 | `git diff origin/main -- app/api/cron lib/services lib/cron vercel.json lib/audit app/api/admin/__tests__/adminGate.writes.test.ts` | Empty |

---

## 8. Acceptance Criteria Traceability

| Criterion | Where |
|---|---|
| FR-Q5: list individual items, metadata only (queue, item id, status, attempts, due, age, business name, dead-lettered) | §2.4, §2.7, §5.5–§5.8 |
| §9: no payload, message text, error message, skip reason or client detail in the page or its API responses (tested on the serialised response) | §5.5 B-7, §5.7 S-1/S-2, §5.8 U-8 |
| FR-Q6 / OQ-3 / C7-9: the 72-hour mark from one shared function, unit-tested per queue with the boundary | §2.2, §5.4 |
| C7-1 / C7-2 / C7-5 / C7-7: the matrix as data, leased rows never actionable, no retry on automations, same-day briefing | §2.2, §5.4 E-1/E-6/E-7..E-10 |
| C7-12: one repository method, deliberate widening, service role documented, admin-only callers | §2.3, §6, §5.3 |
| C7-13: fixed labels, no account id, sentinel test | §2.5, §5.5, §5.7 |
| C7-14: `requireAdmin` first, correlation id, four denial cases, register, census, no cap | §2.6, §5.1, §2.9, T9, T10 |
| C7-15: Pino only, error format | §1.5, §2.6, §5.2 Z-6 |
| FR-Q7: refreshed counts and list | §2.7 `refreshKey`, §5.8 U-10 |
| CLAUDE.md Testing: happy path, auth failure, invalid input; a test per repository method | §5.1, §5.2, §5.3, §5.6 |

---

## 9. Risks and Rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| A private field reaches the response through a new column or a spread | Low | Exact select per table (R-2), field-by-field mapping in the repository (R-7) **and** the builder (B-6), sentinel tests on the body, the logs and the UI |
| The list disagrees with the card's counts | Low | Shared filter helpers (R-3). Only the 24 h / 7 d window differs, by design, and M-2 says so |
| An admin reads "re-send until …" as a promise for payment reminders | Medium | "(within the business's sending hours)" on those rows; 7c refuses with the exact reason (OP-7) |
| An admin expects buttons and finds none | Low | The panel's header line says actions come later |
| A failed-state list on a large table is slow (no index on `(status, created_at)` for lead replies or insight actions) | Low at current volume | 50 rows a page, 20 pages at most, a 5 s deadline, and a clean 500. Index work, if ever needed, is its own reviewed migration |
| Business name lookup fails | Low | The list is still served with "Name not available" |
| The widened allow-list loosens the figures read | None by design | The figures pin is tightened to the original four (§2.8, R-12) |
| Two businesses with no name look the same | Low | Accepted (OP-1); the item id distinguishes the items |
| Amending the read-only guards | Medium (process) | The panel gets **every** original read-only rule plus a one-GET pin; the page and the view rules are unchanged (§2.8) |

**Rollback:** one PR, no migration, no data, no write path. Reverting it removes the route, the panel, the pure modules and the repository method, and restores the guards. The access doc row 92 is struck in the same revert. Nothing in 7d depends on 7a. 7b and 7c depend on 7a's eligibility module, so a revert of 7a after 7b/7c ship must revert those first.

---

## 10. PR Body Draft

```markdown
## feat(admin): read-only queue item list on Scheduled jobs & queues (ADMIN_BOS_CLEANUP slice 7a)

### What changes
- `/admin/jobs-queues`: each queue card gets **View items**. It opens a read-only list for that queue, with tabs for Stuck, Failed, Dead-lettered and Waiting, 50 items a page.
- Each row shows metadata only: business name, short item id, a fixed kind label, status, due time, attempts, how long it has been stuck or overdue, whether it could be re-sent (and until when), and whether it could be cancelled.
- New `GET /api/admin/jobs-queues/items?queue=&state=&page=` (`requireAdmin` first, strict Zod, 50-row pages, at most 20 pages).
- New `AdminJobsQueuesRepository.listQueueItemsAllAccounts`: service role, cross-account by design, one exact column list per table, the same stuck / failed / dead-lettered filters as the page's counts.
- New pure `queueItemEligibility`: the per-queue action matrix and the 72-hour rule (same business day for briefings, no re-send on payment automations). 7b (cancel) and 7c (re-send) will use the same function on the server.

### What it never does
- No action: no re-send, cancel or release. Drain now (7d) is still the page's only action.
- Never returns or logs an account id, error text, skip reason, payload, recommendation, or any contact, invoice or booking id. Kinds are mapped to fixed labels on the server.
- No write, no audit row (a read, like the page's existing route), no migration, no change to any cron or drain.

### Registrations
- access register row 92, census 89 = 83 + 6 + 0, 60 files
- `adminGate.writes` unchanged (58); the route has its own four denial cases
- no guard cap moved

### Tests
Route (gate 401/403 with nothing read, Zod 400, every queue × state, paging and the cap, name-lookup failure, sentinel no-leak over body and logs, no write), repository (exact columns, filters shared with the counts, range, field allow-list), the 72-hour function per queue with the boundary, the builder, the panel (render, tabs, paging, sentinel, no action buttons). Amended deliberately: the jobs page guard (the new panel gets every read-only rule plus one GET) and the render test (one View items per queue).

### Rollback
Revert the PR. No migration and no data.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 11. Effort Estimate

| Part | Hours |
|---|---|
| T1 census and counts | 0.25 |
| T2–T3 eligibility module and its per-queue tests | 2.5 |
| T4 repository method, shared filters, tests | 2.5 |
| T5 builder, labels, tests | 1.5 |
| T6 route and route tests | 2.5 |
| T7 panel, formatters move, view wiring | 2.5 |
| T8 guard and render amendments, panel render suite | 1.5 |
| T9 access doc | 0.5 |
| T10–T11 local runs, notes | 1 |
| **Total** | **about 14.75 h, about 1.8 days (S–M)**, within SA's 1.5–2 days |

---

## 12. Open Points for SA

| # | Point | Dev default |
|---|---|---|
| **OP-1** | **What identifies the business.** C7-12 says business names come from `business_profiles.company_name` through a repository read, and FR-Q5 lists "the business name"; C7-13 forbids the account id. I reuse `BusinessProfileRepository.findAdminIdentitiesByUserIds` (already admin-only, already pinned by `adminReadMethods.guard`) and show `company_name` only: no `vertical`, email or id. Fallbacks: "Business without a name", "No business profile", "Name not available". Two unnamed businesses therefore look alike; the item id still tells the items apart. Is the business name alone right, or should an unnamed business get a non-identifying tag? | Business name only, with the fixed fallbacks. No new identifier |
| **OP-2** | **`daily_briefing_sends.timezone` is outside C7-12's widened list**, but C7-7 needs "today in the row's timezone" to mark a briefing "re-send until …" or "day has passed". It is read on the server and never returned | Add `timezone` to the allow-list for that table only |
| **OP-3** | **Live column check.** Dev has no DB access. Please run (or have QA run) a zero-row select of each list in [section 6](#6-column-allow-list-per-table) before merge, and record it in the review. §A covers them, but names `created_at` only for `payment_reminders` explicitly. Also, if convenient, `select distinct reminder_type from payment_reminders` (no CHECK on that column), to see whether "Other" will appear | SA/QA runs it; Dev records the result |
| **OP-4** | **Payment automations have no kind label.** C7-12 does not list `entity_type` or `rule_id`, and neither is needed | A fixed "Payment automation" label; no extra column |
| **OP-5** | **Guardrail decisions on payment automations** (status `failed` with `max executions reached` / `cooldown active`) are not errors, and the card counts them apart. The list's "Failed" tab excludes them, as the card does. They are cancellable under §C, so 7b may want them visible | Exclude in 7a. If 7b needs them, it adds a "Guardrail decisions" tab for that queue |
| **OP-6** | **SA §M names five states** (waiting, stuck, failed, dead-lettered, cancellable). 7a has four tabs. "Cancellable" is a union across states and statuses, and each row already carries its own cancellable mark | Four tabs now. Revisit "cancellable" in 7b, when there is a cancel button to go with it |
| **OP-7** | **Payment reminder re-send window in the list.** The list can only say "until `scheduled_at + 72 h`". 7c will also refuse when the next sending-hours time falls after that (C7-8), and the public `sendableAt` wrapper arrives with 7c. The eligibility function already takes `retryAt` for that | Show the upper bound with "(within the business's sending hours)". Do not pull the C7-8 wrapper into 7a |
| **OP-8** | **Paging.** Fixed 50-row pages, 1-based `page`, at most page 20 (1,000 rows). Offset paging (`range`) with `id` as tie-breaker, and `count: 'exact'` in the same request. Failed and dead-lettered are not time-windowed; they are newest first | As stated. Keyset paging only if a queue ever exceeds the cap in practice |
| **OP-9** | **The item id is in the response** (the full uuid of the queue row). 7b/7c need it for the action, and FR-Q5 lists it. It is not an account id. The UI shows 8 characters with the full id in a tooltip | Return the full id |
| **OP-10** | **No audit row for the read.** `jobs-queues#GET` and `health-summary#GET` write none; this list shows business names across accounts but no client data | No audit row; the Pino line with counts is the trace |
| **OP-11** | **Guard amendment form.** `QueueItemsPanel.tsx` joins the read-only file set with every original rule (no action words, no write method, no console, no `OK`), plus: exactly one `fetch(`, to the `` `/api/admin/jobs-queues/items? `` template, no `method:`, no green. The page and view rules are unchanged; the render test goes to 1 + 5 + 5 buttons | Approve this narrow form |
| **OP-12** | **Access doc headline.** The brief for this workplan says "targeted insertions only" for docs, but SA's CR7D-1 on 7d required the headline figures, "What is true", the register heading and its summary line to be updated in place. I plan to follow CR7D-1 (figure and date substitutions only) | Follow CR7D-1 |
| **OP-13** | **`formatUtc` and `ageWords` move** from `JobsQueuesView.tsx` to a new `jobsFormat.ts`, so the panel can share them without a circular import. The view re-exports `formatUtc` for the existing render test | Move them; no behaviour change |

---

## SA Review Notes

### SA Workplan Review (2026-10-04)

**Reviewed by SA — 2026-10-04.** **Status: ✅ APPROVED WITH CONDITIONS (W7A-1..W7A-12).** Measured on `feature/admin-queue-item-list` @ **`61bda100`** (HEAD and branch verified). Reviewed against C7-1..C7-16 with the 2026-10-04 7d amendments, the §C matrix, the §E "due" table, backlog BL-7a..BL-7c, the 7d workplan and its SA reviews (W7D-*, CR7D-*), CLAUDE.md, and the `new-repository`, `new-api-route`, `tenant-isolation-guard` and `business-os-schema-check` skills. The design is right and proportionate: one repository method on the existing admin repository, a pure eligibility module, a pure builder, one gated GET, and a read-only panel. No migration, no write, no audit row, no new pattern. The conditions fix one contradiction in the eligibility order (W7A-1), one live-proven failure path in paging (W7A-2), three ordering and copy details, and one race in the panel.

#### A. Live schema check (OP-3), read-only, `business-os-schema-check`

Service role, against the live project, from a scratch script. Only `GET` with `limit=0`, and `HEAD` with `Prefer: count=exact`. No RPC, no write, and no row content was read.

| Check | Result |
|---|---|
| Zero-row select of the exact [section 6](#6-column-allow-list-per-table) list, `payment_reminders` | **200 `[]`** |
| … `payment_automation_executions` | **200 `[]`** |
| … `daily_briefing_sends` (incl. `briefing_date, timezone`) | **200 `[]`** |
| … `lead_responses` (incl. `kind`) | **200 `[]`** |
| … `insight_actions` (incl. `kind`) | **200 `[]`** |
| Negative control: `payment_reminders` `id, updated_at` | **400 `42703`** (column does not exist) |
| Negative control: `lead_responses` `id, scheduled_at` | **400 `42703`** |
| Negative control: `payment_automation_executions` `id, kind` | **400 `42703`** (confirms OP-4: no kind column) |

So every column in section 6 exists, `created_at` included on all five tables, and the probe rejects a phantom the same way the real select would.

**`reminder_type` vocabulary, by count only.** I did not run `select distinct`: PostgREST has no `DISTINCT`, and a plain select of the column would read row values. Counting per known value answers the question without reading any row: `upcoming_due` 60, `due_today` 53, `overdue` 16, `retry_failed` 0, `payment_received` 0, **not in the five known values: 0**, NULL: 0. "Other" will not appear today. `daily_briefing_sends.timezone` IS NULL: 0.

**Volumes (head counts):** `payment_reminders` 129 (65 `pending`), `daily_briefing_sends` 77, `lead_responses` 20, `payment_automation_executions` 0, `insight_actions` 0. **Zero rows are `failed`, `dead_letter`, `processing` or `running` on any of the five tables.** `count: 'exact'` on these sizes costs nothing; the 5 s deadline and the 50 × 20 cap are ample (OP-8).

**Paging past the end, live:** `lead_responses?select=id&offset=100000&limit=50` with `Prefer: count=exact` returns **HTTP 416, `PGRST103` "Requested range not satisfiable"**, both as URL offset (what `supabase-js` `.range()` sends) and as a `Range` header. As written, a page past the end is a 500 "Could not load the items". That happens in normal use: an admin on page 2 of "Waiting" presses Drain now, the list shrinks, and the `refreshKey` refetch asks for page 2 again. W7A-2 fixes it.

#### B. Re-check of the workplan's facts

| Item | Workplan | Measured on `61bda100` | Verdict |
|---|---|---|---|
| Admin route census (the guard's handler regex, scratch script) | 59 files / 88 handlers | **59 files / 88 handlers** | ✅ (a plain `grep` reports 85 here because of line endings; the guard's own form-1/form-2 regexes give 88) |
| After 7a | 60 / 89 = 83 + 6 + 0, row 92 | consistent | ✅ |
| `adminGate.writes` `CASES` | 58, unchanged | `toHaveLength(58)` at `:395` | ✅ (ruling below) |
| Access doc register | rows to 91 | row 91 `jobs-queues/drain#POST`, "91 rows, 88 live" at `:129` | ✅ |
| Figures read column pin | "the existing test pins the columns" | `AdminJobsQueuesRepository.test.ts:93` asserts every selected column is **in** `ADMIN_QUEUE_SELECTABLE_COLUMNS`. Widening that constant would silently loosen the figures read | ✅ The §2.8 swap to `ADMIN_QUEUE_FIGURE_COLUMNS` is **required**, not optional |
| `businessDayFor(now, tz)` | pure, DST-safe, UTC fallback | `businessDay.ts:99-131`: `isUsableTimezone` → `'UTC'`; `endUtc` is the **next** day's first instant, **exclusive** | ✅ (see W7A-7 on `until`) |
| `findAdminIdentitiesByUserIds` | reused as is | selects `user_id, company_name, vertical, sub_vertical`, chunked `.in()`, logs counts at `debug`, takes **no abort signal** | ✅ (W7A-9) |
| Jobs route clock | minute-floored | `jobs-queues/route.ts:74` `Math.floor(Date.now() / 60_000) * 60_000` | ✅ The list and the card share the stuck cut-off |
| `BosQueueId` vs `AdminQueueId` | — | identical five-member unions in two modules | ✅ Z-7 set-equality keeps them aligned |

#### C. The shared eligibility module (C7-9)

**Does it encode §C exactly?** Yes, with one ordering contradiction (W7A-1). Cell by cell: leased in-progress rows are never actionable (retry `not_retryable_state`, cancel `leased`) ✅; orphaned in-progress rows are cancel-only ✅; payment automations never retry ✅; lead replies and insight actions retry only from `failed`, which on those tables includes dead-lettered rows (status `failed` + marker) ✅; briefings only while `briefing_date` equals `businessDayFor(now, row.timezone).date` ✅; payment reminders within `scheduled_at + 72 h`, with the sending-hours `retryAt` left to 7c through the `options.retryAt` hook ✅. Cancel "from" sets match §C per table, including `dead_letter` and the no-due-time `pending` on automations ✅. `skipped`, `sent`, `completed`, `cancelled` give neither ✅.

**The boundary.** The function allows `retryAt ≤ anchor + 72 h`. The 7c CAS predicate is `.gte(anchor, now − 72 h)`, that is `anchor ≥ now − 72 h`, the same inequality when `retryAt = now`. Postgres keeps microseconds and `Date.parse` truncates to milliseconds, so the stored anchor is always ≥ the parsed one. The CAS is therefore **never stricter** than the function: the function can only refuse slightly earlier, never allow what the CAS will reject. That is the safe direction. Two consequences for 7c, recorded in the requirement note: (1) 7c must call the function with the **real** clock, not the minute-floored one the list uses; (2) for payment reminders, the CAS must compare against the eligible time, `.gte('scheduled_at', retryAt − 72 h)`, not against `now`, or the route and the CAS check different things.

**Is it safe to land in 7a before any action exists?** Yes. It is pure (no clock, no I/O, no logger), the client never imports it at runtime, and in 7a its output only labels cells. The risk is the opposite one: that 7b/7c "adjust" it locally. The pins below (E-1 matrix by `it.each`, E-12 set-equality, E-13 purity) make any change visible in review. 7b/7c import it; they do not copy it.

#### D. Shared "stuck" (and failed/dead-lettered) filters

The extraction is safe **if** the figures read emits the identical builder calls in the identical order, from the same `now`-derived `stuckBefore`. The figures cases in `AdminJobsQueuesRepository.test.ts` record calls, so any drift fails them. Condition W7A-6. The list's failed and dead-lettered tabs are **not** windowed, so the list total can exceed the card's 7-day figure by design; M-2 says the card has an "all-time figure", which it does not (W7A-4).

#### E. Age counted from the due time

Honest, provided the words match the anchor. They do not yet for two of the five queues. For lead replies and insight actions the anchor is `created_at`, so "4 h since it was due" is wrong there: it is "since it was queued", and a chase queued two days ahead would show a large age before it was ever due. For the briefing, the anchor is the business day's first instant, so the words are "since its business day began". W7A-4.

#### F. Privacy

The allow-list, the field-by-field mapping in both the repository (R-7) and the builder (B-6), `error_message` in filters only, and three sentinel layers (builder B-7, route body and logs S-1/S-2, UI U-8) meet C7-13 and §9. `user_id`, `timezone`, `claimed_at` and the raw kind never leave the server. The route log carries counts only; the name lookup logs at `debug` with counts only. Approved as planned.

#### G. Rulings on the open points

| # | Ruling |
|---|---|
| **OP-1** | **Approved: `company_name` only, with the three fixed fallbacks.** It fits C7-13 (no account id) and C7-12 (names through a repository read). No non-identifying tag: a tag derived from the account id is an account id in disguise, and the item id already tells rows apart. The `vertical` returned by the lookup must not reach the response (S-2 pins it). One non-blocking question for the user is framed in §J below |
| **OP-2** | **Approved, and C7-12 is amended** (dated note in the requirement): `daily_briefing_sends.timezone` joins the allow-list for that table only, read on the server and never returned. It is the right source: the dispatcher renders with `row.timezone` and the enqueue keyed `briefing_date` on it, so "today" must be judged in that zone. `user_preferences.timezone` (CLAUDE.md's authority) is **not** the right input here: if the business changed zone after enqueue, the row's own zone is still the one its date was written in |
| **OP-3** | **Done by SA, results in §A.** All five lists present, three negative controls 42703. Vocabulary checked by counts, not by `distinct`. Dev records nothing further; QA need not re-run it unless the column lists change |
| **OP-4** | **Approved.** Fixed "Payment automation"; live probe confirms there is no `kind` column |
| **OP-5** | **Approved for 7a.** Guardrail decisions stay out of the Failed tab, matching the card. **7b must decide** whether to add a "Guardrail decisions" tab for payment automations, because §C makes them cancellable |
| **OP-6** | **Approved: four tabs.** §M's "cancellable" was a filter idea, not a state; each row carries its own mark. Revisit in 7b. §M is amended by note |
| **OP-7** | **Approved.** Upper bound with "(within the business's sending hours)". The C7-8 wrapper stays in 7c |
| **OP-8** | **Approved with W7A-2** (past-the-end page). Offset paging, `id` tie-breaker, `count: 'exact'` in the same request: fine at the measured volumes (≤ 129 rows per table) |
| **OP-9** | **Approved.** The full queue-row uuid is item metadata, not an account id, and FR-Q5 names it |
| **OP-10** | **Approved.** No audit row for a read, as `jobs-queues#GET` and `health-summary#GET`. The Pino line with counts and `adminUserId` is the trace |
| **OP-11** | **Approved in the narrow form stated**, plus W7A-10. The page and view rules are unchanged; the panel inherits every read-only rule and a one-GET pin |
| **OP-12** | **Follow CR7D-1:** in-place figure and date substitutions in the headline, "What is true", the register heading and its summary line, plus row 92, the As-Built note and a Change History row. "Targeted" means targeted Edits, not insert-only; a stale headline under a supersede note is not accepted |
| **OP-13** | **Approved.** No behaviour change; `jobsFormat.ts` has no imports and no `'use client'` (it is a module, not a component), so it joins the console and C-21 checks only, not the "is a client component" check. The drain render test, which may import `formatUtc` from the view, must stay green unedited |

**`adminGate.writes` (asked by TL): it stays at 58.** C7-14 rules that the 7a GET "gets its own four denial cases", and the direct precedent is `jobs-queues#GET` (row 84), which is not in `CASES`. The slice 1 GET list in that file (row 87 `admins#GET`) is a slice 1 inclusion, not a rule that every admin GET joins `CASES`; slice 7's own condition is the specific one. G-1..G-4 are the four denial cases; G-5 (401 before 400) and G-6 (first-statement position) are on top. Census **60 files / 89 = 83 + 6 + 0**, register row **92**, no `CAPS` move, no exemption: confirmed.

#### H. Conditions

| # | Where | Condition | Priority |
|---|---|---|---|
| **W7A-1** | §2.2 "Order of checks", E-1, E-6 | The order contradicts E-6: a leased `running` automation would get `not_retryable_state` by the stated order but `retry_not_offered` by E-6. **Rule: the queue rule for payment automations comes first**, so retry is `retry_not_offered` for every status on that queue (it is the 422 code C7-5 names for 7c). For the other four queues the stated order stands (state, then queue rule, then window). Add to E-1 an **unrecognised status** row per queue: neither retry nor cancel (fail closed) | High |
| **W7A-2** | §2.3, §2.6, §2.7, tests | **Page past the end (live-proven 416 `PGRST103`).** The repository maps `PGRST103` to a success: `{ rows: [], total: null }`, logged at `info` as "past the end", never a 500. The route returns 200 with `items: []`, `hasMore: false`, `total: null` (widen the wire type to `number \| null`, still exactly the listed keys). The panel, on `total: null` with `page > 1`, goes back to page 1 once, and also resets to page 1 whenever `refreshKey` changes. Tests: R-5 gains a `PGRST103` case; route 200 empty; U-5 gains "Drain shrinks the list while on page 2 → page 1" | High |
| **W7A-3** | §2.1, §2.3, R-4 | **Explicit NULL ordering.** Postgres puts NULLs **last** on `ASC` and **first** on `DESC`, so the stated orders need explicit options: stuck `claimed_at` ascending **`nullsFirst: true`** (orphans first, as §2.1 intends); failed/dead-lettered window column descending **`nullsFirst: false`** (an automation with no `scheduled_at` must not lead); waiting payment tables `scheduled_at` ascending `nullsFirst: false`. Extend the local `Query` interface with `range` and the `nullsFirst` option; R-4 pins the options, not just the column | Medium |
| **W7A-4** | §2.4 `age`, §2.7 copy, header line, §7 M-2 | **Words match the anchor.** `age.basis` for failed/dead-lettered: `since_due` (payment tables, `scheduled_at`), `since_queued` (lead replies, insight actions, `created_at`), `since_day_start` (briefing). UI: "4 h since it was due" / "4 h since it was queued" / "4 h since its business day began". Header line: "…Failed items keep no failure time, so their age is counted from when they were due, or for lead replies and insight actions from when they were queued." M-2: replace "the card's all-time figure" with "the total is at least the card's 7-day figure, because the list is not limited to 7 days". B-4 and U-3 cover each basis | Medium |
| **W7A-5** | §2.7 panel, §5.8 | **Stale-response race.** A tab or page change while a request is in flight must not let the older response overwrite the newer one. Use an `AbortController` per request (abort on change and on unmount) or a request sequence number; an aborted request is not an error state and is not logged at `error`. Test: switch Stuck → Failed before the first response resolves; only Failed rows render | Medium |
| **W7A-6** | §2.3, T4 | **Extraction is call-for-call identical.** The lifted helpers take `(query, spec)` plus the `stuckBefore` computed once from the caller's `now`; the figures read must emit the same builder calls in the same order. The existing figures cases and `qa-slice5-pr2.queueSemantics` pass with **no edit** other than the `:93` pin swap to `ADMIN_QUEUE_FIGURE_COLUMNS`. If any other figures test needs an edit, stop and report it in Implementation Notes before changing it | Medium |
| **W7A-7** | §5.4 | Eligibility test additions: (a) a dead-lettered row (status `failed` + marker) on payment reminders, briefing, lead replies and insight actions is retry-eligible exactly like a plain `failed` row (§C says "failed / dead-lettered"); (b) E-2 with a microsecond anchor string (`…T09:00:00.123456+00:00`) to pin the truncation direction in §C above; (c) the briefing `until` is `endUtc`, which is **exclusive**: the UI says "until its business day ends (<endUtc> UTC)", not "until <endUtc>" as an inclusive time; (d) `options.retryAt` is ignored for the briefing and automations | Medium |
| **W7A-8** | §2.6, code comment | The list uses the minute-floored clock on purpose (its stuck cut-off then equals the card's). Say so in a comment at the call, and say that **7c must call `queueItemEligibility` with the real clock**. No 7a code change beyond the comment | Low |
| **W7A-9** | §2.6 step 4 | `findAdminIdentitiesByUserIds` takes no abort signal, so `underDeadline` stops waiting but does not cancel the request. Acceptable (read-only, ≤ 50 ids, one request). Note it in a code comment; do not add a signal parameter to `BusinessProfileRepository` in this slice (it is on the "not touched" list and pinned by `adminReadMethods.guard`) | Low |
| **W7A-10** | §2.8 | Panel guard additions: the panel's only `<button` elements are the four tabs and Previous/Next (a render assertion, U-9 already close; make it an exact list); no `onClick` in a `<td>`. Keep "Re-send" and "Cancellable" as `th` text only | Low |
| **W7A-11** | §2.9, T9 | Access doc per OP-12 / CR7D-1, with Last Updated, and the census re-measured with the guard's regexes (not `grep -c`, which miscounts here) | Low |
| **W7A-12** | §7 Manual QA | **Live data has no failed, dead-lettered or in-progress row on any queue, and two tables are empty** (§A). M-2, M-4, M-5 and M-6 will most likely show "No items in this state." on the live project. QA covers those states through the route and render suites and records them as "not exercisable on live data". **Never seed, hand-edit or re-status a live queue row to create a test item**: these tables send messages to real clients. M-3 (privacy in DevTools) and M-1, M-7, M-8 remain live checks, using the Waiting tab on payment reminders | Low |

#### I. Optimisation suggestions (non-blocking)

- The route's worst case is two sequential 5 s reads (items, then names), about 10 s. That is inside the platform default for a `GET`, and the items read at current volume takes milliseconds. No `maxDuration` is needed; revisit only if the 500 rate shows otherwise.
- `QueueItemsView.now` lets the panel label "as of HH:MM UTC"; cheap and useful, optional.

#### J. For the user (business terms, non-blocking)

- **Q-SA7A-1: Is the business name enough to find the business behind a stuck item?** Each row will show the business's name (or "Business without a name" / "No business profile"). It will not link to that business's page, because a link would carry the account's id, which slice 7's privacy rule keeps out of this list. *Default: name only; a link can come with the Business 360 work (R-3).*

#### K. Approval

- [x] Workplan approved — **proceed to implementation with W7A-1..W7A-12 folded in**. W7A-1 and W7A-2 change behaviour and must be in the first implementation pass; the rest may land in the same pass. SA re-checks all twelve at code review.
- Requirement amended by a dated SA note (C7-12 `timezone`; §M four tabs; 7c carry-forwards on the clock, the payment-reminder CAS bound and the briefing send window).

### SA Code Review (2026-10-04)

**Code Review by SA — 2026-10-04.** **Status: 🔄 APPROVED WITH CHANGES (CR7A-1 required; CR7A-2 recommended in the same pass; CR7A-3 optional).** Reviewed on the uncommitted worktree `feature/admin-queue-item-list` @ base `61bda100`, against W7A-1..W7A-12, OP-1..OP-13, C7-1..C7-16 and the 7a requirement note, CLAUDE.md, and the `new-repository`, `new-api-route` and `tenant-isolation-guard` skills. Every check below was re-run by SA; nothing was taken from the Implementation Notes on trust. Mutations and probes ran on scratch copies in `scratchpad/sa7a/` through a scratch Jest config (`moduleNameMapper` swap); the worktree was not changed, nothing was stashed, no database was touched.

#### Verification of the Dev's claims

| Claim | SA measurement | Verdict |
|---|---|---|
| 271 new tests | eligibility 68, builder 49, repository items 70, route 61, panel render 23 = **271** | ✅ |
| Wide run 4,065 / 4,065 | `npx jest app/admin app/api/admin lib/admin lib/repositories lib/audit`: **180 suites, 4,065 / 4,065** | ✅ (one earlier loaded run had `qa-slice5-pr2.route` red on a 5 s deadline test; it passes alone, 11 / 11, and is untouched by this slice: a load flake, as QA also saw on two other suites) |
| Authz 119 / 119 | `admin-authz-surface.guard` **119 / 119**; `adminGate.writes` + `adminReadMethods.guard` **324 / 324**, `CASES` unedited at 58 | ✅ |
| Census 60 / 89 = 83 + 6 + 0 | Re-measured with the guard's **own** exported `scanHandlers` + `stripComments` (scratch `tsx`): **60 files, 89 handlers, 83 `requireAdmin`, 0 unparseable**; the 6 others are exactly the six inline handlers (`agents`, `llm-usage`, `llm-usage/businesses`, `chat-usage`, `users/[id]/audit-logs`, `users/[id]/login-stats`) | ✅ |
| Mutation proofs | Re-ran 9 of the 11: W7A-1 order swapped **9** red; 72 h made exclusive **4**; `nullsFirst` removed **5**; stale-response guard removed **1**; refresh reset removed **2**; snap-back removed **1**: all equal to the Dev's figures. `PGRST103` removed: **1** red in the repository suite (Dev's 2 includes the route's end-to-end case). Builder spread: **6** red in the builder suite (Dev's 13 counts more suites). SA's own extra: selecting `error_message` on `payment_reminders` turns **6** red. Unmutated control copy of the panel: 23 / 23 | ✅ |
| Fails on old code | The 5 new suites cannot load on `61bda100` (their modules do not exist); the render test's `1 + 5 + 5` and the figures pin's `ADMIN_QUEUE_FIGURE_COLUMNS` cannot pass there. Not re-run by archive; accepted on inspection | ✅ |
| Lint, types | ESLint on the 8 changed source files: clean. Scoped `tsc` (scratch tsconfig, the 8 sources, the 9 new/amended suites and the jobs route): **0 errors** | ✅ |
| Untouched set | `git diff 61bda100 --stat` is **empty** on `app/api/cron`, `lib/services`, `lib/cron`, `vercel.json`, `lib/audit`, `lib/business-os`, `lib/payments`, `jobs-queues/route.ts`, `jobs-queues/drain`, `DrainNowDialog.tsx`, `BusinessProfileRepository.ts`. No untracked file outside the expected eleven | ✅ |
| `console.*` | 0 in all 7 changed or new source files | ✅ |

#### Conditions W7A-1..W7A-12

| # | Verdict | Evidence |
|---|---|---|
| W7A-1 | ✅ | `queueItemEligibility.ts:170` the automations rule precedes the state check; probe: `running` orphaned and leased both give `retry_not_offered` (cancel `allowed` / `leased`). Unrecognised status (`FAILED`) gives neither |
| W7A-2 | ✅ | Repository `:633-636` maps `PGRST103` to `{ rows: [], total: null }` at `info`; route 200 empty; panel `:155-158` snaps back once (only when `page > 1`, and page 1 can never 416, so no loop) and resets on `refreshKey` (`:123-125`, the render-time reset React documents, one request) |
| W7A-3 | ✅ | Repository `:611-627` stuck `nullsFirst: true`; failed / dead-lettered `ascending: false, nullsFirst: false`; waiting `nullsFirst: false`; `id` ascending last |
| W7A-4 | ✅ | `age.basis` `since_due` / `since_queued` / `since_day_start`; panel words match. Deviation 2 (one anchor named per queue) is **accepted**: each panel belongs to one queue, so naming its own anchor is more exact than SA's two-anchor sentence |
| W7A-5 | ✅ | One `AbortController` per effect run; `aborted` checked after the body is read and in `catch`/`finally`; deps `[queueId, tab, page, refreshKey]`; abort on unmount. Not logged when aborted |
| W7A-6 | ✅ | `stuckFilter`, `failedNotDeadFilter`, `deadLetteredFilter` are the old closures verbatim (same `.eq` → `.or` order, same quoting); `stuckBefore` computed once by the caller. Figures test diff is the import and the `:93` pin only |
| W7A-7 | ✅ | (a)–(d) present in the eligibility and builder suites; briefing copy reads "until its business day ends (… UTC)" |
| W7A-8 | ✅ | `items/route.ts:90-95` and the module header |
| W7A-9 | ✅ | `items/route.ts:116-119`; `BusinessProfileRepository` unchanged |
| W7A-10 | ✅ | Exact button list in the render test; source pin of three `<button` and no `onClick` in a `<td>` |
| W7A-11 | ✅ | Access doc: headline "89 … 60 … 83 + 6 + 0", "What is true" 89 / 83, register heading "(89)", summary "92 rows, 89 live", row 92, As-Built note, Change History row. Remaining "88" / "82" strings are historical notes only. Last Updated already 2026-10-04 |
| W7A-12 | ✅ | No DB access in code or tests |

**Deviations 1–6:** all accepted. (1) a separate items test file keeps the figures file to the pin swap; (3) "Dead-lettered" for every Dead-lettered-tab row is right, because on four tables those rows have status `failed` and the raw status is still sent for 7b's `expected.status`; (4) `signal` in the fetch options is the W7A-5 guard; (5) the additions are all defensive; (6) the briefing day-start via `businessDayFor(now, zone, offset).startUtc` is DST-safe and avoids a new import.

#### Focus areas

- **Eligibility matrix (C7-9, §C):** `RETRY_FROM_STATUSES` and `CANCEL_FROM_STATUSES` match §C cell by cell, including `dead_letter` and no-due-time `pending` on automations, and `failed`-with-marker being retryable on the other four. In-progress cancel only with `claimed_at` NULL. Terminal and unknown statuses give neither. The briefing branch judges "today" on `now` and the row's own zone, with `businessDayFor`'s UTC fallback (probe: `'Not/AZone'` and `''` both fall back). One fail-open hole: **CR7A-1**.
- **Repository:** per-table allow-list equals section 6 exactly; `error_message` appears only in filters, never in a select (SA mutation proves the pin); `ADMIN_QUEUE_FIGURE_COLUMNS` keeps the figures read at the original four; `ADMIN_QUEUE_SELECTABLE_COLUMNS` is the union, pinned by equality. Field-by-field mapping with type checks and fail-the-read on a malformed row; no spread. Range capped and sliced defensively. Service-role use documented at the method (`:567-583`, the `listQueueItemsAllAccounts` JSDoc) and the class header. Never throws.
- **Route:** `requireAdmin` is the first statement after the correlation id and child logger (G-6). Strict Zod; defaults state `stuck`, page 1; 400 in the standard format with dev-only details. **A repeated parameter taking the last value is acceptable** here: the value is still enum-validated, the route is an admin-only read, and nothing can be smuggled through the earlier value. (7b/7c take JSON bodies, so this does not carry over.) Both reads under the 5 s deadline. Name lookup skipped on zero rows; a failure, throw or time-out serves 200 with "Name not available". Only `company_name` crosses (`:133`); no vertical, account id or timezone in the body (S-1/S-2). No audit row, no write (S-3).
- **Panel:** 6 buttons exactly; no actions; no green; error text never rendered; fixed sentences for 401/403 and failure. Age and re-send wording per anchor.
- **Guards:** the narrow OP-11 form exactly. Page and view rules unchanged; the panel joins `FILES` and `CLIENT_FILES` with every original rule plus a one-GET pin, `queue/state/page`-only query, no green, three `<button`; `jobsFormat.ts` gets no-import / no-console / no-`OK`. `page.tsx` differs by one comment line. `readJobsQueues` C-6 list extended, not loosened.

#### Code Review Comments

1. **CR7A-1 — `lib/admin/jobs/queueItemEligibility.ts:174-176` — an invalid clock allows a re-send (fail-open). Priority: Medium. REQUIRED before merge.** `retryAt = (options.retryAt ?? now).getTime()` is `NaN` for an `Invalid Date`, and `NaN > until` is `false`, so the function returns `{ allowed: true }`. SA probe: a reminder scheduled 2020-01-01 with `retryAt: new Date('x')` → `allowed: true`; a lead reply with `now = new Date('x')` → `allowed: true`. 7a always passes a valid clock, so nothing is live today, but 7c will pass `retryAt` from the C7-8 sending-hours helper and imports this function unchanged; the module promises to fail closed. Fix: before the window comparison (and before the briefing branch, for `now`), if `now` or the effective `retryAt` is not a finite time, refuse retry with **`retry_window_passed`** (the window cannot be proved; no new 422 code); cancel is unaffected because it does not depend on the clock. Add two eligibility cases (invalid `now`, invalid `retryAt`) and keep the purity pin green.
2. **CR7A-2 — `lib/admin/jobs/buildQueueItemsView.ts:242` — `hasMore` ignores the 20-page cap (QA-7A-1). Priority: Low. Recommended in the same pass.** Concur with QA: on page 20 with `total > 1,000`, Next asks for page 21 and the panel shows the load-failed sentence. Fix: `hasMore` also requires `page < ADMIN_QUEUE_ITEMS_MAX_PAGE` (pass the cap in, as `pageSize` is; `lib/admin/**` must not import the repository), and the "Showing" line adds "(first 1,000 shown)" when `total` exceeds the cap. One builder case, one panel case.
3. **CR7A-3 — `app/admin/components/jobs/QueueItemsPanel.tsx:101, :107` — "no: a run holds it" on an expired-lease stuck row. Priority: Low. Optional.** Every claimed row on the Stuck tab is past the stuck threshold, so its run is presumed dead; "a run holds it" tells the admin the opposite. The rule is right (C7-2: never actionable per item); only the words mislead. Suggest, for `lease === 'expired'`: "no: claimed by a run; the queue's own sweep releases it" (the guard forbids the word "Drain" in this file, so do not name the button). Keep "a run holds it" only if a non-stuck leased row is ever listed (none is in 7a).

#### Optimisation Suggestions (non-blocking)

- QA's edge notes 1–3 are accepted as recorded: the raw status word in `status` is by design (7b's `expected.status`); old rows remain visible during the snap-back load (buttons disabled); the catch-all `err` log is reachable only by an unexpected throw.
- `aria-controls` on the "View items" button names an id that exists only while the panel is open. Harmless; could be set only when open.
- Each request logs two `info` lines (repository and route). Consistent with the figures read; no change needed.
- The suite-level load flakes (`qa-slice5-pr2.route`, `archiving/page.render`, `business-os-invites/page.render`) pre-date this slice. Worth a backlog note for the CI-Jest work, not this PR.

#### Code Approved for QA: Yes, with conditions

- **CR7A-1 must land before the commit**, with its two tests. CR7A-2 should land in the same pass. CR7A-3 is the Dev's call.
- SA re-check after the fix is a **delta check only** (the changed lines, the new tests, and a re-run of the eligibility, builder and panel suites plus the authz guard). No full re-review and no QA re-run beyond those suites is needed.

**SA delta re-check (2026-10-04).** **Status: ✅ APPROVED — Code Approved for QA: Yes.** Changed lines and their tests only.

- **CR7A-1 — resolved.** `queueItemEligibility.ts` checks `Number.isFinite(now.getTime())` once; the briefing branch refuses before `businessDayFor` is reached, and the other four refuse when `now` or the effective `retryAt` is not finite, after the queue, state and `no_due_time` rules. `not_retryable_state` still wins (briefing: chosen by status inside the guard; others: unchanged order). Cancel is computed before and independently of the clock. The 5 new cases are meaningful: three fail on the old code (NaN comparison allowed), the briefing case pins "does not throw", and the state case pins the order. Purity pin still green.
- **CR7A-2 — resolved. Ruling on `maxPage` on the view: accepted.** It is a public constant, not tenant data, and it keeps a single source for the cap (the route's `ADMIN_QUEUE_ITEMS_MAX_PAGE`) without a runtime import into a client file (C-21 guard green) or a second hard-coded 1,000 that could drift. `hasMore = total !== null && page < maxPage && page * pageSize < total`; the builder still imports no repository. The note shows only when `total > maxPage × pageSize` (1,500 → note, 1,000 → none). Key pins changed by exactly one key (`maxPage`) in the builder and route tests.
- **CR7A-3 — resolved.** Expired lease reads "no: claimed by a run; the queue's own sweep releases it"; accurate (the run is presumed dead; the sweep releases it), no "Drain" (source guard green), U-3 pin updated.
- **Run:** 19 suites, 698 / 698 green — all `lib/admin/jobs` suites, the items route, both repository suites, the four `jobsQueues` page guard/render suites, and the authz guard.

## Implementation Notes (Dev, 2026-10-04)

**Status: Code Complete, awaiting SA code review.** Nothing committed. On `feature/admin-queue-item-list` @ `61bda100`. The Status line and task boxes above are left as written: this pass only inserted text into this file. T1–T11 are all done.

### SA conditions, where each one landed

| # | Where |
|---|---|
| W7A-1 | `queueItemEligibility.ts`: the payment automations rule comes before the state check, so retry is `retry_not_offered` for every status on that queue. E-1 has an unrecognised-status case per queue (neither retry nor cancel). E-6 covers every status, orphaned and leased |
| W7A-2 | The repository maps `PGRST103` to `{ rows: [], total: null }` and logs `info` "past the end". The route returns 200 with `items: []`, `hasMore: false`, `total: null` (the wire type is `number \| null`). The panel goes back to page 1 once when `total` is null on page > 1, and resets to page 1 on every new `refreshKey`. Tests: R-5 PGRST103, a route case with the mocked repository, a route case end to end with the real repository on a recording client, and three panel cases (a real Drain now on page 2, the snap-back, a refresh on page 2) |
| W7A-3 | Stuck `claimed_at` ascending with `nullsFirst: true`. Failed and dead-lettered use the window column descending with `nullsFirst: false`. Waiting uses `scheduled_at` (payment tables) or `created_at`, ascending with `nullsFirst: false`. `id` ascending breaks ties. R-4 pins the options |
| W7A-4 | `age.basis` is `since_due`, `since_queued` or `since_day_start`. The words are "since it was due", "since it was queued" and "since its business day began". The header sentence is per queue (deviation 2). The `retry_window_passed` words follow the anchor too. M-2 is not edited here (the doc rules); QA should read the card's figure as a 7-day lower bound |
| W7A-5 | An `AbortController` per request, aborted when the queue, tab, page or refresh changes and on unmount. An aborted request does not set state and is not logged. Tests: Stuck → Failed with both answers held, then answered out of order; closing the panel mid-request |
| W7A-6 | `stuckFilter`, `failedNotDeadFilter` and `deadLetteredFilter` are lifted out unchanged, and the figures read calls them with the calls in the same order. `AdminJobsQueuesRepository.test.ts` changes only at the `:93` pin and its import (two lines). `qa-slice5-pr2.queueSemantics` is unedited and green |
| W7A-7 | (a) a dead-lettered row on the four retryable tables is marked like a plain failed row (eligibility and builder); (b) a microsecond anchor `…12:00:00.123456+00:00` is allowed at `.123 + 72 h` and refused 1 ms later; (c) the briefing `until` is `endUtc` and reads "until its business day ends (… UTC)"; (d) `retryAt` is ignored for the briefing and for automations |
| W7A-8 | A comment at the clock in `items/route.ts`, plus the module header of `queueItemEligibility.ts` |
| W7A-9 | A comment at the name lookup in `items/route.ts`. `BusinessProfileRepository` is unchanged |
| W7A-10 | The render test pins the panel's buttons to exactly Stuck, Failed, Dead-lettered, Waiting, Previous, Next. A source pin requires three `<button` elements (one mapped over the tabs) and no `onClick` in a `<td>` |
| W7A-11 | The census was re-measured with the guard's own `scanHandlers`, `stripComments` and `blankStringLiterals` (a scratch test importing them): **60 files, 89 = 83 + 6 + 0**, and the six non-`requireAdmin` handlers are exactly the six inline ones. The access doc figures were edited in place, with register row 92, an As-Built note and a Change History row |
| W7A-12 | No database access was used. No live row was read or changed |
| OP-1 / S-2 | Only `company_name` crosses into the view. The route drops `vertical` and `sub_vertical` when it builds the map |
| OP-2 | `timezone` is selected for `daily_briefing_sends` only, used by the eligibility function, and never copied into the view (B-7, S-1) |

### Deviations from the plan, with reasons

1. **The repository list tests are in a new file, `lib/repositories/__tests__/AdminJobsQueuesRepository.items.test.ts`,** not in a new `describe` in the figures file. The figures file's logger mock does not expose `warn`, so R-9 would have meant editing that mock. A separate file keeps the figures file to the single pin swap (W7A-6). R-13, the isolation guard, still runs in the figures file and passes with the new route as a caller.
2. **The panel's header names one anchor per queue.** It says "from when they were due" (payment tables), "from when they were queued" (lead replies and insight actions) or "from when their business day began" (briefing). It does not use SA's single sentence that names two anchors. The panel belongs to one queue, so naming its own anchor is exact, and the briefing gets a sentence too.
3. **`statusLabel` is "Dead-lettered" for every row on the Dead-lettered tab.** On four tables those rows have status `failed` plus the marker. Otherwise the label comes from the fixed map.
4. **The panel's fetch options are `{ cache: 'no-store', signal }`.** The signal is the W7A-5 guard. U-2 asserts `cache: 'no-store'`, no `method` and no `body`.
5. **Additions not in the plan:**
   - copy for `no_due_time` ("no: no due time recorded");
   - eligibility: a briefing dated tomorrow (clock skew) is not "today";
   - repository: an unknown queue or state is refused with no request;
   - repository: a thrown client error is returned, not thrown;
   - route: a repeated parameter (last one wins);
   - route: no name lookup when there are no rows.
6. **The briefing's day-start anchor** is `businessDayFor(now, zone, offset).startUtc`, where `offset` is the calendar distance from today. This avoids a new import of the BizQL date helpers.

### Verification

- **New suites:** eligibility 68, builder 49, repository list 70, route 61, panel render 23 (271 tests). **Amended suites:** source guard 22 (+6), render 12, `readJobsQueues` 16 (+2), figures 36 (pin only).
- **Fails on old code:** the new and amended tests were copied into an export of `61bda100` in the scratchpad (`git archive`, no change to the worktree) and run against it. All 9 suites failed: the 5 new ones because their modules do not exist on the old tree, and the 4 amended ones on their new assertions (no panel file, no new eligibility modules, 6 buttons instead of 11, no `ADMIN_QUEUE_FIGURE_COLUMNS`).
- **Mutation proofs** (applied to scratch copies, never the worktree). Each one turned the named tests red:

  | Mutation | Tests that failed |
  |---|---|
  | W7A-1 order swapped | 9 |
  | Unrecognised status made cancellable | 5 |
  | 72 h boundary made exclusive | 4 |
  | `PGRST103` branch removed | 2 |
  | `nullsFirst` removed | 5 |
  | Stale-response guard removed | 1 |
  | Refresh reset removed | 2 |
  | Snap-back removed | 1 |
  | `vertical` leaked into the name | 1 |
  | Builder spreads the row | 13 |
  | Stuck filter drifted | 8 |

- **Wide run:** `npx jest app/admin app/api/admin lib/admin lib/repositories lib/audit` gives 180 suites, **4,065 / 4,065 passed**.
- **Guards:** `npm run test:authz-guard` 119 / 119; `adminGate.writes` 293 / 293, unedited (`CASES` 58); `adminReadMethods.guard` 31 / 31.
- **Lint:** ESLint on the 18 touched code files gives 0 errors and 0 warnings. `npm run lint:hooks` passes.
- **Types:** scoped `tsc` (scratch tsconfig, `"include": []`, the 18 touched files plus the jobs route, the drain route and the drain render test, `NODE_OPTIONS=--max-old-space-size=8192`) gives **0 errors in any touched file**. 23 errors are reported in 5 untouched files reached through imports (`lib/analytics/aiAnalytics.ts`, `lib/email/templates/booking-confirmation.ts`, `lib/pdf/InvoicePDFGenerator.tsx`, `lib/services/InvoiceDeliveryService.ts`, `lib/stripe/StripeInvoiceService.ts`). They pre-date this slice.
- **Logging (C7-15):** `console.*` count is 0 in every touched file, before and after.

### SA code review fixes (CR7A-1..3, Dev, 2026-10-04)

- **CR7A-1 (resolved):** `queueItemEligibility` refuses retry with `retry_window_passed` when `now` or the effective `retryAt` is not a finite time (no new code; the briefing branch checks `now` before `businessDayFor`, after the state rule). Cancel unchanged. 5 new cases (reminder + invalid `retryAt`, lead reply + invalid `now`, the 2020 SA probe, briefing + invalid `now`, a non-retryable state keeps its own code). Mutation: guard removed → 3 red; briefing guard removed → 2 red.
- **CR7A-2 / QA-7A-1 (resolved):** the route passes `ADMIN_QUEUE_ITEMS_MAX_PAGE` into the builder as `maxPage` (the builder still imports no repository); `hasMore` also needs `page < maxPage`. `maxPage` is returned on the view, so the wire gains one key (the two exact-key pins updated). The panel's Showing line adds "(first 1,000 shown)" when `total > maxPage x pageSize`. Tests: builder (page 20 of 1,500 → `hasMore` false), panel (page 20: Next disabled, note shown, no page 21 request; no note at 1,000). Mutations: cap removed → 1 red; note removed → 1 red.
- **CR7A-3 (resolved):** a leased row with `lease === 'expired'` reads "no: claimed by a run; the queue's own sweep releases it" in both columns; "a run holds it" stays only for a non-expired lease (none listed in 7a). U-3 pin updated. Mutation: old wording restored → 1 red.
- **Re-run:** 22 suites, 941 / 941 (7a suites, jobs-page guard and render, drain, all `qa-slice5-pr2`, authz guard 119 / 119). ESLint 0 on the 9 touched files. Scoped `tsc`: 0 in touched files (the same 23 pre-existing in 5 untouched files).

## QA Testing Report

### QA Report (2026-10-04)

**Test mode:** full
**Strategy used:** A (Jest unit: eligibility, builder) + B (Jest integration: route and repository on mocked and recording clients) + D (a manual browser checklist for the user, below; QA cannot sign in). A scratch `tsx` probe of the pure modules was run from `scratchpad/qa7a/` and nothing in the worktree was changed.
**Focus:** api, ui, schema, security
**Skipped:** the live browser check (QA cannot sign in; it is handed to the user below). No database access (W7A-12).
**Input source:** TL prompt + workplan §5/§7 + SA W7A-1..W7A-12
**Verdict:** **PASS WITH NOTES.** No High or Medium bug. One Low bug (QA-7A-1). Ready for the user's diff review and browser check.

#### Test runs (re-run independently on the uncommitted worktree)

| Run | Result |
|---|---|
| 5 new suites: eligibility, builder, repository items, route, panel render | all PASS (part of 357 below) |
| 4 amended suites: source guard, render, `readJobsQueues`, figures | all PASS. **9 suites, 357 / 357**, which matches Dev's 271 + 22 + 12 + 16 + 36 |
| `qa-slice5-pr2.queueSemantics` | 5 / 5 |
| `jobsQueues.drain.render` (unedited) | 21 / 21 |
| `adminGate.writes` (unedited, `CASES` 58) | 293 / 293 |
| `adminReadMethods.guard` | 31 / 31 |
| `npm run test:authz-guard` | 119 / 119 |
| Wide set: `app/admin app/api/admin lib/admin lib/repositories lib/audit` | 180 suites, **4,059 / 4,065** in a loaded run. The 6 failures were in 2 suites this slice does not touch: `archiving/page.render` (1) and `business-os-invites/page.render` (5), which ran in 43 s and 80 s while SA was running tests in parallel. Re-run alone: archiving **PASS**; invites PASS 52 / 52 on a second solo run, after one run with 2 failures. These are load-sensitive timing flakes and not a 7a regression |
| Figures test edit | Confirmed: only the import (`ADMIN_QUEUE_SELECTABLE_COLUMNS` → `ADMIN_QUEUE_FIGURE_COLUMNS`) and the `:93` pin line. No other figures assertion changed (W7A-6) |
| Untouched set | `git diff --stat` is empty on `app/api/cron lib/services lib/cron vercel.json lib/audit adminGate.writes.test.ts jobs-queues/route.ts jobs-queues/drain BusinessProfileRepository.ts`. `console.*` count is 0 in the 6 new or changed source files |

#### Test Coverage (7a acceptance criteria → evidence)

| Acceptance criterion | Tested? | Result | Evidence |
|---|---|---|---|
| FR-Q5: per-item list, metadata only (queue, item id, status, attempts, due, age, business name, dead-lettered) | ✅ | Pass | Builder B-3..B-6, panel U-3. FR-Q5 also lists "claim time". It appears only as the stuck age ("stuck N min (claimed)"), not as a timestamp. That is the §2.4 design SA approved, so it is a note and not a gap |
| §9 / C7-13: no payload, message, error, skip reason, client detail or account id in the response, the logs or the UI | ✅ | Pass | Route S-1 (all 5 queues × 4 states, body and every log), S-2 (vertical and user id dropped, name not logged), S-4; builder B-7; repository R-7; panel U-8 |
| C7-13: fixed kind labels, unknown → "Other" | ✅ | Pass | B-1. Probe: an unknown status gives "Unrecognised status" |
| FR-Q6 / OQ-3 / C7-9: 72 h mark from one pure function, per queue, with the boundary | ✅ | Pass | Eligibility E-2/E-3/E-5 and W7A-7(b). QA probe: lead reply at exactly 72 h is allowed (`until` = now); 1 ms older gives `retry_window_passed` |
| C7-1 / C7-2: matrix as data; leased rows never actionable; orphans cancel-only | ✅ | Pass | E-1 (`it.each` over every status, orphaned and leased), E-12 |
| C7-5: payment automations never "can re-send" | ✅ | Pass | E-6 over 7 statuses, W7A-7(d), panel "no: never re-sent on this queue". QA probe: `retry_not_offered` for pending, failed, dead_letter, running and completed |
| C7-7: briefing only on its own business day, in the row's zone | ✅ | Pass | E-7..E-10 and a future-day case. QA probe, Asia/Jerusalem: 23:59 local is allowed until 21:00Z; 00:00 local gives `briefing_not_today` |
| Unrecognised status fails closed (W7A-1) | ✅ | Pass | E-1 unknown row. Probe: retry `not_retryable_state`, cancel `not_cancellable_state`, label "Unrecognised status" |
| C7-12: one repository method; exact columns; widening deliberate; figures pin tightened | ✅ | Pass | R-2, R-12 (exact equality), figures `:93` swap, R-13 isolation guard |
| Shared filters: list cannot drift from the card (W7A-6) | ✅ | Pass | R-3 compares each state with the figures predicate; figures suite and `qa-slice5-pr2` unedited and green |
| W7A-3: explicit NULL ordering, `id` as tie-breaker | ✅ | Pass | R-4 |
| W7A-2: page past the end gives 200 empty, not 500; panel snaps back; refresh resets to page 1 | ✅ | Pass | R-5 PGRST103; route E (mocked and end to end); panel "Drain shrinks on page 2", "snaps back once", "refreshKey resets" |
| W7A-5: stale response after a tab switch | ✅ | Pass | Panel "Stuck → Failed before the first answer" (answered out of order) and "closing mid-request". Code: an `AbortController` per effect run, with an `aborted` check before every `setState` |
| Empty queue in each tab | ✅ | Pass | U-6 tests one tab. The empty branch does not depend on the tab (`data && items.length === 0`), and route P runs all 20 queue × state pairs. Not a real gap |
| Name lookup fails, throws or times out | ✅ | Pass | Route N: 200 with "Name not available" and a `warn` carrying a class and no message |
| Business with no name / no profile row | ✅ | Pass | B-2. Probe: a `null` `company_name` gives "Business without a name" |
| C7-14: `requireAdmin` first; 401/403 with nothing read; strict Zod | ✅ | Pass | G-1..G-6; Z covers bad queue/state/page, `page` 0/21/abc/1.5, `accountId`, `userId`, `limit`; Z-5 defaults; Z-6 dev-only details; repeated parameter |
| C7-14: register row 92, census 60 / 89 = 83 + 6 + 0, `CASES` 58, no CAP moved | ✅ | Pass | Access doc rows checked; authz guard 119 / 119; `adminGate.writes` 293 / 293, unedited |
| C7-15: Pino only, error format | ✅ | Pass | 0 `console.*`; 400/500 bodies follow the standard format |
| FR-Q7: Refresh and Drain now reload an open list | ✅ | Pass | U-10; `refreshKey` is bumped in `load()`'s `finally` |
| No write, no audit row | ✅ | Pass | S-3 on a recording client: 20 `from()` calls, no insert/update/upsert/delete/rpc, no audit or `logAndFlush` |
| Read-only UI: only the tab buttons and Previous / Next | ✅ | Pass | W7A-10 exact button list; source guard (22) |
| Live behaviour in a browser | ⚠️ | Not run by QA | Handed to the user (checklist below). Stuck, Failed and Dead-lettered cannot be tried on live data; tests cover them (W7A-12) |

#### Issues Found

**Bugs (must fix before commit)**
None at High or Medium.

**Bugs (Low)**
1. **QA-7A-1: on page 20, "Next" stays enabled when the state has more than 1,000 items, and pressing it shows the load-failed error.** File: `lib/admin/jobs/buildQueueItemsView.ts:242` (`hasMore: total !== null && page * pageSize < total`, with no cap at `ADMIN_QUEUE_ITEMS_MAX_PAGE`). It is used by `app/admin/components/jobs/QueueItemsPanel.tsx:280`. Severity: **Low**. No live table is anywhere near 1,000 rows: the largest has 129.
   - Steps: a state with `total` = 1500; page through to page 20.
   - Expected: "Next" is disabled on page 20, and the panel says the list stops at 1,000 items.
   - Actual: `hasMore` is `true` (scratch probe: `page20 total1500 hasMore = true`). "Next" asks for `page=21`, the route returns 400, and the panel shows "Could not load the items. Try again in a moment."
   - Suggested fix (Dev): `hasMore` also requires `page < maxPage` (pass the cap to the builder), and a one-line "first 1,000 shown" note. Add a builder case and a panel case.

**Performance Issues**
None found. One request per page with `count: 'exact'`, and a 5 s deadline on each of the two reads.

**Edge Cases (nice to fix / notes)**
1. **An unrecognised status word is echoed in the JSON `status` field.** The UI shows only "Unrecognised status", but the raw word is in the response (`buildQueueItemsView.ts:207`). This is by design (§2.4: 7b/7c send it back as `expected.status`), and it is a platform enum, not client data. Recorded so 7b knows.
2. **Snap-back leaves the old page's rows on screen while page 1 loads** (`QueueItemsPanel.tsx:155-158`; `setData` is not cleared). This is cosmetic: the buttons are disabled while it loads.
3. **The route's catch-all logs `err: error`** (`items/route.ts:178`). Only an unexpected throw reaches it, because the repository and the name lookup return errors rather than throwing. Today nothing that carries row text can reach it.

#### Browser checklist for the user (QA cannot sign in)

**NEVER seed, edit or re-status a live queue row to create a test item (W7A-12).** These tables send messages to real clients. Sign in as a platform admin, open `/admin/jobs-queues`, and keep DevTools → Network open.

| # | Step | Expect |
|---|---|---|
| 1 | Load the page | Each of the 5 queue cards shows **Drain now** and **View items**. No list is open. Network shows a single `jobs-queues` request |
| 2 | **Payment reminders → View items** | A panel opens on the **Stuck** tab and the button reads **Hide items**. Network: `GET /api/admin/jobs-queues/items?queue=payment_reminders&state=stuck&page=1`. Expect "No items in this state." (live has no stuck rows; the same is expected for Failed and Dead-lettered, which tests cover) |
| 3 | Click **Waiting** | A table of real rows; live has about 65 pending. Footer: "Showing 1–50 of N". Each row: business name, 8-character id (hover shows the full id), a kind label ("Reminder before the due date" / "Due-today reminder" / "Overdue reminder"), status "Waiting", a due time in UTC, attempts, an age such as "due in …" or "overdue by …", Re-send "no", Cancellable "yes" |
| 4 | **Next**, then **Previous** | Next shows "Showing 51–N of N" (N is about 65), and Next is then disabled. Previous goes back to 1–50 and is then disabled |
| 5 | **Privacy check**: click the items request in Network and read its Response | The response holds only `id, businessName, kindLabel, status, statusLabel, state, errorCategory, attempts, due, nextAttemptAt, age, lease, retry, cancel` per item. It has no email address, client name, message or error text, `user_id` or timezone. Nothing like that appears on screen either |
| 6 | Click **Failed**, then quickly **Dead-lettered** | Only the Dead-lettered result shows ("No items in this state."). No error flashes up |
| 7 | Go to Waiting page 2, then press the page's **Refresh** | The list reloads on **page 1** ("Showing 1–50"), with no error |
| 8 | Open **Payment automations → View items** | The panel opens; every tab is empty (the table has no rows) |
| 9 | Open a **Morning briefings** or **Lead replies** panel → Waiting | If rows exist, the kind reads "Morning briefing" or "Booking invite to a new lead" / "Follow-up to a lead", and the header sentence names its own anchor ("queued" for lead replies, "business day began" for briefings) |
| 10 | Optional: do **not** press Drain now just for this test. If you drain for a real reason with a panel open, the open list reloads afterwards | — |
| 11 | In a private window (signed out), open `/api/admin/jobs-queues/items?queue=lead_responses` | 401 JSON. No data |
| 12 | Signed in as admin, open `/api/admin/jobs-queues/items?queue=lead_responses&accountId=x` | 400 "Choose a queue, a state and a page from the list" |

#### Final Status
- [x] All acceptance criteria pass in tests. The live browser check is the user's (above)
- [ ] Issues found that Dev must address before commit: none blocking. QA-7A-1 (Low) is optional before merge, and Dev and SA decide

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-04 | Created | Dev workplan for slice 7a only (the read-only queue item list), on `feature/admin-queue-item-list` @ `61bda100` (after PR #196, slice 7d). One route, one repository method, a shared C7-9 eligibility module for 7b/7c, and a per-queue panel. Census 59 / 88 → 60 / 89, register row 92, `adminGate.writes` unchanged at 58. Thirteen open points for SA |
| 2026-10-04 | SA workplan review | **APPROVED WITH CONDITIONS (W7A-1..W7A-12)** on `61bda100`. Live read-only schema check (OP-3): all five section 6 lists return 200 on a zero-row select; three negative controls return 42703; `reminder_type` has no value outside the five known (by counts, no row read); no failed, dead-lettered or in-progress row on any queue today. Paging past the end returns 416 `PGRST103` live, so W7A-2 makes it an empty page, not a 500. Eligibility order fixed for payment automations (W7A-1), explicit NULL ordering (W7A-3), age words per anchor (W7A-4), stale-response race (W7A-5). All thirteen OPs ruled; `timezone` added to C7-12 by requirement note; `adminGate.writes` stays 58. One non-blocking user question (Q-SA7A-1) |
| 2026-10-04 | QA report | **PASS WITH NOTES.** 9 new and amended suites 357 / 357; guards (`adminGate.writes` 293, `adminReadMethods` 31, authz 119, `qa-slice5-pr2` 5, drain render 21) green; wide set 4,059 / 4,065, with the 6 failures as load flakes in 2 untouched suites that pass when run alone. One Low bug (QA-7A-1: Next is enabled past the 20-page cap) and a browser checklist for the user |
| 2026-10-04 | SA code review | **APPROVED WITH CHANGES.** All Dev claims re-measured: 271 new tests; wide set 180 suites 4,065 / 4,065; authz 119 / 119; census 60 / 89 = 83 + 6 + 0 with the guard's own scanner; 9 of 11 mutation proofs re-run and red. W7A-1..W7A-12 met; deviations 1–6 accepted; repeated parameter (last wins) ruled acceptable. **CR7A-1 (Medium, required):** an invalid `now` / `retryAt` makes `queueItemEligibility` allow a re-send (NaN comparison); refuse with `retry_window_passed`, plus two tests. CR7A-2 (Low, recommended): `hasMore` must respect the 20-page cap (= QA-7A-1). CR7A-3 (Low, optional): "a run holds it" misdescribes expired-lease stuck rows. Delta re-check only |
| 2026-10-04 | Dev: CR7A-1..3 fixed | **CR7A-1:** invalid `now` / `retryAt` refuses retry as `retry_window_passed`, cancel unchanged (5 cases). **CR7A-2 / QA-7A-1:** `maxPage` passed in from the route and returned on the view; `hasMore` needs `page < maxPage`; Showing line adds "(first 1,000 shown)" (builder + 2 panel cases). **CR7A-3:** expired-lease wording "no: claimed by a run; the queue's own sweep releases it". All 5 mutations red. 22 suites 941 / 941; ESLint 0; scoped `tsc` 0 in touched files. Uncommitted, awaiting SA delta re-check |
| 2026-10-04 | SA delta re-check | **APPROVED.** CR7A-1..3 resolved; `maxPage` on the view accepted (public constant, single source, no client runtime import). 19 suites 698 / 698 incl. authz guard |
