/**
 * Write to the event rail without ever being able to break the caller.
 *
 * The rail records what HAPPENED, so every emit sits behind a write that has
 * already succeeded. A booking is booked, an invoice is paid, a refund is
 * issued: the business fact is true the moment the row lands, and the event is
 * a note about it. That ordering is what makes fire-and-forget the correct
 * shape here rather than a shortcut -- there is nothing to roll back, and a
 * caller that awaited this would be holding a user's request open for a note.
 *
 * `SchedulingRepository` established the pattern and this is it, extracted so
 * the eight call sites on the rail do not each re-derive it:
 *
 *   - a dynamic import, so a repository never statically depends on the insight
 *     module and no import cycle can form
 *   - `void` plus `.catch`, so a failed or unmigrated rail is a debug line
 *   - `logger.debug`, not `warn`: on an account where the rail is behind this
 *     would otherwise log once per payment
 *
 * What this deliberately does NOT do is guarantee delivery. An event is lost if
 * the process dies between the write and the emit, which on serverless means a
 * cold start can drop one. That is accepted: `scripts/backfill-business-events`
 * reconstructs every type on this rail from the module tables' own timestamps,
 * so the repair for a gap is to re-run the backfill rather than to make every
 * payment wait for a durable queue. If the rail ever becomes something a
 * customer-visible number is computed from, revisit this and read
 * BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN section 8.1 first.
 */

import { createLogger } from '@/lib/logger';
import type { EmitBusinessEventParams } from './types';

const logger = createLogger({ module: 'recordBusinessEvent' });

/**
 * Note that something happened, and return immediately.
 *
 * Returns `void` rather than a promise on purpose: a caller cannot await it by
 * accident, and cannot be tempted to branch on whether it worked.
 */
export function recordBusinessEvent(
  userId: string,
  params: EmitBusinessEventParams
): void {
  void (async () => {
    const { businessEventService } = await import('./BusinessEventService');
    const { error } = await businessEventService.emit(userId, params);
    if (error) throw error;
  })().catch(err =>
    logger.debug(
      { err, userId, eventType: params.eventType, entityId: params.entityId },
      'Event rail write skipped'
    )
  );
}
