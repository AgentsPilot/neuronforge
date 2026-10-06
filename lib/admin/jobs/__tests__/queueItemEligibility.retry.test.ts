/**
 * The retry write bound and the lead-retry hold (ADMIN_BOS_CLEANUP slice 7c;
 * SA C7-9, W7C-4, W7C-5, OP-19, the 7a "carried to 7c" items 2 and 3, and
 * SA's fallback (b) for BL-7a; workplan §2.2 and §5.12 E-1..E-5).
 *
 * `retryWriteBound` is the CAS predicate that re-checks, inside the UPDATE,
 * exactly what `queueItemEligibility` decided. It lives beside the decision
 * and these tests pin the two equivalent (E-2), so the route and the write
 * can never disagree about the window.
 *
 * A separate file from queueItemEligibility.test.ts so that suite runs
 * unedited (E-5: nothing existing moved).
 */

let mockHeld = false;
jest.mock('../retryHolds', () => ({
  get LEAD_RETRY_HELD() {
    return mockHeld;
  },
}));

import {
  RETRY_ANCHOR_COLUMN,
  RETRY_FROM_STATUSES,
  queueItemEligibility,
  retryWriteBound,
  type QueueItemFacts,
  type RetryWriteBound,
} from '../queueItemEligibility';
import { businessDayFor } from '@/lib/business-os/businessDay';
import { BOS_QUEUES, type BosQueueId } from '@/lib/cron/bosCronJobs';

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

/** Would the CAS bound match this row? Evaluated the way Postgres does, on the stored text. */
function boundHolds(bound: RetryWriteBound, row: QueueItemFacts): boolean {
  if ('eq' in bound) return row.briefingDate === bound.eq;
  const stored = bound.column === 'scheduled_at' ? row.scheduledAt : row.createdAt;
  if (stored === null) return false;
  return Date.parse(stored) >= Date.parse(bound.gte);
}

beforeEach(() => {
  mockHeld = false;
});

describe('E-1 retryWriteBound, per queue', () => {
  it('payment reminders: gte scheduled_at = retryAt − 72 h, never now − 72 h (carried item 2)', () => {
    const retryAt = new Date(NOW.getTime() + 9 * HOUR);
    expect(retryWriteBound('payment_reminders', facts(), NOW, retryAt)).toEqual({
      column: 'scheduled_at',
      gte: iso(retryAt.getTime() - WINDOW_MS),
    });
    expect(retryWriteBound('payment_reminders', facts(), NOW, retryAt)).not.toEqual({
      column: 'scheduled_at',
      gte: iso(NOW.getTime() - WINDOW_MS),
    });
  });

  it('payment reminders: no retryAt → null (the next sending time is required, fail closed)', () => {
    expect(retryWriteBound('payment_reminders', facts(), NOW)).toBeNull();
    expect(retryWriteBound('payment_reminders', facts(), NOW, new Date('nope'))).toBeNull();
  });

  it.each(['lead_responses', 'insight_actions'] as const)('%s: gte created_at = now − 72 h; a retryAt is ignored', (queue) => {
    expect(retryWriteBound(queue, facts(), NOW)).toEqual({ column: 'created_at', gte: iso(NOW.getTime() - WINDOW_MS) });
    expect(retryWriteBound(queue, facts(), NOW, new Date(NOW.getTime() + 50 * HOUR))).toEqual({
      column: 'created_at',
      gte: iso(NOW.getTime() - WINDOW_MS),
    });
  });

  it('daily briefing: eq briefing_date = today in the ROW\'s zone', () => {
    expect(retryWriteBound('daily_briefing_sends', facts({ timezone: 'Pacific/Auckland' }), NOW)).toEqual({
      column: 'briefing_date',
      eq: businessDayFor(NOW, 'Pacific/Auckland').date,
    });
    expect(businessDayFor(NOW, 'Pacific/Auckland').date).toBe('2026-10-05');
  });

  it('daily briefing: a null zone falls back to UTC, the same fallback as the decision and the dispatcher', () => {
    expect(retryWriteBound('daily_briefing_sends', facts({ timezone: null }), NOW)).toEqual({ column: 'briefing_date', eq: '2026-10-04' });
    expect(retryWriteBound('daily_briefing_sends', facts({ timezone: 'Not/AZone' }), NOW)).toEqual({ column: 'briefing_date', eq: '2026-10-04' });
  });

  it('payment automations → null; an invalid now → null on every queue', () => {
    expect(retryWriteBound('payment_automations', facts(), NOW, NOW)).toBeNull();
    for (const queue of BOS_QUEUES.map((q) => q.id)) {
      expect(retryWriteBound(queue, facts(), new Date(Number.NaN), NOW)).toBeNull();
    }
  });
});

describe('E-2 equivalence: the decision allows ⇔ the CAS bound holds on the row', () => {
  const offsets = [-WINDOW_MS - 1, -WINDOW_MS, -WINDOW_MS + 1, -71 * HOUR, -HOUR, 0];

  it.each(['lead_responses', 'insight_actions'] as const)('%s, anchors around now − 72 h', (queue) => {
    for (const offset of offsets) {
      const row = facts({ createdAt: iso(NOW.getTime() + offset) });
      const allowed = queueItemEligibility(queue, row, NOW).retry.allowed;
      expect([offset, boundHolds(retryWriteBound(queue, row, NOW)!, row)]).toEqual([offset, allowed]);
    }
  });

  it('payment reminders, with retryAt before, at and after the limit', () => {
    for (const offset of offsets) {
      for (const shift of [0, 5 * HOUR, 20 * HOUR]) {
        const row = facts({ scheduledAt: iso(NOW.getTime() + offset) });
        const retryAt = new Date(NOW.getTime() + shift);
        const allowed = queueItemEligibility('payment_reminders', row, NOW, { retryAt }).retry.allowed;
        const holds = boundHolds(retryWriteBound('payment_reminders', row, NOW, retryAt)!, row);
        expect([offset, shift, holds]).toEqual([offset, shift, allowed]);
      }
    }
  });

  it('daily briefing over the zone set of BM-3, either side of each local midnight', () => {
    const cases: Array<[string, string, string]> = [
      // zone, the instant, the row's date
      ['America/Los_Angeles', '2026-10-05T06:59:59.999Z', '2026-10-04'], // 23:59:59.999 local
      ['America/Los_Angeles', '2026-10-05T07:00:00.000Z', '2026-10-04'], // 00:00 local on the 5th
      ['Asia/Kolkata', '2026-10-04T18:29:59.999Z', '2026-10-04'],
      ['Asia/Kolkata', '2026-10-04T18:30:00.000Z', '2026-10-04'],
      ['Pacific/Chatham', '2026-10-04T10:14:59.999Z', '2026-10-04'],
      ['Pacific/Chatham', '2026-10-04T10:15:00.000Z', '2026-10-04'],
      ['UTC', '2026-10-04T23:59:59.999Z', '2026-10-04'],
      ['UTC', '2026-10-05T00:00:00.000Z', '2026-10-04'],
    ];
    for (const [zone, at, date] of cases) {
      const now = new Date(at);
      const row = facts({ timezone: zone, briefingDate: date });
      const allowed = queueItemEligibility('daily_briefing_sends', row, now).retry.allowed;
      const holds = boundHolds(retryWriteBound('daily_briefing_sends', row, now)!, row);
      expect([zone, at, holds]).toEqual([zone, at, allowed]);
    }
    // And the cases above really straddle midnight: one allowed, one refused, per zone.
    const verdicts = cases.map(([zone, at, date]) =>
      queueItemEligibility('daily_briefing_sends', facts({ timezone: zone, briefingDate: date }), new Date(at)).retry.allowed
    );
    expect(verdicts).toEqual([true, false, true, false, true, false, true, false]);
  });
});

describe('E-3 RETRY_ANCHOR_COLUMN', () => {
  it('names exactly the four retryable queues, each with its own anchor column', () => {
    expect(RETRY_ANCHOR_COLUMN).toEqual({
      payment_reminders: 'scheduled_at',
      daily_briefing_sends: 'briefing_date',
      lead_responses: 'created_at',
      insight_actions: 'created_at',
    });
    const retryable = BOS_QUEUES.map((q) => q.id).filter((q) => RETRY_FROM_STATUSES[q].length > 0);
    expect(Object.keys(RETRY_ANCHOR_COLUMN).sort()).toEqual([...retryable].sort());
    expect(Object.isFrozen(RETRY_ANCHOR_COLUMN)).toBe(true);
  });

  it('every bound names its queue\'s own column', () => {
    for (const queue of Object.keys(RETRY_ANCHOR_COLUMN) as Array<keyof typeof RETRY_ANCHOR_COLUMN>) {
      expect(retryWriteBound(queue, facts(), NOW, NOW)?.column).toBe(RETRY_ANCHOR_COLUMN[queue]);
    }
  });
});

describe('E-4 microseconds: the function is never looser than the CAS (carried item 3)', () => {
  it('a stored anchor with microseconds, retried at exactly parsed-anchor + 72 h', () => {
    const stored = '2026-10-01T09:00:00.123456+00:00';
    const parsed = Date.parse(stored);
    expect(iso(parsed)).toBe('2026-10-01T09:00:00.123Z');
    const now = new Date(parsed + WINDOW_MS);
    const row = facts({ createdAt: stored });
    expect(queueItemEligibility('lead_responses', row, now).retry.allowed).toBe(true);
    const bound = retryWriteBound('lead_responses', row, now)!;
    expect(bound).toEqual({ column: 'created_at', gte: '2026-10-01T09:00:00.123Z' });
    // Postgres compares the full stored value (…123456) with the bound (…123000): it matches.
    if (!('gte' in bound)) throw new Error('expected a gte bound');
    expect('2026-10-01T09:00:00.123456' >= bound.gte.replace('Z', '000')).toBe(true);
  });
});

describe('LEAD_RETRY_HELD: SA fallback (b) for BL-7a, both states', () => {
  it('false (the default): a failed lead reply in its window is retryable', () => {
    mockHeld = false;
    expect(queueItemEligibility('lead_responses', facts(), NOW).retry).toEqual({ allowed: true, until: iso(NOW.getTime() - HOUR + WINDOW_MS) });
    expect(retryWriteBound('lead_responses', facts(), NOW)).not.toBeNull();
  });

  it('true: every lead reply is refused retry_held, before the state; cancel is untouched; no bound', () => {
    mockHeld = true;
    for (const status of ['failed', 'pending', 'processing', 'sent']) {
      const result = queueItemEligibility('lead_responses', facts({ status }), NOW);
      expect(result.retry).toEqual({ allowed: false, code: 'retry_held' });
      expect(result.cancel).toEqual(queueItemEligibility('insight_actions', facts({ status }), NOW).cancel);
    }
    expect(retryWriteBound('lead_responses', facts(), NOW)).toBeNull();
  });

  it('true holds lead replies only: the other three queues are unaffected', () => {
    mockHeld = true;
    const others: BosQueueId[] = ['payment_reminders', 'daily_briefing_sends', 'insight_actions'];
    for (const queue of others) {
      expect(queueItemEligibility(queue, facts(), NOW, { retryAt: NOW }).retry.allowed).toBe(true);
      expect(retryWriteBound(queue, facts(), NOW, NOW)).not.toBeNull();
    }
    expect(queueItemEligibility('payment_automations', facts(), NOW).retry).toEqual({ allowed: false, code: 'retry_not_offered' });
  });

  it('the switch module ships with the hold OFF', () => {
    const actual = jest.requireActual('../retryHolds') as { LEAD_RETRY_HELD: boolean };
    expect(actual.LEAD_RETRY_HELD).toBe(false);
  });
});
