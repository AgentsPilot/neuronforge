/**
 * The shared per-item eligibility function (ADMIN_BOS_CLEANUP slice 7a;
 * SA C7-1, C7-2, C7-5, C7-7, C7-9; workplan §5.4 and conditions W7A-1, W7A-7).
 *
 * The list (7a) and the action routes (7b cancel, 7c re-send) all call this one
 * function, so the §C matrix and the 72-hour rule are pinned here, per queue,
 * with the boundary. The expected matrix below is written out by hand from the
 * requirement's §C table, not derived from the module's own constants.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  CANCEL_FROM_STATUSES,
  IN_PROGRESS_STATUS,
  RETRY_FROM_STATUSES,
  RETRY_WINDOW_HOURS,
  queueItemEligibility,
  type QueueItemFacts,
} from '../queueItemEligibility';
import { BOS_QUEUES, type BosQueueId } from '@/lib/cron/bosCronJobs';
import { businessDayFor } from '@/lib/business-os/businessDay';
import { ADMIN_QUEUE_SPECS } from '@/lib/repositories/AdminJobsQueuesRepository';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const HOUR = 3600 * 1000;
const WINDOW_MS = 72 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

function facts(overrides: Partial<QueueItemFacts> = {}): QueueItemFacts {
  return {
    status: 'failed',
    claimedAt: null,
    scheduledAt: iso(NOW.getTime() - HOUR),
    createdAt: iso(NOW.getTime() - HOUR),
    briefingDate: '2026-10-04',
    timezone: 'UTC',
    ...overrides,
  };
}

const QUEUES = BOS_QUEUES.map((q) => q.id);

/** §C by hand. `cancel: 'orphan'` = only when claimed_at IS NULL (C7-2). */
type Cell = { retry: boolean; cancel: boolean | 'orphan' };
const MATRIX: Record<BosQueueId, Record<string, Cell>> = {
  payment_reminders: {
    pending: { retry: false, cancel: true },
    processing: { retry: false, cancel: 'orphan' },
    sent: { retry: false, cancel: false },
    failed: { retry: true, cancel: true },
    cancelled: { retry: false, cancel: false },
  },
  payment_automations: {
    pending: { retry: false, cancel: true },
    running: { retry: false, cancel: 'orphan' },
    completed: { retry: false, cancel: false },
    failed: { retry: false, cancel: true },
    cancelled: { retry: false, cancel: false },
    dead_letter: { retry: false, cancel: true },
  },
  daily_briefing_sends: {
    pending: { retry: false, cancel: true },
    processing: { retry: false, cancel: 'orphan' },
    sent: { retry: false, cancel: false },
    skipped: { retry: false, cancel: false },
    failed: { retry: true, cancel: true },
  },
  lead_responses: {
    pending: { retry: false, cancel: true },
    processing: { retry: false, cancel: 'orphan' },
    sent: { retry: false, cancel: false },
    skipped: { retry: false, cancel: false },
    failed: { retry: true, cancel: true },
  },
  insight_actions: {
    pending: { retry: false, cancel: true },
    processing: { retry: false, cancel: 'orphan' },
    sent: { retry: false, cancel: false },
    skipped: { retry: false, cancel: false },
    failed: { retry: true, cancel: true },
  },
};

describe('E-12: the matrix as data covers exactly the five queues', () => {
  it('keys are set-equal to BOS_QUEUES', () => {
    for (const table of [RETRY_FROM_STATUSES, CANCEL_FROM_STATUSES, IN_PROGRESS_STATUS]) {
      expect(Object.keys(table).sort()).toEqual([...QUEUES].sort());
    }
  });

  it('payment automations have an empty re-send list (C7-5)', () => {
    expect(RETRY_FROM_STATUSES.payment_automations).toEqual([]);
  });

  it('the in-progress status matches the repository spec', () => {
    for (const queue of QUEUES) expect(IN_PROGRESS_STATUS[queue]).toBe(ADMIN_QUEUE_SPECS[queue].inProgress);
  });

  it('the hand-written matrix names every known status of each table', () => {
    for (const queue of QUEUES) expect(Object.keys(MATRIX[queue]).sort()).toEqual([...ADMIN_QUEUE_SPECS[queue].known].sort());
  });

  it('the window is 72 hours (OQ-3)', () => {
    expect(RETRY_WINDOW_HOURS).toBe(72);
  });
});

describe.each(QUEUES)('E-1: the §C matrix, %s', (queue) => {
  const statuses = Object.keys(MATRIX[queue]);

  it.each(statuses)('status %s, orphaned and leased', (status) => {
    const cell = MATRIX[queue][status];
    for (const claimedAt of [null, iso(NOW.getTime() - 60_000)]) {
      const result = queueItemEligibility(queue, facts({ status, claimedAt }), NOW);
      const leased = claimedAt !== null && status === IN_PROGRESS_STATUS[queue];
      // A row with a claim but a non-in-progress status is not "leased": the
      // terminal writes clear claimed_at, and the lease only matters in progress.
      expect(result.retry.allowed).toBe(cell.retry);
      const cancelAllowed = cell.cancel === 'orphan' ? !leased : cell.cancel;
      expect(result.cancel.allowed).toBe(cancelAllowed);
      if (leased) {
        expect(result.cancel).toEqual({ allowed: false, code: 'leased' });
        expect(result.retry).toEqual({
          allowed: false,
          code: queue === 'payment_automations' ? 'retry_not_offered' : 'not_retryable_state',
        });
      }
      if (!cancelAllowed && !leased) expect(result.cancel).toEqual({ allowed: false, code: 'not_cancellable_state' });
    }
  });

  it('an unrecognised status offers neither re-send nor cancel (fail closed, W7A-1)', () => {
    for (const status of ['overdue', '', 'FAILED', 'processing ']) {
      const result = queueItemEligibility(queue, facts({ status }), NOW);
      expect(result.retry.allowed).toBe(false);
      expect(result.cancel).toEqual({ allowed: false, code: 'not_cancellable_state' });
      expect(result.retry).toEqual({
        allowed: false,
        code: queue === 'payment_automations' ? 'retry_not_offered' : 'not_retryable_state',
      });
    }
  });
});

describe('E-2..E-4: payment reminders, 72 h from scheduled_at, inclusive', () => {
  it('E-2: exactly 72 h after scheduled_at is allowed, until = scheduled_at + 72 h', () => {
    const scheduledAt = iso(NOW.getTime() - WINDOW_MS);
    const result = queueItemEligibility('payment_reminders', facts({ scheduledAt }), NOW);
    expect(result.retry).toEqual({ allowed: true, until: NOW.toISOString() });
    expect(result.anchorAt).toBe(scheduledAt);
  });

  it('E-3: one millisecond later is refused', () => {
    const scheduledAt = iso(NOW.getTime() - WINDOW_MS - 1);
    expect(queueItemEligibility('payment_reminders', facts({ scheduledAt }), NOW).retry).toEqual({
      allowed: false,
      code: 'retry_window_passed',
    });
  });

  it('E-4: a retryAt past the window is refused although now is inside it (the 7c sending-hours hook)', () => {
    const scheduledAt = iso(NOW.getTime() - HOUR);
    const retryAt = new Date(NOW.getTime() + WINDOW_MS);
    const result = queueItemEligibility('payment_reminders', facts({ scheduledAt }), NOW, { retryAt });
    expect(result.retry).toEqual({ allowed: false, code: 'retry_window_passed' });
    // Without the hook the same row is allowed.
    expect(queueItemEligibility('payment_reminders', facts({ scheduledAt }), NOW).retry.allowed).toBe(true);
  });

  it('W7A-7(b): a microsecond anchor is truncated to the millisecond, which is never more lenient than the CAS', () => {
    // Postgres keeps .123456; Date.parse keeps .123. The stored anchor is
    // therefore >= the parsed one, so the function can refuse a hair earlier
    // than `.gte(anchor, now - 72 h)` would, never later.
    const scheduledAt = '2026-10-01T12:00:00.123456+00:00';
    const parsed = Date.parse('2026-10-01T12:00:00.123Z');
    const atBoundary = new Date(parsed + WINDOW_MS);
    const allowed = queueItemEligibility('payment_reminders', facts({ scheduledAt }), atBoundary);
    expect(allowed.retry).toEqual({ allowed: true, until: '2026-10-04T12:00:00.123Z' });
    expect(allowed.anchorAt).toBe('2026-10-01T12:00:00.123Z');
    const after = queueItemEligibility('payment_reminders', facts({ scheduledAt }), new Date(parsed + WINDOW_MS + 1));
    expect(after.retry).toEqual({ allowed: false, code: 'retry_window_passed' });
  });
});

describe.each(['lead_responses', 'insight_actions'] as const)('E-5: %s, 72 h from created_at', (queue) => {
  it('exactly 72 h is allowed; 1 ms later is refused; scheduled_at is ignored', () => {
    const createdAt = iso(NOW.getTime() - WINDOW_MS);
    const ok = queueItemEligibility(queue, facts({ createdAt, scheduledAt: iso(NOW.getTime() - 100 * HOUR) }), NOW);
    expect(ok.retry).toEqual({ allowed: true, until: NOW.toISOString() });
    expect(ok.anchorAt).toBe(createdAt);
    const late = queueItemEligibility(queue, facts({ createdAt: iso(NOW.getTime() - WINDOW_MS - 1), scheduledAt: null }), NOW);
    expect(late.retry).toEqual({ allowed: false, code: 'retry_window_passed' });
  });
});

describe('E-6: payment automations never re-send, whatever the status (C7-5, W7A-1)', () => {
  it.each(['pending', 'running', 'completed', 'failed', 'cancelled', 'dead_letter', 'unknown'])('%s', (status) => {
    for (const claimedAt of [null, iso(NOW.getTime() - 60_000)]) {
      const result = queueItemEligibility('payment_automations', facts({ status, claimedAt }), NOW);
      expect(result.retry).toEqual({ allowed: false, code: 'retry_not_offered' });
    }
  });

  it('cancel includes dead_letter and a pending row with no scheduled_at', () => {
    expect(queueItemEligibility('payment_automations', facts({ status: 'dead_letter' }), NOW).cancel).toEqual({ allowed: true });
    expect(
      queueItemEligibility('payment_automations', facts({ status: 'pending', scheduledAt: null }), NOW).cancel
    ).toEqual({ allowed: true });
  });
});

describe('E-7..E-10: the briefing, same business day in the row\'s own zone (C7-7)', () => {
  it('E-7: today in Asia/Jerusalem at 23:59 local is allowed, until that day ends (exclusive)', () => {
    const now = new Date('2026-10-04T20:59:00.000Z'); // 23:59 IDT
    const result = queueItemEligibility(
      'daily_briefing_sends',
      facts({ briefingDate: '2026-10-04', timezone: 'Asia/Jerusalem' }),
      now
    );
    expect(result.retry).toEqual({ allowed: true, until: '2026-10-04T21:00:00.000Z' });
    // W7A-7(c): `until` is the businessDayFor endUtc, the NEXT day's first instant.
    expect(businessDayFor(now, 'Asia/Jerusalem').endUtc).toBe('2026-10-04T21:00:00.000Z');
    expect(result.anchorAt).toBe('2026-10-03T21:00:00.000Z');
  });

  it('E-8: one minute after local midnight the same row is refused', () => {
    const now = new Date('2026-10-04T21:01:00.000Z'); // 00:01 IDT on the 5th
    expect(
      queueItemEligibility('daily_briefing_sends', facts({ briefingDate: '2026-10-04', timezone: 'Asia/Jerusalem' }), now).retry
    ).toEqual({ allowed: false, code: 'briefing_not_today' });
  });

  it('E-9: the row\'s zone governs, not UTC', () => {
    const now = new Date('2026-10-05T01:00:00.000Z'); // 18:00 PDT on the 4th
    expect(
      queueItemEligibility('daily_briefing_sends', facts({ briefingDate: '2026-10-04', timezone: 'America/Los_Angeles' }), now).retry
    ).toEqual({ allowed: true, until: '2026-10-05T07:00:00.000Z' });
    expect(
      queueItemEligibility('daily_briefing_sends', facts({ briefingDate: '2026-10-04', timezone: 'UTC' }), now).retry
    ).toEqual({ allowed: false, code: 'briefing_not_today' });
  });

  it('E-10: an unusable or missing zone falls back to UTC, exactly as businessDayFor', () => {
    for (const timezone of ['Not/AZone', null, '']) {
      const result = queueItemEligibility('daily_briefing_sends', facts({ briefingDate: '2026-10-04', timezone }), NOW);
      expect(result.retry).toEqual({ allowed: true, until: businessDayFor(NOW, 'UTC').endUtc });
      expect(result.anchorAt).toBe('2026-10-04T00:00:00.000Z');
    }
  });

  it('a briefing from a future day (clock skew) is not "today" either', () => {
    expect(
      queueItemEligibility('daily_briefing_sends', facts({ briefingDate: '2026-10-05' }), NOW).retry
    ).toEqual({ allowed: false, code: 'briefing_not_today' });
  });
});

describe('W7A-7(a): a dead-lettered row (failed + marker) re-sends exactly like a plain failed row', () => {
  // The marker lives in error_message, which the function never sees: a
  // dead-lettered row on these four tables is just status 'failed' to it.
  it.each(['payment_reminders', 'daily_briefing_sends', 'lead_responses', 'insight_actions'] as const)('%s', (queue) => {
    const deadLettered = facts({ status: 'failed', claimedAt: null });
    const plain = facts({ status: 'failed' });
    expect(queueItemEligibility(queue, deadLettered, NOW)).toEqual(queueItemEligibility(queue, plain, NOW));
    expect(queueItemEligibility(queue, deadLettered, NOW).retry.allowed).toBe(true);
  });
});

describe('W7A-7(d): retryAt is ignored for the briefing and for payment automations', () => {
  it('briefing: a retryAt tomorrow does not change "today"', () => {
    const retryAt = new Date(NOW.getTime() + 30 * HOUR);
    expect(queueItemEligibility('daily_briefing_sends', facts(), NOW, { retryAt })).toEqual(
      queueItemEligibility('daily_briefing_sends', facts(), NOW)
    );
  });

  it('payment automations: still retry_not_offered, cancel unchanged', () => {
    const retryAt = new Date(NOW.getTime() - 100 * HOUR);
    expect(queueItemEligibility('payment_automations', facts(), NOW, { retryAt })).toEqual(
      queueItemEligibility('payment_automations', facts(), NOW)
    );
  });
});

describe('E-11: a missing or unparseable anchor fails closed (no_due_time)', () => {
  it.each([
    ['payment_reminders', { scheduledAt: null }],
    ['payment_reminders', { scheduledAt: 'not a time' }],
    ['lead_responses', { createdAt: 'garbage' }],
    ['insight_actions', { createdAt: '' }],
    ['daily_briefing_sends', { briefingDate: null }],
    ['daily_briefing_sends', { briefingDate: '04/10/2026' }],
  ] as const)('%s %j', (queue, overrides) => {
    const result = queueItemEligibility(queue, facts(overrides as Partial<QueueItemFacts>), NOW);
    expect(result.retry).toEqual({ allowed: false, code: 'no_due_time' });
    expect(result.anchorAt).toBeNull();
    expect(result.cancel).toEqual({ allowed: true });
  });
});

describe('CR7A-1: an invalid clock fails closed (retry_window_passed), cancel unchanged', () => {
  const INVALID = new Date('x');

  it('payment reminder: an invalid retryAt is refused, though now is inside the window', () => {
    const valid = queueItemEligibility('payment_reminders', facts(), NOW);
    expect(valid.retry.allowed).toBe(true);
    const result = queueItemEligibility('payment_reminders', facts(), NOW, { retryAt: INVALID });
    expect(result.retry).toEqual({ allowed: false, code: 'retry_window_passed' });
    expect(result.cancel).toEqual(valid.cancel);
    expect(result.cancel).toEqual({ allowed: true });
  });

  it('lead reply: an invalid now is refused', () => {
    const valid = queueItemEligibility('lead_responses', facts(), NOW);
    expect(valid.retry.allowed).toBe(true);
    const result = queueItemEligibility('lead_responses', facts(), INVALID);
    expect(result.retry).toEqual({ allowed: false, code: 'retry_window_passed' });
    expect(result.cancel).toEqual(valid.cancel);
    expect(result.cancel).toEqual({ allowed: true });
  });

  it('a 2020 reminder with an invalid retryAt is refused (the SA probe)', () => {
    const result = queueItemEligibility(
      'payment_reminders',
      facts({ scheduledAt: '2020-01-01T00:00:00.000Z' }),
      NOW,
      { retryAt: INVALID }
    );
    expect(result.retry).toEqual({ allowed: false, code: 'retry_window_passed' });
  });

  it('briefing: an invalid now is refused and does not throw; cancel unchanged', () => {
    const valid = queueItemEligibility('daily_briefing_sends', facts(), NOW);
    expect(valid.retry.allowed).toBe(true);
    const result = queueItemEligibility('daily_briefing_sends', facts(), INVALID);
    expect(result.retry).toEqual({ allowed: false, code: 'retry_window_passed' });
    expect(result.cancel).toEqual(valid.cancel);
  });

  it('a non-retryable state keeps its own code under an invalid now', () => {
    for (const queue of ['daily_briefing_sends', 'lead_responses'] as const) {
      const result = queueItemEligibility(queue, facts({ status: 'pending' }), INVALID);
      expect(result.retry).toEqual({ allowed: false, code: 'not_retryable_state' });
      expect(result.cancel).toEqual({ allowed: true });
    }
  });
});

describe('E-13: purity', () => {
  it('reads no clock and does no I/O', () => {
    const code = fs
      .readFileSync(path.join(process.cwd(), 'lib/admin/jobs/queueItemEligibility.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/Date\.now\(/);
    expect(code).not.toMatch(/new Date\(\s*\)/);
    expect(code).not.toMatch(/fetch\(|supabase|createLogger|process\.env/);
    const imports = [...code.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    // Amended by slice 7c (SA fallback (b)): + the LEAD_RETRY_HELD switch, a
    // constant-only module that itself imports nothing (pinned below).
    expect(imports.sort()).toEqual(
      ['@/lib/admin/jobs/jobsQueuesTypes', '@/lib/admin/jobs/retryHolds', '@/lib/business-os/businessDay', '@/lib/cron/bosCronJobs'].sort()
    );
    const holds = fs
      .readFileSync(path.join(process.cwd(), 'lib/admin/jobs/retryHolds.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(holds).not.toMatch(/\bimport\b|\brequire\(|process\.env/);
    expect(holds.trim()).toMatch(/^export const LEAD_RETRY_HELD = (false|true) as boolean;$/);
  });
});
