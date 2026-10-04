/**
 * The Drain now count allow-list (ADMIN_BOS_CLEANUP slice 7d; C7-13, W7D-4).
 *
 * What it pins:
 *   - the queue ids the route accepts are exactly the five queues, from one
 *     list (DRAIN_QUEUE_IDS), and the allow-list covers exactly those five;
 *   - only allow-listed keys with finite numbers survive. Anything else a
 *     drain might return, including any text a future version might add, is
 *     dropped, and a missing key is dropped, never shown as 0.
 */

import { DRAIN_COUNT_KEYS, DRAIN_QUEUE_IDS, pickDrainCounts } from '@/lib/admin/jobs/drainCounts';
import { BOS_CRON_JOBS, BOS_QUEUES } from '@/lib/cron/bosCronJobs';

const sorted = (values: readonly string[]) => [...values].sort();

describe('DRAIN_QUEUE_IDS (W7D-4)', () => {
  it('is set-equal to the BOS_QUEUES ids, with no duplicates', () => {
    expect(new Set(DRAIN_QUEUE_IDS).size).toBe(DRAIN_QUEUE_IDS.length);
    expect(sorted(DRAIN_QUEUE_IDS)).toEqual(sorted(BOS_QUEUES.map((q) => q.id)));
  });

  it('is set-equal to the keys of DRAIN_COUNT_KEYS', () => {
    expect(sorted(DRAIN_QUEUE_IDS)).toEqual(sorted(Object.keys(DRAIN_COUNT_KEYS)));
  });
});

describe('pickDrainCounts (C7-13)', () => {
  it('payment_reminders: processed, sent, failed, in that order', () => {
    expect(pickDrainCounts('payment_reminders', { failed: 1, sent: 4, processed: 5 })).toEqual([
      { key: 'processed', label: 'picked up', value: 5 },
      { key: 'sent', label: 'sent', value: 4 },
      { key: 'failed', label: 'failed', value: 1 },
    ]);
  });

  it('payment_automations reports nothing: its drain returns void', () => {
    expect(DRAIN_COUNT_KEYS.payment_automations).toEqual([]);
    expect(pickDrainCounts('payment_automations', undefined)).toEqual([]);
    // Even if a future version returned numbers, nothing is allow-listed.
    expect(pickDrainCounts('payment_automations', { claimed: 3 })).toEqual([]);
  });

  it('daily_briefing_sends: enqueued, sent, skipped, failed', () => {
    expect(
      pickDrainCounts('daily_briefing_sends', { enqueued: 2, sent: 1, skipped: 1, failed: 0 }).map((c) => c.key)
    ).toEqual(['enqueued', 'sent', 'skipped', 'failed']);
  });

  it('lead_responses and insight_actions use the cron page labels for the same keys', () => {
    for (const queue of ['lead_responses', 'insight_actions'] as const) {
      const job = BOS_CRON_JOBS.find((j) => j.drainsQueue === queue);
      expect(job).toBeDefined();
      for (const { key, label } of DRAIN_COUNT_KEYS[queue]) {
        const cronLabel = job!.counts.find((c) => c.key === key)?.label;
        expect(cronLabel).toBe(label);
      }
    }
  });

  it('keeps finite numbers only; a missing key is dropped, not shown as 0', () => {
    const counts = pickDrainCounts('insight_actions', {
      reaped: Number.NaN,
      claimed: Number.POSITIVE_INFINITY,
      sent: '3',
      skipped: null,
      // failed is missing
    });
    expect(counts).toEqual([]);
    expect(pickDrainCounts('insight_actions', { sent: 0 })).toEqual([{ key: 'sent', label: 'sent', value: 0 }]);
  });

  it('drops every key that is not allow-listed, including text', () => {
    const counts = pickDrainCounts('lead_responses', {
      sent: 1,
      error_message: 'SENTINEL-ERR',
      skip_reason: 'SENTINEL-SKIP',
      payload: { to: 'sentinel@client.test' },
      contactId: 'SENTINEL-CONTACT',
      ids: ['SENTINEL-ID'],
    });
    expect(counts).toEqual([{ key: 'sent', label: 'sent', value: 1 }]);
    expect(JSON.stringify(counts)).not.toMatch(/SENTINEL|@/);
  });

  it.each([null, undefined, 5, 'text', ['sent'], true])('a non-object result (%p) yields no counts', (raw) => {
    expect(pickDrainCounts('payment_reminders', raw)).toEqual([]);
  });
});
