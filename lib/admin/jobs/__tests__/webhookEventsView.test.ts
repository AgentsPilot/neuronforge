/**
 * The "Stripe webhook events" payload builder (plan payments P-8b.3b, AM-4;
 * SA P3-SA-2 items 1 to 3 and 7, P3-SA-6, P3-SA-7).
 */

import {
  WEBHOOK_EVENTS_SHOWN_LIMIT,
  WEBHOOK_TIMEOUT_PATTERN,
  buildWebhookEventsView,
  classifyWebhookFailure,
  stripeCreatedMs,
  type WebhookEventsInput,
} from '@/lib/admin/jobs/webhookEventsView';
import { STALE_CLAIM_AGE_MS } from '@/lib/repositories/ProcessedWebhookEventRepository';
import type { AdminWebhookEventRow } from '@/lib/repositories/AdminWebhookEventReadRepository';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

const NOW = new Date('2026-10-28T12:00:00.000Z');
const PII = 'jane.customer@example.com';

/** A row created `minutesAgo` minutes before NOW (Stripe's epoch seconds). */
function row(id: string, patch: Partial<AdminWebhookEventRow> & { minutesAgo?: number | null; livemode?: unknown } = {}): AdminWebhookEventRow {
  const { minutesAgo = 60, livemode = false, ...rest } = patch;
  const metadata =
    minutesAgo === null ? { livemode } : { created: Math.floor((NOW.getTime() - minutesAgo * 60_000) / 1000), livemode };
  return {
    event_id: id,
    event_type: 'invoice.paid',
    status: 'failed',
    processed_at: '2026-10-28T11:50:00.000Z',
    failure_message: 'Handler threw',
    metadata,
    ...rest,
  };
}

function input(patch: Partial<WebhookEventsInput> = {}): WebhookEventsInput {
  return {
    mode: 'test',
    now: NOW,
    counts: { failed: 0, stuck: 0 },
    lists: { failed: [], stuck: [] },
    noMode: { failed: 0, stuck: 0 },
    readPerState: 200,
    staleAfterMs: STALE_CLAIM_AGE_MS,
    ...patch,
  };
}

describe('metadata.created is Stripe epoch SECONDS (P3-SA-2 item 2)', () => {
  it('converts a known value × 1000', () => {
    // 1761652800 s = 2025-10-28T12:00:00Z.
    expect(stripeCreatedMs({ created: 1761652800, livemode: true })).toBe(1761652800000);
    const payload = buildWebhookEventsView(
      input({
        counts: { failed: 1, stuck: 0 },
        lists: { failed: [{ ...row('evt_A1'), metadata: { created: 1761652800, livemode: false } }], stuck: [] },
      })
    );
    expect(payload.rows[0].createdAt).toBe('2025-10-28T12:00:00.000Z');
    // Exactly 365 days: the age counts from creation, not the last attempt.
    expect(payload.rows[0].ageMinutes).toBe(365 * 24 * 60);
  });

  it.each([[null], [undefined], [{}], [{ created: '1761652800' }], [{ created: -1 }], [{ created: Number.NaN }], [[1]]])(
    'no usable creation time in %p → null',
    (metadata) => {
      expect(stripeCreatedMs(metadata)).toBeNull();
    }
  );

  it('with no creation time, the age falls back to the last attempt and createdAt is null', () => {
    const payload = buildWebhookEventsView(
      input({ counts: { failed: 1, stuck: 0 }, lists: { failed: [row('evt_B1', { minutesAgo: null })], stuck: [] } })
    );
    expect(payload.rows[0].createdAt).toBeNull();
    expect(payload.rows[0].lastAttemptAt).toBe('2026-10-28T11:50:00.000Z');
    expect(payload.rows[0].ageMinutes).toBe(10);
  });
});

describe('failure classes (Q-P3-3)', () => {
  it('stuck rows are stuck, whatever their message', () => {
    expect(classifyWebhookFailure('stuck', 'timed out')).toBe('stuck');
    expect(classifyWebhookFailure('stuck', null)).toBe('stuck');
  });

  it.each(['Request timed out', 'connect ETIMEDOUT 1.2.3.4:443', 'ESOCKETTIMEDOUT', 'Timeout waiting', 'time-out', 'deadline exceeded'])(
    'the timeout pattern matches %p',
    (message) => {
      expect(WEBHOOK_TIMEOUT_PATTERN.test(message)).toBe(true);
      expect(classifyWebhookFailure('failed', message)).toBe('timeout');
    }
  );

  it.each(['No such customer: cus_x', 'Cannot read properties of undefined', 'outbound', 'timetable missing'])(
    'a non-match %p is a handler error',
    (message) => {
      expect(WEBHOOK_TIMEOUT_PATTERN.test(message)).toBe(false);
      expect(classifyWebhookFailure('failed', message)).toBe('handler_error');
    }
  );

  it.each([[null], [undefined], [''], ['   ']])('an empty or missing message %p is unknown', (message) => {
    expect(classifyWebhookFailure('failed', message)).toBe('unknown');
  });
});

describe('the list and the tiles', () => {
  it('merges both states, sorts oldest first by creation (not by last attempt), and counts honestly', () => {
    const payload = buildWebhookEventsView(
      input({
        counts: { failed: 2, stuck: 1 },
        lists: {
          // Read order (by last attempt) is not the creation order.
          failed: [row('evt_new', { minutesAgo: 30 }), row('evt_old', { minutesAgo: 600 })],
          stuck: [row('evt_mid', { minutesAgo: 120, status: 'processing', failure_message: null })],
        },
      })
    );
    expect(payload.rows.map((r) => r.eventId)).toEqual(['evt_old', 'evt_mid', 'evt_new']);
    expect(payload.rows.map((r) => r.state)).toEqual(['failed', 'stuck', 'failed']);
    expect(payload.rows[1].failureClass).toBe('stuck');
    expect(payload.tiles).toEqual({ failed: 2, stuck: 1, oldestAgeMinutes: 600, oldestAtLeast: false });
    expect(payload.matching).toBe(3);
    expect(payload.listed).toBe(3);
    expect(payload.shownLimit).toBe(50);
    expect(payload.readPerState).toBe(200);
    expect(payload.staleAfterMinutes).toBe(15);
    expect(payload.generatedAt).toBe(NOW.toISOString());
  });

  it('shows at most 50 rows of N', () => {
    const failed = Array.from({ length: 60 }, (_, i) => row(`evt_${String(i).padStart(3, '0')}`, { minutesAgo: 1000 - i }));
    const payload = buildWebhookEventsView(input({ counts: { failed: 60, stuck: 0 }, lists: { failed, stuck: [] } }));
    expect(WEBHOOK_EVENTS_SHOWN_LIMIT).toBe(50);
    expect(payload.rows).toHaveLength(50);
    expect(payload.listed).toBe(50);
    expect(payload.matching).toBe(60);
    expect(payload.rows[0].eventId).toBe('evt_000');
    expect(payload.tiles.oldestAtLeast).toBe(false);
  });

  it('above 200 in a state, the Oldest tile is "at least" (P3-SA-2 item 2)', () => {
    const failed = Array.from({ length: 200 }, (_, i) => row(`evt_f${i}`));
    expect(buildWebhookEventsView(input({ counts: { failed: 201, stuck: 0 }, lists: { failed, stuck: [] } })).tiles.oldestAtLeast).toBe(true);
    expect(buildWebhookEventsView(input({ counts: { failed: 200, stuck: 0 }, lists: { failed, stuck: [] } })).tiles.oldestAtLeast).toBe(false);
    const stuck = Array.from({ length: 200 }, (_, i) => row(`evt_s${i}`, { status: 'processing' }));
    expect(buildWebhookEventsView(input({ counts: { failed: 0, stuck: 250 }, lists: { failed: [], stuck } })).tiles.oldestAtLeast).toBe(true);
  });

  it('nothing unfinished: zero tiles, no oldest, empty list', () => {
    const payload = buildWebhookEventsView(input());
    expect(payload.tiles).toEqual({ failed: 0, stuck: 0, oldestAgeMinutes: null, oldestAtLeast: false });
    expect(payload.rows).toEqual([]);
    expect(payload.matching).toBe(0);
  });

  it('rows with no recorded mode are a count only (Q-P3-7)', () => {
    expect(buildWebhookEventsView(input({ noMode: { failed: 2, stuck: 1 } })).noMode).toBe(3);
    expect(buildWebhookEventsView(input()).noMode).toBe(0);
  });

  it("the dashboard link uses the row's own mode, and only a real event id gets one", () => {
    const payload = buildWebhookEventsView(
      input({
        mode: 'live',
        counts: { failed: 3, stuck: 0 },
        lists: {
          failed: [
            row('evt_Live1', { minutesAgo: 3, livemode: true }),
            row('evt_Test1', { minutesAgo: 2, livemode: false }),
            row('not_an_event', { minutesAgo: 1, livemode: true }),
          ],
          stuck: [],
        },
      })
    );
    expect(payload.rows.map((r) => r.dashboardUrl)).toEqual([
      'https://dashboard.stripe.com/events/evt_Live1',
      'https://dashboard.stripe.com/test/events/evt_Test1',
      null,
    ]);
  });

  it('an empty event type is null (the event type is shown; there is no flow column, Q-P3-1)', () => {
    const payload = buildWebhookEventsView(
      input({ counts: { failed: 1, stuck: 0 }, lists: { failed: [row('evt_T', { event_type: '' })], stuck: [] } })
    );
    expect(payload.rows[0].eventType).toBeNull();
    expect(Object.keys(payload.rows[0]).sort()).toEqual(
      ['ageMinutes', 'createdAt', 'dashboardUrl', 'eventId', 'eventType', 'failureClass', 'lastAttemptAt', 'state'].sort()
    );
  });
});

describe('P3-SA-6: the failure message never leaves the builder', () => {
  it('an email planted in a failed row is in no part of the payload', () => {
    const payload = buildWebhookEventsView(
      input({
        counts: { failed: 2, stuck: 1 },
        lists: {
          failed: [
            row('evt_P1', { failure_message: `No such customer for ${PII}` }),
            row('evt_P2', { failure_message: `Request timed out for ${PII}` }),
          ],
          stuck: [row('evt_P3', { status: 'processing', failure_message: PII })],
        },
      })
    );
    const text = JSON.stringify(payload);
    expect(text).not.toContain(PII);
    expect(text).not.toContain('No such customer');
    expect(payload.rows.map((r) => r.failureClass).sort()).toEqual(['handler_error', 'stuck', 'timeout']);
  });
});

describe('fixes after SA/QA (P-8b.3b): QA Low 1, the count and list race', () => {
  it('QA repro: a row turning failed between the count and the list (3 counted, 2 listed) is not a cut', () => {
    const payload = buildWebhookEventsView(
      input({ counts: { failed: 3, stuck: 0 }, lists: { failed: [row('evt_R1'), row('evt_R2')], stuck: [] } })
    );
    expect(payload.tiles.oldestAtLeast).toBe(false);
    expect(payload.matching).toBe(3);
    expect(payload.listed).toBe(2);
  });

  it('QA repro: the same race in the stuck state is not a cut either', () => {
    const stuck = [row('evt_S1', { status: 'processing' })];
    expect(buildWebhookEventsView(input({ counts: { failed: 0, stuck: 2 }, lists: { failed: [], stuck } })).tiles.oldestAtLeast).toBe(false);
  });

  it('QA repro: a row completing between the reads (1 counted, 2 listed) never says "2 of 1"', () => {
    const payload = buildWebhookEventsView(
      input({ counts: { failed: 1, stuck: 0 }, lists: { failed: [row('evt_C1'), row('evt_C2')], stuck: [] } })
    );
    expect(payload.listed).toBe(2);
    expect(payload.matching).toBe(2);
    expect(payload.matching).toBeGreaterThanOrEqual(payload.listed);
    expect(payload.tiles.failed).toBe(1);
  });

  it('a list read cut at the limit with a higher count is still "at least"', () => {
    const failed = Array.from({ length: 200 }, (_, i) => row(`evt_L${i}`));
    expect(buildWebhookEventsView(input({ counts: { failed: 201, stuck: 0 }, lists: { failed, stuck: [] } })).tiles.oldestAtLeast).toBe(true);
    // At the limit with an equal or smaller count, nothing was cut.
    expect(buildWebhookEventsView(input({ counts: { failed: 199, stuck: 0 }, lists: { failed, stuck: [] } })).tiles.oldestAtLeast).toBe(false);
  });

  it('matching is never below the rows read, even when every read row is past the 50 shown', () => {
    const failed = Array.from({ length: 60 }, (_, i) => row(`evt_M${i}`));
    const payload = buildWebhookEventsView(input({ counts: { failed: 55, stuck: 0 }, lists: { failed, stuck: [] } }));
    expect(payload.listed).toBe(50);
    expect(payload.matching).toBe(60);
  });
});

describe('fixes after SA/QA (P-8b.3b): QA Low 2, an out-of-range created time', () => {
  it.each([
    ['past what Date can hold (toISOString would throw)', 1e13],
    ['a value stored in ms by mistake (year 57794)', 1761652800000],
    ['the first second of the year 10000', Date.UTC(10000, 0, 1) / 1000],
  ])('%s is "not recorded" and the age falls back to the last attempt', (_label, created) => {
    expect(stripeCreatedMs({ created, livemode: false })).toBeNull();
    const bad = { ...row('evt_X1'), metadata: { created, livemode: false } };
    const payload = buildWebhookEventsView(
      input({ counts: { failed: 2, stuck: 0 }, lists: { failed: [bad, row('evt_X2', { minutesAgo: 30 })], stuck: [] } })
    );
    const x1 = payload.rows.find((r) => r.eventId === 'evt_X1')!;
    expect(x1.createdAt).toBeNull();
    expect(x1.lastAttemptAt).toBe('2026-10-28T11:50:00.000Z');
    expect(x1.ageMinutes).toBe(10);
    // The other row is untouched: one bad row never hides the rest.
    expect(payload.rows.find((r) => r.eventId === 'evt_X2')!.createdAt).not.toBeNull();
  });

  it('the last second of the year 9999 is still shown', () => {
    const created = Math.floor(Date.UTC(9999, 11, 31, 23, 59, 59) / 1000);
    expect(stripeCreatedMs({ created })).toBe(created * 1000);
    const payload = buildWebhookEventsView(
      input({ counts: { failed: 1, stuck: 0 }, lists: { failed: [{ ...row('evt_Y1'), metadata: { created, livemode: false } }], stuck: [] } })
    );
    expect(payload.rows[0].createdAt).toBe('9999-12-31T23:59:59.000Z');
    expect(payload.rows[0].ageMinutes).toBe(0);
  });
});
