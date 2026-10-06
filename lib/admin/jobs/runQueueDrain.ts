/**
 * Run one Business OS queue's drain now, for the admin "Drain now" button
 * (ADMIN_BOS_CLEANUP slice 7d; C7-10, SA §C last column, §D.4).
 *
 * Each queue maps to THE SAME exported function its cron route calls, and to
 * nothing else. Calling it from here behaves exactly like a second,
 * overlapping cron run: the claim is `FOR UPDATE SKIP LOCKED` on pending rows,
 * and the 90 s reaper lease is above the route's 60 s `maxDuration`.
 *
 * What this NEVER does (the cron routes keep these): bill plan stages, scan
 * for overdue invoices, mark invoices overdue, retry card payments, or record
 * a run of the scheduled job. The source guard
 * (`app/api/admin/jobs-queues/drain/__tests__/drain.source.guard.test.ts`)
 * pins the five imports below as the only runtime imports of these service
 * modules on the admin path besides one: `reminderRetryTime.ts` (slice 7c,
 * SA OP-3), pinned to the single read-only `paymentReminderService` member
 * the admin retry needs (W7D-5 as amended, S-10).
 *
 * `server-only`: the jobs page's client files must never pull this in (C-21);
 * a mistaken client import becomes a build error, not a bundle leak.
 *
 * @module lib/admin/jobs/runQueueDrain
 */

import 'server-only';

import { paymentReminderService } from '@/lib/services/PaymentReminderService';
import { paymentAutomationEngine } from '@/lib/services/PaymentAutomationEngine';
import { processDueBriefings } from '@/lib/services/DailyBriefingDispatchService';
import { dispatchLeadResponses } from '@/lib/services/LeadResponseDispatchService';
import { drainInsightActions } from '@/lib/services/InsightActionDispatchService';
import { pickDrainCounts } from '@/lib/admin/jobs/drainCounts';
import type { BosQueueId } from '@/lib/cron/bosCronJobs';
import type { DrainCount } from '@/lib/admin/jobs/jobsQueuesTypes';

/**
 * Exhaustive over BosQueueId: TypeScript refuses a missing or extra queue.
 * Each entry calls its drain with no arguments, exactly as the cron does
 * (`processDueBriefings` defaults its clock to now).
 */
const DRAINS: Readonly<Record<BosQueueId, () => Promise<unknown>>> = {
  payment_reminders: () => paymentReminderService.processDueReminders(),
  payment_automations: () => paymentAutomationEngine.processScheduledExecutions(),
  daily_briefing_sends: () => processDueBriefings(),
  lead_responses: () => dispatchLeadResponses(),
  insight_actions: () => drainInsightActions(),
};

/**
 * Run the queue's drain to completion and return its allow-listed counts.
 * Awaited, never fired and forgotten (B7-11): the caller answers only after
 * the drain has finished. A drain that throws rejects here.
 */
export async function runQueueDrain(queue: BosQueueId): Promise<DrainCount[]> {
  return pickDrainCounts(queue, await DRAINS[queue]());
}
