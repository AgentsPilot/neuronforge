/**
 * GET /api/admin/jobs-queues/items — one page of a Business OS queue's items,
 * read-only (ADMIN_BOS_CLEANUP slice 7a; FR-Q5, FR-Q6, FR-Q7; SA C7-9, C7-12,
 * C7-13, C7-14; workplan conditions W7A-1..W7A-12).
 *
 * The "View items" list on `/admin/jobs-queues`: for one queue and one state
 * (stuck, failed, dead-lettered, waiting), 50 items a page, at most 20 pages.
 * Each item says whether it could be re-sent (and until when) and whether it
 * could be cancelled, from the shared `queueItemEligibility` that 7b and 7c
 * will call on the server. This route itself changes nothing.
 *
 * ── Shape ────────────────────────────────────────────────────────────────
 *   requireAdmin FIRST → strict Zod `{ queue, state, page }` → the items read
 *   (5 s deadline) → the business names (5 s deadline; a failure still serves
 *   the list) → the pure builder → JSON.
 * A page past the end is a 200 with no items and `total: null` (W7A-2), so a
 * list that shrank under an open panel (a Drain now) is not an error.
 *
 * ── What never leaves this route (C7-13) ─────────────────────────────────
 * No account id, timezone, raw kind value, error message, skip reason,
 * payload, recommendation, contact, invoice, installment, booking, entity,
 * rule or trigger id, and no claimer. `user_id` is read only to look up
 * business names and is dropped by the builder; the name lookup's `vertical`
 * is dropped here. The log line carries counts and timings only.
 *
 * Read-only: no audit row (as `jobs-queues#GET` and `health-summary#GET`,
 * OP-10). No write of any kind.
 *
 * @see docs/workplans/ADMIN_BOS_CLEANUP_SLICE_7A_WORKPLAN.md
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { requireAdmin } from '@/lib/admin/requireAdminRoute';
import { createLogger } from '@/lib/logger';
import {
  ADMIN_QUEUE_ITEMS_MAX_PAGE,
  ADMIN_QUEUE_ITEMS_PAGE_SIZE,
  adminJobsQueuesRepository,
} from '@/lib/repositories/AdminJobsQueuesRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { QUEUE_ITEM_QUEUE_IDS, QUEUE_ITEM_STATES, buildQueueItemsView } from '@/lib/admin/jobs/buildQueueItemsView';
import { asRepoResult, underDeadline, type ReadTiming } from '@/lib/admin/readUnderDeadline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'AdminQueueItemsAPI' });
const ROUTE = '/api/admin/jobs-queues/items';

/** Strict: no accountId, userId, limit or anything else can ever start to mean something. */
const QueueItemsQuerySchema = z
  .object({
    queue: z.enum(QUEUE_ITEM_QUEUE_IDS),
    state: z.enum(QUEUE_ITEM_STATES).default('stuck'),
    page: z.coerce.number().int().min(1).max(ADMIN_QUEUE_ITEMS_MAX_PAGE).default(1),
  })
  .strict();

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, route: ROUTE });

  // FIRST statement (C7-14). Nothing above it reads the query or the database;
  // the gate owns the 401/403 split and fails closed.
  const gate = await requireAdmin(requestLogger);
  if (gate instanceof NextResponse) return gate;
  const adminId = gate.user.id;

  try {
    // After the gate: 401/403 always win over 400. A repeated parameter is
    // resolved by fromEntries (last wins) and still validated.
    const parsed = QueueItemsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) {
      requestLogger.warn({ adminUserId: adminId }, 'Rejected a queue items request with invalid input');
      return NextResponse.json(
        {
          success: false,
          error: 'Choose a queue, a state and a page from the list',
          code: 'invalid_input',
          details: process.env.NODE_ENV === 'development' ? parsed.error.issues[0]?.message : undefined,
        },
        { status: 400 }
      );
    }
    const { queue, state, page } = parsed.data;

    const started = Date.now();
    // The clock is read ONCE and floored to the minute ON PURPOSE (W7A-8): the
    // list's stuck cut-off then equals the card's (jobs-queues/route.ts), and
    // every age and mark is measured against one reading. 7c must NOT reuse
    // this: it must call queueItemEligibility with the REAL clock, because a
    // floored clock can allow a re-send up to a minute after the window closed.
    const now = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    const context = { correlationId, adminId };
    const timings: ReadTiming[] = [];

    const items = await underDeadline('queue-items', timings, (signal) =>
      adminJobsQueuesRepository.listQueueItemsAllAccounts(context, queue, state, now, { page }, { signal })
    );
    if (!items.ok) {
      // Timings carry an error CLASS only; the message may hold row text.
      requestLogger.warn({ adminUserId: adminId, queue, state, page, reads: timings }, 'Queue items read failed');
      return NextResponse.json(
        {
          success: false,
          error: 'Could not load the items just now',
          details: process.env.NODE_ENV === 'development' ? items.error?.message : undefined,
        },
        { status: 500 }
      );
    }
    const { rows, total } = items.value;

    // Business names (C7-12): company_name only (OP-1). The lookup takes no
    // abort signal, so the deadline stops the WAIT but cannot cancel the
    // request (W7A-9). Acceptable: read-only, at most 50 ids, one `.in()`
    // request. BusinessProfileRepository is deliberately not changed here.
    let names: Map<string, string | null> | null = new Map();
    const userIds = [...new Set(rows.map((row) => row.userId))];
    if (userIds.length > 0) {
      const lookup = await underDeadline('queue-item-names', timings, () =>
        asRepoResult(
          businessProfileRepository.findAdminIdentitiesByUserIds(userIds).then((result) => {
            if (result.error || !result.data) throw result.error ?? new Error('No business names');
            return result.data;
          })
        )
      );
      if (lookup.ok) {
        // Only the name crosses over; vertical and sub_vertical are dropped here.
        names = new Map(lookup.value.map((identity) => [identity.user_id, identity.company_name] as const));
      } else {
        names = null;
        requestLogger.warn(
          {
            adminUserId: adminId,
            queue,
            code: (lookup.error as (Error & { code?: string }) | undefined)?.code ?? lookup.error?.name ?? 'Unknown',
          },
          'Business names could not be read for the queue items'
        );
      }
    }

    const view = buildQueueItemsView({
      queue,
      state,
      page,
      pageSize: ADMIN_QUEUE_ITEMS_PAGE_SIZE,
      maxPage: ADMIN_QUEUE_ITEMS_MAX_PAGE,
      total,
      rows,
      names,
      now,
    });

    // Counts and timings only: no id, name or row value.
    requestLogger.info(
      {
        adminUserId: adminId,
        queue,
        state,
        page,
        returned: view.items.length,
        total,
        namesResolved: names ? names.size : 0,
        namesFailed: names === null,
        totalMs: Date.now() - started,
        reads: timings,
      },
      'Queue items served'
    );

    return NextResponse.json({ success: true, data: view });
  } catch (error) {
    // The error goes to the server log only; it may carry row text.
    requestLogger.error({ err: error, adminUserId: adminId }, 'Queue items failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not load the items just now',
        details:
          process.env.NODE_ENV === 'development'
            ? error instanceof Error
              ? error.message
              : String(error)
            : undefined,
      },
      { status: 500 }
    );
  }
}
