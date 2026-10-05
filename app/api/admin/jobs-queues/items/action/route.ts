/**
 * POST /api/admin/jobs-queues/items/action — one action on one Business OS
 * queue item (ADMIN_BOS_CLEANUP slice 7b: cancel only; FR-Q1, FR-Q3, FR-Q4,
 * FR-Q5, FR-Q7; SA C7-1..C7-3, C7-6, C7-9, C7-12..C7-16; workplan conditions
 * W7B-1..W7B-14).
 *
 * "Cancel item" on `/admin/jobs-queues`: closes one waiting, failed,
 * dead-lettered or orphaned item for good, so the queue never picks it up or
 * sends it. The FIRST admin write to a live queue that sends to real clients.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *   requireAdmin FIRST → strict Zod (no account id can be sent) → the "from"
 *   check (before any read) → re-read the row (5 s deadline) → still what the
 *   admin saw? → the shared eligibility, with the REAL clock → ONE
 *   compare-and-set UPDATE on id + the row's OWN user_id + status + attempts
 *   (+ claimed_at IS NULL for an orphaned in-progress row).
 *   Won (exactly one row): log line → audit row, flushed → 200.
 *   Lost (zero rows): one re-read → 404 or 409. No second update, no audit.
 *   Anything else: 500 `outcome_unknown`, logged at error, no audit.
 *
 * ── The audit row (SA OP-1, W7B-2) ───────────────────────────────────────
 * Written only AFTER the update won: a cancel is one atomic statement whose
 * outcome is known in milliseconds, and a lost or refused cancel must leave no
 * "cancelled" record. Order: the Pino line, then `logAndFlush`, then the 200.
 * `userId` is the item's ACCOUNT and `actorId` the admin; the entity type
 * `bos_queue_item` is owner-hidden (OP-2 option 1, migration 20261035).
 *
 * ── What this never does ─────────────────────────────────────────────────
 * Never touches a leased in-progress row, never moves anything to `pending`,
 * never touches a finished row. Never sends, drains or calls a service, cron
 * or claim function, and emits no payment event (OP-14, W7B-6). Never returns
 * or logs content, error text, an account id or the reason (the reason is in
 * the audit row only).
 *
 * @see docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7B_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger, type Logger } from '@/lib/logger';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { adminJobsQueuesRepository, type RawQueueItem } from '@/lib/repositories/AdminJobsQueuesRepository';
import { ADMIN_QUEUE_CANCEL_PATCH, adminQueueActionsRepository } from '@/lib/repositories/AdminQueueActionsRepository';
import { CANCEL_FROM_STATUSES, queueItemEligibility } from '@/lib/admin/jobs/queueItemEligibility';
import { QUEUE_ITEM_ACTIONS, QUEUE_ITEM_QUEUE_IDS, statusLabelFor } from '@/lib/admin/jobs/buildQueueItemsView';
import { underDeadline, type ReadTiming } from '@/lib/admin/readUnderDeadline';
import type { QueueItemActionRefusal, QueueItemActionResult } from '@/lib/admin/jobs/jobsQueuesTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminQueueItemActionAPI' });
const ROUTE = '/api/admin/jobs-queues/items/action';

/** Strict at both levels: no userId, accountId, ownerUserId or anything else (SA §F). */
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
  .strict();

type ItemActionBody = z.infer<typeof ItemActionBodySchema>;

const SENTENCES: Record<QueueItemActionRefusal, string> = {
  invalid_input: 'Choose an item and give a reason of at least 3 characters',
  not_cancellable_state: 'This item can no longer be cancelled. Nothing was changed.',
  leased: 'A run has picked this item up, so it cannot be cancelled now.',
  item_not_found: 'This item is no longer in this queue. Nothing was cancelled.',
  item_changed: 'This item changed since the list was loaded. Nothing was cancelled.',
  action_failed: 'Could not read the item just now. Nothing was cancelled.',
  outcome_unknown: "The cancel could not be confirmed. Check the item's status before trying again.",
};

const STATUS: Record<QueueItemActionRefusal, number> = {
  invalid_input: 400,
  not_cancellable_state: 422,
  leased: 422,
  item_not_found: 404,
  item_changed: 409,
  action_failed: 500,
  outcome_unknown: 500,
};

/** The standard error format; `details` in development only. */
function refuse(code: QueueItemActionRefusal, extra: { current?: RawQueueItem; details?: string } = {}): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: SENTENCES[code],
      code,
      // 409 only: the status the list should now show. A status word and its fixed label, nothing else.
      ...(extra.current ? { current: { status: extra.current.status, statusLabel: statusLabelFor(extra.current.status) } } : {}),
      details: process.env.NODE_ENV === 'development' ? extra.details : undefined,
    },
    { status: STATUS[code] }
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled queue item action: ${String(value)}`);
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement (C7-14, W7D-3). Nothing above it reads the body or a
  // queue; the gate owns the 401/403 split and fails closed.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  // After the gate: 401/403 always win over 400. A non-JSON or empty body
  // parses as undefined and fails validation like any other bad input.
  const raw: unknown = await request.json().catch(() => undefined);
  const parsed = ItemActionBodySchema.safeParse(raw);
  if (!parsed.success) {
    requestLogger.warn({ adminUserId: adminId }, 'Rejected a queue item action with invalid input');
    return refuse('invalid_input', { details: parsed.error.issues[0]?.message });
  }
  const body = parsed.data;

  switch (body.action) {
    case 'cancel':
      return cancelItem({ request, requestLogger, correlationId, adminId, body });
    default:
      return assertNever(body.action);
  }
}

interface ActionArgs {
  request: NextRequest;
  requestLogger: Logger;
  correlationId: string;
  adminId: string;
  body: ItemActionBody;
}

/** The row as it is now, under the read deadline. `row: null` = not in this queue. */
async function readRow(
  args: ActionArgs,
  timings: ReadTiming[]
): Promise<{ ok: true; row: RawQueueItem | null } | { ok: false }> {
  const { correlationId, adminId, body } = args;
  const result = await underDeadline('queue-item', timings, (signal) =>
    adminJobsQueuesRepository
      .readQueueItemAllAccounts({ correlationId, adminId }, body.queue, body.itemId, { signal })
      // underDeadline treats a null `data` as a failure; "no such row" is not one.
      .then((read) => (read.error ? { data: null, error: read.error } : { data: { row: read.data }, error: null }))
  );
  return result.ok ? { ok: true, row: result.value.row } : { ok: false };
}

async function cancelItem(args: ActionArgs): Promise<NextResponse> {
  const { request, requestLogger, correlationId, adminId, body } = args;
  const { queue, itemId, expected, reason } = body;
  const ids = { adminUserId: adminId, queue, itemId };

  // Step 2 (§D.2): the "from" state is checked BEFORE any read, so a client
  // cannot widen the matrix by lying about what it saw.
  if (!CANCEL_FROM_STATUSES[queue].includes(expected.status)) {
    requestLogger.info({ ...ids, from: expected.status, code: 'not_cancellable_state' }, 'Queue item cancel refused');
    return refuse('not_cancellable_state');
  }

  const timings: ReadTiming[] = [];
  let casSent = false;
  try {
    // Step 3: the row as it is now, on the server.
    const first = await readRow(args, timings);
    if (!first.ok) {
      requestLogger.warn({ ...ids, reads: timings }, 'Queue item read failed before cancel');
      return refuse('action_failed');
    }
    const row = first.row;
    if (!row) {
      requestLogger.info({ ...ids }, 'Queue item not found for cancel');
      return refuse('item_not_found');
    }

    // Step 4: still exactly what the admin saw (status AND attempts: a row
    // claimed and reaped back to pending has the same status, not the same attempts).
    if (row.status !== expected.status || row.attempts !== expected.attempts) {
      requestLogger.info({ ...ids, from: expected.status, now: row.status }, 'Queue item changed before cancel');
      return refuse('item_changed', { current: row });
    }

    // Step 5 (C7-9): the ONE eligibility function, with the REAL clock (W7A-8).
    const eligibility = queueItemEligibility(
      queue,
      {
        status: row.status,
        claimedAt: row.claimedAt,
        scheduledAt: row.scheduledAt,
        createdAt: row.createdAt,
        briefingDate: row.briefingDate,
        timezone: row.timezone,
      },
      new Date()
    );
    if (!eligibility.cancel.allowed) {
      requestLogger.info({ ...ids, from: row.status, code: eligibility.cancel.code }, 'Queue item cancel refused');
      return refuse(eligibility.cancel.code);
    }

    // Step 6 (C7-3): ONE compare-and-set. The owner is the row's OWN user_id
    // and the expected values are the row's own (equal to the body's after
    // step 4). Nothing else from the request reaches the write. No deadline or
    // abort on the write: aborting it mid-flight would make its outcome unknowable.
    casSent = true;
    const write = await adminQueueActionsRepository.cancelQueueItemAllAccounts(
      { correlationId, adminId },
      { queue, itemId: row.id, ownerUserId: row.userId, expected: { status: row.status, attempts: row.attempts } }
    );
    const outcome = write.error ? undefined : write.data?.outcome;

    if (outcome === 'not_matched') {
      // Step 8: lost the race (a claim, the owner or another admin moved it).
      // One re-read to say what it is now; no second update, no audit row.
      const again = await readRow(args, timings);
      if (!again.ok) {
        requestLogger.warn({ ...ids, reads: timings }, 'Queue item re-read failed after a lost cancel');
        return refuse('action_failed');
      }
      requestLogger.info({ ...ids, from: row.status, now: again.row?.status ?? null }, 'Queue item cancel lost a race');
      return again.row ? refuse('item_changed', { current: again.row }) : refuse('item_not_found');
    }

    if (outcome !== 'cancelled') {
      // Step 9: an error, or a count other than 0 or 1. The outcome is
      // unknowable, so no audit row claims either way (OP-9).
      requestLogger.error(
        { ...ids, code: (write.error as (Error & { code?: string }) | null)?.code ?? 'no_outcome' },
        'Queue item cancel outcome unknown'
      );
      return refuse('outcome_unknown');
    }

    // Step 7: won. The trace order is fixed (W7B-2): the log line, the
    // flushed audit row, then the response.
    const target = ADMIN_QUEUE_CANCEL_PATCH[queue].status;
    requestLogger.info({ ...ids, from: row.status, to: target }, 'Queue item cancelled');

    await logAndFlush(
      {
        action: AUDIT_EVENTS.BOS_QUEUE_ITEM_CANCELLED,
        entityType: 'bos_queue_item',
        entityId: row.id,
        // The item's account (§G, OP-2 option 1); the type is owner-hidden.
        userId: row.userId,
        actorId: adminId,
        // Explicit: the writer's severity beats registration.
        severity: 'warning',
        changes: { before: { status: row.status, attempts: row.attempts }, after: { status: target } },
        details: { reason, queue, action: 'cancel', correlationId, dueAnchor: eligibility.anchorAt },
        request,
      },
      requestLogger,
      { reason: 'queue item cancel', continues: 'the cancel stands regardless' }
    );

    const data: QueueItemActionResult = {
      queue,
      itemId: row.id,
      action: 'cancel',
      before: { status: row.status, statusLabel: statusLabelFor(row.status) },
      after: { status: target, statusLabel: statusLabelFor(target) },
    };
    return NextResponse.json({ success: true, data });
  } catch (error) {
    // The error goes to the server log only; it may carry row text.
    requestLogger.error({ err: error, ...ids }, casSent ? 'Queue item cancel outcome unknown' : 'Queue item cancel failed');
    return refuse(casSent ? 'outcome_unknown' : 'action_failed', {
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
