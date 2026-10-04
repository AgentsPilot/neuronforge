/**
 * What a "Drain now" run may report, per queue (ADMIN_BOS_CLEANUP slice 7d;
 * C7-13, SA W7D-4).
 *
 * PURE and runtime-import-free: type-only imports, no values from anywhere.
 * The route validates its `queue` against DRAIN_QUEUE_IDS, and
 * `runQueueDrain` passes each drain's raw result through `pickDrainCounts`.
 *
 * ── Why an allow-list ──────────────────────────────────────────────────────
 * The drain functions return counts today. If a future version added an error
 * message, an id or a name, it must not reach the response, the log or the
 * page. So only these keys, with finite numbers, are kept; anything else is
 * dropped, and a missing key is dropped rather than shown as 0. The labels
 * follow `BOS_CRON_JOBS` for the same keys.
 *
 * @module lib/admin/jobs/drainCounts
 */

import type { BosQueueId } from '@/lib/cron/bosCronJobs';
import type { DrainCount } from '@/lib/admin/jobs/jobsQueuesTypes';

/**
 * The queue ids "Drain now" accepts: the single list the route's Zod enum is
 * built from (W7D-4). `satisfies` refuses an id that is not a queue; the
 * set-equality test (and the exhaustive Record below) refuses a missing one.
 */
export const DRAIN_QUEUE_IDS = [
  'payment_reminders',
  'payment_automations',
  'daily_briefing_sends',
  'lead_responses',
  'insight_actions',
] as const satisfies readonly BosQueueId[];

interface DrainCountKey {
  key: string;
  label: string;
}

/** Exhaustive over BosQueueId: TypeScript refuses a missing or extra queue. */
export const DRAIN_COUNT_KEYS: Readonly<Record<BosQueueId, readonly DrainCountKey[]>> = {
  payment_reminders: [
    { key: 'processed', label: 'picked up' },
    { key: 'sent', label: 'sent' },
    { key: 'failed', label: 'failed' },
  ],
  // `processScheduledExecutions()` returns void (SA OP-2: not changed here).
  payment_automations: [],
  daily_briefing_sends: [
    { key: 'enqueued', label: 'queued' },
    { key: 'sent', label: 'sent' },
    { key: 'skipped', label: 'skipped (a quiet day or nothing to say)' },
    { key: 'failed', label: 'failed' },
  ],
  lead_responses: [
    { key: 'reaped', label: 'recovered from a dead run' },
    { key: 'enqueued', label: 'queued' },
    { key: 'claimed', label: 'picked up' },
    { key: 'sent', label: 'sent' },
    { key: 'skipped', label: 'skipped' },
  ],
  insight_actions: [
    { key: 'reaped', label: 'recovered from a dead run' },
    { key: 'claimed', label: 'picked up' },
    { key: 'sent', label: 'sent' },
    { key: 'skipped', label: 'skipped' },
    { key: 'failed', label: 'failed' },
  ],
};

/**
 * The allow-listed counts of one drain result, in allow-list order. Finite
 * numbers only; everything else is dropped.
 */
export function pickDrainCounts(queue: BosQueueId, raw: unknown): DrainCount[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  const counts: DrainCount[] = [];
  for (const { key, label } of DRAIN_COUNT_KEYS[queue]) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) counts.push({ key, label, value });
  }
  return counts;
}
