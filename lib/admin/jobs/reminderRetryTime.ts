/**
 * The next time a retried payment reminder may be sent (ADMIN_BOS_CLEANUP
 * slice 7c; SA C7-8, OP-3, W7C-7).
 *
 * A reminder only goes out inside the business's sending hours (08:00–20:00 in
 * its own time zone). An admin retry asks the scheduler's own rule for the
 * soonest such moment after now, for the ROW's owner (never the admin), so the
 * retried row becomes due no earlier than that. The rule lives in
 * `PaymentReminderService` and is reused, never copied.
 *
 * THE ONE SERVICE CALL ON THE ADMIN ACTION PATH (W7D-5 as amended). This file
 * and `runQueueDrain.ts` are the only importers of the queue service modules
 * under app/api/admin, lib/admin and app/admin; this one may reach exactly one
 * member, which reads the business's zone and writes, sends and emits
 * nothing. Pinned by S-10 in
 * app/api/admin/jobs-queues/drain/__tests__/drain.source.guard.test.ts. The
 * action route imports this helper, not the service (W7B-6 unchanged).
 *
 * `server-only`: a client import is a build error, not a bundle leak.
 *
 * @module lib/admin/jobs/reminderRetryTime
 */

import 'server-only';

import { paymentReminderService } from '@/lib/services/PaymentReminderService';

/** The retried reminder's next sending-hours time: `now` itself when inside the window. */
export function reminderRetryTime(ownerUserId: string, now: Date): Promise<Date> {
  return paymentReminderService.nextSendableAt(ownerUserId, now);
}
